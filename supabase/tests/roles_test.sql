-- Role and business-rule tests. Run after the migrations and seed.
-- Any failed assertion or unexpected error stops the run with a non-zero exit.
\set ON_ERROR_STOP 1
\set QUIET 1
\pset tuples_only on
\pset format unaligned

-- Fails unless the statement raises an error matching the pattern.
create or replace function pg_temp.expect_error(stmt text, pattern text) returns void
language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if sqlerrm ilike '%' || pattern || '%' then return; end if;
    raise exception 'Expected error like "%" but got "%" from: %', pattern, sqlerrm, stmt;
  end;
  raise exception 'Expected error like "%" but the statement succeeded: %', pattern, stmt;
end $$;
grant execute on function pg_temp.expect_error(text, text) to public;

-- Fixtures: Alice (household lead) with junior Bob; Carol finance; Dave superadmin; Eve another household.
insert into auth.users values
  ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000c'),
  ('00000000-0000-0000-0000-00000000000d'), ('00000000-0000-0000-0000-00000000000e');
insert into households (id, address_line1, postcode) values
  ('10000000-0000-0000-0000-000000000001', '1 Lake Rd', 'BB8 1AA'),
  ('10000000-0000-0000-0000-000000000002', '2 Hill St', 'BB8 2BB');
insert into people (id, auth_user_id, household_id, first_name, last_name, date_of_birth, email, mobile) values
  ('20000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001', 'Alice', 'Lead',    '1980-01-01', 'a@example.com', '0711'),
  ('20000000-0000-0000-0000-00000000000b', null,                                   '10000000-0000-0000-0000-000000000001', 'Bob',   'Junior',  '2014-05-01', null, null),
  ('20000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000c', null,                                   'Carol', 'Finance', '1970-01-01', 'c@example.com', '0733'),
  ('20000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-00000000000d', null,                                   'Dave',  'Super',   '1965-01-01', 'd@example.com', '0744'),
  ('20000000-0000-0000-0000-00000000000e', '00000000-0000-0000-0000-00000000000e', '10000000-0000-0000-0000-000000000002', 'Eve',   'Other',   '1990-01-01', 'e@example.com', '0755');
update households set lead_person_id = '20000000-0000-0000-0000-00000000000a' where id = '10000000-0000-0000-0000-000000000001';
update households set lead_person_id = '20000000-0000-0000-0000-00000000000e' where id = '10000000-0000-0000-0000-000000000002';
insert into user_roles (person_id, role) values
  ('20000000-0000-0000-0000-00000000000c', 'finance'),
  ('20000000-0000-0000-0000-00000000000d', 'superadmin');

-- Fix "today" so pricing doesn't depend on when the tests run.
create or replace function club_today() returns date language sql stable as $$ select '2026-03-05'::date $$;

\echo 'Member (Alice): visibility, pricing and household rules'
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ begin
  assert (select count(*) from people) = 2, 'Alice should see only herself and Bob';
  perform start_membership((select id from membership_types where code = 'IS'), array['20000000-0000-0000-0000-00000000000a'::uuid], (select id from club_years where label = '2026/27'));
  perform start_membership((select id from membership_types where code = 'J1'), array['20000000-0000-0000-0000-00000000000b'::uuid], (select id from club_years where label = '2026/27'));
  assert (select price_pence from memberships m join membership_types t on t.id = m.membership_type_id where t.code = 'IS') = 18500, 'IS full price';
  assert (select price_pence from memberships m join membership_types t on t.id = m.membership_type_id where t.code = 'J1') = 9500, 'J1 full price';
