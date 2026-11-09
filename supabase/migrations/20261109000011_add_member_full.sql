-- Change list 4.
-- 1. admin_add_member() takes everyone a membership covers in one go (Dual = 2 people, Family = up to 4),
--    with each person's medical information, qualifications and preferences.
-- 2. admin_save_medical(): admins add or change someone's medical information.

-- Add one person with everything collected on the Add new member form. Not callable directly.
create function admin_insert_person(hh uuid, x jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  new_id uuid;
  q      jsonb;
begin
  if coalesce(trim(x->>'first_name'), '') = '' or coalesce(trim(x->>'last_name'), '') = '' then
    raise exception 'First and last name are needed for everyone';
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
revoke execute on function admin_insert_person(uuid, jsonb) from public, anon, authenticated;

drop function admin_add_member(jsonb);

-- p: household_id (existing family) or address fields (new family), type_id, club_year_id,
--    payment_method, paid_on, and people: [{person fields, medical_details, medical_consent,
--    news_consent, directory_opt_out, qualifications: [{name, awarded_on, expires_on}]}].
-- The first person is the new family's main contact. Returns the first person's id.
create function admin_add_member(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  hh      uuid := nullif(p->>'household_id', '')::uuid;
  type_id uuid := nullif(p->>'type_id', '')::uuid;
  year_id uuid := nullif(p->>'club_year_id', '')::uuid;
  method  text := nullif(p->>'payment_method', '');
  folk    jsonb := coalesce(p->'people', '[]'::jsonb);
  n       int;
  ids     uuid[] := '{}';
  lead    uuid;
  covered uuid[];
  mid     uuid;
  mt      membership_types;
  x       jsonb;
begin
  if not has_role('admin') then raise exception 'Only an admin can add new members'; end if;
  n := jsonb_array_length(folk);
  if n = 0 then raise exception 'First and last name are needed for everyone'; end if;
  if n > 4 then raise exception 'Up to 4 people can be added at once'; end if;
  if hh is not null then
    select lead_person_id into lead from households where id = hh;
    if not found then raise exception 'That family could not be found'; end if;
  elsif coalesce(trim(p->>'address_line1'), '') = '' or coalesce(trim(p->>'postcode'), '') = '' then
    raise exception 'A new family needs address line 1 and a postcode';
  end if;

  if type_id is not null then
    select * into mt from membership_types where id = type_id;
    if mt.cover in ('individual', 'junior') and n > 1 then
      raise exception '% covers exactly one person', mt.name;
    end if;
    if mt.cover = 'dual' and not (n = 2 or (n = 1 and lead is not null)) then
      raise exception '% covers exactly two adults', mt.name;
    end if;
  elsif n > 1 then
    raise exception 'Choose a Dual or Family membership to add more than one person';
  end if;

  if hh is null then
    insert into households (address_line1, address_line2, address_line3, address_line4, postcode)
    values (trim(p->>'address_line1'), nullif(trim(p->>'address_line2'), ''), nullif(trim(p->>'address_line3'), ''),
            nullif(trim(p->>'address_line4'), ''), upper(trim(p->>'postcode')))
    returning id into hh;
  end if;

  for x in select * from jsonb_array_elements(folk) loop
    ids := ids || admin_insert_person(hh, x);
  end loop;

  if lead is null then
    update households set lead_person_id = ids[1] where id = hh and lead_person_id is null;
  end if;

  if type_id is not null then
    if not exists (select 1 from club_years
                    where id = year_id and club_today() between starts_on - renewal_notice_days() and ends_on) then
      raise exception 'That club year is not open for membership yet';
    end if;
    covered := case when mt.cover = 'dual' and n = 1 then array[lead, ids[1]] else ids end;
    -- They're getting their own membership, so take them off any Family membership they were added to just now.
    delete from membership_people mp using memberships m
     where mp.membership_id = m.id and mp.person_id = any(ids) and m.club_year_id = year_id;
    mid := create_membership(coalesce(lead, ids[1]), type_id, covered, year_id, true);
    if method is not null then
      perform record_manual_payment(array[mid], method::payment_method, coalesce(nullif(p->>'paid_on', '')::date, current_date));
    end if;
  end if;
  return ids[1];
end $$;
revoke execute on function admin_add_member(jsonb) from public, anon;
grant execute on function admin_add_member(jsonb) to authenticated;

-- Admins add or change someone's medical information. Opening it to edit is a logged view
-- (get_medical_record), and the change records who made it.
create function admin_save_medical(p_person uuid, p_details text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_role('admin') then raise exception 'Only an admin can change someone else''s medical information'; end if;
  insert into medical_records (person_id, details, consent_given_at, updated_at, updated_by)
  values (p_person, nullif(trim(p_details), ''), now(), now(), current_person_id())
  on conflict (person_id) do update
    set details = excluded.details, updated_at = now(), updated_by = current_person_id();
end $$;
revoke execute on function admin_save_medical(uuid, text) from public, anon;
grant execute on function admin_save_medical(uuid, text) to authenticated;
