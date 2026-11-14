-- Member payments no longer create finance transactions.
--
-- Card payouts (Stripe) and Direct Debit payouts (GoCardless) reach the bank as single amounts
-- covering several members' subscriptions and boat storage, less the provider's fees. So finance
-- now enters every bank line by hand on the Transactions screen, and Transactions matches the bank
-- statement. Who paid what for their membership is still recorded as member receipts (the Income
-- screen and the Members list), so nothing about member payments is lost.
--
-- Changed here:
--   on_payment_paid()       - still marks memberships and boat storage as paid; no transactions
--   pay_application_test()  - paying on the Join form just records the payment on the application
--   accept_application()    - records the member receipt (no transactions to link up)
-- Transactions already created automatically are left alone; a separate script removes them.

create or replace function on_payment_paid() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status <> 'paid' or old.status = 'paid' then return new; end if;
  update memberships set status = 'active'
   where id in (select membership_id from member_receipt_lines where receipt_id = new.id);
  update boat_storages set status = 'active'
   where id in (select boat_storage_id from member_receipt_lines where receipt_id = new.id);
  return new;
end $$;

create or replace function pay_application_test(p_id uuid, p_method payment_method) returns integer
language plpgsql security definer set search_path = public as $$
declare
  a membership_applications;
begin
  if p_method not in ('card', 'direct_debit') then raise exception 'Choose card or Direct Debit'; end if;
  select * into a from membership_applications
   where id = p_id and status = 'pending' and paid_at is null
     and created_at > now() - interval '1 day'   -- only straight after applying
   for update;
  if not found then raise exception 'That application can''t be paid for'; end if;
  update membership_applications
     set paid_method = p_method, paid_pence = price_pence, paid_at = now()
   where id = p_id;
  return a.price_pence + a.boats_pence;
end $$;

-- Accepting: boats on the application are stored for the membership's dates. If they paid when
-- applying, the member receipt is recorded at the price they paid.
create or replace function accept_application(p_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  a       membership_applications;
  new_id  uuid;
  mid     uuid;
  mt      membership_types;
  sids    uuid[] := '{}';
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
    perform record_test_receipt(new_id, array[mid], a.paid_method, (a.paid_at at time zone 'Europe/London')::date, sids);
  end if;
  update membership_applications
     set status = 'accepted', person_id = new_id, reviewed_by = current_person_id(), reviewed_at = now(),
         data = null   -- the details now live on the member record
   where id = p_id;
  return new_id;
end $$;