end $$;
select pg_temp.expect_error($q$update people set first_joined_on = '2000-01-01' where first_name = 'Alice'$q$, 'Only an admin');
select pg_temp.expect_error($q$insert into memberships (club_year_id, membership_type_id, payer_person_id, price_pence) select (select id from club_years limit 1), (select id from membership_types where code = 'IS'), '20000000-0000-0000-0000-00000000000a', 0$q$, 'row-level security');
select pg_temp.expect_error($q$select start_membership((select id from membership_types where code = 'IS'), array['20000000-0000-0000-0000-00000000000e'::uuid], (select id from club_years where label = '2026/27'))$q$, 'own household');
select pg_temp.expect_error($q$select start_membership((select id from membership_types where code = 'U21'), array['20000000-0000-0000-0000-00000000000a'::uuid], (select id from club_years where label = '2026/27'))$q$, 'age limit');
do $$ begin
  insert into people (household_id, first_name, last_name, date_of_birth)
  values ('10000000-0000-0000-0000-000000000001', 'Cleo', 'Junior', '2016-02-02');
  assert (select count(*) from people) = 3, 'household lead can add a family member';
end $$;
select pg_temp.expect_error($q$insert into people (household_id, first_name, last_name, auth_user_id) values ('10000000-0000-0000-0000-000000000001', 'Mal', 'Icious', '00000000-0000-0000-0000-00000000000e')$q$, 'Only an admin');
select pg_temp.expect_error($q$insert into people (household_id, first_name, last_name) values ('10000000-0000-0000-0000-000000000002', 'Not', 'Mine')$q$, 'row-level security');
do $$ begin
  update people set news_consent = true where first_name = 'Alice';
  assert (select news_consent_at is not null from people where first_name = 'Alice'), 'consent should be time-stamped';
  insert into medical_records (person_id, details, consent_given_at) values ('20000000-0000-0000-0000-00000000000a', 'Asthma', now());
  assert (select count(*) from audit_log) = 0, 'members cannot read the change log';
end $$;

reset role;
create or replace function club_today() returns date language sql stable as $$ select '2026-09-10'::date $$;
set role authenticated;
\echo 'Member (Eve): pro rata, approval and medical privacy'
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';
do $$ begin
  assert (select count(*) from people) = 1, 'Eve should see only herself';
  perform start_membership((select id from membership_types where code = 'C'), array['20000000-0000-0000-0000-00000000000e'::uuid], (select id from club_years where label = '2026/27'));
  perform start_membership((select id from membership_types where code = 'A'), array['20000000-0000-0000-0000-00000000000e'::uuid], (select id from club_years where label = '2026/27'));
  assert (select price_pence from memberships m join membership_types t on t.id = m.membership_type_id where t.code = 'C') = 1500, 'September join pays 6/12';
  assert (select status::text from memberships m join membership_types t on t.id = m.membership_type_id where t.code = 'A') = 'pending_approval', 'Associate needs approval';
end $$;
select pg_temp.expect_error($q$select approve_membership((select m.id from memberships m join membership_types t on t.id = m.membership_type_id where t.code = 'A'))$q$, 'Admins only');
select pg_temp.expect_error($q$select * from get_medical_record('20000000-0000-0000-0000-00000000000a')$q$, 'Not allowed');

\echo 'Finance (Carol): payment posting and reports'
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
do $$ begin
  assert (select count(*) from people) = 1, 'finance cannot read full member records';
  assert (select count(*) from finance_member_status()) = 4, 'finance sees names and status for all memberships';
  insert into payments (id, payer_person_id, amount_pence, fee_pence, method, status, paid_on, recorded_by)
  values ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000a', 28000, 150, 'card', 'pending', '2026-03-06', '20000000-0000-0000-0000-00000000000c');
  insert into payment_lines (payment_id, membership_id, description, amount_pence)
  select '30000000-0000-0000-0000-000000000001', m.id, 'Membership ' || t.code, m.price_pence
    from memberships m join membership_types t on t.id = m.membership_type_id where t.code in ('IS', 'J1');
  update payments set status = 'paid' where id = '30000000-0000-0000-0000-000000000001';
  assert (select sum(total_pence) from income_statement() where direction = 'in') = 28000, 'income posted';
  assert (select sum(total_pence) from income_statement() where direction = 'out') = 150, 'provider fee posted as a cost';
end $$;
select pg_temp.expect_error($q$select * from get_medical_record('20000000-0000-0000-0000-00000000000a')$q$, 'Not allowed');

