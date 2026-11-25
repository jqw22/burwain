-- Login activity is for named superadmins only (James, for now). Being a superadmin isn't enough:
-- the person must also be listed here. The list is changed only in the Supabase SQL Editor.
create table login_activity_viewers (
  person_id uuid primary key references people (id) on delete cascade
);
alter table login_activity_viewers enable row level security;
revoke all on login_activity_viewers from anon, authenticated;

create function can_view_login_activity()
returns boolean
language sql stable security definer set search_path = public as $$
  select has_role('superadmin')
     and exists (select 1 from login_activity_viewers where person_id = current_person_id())
$$;
revoke execute on function can_view_login_activity() from public, anon;
grant execute on function can_view_login_activity() to authenticated;

drop policy login_activity_super on login_activity;
create policy login_activity_viewer on login_activity for select to authenticated using (can_view_login_activity());
