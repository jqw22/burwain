-- Public joining, phase 1.
-- Anyone can apply to join from the public Join page (no login). Each application waits for a club admin,
-- who accepts it (the member is created exactly as Add new member does) or declines it.
-- Payment is still recorded by finance; online payment comes later.

create table membership_applications (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  status       text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  contact_name text not null,
  contact_email text not null,
  type_name    text not null,
  people_count int not null,
  price_pence  int not null,
  data         jsonb,            -- the form, removed once an application is declined
  person_id    uuid references people (id) on delete set null,
  reviewed_by  uuid references people (id) on delete set null,
  reviewed_at  timestamptz,
  decline_reason text
);
alter table membership_applications enable row level security;
revoke all on membership_applications from anon;
create policy applications_admin_read on membership_applications for select to authenticated using (has_role('admin'));
create index on membership_applications (status, created_at);

-- What the Join page offers: membership types a new family can take (juniors join through a parent's
-- Family membership, so Junior isn't offered) and the club years open for joining, with this year's pro rata.
create function join_options()
returns table (type_id uuid, type_name text, description text, cover membership_cover, category membership_category,
               club_year_id uuid, club_year text, is_next_year boolean, price_pence int, months int)
language sql stable security definer set search_path = public as $$
  select t.id, t.name, t.description, t.cover, t.category, cy.id, cy.label, cy.starts_on > club_today(), q.price_pence, q.months
    from membership_types t
    cross join club_years cy
    cross join lateral membership_quote(t.id, cy.id) q
   where t.is_open and t.cover <> 'junior'
     and club_today() between cy.starts_on - renewal_notice_days() and cy.ends_on
   order by cy.starts_on, t.sort_order
$$;
revoke execute on function join_options() from public;
grant execute on function join_options() to anon, authenticated;

-- Submit an application. Checks it the way Add new member would, so accepting it won't fail on the basics.
create function submit_application(p jsonb) returns uuid
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
revoke execute on function submit_application(jsonb) from public;
grant execute on function submit_application(jsonb) to anon, authenticated;

-- An admin accepts an application: the member (and family) are created as on Add new member.
create function accept_application(p_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  a      membership_applications;
  new_id uuid;
begin
  if not has_role('admin') then raise exception 'Only an admin can accept applications'; end if;
  select * into a from membership_applications where id = p_id and status = 'pending' for update;
  if not found then raise exception 'That application has already been dealt with'; end if;
  new_id := admin_add_member(a.data);
  update membership_applications
     set status = 'accepted', person_id = new_id, reviewed_by = current_person_id(), reviewed_at = now(),
         data = null   -- the details now live on the member record
   where id = p_id;
  return new_id;
end $$;
revoke execute on function accept_application(uuid) from public, anon;
grant execute on function accept_application(uuid) to authenticated;

-- An admin declines an application. The personal details (including any medical information) are deleted.
create function decline_application(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_role('admin') then raise exception 'Only an admin can decline applications'; end if;
  update membership_applications
     set status = 'declined', data = null, decline_reason = nullif(trim(p_reason), ''),
         reviewed_by = current_person_id(), reviewed_at = now()
   where id = p_id and status = 'pending';
  if not found then raise exception 'That application has already been dealt with'; end if;
end $$;
revoke execute on function decline_application(uuid, text) from public, anon;
grant execute on function decline_application(uuid, text) to authenticated;

-- What admins see in the list: a summary, without medical details.
create function pending_applications()
returns table (id uuid, created_at timestamptz, contact_name text, contact_email text, type_name text,
               club_year text, people_count int, price_pence int, people text, postcode text, has_medical boolean)
language sql stable security definer set search_path = public as $$
  select a.id, a.created_at, a.contact_name, a.contact_email, a.type_name,
         (select label from club_years where id = (a.data->>'club_year_id')::uuid),
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
revoke execute on function pending_applications() from public, anon;
grant execute on function pending_applications() to authenticated;
