-- Login activity: one row each time someone signs in (with the emailed code or the link).
-- Only superadmins can read it. Rows older than 12 months are removed as new sign-ins arrive.
create table login_activity (
  id            bigint generated always as identity primary key,
  signed_in_at  timestamptz not null default now(),
  auth_user_id  uuid,
  person_id     uuid references people (id) on delete cascade,
  email         text,
  method        text not null check (method in ('code', 'link', 'earlier')),
  device        text
);
create index login_activity_signed_in_at on login_activity (signed_in_at desc);
create index login_activity_person on login_activity (person_id);

alter table login_activity enable row level security;
create policy login_activity_super on login_activity for select to authenticated using (has_role('superadmin'));
revoke insert, update, delete on login_activity from anon, authenticated;

-- Called by the app straight after a successful sign-in. It also links the login to the member
-- record with the same email (as Home does on a first sign-in), so the log can show a name.
create function record_sign_in(p_method text, p_device text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid;
begin
  if auth.uid() is null then raise exception 'Not logged in'; end if;
  if p_method not in ('code', 'link') then raise exception 'Unknown sign-in method'; end if;
  me := link_my_account();
  insert into login_activity (auth_user_id, person_id, email, method, device)
  values (auth.uid(), me, lower(nullif(auth.jwt() ->> 'email', '')), p_method, left(p_device, 80));
  delete from login_activity where signed_in_at < now() - interval '12 months';
end $$;
revoke execute on function record_sign_in(text, text) from public, anon;
grant execute on function record_sign_in(text, text) to authenticated;

-- Start the log with each login's last sign-in before this was added.
insert into login_activity (signed_in_at, auth_user_id, person_id, email, method)
select u.last_sign_in_at, u.id, p.id, lower(u.email), 'earlier'
  from auth.users u
  left join people p on p.auth_user_id = u.id
 where u.last_sign_in_at is not null
   and u.last_sign_in_at >= now() - interval '12 months';
