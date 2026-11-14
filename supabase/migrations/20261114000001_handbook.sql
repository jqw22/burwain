-- The club handbook: five sections that every signed-in member can read and admins can edit.
-- The body of each section is formatted text (HTML), cleaned by the app before it is saved.
-- The handbook's actual wording is loaded separately (it includes door codes, so it is kept out
-- of this public code repository).

create table handbook_sections (
  slug       text primary key,
  title      text not null check (length(trim(title)) > 0),
  position   integer not null,
  body       text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid references people (id) on delete set null
);

create trigger handbook_sections_touch before update on handbook_sections
  for each row execute function touch_updated_at();
create trigger audit after insert or update or delete on handbook_sections
  for each row execute function audit_row();

alter table handbook_sections enable row level security;

-- Any signed-in member can read; only admins can change the text.
create policy handbook_read on handbook_sections for select to authenticated
  using (current_person_id() is not null);
create policy handbook_admin_update on handbook_sections for update to authenticated
  using (has_role('admin')) with check (has_role('admin'));

insert into handbook_sections (slug, title, position) values
  ('general-information',  'General Information',  1),
  ('notice-of-race',       'Notice of Race',       2),
  ('sailing-instructions', 'Sailing Instructions', 3),
  ('safety',               'Safety',               4),
  ('code-of-conduct',      'Code of Conduct',      5)
on conflict (slug) do nothing;