\echo 'Superadmin (Dave): approval, logged medical access, directory'
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';
do $$ begin
  perform approve_membership((select m.id from memberships m join membership_types t on t.id = m.membership_type_id where t.code = 'A'));
  assert (select status::text from memberships m join membership_types t on t.id = m.membership_type_id where t.code = 'A') = 'awaiting_payment', 'approved';
  assert (select count(*) from memberships where status = 'active') = 2, 'paid memberships active';
  assert (select details from get_medical_record('20000000-0000-0000-0000-00000000000a')) = 'Asthma', 'admin can read medical';
  assert (select count(*) from medical_access_log) = 1, 'medical view logged';
  assert (select count(*) from audit_log) > 0, 'superadmin sees change log';
  assert (select count(*) from member_directory()) = 1, 'directory lists adults only (Alice, not junior Bob)';
end $$;

\echo 'Member (Alice): history linked to income'
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ begin
  assert (select count(*) from membership_history() where transaction_id is not null) = 2, 'both memberships linked to income';
end $$;

\echo 'Signed out: no access'
reset role;
set role anon;
select pg_temp.expect_error($q$select * from member_directory()$q$, 'permission denied');
select pg_temp.expect_error($q$select start_membership(gen_random_uuid(), array[]::uuid[], gen_random_uuid())$q$, 'permission denied');
select pg_temp.expect_error($q$select * from people$q$, 'permission denied');
reset role;

\echo 'First sign-in links a login to the member record by email'
insert into auth.users values ('00000000-0000-0000-0000-0000000000f1'), ('00000000-0000-0000-0000-0000000000f2'), ('00000000-0000-0000-0000-0000000000f3');
insert into people (id, household_id, first_name, last_name, date_of_birth, email) values
  ('20000000-0000-0000-0000-0000000000f1', null, 'Fran', 'New', '1985-01-01', 'Fran@Example.com'),
  ('20000000-0000-0000-0000-0000000000f2', null, 'Gus', 'Twin', '1985-01-01', 'twin@example.com'),
  ('20000000-0000-0000-0000-0000000000f3', null, 'Hal', 'Twin', '1986-01-01', 'twin@example.com'),
  ('20000000-0000-0000-0000-0000000000f4', null, 'Ivy', 'Kid', '2015-01-01', 'kid@example.com');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000f1';
set request.jwt.claims = '{"email": "fran@example.com"}';
do $$ begin
  assert link_my_account() = '20000000-0000-0000-0000-0000000000f1', 'email match links the record (case-insensitive)';
  assert current_person_id() = '20000000-0000-0000-0000-0000000000f1', 'now signed in as Fran';
  assert link_my_account() = '20000000-0000-0000-0000-0000000000f1', 'linking again is harmless';
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000f2';
set request.jwt.claims = '{"email": "twin@example.com"}';
do $$ begin
  assert link_my_account() is null, 'two adults share an email: not linked automatically';
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000f3';
set request.jwt.claims = '{"email": "kid@example.com"}';
do $$ begin
  assert link_my_account() is null, 'junior records are never linked to a login';
end $$;
reset role;

do $$ begin
  assert prorata_months('2026-03-01') = 12 and prorata_months('2026-09-10') = 6 and prorata_months('2027-02-01') = 1, 'pro rata months';
end $$;

\echo 'Renewals: windows, sibling pricing, duplicates and cancelling'
create or replace function club_today() returns date language sql stable as $$ select '2026-12-01'::date $$;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ begin
  assert (select count(*) from open_club_years()) = 1, '1 December: only 2026/27 is open';
end $$;
select pg_temp.expect_error($q$select start_membership((select id from membership_types where code = 'IS'), array['20000000-0000-0000-0000-00000000000a'::uuid], (select id from club_years where label = '2027/28'))$q$, 'not open');
-- Cleo (added earlier) is Alice's second junior: picking J1 gets J2 pricing automatically. December = 3/12.
do $$ declare m uuid; begin
  m := start_membership((select id from membership_types where code = 'J1'), array[(select id from people where first_name = 'Cleo')], (select id from club_years where label = '2026/27'));
  assert (select t.code from memberships x join membership_types t on t.id = x.membership_type_id where x.id = m) = 'J2', 'second junior priced as J2';
  assert (select price_pence from memberships where id = m) = 1750, 'J2 £70 x 3/12';
  perform cancel_my_membership(m);
  assert (select status::text from memberships where id = m) = 'cancelled', 'unpaid membership cancelled';
