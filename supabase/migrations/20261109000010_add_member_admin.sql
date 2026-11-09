-- Adding new members and renewing are now separate.
-- Members renew from Your details; adding a new person to the club is an admin job.
-- 1. create_membership(): the membership rules, shared by members and admins (not callable directly).
-- 2. start_membership(): unchanged for members, now built on create_membership().
-- 3. admin_add_member(): an admin adds a new person, puts them in a new or existing family,
--    and optionally gives them a membership and records a cash, cheque or bank transfer payment.

create function create_membership(p_payer uuid, p_type_id uuid, p_person_ids uuid[], p_club_year_id uuid,
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
  select * into mt from membership_types where id = p_type_id and is_open;
  if not found then raise exception 'Membership type not available'; end if;
  select * into yr from club_years where id = p_club_year_id;
  if not found then raise exception 'That club year is not open for membership yet'; end if;
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

  -- Junior sibling pricing: count this year's junior memberships in the household.
  if mt.sibling_order is not null then
    select count(*) into juniors
      from memberships m join membership_types t on t.id = m.membership_type_id
     where m.club_year_id = yr.id and m.household_id = hh and t.sibling_order is not null
       and m.status <> 'cancelled';
    select * into mt from membership_types
     where sibling_order = least(juniors + 1, 3) and cover = 'junior' and is_open
     order by sort_order limit 1;
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
  values (yr.id, mt.id, p_payer, hh,
          case when mt.requires_approval and not p_approved then 'pending_approval'
               else 'awaiting_payment' end::membership_status,
          q.price_pence, q.months)
  returning id into new_id;

  insert into membership_people (membership_id, person_id)
  select new_id, unnest(p_person_ids);
  return new_id;
end $$;
revoke execute on function create_membership(uuid, uuid, uuid[], uuid, boolean) from public, anon, authenticated;

create or replace function start_membership(p_type_id uuid, p_person_ids uuid[], p_club_year_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me uuid := current_person_id();
begin
  if me is null then raise exception 'Not logged in'; end if;
  if not exists (select 1 from open_club_years() where id = p_club_year_id) then
    raise exception 'That club year is not open for membership yet';
  end if;
  return create_membership(me, p_type_id, p_person_ids, p_club_year_id, false);
end $$;

create function admin_add_member(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  hh      uuid := nullif(p->>'household_id', '')::uuid;
  type_id uuid := nullif(p->>'type_id', '')::uuid;
  year_id uuid := nullif(p->>'club_year_id', '')::uuid;
  method  text := nullif(p->>'payment_method', '');
  new_id  uuid;
  lead    uuid;
  payer   uuid;
  people_covered uuid[];
  mid     uuid;
  mt      membership_types;
begin
  if not has_role('admin') then raise exception 'Only an admin can add new members'; end if;
  if coalesce(trim(p->>'first_name'), '') = '' or coalesce(trim(p->>'last_name'), '') = '' then
    raise exception 'First and last name are needed';
  end if;
  if hh is not null then
    select lead_person_id into lead from households where id = hh;
    if not found then raise exception 'That family could not be found'; end if;
  elsif coalesce(trim(p->>'address_line1'), '') = '' or coalesce(trim(p->>'postcode'), '') = '' then
    raise exception 'A new family needs address line 1 and a postcode';
  end if;
  if nullif(trim(p->>'email'), '') is not null and exists (
       select 1 from people where lower(email) = lower(trim(p->>'email')) and archived_at is null) then
    raise exception 'Someone already uses that email';
  end if;

  if hh is null then
    insert into households (address_line1, address_line2, address_line3, address_line4, postcode)
    values (trim(p->>'address_line1'), nullif(trim(p->>'address_line2'), ''), nullif(trim(p->>'address_line3'), ''),
            nullif(trim(p->>'address_line4'), ''), upper(trim(p->>'postcode')))
    returning id into hh;
  end if;

  insert into people (household_id, title, first_name, last_name, date_of_birth, email, mobile, whatsapp,
                      emergency_contact_name, emergency_contact_mobile, first_joined_on)
  values (hh, nullif(trim(p->>'title'), ''), trim(p->>'first_name'), trim(p->>'last_name'),
          nullif(p->>'date_of_birth', '')::date, lower(nullif(trim(p->>'email'), '')),
          nullif(trim(p->>'mobile'), ''), coalesce((p->>'whatsapp')::boolean, false),
          nullif(trim(p->>'emergency_contact_name'), ''), nullif(trim(p->>'emergency_contact_mobile'), ''),
          club_today())
  returning id into new_id;

  if lead is null then
    update households set lead_person_id = new_id where id = hh and lead_person_id is null;
  end if;

  if type_id is not null then
    if not exists (select 1 from club_years
                    where id = year_id and club_today() between starts_on - renewal_notice_days() and ends_on) then
      raise exception 'That club year is not open for membership yet';
    end if;
    select * into mt from membership_types where id = type_id;
    payer := coalesce(lead, new_id);
    people_covered := case when mt.cover = 'dual' and lead is not null then array[lead, new_id]
                           else array[new_id] end;
    -- They're getting their own membership, so take them off any Family membership they were added to just now.
    delete from membership_people mp using memberships m
     where mp.membership_id = m.id and mp.person_id = new_id and m.club_year_id = year_id;
    mid := create_membership(payer, type_id, people_covered, year_id, true);
    if method is not null then
      perform record_manual_payment(array[mid], method::payment_method, coalesce(nullif(p->>'paid_on', '')::date, current_date));
    end if;
  end if;
  return new_id;
end $$;
revoke execute on function admin_add_member(jsonb) from public, anon;
grant execute on function admin_add_member(jsonb) to authenticated;
