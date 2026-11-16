-- Club calendar: events shown as an agenda (a list by date).
-- Each event has a type (sailing, meeting, training, other), a title, a date and a start time.
-- Sailing events need an Officer and an Assistant; training events need a Trainer. Admins can fill
-- these from the event form, and an adult member can also put themselves forward for an empty one.
-- Members say they are going with "+" buttons, using the same rules as volunteering: adults for
-- themselves, a family's main contact for anyone in their family (juniors included). Names follow the
-- volunteering rules too: members see names of people in the Directory and their own family; anyone
-- else is counted but not named. Admins see every name.

create table calendar_events (
  id          uuid primary key default gen_random_uuid(),
  event_type  text not null check (event_type in ('sailing', 'meeting', 'training', 'other')),
  title       text not null check (length(trim(title)) > 0),
  event_date  date not null,
  start_time  time not null,
  created_at  timestamptz not null default now(),
  created_by  uuid references people (id) on delete set null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references people (id) on delete set null
);
create index calendar_events_date on calendar_events (event_date, start_time);

-- Which duties each type of event needs.
create or replace function calendar_duty_allowed(p_type text, p_role text) returns boolean
language sql immutable as $$
  select (p_type = 'sailing' and p_role in ('officer', 'assistant')) or (p_type = 'training' and p_role = 'trainer')
$$;

create table calendar_duties (
  event_id    uuid not null references calendar_events (id) on delete cascade,
  role        text not null check (role in ('officer', 'assistant', 'trainer')),
  person_id   uuid not null references people (id) on delete cascade,
  assigned_by uuid references people (id) on delete set null,
  created_at  timestamptz not null default now(),
  primary key (event_id, role)
);
create index calendar_duties_person on calendar_duties (person_id);

create table calendar_attendance (
  event_id     uuid not null references calendar_events (id) on delete cascade,
  person_id    uuid not null references people (id) on delete cascade,
  signed_up_by uuid references people (id) on delete set null,
  created_at   timestamptz not null default now(),
  primary key (event_id, person_id)
);
create index calendar_attendance_person on calendar_attendance (person_id);

create trigger calendar_events_touch before update on calendar_events
  for each row execute function touch_updated_at();
create trigger audit after insert or update or delete on calendar_events
  for each row execute function audit_row();

-- If an event's type changes, drop duties the new type doesn't have (e.g. sailing -> meeting).
create or replace function calendar_events_drop_duties() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.event_type is distinct from old.event_type then
    delete from calendar_duties where event_id = new.id and not calendar_duty_allowed(new.event_type, role);
  end if;
  return new;
end $$;
create trigger calendar_events_drop_duties after update on calendar_events
  for each row execute function calendar_events_drop_duties();

alter table calendar_events enable row level security;
alter table calendar_duties enable row level security;
alter table calendar_attendance enable row level security;

-- Everyone signed in can read events; only admins add, change or delete them.
create policy calendar_events_read on calendar_events for select to authenticated
  using (current_person_id() is not null);
create policy calendar_events_admin_insert on calendar_events for insert to authenticated
  with check (has_role('admin'));
create policy calendar_events_admin_update on calendar_events for update to authenticated
  using (has_role('admin')) with check (has_role('admin'));
create policy calendar_events_admin_delete on calendar_events for delete to authenticated
  using (has_role('admin'));

-- Admins and finance can read duties and attendance directly. Members read them through
-- calendar_people() below, which hides names they shouldn't see. Changes go through the functions.
create policy calendar_duties_admin_read on calendar_duties for select to authenticated
  using (has_role('admin') or has_role('finance'));
create policy calendar_attendance_admin_read on calendar_attendance for select to authenticated
  using (has_role('admin') or has_role('finance'));

