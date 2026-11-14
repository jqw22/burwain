-- Roles and club titles.
--  * Superadmins give members access (Admin, Finance, Superadmin) from the member's page.
--    A member needs an email address (their login) to have access, and the club always keeps
--    at least one superadmin.
--  * Finance logins can look at (not change) the Membership and Communications areas, as admins
--    already can with Finance. Medical information stays admins only.
--  * Club titles (for example Commodore or Treasurer): a list kept by superadmins, given to any
--    member, with or without admin access, and shown at the top of the Directory.

-- ---------------------------------------------------------------------------
-- Finance can read the Membership and Communications areas
-- ---------------------------------------------------------------------------
drop policy people_select on people;
create policy people_select on people for select to authenticated
  using (id = current_person_id() or household_id = my_household_id() or has_role('admin') or has_role('finance'));

drop policy hh_select on households;
create policy hh_select on households for select to authenticated
  using (id = my_household_id() or has_role('admin') or has_role('finance'));

drop policy quals_select on qualifications;
create policy quals_select on qualifications for select to authenticated
  using (person_id = current_person_id()
         or person_id in (select id from people where household_id = my_household_id())
         or has_role('admin') or has_role('finance'));

drop policy applications_admin_read on membership_applications;
create policy applications_admin_read on membership_applications for select to authenticated
  using (has_role('admin') or has_role('finance'));

drop policy roles_select on user_roles;
create policy roles_select on user_roles for select to authenticated
  using (person_id = current_person_id() or has_role('admin') or has_role('finance'));

create policy et_finance_read on email_templates  for select to authenticated using (has_role('finance'));
create policy ec_finance_read on email_campaigns  for select to authenticated using (has_role('finance'));
create policy er_finance_read on email_recipients for select to authenticated using (has_role('finance'));
create policy ei_finance_read on email_images     for select to authenticated using (has_role('finance'));

