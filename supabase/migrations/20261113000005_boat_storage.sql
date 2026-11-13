-- Boat storage (James, 2026-11-13).
--   Members add up to 3 boats (class and sail number) per membership: at checkout when renewing
--   or paying, and on the public Join form. £35 each at the members rate, for the same dates as
--   the membership, never pro rata. A family counts as one member, so up to 3 boats per household
--   for overlapping dates.
--   Admins add or remove boats on a member's admin page, including the non-members rate (£80)
--   charged to someone who didn't renew but left their boat at the club.
--   Admins change both prices on the Membership types screen.
--   Storage income goes to the "Boat storage" category (on_payment_paid already does this).

alter table boat_storages
  add column household_id  uuid references households (id),
  add column membership_id uuid references memberships (id) on delete set null,
  add column boat_class    text,
  add column starts_on     date,
  add column ends_on       date;
alter table boat_storages alter column club_year_id drop not null;
create index on boat_storages (household_id);

-- The year label follows the start date, as for memberships.
create function boat_storage_year() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.starts_on is not null then new.club_year_id := ensure_club_year(extract(year from new.starts_on)::int); end if;
  return new;
end $$;
create trigger boat_storage_year before insert or update of starts_on on boat_storages
  for each row execute function boat_storage_year();
revoke execute on function boat_storage_year() from public, anon, authenticated;

-- The family's main contact (and anyone in the household) can see the household's boats.
drop policy bs_select on boat_storages;
create policy bs_select on boat_storages for select to authenticated
  using (person_id = current_person_id() or (household_id is not null and household_id = my_household_id())
         or has_role('finance') or has_role('admin'));

-- Admins (not only superadmins) change the storage prices.
drop policy bso_write on boat_storage_options;
create policy bso_write on boat_storage_options for all to authenticated
  using (has_role('admin')) with check (has_role('admin'));

-- Today's price for the members or non-members rate. The Join page shows it, so visitors can call it.
create function boat_storage_price(p_members boolean) returns integer
language sql stable security definer set search_path = public as $$
  select price_pence from boat_storage_options where members_rate = p_members order by name limit 1
$$;
revoke execute on function boat_storage_price(boolean) from public;
grant execute on function boat_storage_price(boolean) to anon, authenticated;

-- Checks a list of boats: each needs a class and sail number, and no more than 3 with those already stored.
create function check_boats(p_boats jsonb, p_existing integer) returns void
language plpgsql immutable as $$
declare b jsonb;
begin
  if jsonb_typeof(p_boats) <> 'array' then raise exception 'Boats must be a list'; end if;
  if jsonb_array_length(p_boats) + p_existing > 3 then raise exception 'Up to 3 boats can be stored per membership'; end if;
  for b in select * from jsonb_array_elements(p_boats) loop
    if coalesce(trim(b->>'boat_class'), '') = '' or coalesce(trim(b->>'sail_number'), '') = '' then
      raise exception 'Each boat needs a class and sail number';
    end if;
  end loop;
end $$;

-- Boats already stored by a household (or a person with no household) for dates overlapping these.
create function household_boats(p_person uuid, p_starts date, p_ends date) returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::int from boat_storages bs
   where bs.status <> 'cancelled' and bs.starts_on <= p_ends and bs.ends_on >= p_starts
     and (bs.person_id = p_person
          or bs.household_id = (select household_id from people where id = p_person and household_id is not null))
$$;

-- Adds boats for someone, awaiting payment. Internal: the app calls the functions below.
create function create_boat_storages(p_owner uuid, p_members boolean, p_starts date, p_ends date,
                                     p_boats jsonb, p_membership uuid) returns uuid[]
language plpgsql security definer set search_path = public as $$
declare
  hh  uuid := (select household_id from people where id = p_owner);
  opt boat_storage_options;
  ids uuid[] := '{}';
  b   jsonb;
  new_id uuid;
begin
  if p_starts is null or p_ends is null or p_ends < p_starts then raise exception 'Boat storage needs a start and end date'; end if;
  perform check_boats(p_boats, household_boats(p_owner, p_starts, p_ends));
  select * into opt from boat_storage_options where members_rate = p_members order by name limit 1;
  for b in select * from jsonb_array_elements(p_boats) loop
    insert into boat_storages (person_id, household_id, membership_id, option_id, boat_class, sail_number,
                               starts_on, ends_on, price_pence)
    values (p_owner, hh, p_membership, opt.id, trim(b->>'boat_class'), upper(trim(b->>'sail_number')),
            p_starts, p_ends, opt.price_pence)
    returning id into new_id;
    ids := ids || new_id;
  end loop;
  return ids;
end $$;

