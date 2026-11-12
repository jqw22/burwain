-- Membership types no longer belong to a club year (James, 2026-11-12).
-- A type is just a name, price, start date and end date, so it can run for any period (for example June to March).
-- 1. The year link on types goes. Codes only need to be unique for types starting on the same day.
-- 2. A membership runs for its type's dates: active between them, future before, ended after.
--    Each membership still shows the year it starts in (for totals and history). That label is filled in
--    automatically from the type's start date; nobody chooses a year any more.
-- 3. Admins copy a type to make a new one with the dates a year later.
-- 4. Renewing opens 60 days before a membership ends, until its end date. Members choose any active type
--    that starts after today. Renewal reminders follow the same rule.
-- 5. Join shows active types from 60 days before they start until they end, priced on the months left.

-- 1. Types stand alone.
drop trigger membership_type_dates on membership_types;
drop trigger membership_type_year on memberships;
drop function membership_type_matches_year();
alter table membership_types drop column club_year_id;   -- also drops the (club year, code) uniqueness
alter table membership_types add constraint membership_types_code_starts_key unique (code, starts_on);

create or replace function membership_type_dates() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.starts_on is null then raise exception 'A membership type needs a start date'; end if;
  if new.ends_on is null then new.ends_on := (new.starts_on + interval '1 year' - interval '1 day')::date; end if;
  return new;
end $$;
create trigger membership_type_dates before insert or update of starts_on, ends_on on membership_types
  for each row execute function membership_type_dates();

-- 2. A membership's year label follows its type's start date.
create function membership_year_label() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select ensure_club_year(extract(year from t.starts_on)::int) into new.club_year_id
    from membership_types t where t.id = new.membership_type_id;
  return new;
end $$;
create trigger membership_year_label before insert or update of membership_type_id, club_year_id on memberships
  for each row execute function membership_year_label();

create function membership_type_moved() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update memberships set club_year_id = ensure_club_year(extract(year from new.starts_on)::int)
   where membership_type_id = new.id;
  return new;
end $$;
create trigger membership_type_moved after update of starts_on on membership_types
  for each row when (extract(year from new.starts_on) <> extract(year from old.starts_on))
  execute function membership_type_moved();

comment on column memberships.club_year_id is 'The year the membership starts in, set automatically from its type''s start date. For totals and history only.';

-- Price if bought today: the full price up to a month after the start date, then the months left
-- (counting this month) out of the type's months.
drop function membership_quote(uuid, uuid);
create function membership_quote(p_type_id uuid)
returns table (price_pence integer, months integer)
language sql stable security definer set search_path = public as $$
  select round(t.annual_price_pence * l.months / tot.months::numeric)::int, l.months
    from membership_types t,
         lateral (select ((extract(year from t.ends_on) - extract(year from t.starts_on)) * 12
                          + extract(month from t.ends_on) - extract(month from t.starts_on) + 1)::int as months) tot,
         lateral (select case when club_today() <= t.starts_on + 30 then tot.months
                              else greatest(1, least(tot.months,
                                     ((extract(year from t.ends_on) - extract(year from club_today())) * 12
                                      + extract(month from t.ends_on) - extract(month from club_today()) + 1)::int))
                         end as months) l
   where t.id = p_type_id
$$;

