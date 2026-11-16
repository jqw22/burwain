-- Bug fixes after the first real import (2026-11-16).
--
-- 1. The import now reads an optional "First Joined" column (a date or a year).
--    Uploading the same spreadsheet again fills in first joined dates that are still
--    blank for people already in the app, without adding anyone twice.
-- 2. WhatsApp can't be "yes" without a mobile number. Existing rows are tidied up.
-- 3. Club news by email now starts as "yes" for new people.

-- 2. WhatsApp needs a mobile number. (Also time-stamps club news consent on new
--    people, now that it starts as yes.)
create or replace function people_whatsapp_needs_mobile()
returns trigger language plpgsql as $$
begin
  if nullif(btrim(coalesce(new.mobile, '')), '') is null then new.whatsapp := false; end if;
  if tg_op = 'INSERT' and new.news_consent and new.news_consent_at is null then new.news_consent_at := now(); end if;
  return new;
end $$;

drop trigger if exists people_whatsapp_needs_mobile on people;
create trigger people_whatsapp_needs_mobile before insert or update of mobile, whatsapp on people
  for each row execute function people_whatsapp_needs_mobile();

update people set whatsapp = false where whatsapp and nullif(btrim(coalesce(mobile, '')), '') is null;

-- 3. Club news defaults to yes.
alter table people alter column news_consent set default true;

-- 1. Import reads first joined.
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
  joined_filled   int := 0;
  joined          date;
  bad text;
begin
  if not has_role('admin') then raise exception 'Admins only'; end if;
  if not exists (select 1 from club_years where id = p_club_year_id) then raise exception 'Unknown club year'; end if;

  -- Each member class is the type with that code starting in the chosen year (the earliest, if several).
  drop table if exists pg_temp.import_types;
  create temp table import_types on commit drop as
  select distinct on (t.code) t.code, t.id
    from membership_types t, club_years cy
   where cy.id = p_club_year_id and extract(year from t.starts_on) = extract(year from cy.starts_on)
   order by t.code, t.starts_on;

  select string_agg(distinct coalesce(x->>'member_class', '(blank)'), ', ') into bad
    from jsonb_array_elements(p_rows) x
   where not exists (select 1 from import_types it where it.code = upper(x->>'member_class'));
  if bad is not null then raise exception 'Unknown member class: %', bad; end if;

  drop table if exists pg_temp.import_people;
  create temp table import_people (household_key text, person_id uuid, code text, is_new boolean) on commit drop;

  for r in select * from jsonb_array_elements(p_rows) loop
    joined := nullif(r->>'first_joined_on', '')::date;
    select p.id into person from people p
     where (lower(p.first_name) = lower(r->>'first_name') and lower(p.last_name) = lower(r->>'last_name')
            and p.date_of_birth is not distinct from (r->>'date_of_birth')::date)
        or (nullif(r->>'email', '') is not null and lower(p.email) = lower(r->>'email')
            and lower(p.first_name) = lower(r->>'first_name'))
     limit 1;
    if found and (exists (select 1 from people p where p.id = person and p.household_id is not null)
                  or exists (select 1 from membership_people mp join memberships m on m.id = mp.membership_id
                              where mp.person_id = person and m.status <> 'cancelled')) then
      people_skipped := people_skipped + 1;
      -- Fill in a blank first joined date, so the spreadsheet can be uploaded again just for that.
      update people set first_joined_on = joined where id = person and first_joined_on is null and joined is not null;
      if found then joined_filled := joined_filled + 1; end if;
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

    if person is not null then
      -- Already in the app with no family or membership: join this family.
      update people set household_id = hh_id, first_joined_on = coalesce(first_joined_on, joined) where id = person;
      people_made := people_made + 1;
      insert into import_people values (hh_key, person, upper(r->>'member_class'), true);
      continue;
    end if;

    insert into people (household_id, title, first_name, last_name, date_of_birth, email, mobile, whatsapp,
                        emergency_contact_name, emergency_contact_mobile, first_joined_on, news_consent, news_consent_at)
    values (hh_id, nullif(r->>'title', ''), r->>'first_name', r->>'last_name', (r->>'date_of_birth')::date,
            nullif(lower(r->>'email'), ''), nullif(r->>'mobile', ''), coalesce((r->>'whatsapp')::boolean, false),
            nullif(r->>'emergency_contact_name', ''), nullif(r->>'emergency_contact_mobile', ''), joined, true, now())
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
      from import_people ip join import_types it on it.code = ip.code join membership_types t on t.id = it.id
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
    select ip.person_id, t.id, t.annual_price_pence from import_people ip join import_types it on it.code = ip.code join membership_types t on t.id = it.id
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
                            'skipped', people_skipped, 'memberships', memberships_made,
                            'joined_filled', joined_filled);
end $$;
