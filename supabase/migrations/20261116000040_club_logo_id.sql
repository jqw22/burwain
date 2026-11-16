-- The club logo (uploaded on the email Templates page) is also shown in the app's top bar,
-- including to members and to visitors on the login and Join pages, who can't read email_images.
-- This gives just the logo's id; the image itself is served at /email-images/<id>.
create or replace function club_logo_id()
returns uuid
language sql stable security definer set search_path = public as $$
  select id from email_images where is_logo
$$;
revoke execute on function club_logo_id() from public;
grant execute on function club_logo_id() to anon, authenticated;
