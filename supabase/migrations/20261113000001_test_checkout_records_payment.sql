-- Test checkout: pressing Pay records the payment and marks the membership as paid.
-- No payment provider is called and no money is taken. Test receipts are marked
-- (provider_ref starts 'test-', and the income lines end "(test payment)") so finance can
-- tell them apart. Stripe and GoCardless will replace this later.
--
-- Marking a receipt paid fires on_payment_paid(), which makes the memberships active and
-- posts the income to transactions, exactly as when finance records a payment.

-- Records a paid card/Direct Debit test receipt for some memberships. Internal: not callable from the app.
create function record_test_receipt(p_payer uuid, p_membership_ids uuid[], p_method payment_method, p_paid_on date)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  pay_id uuid;
begin
  insert into member_receipts (payer_person_id, amount_pence, method, provider_ref, status, paid_on)
  select p_payer, sum(price_pence), p_method, 'test-' || gen_random_uuid(), 'pending', p_paid_on
    from memberships where id = any(p_membership_ids)
  returning id into pay_id;

  insert into member_receipt_lines (receipt_id, membership_id, description, amount_pence)
  select pay_id, m.id, t.name || ' ' || cy.label || ' (test payment)', m.price_pence
    from memberships m
    join membership_types t on t.id = m.membership_type_id
    join club_years cy on cy.id = m.club_year_id
   where m.id = any(p_membership_ids);

  update member_receipts set status = 'paid' where id = pay_id;   -- trigger activates and posts income
  return pay_id;
end $$;
revoke execute on function record_test_receipt(uuid, uuid[], payment_method, date) from public, anon, authenticated;

-- A signed-in member pays (test) for memberships awaiting payment in their own household, or that they took out.
create function pay_my_memberships_test(p_membership_ids uuid[], p_method payment_method)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me uuid := current_person_id();
  hh uuid := my_household_id();
begin
  if me is null then raise exception 'Please log in'; end if;
  if p_method not in ('card', 'direct_debit') then raise exception 'Choose card or Direct Debit'; end if;
  if coalesce(cardinality(p_membership_ids), 0) = 0 then raise exception 'Nothing to pay'; end if;
  if (select count(*) from memberships m
       where m.id = any(p_membership_ids)
         and m.status = 'awaiting_payment'
         and ((hh is not null and m.household_id = hh) or m.payer_person_id = me)) <> cardinality(p_membership_ids) then
    raise exception 'Only your own memberships awaiting payment can be paid';
  end if;
  return record_test_receipt(me, p_membership_ids, p_method, current_date);
end $$;
revoke execute on function pay_my_memberships_test(uuid[], payment_method) from public, anon;
grant execute on function pay_my_memberships_test(uuid[], payment_method) to authenticated;

-- Public Join page: the applicant can pay (test) straight after applying, before an admin accepts.
-- The payment is held on the application. When the admin accepts, the membership is created and
-- the receipt and income are recorded with the date they paid. If the admin declines, the
-- Applications screen says a refund is needed.
alter table membership_applications
  add column paid_method payment_method,
  add column paid_pence  integer,
  add column paid_at     timestamptz;

create function pay_application_test(p_id uuid, p_method payment_method) returns integer
language plpgsql security definer set search_path = public as $$
declare
  paid integer;
begin
  if p_method not in ('card', 'direct_debit') then raise exception 'Choose card or Direct Debit'; end if;
  update membership_applications
     set paid_method = p_method, paid_pence = price_pence, paid_at = now()
   where id = p_id and status = 'pending' and paid_at is null
     and created_at > now() - interval '1 day'   -- only straight after applying
  returning paid_pence into paid;
  if not found then raise exception 'That application can''t be paid for'; end if;
  return paid;
end $$;
revoke execute on function pay_application_test(uuid, payment_method) from public;
grant execute on function pay_application_test(uuid, payment_method) to anon, authenticated;

create or replace function accept_application(p_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  a      membership_applications;
  new_id uuid;
  mid    uuid;
begin
  if not has_role('admin') then raise exception 'Only an admin can accept applications'; end if;
  select * into a from membership_applications where id = p_id and status = 'pending' for update;
  if not found then raise exception 'That application has already been dealt with'; end if;
  new_id := admin_add_member(a.data);
  if a.paid_at is not null then
    select m.id into mid
      from memberships m join membership_people mp on mp.membership_id = m.id
     where mp.person_id = new_id and m.membership_type_id = (a.data->>'type_id')::uuid and m.status = 'awaiting_payment'
     order by m.created_at desc limit 1;
    if mid is not null then
      update memberships set price_pence = a.paid_pence where id = mid;   -- the price they paid
      perform record_test_receipt(new_id, array[mid], a.paid_method, (a.paid_at at time zone 'Europe/London')::date);
    end if;
  end if;
  update membership_applications
     set status = 'accepted', person_id = new_id, reviewed_by = current_person_id(), reviewed_at = now(),
         data = null   -- the details now live on the member record
   where id = p_id;
  return new_id;
end $$;

-- Applications screen: also whether (and how) they've paid.
drop function pending_applications();
create function pending_applications()
returns table (id uuid, created_at timestamptz, contact_name text, contact_email text, type_name text, club_year text,
               people_count integer, price_pence integer, people text, postcode text, has_medical boolean,
               paid_method payment_method, paid_pence integer, paid_at timestamptz)
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
         a.paid_method, a.paid_pence, a.paid_at
    from membership_applications a
   where a.status = 'pending' and has_role('admin')
   order by a.created_at
$$;
revoke execute on function pending_applications() from public, anon;
grant execute on function pending_applications() to authenticated;
