-- Members who aren't in a family group yet (for example someone added on their own) can set one
-- up themselves from Your details. They become its main contact and can then add family members.

create function create_my_household(p_address_line1 text, p_address_line2 text, p_address_line3 text,
                                    p_address_line4 text, p_postcode text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me uuid := current_person_id();
  hh uuid;
begin
  if me is null then raise exception 'Not logged in'; end if;
  if (select household_id from people where id = me) is not null then
    raise exception 'You are already in a family group';
  end if;
  insert into households (address_line1, address_line2, address_line3, address_line4, postcode, lead_person_id)
  values (nullif(trim(p_address_line1), ''), nullif(trim(p_address_line2), ''), nullif(trim(p_address_line3), ''),
          nullif(trim(p_address_line4), ''), nullif(upper(trim(p_postcode)), ''), me)
  returning id into hh;
  perform set_config('app.creating_household', 'on', true);
  update people set household_id = hh where id = me;
  perform set_config('app.creating_household', 'off', true);
  return hh;
end $$;

revoke execute on function create_my_household(text, text, text, text, text) from public, anon;
grant execute on function create_my_household(text, text, text, text, text) to authenticated;

-- Let the field guard accept exactly this change: the caller joining the household they just created.
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
  if current_setting('app.creating_household', true) = 'on'
     and old.household_id is null and new.id = current_person_id()
     and new.auth_user_id is not distinct from old.auth_user_id
     and new.first_joined_on is not distinct from old.first_joined_on
     and new.archived_at is not distinct from old.archived_at
     and exists (select 1 from households h where h.id = new.household_id and h.lead_person_id = new.id) then
    return new;   -- create_my_household()
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
