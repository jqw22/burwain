-- Burwain membership app: roles, row-level security, business functions, views, audit.
-- Roles: every logged-in person is a member; user_roles adds finance / admin / superadmin.
-- superadmin passes every role check.

-- ---------------------------------------------------------------------------
-- Helper functions
-- ---------------------------------------------------------------------------
create or replace function current_person_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from people where auth_user_id = auth.uid() and archived_at is null
$$;

create or replace function has_role(r app_role) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from user_roles
    where person_id = current_person_id() and role in (r, 'superadmin')
  )
$$;

create or replace function my_household_id() returns uuid
language sql stable security definer set search_path = public as $$
  select household_id from people where id = current_person_id()
$$;

create or replace function is_household_lead(h uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from households where id = h and lead_person_id = current_person_id())
$$;

create or replace function current_club_year_id() returns uuid
language sql stable as $$
  select id from club_years where current_date between starts_on and ends_on
$$;

-- Months left in the club year (March = 12 ... February = 1).
create or replace function prorata_months(join_date date) returns integer
language sql immutable as $$
  select ((2 - extract(month from join_date)::int + 12) % 12) + 1
$$;

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

create trigger people_touch      before update on people      for each row execute function touch_updated_at();
create trigger households_touch  before update on households  for each row execute function touch_updated_at();
create trigger memberships_touch before update on memberships for each row execute function touch_updated_at();

-- Members may edit their own details but not admin-controlled fields.
create or replace function people_guard_admin_fields() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or has_role('admin') then
    return new;   -- service role / migrations / admins
  end if;
  if new.auth_user_id    is distinct from old.auth_user_id
  or new.first_joined_on is distinct from old.first_joined_on
  or new.archived_at     is distinct from old.archived_at
  or new.household_id    is distinct from old.household_id then
    raise exception 'Only an admin can change login, first joined date, household or archive status';
  end if;
  if new.news_consent is distinct from old.news_consent then
    new.news_consent_at := case when new.news_consent then now() else null end;
  end if;
  return new;
end $$;
create trigger people_guard before update on people for each row execute function people_guard_admin_fields();

-- ---------------------------------------------------------------------------
-- Audit log (who changed what, when)
-- ---------------------------------------------------------------------------
create or replace function audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  hide boolean := coalesce(tg_argv[0], '') = 'no_data';
  rid  text;
begin
  rid := coalesce(
    case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end ->> 'id',
    case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end ->> 'person_id');
  insert into audit_log (table_name, row_id, action, changed_by, old_data, new_data)
  values (tg_table_name, rid, tg_op, current_person_id(),
          case when hide or tg_op = 'INSERT' then null else to_jsonb(old) end,
          case when hide or tg_op = 'DELETE' then null else to_jsonb(new) end);
  return coalesce(new, old);
end $$;

create trigger audit after insert or update or delete on people              for each row execute function audit_row();
create trigger audit after insert or update or delete on households          for each row execute function audit_row();
create trigger audit after insert or update or delete on user_roles          for each row execute function audit_row();
create trigger audit after insert or update or delete on membership_types    for each row execute function audit_row();
create trigger audit after insert or update or delete on memberships         for each row execute function audit_row();
create trigger audit after insert or update or delete on membership_people   for each row execute function audit_row();
create trigger audit after insert or update or delete on boat_storages       for each row execute function audit_row();
create trigger audit after insert or update or delete on payments            for each row execute function audit_row();
create trigger audit after insert or update or delete on transactions        for each row execute function audit_row();
create trigger audit after insert or update or delete on qualifications      for each row execute function audit_row();
create trigger audit after insert or update or delete on medical_records     for each row execute function audit_row('no_data');

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table households                enable row level security;
alter table people                    enable row level security;
alter table user_roles                enable row level security;
alter table medical_records           enable row level security;
alter table medical_access_log        enable row level security;
alter table qualifications            enable row level security;
alter table activities                enable row level security;
alter table membership_types          enable row level security;
alter table membership_type_activities enable row level security;
alter table club_years                enable row level security;
alter table memberships               enable row level security;
alter table membership_people         enable row level security;
alter table boat_storage_options      enable row level security;
alter table boat_storages             enable row level security;
alter table payments                  enable row level security;
alter table payment_lines             enable row level security;
alter table transaction_categories    enable row level security;
alter table transactions              enable row level security;
alter table email_templates           enable row level security;
alter table email_campaigns           enable row level security;
alter table email_recipients          enable row level security;
alter table audit_log                 enable row level security;

