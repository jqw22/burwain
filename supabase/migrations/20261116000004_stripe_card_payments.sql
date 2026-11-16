-- Card payments with Stripe (test mode first).
--
-- Members pay on Stripe's own secure payment page; the app never sees card details.
--   1. Pay: start_my_card_payment() records what is being paid for as a PENDING member receipt
--      (adding any boats), and the app sends the member to Stripe with that receipt's id.
--   2. Paid: Stripe tells the app (the webhook, and again when the member comes back), and
--      confirm_card_receipt() marks the receipt paid. The existing trigger then marks the
--      memberships and boat storage paid, exactly as the test checkout did.
--   3. Left without paying: the receipt stays pending, or is marked failed when Stripe's page
--      expires or they try again. Pending and failed receipts aren't counted anywhere.
-- Join applications: the payment is held on the application (as with the test checkout) once
-- Stripe confirms it, via confirm_application_card(). If they leave Stripe's page without paying,
-- they can try again from the link it returns them to, for a day after applying.
-- The confirm functions can only be run by the app's server (service role), never from a browser.
-- The test checkout functions stay, for use until the Stripe keys are added.

alter table membership_applications add column provider_ref text;

create function start_my_card_payment(p_membership_ids uuid[], p_boats jsonb default '[]', p_storage_ids uuid[] default '{}')
returns table (receipt_id uuid, amount_pence integer, payer_email text)
language plpgsql security definer set search_path = public as $$
declare
  me     uuid := current_person_id();
  hh     uuid := my_household_id();
  mids   uuid[] := coalesce(p_membership_ids, '{}');
  sids   uuid[] := coalesce(p_storage_ids, '{}');
  per    record;
  pay_id uuid;
begin
  if me is null then raise exception 'Please log in'; end if;
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
    -- They wait for payment; if the member doesn't pay now, they're on the order next time.
    select m.id, t.starts_on, t.ends_on into per
      from memberships m join membership_types t on t.id = m.membership_type_id
     where m.id = any(mids) order by t.starts_on desc limit 1;
    if not found then raise exception 'Boats can only be added with a membership'; end if;
    sids := sids || create_boat_storages(me, true, per.starts_on, per.ends_on, p_boats, per.id);
  end if;
  if cardinality(mids) + cardinality(sids) = 0 then raise exception 'Nothing to pay'; end if;

  -- An earlier card payment for any of these that was started but not finished is given up.
  update member_receipts r set status = 'failed'
   where r.status = 'pending' and r.method = 'card'
     and exists (select 1 from member_receipt_lines rl
                  where rl.receipt_id = r.id and (rl.membership_id = any(mids) or rl.boat_storage_id = any(sids)));

  insert into member_receipts (payer_person_id, amount_pence, method, status)
  values (me,
          coalesce((select sum(price_pence) from memberships where id = any(mids)), 0)
          + coalesce((select sum(price_pence) from boat_storages where id = any(sids)), 0),
          'card', 'pending')
  returning id into pay_id;
  insert into member_receipt_lines (receipt_id, membership_id, description, amount_pence)
  select pay_id, m.id, t.name || ' ' || cy.label, m.price_pence
    from memberships m
    join membership_types t on t.id = m.membership_type_id
    join club_years cy on cy.id = m.club_year_id
   where m.id = any(mids);
  insert into member_receipt_lines (receipt_id, boat_storage_id, description, amount_pence)
  select pay_id, bs.id, boat_storage_label(bs.id), bs.price_pence
    from boat_storages bs where bs.id = any(sids);

  return query select r.id, r.amount_pence, (select email from people where id = me)
                 from member_receipts r where r.id = pay_id;
end $$;
revoke execute on function start_my_card_payment(uuid[], jsonb, uuid[]) from public, anon;
grant execute on function start_my_card_payment(uuid[], jsonb, uuid[]) to authenticated;

-- Stripe confirmed the payment. Safe to run more than once. The amount must match.
create function confirm_card_receipt(p_receipt uuid, p_ref text, p_amount integer) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  r member_receipts;
begin
  select * into r from member_receipts where id = p_receipt for update;
  if not found then raise exception 'No such receipt'; end if;
  if r.status = 'paid' then return true; end if;
  if r.status not in ('pending', 'failed') or r.method <> 'card' then raise exception 'That receipt can''t be paid by card'; end if;
  if r.amount_pence <> p_amount then
    raise exception 'Amount paid (%) doesn''t match the receipt (%)', p_amount, r.amount_pence;
  end if;
  update member_receipts
     set provider_ref = p_ref, paid_on = (now() at time zone 'Europe/London')::date, status = 'paid'
   where id = p_receipt;   -- the trigger marks the memberships and boat storage paid
  return true;
end $$;
revoke execute on function confirm_card_receipt(uuid, text, integer) from public, anon, authenticated;
grant execute on function confirm_card_receipt(uuid, text, integer) to service_role;

-- Stripe's payment page expired without payment.
create function fail_card_receipt(p_receipt uuid) returns void
language sql security definer set search_path = public as $$
  update member_receipts set status = 'failed' where id = p_receipt and status = 'pending' and method = 'card';
$$;
revoke execute on function fail_card_receipt(uuid) from public, anon, authenticated;
grant execute on function fail_card_receipt(uuid) to service_role;

-- Join form: what to charge for an application that hasn't been paid for yet (null if none).
create function application_to_pay(p_id uuid)
returns table (amount_pence integer, contact_email text, contact_name text, type_name text)
language sql stable security definer set search_path = public as $$
  select a.price_pence + a.boats_pence, a.contact_email, a.contact_name, a.type_name
    from membership_applications a
   where a.id = p_id and a.status = 'pending' and a.paid_at is null
     and a.created_at > now() - interval '1 day'
$$;
revoke execute on function application_to_pay(uuid) from public, anon, authenticated;
grant execute on function application_to_pay(uuid) to service_role;

-- Stripe confirmed the Join payment: hold it on the application until an admin accepts it.
create function confirm_application_card(p_id uuid, p_ref text, p_amount integer) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  a membership_applications;
begin
  select * into a from membership_applications where id = p_id for update;
  if not found then raise exception 'No such application'; end if;
  if a.paid_at is not null then return true; end if;
  if a.price_pence + a.boats_pence <> p_amount then
    raise exception 'Amount paid (%) doesn''t match the application (%)', p_amount, a.price_pence + a.boats_pence;
  end if;
  update membership_applications
     set paid_method = 'card', paid_pence = price_pence, paid_at = now(), provider_ref = p_ref
   where id = p_id;
  return true;
end $$;
revoke execute on function confirm_application_card(uuid, text, integer) from public, anon, authenticated;
grant execute on function confirm_application_card(uuid, text, integer) to service_role;
