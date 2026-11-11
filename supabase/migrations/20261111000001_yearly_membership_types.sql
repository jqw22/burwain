-- Membership types are set up afresh for each club year (James, 2026-11-11).
-- 1. Every type belongs to one club year. Today's types become this year's types. If another year
--    already has memberships, those types are copied into that year and its memberships moved onto the copies.
-- 2. Admins copy one year's types into the next year as a starting point, then change prices or add or
--    remove types for that year without touching any other year.
-- 3. Renewals for next year only open once next year has at least one active type.
-- 4. Members renew into any of next year's active types (upgrade or downgrade), for some or all of the
--    people on this year's memberships.
-- 5. No membership type needs admin approval any more, for new memberships or renewals.

-- A club year (1 January to 31 December), created if it doesn't exist yet.
create function ensure_club_year(p_year integer) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  yid uuid;
begin
  insert into club_years (label, starts_on, ends_on)
  values (p_year::text, make_date(p_year, 1, 1), make_date(p_year, 12, 31))
  on conflict do nothing;
  select id into yid from club_years where starts_on = make_date(p_year, 1, 1);
  return yid;
end $$;
revoke execute on function ensure_club_year(integer) from public, anon, authenticated;

-- No more approval: the setting goes, and anything waiting for approval now just waits for payment.
update memberships set status = 'awaiting_payment' where status = 'pending_approval';
alter table membership_types drop column requires_approval;

-- 1. Types belong to a club year.
alter table membership_types add column club_year_id uuid references club_years (id);
do $$
declare
  base uuid;
begin
  if exists (select 1 from membership_types) then
    base := coalesce((select id from club_years where current_date between starts_on and ends_on),
                     ensure_club_year(extract(year from current_date)::int));
    update membership_types set club_year_id = base;
  end if;
end $$;
alter table membership_types alter column club_year_id set not null;
alter table membership_types drop constraint membership_types_code_key;
alter table membership_types add constraint membership_types_year_code_key unique (club_year_id, code);
create index on membership_types (club_year_id);
comment on column membership_types.club_year_id is 'The club year this type is offered for. Each year has its own types and prices.';

-- Copy types from one club year into another, skipping codes the target year already has.
-- Optionally only some codes. Returns how many were copied. Not callable directly.
create function copy_types_into(p_from uuid, p_to uuid, p_codes text[] default null) returns integer
language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  with copied as (
    insert into membership_types (club_year_id, code, name, description, category, cover, annual_price_pence,
                                  max_age, requires_adult_member, sibling_order, is_open, sort_order)
    select p_to, t.code, t.name, t.description, t.category, t.cover, t.annual_price_pence,
           t.max_age, t.requires_adult_member, t.sibling_order, t.is_open, t.sort_order
      from membership_types t
     where t.club_year_id = p_from
       and (p_codes is null or t.code = any(p_codes))
       and not exists (select 1 from membership_types x where x.club_year_id = p_to and x.code = t.code)
    returning id, code
  ), activities as (
    insert into membership_type_activities (membership_type_id, activity_id)
    select c.id, a.activity_id
      from copied c
      join membership_types old on old.club_year_id = p_from and old.code = c.code
      join membership_type_activities a on a.membership_type_id = old.id
    returning 1
  )
  select count(*) into n from copied;
  return n;
end $$;
revoke execute on function copy_types_into(uuid, uuid, text[]) from public, anon, authenticated;

-- Memberships in other years (for example renewals already taken for next year) move onto that year's
-- copy of their type, so every membership's type matches its year.
do $$
declare
  r record;
begin
  for r in
    select distinct m.club_year_id as yr, t.club_year_id as from_yr, t.code
      from memberships m join membership_types t on t.id = m.membership_type_id
     where t.club_year_id <> m.club_year_id
  loop
    perform copy_types_into(r.from_yr, r.yr, array[r.code]);
    update memberships m set membership_type_id = x.id
      from membership_types old, membership_types x
     where old.id = m.membership_type_id and old.code = r.code and old.club_year_id = r.from_yr
       and m.club_year_id = r.yr and x.club_year_id = r.yr and x.code = r.code;
  end loop;
end $$;

-- From now on a membership's type must belong to the membership's year.
create function membership_type_matches_year() returns trigger
language plpgsql set search_path = public as $$
begin
  if not exists (select 1 from membership_types where id = new.membership_type_id and club_year_id = new.club_year_id) then
    raise exception 'That membership type isn''t for that club year';
  end if;
  return new;
end $$;
create trigger membership_type_year before insert or update of membership_type_id, club_year_id on memberships
  for each row execute function membership_type_matches_year();