-- A test receipt now covers boats too.
drop function record_test_receipt(uuid, uuid[], payment_method, date);
create function record_test_receipt(p_payer uuid, p_membership_ids uuid[], p_method payment_method, p_paid_on date,
                                    p_storage_ids uuid[] default '{}') returns uuid
language plpgsql security definer set search_path = public as $$
declare
  pay_id uuid;
begin
  insert into member_receipts (payer_person_id, amount_pence, method, status, paid_on)
  values (p_payer,
          coalesce((select sum(price_pence) from memberships where id = any(p_membership_ids)), 0)
          + coalesce((select sum(price_pence) from boat_storages where id = any(p_storage_ids)), 0),
          p_method, 'pending', p_paid_on)
  returning id into pay_id;

  insert into member_receipt_lines (receipt_id, membership_id, description, amount_pence)
  select pay_id, m.id, t.name || ' ' || cy.label, m.price_pence
    from memberships m
    join membership_types t on t.id = m.membership_type_id
    join club_years cy on cy.id = m.club_year_id
   where m.id = any(p_membership_ids);
  insert into member_receipt_lines (receipt_id, boat_storage_id, description, amount_pence)
  select pay_id, bs.id, boat_storage_label(bs.id), bs.price_pence
    from boat_storages bs where bs.id = any(p_storage_ids);

  update member_receipts set status = 'paid' where id = pay_id;   -- trigger activates and posts income
  return pay_id;
end $$;