-- Can this person be named to the signed-in member? (Same rule as volunteering.)
create or replace function calendar_name_shown(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select has_role('admin') or has_role('finance')
      or exists (select 1 from people x
                  where x.id = p
                    and (x.id = current_person_id()
                         or (x.household_id is not null and x.household_id = my_household_id())
                         or (not x.directory_opt_out and x.archived_at is null
                             and x.date_of_birth <= current_date - interval '18 years'
                             and is_current_member(x.id))))
$$;

-- Duties and attendance for events between two dates. kind is 'officer', 'assistant', 'trainer'
-- or 'attending'. People the member may not see come back with no id or name.
create or replace function calendar_people(p_from date, p_to date)
returns table (event_id uuid, kind text, person_id uuid, first_name text, last_name text)
language sql stable security definer set search_path = public as $$
  select r.event_id, r.kind,
         case when shown then p.id end,
         case when shown then p.first_name end,
         case when shown then p.last_name end
    from (select d.event_id, d.role as kind, d.person_id, d.created_at from calendar_duties d
          union all
          select a.event_id, 'attending', a.person_id, a.created_at from calendar_attendance a) r
    join calendar_events e on e.id = r.event_id and e.event_date between p_from and p_to
    join people p on p.id = r.person_id
    cross join lateral (select calendar_name_shown(p.id) as shown) v
   where current_person_id() is not null
   order by r.created_at
$$;

-- Put a name down as going (or take it off). Same people as volunteering: adults for themselves,
-- main contacts for their family; admins for anyone. Members can't change past events.
create or replace function calendar_attend(p_event uuid, p_person uuid, p_going boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  e calendar_events;
begin
  if not can_volunteer_for(p_person) then
    raise exception 'You can only put down yourself or your own family';
  end if;
  select * into e from calendar_events where id = p_event;
  if e.id is null then
    raise exception 'This event is no longer on the calendar';
  end if;
  if e.event_date < club_today() and not has_role('admin') then
    raise exception 'This event has already happened';
  end if;
  if p_going then
    insert into calendar_attendance (event_id, person_id, signed_up_by)
    values (p_event, p_person, current_person_id())
    on conflict do nothing;
  else
    delete from calendar_attendance where event_id = p_event and person_id = p_person;
  end if;
end $$;

-- Fill or clear a duty. Admins can set anyone (or clear it). Members can take an empty duty for
-- themselves if they are an adult member, and give up a duty they hold. Not on past events.
create or replace function calendar_set_duty(p_event uuid, p_role text, p_person uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  e calendar_events;
  holder uuid;
  me uuid := current_person_id();
begin
  select * into e from calendar_events where id = p_event for update;
  if e.id is null then
    raise exception 'This event is no longer on the calendar';
  end if;
  if not calendar_duty_allowed(e.event_type, p_role) then
    raise exception 'This event does not have that duty';
  end if;
  select person_id into holder from calendar_duties where event_id = p_event and role = p_role;

  if not has_role('admin') then
    if e.event_date < club_today() then
      raise exception 'This event has already happened';
    end if;
    if p_person is null then
      if holder is distinct from me then
        raise exception 'You can only give up your own duty';
      end if;
    else
      if p_person <> me or not exists (
           select 1 from people x where x.id = me and x.archived_at is null
              and (x.date_of_birth is null or x.date_of_birth <= current_date - interval '18 years')
              and is_current_member(x.id)) then
        raise exception 'Only adult members can take a duty, for themselves';
      end if;
      if holder is not null and holder <> me then
        raise exception 'Someone has already taken this duty';
      end if;
    end if;
  end if;

  if p_person is null then
    delete from calendar_duties where event_id = p_event and role = p_role;
  elsif holder is distinct from p_person then
    insert into calendar_duties (event_id, role, person_id, assigned_by)
    values (p_event, p_role, p_person, me)
    on conflict (event_id, role) do update
      set person_id = excluded.person_id, assigned_by = excluded.assigned_by, created_at = now();
  end if;
end $$;

-- Adult current members, for the admin's Officer / Assistant / Trainer lists.
create or replace function calendar_duty_people()
returns table (id uuid, first_name text, last_name text)
language sql stable security definer set search_path = public as $$
  select x.id, x.first_name, x.last_name
    from people x
   where has_role('admin') and x.archived_at is null
     and (x.date_of_birth is null or x.date_of_birth <= current_date - interval '18 years')
     and is_current_member(x.id)
   order by x.last_name, x.first_name
$$;

revoke execute on function calendar_name_shown(uuid), calendar_people(date, date), calendar_attend(uuid, uuid, boolean),
  calendar_set_duty(uuid, text, uuid), calendar_duty_people() from public, anon;
grant execute on function calendar_name_shown(uuid), calendar_people(date, date), calendar_attend(uuid, uuid, boolean),
  calendar_set_duty(uuid, text, uuid), calendar_duty_people() to authenticated;
