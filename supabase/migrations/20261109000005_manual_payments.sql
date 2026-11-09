-- Admin and finance screens for this year's memberships.
-- 1. club_memberships(): every membership in a club year with names, for finance and admins.
--    (Finance can't read member records directly, so names come through this function.)
-- 2. record_manual_payment(): finance records cash, cheque or bank transfer for one or more
--    memberships. The existing payment trigger then marks them paid and posts the income.

create function club_memberships(p_club_year_id uuid)
returns table (id uuid, membership_code text, membership_type text, status membership_status,
               price_pence integer, prorata_months integer, payer_name text, people text,
               created_at timestamptz, paid_on date, method payment_method)
language sql stable security definer set search_path = public as $$
  select m.id, t.code, t.name, m.status, m.price_pence, m.prorata_months,
         payer.first_name || ' ' || payer.last_name,
         (select string_agg(p.first_name || ' ' || p.last_name, ', ' order by p.date_of_birth nulls first)
            from membership_people mp join people p on p.id = mp.person_id where mp.membership_id = m.id),
         m.created_at, pay.paid_on, pay.method
    from memberships m
    join membership_types t on t.id = m.membership_type_id
    join people payer on payer.id = m.payer_person_id
    left join lateral (
      select py.paid_on, py.method from payment_lines pl join payments py on py.id = pl.payment_id
       where pl.membership_id = m.id and py.status = 'paid' order by py.paid_on desc limit 1
    ) pay on true
   where m.club_year_id = p_club_year_id
     and (has_role('finance') or has_role('admin'))
   order by payer.last_name, payer.first_name, t.sort_order
$$;

create function record_manual_payment(p_membership_ids uuid[], p_method payment_method, p_paid_on date)
returns uuid
language plpgsql security definer set search_path = public as $$
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

  insert into payments (payer_person_id, amount_pence, method, status, paid_on, recorded_by)
  values (payer, total, p_method, 'pending', p_paid_on, current_person_id())
  returning id into pay_id;

  insert into payment_lines (payment_id, membership_id, description, amount_pence)
  select pay_id, m.id, t.name || ' ' || cy.label, m.price_pence
    from memberships m
    join membership_types t on t.id = m.membership_type_id
    join club_years cy on cy.id = m.club_year_id
   where m.id = any(p_membership_ids);

  update payments set status = 'paid' where id = pay_id;   -- trigger activates and posts income
  return pay_id;
end $$;

revoke execute on function club_memberships(uuid), record_manual_payment(uuid[], payment_method, date) from public, anon;
grant execute on function club_memberships(uuid), record_manual_payment(uuid[], payment_method, date) to authenticated;
