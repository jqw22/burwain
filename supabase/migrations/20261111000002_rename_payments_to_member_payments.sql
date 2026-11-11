-- Rename the tables that hold money received from members, so they are not
-- confused with payments the club makes to suppliers (those are recorded in
-- "transactions" with direction 'out').
--   payments       -> member_payments
--   payment_lines  -> member_payment_lines
-- Policies, triggers, indexes and foreign keys follow the rename automatically.
-- Functions store their body as text, so the ones that use these tables are
-- recreated below with the new names (otherwise unchanged).

alter table payments rename to member_payments;
alter table payment_lines rename to member_payment_lines;

alter table member_payments rename constraint payments_pkey to member_payments_pkey;
alter table member_payment_lines rename constraint payment_lines_pkey to member_payment_lines_pkey;

CREATE OR REPLACE FUNCTION public.on_payment_paid()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  subs_cat uuid;
  store_cat uuid;
  fee_cat uuid;
begin
  if new.status <> 'paid' or old.status = 'paid' then return new; end if;
  select id into subs_cat  from transaction_categories where name = 'Subscriptions';
  select id into store_cat from transaction_categories where name = 'Boat storage';
  select id into fee_cat   from transaction_categories where name = 'Payment fees';

  update memberships set status = 'active'
   where id in (select membership_id from member_payment_lines where payment_id = new.id);
  update boat_storages set status = 'active'
   where id in (select boat_storage_id from member_payment_lines where payment_id = new.id);

  insert into transactions (occurred_on, description, direction, amount_pence, category_id,
                            method, payment_line_id, membership_type_id, recorded_by)
  select coalesce(new.paid_on, current_date), pl.description, 'in', pl.amount_pence,
         case when pl.boat_storage_id is not null then store_cat else subs_cat end,
         new.method, pl.id, m.membership_type_id, new.recorded_by
    from member_payment_lines pl
    left join memberships m on m.id = pl.membership_id
   where pl.payment_id = new.id;

  if new.fee_pence > 0 then
    insert into transactions (occurred_on, description, direction, amount_pence, category_id, method)
    values (coalesce(new.paid_on, current_date), 'Payment provider fee', 'out', new.fee_pence, fee_cat, new.method);
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.membership_history()
 RETURNS TABLE(person_id uuid, club_year text, starts_on date, code text, membership_type text, status membership_status, price_pence integer, paid_on date, method payment_method, transaction_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select mp.person_id, cy.label, cy.starts_on, t.code, t.name,
         m.status, m.price_pence, pay.paid_on, pay.method, tx.id
    from membership_people mp
    join memberships m on m.id = mp.membership_id
    join club_years cy on cy.id = m.club_year_id
    join membership_types t on t.id = m.membership_type_id
    left join member_payment_lines pl on pl.membership_id = m.id
    left join member_payments pay on pay.id = pl.payment_id and pay.status = 'paid'
    left join transactions tx on tx.payment_line_id = pl.id
   where mp.person_id = current_person_id()
      or mp.person_id in (select id from people where household_id = my_household_id())
      or has_role('finance') or has_role('admin')
$function$
;

CREATE OR REPLACE FUNCTION public.cancel_my_membership(p_membership uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update memberships set status = 'cancelled'
   where id = p_membership
     and payer_person_id = current_person_id()
     and status in ('awaiting_payment', 'pending_approval')
     and not exists (select 1 from member_payment_lines where membership_id = p_membership);
  if not found then raise exception 'Only an unpaid membership you took out can be cancelled'; end if;
end $function$
;

CREATE OR REPLACE FUNCTION public.club_memberships(p_club_year_id uuid)
 RETURNS TABLE(id uuid, membership_code text, membership_type text, status membership_status, price_pence integer, prorata_months integer, payer_name text, people text, created_at timestamp with time zone, paid_on date, method payment_method)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select m.id, t.code, t.name, m.status, m.price_pence, m.prorata_months,
         payer.first_name || ' ' || payer.last_name,
         (select string_agg(p.first_name || ' ' || p.last_name, ', ' order by p.date_of_birth nulls first)
            from membership_people mp join people p on p.id = mp.person_id where mp.membership_id = m.id),
         m.created_at, pay.paid_on, pay.method
    from memberships m
    join membership_types t on t.id = m.membership_type_id
    join people payer on payer.id = m.payer_person_id
    left join lateral (
      select py.paid_on, py.method from member_payment_lines pl join member_payments py on py.id = pl.payment_id
       where pl.membership_id = m.id and py.status = 'paid' order by py.paid_on desc limit 1
    ) pay on true
   where m.club_year_id = p_club_year_id
     and (has_role('finance') or has_role('admin'))
   order by payer.last_name, payer.first_name, t.sort_order
$function$
;

CREATE OR REPLACE FUNCTION public.record_manual_payment(p_membership_ids uuid[], p_method payment_method, p_paid_on date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  pay_id uuid;
  total  integer;
  payer  uuid;
begin
  if not has_role('finance') then raise exception 'Only finance can record payments'; end if;
  if p_method not in ('cash', 'cheque', 'bank_transfer') then
    raise exception 'Card and Direct Debit payments are recorded automatically';
  end if;
  if p_paid_on is null or p_paid_on > current_date then raise exception 'Give the date the payment was received'; end if;
  if coalesce(cardinality(p_membership_ids), 0) = 0 then raise exception 'Choose at least one membership'; end if;
  if exists (select 1 from memberships where id = any(p_membership_ids) and status <> 'awaiting_payment')
     or (select count(*) from memberships where id = any(p_membership_ids)) <> cardinality(p_membership_ids) then
    raise exception 'Only memberships awaiting payment can be marked as paid';
  end if;

  select sum(price_pence), min(payer_person_id::text)::uuid into total, payer
    from memberships where id = any(p_membership_ids);

  insert into member_payments (payer_person_id, amount_pence, method, status, paid_on, recorded_by)
  values (payer, total, p_method, 'pending', p_paid_on, current_person_id())
  returning id into pay_id;

  insert into member_payment_lines (payment_id, membership_id, description, amount_pence)
  select pay_id, m.id, t.name || ' ' || cy.label, m.price_pence
    from memberships m
    join membership_types t on t.id = m.membership_type_id
    join club_years cy on cy.id = m.club_year_id
   where m.id = any(p_membership_ids);

  update member_payments set status = 'paid' where id = pay_id;   -- trigger activates and posts income
  return pay_id;
end $function$
;
