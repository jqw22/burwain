-- Burwain membership app: initial schema
-- Target: Supabase (Postgres 15+). Money is stored in pence (integer).
-- Club year runs 1 March to end of February.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type app_role as enum ('finance', 'admin', 'superadmin');
create type membership_category as enum ('sailing', 'non_sailing');
create type membership_cover as enum ('individual', 'dual', 'family', 'junior');
create type membership_status as enum ('pending_approval', 'awaiting_payment', 'active', 'lapsed', 'cancelled');
create type payment_method as enum ('card', 'direct_debit', 'bank_transfer', 'cash', 'cheque');
create type payment_status as enum ('pending', 'paid', 'failed', 'refunded');
create type txn_direction as enum ('in', 'out');

-- ---------------------------------------------------------------------------
-- People and households
-- ---------------------------------------------------------------------------
create table households (
  id              uuid primary key default gen_random_uuid(),
  address_line1   text,
  address_line2   text,
  address_line3   text,
  address_line4   text,
  postcode        text,
  lead_person_id  uuid,              -- FK added after people exists
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table people (
  id                        uuid primary key default gen_random_uuid(),
  auth_user_id              uuid unique references auth.users (id) on delete set null,
  household_id              uuid references households (id) on delete set null,
  title                     text,
  first_name                text not null,
  last_name                 text not null,
  date_of_birth             date,
  email                     text,
  mobile                    text,
  whatsapp                  boolean not null default false,
  emergency_contact_name    text,
  emergency_contact_mobile  text,
  first_joined_on           date,
  directory_opt_out         boolean not null default false,
  news_consent              boolean not null default false,
  news_consent_at           timestamptz,
  archived_at               timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create index on people (household_id);
create index on people (lower(email));

alter table households
  add constraint households_lead_person_fk
  foreign key (lead_person_id) references people (id) on delete set null;

-- Extra roles. Every person with a login is a member; these add powers.
-- superadmin implies admin (see has_role()).
create table user_roles (
  person_id   uuid not null references people (id) on delete cascade,
  role        app_role not null,
  granted_by  uuid references people (id),
  granted_at  timestamptz not null default now(),
  primary key (person_id, role)
);

-- Medical information: special category data. Readable by the member and admins only.
create table medical_records (
  person_id         uuid primary key references people (id) on delete cascade,
  details           text,
  consent_given_at  timestamptz not null,
  updated_at        timestamptz not null default now(),
  updated_by        uuid references people (id)
);

create table medical_access_log (
  id          bigint generated always as identity primary key,
  person_id   uuid not null references people (id) on delete cascade,
  viewed_by   uuid references people (id),
  viewed_at   timestamptz not null default now()
);

create table qualifications (
  id          uuid primary key default gen_random_uuid(),
  person_id   uuid not null references people (id) on delete cascade,
  name        text not null,
  awarded_on  date,
  expires_on  date,
  notes       text,
  created_at  timestamptz not null default now()
);
create index on qualifications (person_id);

-- ---------------------------------------------------------------------------
-- Membership types, club years, memberships
-- ---------------------------------------------------------------------------
create table activities (
  id    uuid primary key default gen_random_uuid(),
  name  text not null unique
);

create table membership_types (
  id                     uuid primary key default gen_random_uuid(),
  code                   text not null unique,
  name                   text not null,
  description            text,
  category               membership_category not null,
  cover                  membership_cover not null,
  annual_price_pence     integer not null check (annual_price_pence >= 0),
  max_age                integer,          -- e.g. 17 for juniors, 20 for U21
  requires_adult_member  boolean not null default false,
  requires_approval      boolean not null default false,
  sibling_order          integer,          -- 1, 2, 3 for J1, J2, J3
  is_open                boolean not null default true,
  sort_order             integer not null default 0,
  created_at             timestamptz not null default now()
);

create table membership_type_activities (
  membership_type_id  uuid not null references membership_types (id) on delete cascade,
  activity_id         uuid not null references activities (id) on delete cascade,
  primary key (membership_type_id, activity_id)
);

create table club_years (
  id         uuid primary key default gen_random_uuid(),
  label      text not null unique,          -- e.g. '2026/27'
  starts_on  date not null unique,          -- 1 March
  ends_on    date not null,                 -- last day of February
  check (ends_on > starts_on)
);

-- One membership per type per year. Covers one or more people (membership_people).
create table memberships (
  id                  uuid primary key default gen_random_uuid(),
  club_year_id        uuid not null references club_years (id),
  membership_type_id  uuid not null references membership_types (id),
  payer_person_id     uuid not null references people (id),
  household_id        uuid references households (id),
  status              membership_status not null default 'awaiting_payment',
  price_pence         integer not null check (price_pence >= 0),
  prorata_months      integer not null default 12 check (prorata_months between 1 and 12),
  approved_by         uuid references people (id),
  approved_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index on memberships (club_year_id);
create index on memberships (payer_person_id);

create table membership_people (
  membership_id  uuid not null references memberships (id) on delete cascade,
  person_id      uuid not null references people (id) on delete cascade,
  primary key (membership_id, person_id)
);
create index on membership_people (person_id);

create table boat_storage_options (
  id           uuid primary key default gen_random_uuid(),
  name         text not null unique,
  price_pence  integer not null check (price_pence >= 0),
  members_rate boolean not null,
  description  text
);

create table boat_storages (
  id                uuid primary key default gen_random_uuid(),
  club_year_id      uuid not null references club_years (id),
  person_id         uuid not null references people (id),
  option_id         uuid not null references boat_storage_options (id),
  boat_description  text,
  sail_number       text,
  price_pence       integer not null check (price_pence >= 0),
  status            membership_status not null default 'awaiting_payment',
  created_at        timestamptz not null default now()
);
create index on boat_storages (person_id);

-- ---------------------------------------------------------------------------
-- Payments and finance
-- ---------------------------------------------------------------------------
create table payments (
  id             uuid primary key default gen_random_uuid(),
  payer_person_id uuid references people (id),
  amount_pence   integer not null check (amount_pence >= 0),
  fee_pence      integer not null default 0 check (fee_pence >= 0),  -- Stripe/GoCardless fee
  method         payment_method not null,
  provider_ref   text unique,              -- Stripe/GoCardless id; null for manual
  status         payment_status not null default 'pending',
  paid_on        date,
  recorded_by    uuid references people (id),  -- set for manual payments
  created_at     timestamptz not null default now()
);

-- What a payment was for. A renewal can pay a membership and boat storage together.
create table payment_lines (
  id               uuid primary key default gen_random_uuid(),
  payment_id       uuid not null references payments (id) on delete cascade,
  membership_id    uuid references memberships (id),
  boat_storage_id  uuid references boat_storages (id),
  description      text not null,
  amount_pence     integer not null,
  check (num_nonnulls(membership_id, boat_storage_id) <= 1)
);
create index on payment_lines (payment_id);
create index on payment_lines (membership_id);

create table transaction_categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  direction  txn_direction not null
);

create table transactions (
  id                   uuid primary key default gen_random_uuid(),
  occurred_on          date not null,
  description          text not null,
  direction            txn_direction not null,
  amount_pence         integer not null check (amount_pence >= 0),
  category_id          uuid references transaction_categories (id),
  method               payment_method,
  payment_line_id      uuid unique references payment_lines (id),  -- income from a member payment
  membership_type_id   uuid references membership_types (id),      -- for income-by-type reports
  receipt_path         text,                                       -- Supabase Storage path
  reverses_id          uuid references transactions (id),          -- correction entries
  recorded_by          uuid references people (id),
  created_at           timestamptz not null default now()
);
create index on transactions (occurred_on);
create index on transactions (category_id);

-- ---------------------------------------------------------------------------
-- Email communications
-- ---------------------------------------------------------------------------
create table email_templates (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  subject     text not null,
  body_html   text not null,
  updated_at  timestamptz not null default now()
);

create table email_campaigns (
  id               uuid primary key default gen_random_uuid(),
  subject          text not null,
  body_html        text not null,
  audience_filter  jsonb not null default '{}'::jsonb,
  is_news          boolean not null default true,   -- news needs consent; essential mail does not
  created_by       uuid references people (id),
  sent_at          timestamptz,
  recipient_count  integer,
  created_at       timestamptz not null default now()
);

create table email_recipients (
  campaign_id  uuid not null references email_campaigns (id) on delete cascade,
  person_id    uuid not null references people (id) on delete cascade,
  email        text not null,
  status       text not null default 'queued',
  primary key (campaign_id, person_id)
);

-- ---------------------------------------------------------------------------
-- Change log
-- ---------------------------------------------------------------------------
create table audit_log (
  id          bigint generated always as identity primary key,
  table_name  text not null,
  row_id      text,
  action      text not null,
  changed_by  uuid,
  changed_at  timestamptz not null default now(),
  old_data    jsonb,
  new_data    jsonb
);
create index on audit_log (table_name, row_id);