-- Households: own household; leads edit it; admins everything.
create policy hh_select on households for select to authenticated
  using (id = my_household_id() or has_role('admin'));
create policy hh_update on households for update to authenticated
  using (is_household_lead(id) or has_role('admin'));
create policy hh_admin_insert on households for insert to authenticated
  with check (has_role('admin'));
create policy hh_super_delete on households for delete to authenticated
  using (has_role('superadmin'));

-- People: self and own household; admins all. Finance uses finance_member_status view instead.
create policy people_select on people for select to authenticated
  using (id = current_person_id() or household_id = my_household_id() or has_role('admin'));
create policy people_update on people for update to authenticated
  using (id = current_person_id() or is_household_lead(household_id) or has_role('admin'));
create policy people_insert on people for insert to authenticated
  with check (has_role('admin') or is_household_lead(household_id));
create policy people_super_delete on people for delete to authenticated
  using (has_role('superadmin'));

-- Roles: see your own; superadmins manage.
create policy roles_select on user_roles for select to authenticated
  using (person_id = current_person_id() or has_role('admin'));
create policy roles_super_write on user_roles for all to authenticated
  using (has_role('superadmin')) with check (has_role('superadmin'));

-- Medical: the member reads/writes their own. Admins go through get_medical_record(), which logs the view.
create policy medical_self on medical_records for all to authenticated
  using (person_id = current_person_id()) with check (person_id = current_person_id());
create policy medical_admin_write on medical_records for update to authenticated
  using (has_role('admin')) with check (has_role('admin'));
create policy medical_log_super on medical_access_log for select to authenticated
  using (has_role('superadmin'));

-- Qualifications: self and household read; self and admins write.
create policy quals_select on qualifications for select to authenticated
  using (person_id = current_person_id()
         or person_id in (select id from people where household_id = my_household_id())
         or has_role('admin'));
create policy quals_write_self on qualifications for all to authenticated
  using (person_id = current_person_id() or has_role('admin'))
  with check (person_id = current_person_id() or has_role('admin'));

-- Reference data: everyone logged in reads; superadmins write.
create policy act_read   on activities                 for select to authenticated using (true);
create policy act_write  on activities                 for all    to authenticated using (has_role('superadmin')) with check (has_role('superadmin'));
create policy mt_read    on membership_types           for select to authenticated using (true);
create policy mt_write   on membership_types           for all    to authenticated using (has_role('superadmin')) with check (has_role('superadmin'));
create policy mta_read   on membership_type_activities for select to authenticated using (true);
create policy mta_write  on membership_type_activities for all    to authenticated using (has_role('superadmin')) with check (has_role('superadmin'));
create policy cy_read    on club_years                 for select to authenticated using (true);
create policy cy_write   on club_years                 for all    to authenticated using (has_role('superadmin')) with check (has_role('superadmin'));
create policy bso_read   on boat_storage_options       for select to authenticated using (true);
create policy bso_write  on boat_storage_options       for all    to authenticated using (has_role('superadmin')) with check (has_role('superadmin'));

-- Memberships: members see their household's; finance/admin see all.
-- Members create memberships only through start_membership() so prices can't be tampered with.
create policy ms_select on memberships for select to authenticated
  using (payer_person_id = current_person_id() or household_id = my_household_id()
         or has_role('finance') or has_role('admin'));
create policy ms_admin_write on memberships for all to authenticated
  using (has_role('admin')) with check (has_role('admin'));

create policy mp_select on membership_people for select to authenticated
  using (person_id = current_person_id()
         or membership_id in (select id from memberships where household_id = my_household_id())
         or has_role('finance') or has_role('admin'));
create policy mp_admin_write on membership_people for all to authenticated
  using (has_role('admin')) with check (has_role('admin'));

create policy bs_select on boat_storages for select to authenticated
  using (person_id = current_person_id() or has_role('finance') or has_role('admin'));
create policy bs_admin_write on boat_storages for all to authenticated
  using (has_role('admin')) with check (has_role('admin'));

-- Payments: payer sees own; finance records manual payments; online payments arrive via the service role.
create policy pay_select on payments for select to authenticated
  using (payer_person_id = current_person_id() or has_role('finance') or has_role('admin'));
create policy pay_finance_write on payments for all to authenticated
  using (has_role('finance')) with check (has_role('finance'));
create policy pl_select on payment_lines for select to authenticated
  using (payment_id in (select id from payments where payer_person_id = current_person_id())
         or has_role('finance') or has_role('admin'));
