-- Volunteering: jobs that need doing, and who has put their name down for each.
-- Admins add, edit and finish jobs. Members click "+" to put their name down (adults only for
-- themselves); a family's main contact can also put down anyone in their family, juniors included.
-- Members see the names of volunteers who are in the Directory (adult members who haven't opted out)
-- and their own family; anyone else is counted but not named. Admins see every name.
-- Sign-ups on finished jobs are kept, so volunteering can be reported per member later.

create table volunteer_jobs (
  id             uuid primary key default gen_random_uuid(),
  title          text not null check (length(trim(title)) > 0),
  description    text not null default '',
  job_date       date,                                             -- blank = any time
  helpers_needed integer check (helpers_needed is null or helpers_needed > 0),  -- blank = no limit
  done_at        timestamptz,                                      -- set when an admin marks it done
  done_by        uuid references people (id) on delete set null,
  created_at     timestamptz not null default now(),
  created_by     uuid references people (id) on delete set null,
  updated_at     timestamptz not null default now(),
  updated_by     uuid references people (id) on delete set null
);

create table volunteer_signups (
  job_id       uuid not null references volunteer_jobs (id) on delete restrict,
  person_id    uuid not null references people (id) on delete cascade,
  signed_up_by uuid references people (id) on delete set null,
  created_at   timestamptz not null default now(),
  primary key (job_id, person_id)
);
create index volunteer_signups_person on volunteer_signups (person_id);

create trigger volunteer_jobs_touch before update on volunteer_jobs
  for each row execute function touch_updated_at();
create trigger audit after insert or update or delete on volunteer_jobs
  for each row execute function audit_row();

alter table volunteer_jobs enable row level security;
alter table volunteer_signups enable row level security;

-- Everyone signed in can read jobs; only admins change them. A job can be deleted only while nobody
-- has signed up (otherwise mark it done, which keeps the record).
create policy volunteer_jobs_read on volunteer_jobs for select to authenticated
  using (current_person_id() is not null);
create policy volunteer_jobs_admin_insert on volunteer_jobs for insert to authenticated
  with check (has_role('admin'));
create policy volunteer_jobs_admin_update on volunteer_jobs for update to authenticated
  using (has_role('admin')) with check (has_role('admin'));
create policy volunteer_jobs_admin_delete on volunteer_jobs for delete to authenticated
  using (has_role('admin'));

-- Admins and finance can read every sign-up (for organising and reporting). Members read sign-ups
-- through volunteer_signup_names() below, which hides names they shouldn't see. All changes go
-- through volunteer_sign_up() / volunteer_withdraw().
create policy volunteer_signups_admin_read on volunteer_signups for select to authenticated
  using (has_role('admin') or has_role('finance'));

-- Is this person in a current or upcoming membership?
create or replace function is_current_member(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from membership_people mp
      join memberships m on m.id = mp.membership_id
      join membership_types t on t.id = m.membership_type_id
     where mp.person_id = p and t.ends_on >= club_today() and m.status in ('active', 'awaiting_payment'))
$$;

-- May the signed-in member put this person's name down (or take it off), leaving admin rights aside?
-- Themselves if an adult member; anyone in their family if they are the family's main contact.
create or replace function is_my_volunteer(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from people x
                  where x.id = p and x.archived_at is null
                    and ((x.id = current_person_id()
                          and (x.date_of_birth is null or x.date_of_birth <= current_date - interval '18 years')
                          and is_current_member(x.id))
                      or (x.household_id is not null and is_household_lead(x.household_id))))
$$;

-- Admins may put anyone down; everyone else as above.
create or replace function can_volunteer_for(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select has_role('admin') or is_my_volunteer(p)
$$;

-- The people the signed-in member can put down: themselves (if allowed) and, for main contacts, their family.
create or replace function my_volunteer_people()
returns table (id uuid, first_name text, last_name text, is_me boolean)
language sql stable security definer set search_path = public as $$
  select x.id, x.first_name, x.last_name, x.id = current_person_id()
    from people x
   where (x.id = current_person_id() or x.household_id = my_household_id())
     and is_my_volunteer(x.id)
   order by x.id <> current_person_id(), x.date_of_birth nulls last, x.first_name
$$;

-- Sign-ups on jobs that aren't done, as a member may see them: names only for people in the
-- Directory or in their own family (admins see all). Hidden people come back with no name or id.
create or replace function volunteer_signup_names()
returns table (job_id uuid, person_id uuid, first_name text, last_name text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select s.job_id,
         case when shown then p.id end,
         case when shown then p.first_name end,
         case when shown then p.last_name end,
         s.created_at
    from volunteer_signups s
    join volunteer_jobs j on j.id = s.job_id and j.done_at is null
    join people p on p.id = s.person_id
    cross join lateral (select
         has_role('admin') or has_role('finance')
         or (p.household_id is not null and p.household_id = my_household_id())
         or p.id = current_person_id()
         or (not p.directory_opt_out and p.archived_at is null
             and p.date_of_birth <= current_date - interval '18 years'
             and is_current_member(p.id)) as shown) v
   where current_person_id() is not null
   order by s.created_at
$$;

create or replace function volunteer_sign_up(p_job uuid, p_person uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  j volunteer_jobs;
begin
  if not can_volunteer_for(p_person) then
    raise exception 'You can only put down yourself or your own family';
  end if;
  select * into j from volunteer_jobs where id = p_job for update;
  if j.id is null or j.done_at is not null then
    raise exception 'This job is no longer open';
  end if;
  if exists (select 1 from volunteer_signups where job_id = p_job and person_id = p_person) then
    return;
  end if;
  if j.helpers_needed is not null
     and (select count(*) from volunteer_signups where job_id = p_job) >= j.helpers_needed then
    raise exception 'This job already has all the helpers it needs';
  end if;
  insert into volunteer_signups (job_id, person_id, signed_up_by) values (p_job, p_person, current_person_id());
end $$;

create or replace function volunteer_withdraw(p_job uuid, p_person uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_volunteer_for(p_person) then
    raise exception 'You can only take off yourself or your own family';
  end if;
  -- Finished jobs keep their helpers for the record (admins can still correct them).
  if not has_role('admin') and exists (select 1 from volunteer_jobs where id = p_job and done_at is not null) then
    raise exception 'This job is no longer open';
  end if;
  delete from volunteer_signups where job_id = p_job and person_id = p_person;
end $$;

revoke execute on function is_current_member(uuid), is_my_volunteer(uuid), can_volunteer_for(uuid), my_volunteer_people(),
  volunteer_signup_names(), volunteer_sign_up(uuid, uuid), volunteer_withdraw(uuid, uuid) from public, anon;
grant execute on function is_current_member(uuid), is_my_volunteer(uuid), can_volunteer_for(uuid), my_volunteer_people(),
  volunteer_signup_names(), volunteer_sign_up(uuid, uuid), volunteer_withdraw(uuid, uuid) to authenticated;
