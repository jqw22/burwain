-- Group emails from Communications admin: send an email to members (current, future and lapsed)
-- and contacts. Juniors (under 18) and anyone without an email address are never included.
-- Every group email has an unsubscribe link (UK GDPR); people who unsubscribe are left out of
-- later group emails. Images for emails (including a club logo shown at the top) are stored here too.

-- Unsubscribing --------------------------------------------------------------------------------
alter table people
  add column unsubscribe_token     uuid not null default gen_random_uuid(),
  add column emails_unsubscribed_at timestamptz;
create unique index people_unsubscribe_token on people (unsubscribe_token);
comment on column people.unsubscribe_token is 'Secret in the unsubscribe link of group emails.';
comment on column people.emails_unsubscribed_at is 'When they unsubscribed from group emails (null = subscribed).';

-- Anyone with the link can unsubscribe (no login needed). Also turns off club news consent.
-- Returns the first name, or null if the link isn't recognised.
create function unsubscribe_by_token(p_token uuid)
returns text language plpgsql security definer set search_path = public as $$
declare name text;
begin
  update people
     set emails_unsubscribed_at = coalesce(emails_unsubscribed_at, now()), news_consent = false
   where unsubscribe_token = p_token
  returning first_name into name;
  return name;
end $$;
revoke execute on function unsubscribe_by_token(uuid) from public;
grant execute on function unsubscribe_by_token(uuid) to anon, authenticated;

-- Who a group email can go to ------------------------------------------------------------------
-- status: current (membership running today), future (starts later), lapsed (ended), contact
-- (on the email list with no membership). People with no membership who aren't contacts are left out,
-- as are applications not yet accepted.
create function group_email_recipients()
returns table (person_id uuid, first_name text, last_name text, email text, status text, unsubscribed_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not has_role('admin') then raise exception 'Admins only'; end if;
  return query
  with held as (
    select mp.person_id,
           bool_or(m.status not in ('lapsed') and t.starts_on <= club_today() and t.ends_on >= club_today()) as is_current,
           bool_or(m.status not in ('lapsed') and t.starts_on > club_today()) as is_future
      from membership_people mp
      join memberships m on m.id = mp.membership_id
      join membership_types t on t.id = m.membership_type_id
     where m.status not in ('cancelled', 'pending_approval')
     group by mp.person_id
  )
  select p.id, p.first_name, p.last_name, p.email,
         case when h.is_current then 'current'
              when h.is_future then 'future'
              when h.person_id is not null then 'lapsed'
              else 'contact' end,
         p.emails_unsubscribed_at
    from people p
    left join held h on h.person_id = p.id
   where p.archived_at is null
     and nullif(trim(p.email), '') is not null
     and (p.date_of_birth is null or p.date_of_birth <= club_today() - interval '18 years')
     and (h.person_id is not null or p.is_contact)
   order by p.last_name, p.first_name;
end $$;
revoke execute on function group_email_recipients() from public, anon;
grant execute on function group_email_recipients() to authenticated;

-- Email images ---------------------------------------------------------------------------------
-- Small images (resized before upload) kept in the database and served by the app at
-- /email-images/<id>, so they show in members' inboxes. One can be the club logo.
create table email_images (
  id            uuid primary key default gen_random_uuid(),
  content_type  text not null check (content_type in ('image/jpeg', 'image/png', 'image/gif', 'image/webp')),
  data          bytea not null check (octet_length(data) <= 3 * 1024 * 1024),
  is_logo       boolean not null default false,
  created_by    uuid references people (id) on delete set null,
  created_at    timestamptz not null default now()
);
create unique index email_images_one_logo on email_images (is_logo) where is_logo;
alter table email_images enable row level security;
create policy email_images_admin on email_images for all to authenticated
  using (has_role('admin')) with check (has_role('admin'));

-- Anyone can fetch an image by its (unguessable) id, as email inboxes do.
create function email_image(p_id uuid)
returns table (content_type text, data_base64 text)
language sql stable security definer set search_path = public as $$
  select content_type, encode(data, 'base64') from email_images where id = p_id
$$;
revoke execute on function email_image(uuid) from public;
grant execute on function email_image(uuid) to anon, authenticated;