create policy pl_finance_write on payment_lines for all to authenticated
  using (has_role('finance')) with check (has_role('finance'));

-- Finance ledger: finance writes, admins read. No deletes: corrections are reversing entries.
create policy cat_read  on transaction_categories for select to authenticated using (has_role('finance') or has_role('admin'));
create policy cat_write on transaction_categories for insert to authenticated with check (has_role('finance'));
create policy cat_upd   on transaction_categories for update to authenticated using (has_role('finance'));
create policy txn_read  on transactions for select to authenticated using (has_role('finance') or has_role('admin'));
create policy txn_ins   on transactions for insert to authenticated with check (has_role('finance'));
create policy txn_upd   on transactions for update to authenticated using (has_role('finance'));

-- Email: admins only.
create policy et_admin on email_templates  for all to authenticated using (has_role('admin')) with check (has_role('admin'));
create policy ec_admin on email_campaigns  for all to authenticated using (has_role('admin')) with check (has_role('admin'));
create policy er_admin on email_recipients for all to authenticated using (has_role('admin')) with check (has_role('admin'));

-- Audit log: superadmins only.
create policy audit_super on audit_log for select to authenticated using (has_role('superadmin'));

-- ---------------------------------------------------------------------------
-- Business functions (called from the app)
-- ---------------------------------------------------------------------------

-- Admin read of a member's medical record; every call is logged.
create or replace function get_medical_record(p_person uuid)
returns setof medical_records
language plpgsql security definer set search_path = public as $$
begin
  if not (p_person = current_person_id() or has_role('admin')) then
    raise exception 'Not allowed to view this medical record';
  end if;
  if p_person <> current_person_id() then
    insert into medical_access_log (person_id, viewed_by) values (p_person, current_person_id());
  end if;
  return query select * from medical_records where person_id = p_person;
end $$;

-- Start a membership for the current club year (renewal or new join).
-- Prices are worked out here: full price from 1 March, monthly pro rata after.
create or replace function start_membership(
  p_type_id uuid, p_person_ids uuid[], p_join_date date default current_date)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me        uuid := current_person_id();
  hh        uuid;
  mt        membership_types;
  yr        club_years;
  months    int;
  new_id    uuid;
begin
  if me is null then raise exception 'Not logged in'; end if;
  select * into mt from membership_types where id = p_type_id and is_open;
  if not found then raise exception 'Membership type not available'; end if;
  select * into yr from club_years where p_join_date between starts_on and ends_on;
  if not found then raise exception 'No club year set up for %', p_join_date; end if;

  select household_id into hh from people where id = me;
  if exists (select 1 from unnest(p_person_ids) pid
             where pid <> me and pid not in (select id from people where household_id = hh and hh is not null)) then
    raise exception 'You can only add people from your own household';
  end if;
  if mt.cover in ('individual', 'junior') and cardinality(p_person_ids) <> 1 then
    raise exception '% covers exactly one person', mt.name;
  end if;
  if mt.cover = 'dual' and cardinality(p_person_ids) <> 2 then
    raise exception '% covers exactly two adults', mt.name;
  end if;
  if mt.max_age is not null and exists (
       select 1 from people where id = any(p_person_ids)
       and (date_of_birth is null or date_part('year', age(yr.starts_on, date_of_birth)) > mt.max_age)) then
    raise exception 'Someone is over the age limit for % (date of birth needed)', mt.name;
  end if;
  if mt.requires_adult_member and not exists (
       select 1 from memberships m
       join membership_types t on t.id = m.membership_type_id
       where m.club_year_id = yr.id and m.household_id = hh
         and t.cover <> 'junior' and m.status in ('active', 'awaiting_payment')) then
    raise exception 'A junior needs an adult in the household to hold a membership this year';
  end if;

  months := case when p_join_date <= yr.starts_on + 30 then 12 else prorata_months(p_join_date) end;

  insert into memberships (club_year_id, membership_type_id, payer_person_id, household_id,
                           status, price_pence, prorata_months)
  values (yr.id, mt.id, me, hh,
          case when mt.requires_approval then 'pending_approval' else 'awaiting_payment' end::membership_status,
          round(mt.annual_price_pence * months / 12.0)::int, months)
  returning id into new_id;

  insert into membership_people (membership_id, person_id)
  select new_id, unnest(p_person_ids);
  return new_id;
end $$;

