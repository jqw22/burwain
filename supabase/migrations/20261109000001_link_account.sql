-- Link a signed-in login to the member record with the same email address.
-- Members are imported from the spreadsheet without logins; the first time someone signs in
-- with the email we hold for them, their login is attached to that record.
create function link_my_account()
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  existing uuid := current_person_id();
  my_email text := lower(nullif(auth.jwt() ->> 'email', ''));
  match    uuid;
  matches  int;
begin
  if auth.uid() is null then raise exception 'Not logged in'; end if;
  if existing is not null then return existing; end if;
  if my_email is null then return null; end if;

  -- Adults (or unknown age) with this email and no login yet.
  select count(*), min(id::text)::uuid into matches, match
    from people
   where lower(email) = my_email
     and auth_user_id is null
     and archived_at is null
     and (date_of_birth is null or date_of_birth <= current_date - interval '18 years');

  if matches <> 1 then
    return null;   -- none, or ambiguous: an admin links it by hand
  end if;

  perform set_config('app.linking_account', 'on', true);
  update people set auth_user_id = auth.uid() where id = match;
  perform set_config('app.linking_account', 'off', true);
  return match;
end $$;

-- Let the field guard accept exactly this change: an unlinked record taking the caller's own login.
create or replace function people_guard_admin_fields() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or has_role('admin') then
    return new;   -- service role / migrations / admins
  end if;
  if current_setting('app.linking_account', true) = 'on'
     and old.auth_user_id is null and new.auth_user_id = auth.uid() then
    return new;   -- link_my_account()
  end if;
  if new.auth_user_id    is distinct from old.auth_user_id
  or new.first_joined_on is distinct from old.first_joined_on
  or new.archived_at     is distinct from old.archived_at
  or new.household_id    is distinct from old.household_id then
    raise exception 'Only an admin can change login, first joined date, household or archive status';
  end if;
  if new.news_consent is distinct from old.news_consent then
    new.news_consent_at := case when new.news_consent then now() else null end;
  end if;
  return new;
end $$;
revoke execute on function people_guard_admin_fields() from public, anon, authenticated;

revoke execute on function link_my_account() from public, anon;
grant execute on function link_my_account() to authenticated;