CREATE OR REPLACE FUNCTION public.pending_applications()
 RETURNS TABLE(id uuid, created_at timestamp with time zone, contact_name text, contact_email text, type_name text, club_year text, people_count integer, price_pence integer, people text, postcode text, has_medical boolean, paid_method payment_method, paid_pence integer, paid_at timestamp with time zone, boats text, boats_pence integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select a.id, a.created_at, a.contact_name, a.contact_email, a.type_name,
         (select to_char(t.starts_on, 'FMDD Mon YYYY') || ' to ' || to_char(t.ends_on, 'FMDD Mon YYYY')
            from membership_types t where t.id = (a.data->>'type_id')::uuid),
         a.people_count, a.price_pence,
         (select string_agg(concat_ws(' ', x->>'first_name', x->>'last_name')
                 || coalesce(' (born ' || to_char((x->>'date_of_birth')::date, 'DD/MM/YYYY') || ')', ''), ', ')
            from jsonb_array_elements(a.data->'people') x),
         upper(a.data->>'postcode'),
         exists (select 1 from jsonb_array_elements(a.data->'people') x where nullif(trim(x->>'medical_details'), '') is not null),
         a.paid_method, a.paid_pence, a.paid_at,
         (select string_agg(concat_ws(' ', trim(b->>'boat_class'), upper(trim(b->>'sail_number'))), ', ')
            from jsonb_array_elements(coalesce(a.data->'boats', '[]'::jsonb)) b),
         a.boats_pence
    from membership_applications a
   where a.status = 'pending' and (has_role('admin') or has_role('finance'))
   order by a.created_at
$function$;


CREATE OR REPLACE FUNCTION public.renewal_reminder_recipients(p_template_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(person_id uuid, first_name text, last_name text, email text, membership_types text, renewal_price_pence integer, last_reminded_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not (has_role('admin') or has_role('finance')) then raise exception 'Admins and finance only'; end if;
  return query
  with due as (
    select m.id, m.membership_type_id, t.ends_on,
           coalesce(h.lead_person_id, m.payer_person_id) as renewer
      from memberships m
      join membership_types t on t.id = m.membership_type_id
      left join households h on h.id = m.household_id
     where m.status in ('active', 'awaiting_payment', 'lapsed')
       -- From the renewal notice before it ends until 90 days after it ended (lapsed members,
       -- matching the Members list's Renewal column); a membership marked lapsed early counts too.
       and club_today() <= t.ends_on + 90
       and (club_today() >= t.ends_on - renewal_notice_days() or m.status = 'lapsed')
       and exists (select 1 from membership_people mp join people p on p.id = mp.person_id
                    where mp.membership_id = m.id and p.archived_at is null
                      and not exists (select 1 from membership_people x
                                        join memberships y on y.id = x.membership_id
                                        join membership_types u on u.id = y.membership_type_id
                                       where x.person_id = mp.person_id and y.status <> 'cancelled'
                                         and u.starts_on > t.starts_on))
  )
  select p.id, p.first_name, p.last_name, p.email,
         string_agg(t.name, ', ' order by t.sort_order),
         sum(coalesce((select nt.annual_price_pence from membership_types nt
                        where nt.code = t.code and nt.is_open and nt.starts_on > t.ends_on
                        order by nt.starts_on limit 1), t.annual_price_pence))::int,
         (select max(r.sent_at) from email_recipients r join email_campaigns c on c.id = r.campaign_id
           where r.person_id = p.id and r.status = 'sent' and c.purpose = 'renewal_reminder'
             and (p_template_id is null or c.template_id = p_template_id)
             and r.sent_at >= min(d.ends_on) - renewal_notice_days())
    from due d
    join people p on p.id = d.renewer and p.archived_at is null
    join membership_types t on t.id = d.membership_type_id
   group by p.id, p.first_name, p.last_name, p.email
   order by p.last_name, p.first_name;
end $function$;


-- ---------------------------------------------------------------------------
-- Giving members access (superadmins only)
-- ---------------------------------------------------------------------------
create or replace function set_member_roles(p_person uuid, p_roles app_role[])
returns void language plpgsql security definer set search_path = public as $$
declare
  v_roles app_role[] := coalesce(p_roles, '{}');
begin
  if not has_role('superadmin') then raise exception 'Superadmins only'; end if;
  if not exists (select 1 from people where id = p_person and archived_at is null) then
    raise exception 'Member not found';
  end if;
  if cardinality(v_roles) > 0
     and not exists (select 1 from people where id = p_person and nullif(trim(email), '') is not null) then
    raise exception 'A member needs an email address (their login) before they can have access';
  end if;
  if not ('superadmin' = any (v_roles))
     and exists (select 1 from user_roles where person_id = p_person and role = 'superadmin')
     and (select count(*) from user_roles where role = 'superadmin') = 1 then
    raise exception 'The club must keep at least one superadmin';
  end if;
  delete from user_roles where person_id = p_person and not (role = any (v_roles));
  insert into user_roles (person_id, role, granted_by)
  select p_person, r, current_person_id() from unnest(v_roles) r
  on conflict (person_id, role) do nothing;
end $$;
revoke execute on function set_member_roles(uuid, app_role[]) from public, anon;
grant execute on function set_member_roles(uuid, app_role[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Club titles
-- ---------------------------------------------------------------------------
create table club_titles (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) between 1 and 60),
  sort_order  integer not null default 100,   -- order in the Directory (lowest first)
  is_active   boolean not null default true,   -- titles are never deleted, only made inactive
  created_at  timestamptz not null default now()
);
create unique index club_titles_name_key on club_titles (lower(trim(name)));

create table person_titles (
  person_id   uuid not null references people (id) on delete cascade,
  title_id    uuid not null references club_titles (id),
  granted_by  uuid references people (id),
  granted_at  timestamptz not null default now(),
  primary key (person_id, title_id)
);

create trigger audit after insert or update or delete on club_titles   for each row execute function audit_row();
create trigger audit after insert or update or delete on person_titles for each row execute function audit_row();

alter table club_titles   enable row level security;
alter table person_titles enable row level security;
create policy titles_read  on club_titles for select to authenticated using (current_person_id() is not null);
create policy titles_write on club_titles for all    to authenticated using (has_role('superadmin')) with check (has_role('superadmin'));
create policy pt_read  on person_titles for select to authenticated
  using (person_id = current_person_id() or has_role('admin') or has_role('finance'));
create policy pt_write on person_titles for all to authenticated using (has_role('superadmin')) with check (has_role('superadmin'));
revoke all on club_titles, person_titles from anon;
grant select, insert, update, delete on club_titles, person_titles to authenticated;

-- Give a member a title by name, adding it to the list if it's new (or making it active again).
create or replace function add_person_title(p_person uuid, p_title text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_name text := regexp_replace(trim(coalesce(p_title, '')), '\s+', ' ', 'g');
  v_id uuid;
begin
  if not has_role('superadmin') then raise exception 'Superadmins only'; end if;
  if v_name = '' then raise exception 'Give the title a name'; end if;
  select id into v_id from club_titles where lower(trim(name)) = lower(v_name);
  if v_id is null then
    insert into club_titles (name, sort_order)
    values (v_name, coalesce((select max(sort_order) from club_titles), 0) + 10)
    returning id into v_id;
  else
    update club_titles set is_active = true where id = v_id and not is_active;
  end if;
  insert into person_titles (person_id, title_id, granted_by)
  values (p_person, v_id, current_person_id())
  on conflict do nothing;
end $$;
revoke execute on function add_person_title(uuid, text) from public, anon;
grant execute on function add_person_title(uuid, text) to authenticated;

-- The Directory's top box: everyone holding an active club title, in the titles' order.
-- A title is a club role, so title holders are listed even if they opted out of the member list.
create or replace function directory_titles()
returns table (title text, id uuid, first_name text, last_name text, mobile text, email text, whatsapp boolean)
language sql stable security definer set search_path = public as $$
  select t.name, p.id, p.first_name, p.last_name, p.mobile, p.email, p.whatsapp
    from person_titles pt
    join club_titles t on t.id = pt.title_id and t.is_active
    join people p on p.id = pt.person_id and p.archived_at is null
   where current_person_id() is not null
   order by t.sort_order, t.name, p.last_name, p.first_name
$$;
revoke execute on function directory_titles() from public, anon;
grant execute on function directory_titles() to authenticated;