-- 2. Admins set up next year's types by copying a year's types into the year after it.
create function copy_membership_types(p_from_year uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  yr club_years;
begin
  if not has_role('admin') then raise exception 'Only club admins can set up membership types'; end if;
  select * into yr from club_years where id = p_from_year;
  if not found then raise exception 'Unknown club year'; end if;
  return copy_types_into(yr.id, ensure_club_year(extract(year from yr.starts_on)::int + 1));
end $$;
revoke execute on function copy_membership_types(uuid) from public, anon;
grant execute on function copy_membership_types(uuid) to authenticated;

-- 3. Club years open right now: this year, plus next year once its renewal window opens
--    and it has at least one active membership type.
create or replace function open_club_years()
returns table (id uuid, label text, starts_on date, ends_on date, is_renewal boolean)
language sql stable security definer set search_path = public as $$
  select cy.id, cy.label, cy.starts_on, cy.ends_on, cy.starts_on > club_today()
    from club_years cy
   where club_today() between cy.starts_on - renewal_notice_days() and cy.ends_on
     and (cy.starts_on <= club_today() or exists (select 1 from membership_types t where t.club_year_id = cy.id and t.is_open))
     and current_person_id() is not null
   order by cy.starts_on
$$;

-- The membership rules, shared by members and admins. The type must be one of that year's active types.
-- p_approved is no longer used (nothing needs approval) but kept so existing callers still work.
create or replace function create_membership(p_payer uuid, p_type_id uuid, p_person_ids uuid[], p_club_year_id uuid,
                                             p_approved boolean)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  hh      uuid;
  mt      membership_types;
  yr      club_years;
  juniors int;
  q       record;
  new_id  uuid;
begin
  select * into yr from club_years where id = p_club_year_id;
  if not found then raise exception 'That club year is not open for membership yet'; end if;
  select * into mt from membership_types where id = p_type_id and is_open and club_year_id = yr.id;
  if not found then raise exception 'Membership type not available'; end if;
  if coalesce(cardinality(p_person_ids), 0) = 0 then raise exception 'Choose who the membership is for'; end if;

  select household_id into hh from people where id = p_payer;
  if exists (select 1 from unnest(p_person_ids) pid
             where pid <> p_payer and pid not in (select id from people where household_id = hh and hh is not null)) then
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

  -- Junior sibling pricing: count this year's junior memberships in the household, then use that year's J1, J2 or J3.
  if mt.sibling_order is not null then
    select count(*) into juniors
      from memberships m join membership_types t on t.id = m.membership_type_id
     where m.club_year_id = yr.id and m.household_id = hh and t.sibling_order is not null
       and m.status <> 'cancelled';
    select * into mt from membership_types
     where club_year_id = yr.id and cover = 'junior' and is_open and sibling_order <= least(juniors + 1, 3)
     order by sibling_order desc, sort_order limit 1;
    if not found then raise exception 'Junior membership not available'; end if;
  end if;

  if exists (
       select 1 from memberships m
       join membership_people mp on mp.membership_id = m.id
       join membership_types t on t.id = m.membership_type_id
       where m.club_year_id = yr.id and m.status <> 'cancelled' and mp.person_id = any(p_person_ids)
         and (t.id = mt.id or (t.category = 'sailing' and mt.category = 'sailing'))) then
    raise exception 'Someone already has this kind of membership for %', yr.label;
  end if;

  select * into q from membership_quote(mt.id, yr.id);

  insert into memberships (club_year_id, membership_type_id, payer_person_id, household_id,
                           status, price_pence, prorata_months)
  values (yr.id, mt.id, p_payer, hh, 'awaiting_payment', q.price_pence, q.months)
  returning id into new_id;

  insert into membership_people (membership_id, person_id)
  select new_id, unnest(p_person_ids);
  return new_id;
end $$;
revoke execute on function create_membership(uuid, uuid, uuid[], uuid, boolean) from public, anon, authenticated;

-- 4. Members renew for next year by choosing any of next year's active types, for some or all of the
--    people on this year's memberships (only the family's main contact, or the payer if not in a family).
--    Call it once per new membership. Adding people who weren't members this year is an admin job.
drop function renew_my_membership(uuid, uuid);
create function renew_my_membership(p_type_id uuid, p_person_ids uuid[], p_club_year_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me uuid := current_person_id();
  mt membership_types;
begin
  if me is null then raise exception 'Not logged in'; end if;
  if not exists (select 1 from open_club_years() o where o.id = p_club_year_id and o.is_renewal) then
    raise exception 'Renewals for that year are not open yet';
  end if;
  if coalesce(cardinality(p_person_ids), 0) = 0 then raise exception 'Choose who the membership is for'; end if;
  if exists (select 1 from people p join households h on h.id = p.household_id
              where p.id = me and h.lead_person_id is distinct from me) then
    raise exception 'Only your family''s main contact can renew';
  end if;
  -- Everyone must be on one of this year's memberships that I renew.
  if exists (
       select 1 from unnest(p_person_ids) pid
        where not exists (
          select 1 from memberships m
            join membership_people mp on mp.membership_id = m.id
            join club_years cy on cy.id = m.club_year_id
            join club_years nx on nx.id = p_club_year_id
            join people p on p.id = mp.person_id and p.archived_at is null
           where mp.person_id = pid
             and m.status in ('active', 'awaiting_payment')
             and club_today() between cy.starts_on and cy.ends_on and cy.ends_on < nx.starts_on
             and (m.payer_person_id = me or (m.household_id is not null and is_household_lead(m.household_id))))) then
    raise exception 'Only people on this year''s memberships can be renewed';
  end if;
  select * into mt from membership_types where id = p_type_id;
  if mt.cover = 'family' and cardinality(p_person_ids) > 4 then
    raise exception '% covers up to 4 people', mt.name;
  end if;
  return create_membership(me, p_type_id, p_person_ids, p_club_year_id, false);
end $$;
revoke execute on function renew_my_membership(uuid, uuid[], uuid) from public, anon;
grant execute on function renew_my_membership(uuid, uuid[], uuid) to authenticated;

-- The Join page offers each open year's own types.
create or replace function join_options()
returns table (type_id uuid, type_name text, description text, cover membership_cover, category membership_category,
               club_year_id uuid, club_year text, is_next_year boolean, price_pence int, months int)
language sql stable security definer set search_path = public as $$
  select t.id, t.name, t.description, t.cover, t.category, cy.id, cy.label, cy.starts_on > club_today(), q.price_pence, q.months
    from membership_types t
    join club_years cy on cy.id = t.club_year_id
    cross join lateral membership_quote(t.id, cy.id) q
   where t.is_open and t.cover <> 'junior'
     and club_today() between cy.starts_on - renewal_notice_days() and cy.ends_on
   order by cy.starts_on, t.sort_order
$$;

-- Renewal reminders: the price shown is next year's price for the same type where there is one.
create or replace function renewal_reminder_recipients(p_club_year_id uuid)
returns table (person_id uuid, first_name text, last_name text, email text, membership_types text,
               renewal_price_pence integer, last_reminded_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not has_role('admin') then raise exception 'Admins only'; end if;
  return query
  with next_year as (
    select cy.id, cy.starts_on from club_years cy where cy.id = p_club_year_id
  ), this_year as (
    select cy.id from club_years cy, next_year n
     where cy.ends_on < n.starts_on order by cy.ends_on desc limit 1
  ), covered as (
    select mp.person_id from membership_people mp join memberships m on m.id = mp.membership_id
     where m.club_year_id = p_club_year_id and m.status <> 'cancelled'
  ), due as (
    select m.id, m.membership_type_id,
           coalesce(h.lead_person_id, m.payer_person_id) as renewer
      from memberships m
      join this_year ty on ty.id = m.club_year_id
      left join households h on h.id = m.household_id
     where m.status in ('active', 'awaiting_payment')
       and exists (select 1 from membership_people mp join people p on p.id = mp.person_id
                    where mp.membership_id = m.id and p.archived_at is null
                      and mp.person_id not in (select c.person_id from covered c))
  )
  select p.id, p.first_name, p.last_name, p.email,
         string_agg(t.name, ', ' order by t.sort_order),
         sum(coalesce(nt.annual_price_pence, t.annual_price_pence))::int,
         (select max(r.sent_at) from email_recipients r join email_campaigns c on c.id = r.campaign_id
           where r.person_id = p.id and r.status = 'sent' and c.purpose = 'renewal_reminder'
             and c.club_year_id = p_club_year_id)
    from due d
    join people p on p.id = d.renewer and p.archived_at is null
    join membership_types t on t.id = d.membership_type_id
    left join membership_types nt on nt.club_year_id = p_club_year_id and nt.code = t.code
   group by p.id, p.first_name, p.last_name, p.email
   order by p.last_name, p.first_name;
end $$;

-- The spreadsheet import uses the chosen year's types.
create or replace function import_members(p_rows jsonb, p_club_year_id uuid, p_mark_paid boolean default true)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r         jsonb;
  hh_key    text;
  hh_id     uuid;
  person    uuid;
  t_id      uuid;
  t_code    text;
  t_price   integer;
  m_id      uuid;
  households_made int := 0;
  people_made     int := 0;
  people_skipped  int := 0;
  memberships_made int := 0;
  bad text;
begin
  if not has_role('admin') then raise exception 'Admins only'; end if;
  if not exists (select 1 from club_years where id = p_club_year_id) then raise exception 'Unknown club year'; end if;

  select string_agg(distinct coalesce(x->>'member_class', '(blank)'), ', ') into bad
    from jsonb_array_elements(p_rows) x
   where not exists (select 1 from membership_types t where t.code = upper(x->>'member_class') and t.club_year_id = p_club_year_id);
  if bad is not null then raise exception 'Unknown member class: %', bad; end if;

  drop table if exists pg_temp.import_people;
  create temp table import_people (household_key text, person_id uuid, code text, is_new boolean) on commit drop;

  for r in select * from jsonb_array_elements(p_rows) loop
    select p.id into person from people p
     where (lower(p.first_name) = lower(r->>'first_name') and lower(p.last_name) = lower(r->>'last_name')
            and p.date_of_birth is not distinct from (r->>'date_of_birth')::date)
        or (nullif(r->>'email', '') is not null and lower(p.email) = lower(r->>'email')
            and lower(p.first_name) = lower(r->>'first_name'))
     limit 1;
    if found then
      people_skipped := people_skipped + 1;
      insert into import_people values (r->>'household_key', person, upper(r->>'member_class'), false);
      continue;
    end if;

    hh_key := r->>'household_key';
    select ip_hh.household_id into hh_id
      from import_people ip join people ip_hh on ip_hh.id = ip.person_id
     where ip.household_key = hh_key and ip_hh.household_id is not null limit 1;
    if hh_id is null then
      insert into households (address_line1, address_line2, address_line3, address_line4, postcode)
      values (nullif(r->>'address_line1', ''), nullif(r->>'address_line2', ''), nullif(r->>'address_line3', ''),
              nullif(r->>'address_line4', ''), nullif(upper(r->>'postcode'), ''))
      returning id into hh_id;
      households_made := households_made + 1;
    end if;

    insert into people (household_id, title, first_name, last_name, date_of_birth, email, mobile, whatsapp,
                        emergency_contact_name, emergency_contact_mobile)
    values (hh_id, nullif(r->>'title', ''), r->>'first_name', r->>'last_name', (r->>'date_of_birth')::date,
            nullif(lower(r->>'email'), ''), nullif(r->>'mobile', ''), coalesce((r->>'whatsapp')::boolean, false),
            nullif(r->>'emergency_contact_name', ''), nullif(r->>'emergency_contact_mobile', ''))
    returning id into person;
    people_made := people_made + 1;
    insert into import_people values (hh_key, person, upper(r->>'member_class'), true);
  end loop;

  -- Main contact: oldest adult in each new family (people with no date of birth count as adults).
  update households h set lead_person_id = (
           select p.id from people p where p.household_id = h.id
            order by coalesce(p.date_of_birth > current_date - interval '18 years', false), p.date_of_birth nulls last limit 1)
   where h.lead_person_id is null
     and h.id in (select p.household_id from import_people ip join people p on p.id = ip.person_id where ip.is_new);

  -- Memberships for new people only, so a re-run doesn't double up.
  for hh_key, t_id, t_code, t_price in
    select distinct ip.household_key, t.id, t.code, t.annual_price_pence
      from import_people ip join membership_types t on t.code = ip.code and t.club_year_id = p_club_year_id
     where ip.is_new and t.cover in ('family', 'dual')
  loop
    insert into memberships (club_year_id, membership_type_id, payer_person_id, household_id, status, price_pence)
    select p_club_year_id, t_id, min(ip.person_id::text)::uuid, min(p.household_id::text)::uuid,
           case when p_mark_paid then 'active' else 'awaiting_payment' end::membership_status, t_price
      from import_people ip join people p on p.id = ip.person_id
     where ip.household_key = hh_key and ip.code = t_code and ip.is_new
    returning id into m_id;
    insert into membership_people (membership_id, person_id)
    select m_id, person_id from import_people where household_key = hh_key and code = t_code and is_new;
    update memberships m set payer_person_id = h.lead_person_id
      from households h where m.id = m_id and h.id = m.household_id and h.lead_person_id is not null;
    memberships_made := memberships_made + 1;
  end loop;

  for person, t_id, t_price in
    select ip.person_id, t.id, t.annual_price_pence from import_people ip join membership_types t on t.code = ip.code and t.club_year_id = p_club_year_id
     where ip.is_new and t.cover not in ('family', 'dual')
  loop
    insert into memberships (club_year_id, membership_type_id, payer_person_id, household_id, status, price_pence)
    select p_club_year_id, t_id, coalesce(h.lead_person_id, p.id), p.household_id,
           case when p_mark_paid then 'active' else 'awaiting_payment' end::membership_status, t_price
      from people p left join households h on h.id = p.household_id where p.id = person
    returning id into m_id;
    insert into membership_people values (m_id, person);
    memberships_made := memberships_made + 1;
  end loop;

  return jsonb_build_object('households', households_made, 'people', people_made,
                            'skipped', people_skipped, 'memberships', memberships_made);
end $$;

revoke execute on function import_members(jsonb, uuid, boolean) from public, anon;
grant execute on function import_members(jsonb, uuid, boolean) to authenticated;
