-- One-off import of the member spreadsheet (admins only).
-- The app reads the spreadsheet and sends one JSON object per row, with these keys:
--   household_key, first_name, last_name, title, date_of_birth (YYYY-MM-DD or null), email, mobile,
--   whatsapp (true/false), emergency_contact_name, emergency_contact_mobile,
--   address_line1..4, postcode, member_class (a membership type code such as IS, F, J1)
-- Rows with the same household_key become one family; the oldest adult is the main contact.
-- Family and Dual memberships cover everyone in the family with that class; other types are one per person.
-- People already in the database (same name and date of birth, or same email) are skipped, so a re-run is safe.

create function import_members(p_rows jsonb, p_club_year_id uuid, p_mark_paid boolean default true)
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
   where not exists (select 1 from membership_types t where t.code = upper(x->>'member_class'));
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
      from import_people ip join membership_types t on t.code = ip.code
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
    select ip.person_id, t.id, t.annual_price_pence from import_people ip join membership_types t on t.code = ip.code
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
