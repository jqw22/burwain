-- Household leads can add family members, but not with admin-controlled fields set
-- (a login, first joined date or archive date). Admins and the service role are unaffected.
create function people_guard_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or has_role('admin') then
    return new;
  end if;
  if new.auth_user_id is not null or new.first_joined_on is not null or new.archived_at is not null then
    raise exception 'Only an admin can set a login, first joined date or archive status';
  end if;
  return new;
end $$;
revoke execute on function people_guard_insert() from public, anon, authenticated;

create trigger people_guard_insert before insert on people
  for each row execute function people_guard_insert();