end $$;
select pg_temp.expect_error($q$select cancel_my_membership((select m.id from memberships m join membership_types t on t.id = m.membership_type_id where t.code = 'IS'))$q$, 'Only an unpaid');
select pg_temp.expect_error($q$select start_membership((select id from membership_types where code = 'D'), array['20000000-0000-0000-0000-00000000000a'::uuid, (select id from people where first_name = 'Bob')], (select id from club_years where label = '2026/27'))$q$, 'already has');
reset role;
create or replace function club_today() returns date language sql stable as $$ select '2027-01-05'::date $$;
set role authenticated;
do $$ declare m uuid; begin
  assert (select count(*) from open_club_years() where is_renewal) = 1, '5 January: 2027/28 renewals open';
  m := start_membership((select id from membership_types where code = 'F'),
         array['20000000-0000-0000-0000-00000000000a'::uuid, (select id from people where first_name = 'Bob')],
         (select id from club_years where label = '2027/28'));
  assert (select price_pence from memberships where id = m) = 25500, 'renewing before 1 March is full price';
end $$;
reset role;

\echo 'Spreadsheet import (admins only)'
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select pg_temp.expect_error($q$select import_members('[]', (select id from club_years where label = '2026/27'))$q$, 'Admins only');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';
select pg_temp.expect_error($q$select import_members('[{"household_key":"x","first_name":"A","last_name":"B","member_class":"ZZ"}]', (select id from club_years where label = '2026/27'))$q$, 'Unknown member class: ZZ');
do $$ declare
  rows jsonb := '[
    {"household_key":"bb11aa|3 shore lane","first_name":"Jo","last_name":"Import","date_of_birth":"1975-04-04","email":"Jo@Example.com","mobile":"0790","whatsapp":true,"address_line1":"3 Shore Lane","postcode":"bb1 1aa","member_class":"F"},
    {"household_key":"bb11aa|3 shore lane","first_name":"Kit","last_name":"Import","date_of_birth":"2015-06-06","member_class":"F"},
    {"household_key":"bb11aa|3 shore lane","first_name":"Lou","last_name":"Import","date_of_birth":"1977-01-01","member_class":"f"},
    {"household_key":"bb22bb|9 hill","first_name":"Max","last_name":"Solo","date_of_birth":"1960-02-02","email":"max@example.com","member_class":"IS"},
    {"household_key":"bb22bb|9 hill","first_name":"Ned","last_name":"Solo","date_of_birth":"2012-02-02","member_class":"J1"},
    {"household_key":"x|alice","first_name":"Alice","last_name":"Lead","date_of_birth":"1980-01-01","member_class":"IS"}
  ]';
  res jsonb;
begin
  res := import_members(rows, (select id from club_years where label = '2026/27'));
  assert res = '{"households": 2, "people": 5, "skipped": 1, "memberships": 3}', 'import summary: ' || res;
  assert (select count(*) from people where last_name = 'Import' and household_id is not null) = 3, 'family grouped';
  assert (select p.first_name from households h join people p on p.id = h.lead_person_id where h.postcode = 'BB1 1AA') = 'Jo', 'oldest adult is main contact';
  assert (select count(*) from membership_people mp join memberships m on m.id = mp.membership_id
           join membership_types t on t.id = m.membership_type_id where t.code = 'F' and m.status = 'active'
           and m.club_year_id = (select id from club_years where label = '2026/27')) = 3, 'one Family membership covers all three';
  assert (select email from people where first_name = 'Jo') = 'jo@example.com', 'email lower-cased for login';
  res := import_members(rows, (select id from club_years where label = '2026/27'));
  assert res = '{"households": 0, "people": 0, "skipped": 6, "memberships": 0}', 're-run is harmless: ' || res;
