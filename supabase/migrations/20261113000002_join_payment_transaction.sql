-- Join form payments go into the finance transactions straight away (James, 2026-11-13),
-- not only once an admin accepts the application.
--   On paying: a money-in Subscriptions transaction is recorded, paid by the applicant's name.
--   On accepting: the membership is created and marked paid, and a member receipt is recorded
--     and linked to that same transaction (no second transaction).
--   On declining: the transaction stays, so finance can see a refund is needed.

alter table membership_applications add column paid_transaction_id uuid references transactions (id);

create or replace function pay_application_test(p_id uuid, p_method payment_method) returns integer
language plpgsql security definer set search_path = public as $$
declare
  a     membership_applications;
  tx_id uuid;
begin
  if p_method not in ('card', 'direct_debit') then raise exception 'Choose card or Direct Debit'; end if;
  select * into a from membership_applications
   where id = p_id and status = 'pending' and paid_at is null
     and created_at > now() - interval '1 day'   -- only straight after applying
   for update;
  if not found then raise exception 'That application can''t be paid for'; end if;

  insert into transactions (occurred_on, description, direction, amount_pence, category_id, method, membership_type_id, party)
  values ((now() at time zone 'Europe/London')::date, a.type_name || ' (new member application)', 'in', a.price_pence,
          (select id from transaction_categories where name = 'Subscriptions'), p_method,
          (a.data->>'type_id')::uuid, a.contact_name)
  returning id into tx_id;

  update membership_applications
     set paid_method = p_method, paid_pence = price_pence, paid_at = now(), paid_transaction_id = tx_id
   where id = p_id;
  return a.price_pence;
end $$;

create or replace function accept_application(p_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  a       membership_applications;
  new_id  uuid;
  mid     uuid;
  pay_id  uuid;
  line_id uuid;
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
      if a.paid_transaction_id is null then
        -- Paid before transactions were recorded on paying: record it the usual way.
        perform record_test_receipt(new_id, array[mid], a.paid_method, (a.paid_at at time zone 'Europe/London')::date);
      else
        -- Inserted already paid, so the payment trigger doesn't post a second transaction.
        insert into member_receipts (payer_person_id, amount_pence, method, status, paid_on)
        values (new_id, a.paid_pence, a.paid_method, 'paid', (a.paid_at at time zone 'Europe/London')::date)
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
           set receipt_line_id = line_id,
               description = (select description from member_receipt_lines where id = line_id)
         where id = a.paid_transaction_id;
      end if;
    end if;
  end if;
  update membership_applications
     set status = 'accepted', person_id = new_id, reviewed_by = current_person_id(), reviewed_at = now(),
         data = null   -- the details now live on the member record
   where id = p_id;
  return new_id;
end $$;

-- Applications already paid but still waiting: record their transactions now.
do $$ declare a membership_applications; tx_id uuid; begin
  for a in select * from membership_applications where status = 'pending' and paid_at is not null and paid_transaction_id is null loop
    insert into transactions (occurred_on, description, direction, amount_pence, category_id, method, membership_type_id, party)
    values ((a.paid_at at time zone 'Europe/London')::date, a.type_name || ' (new member application)', 'in', a.paid_pence,
            (select id from transaction_categories where name = 'Subscriptions'), a.paid_method,
            (a.data->>'type_id')::uuid, a.contact_name)
    returning id into tx_id;
    update membership_applications set paid_transaction_id = tx_id where id = a.id;
  end loop;
end $$;
