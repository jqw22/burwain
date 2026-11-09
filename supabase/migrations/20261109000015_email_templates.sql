-- Email templates that club admins write in plain text, with {placeholders} filled in per member
-- when the email is sent (for example {first_name} or {renewal_link}). Each template has a purpose,
-- so the app knows which one to use for renewal reminders.

alter table email_templates rename column body_html to body;
alter table email_templates
  add column purpose    text not null default 'general' check (purpose in ('renewal_reminder', 'general')),
  add column updated_by uuid references people (id) on delete set null,
  add constraint email_templates_name_present check (length(trim(name)) > 0),
  add constraint email_templates_subject_present check (length(trim(subject)) > 0);

create trigger email_templates_touch before update on email_templates for each row execute function touch_updated_at();
create trigger audit after insert or update or delete on email_templates for each row execute function audit_row();

-- A starter reminder for admins to edit.
insert into email_templates (name, purpose, subject, body) values (
  'Renewal reminder', 'renewal_reminder',
  'Time to renew your Burwain membership for {renewal_year}',
  E'Hello {first_name},\n\n'
  'Membership renewals for {renewal_year} are now open.\n\n'
  'Your current membership is {membership_type}. Renewing it for {renewal_year} costs {renewal_price}.\n\n'
  'To renew, log in and go to Your details:\n{renewal_link}\n\n'
  'If anything has changed, or you''d like a different membership, please reply to this email and the membership secretary will help.\n\n'
  'Thank you for being part of the club.\n\n'
  'Burwain membership team'
) on conflict (name) do nothing;

-- Only one template is used for renewal reminders.
create unique index email_templates_one_renewal_reminder on email_templates (purpose) where purpose = 'renewal_reminder';
