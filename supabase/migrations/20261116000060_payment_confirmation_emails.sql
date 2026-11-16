-- Confirmation emails after a card payment.
--
-- Two new kinds of email template (Communications admin > Email templates):
--   join_confirmation     sent to someone who applies on the Join form and pays by card
--   payment_confirmation  sent to a member who pays by card at checkout (renewals, boats)
-- If there's no template of a kind, that email isn't sent. Starter templates are added below for
-- admins to edit. The confirm functions now say whether the payment is newly recorded, so each
-- payment gets one email, though Stripe's webhook and the member's return both record it.

alter table email_templates drop constraint if exists email_templates_purpose_check;
alter table email_templates add constraint email_templates_purpose_check
  check (purpose in ('renewal_reminder', 'general', 'join_confirmation', 'payment_confirmation'));
alter table email_campaigns drop constraint if exists email_campaigns_purpose_check;
alter table email_campaigns add constraint email_campaigns_purpose_check
  check (purpose in ('renewal_reminder', 'general', 'join_confirmation', 'payment_confirmation'));

-- True only the first time (the payment is newly recorded); false if it was already recorded.
create or replace function confirm_card_receipt(p_receipt uuid, p_ref text, p_amount integer) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  r member_receipts;
begin
  select * into r from member_receipts where id = p_receipt for update;
  if not found then raise exception 'No such receipt'; end if;
  if r.status = 'paid' then return false; end if;
  if r.status not in ('pending', 'failed') or r.method <> 'card' then raise exception 'That receipt can''t be paid by card'; end if;
  if r.amount_pence <> p_amount then
    raise exception 'Amount paid (%) doesn''t match the receipt (%)', p_amount, r.amount_pence;
  end if;
  update member_receipts
     set provider_ref = p_ref, paid_on = (now() at time zone 'Europe/London')::date, status = 'paid'
   where id = p_receipt;   -- the trigger marks the memberships and boat storage paid
  return true;
end $$;

create or replace function confirm_application_card(p_id uuid, p_ref text, p_amount integer) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  a membership_applications;
begin
  select * into a from membership_applications where id = p_id for update;
  if not found then raise exception 'No such application'; end if;
  if a.paid_at is not null then return false; end if;
  if a.price_pence + a.boats_pence <> p_amount then
    raise exception 'Amount paid (%) doesn''t match the application (%)', p_amount, a.price_pence + a.boats_pence;
  end if;
  update membership_applications
     set paid_method = 'card', paid_pence = price_pence, paid_at = now(), provider_ref = p_ref
   where id = p_id;
  return true;
end $$;

-- What a confirmation email says about a card payment: who to, what for, how much.
-- p_kind is 'receipt' (checkout) or 'application' (Join form). Server only.
create function card_payment_email(p_kind text, p_id uuid)
returns table (person_id uuid, first_name text, last_name text, email text, membership_type text,
               starts_on date, ends_on date, amount_pence integer, boats text)
language sql stable security definer set search_path = public as $$
  select p.id, p.first_name, p.last_name, p.email,
         (select string_agg(distinct t.name, ', ')
            from member_receipt_lines rl join memberships m on m.id = rl.membership_id
            join membership_types t on t.id = m.membership_type_id where rl.receipt_id = r.id),
         (select min(t.starts_on) from member_receipt_lines rl join memberships m on m.id = rl.membership_id
            join membership_types t on t.id = m.membership_type_id where rl.receipt_id = r.id),
         (select max(t.ends_on) from member_receipt_lines rl join memberships m on m.id = rl.membership_id
            join membership_types t on t.id = m.membership_type_id where rl.receipt_id = r.id),
         r.amount_pence,
         (select string_agg(trim(coalesce(bs.boat_class, '') || ' ' || coalesce(bs.sail_number, '')), ', ' order by bs.created_at)
            from member_receipt_lines rl join boat_storages bs on bs.id = rl.boat_storage_id where rl.receipt_id = r.id)
    from member_receipts r join people p on p.id = r.payer_person_id
   where p_kind = 'receipt' and r.id = p_id
  union all
  select null, trim(a.data->'people'->0->>'first_name'), trim(a.data->'people'->0->>'last_name'), a.contact_email,
         a.type_name, t.starts_on, t.ends_on, a.price_pence + a.boats_pence,
         (select string_agg(trim(coalesce(b->>'boat_class', '') || ' ' || upper(coalesce(b->>'sail_number', ''))), ', ')
            from jsonb_array_elements(coalesce(a.data->'boats', '[]'::jsonb)) b)
    from membership_applications a
    left join membership_types t on t.id = nullif(a.data->>'type_id', '')::uuid
   where p_kind = 'application' and a.id = p_id
$$;
revoke execute on function card_payment_email(text, uuid) from public, anon, authenticated;
grant execute on function card_payment_email(text, uuid) to service_role;

-- Starter templates for admins to edit (or delete, to stop that email).
insert into email_templates (name, purpose, subject, body) values (
  'Join confirmation', 'join_confirmation',
  'Thank you for applying to join Burwain',
  E'Hello {first_name},\n\n'
  'Thank you for applying to join Burwain. We''ve received your payment of {amount_paid} for {membership_type} ({membership_dates}).\n\n'
  'The membership secretary will check your application and email you once it''s accepted. You can then log in with this email address to see and update your details.\n\n'
  'If your application isn''t accepted, your payment will be refunded.\n\n'
  'Burwain membership team'
), (
  'Payment confirmation', 'payment_confirmation',
  'Your Burwain membership payment',
  E'Hello {first_name},\n\n'
  'Thank you. We''ve received your card payment of {amount_paid} for {membership_type} ({membership_dates}).\n\n'
  'You can see your membership at any time by logging in:\n{member_link}\n\n'
  'Burwain membership team'
) on conflict (name) do nothing;