end $$;
reset role;

\echo 'Manual payments (finance) and the memberships list'
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select pg_temp.expect_error($q$select record_manual_payment(array(select id from memberships where status = 'awaiting_payment' limit 1), 'cash', current_date)$q$, 'Only finance');
do $$ begin
  assert (select count(*) from club_memberships((select id from club_years where label = '2026/27'))) = 0, 'members see nothing in the finance list';
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select pg_temp.expect_error($q$select record_manual_payment(array(select id from memberships where status = 'awaiting_payment' limit 1), 'card', current_date)$q$, 'recorded automatically');
select pg_temp.expect_error($q$select record_manual_payment(array(select id from memberships where status = 'active' limit 1), 'cash', current_date)$q$, 'awaiting payment');
do $$ declare
  m uuid := (select m.id from memberships m join membership_types t on t.id = m.membership_type_id where t.code = 'C' and m.status = 'awaiting_payment' limit 1);
  before bigint := (select coalesce(sum(total_pence), 0) from income_statement() where direction = 'in');
begin
  assert m is not null, 'Eve''s Club membership is awaiting payment';
  assert (select people from club_memberships((select id from club_years where label = '2026/27')) where id = m) = 'Eve Other', 'finance sees names in the list';
  perform record_manual_payment(array[m], 'cheque', current_date);
  assert (select status::text from memberships where id = m) = 'active', 'marked paid';
  assert (select coalesce(sum(total_pence), 0) from income_statement() where direction = 'in') = before + 1500, 'income posted';
  assert (select method::text from club_memberships((select id from club_years where label = '2026/27')) where id = m) = 'cheque', 'payment method shown';
end $$;
reset role;

\echo 'Family: the main contact manages every family member''s medical info and qualifications'
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
insert into medical_records (person_id, details, consent_given_at, updated_by)
values ('20000000-0000-0000-0000-00000000000b', 'Peanut allergy', now(), '20000000-0000-0000-0000-00000000000a');
do $$ begin
  assert (select details from medical_records where person_id = '20000000-0000-0000-0000-00000000000b') = 'Peanut allergy', 'Alice sees Bob''s medical';
end $$;
select pg_temp.expect_error($q$insert into medical_records (person_id, details) values ('20000000-0000-0000-0000-00000000000e', 'x')$q$, 'row-level security');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';
do $$ begin
  assert (select count(*) from medical_records where person_id = '20000000-0000-0000-0000-00000000000b') = 0, 'Eve can''t see Bob''s medical';
end $$;
select pg_temp.expect_error($q$insert into medical_records (person_id, details) values ('20000000-0000-0000-0000-00000000000b', 'x')$q$, 'row-level security');
reset role;
reset request.jwt.claim.sub;
-- Including an adult in the family who has their own login; Fran can't edit Alice's.
insert into auth.users values ('00000000-0000-0000-0000-0000000000f0');
insert into people (id, auth_user_id, household_id, first_name, last_name, date_of_birth)
values ('20000000-0000-0000-0000-0000000000f0', '00000000-0000-0000-0000-0000000000f0', '10000000-0000-0000-0000-000000000001', 'Fran', 'Adult', '1982-01-01');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
insert into medical_records (person_id, details, consent_given_at) values ('20000000-0000-0000-0000-0000000000f0', 'Diabetic', now());
insert into qualifications (person_id, name) values ('20000000-0000-0000-0000-00000000000b', 'RYA Stage 1');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000f0';
do $$ begin
  assert (select details from medical_records where person_id = '20000000-0000-0000-0000-0000000000f0') = 'Diabetic', 'Fran sees her own record';
end $$;
select pg_temp.expect_error($q$insert into qualifications (person_id, name) values ('20000000-0000-0000-0000-00000000000b', 'x')$q$, 'row-level security');
select pg_temp.expect_error($q$insert into medical_records (person_id, details, consent_given_at) values ('20000000-0000-0000-0000-00000000000a', 'x', now())$q$, 'row-level security');
reset role;

\echo 'All database tests passed'
