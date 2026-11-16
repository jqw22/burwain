-- Fixes from the code review (2026-11-16).

-- 1. Join form: the same neutral message whether the email belongs to a member or already has an
--    application waiting, so the form can't be used to find out who is a member.
create or replace function public.submit_application(p jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  folk   jsonb := coalesce(p->'people', '[]'::jsonb);
  n      int := jsonb_array_length(coalesce(p->'people', '[]'::jsonb));
  mt     membership_types;
  quote  record;
  v_email text := lower(nullif(trim(p->'people'->0->>'email'), ''));
  x      jsonb;
  new_id uuid;
begin
  if (select count(*) from membership_applications where created_at > now() - interval '1 hour') >= 30 then
    raise exception 'Too many applications right now, please try again later';
  end if;
  select t.* into mt from membership_types t
   where t.id = nullif(p->>'type_id', '')::uuid and t.id in (select o.type_id from join_options() o);
  if not found then raise exception 'Membership type not available'; end if;
  if n = 0 or n > 4 then raise exception 'Up to 4 people can be added at once'; end if;
  if mt.cover = 'individual' and n <> 1 then raise exception '% covers exactly one person', mt.name; end if;
  if mt.cover = 'dual' and n <> 2 then raise exception '% covers exactly two adults', mt.name; end if;
  if coalesce(trim(p->>'address_line1'), '') = '' or coalesce(trim(p->>'postcode'), '') = '' then
    raise exception 'A new family needs address line 1 and a postcode';
  end if;
  if v_email is null then raise exception 'An email address is needed for the first person'; end if;
  if exists (select 1 from people where lower(people.email) = v_email and archived_at is null) then
    raise exception 'We can''t take a new application with that email address';
  end if;
  if exists (select 1 from membership_applications a where lower(a.contact_email) = v_email and a.status = 'pending') then
    raise exception 'We can''t take a new application with that email address';
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
    if mt.max_age is not null and date_part('year', age(mt.starts_on, (x->>'date_of_birth')::date)) > mt.max_age then
      raise exception 'Someone is over the age limit for % (date of birth needed)', mt.name;
    end if;
  end loop;
  select * into quote from membership_quote(mt.id);
  perform check_boats(coalesce(p->'boats', '[]'::jsonb), 0);

  insert into membership_applications (contact_name, contact_email, type_name, people_count, price_pence, boats_pence, data)
  values (trim(folk->0->>'first_name') || ' ' || trim(folk->0->>'last_name'), v_email, mt.name, n, quote.price_pence,
          jsonb_array_length(coalesce(p->'boats', '[]'::jsonb)) * boat_storage_price(true),
          -- Only the fields Add new member uses. No payment or existing family can be set from outside.
          jsonb_build_object('type_id', mt.id,
                             'address_line1', p->>'address_line1', 'address_line2', p->>'address_line2',
                             'address_line3', p->>'address_line3', 'address_line4', p->>'address_line4',
                             'postcode', p->>'postcode', 'people', folk,
                             'boats', coalesce(p->'boats', '[]'::jsonb)))
  returning id into new_id;
  return new_id;
end $function$

;

-- 2. Applications (which can hold medical details) are read only through pending_applications(),
--    which shows whether medical information was given but never the details themselves.
drop policy if exists applications_admin_read on membership_applications;

-- 3. Only admins add people. Family main contacts no longer can (adding people is admin-only).
drop policy if exists people_insert on people;
create policy people_insert on people for insert to authenticated
  with check (has_role('admin'));

-- 4. Fixed search path on the small helper functions (Supabase security advisor warning).
alter function club_today() set search_path = public;
alter function periods_overlap(membership_types, membership_types) set search_path = public;
alter function check_boats(jsonb, integer) set search_path = public;
alter function people_whatsapp_needs_mobile() set search_path = public;
