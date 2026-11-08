-- Tighten access after the Supabase security advisor review.
-- 1. Reporting views become security-definer functions (each still checks the caller's role).
-- 2. Nobody signed out can call any function; trigger functions can't be called directly.
-- 3. Fixed search_path on the remaining functions.

drop view member_directory, finance_member_status, membership_history, income_statement, qualifications_expiring;

-- Member directory: names, phone and email of current adult members who haven't opted out.
create function member_directory()
returns table (id uuid, first_name text, last_name text, mobile text, email text)
language sql stable security definer set search_path = public as $$
  select distinct p.id, p.first_name, p.last_name, p.mobile, p.email
    from people p
    join membership_people mp on mp.person_id = p.id
    join memberships m on m.id = mp.membership_id
   where m.club_year_id = current_club_year_id()
     and m.status = 'active'
     and not p.directory_opt_out
     and p.archived_at is null
     and p.date_of_birth <= current_date - interval '18 years'   -- adults only (safeguarding)
     and current_person_id() is not null
$$;

-- Finance view of members: names and payment status only.
create function finance_member_status()
returns table (person_id uuid, first_name text, last_name text, club_year text,
               membership_code text, membership_type text, status membership_status, price_pence integer)
language sql stable security definer set search_path = public as $$
  select p.id, p.first_name, p.last_name, cy.label, t.code, t.name, m.status, m.price_pence
    from memberships m
    join club_years cy on cy.id = m.club_year_id
    join membership_types t on t.id = m.membership_type_id
    join membership_people mp on mp.membership_id = m.id
    join people p on p.id = mp.person_id
   where has_role('finance') or has_role('admin')
$$;

-- A member's year-by-year history, linked to income.
create function membership_history()
returns table (person_id uuid, club_year text, starts_on date, code text, membership_type text,
               status membership_status, price_pence integer, paid_on date, method payment_method,
               transaction_id uuid)
language sql stable security definer set search_path = public as $$
  select mp.person_id, cy.label, cy.starts_on, t.code, t.name,
         m.status, m.price_pence, pay.paid_on, pay.method, tx.id
    from membership_people mp
    join memberships m on m.id = mp.membership_id
    join club_years cy on cy.id = m.club_year_id
    join membership_types t on t.id = m.membership_type_id
    left join payment_lines pl on pl.membership_id = m.id
    left join payments pay on pay.id = pl.payment_id and pay.status = 'paid'
    left join transactions tx on tx.payment_line_id = pl.id
   where mp.person_id = current_person_id()
      or mp.person_id in (select id from people where household_id = my_household_id())
      or has_role('finance') or has_role('admin')
$$;

-- Income statement by club year and category (membership income split by type).
create function income_statement()
returns table (club_year text, direction txn_direction, category text, membership_code text,
               total_pence bigint, entries bigint)
language sql stable security definer set search_path = public as $$
  select cy.label, tx.direction, coalesce(c.name, 'Uncategorised'), t.code,
         sum(tx.amount_pence), count(*)
    from transactions tx
    join club_years cy on tx.occurred_on between cy.starts_on and cy.ends_on
    left join transaction_categories c on c.id = tx.category_id
    left join membership_types t on t.id = tx.membership_type_id
   where has_role('finance') or has_role('admin')
   group by cy.label, tx.direction, coalesce(c.name, 'Uncategorised'), t.code
$$;

-- Qualifications expiring in the next 60 days (admins).
create function qualifications_expiring()
returns table (id uuid, first_name text, last_name text, name text, expires_on date)
language sql stable security definer set search_path = public as $$
  select q.id, p.first_name, p.last_name, q.name, q.expires_on
    from qualifications q join people p on p.id = q.person_id
   where q.expires_on between current_date and current_date + 60
     and has_role('admin')
$$;

alter function current_club_year_id() set search_path = public;
alter function prorata_months(date) set search_path = public;
alter function touch_updated_at() set search_path = public;

-- Function access: signed-in users only, and only the functions the app calls.
revoke execute on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon;

grant execute on function
  current_person_id(), has_role(app_role), my_household_id(), is_household_lead(uuid),
  current_club_year_id(), prorata_months(date),
  get_medical_record(uuid), start_membership(uuid, uuid[], date), approve_membership(uuid),
  member_directory(), finance_member_status(), membership_history(),
  income_statement(), qualifications_expiring()
to authenticated;