-- How a boat appears on receipts and in transactions, e.g. "Boat storage 2027: Laser 123456".
create function boat_storage_label(p_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select 'Boat storage ' || coalesce(cy.label || ': ', ': ') || concat_ws(' ', bs.boat_class, bs.sail_number)
         || case when o.members_rate then '' else ' (non-members rate)' end
    from boat_storages bs
    join boat_storage_options o on o.id = bs.option_id
    left join club_years cy on cy.id = bs.club_year_id
   where bs.id = p_id
$$;

-- Checkout: a member pays for memberships awaiting payment, any of their boats awaiting payment,
-- and new boats added at checkout (stored for the same dates as the membership).
drop function pay_my_memberships_test(uuid[], payment_method);
create function pay_my_memberships_test(p_membership_ids uuid[], p_method payment_method,
                                        p_boats jsonb default '[]', p_storage_ids uuid[] default '{}')
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me   uuid := current_person_id();
  hh   uuid := my_household_id();
  mids uuid[] := coalesce(p_membership_ids, '{}');
  sids uuid[] := coalesce(p_storage_ids, '{}');
  per  record;
begin
  if me is null then raise exception 'Please log in'; end if;
  if p_method not in ('card', 'direct_debit') then raise exception 'Choose card or Direct Debit'; end if;
  if (select count(*) from memberships m
       where m.id = any(mids) and m.status = 'awaiting_payment'
         and ((hh is not null and m.household_id = hh) or m.payer_person_id = me)) <> cardinality(mids) then
    raise exception 'Only your own memberships awaiting payment can be paid';
  end if;
  if (select count(*) from boat_storages bs
       where bs.id = any(sids) and bs.status = 'awaiting_payment'
         and ((hh is not null and bs.household_id = hh) or bs.person_id = me)) <> cardinality(sids) then
    raise exception 'Only your own boat storage awaiting payment can be paid';
  end if;
  if jsonb_array_length(coalesce(p_boats, '[]'::jsonb)) > 0 then
    -- Stored for the dates of the membership being paid for (the latest, if more than one).
    select m.id, t.starts_on, t.ends_on into per
      from memberships m join membership_types t on t.id = m.membership_type_id
     where m.id = any(mids) order by t.starts_on desc limit 1;
    if not found then raise exception 'Boats can only be added with a membership'; end if;
    sids := sids || create_boat_storages(me, true, per.starts_on, per.ends_on, p_boats, per.id);
  end if;
  if cardinality(mids) + cardinality(sids) = 0 then raise exception 'Nothing to pay'; end if;
  return record_test_receipt(me, mids, p_method, current_date, sids);
end $$;
revoke execute on function pay_my_memberships_test(uuid[], payment_method, jsonb, uuid[]) from public, anon;
grant execute on function pay_my_memberships_test(uuid[], payment_method, jsonb, uuid[]) to authenticated;

-- Join form: boats are part of the application and paid with it.
alter table membership_applications
  add column boats_pence integer not null default 0,
  add column paid_storage_transaction_ids uuid[] not null default '{}';

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
end $$;

create or replace function pay_application_test(p_id uuid, p_method payment_method) returns integer
language plpgsql security definer set search_path = public as $$
declare
  a      membership_applications;
  sub_tx uuid;
  tx_id  uuid;
  b      jsonb;
  boat_tx uuid[] := '{}';
  each_pence integer;
  today date := (now() at time zone 'Europe/London')::date;
begin
  if p_method not in ('card', 'direct_debit') then raise exception 'Choose card or Direct Debit'; end if;
  select * into a from membership_applications
   where id = p_id and status = 'pending' and paid_at is null
     and created_at > now() - interval '1 day'   -- only straight after applying
   for update;
  if not found then raise exception 'That application can''t be paid for'; end if;

  insert into transactions (occurred_on, description, direction, amount_pence, category_id, method, membership_type_id, party)
  values (today, a.type_name || ' (new member application)', 'in', a.price_pence,
          (select id from transaction_categories where name = 'Subscriptions'), p_method,
          (a.data->>'type_id')::uuid, a.contact_name)
  returning id into sub_tx;

  -- One Boat storage transaction per boat.
  each_pence := case when jsonb_array_length(coalesce(a.data->'boats', '[]'::jsonb)) = 0 then 0
                     else a.boats_pence / jsonb_array_length(a.data->'boats') end;
  for b in select * from jsonb_array_elements(coalesce(a.data->'boats', '[]'::jsonb)) loop
    insert into transactions (occurred_on, description, direction, amount_pence, category_id, method, party)
    values (today, 'Boat storage: ' || concat_ws(' ', trim(b->>'boat_class'), upper(trim(b->>'sail_number'))) || ' (new member application)',
            'in', each_pence, (select id from transaction_categories where name = 'Boat storage'), p_method, a.contact_name)
    returning id into tx_id;
    boat_tx := boat_tx || tx_id;
  end loop;

  update membership_applications
     set paid_method = p_method, paid_pence = price_pence, paid_at = now(),
         paid_transaction_id = sub_tx,
         paid_storage_transaction_ids = boat_tx
   where id = p_id;
  return a.price_pence + a.boats_pence;
end $$;

-- Accepting: boats on the application are stored for the membership's dates. If they paid when
-- applying, the receipt is recorded and linked to the transactions made then (no second ones).
create or replace function accept_application(p_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  a       membership_applications;
  new_id  uuid;
  mid     uuid;
  mt      membership_types;
  sids    uuid[] := '{}';
  pay_id  uuid;
  line_id uuid;
  i       integer;
begin
  if not has_role('admin') then raise exception 'Only an admin can accept applications'; end if;
  select * into a from membership_applications where id = p_id and status = 'pending' for update;
  if not found then raise exception 'That application has already been dealt with'; end if;
  new_id := admin_add_member(a.data);
  select m.id into mid
    from memberships m join membership_people mp on mp.membership_id = m.id
   where mp.person_id = new_id and m.membership_type_id = (a.data->>'type_id')::uuid and m.status = 'awaiting_payment'
   order by m.created_at desc limit 1;
  if mid is not null and jsonb_array_length(coalesce(a.data->'boats', '[]'::jsonb)) > 0 then
    select t.* into mt from membership_types t where t.id = (a.data->>'type_id')::uuid;
    sids := create_boat_storages(new_id, true, mt.starts_on, mt.ends_on, a.data->'boats', mid);
    -- The price they were quoted when applying.
    update boat_storages set price_pence = a.boats_pence / cardinality(sids) where id = any(sids);
  end if;
  if a.paid_at is not null and mid is not null then
    update memberships set price_pence = a.paid_pence where id = mid;   -- the price they paid
    if a.paid_transaction_id is null then
      -- Paid before transactions were recorded on paying: record it the usual way.
      perform record_test_receipt(new_id, array[mid], a.paid_method, (a.paid_at at time zone 'Europe/London')::date, sids);
    else
      -- Inserted already paid, so the payment trigger doesn't post second transactions.
      insert into member_receipts (payer_person_id, amount_pence, method, status, paid_on)
      values (new_id, a.paid_pence + a.boats_pence, a.paid_method, 'paid', (a.paid_at at time zone 'Europe/London')::date)
      returning id into pay_id;
      insert into member_receipt_lines (receipt_id, membership_id, description, amount_pence)
      select pay_id, m.id, t.name || ' ' || cy.label, m.price_pence
        from memberships m
        join membership_types t on t.id = m.membership_type_id
        join club_years cy on cy.id = m.club_year_id
       where m.id = mid
      returning id into line_id;
      update memberships set status = 'active' where id = mid;
      update transactions
         set receipt_line_id = line_id, description = (select description from member_receipt_lines where id = line_id)
       where id = a.paid_transaction_id;
      for i in 1 .. coalesce(cardinality(sids), 0) loop
        insert into member_receipt_lines (receipt_id, boat_storage_id, description, amount_pence)
        select pay_id, bs.id, boat_storage_label(bs.id), bs.price_pence from boat_storages bs where bs.id = sids[i]
        returning id into line_id;
        update boat_storages set status = 'active' where id = sids[i];
        update transactions
           set receipt_line_id = line_id, description = boat_storage_label(sids[i])
         where id = a.paid_storage_transaction_ids[i];
      end loop;
    end if;
  end if;
  update membership_applications
     set status = 'accepted', person_id = new_id, reviewed_by = current_person_id(), reviewed_at = now(),
         data = null   -- the details now live on the member record
   where id = p_id;
  return new_id;
end $$;

-- Applications screen: also the boats.
drop function pending_applications();
create function pending_applications()
returns table (id uuid, created_at timestamptz, contact_name text, contact_email text, type_name text, club_year text,
               people_count integer, price_pence integer, people text, postcode text, has_medical boolean,
               paid_method payment_method, paid_pence integer, paid_at timestamptz, boats text, boats_pence integer)
language sql stable security definer set search_path = public as $$
  select a.id, a.created_at, a.contact_name, a.contact_email, a.type_name,
         (select to_char(t.starts_on, 'FMDD Mon YYYY') || ' to ' || to_char(t.ends_on, 'FMDD Mon YYYY')
            from membership_types t where t.id = (a.data->>'type_id')::uuid),
         a.people_count, a.price_pence,
         (select string_agg(concat_ws(' ', x->>'first_name', x->>'last_name')
                 || coalesce(' (born ' || to_char((x->>'date_of_birth')::date, 'DD/MM/YYYY') || ')', ''), ', ')
            from jsonb_array_elements(a.data->'people') x),
         upper(a.data->>'postcode'),
         exists (select 1 from jsonb_array_elements(a.data->'people') x where nullif(trim(x->>'medical_details'), '') is not null),
         a.paid_method, a.paid_pence, a.paid_at,
         (select string_agg(concat_ws(' ', trim(b->>'boat_class'), upper(trim(b->>'sail_number'))), ', ')
            from jsonb_array_elements(coalesce(a.data->'boats', '[]'::jsonb)) b),
         a.boats_pence
    from membership_applications a
   where a.status = 'pending' and has_role('admin')
   order by a.created_at
$$;
revoke execute on function pending_applications() from public, anon;
grant execute on function pending_applications() to authenticated;

-- Admin member page: add a boat (members or non-members rate) for given dates, optionally recording
-- a cash, cheque or bank transfer payment for it.
create function admin_add_boat_storage(p_person uuid, p_members boolean, p_class text, p_sail text,
                                       p_starts date, p_ends date, p_method text default null, p_paid_on date default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  sid    uuid;
  pay_id uuid;
begin
  if not has_role('admin') then raise exception 'Only an admin can add boat storage'; end if;
  if nullif(p_method, '') is not null and p_method not in ('cash', 'cheque', 'bank_transfer') then
    raise exception 'Payment must be cash, cheque or bank transfer';
  end if;
  sid := (create_boat_storages(p_person, p_members, p_starts, p_ends,
                               jsonb_build_array(jsonb_build_object('boat_class', p_class, 'sail_number', p_sail)), null))[1];
  if nullif(p_method, '') is not null then
    if p_paid_on is null or p_paid_on > current_date then raise exception 'Give the date the payment was received'; end if;
    insert into member_receipts (payer_person_id, amount_pence, method, status, paid_on, recorded_by)
    select p_person, price_pence, p_method::payment_method, 'pending', p_paid_on, current_person_id()
      from boat_storages where id = sid
    returning id into pay_id;
    insert into member_receipt_lines (receipt_id, boat_storage_id, description, amount_pence)
    select pay_id, sid, boat_storage_label(sid), price_pence from boat_storages where id = sid;
    update member_receipts set status = 'paid' where id = pay_id;   -- trigger activates and posts income
  end if;
  return sid;
end $$;
revoke execute on function admin_add_boat_storage(uuid, boolean, text, text, date, date, text, date) from public, anon;
grant execute on function admin_add_boat_storage(uuid, boolean, text, text, date, date, text, date) to authenticated;

-- Admin member page: remove a boat that hasn't been paid for.
create function admin_remove_boat_storage(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_role('admin') then raise exception 'Only an admin can remove boat storage'; end if;
  delete from boat_storages bs
   where bs.id = p_id and not exists (select 1 from member_receipt_lines l where l.boat_storage_id = bs.id);
  if not found then raise exception 'Only boat storage that hasn''t been paid for can be removed'; end if;
end $$;
revoke execute on function admin_remove_boat_storage(uuid) from public, anon;
grant execute on function admin_remove_boat_storage(uuid) to authenticated;

revoke execute on function check_boats(jsonb, integer), household_boats(uuid, date, date),
  create_boat_storages(uuid, boolean, date, date, jsonb, uuid), boat_storage_label(uuid),
  record_test_receipt(uuid, uuid[], payment_method, date, uuid[]) from public, anon, authenticated;
