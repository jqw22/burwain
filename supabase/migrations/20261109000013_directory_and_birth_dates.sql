-- The directory lists people with a membership for this club year or a later one, so someone who
-- joins for next year (for example while renewals are open in November) is listed straight away.
create or replace function member_directory()
returns table (id uuid, first_name text, last_name text, mobile text, email text, membership text)
language sql stable security definer set search_path = public as $$
  select p.id, p.first_name, p.last_name, p.mobile, p.email,
         string_agg(distinct t.name, ', ')
    from people p
    join membership_people mp on mp.person_id = p.id
    join memberships m on m.id = mp.membership_id
    join membership_types t on t.id = m.membership_type_id
    join club_years cy on cy.id = m.club_year_id
   where cy.ends_on >= club_today()
     and m.status in ('active', 'awaiting_payment')
     and not p.directory_opt_out
     and p.archived_at is null
     and p.date_of_birth <= current_date - interval '18 years'   -- adults only (safeguarding)
     and current_person_id() is not null
   group by p.id
   order by p.last_name, p.first_name
$$;

-- Date of birth is required for everyone added, from Add new member or the public Join page (James, 2026-11-09).
-- It keeps the directory's adults-only check certain and is needed for age limits and junior prices.
create or replace function admin_insert_person(hh uuid, x jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  new_id uuid;
  q      jsonb;
begin
  if coalesce(trim(x->>'first_name'), '') = '' or coalesce(trim(x->>'last_name'), '') = '' then
    raise exception 'First and last name are needed for everyone';
  end if;
  if nullif(x->>'date_of_birth', '') is null then
    raise exception 'Date of birth is needed for everyone';
  end if;
  if (x->>'date_of_birth')::date > current_date then
    raise exception 'Date of birth can''t be in the future';
  end if;
  if nullif(trim(x->>'email'), '') is not null and exists (
       select 1 from people where lower(email) = lower(trim(x->>'email')) and archived_at is null) then
    raise exception 'Someone already uses that email (%)', lower(trim(x->>'email'));
  end if;
  if nullif(trim(x->>'medical_details'), '') is not null and not coalesce((x->>'medical_consent')::boolean, false) then
    raise exception 'Medical information needs the member''s consent';
  end if;

  insert into people (household_id, title, first_name, last_name, date_of_birth, email, mobile, whatsapp,
                      emergency_contact_name, emergency_contact_mobile, first_joined_on,
                      news_consent, news_consent_at, directory_opt_out)
  values (hh, nullif(trim(x->>'title'), ''), trim(x->>'first_name'), trim(x->>'last_name'),
          nullif(x->>'date_of_birth', '')::date, lower(nullif(trim(x->>'email'), '')),
          nullif(trim(x->>'mobile'), ''), coalesce((x->>'whatsapp')::boolean, false),
          nullif(trim(x->>'emergency_contact_name'), ''), nullif(trim(x->>'emergency_contact_mobile'), ''),
          club_today(),
          coalesce((x->>'news_consent')::boolean, false),
          case when coalesce((x->>'news_consent')::boolean, false) then now() end,
          coalesce((x->>'directory_opt_out')::boolean, false))
  returning id into new_id;

  if nullif(trim(x->>'medical_details'), '') is not null then
    insert into medical_records (person_id, details, consent_given_at, updated_by)
    values (new_id, trim(x->>'medical_details'), now(), current_person_id());
  end if;

  for q in select * from jsonb_array_elements(coalesce(x->'qualifications', '[]'::jsonb)) loop
    if nullif(trim(q->>'name'), '') is not null then
      insert into qualifications (person_id, name, awarded_on, expires_on)
      values (new_id, trim(q->>'name'), nullif(q->>'awarded_on', '')::date, nullif(q->>'expires_on', '')::date);
    end if;
  end loop;
  return new_id;
end $$;
create or replace function submit_application(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  folk   jsonb := coalesce(p->'people', '[]'::jsonb);
  n      int := jsonb_array_length(coalesce(p->'people', '[]'::jsonb));
  mt     membership_types;
  quote  record;
  v_email text := lower(nullif(trim(p->'people'->0->>'email'), ''));
  x      jsonb;
  new_id uuid;
begin
  -- A simple brake on floods of submissions from bots.
  if (select count(*) from membership_applications where created_at > now() - interval '1 hour') >= 30 then
    raise exception 'Too many applications right now, please try again later';
  end if;
  select t.* into mt from membership_types t
   where t.id = nullif(p->>'type_id', '')::uuid and t.is_open and t.cover <> 'junior';
  if not found then raise exception 'Membership type not available'; end if;
  if not exists (select 1 from join_options() o where o.type_id = mt.id and o.club_year_id = nullif(p->>'club_year_id', '')::uuid) then
    raise exception 'That club year is not open for membership yet';
  end if;
  if n = 0 or n > 4 then raise exception 'Up to 4 people can be added at once'; end if;
  if mt.cover = 'individual' and n <> 1 then raise exception '% covers exactly one person', mt.name; end if;
  if mt.cover = 'dual' and n <> 2 then raise exception '% covers exactly two adults', mt.name; end if;
  if coalesce(trim(p->>'address_line1'), '') = '' or coalesce(trim(p->>'postcode'), '') = '' then
    raise exception 'A new family needs address line 1 and a postcode';
  end if;
  if v_email is null then raise exception 'An email address is needed for the first person'; end if;
  if exists (select 1 from people where lower(people.email) = v_email and archived_at is null) then
    raise exception 'Someone already uses that email (%)', v_email;
  end if;
  if exists (select 1 from membership_applications a where lower(a.contact_email) = v_email and a.status = 'pending') then
    raise exception 'There is already an application waiting for that email';
  end if;
  for x in select * from jsonb_array_elements(folk) loop
    if coalesce(trim(x->>'first_name'), '') = '' or coalesce(trim(x->>'last_name'), '') = '' then
      raise exception 'First and last name are needed for everyone';
    end if;
    if nullif(x->>'date_of_birth', '') is null then
      raise exception 'Date of birth is needed for everyone';
    end if;
    if (x->>'date_of_birth')::date > current_date then
      raise exception 'Date of birth can''t be in the future';
    end if;
    if nullif(trim(x->>'medical_details'), '') is not null and not coalesce((x->>'medical_consent')::boolean, false) then
      raise exception 'Medical information needs the member''s consent';
    end if;
    if mt.max_age is not null and (nullif(x->>'date_of_birth', '') is null or date_part('year',
         age((select starts_on from club_years where id = (p->>'club_year_id')::uuid), (x->>'date_of_birth')::date)) > mt.max_age) then
      raise exception 'Someone is over the age limit for % (date of birth needed)', mt.name;
    end if;
  end loop;
  select * into quote from membership_quote(mt.id, (p->>'club_year_id')::uuid);

  insert into membership_applications (contact_name, contact_email, type_name, people_count, price_pence, data)
  values (trim(folk->0->>'first_name') || ' ' || trim(folk->0->>'last_name'), v_email, mt.name, n, quote.price_pence,
          -- Only the fields Add new member uses. No payment or existing family can be set from outside.
          jsonb_build_object('type_id', mt.id, 'club_year_id', p->>'club_year_id',
                             'address_line1', p->>'address_line1', 'address_line2', p->>'address_line2',
                             'address_line3', p->>'address_line3', 'address_line4', p->>'address_line4',
                             'postcode', p->>'postcode', 'people', folk))
  returning id into new_id;
  return new_id;
end $$;