-- Admin approval for types that need it (Associate).
create or replace function approve_membership(p_membership uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not has_role('admin') then raise exception 'Admins only'; end if;
  update memberships
     set status = 'awaiting_payment', approved_by = current_person_id(), approved_at = now()
   where id = p_membership and status = 'pending_approval';
  if not found then raise exception 'Membership is not awaiting approval'; end if;
end $$;

-- When a payment is marked paid: activate what it paid for and post income to the ledger.
create or replace function on_payment_paid() returns trigger
language plpgsql security definer set search_path = public as $$
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
   where id in (select membership_id from payment_lines where payment_id = new.id);
  update boat_storages set status = 'active'
   where id in (select boat_storage_id from payment_lines where payment_id = new.id);

  insert into transactions (occurred_on, description, direction, amount_pence, category_id,
                            method, payment_line_id, membership_type_id, recorded_by)
  select coalesce(new.paid_on, current_date), pl.description, 'in', pl.amount_pence,
         case when pl.boat_storage_id is not null then store_cat else subs_cat end,
         new.method, pl.id, m.membership_type_id, new.recorded_by
    from payment_lines pl
    left join memberships m on m.id = pl.membership_id
   where pl.payment_id = new.id;

  if new.fee_pence > 0 then
    insert into transactions (occurred_on, description, direction, amount_pence, category_id, method)
    values (coalesce(new.paid_on, current_date), 'Payment provider fee', 'out', new.fee_pence, fee_cat, new.method);
  end if;
  return new;
end $$;
create trigger payment_paid after update of status on payments
  for each row execute function on_payment_paid();

-- ---------------------------------------------------------------------------
-- Views (security definer by default: each filters on the caller's role)
-- ---------------------------------------------------------------------------

-- Member directory: names, phone and email of current members who haven't opted out.
create view member_directory as
select distinct p.id, p.first_name, p.last_name, p.mobile, p.email
  from people p
  join membership_people mp on mp.person_id = p.id
  join memberships m on m.id = mp.membership_id
 where m.club_year_id = current_club_year_id()
   and m.status = 'active'
   and not p.directory_opt_out
   and p.archived_at is null
   and p.date_of_birth <= current_date - interval '18 years'   -- adults only (safeguarding)
   and current_person_id() is not null;

-- Finance view of members: names and payment status only.
create view finance_member_status as
select p.id as person_id, p.first_name, p.last_name, cy.label as club_year,
       t.code as membership_code, t.name as membership_type, m.status, m.price_pence
  from memberships m
  join club_years cy on cy.id = m.club_year_id
  join membership_types t on t.id = m.membership_type_id
  join membership_people mp on mp.membership_id = m.id
  join people p on p.id = mp.person_id
 where has_role('finance') or has_role('admin');

-- A member's year-by-year history, linked to income.
create view membership_history as
select mp.person_id, cy.label as club_year, cy.starts_on, t.code, t.name as membership_type,
       m.status, m.price_pence, pay.paid_on, pay.method, tx.id as transaction_id
  from membership_people mp
  join memberships m on m.id = mp.membership_id
  join club_years cy on cy.id = m.club_year_id
  join membership_types t on t.id = m.membership_type_id
  left join payment_lines pl on pl.membership_id = m.id
  left join payments pay on pay.id = pl.payment_id and pay.status = 'paid'
  left join transactions tx on tx.payment_line_id = pl.id
 where mp.person_id = current_person_id()
    or mp.person_id in (select id from people where household_id = my_household_id())
    or has_role('finance') or has_role('admin');

-- Income statement by club year and category (membership income split by type).
create view income_statement as
select cy.label as club_year, tx.direction,
       coalesce(c.name, 'Uncategorised') as category,
       t.code as membership_code,
       sum(tx.amount_pence) as total_pence,
       count(*) as entries
  from transactions tx
  join club_years cy on tx.occurred_on between cy.starts_on and cy.ends_on
  left join transaction_categories c on c.id = tx.category_id
  left join membership_types t on t.id = tx.membership_type_id
 where has_role('finance') or has_role('admin')
 group by cy.label, tx.direction, coalesce(c.name, 'Uncategorised'), t.code;

-- Qualifications expiring in the next 60 days (admins).
create view qualifications_expiring as
select q.id, p.first_name, p.last_name, q.name, q.expires_on
  from qualifications q join people p on p.id = q.person_id
 where q.expires_on between current_date and current_date + 60
   and has_role('admin');

-- ---------------------------------------------------------------------------
-- Grants: nothing for anonymous visitors.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from anon;
grant select on member_directory, finance_member_status, membership_history,
                income_statement, qualifications_expiring to authenticated;