-- 3. Copy a type: same details, dates a year later. Returns the new type.
drop function copy_membership_types(uuid);
drop function copy_types_into(uuid, uuid, text[]);
create function copy_membership_type(p_type_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  t membership_types;
  new_id uuid;
begin
  if not has_role('admin') then raise exception 'Only club admins can set up membership types'; end if;
  select * into t from membership_types where id = p_type_id;
  if not found then raise exception 'That membership type could not be found'; end if;
  if exists (select 1 from membership_types x
              where x.code = t.code and x.starts_on = (t.starts_on + interval '1 year')::date) then
    raise exception 'There is already a % type starting on %', t.code, to_char(t.starts_on + interval '1 year', 'DD/MM/YYYY');
  end if;
  insert into membership_types (starts_on, ends_on, code, name, description, category, cover, annual_price_pence,
                                max_age, requires_adult_member, sibling_order, is_open, sort_order)
  values ((t.starts_on + interval '1 year')::date, (t.ends_on + interval '1 year')::date, t.code, t.name, t.description,
          t.category, t.cover, t.annual_price_pence, t.max_age, t.requires_adult_member, t.sibling_order, true, t.sort_order)
  returning id into new_id;
  insert into membership_type_activities (membership_type_id, activity_id)
  select new_id, activity_id from membership_type_activities where membership_type_id = t.id;
  return new_id;
end $$;
revoke execute on function copy_membership_type(uuid) from public, anon;
grant execute on function copy_membership_type(uuid) to authenticated;

-- Two types' periods overlap.
create function periods_overlap(a membership_types, b membership_types) returns boolean
language sql immutable as $$ select a.starts_on <= b.ends_on and b.starts_on <= a.ends_on $$;

-- The membership rules, shared by members and admins. The type must be active and not yet ended.
drop function start_membership(uuid, uuid[], uuid);
drop function create_membership(uuid, uuid, uuid[], uuid, boolean);
create function create_membership(p_payer uuid, p_type_id uuid, p_person_ids uuid[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  hh      uuid;
  mt      membership_types;
  juniors int;
  q       record;
  new_id  uuid;
begin
  select * into mt from membership_types where id = p_type_id and is_open and ends_on >= club_today();
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
       and (date_of_birth is null or date_part('year', age(mt.starts_on, date_of_birth)) > mt.max_age)) then
    raise exception 'Someone is over the age limit for % (date of birth needed)', mt.name;
  end if;
  if mt.requires_adult_member and not exists (
       select 1 from memberships m
       join membership_types t on t.id = m.membership_type_id
       where m.household_id = hh and periods_overlap(t, mt)
         and t.cover <> 'junior' and m.status in ('active', 'awaiting_payment')) then
    raise exception 'A junior needs an adult in the household to hold a membership for the same dates';
  end if;

  -- Junior sibling pricing: count the household's junior memberships for the same dates, then use J1, J2 or J3.
  if mt.sibling_order is not null then
    select count(*) into juniors
      from memberships m join membership_types t on t.id = m.membership_type_id
     where m.household_id = hh and t.sibling_order is not null and periods_overlap(t, mt)
       and m.status <> 'cancelled';
    select * into mt from membership_types j
     where j.cover = 'junior' and j.is_open and j.starts_on = mt.starts_on and j.ends_on = mt.ends_on
       and j.sibling_order <= least(juniors + 1, 3)
     order by j.sibling_order desc, j.sort_order limit 1;
    if not found then raise exception 'Junior membership not available'; end if;
  end if;

  if exists (
       select 1 from memberships m
       join membership_people mp on mp.membership_id = m.id
       join membership_types t on t.id = m.membership_type_id
       where m.status <> 'cancelled' and mp.person_id = any(p_person_ids) and periods_overlap(t, mt)
         and (t.id = mt.id or (t.category = 'sailing' and mt.category = 'sailing'))) then
    raise exception 'Someone already has this kind of membership for those dates';
  end if;

  select * into q from membership_quote(mt.id);

  insert into memberships (membership_type_id, payer_person_id, household_id, status, price_pence, prorata_months)
  values (mt.id, p_payer, hh, 'awaiting_payment', q.price_pence, q.months)
  returning id into new_id;

  insert into membership_people (membership_id, person_id)
  select new_id, unnest(p_person_ids);
  return new_id;
end $$;
revoke execute on function create_membership(uuid, uuid, uuid[]) from public, anon, authenticated;

-- 4. People I can renew: on a membership I look after (as payer or family main contact) that ends within
--    the next 60 days. "renewed" says they already have a membership starting later.
drop function open_club_years();
create function my_renewals()
returns table (person_id uuid, membership_id uuid, type_id uuid, code text, starts_on date, ends_on date, renewed boolean)
language sql stable security definer set search_path = public as $$
  select distinct on (mp.person_id, m.id) mp.person_id, m.id, t.id, t.code, t.starts_on, t.ends_on,
         exists (select 1 from membership_people x
                   join memberships y on y.id = x.membership_id
                   join membership_types u on u.id = y.membership_type_id
                  where x.person_id = mp.person_id and y.status <> 'cancelled' and u.starts_on > t.starts_on)
    from memberships m
    join membership_types t on t.id = m.membership_type_id
    join membership_people mp on mp.membership_id = m.id
    join people p on p.id = mp.person_id and p.archived_at is null
   where m.status in ('active', 'awaiting_payment')
     and (m.payer_person_id = current_person_id() or (m.household_id is not null and is_household_lead(m.household_id)))
     and club_today() between t.ends_on - renewal_notice_days() and t.ends_on
$$;
revoke execute on function my_renewals() from public, anon;
grant execute on function my_renewals() to authenticated;

drop function renew_my_membership(uuid, uuid[], uuid);
create function renew_my_membership(p_type_id uuid, p_person_ids uuid[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me uuid := current_person_id();
  mt membership_types;
begin
  if me is null then raise exception 'Not logged in'; end if;
  if coalesce(cardinality(p_person_ids), 0) = 0 then raise exception 'Choose who the membership is for'; end if;
  if exists (select 1 from people p join households h on h.id = p.household_id
              where p.id = me and h.lead_person_id is distinct from me) then
    raise exception 'Only your family''s main contact can renew';
  end if;
  if exists (select 1 from unnest(p_person_ids) pid where pid not in (select r.person_id from my_renewals() r)) then
    raise exception 'Only people whose membership is due for renewal can be renewed';
  end if;
  select * into mt from membership_types where id = p_type_id and is_open and starts_on > club_today();
  if not found then raise exception 'Choose a membership type that starts after today'; end if;
  if mt.cover = 'family' and cardinality(p_person_ids) > 4 then
    raise exception '% covers up to 4 people', mt.name;
  end if;
  return create_membership(me, p_type_id, p_person_ids);
end $$;
revoke execute on function renew_my_membership(uuid, uuid[]) from public, anon;
grant execute on function renew_my_membership(uuid, uuid[]) to authenticated;

-- Admins renew or add a membership for a member (any active type that hasn't ended).
drop function admin_renew_membership(uuid, uuid, uuid[], uuid);
create function admin_renew_membership(p_person uuid, p_type_id uuid, p_person_ids uuid[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  hh    uuid;
  payer uuid;
begin
  if not has_role('admin') then raise exception 'Only an admin can renew memberships for members'; end if;
  select household_id into hh from people where id = p_person and archived_at is null;
  if not found then raise exception 'That member could not be found'; end if;
  payer := coalesce((select lead_person_id from households where id = hh), p_person);
  if exists (select 1 from unnest(p_person_ids) pid
              where pid <> p_person and pid not in (select id from people where household_id = hh and hh is not null and archived_at is null)) then
    raise exception 'You can only add people from your own household';
  end if;
  if (select cover from membership_types where id = p_type_id) = 'family' and cardinality(p_person_ids) > 4 then
    raise exception 'A Family membership covers up to 4 people';
  end if;
  return create_membership(payer, p_type_id, p_person_ids);
end $$;
revoke execute on function admin_renew_membership(uuid, uuid, uuid[]) from public, anon;
grant execute on function admin_renew_membership(uuid, uuid, uuid[]) to authenticated;

-- People added to a family join the family's Family membership if it hasn't ended and they aren't
-- already on a membership for the same dates.
create or replace function cover_with_family_membership() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.household_id is null or new.archived_at is not null then return new; end if;
  update memberships set household_id = new.household_id
   where payer_person_id = new.id and household_id is null;
  insert into membership_people (membership_id, person_id)
  select m.id, new.id
    from memberships m
    join membership_types t on t.id = m.membership_type_id
   where m.household_id = new.household_id
     and t.cover = 'family'
     and m.status <> 'cancelled'
     and t.ends_on >= club_today()
     and not exists (select 1 from membership_people x
                       join memberships y on y.id = x.membership_id
                       join membership_types u on u.id = y.membership_type_id
                      where x.person_id = new.id and y.status <> 'cancelled' and periods_overlap(u, t))
  on conflict do nothing;
  return new;
end $$;

-- The directory: adults on a membership that hasn't ended.
create or replace function member_directory()
returns table (id uuid, first_name text, last_name text, mobile text, email text, membership text)
language sql stable security definer set search_path = public as $$
  select p.id, p.first_name, p.last_name, p.mobile, p.email,
         string_agg(distinct t.name, ', ')
    from people p
    join membership_people mp on mp.person_id = p.id
    join memberships m on m.id = mp.membership_id
    join membership_types t on t.id = m.membership_type_id
   where t.ends_on >= club_today()
     and m.status in ('active', 'awaiting_payment')
     and not p.directory_opt_out
     and p.archived_at is null
     and p.date_of_birth <= current_date - interval '18 years'   -- adults only (safeguarding)
     and current_person_id() is not null
   group by p.id
   order by p.last_name, p.first_name
$$;

-- 5. Join: active types from 60 days before they start until they end.
drop function join_options();
create function join_options()
returns table (type_id uuid, type_name text, description text, cover membership_cover, category membership_category,
               starts_on date, ends_on date, price_pence int, months int)
language sql stable security definer set search_path = public as $$
  select t.id, t.name, t.description, t.cover, t.category, t.starts_on, t.ends_on, q.price_pence, q.months
    from membership_types t
    cross join lateral membership_quote(t.id) q
   where t.is_open and t.cover <> 'junior' and t.ends_on >= club_today()
     and t.starts_on - renewal_notice_days() <= club_today()
   order by t.starts_on, t.sort_order
$$;
grant execute on function join_options() to anon, authenticated;

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
    if mt.max_age is not null and date_part('year', age(mt.starts_on, (x->>'date_of_birth')::date)) > mt.max_age then
      raise exception 'Someone is over the age limit for % (date of birth needed)', mt.name;
    end if;
  end loop;
  select * into quote from membership_quote(mt.id);

  insert into membership_applications (contact_name, contact_email, type_name, people_count, price_pence, data)
  values (trim(folk->0->>'first_name') || ' ' || trim(folk->0->>'last_name'), v_email, mt.name, n, quote.price_pence,
          -- Only the fields Add new member uses. No payment or existing family can be set from outside.
          jsonb_build_object('type_id', mt.id,
                             'address_line1', p->>'address_line1', 'address_line2', p->>'address_line2',
                             'address_line3', p->>'address_line3', 'address_line4', p->>'address_line4',
                             'postcode', p->>'postcode', 'people', folk))
  returning id into new_id;
  return new_id;
end $$;

-- Applications show the type's dates instead of a year.
create or replace function pending_applications()
returns table (id uuid, created_at timestamptz, contact_name text, contact_email text, type_name text, club_year text,
               people_count integer, price_pence integer, people text, postcode text, has_medical boolean)
language sql stable security definer set search_path = public as $$
  select a.id, a.created_at, a.contact_name, a.contact_email, a.type_name,
         (select to_char(t.starts_on, 'FMDD Mon YYYY') || ' to ' || to_char(t.ends_on, 'FMDD Mon YYYY')
            from membership_types t where t.id = (a.data->>'type_id')::uuid),
         a.people_count, a.price_pence,
         (select string_agg(concat_ws(' ', x->>'first_name', x->>'last_name')
                 || coalesce(' (born ' || to_char((x->>'date_of_birth')::date, 'DD/MM/YYYY') || ')', ''), ', ')
            from jsonb_array_elements(a.data->'people') x),
         upper(a.data->>'postcode'),
         exists (select 1 from jsonb_array_elements(a.data->'people') x where nullif(trim(x->>'medical_details'), '') is not null)
    from membership_applications a
   where a.status = 'pending' and has_role('admin')
   order by a.created_at
$$;

-- Renewal reminders: whoever looks after a membership ending in the next 60 days with someone on it
-- not yet renewed. The price shown is the next type with the same code that starts after today, if there is one.
drop function renewal_reminder_recipients(uuid);
create function renewal_reminder_recipients()
returns table (person_id uuid, first_name text, last_name text, email text, membership_types text,
               renewal_price_pence integer, last_reminded_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not has_role('admin') then raise exception 'Admins only'; end if;
  return query
  with due as (
    select m.id, m.membership_type_id, t.ends_on,
           coalesce(h.lead_person_id, m.payer_person_id) as renewer
      from memberships m
      join membership_types t on t.id = m.membership_type_id
      left join households h on h.id = m.household_id
     where m.status in ('active', 'awaiting_payment')
       and club_today() between t.ends_on - renewal_notice_days() and t.ends_on
       and exists (select 1 from membership_people mp join people p on p.id = mp.person_id
                    where mp.membership_id = m.id and p.archived_at is null
                      and not exists (select 1 from membership_people x
                                        join memberships y on y.id = x.membership_id
                                        join membership_types u on u.id = y.membership_type_id
                                       where x.person_id = mp.person_id and y.status <> 'cancelled'
                                         and u.starts_on > t.starts_on))
  )
  select p.id, p.first_name, p.last_name, p.email,
         string_agg(t.name, ', ' order by t.sort_order),
         sum(coalesce((select nt.annual_price_pence from membership_types nt
                        where nt.code = t.code and nt.is_open and nt.starts_on > club_today()
                        order by nt.starts_on limit 1), t.annual_price_pence))::int,
         (select max(r.sent_at) from email_recipients r join email_campaigns c on c.id = r.campaign_id
           where r.person_id = p.id and r.status = 'sent' and c.purpose = 'renewal_reminder'
             and r.sent_at >= min(d.ends_on) - renewal_notice_days())
    from due d
    join people p on p.id = d.renewer and p.archived_at is null
    join membership_types t on t.id = d.membership_type_id
   group by p.id, p.first_name, p.last_name, p.email
   order by p.last_name, p.first_name;
end $$;
revoke execute on function renewal_reminder_recipients() from public, anon;
grant execute on function renewal_reminder_recipients() to authenticated;

-- The spreadsheet import still asks which year: it uses the types starting in that year.
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
                            'skipped', people_skipped, 'memberships', memberships_made);
end $$;

revoke execute on function import_members(jsonb, uuid, boolean) from public, anon;
grant execute on function import_members(jsonb, uuid, boolean) to authenticated;
revoke execute on function membership_quote(uuid) from public, anon;
grant execute on function membership_quote(uuid) to authenticated;
revoke execute on function membership_year_label(), membership_type_moved(), periods_overlap(membership_types, membership_types)
  from public, anon, authenticated;

-- Add new member: no year to choose, the type's dates say when the membership runs.
create or replace function admin_add_member(p jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  hh      uuid := nullif(p->>'household_id', '')::uuid;
  type_id uuid := nullif(p->>'type_id', '')::uuid;
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
    covered := case when mt.cover = 'dual' and n = 1 then array[lead, ids[1]] else ids end;
    -- They're getting their own membership, so take them off any Family membership they were added to just now.
    delete from membership_people mp using memberships m
     where mp.membership_id = m.id and mp.person_id = any(ids)
       and m.membership_type_id in (select ot.id from membership_types ot where periods_overlap(ot, mt));
    mid := create_membership(coalesce(lead, ids[1]), type_id, covered);
    if method is not null then
      perform record_manual_payment(array[mid], method::payment_method, coalesce(nullif(p->>'paid_on', '')::date, current_date));
    end if;
  end if;
  return ids[1];
end $function$;
