-- Club news: short posts shown in a box on the Home page. Every signed-in member can read them;
-- admins add, edit and delete them. The text is formatted (HTML), cleaned by the app before saving,
-- and can include pictures uploaded through the existing email image store (/email-images/<id>).
-- A group email can also be posted as news; email_campaign_id links the post to that email.

create table news_posts (
  id                uuid primary key default gen_random_uuid(),
  title             text not null check (length(trim(title)) > 0),
  body              text not null default '',
  pinned            boolean not null default false,
  email_campaign_id uuid references email_campaigns (id) on delete set null,
  created_at        timestamptz not null default now(),
  created_by        uuid references people (id) on delete set null,
  updated_at        timestamptz not null default now(),
  updated_by        uuid references people (id) on delete set null
);

create index news_posts_newest on news_posts (pinned desc, created_at desc);

create trigger news_posts_touch before update on news_posts
  for each row execute function touch_updated_at();
create trigger audit after insert or update or delete on news_posts
  for each row execute function audit_row();

alter table news_posts enable row level security;

create policy news_read on news_posts for select to authenticated
  using (current_person_id() is not null);
create policy news_admin_insert on news_posts for insert to authenticated
  with check (has_role('admin'));
create policy news_admin_update on news_posts for update to authenticated
  using (has_role('admin')) with check (has_role('admin'));
create policy news_admin_delete on news_posts for delete to authenticated
  using (has_role('admin'));
