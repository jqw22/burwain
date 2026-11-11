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

-- 2027 has no membership types yet: admins set them up later in these tests.
delete from membership_types where club_year_id = (select id from club_years where label = '2027');

-- Fix "today" so pricing doesn't depend on when the tests run.
create or replace function club_today() returns date language sql stable as $$ select '2026-01-05'::date $$;

\echo 'Member (Alice): visibility, pricing and household rules'
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ begin
  assert (select count(*) from people) = 2, 'Alice should see only herself and Bob';
  perform start_membership((select id from membership_types where code = 'IS'), array['20000000-0000-0000-0000-00000000000a'::uuid], (select id from club_years where label = '2026'));
  perform start_membership((select id from membership_types where code = 'J1'), array['20000000-0000-0000-0000-00000000000b'::uuid], (select id from club_years where label = '2026'));
  assert (select price_pence from memberships m join membership_types t on t.id = m.membership_type_id where t.code = 'IS') = 18500, 'IS full price';
  assert (select price_pence from memberships m join membership_types t on t.id = m.membership_type_id where t.code = 'J1') = 9500, 'J1 full price';
end $$;
select pg_temp.expect_error($q$update people set first_joined_on = '2000-01-01' where first_name = 'Alice'$q$, 'Only an admin');
select pg_temp.expect_error($q$insert into memberships (club_year_id, membership_type_id, payer_person_id, price_pence) select (select id from club_years limit 1), (select id from membership_types where code = 'IS'), '20000000-0000-0000-0000-00000000000a', 0$q$, 'row-level security');
select pg_temp.expect_error($q$select start_membership((select id from membership_types where code = 'IS'), array['20000000-0000-0000-0000-00000000000e'::uuid], (select id from club_years where label = '2026'))$q$, 'own household');
select pg_temp.expect_error($q$select start_membership((select id from membership_types where code = 'U21'), array['20000000-0000-0000-0000-00000000000a'::uuid], (select id from club_years where label = '2026'))$q$, 'age limit');
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
create or replace function club_today() returns date language sql stable as $$ select '2026-07-10'::date $$;
set role authenticated;
\echo 'Member (Eve): pro rata, no approval, and medical privacy'
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';
do $$ begin
  assert (select count(*) from people) = 1, 'Eve should see only herself';
  perform start_membership((select id from membership_types where code = 'C'), array['20000000-0000-0000-0000-00000000000e'::uuid], (select id from club_years where label = '2026'));
  perform start_membership((select id from membership_types where code = 'A'), array['20000000-0000-0000-0000-00000000000e'::uuid], (select id from club_years where label = '2026'));
  assert (select price_pence from memberships m join membership_types t on t.id = m.membership_type_id where t.code = 'C') = 1500, 'July join pays 6/12';
  assert (select status::text from memberships m join membership_types t on t.id = m.membership_type_id where t.code = 'A') = 'awaiting_payment', 'Associate no longer needs approval';
end $$;
select pg_temp.expect_error($q$select * from get_medical_record('20000000-0000-0000-0000-00000000000a')$q$, 'Not allowed');

\echo 'Finance (Carol): payment posting and reports'
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
do $$ begin
  assert (select count(*) from people) = 1, 'finance cannot read full member records';
  assert (select count(*) from finance_member_status()) = 4, 'finance sees names and status for all memberships';
  insert into member_receipts (id, payer_person_id, amount_pence, fee_pence, method, status, paid_on, recorded_by)
  values ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000a', 28000, 150, 'card', 'pending', '2026-03-06', '20000000-0000-0000-0000-00000000000c');
  insert into member_receipt_lines (receipt_id, membership_id, description, amount_pence)
  select '30000000-0000-0000-0000-000000000001', m.id, 'Membership ' || t.code, m.price_pence
    from memberships m join membership_types t on t.id = m.membership_type_id where t.code in ('IS', 'J1');
  update member_receipts set status = 'paid' where id = '30000000-0000-0000-0000-000000000001';
  assert (select sum(total_pence) from income_statement() where direction = 'in') = 28000, 'income posted';
  assert (select sum(total_pence) from income_statement() where direction = 'out') = 150, 'provider fee posted as a cost';
end $$;
select pg_temp.expect_error($q$select * from get_medical_record('20000000-0000-0000-0000-00000000000a')$q$, 'Not allowed');

\echo 'Superadmin (Dave): logged medical access, directory'
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';
do $$ begin
  assert (select count(*) from memberships where status = 'active') = 2, 'paid memberships active';
  assert (select details from get_medical_record('20000000-0000-0000-0000-00000000000a')) = 'Asthma', 'admin can read medical';
  assert (select count(*) from medical_access_log) = 1, 'medical view logged';
  assert (select count(*) from audit_log) > 0, 'superadmin sees change log';
  assert (select count(*) from member_directory()) = 2, 'directory lists adults with a membership (Alice and Eve, not junior Bob), paid or not';
  assert (select membership from member_directory() where first_name = 'Eve') = 'Associate Membership, Club Membership', 'directory shows membership type';
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
  assert prorata_months('2026-01-01') = 12 and prorata_months('2026-07-10') = 6 and prorata_months('2026-12-01') = 1, 'pro rata months';
end $$;

\echo 'Renewals: windows, sibling pricing, duplicates and cancelling'
create or replace function club_today() returns date language sql stable as $$ select '2026-10-15'::date $$;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ begin
  assert (select count(*) from open_club_years()) = 1, '15 October: only 2026 is open';
end $$;
select pg_temp.expect_error($q$select start_membership((select id from membership_types where code = 'IS'), array['20000000-0000-0000-0000-00000000000a'::uuid], (select id from club_years where label = '2027'))$q$, 'not open');
-- Cleo (added earlier) is Alice's second junior: picking J1 gets J2 pricing automatically. October = 3/12.
do $$ declare m uuid; begin
  m := start_membership((select id from membership_types where code = 'J1'), array[(select id from people where first_name = 'Cleo')], (select id from club_years where label = '2026'));
  assert (select t.code from memberships x join membership_types t on t.id = x.membership_type_id where x.id = m) = 'J2', 'second junior priced as J2';
  assert (select price_pence from memberships where id = m) = 1750, 'J2 £70 x 3/12';
  perform cancel_my_membership(m);
  assert (select status::text from memberships where id = m) = 'cancelled', 'unpaid membership cancelled';
end $$;
select pg_temp.expect_error($q$select cancel_my_membership((select m.id from memberships m join membership_types t on t.id = m.membership_type_id where t.code = 'IS'))$q$, 'Only an unpaid');
select pg_temp.expect_error($q$select start_membership((select id from membership_types where code = 'D'), array['20000000-0000-0000-0000-00000000000a'::uuid, (select id from people where first_name = 'Bob')], (select id from club_years where label = '2026'))$q$, 'already has');
reset role;
create or replace function club_today() returns date language sql stable as $$ select '2026-12-05'::date $$;
set role authenticated;
do $$ begin
  assert (select count(*) from open_club_years() where is_renewal) = 0, '5 December: 2027 renewals wait for 2027 types';
end $$;
select pg_temp.expect_error($q$select copy_membership_types((select id from club_years where label = '2026'))$q$, 'Only club admins');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';
do $$ begin
  assert copy_membership_types((select id from club_years where label = '2026')) = 11, 'admin copies 2026 types into 2027';
  assert copy_membership_types((select id from club_years where label = '2026')) = 0, 'copying again adds nothing';
  update membership_types set annual_price_pence = 3500 where code = 'C' and club_year_id = (select id from club_years where label = '2027');
  assert (select annual_price_pence from membership_types where code = 'C' and club_year_id = (select id from club_years where label = '2026')) = 3000, '2026 price unchanged';
  perform copy_membership_types((select id from club_years where label = '2027'));
  assert (select count(*) from membership_types t join club_years cy on cy.id = t.club_year_id where cy.label = '2028') = 11, 'copying 2027 sets up 2028';
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ declare m uuid; begin
  assert (select count(*) from open_club_years() where is_renewal) = 1, '5 December: 2027 renewals open';
  m := start_membership((select id from membership_types where code = 'F' and club_year_id = (select id from club_years where label = '2027')),
         array['20000000-0000-0000-0000-00000000000a'::uuid, (select id from people where first_name = 'Bob')],
         (select id from club_years where label = '2027'));
  assert (select price_pence from memberships where id = m) = 25500, 'renewing before 1 January is full price';
end $$;
reset role;

\echo 'Spreadsheet import (admins only)'
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select pg_temp.expect_error($q$select import_members('[]', (select id from club_years where label = '2026'))$q$, 'Admins only');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';
select pg_temp.expect_error($q$select import_members('[{"household_key":"x","first_name":"A","last_name":"B","member_class":"ZZ"}]', (select id from club_years where label = '2026'))$q$, 'Unknown member class: ZZ');
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
  res := import_members(rows, (select id from club_years where label = '2026'));
  assert res = '{"households": 2, "people": 5, "skipped": 1, "memberships": 3}', 'import summary: ' || res;
  assert (select count(*) from people where last_name = 'Import' and household_id is not null) = 3, 'family grouped';
  assert (select p.first_name from households h join people p on p.id = h.lead_person_id where h.postcode = 'BB1 1AA') = 'Jo', 'oldest adult is main contact';
  assert (select count(*) from membership_people mp join memberships m on m.id = mp.membership_id
           join membership_types t on t.id = m.membership_type_id where t.code = 'F' and m.status = 'active'
           and m.club_year_id = (select id from club_years where label = '2026')) = 3, 'one Family membership covers all three';
  assert (select email from people where first_name = 'Jo') = 'jo@example.com', 'email lower-cased for login';
  res := import_members(rows, (select id from club_years where label = '2026'));
  assert res = '{"households": 0, "people": 0, "skipped": 6, "memberships": 0}', 're-run is harmless: ' || res;
end $$;
reset role;

\echo 'Manual payments (finance) and the memberships list'
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select pg_temp.expect_error($q$select record_manual_payment(array(select id from memberships where status = 'awaiting_payment' limit 1), 'cash', current_date)$q$, 'Only finance');
do $$ begin
  assert (select count(*) from club_memberships((select id from club_years where label = '2026'))) = 0, 'members see nothing in the finance list';
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select pg_temp.expect_error($q$select record_manual_payment(array(select id from memberships where status = 'awaiting_payment' limit 1), 'card', current_date)$q$, 'recorded automatically');
select pg_temp.expect_error($q$select record_manual_payment(array(select id from memberships where status = 'active' limit 1), 'cash', current_date)$q$, 'awaiting payment');
do $$ declare
  m uuid := (select m.id from memberships m join membership_types t on t.id = m.membership_type_id where t.code = 'C' and m.status = 'awaiting_payment' limit 1);
  before bigint := (select coalesce(sum(total_pence), 0) from income_statement() where direction = 'in');
begin
  assert m is not null, 'Eve''s Club membership is awaiting payment';
  assert (select people from club_memberships((select id from club_years where label = '2026')) where id = m) = 'Eve Other', 'finance sees names in the list';
  perform record_manual_payment(array[m], 'cheque', current_date);
  assert (select status::text from memberships where id = m) = 'active', 'marked paid';
  assert (select coalesce(sum(total_pence), 0) from income_statement() where direction = 'in') = before + 1500, 'income posted';
  assert (select method::text from club_memberships((select id from club_years where label = '2026')) where id = m) = 'cheque', 'payment method shown';
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

\echo 'Setting up a family group (member not in one yet)'
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
do $$ declare hh uuid; begin
  hh := create_my_household('9 Shore Rd', null, 'Burnley', null, 'bb9 9zz');
  assert (select household_id from people where first_name = 'Carol') = hh, 'Carol is in her new family';
  assert (select lead_person_id from households where id = hh) = (select id from people where first_name = 'Carol'), 'Carol is the main contact';
  assert (select postcode from households where id = hh) = 'BB9 9ZZ', 'postcode tidied';
  insert into people (household_id, first_name, last_name) values (hh, 'Kit', 'Finance');
end $$;
select pg_temp.expect_error($q$select create_my_household('x', null, null, null, null)$q$, 'already in a family');
select pg_temp.expect_error($q$update people set household_id = '10000000-0000-0000-0000-000000000001' where first_name = 'Carol'$q$, 'Only an admin');
reset role;

\echo 'Family membership covers people added to the family later'
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
insert into people (household_id, first_name, last_name, date_of_birth)
values ('10000000-0000-0000-0000-000000000001', 'Nia', 'Newborn', '2026-06-01');
do $$ begin
  assert (select count(*) from membership_people mp join memberships m on m.id = mp.membership_id
           join membership_types t on t.id = m.membership_type_id join people p on p.id = mp.person_id
          where p.first_name = 'Nia' and t.code = 'F') = 1, 'Nia joins the family''s Family membership';
end $$;
reset role;

\echo 'A Family membership taken out before setting up a family follows the family'
reset request.jwt.claim.sub;
insert into people (id, first_name, last_name, date_of_birth) values ('20000000-0000-0000-0000-0000000000a1', 'Gil', 'Solo', '1975-01-01');
insert into memberships (id, club_year_id, membership_type_id, payer_person_id, status, price_pence)
values ('40000000-0000-0000-0000-0000000000a1', current_club_year_id(), (select id from membership_types where code = 'F' and club_year_id = current_club_year_id()), '20000000-0000-0000-0000-0000000000a1', 'active', 25500);
insert into membership_people values ('40000000-0000-0000-0000-0000000000a1', '20000000-0000-0000-0000-0000000000a1');
insert into households (id, lead_person_id) values ('10000000-0000-0000-0000-0000000000a1', '20000000-0000-0000-0000-0000000000a1');
update people set household_id = '10000000-0000-0000-0000-0000000000a1' where id = '20000000-0000-0000-0000-0000000000a1';
insert into people (household_id, first_name, last_name) values ('10000000-0000-0000-0000-0000000000a1', 'Hal', 'Solo');
do $$ begin
  assert (select household_id from memberships where id = '40000000-0000-0000-0000-0000000000a1') = '10000000-0000-0000-0000-0000000000a1', 'membership moved to the new family';
  assert (select count(*) from membership_people where membership_id = '40000000-0000-0000-0000-0000000000a1') = 2, 'Hal is covered by the Family membership';
end $$;

\echo 'Admins add new members: new family, existing family, membership and payment'
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select pg_temp.expect_error($q$select admin_add_member('{"people":[{"first_name":"X","last_name":"Y"}],"address_line1":"1 A","postcode":"BB1"}')$q$, 'Only an admin');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';
select pg_temp.expect_error($q$select admin_add_member('{"people":[{"first_name":"X","last_name":"Y"}]}')$q$, 'address line 1');
select pg_temp.expect_error($q$select admin_add_member('{"people":[{"first_name":"X","last_name":"Y","date_of_birth":"1980-01-01","email":"A@example.com"}],"address_line1":"1 A","postcode":"BB1"}')$q$, 'already uses that email');
select pg_temp.expect_error($q$select admin_add_member('{"people":[{"first_name":"X","last_name":"Y"}],"address_line1":"1 A","postcode":"BB1"}')$q$, 'Date of birth is needed');
do $$ declare ivy uuid; jo uuid; hh uuid; m uuid; begin
  ivy := admin_add_member(jsonb_build_object('people', jsonb_build_array(jsonb_build_object('first_name', 'Ivy', 'last_name', 'New', 'date_of_birth', '1985-03-03',
           'email', 'Ivy@Example.com', 'news_consent', true, 'medical_details', 'Asthma', 'medical_consent', true,
           'qualifications', jsonb_build_array(jsonb_build_object('name', 'RYA Level 2', 'expires_on', '2030-01-01')))), 'address_line1', '5 Bay Rd', 'postcode', 'bb5 5aa',
           'type_id', (select id from membership_types where code = 'A' and club_year_id = (select id from club_years where label = '2027')),
           'club_year_id', (select id from club_years where label = '2027'),
           'payment_method', 'cash', 'paid_on', '2026-11-01'));
  select household_id into hh from people where id = ivy;
  assert (select lead_person_id from households where id = hh) = ivy, 'Ivy is main contact of her new family';
  assert (select postcode from households where id = hh) = 'BB5 5AA', 'postcode tidied';
  assert (select email from people where id = ivy) = 'ivy@example.com', 'email lower case';
  assert (select first_joined_on from people where id = ivy) = club_today(), 'first joined today';
  assert (select news_consent and news_consent_at is not null from people where id = ivy), 'news consent recorded';
  assert (select details from get_medical_record(ivy)) = 'Asthma', 'medical saved';
  assert (select name from qualifications where person_id = ivy) = 'RYA Level 2', 'qualification saved';
  select m.id into m from memberships m join membership_people mp on mp.membership_id = m.id where mp.person_id = ivy;
  assert (select status::text from memberships where id = m) = 'active', 'Associate added by admin skips approval and is paid';
  assert (select payer_person_id from memberships where id = m) = ivy, 'Ivy pays';

  -- Jo joins Alice's family on a Junior membership: not left on the Family membership too.
  jo := admin_add_member(jsonb_build_object('people', jsonb_build_array(jsonb_build_object('first_name', 'Jo', 'last_name', 'Lead', 'date_of_birth', '2015-01-01')),
           'household_id', '10000000-0000-0000-0000-000000000001'));
  assert (select count(*) from membership_people mp join memberships m on m.id = mp.membership_id
           join membership_types t on t.id = m.membership_type_id where mp.person_id = jo and t.code = 'F') >= 1,
         'Jo is covered by the family membership when no type is chosen';
  -- Lou gets a Junior membership of their own instead of Family cover.
  jo := admin_add_member(jsonb_build_object('people', jsonb_build_array(jsonb_build_object('first_name', 'Lou', 'last_name', 'Lead', 'date_of_birth', '2016-01-01')),
           'household_id', '10000000-0000-0000-0000-000000000001',
           'type_id', (select id from membership_types where code = 'J1' and club_year_id = (select id from club_years where label = '2026')),
           'club_year_id', (select id from club_years where label = '2026')));
  assert (select string_agg(t.code, ',') from membership_people mp join memberships m on m.id = mp.membership_id
           join membership_types t on t.id = m.membership_type_id
          where mp.person_id = jo and m.club_year_id = (select id from club_years where label = '2026')) = 'J2',
         'Lou has only a second-sibling Junior membership for 2026';
  assert (select payer_person_id from memberships m join membership_people mp on mp.membership_id = m.id
           join membership_types t on t.id = m.membership_type_id where mp.person_id = jo and t.code = 'J2')
         = '20000000-0000-0000-0000-00000000000a', 'the family main contact pays';
  assert (select lead_person_id from households where id = '10000000-0000-0000-0000-000000000001') = '20000000-0000-0000-0000-00000000000a', 'Alice stays main contact';
end $$;
reset role;
reset request.jwt.claim.sub;

\echo 'Members renew into any of next year''s types, for people on this year''s memberships'
-- club_today is 2026-12-05, so 2027 renewals are open. Eve holds C and A for 2026; 2027 C costs £35.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';
do $$ declare n uuid; begin
  n := renew_my_membership((select id from membership_types where code = 'C' and club_year_id = (select id from club_years where label = '2027')),
         array['20000000-0000-0000-0000-00000000000e'::uuid], (select id from club_years where label = '2027'));
  assert (select price_pence from memberships where id = n) = 3500, 'next year''s price for that type';
  assert (select status::text from memberships where id = n) = 'awaiting_payment', 'straight to payment';
  n := renew_my_membership((select id from membership_types where code = 'RC' and club_year_id = (select id from club_years where label = '2027')),
         array['20000000-0000-0000-0000-00000000000e'::uuid], (select id from club_years where label = '2027'));
  assert (select t.name from memberships m join membership_types t on t.id = m.membership_type_id where m.id = n) = 'RC Laser Membership', 'can choose a different type';
end $$;
select pg_temp.expect_error($q$select renew_my_membership((select id from membership_types where code = 'A' and club_year_id = (select id from club_years where label = '2026')), array['20000000-0000-0000-0000-00000000000e'::uuid], (select id from club_years where label = '2027'))$q$, 'not available');
select pg_temp.expect_error($q$select renew_my_membership((select id from membership_types where code = 'A' and club_year_id = (select id from club_years where label = '2027')), array['20000000-0000-0000-0000-00000000000e'::uuid], (select id from club_years where label = '2026'))$q$, 'not open');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select pg_temp.expect_error($q$select renew_my_membership((select id from membership_types where code = 'C' and club_year_id = (select id from club_years where label = '2027')), array['20000000-0000-0000-0000-00000000000e'::uuid], (select id from club_years where label = '2027'))$q$, 'this year''s memberships');
select pg_temp.expect_error($q$select renew_my_membership((select id from membership_types where code = 'J1' and club_year_id = (select id from club_years where label = '2027')), array[(select id from people where first_name = 'Cleo')], (select id from club_years where label = '2027'))$q$, 'this year''s memberships');
reset role;
reset request.jwt.claim.sub;

\echo 'Admins add a whole family on a Family membership, and change medical information'
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';
select pg_temp.expect_error($q$select admin_add_member(jsonb_build_object('address_line1', '1 A', 'postcode', 'BB1',
  'people', jsonb_build_array(jsonb_build_object('first_name', 'A', 'last_name', 'B'), jsonb_build_object('first_name', 'C', 'last_name', 'D'))))$q$, 'Dual or Family');
select pg_temp.expect_error($q$select admin_add_member(jsonb_build_object('address_line1', '1 A', 'postcode', 'BB1',
  'people', jsonb_build_array(jsonb_build_object('first_name', 'A', 'last_name', 'B', 'date_of_birth', '1980-01-01', 'medical_details', 'x'))))$q$, 'consent');
select pg_temp.expect_error($q$select admin_add_member(jsonb_build_object('address_line1', '1 A', 'postcode', 'BB1',
  'type_id', (select id from membership_types where code = 'C' and club_year_id = (select id from club_years where label = '2026')), 'club_year_id', (select id from club_years where label = '2026'),
  'people', jsonb_build_array(jsonb_build_object('first_name', 'A', 'last_name', 'B'), jsonb_build_object('first_name', 'C', 'last_name', 'D'))))$q$, 'exactly one');
do $$ declare first uuid; hh uuid; m uuid; begin
  first := admin_add_member(jsonb_build_object('address_line1', '8 Weir Rd', 'postcode', 'BB8 8WW',
    'type_id', (select id from membership_types where code = 'F' and club_year_id = (select id from club_years where label = '2027')), 'club_year_id', (select id from club_years where label = '2027'),
    'people', jsonb_build_array(
      jsonb_build_object('first_name', 'Pat', 'last_name', 'Weir', 'date_of_birth', '1979-01-01'),
      jsonb_build_object('first_name', 'Quin', 'last_name', 'Weir', 'date_of_birth', '1981-01-01'),
      jsonb_build_object('first_name', 'Ray', 'last_name', 'Weir', 'date_of_birth', '2014-01-01', 'directory_opt_out', true))));
  select household_id into hh from people where id = first;
  assert (select count(*) from people where household_id = hh) = 3, 'three people in the new family';
  assert (select lead_person_id from households where id = hh) = first, 'first person is main contact';
  select id into m from memberships where household_id = hh;
  assert (select count(*) from membership_people where membership_id = m) = 3, 'Family covers all three';
  assert (select payer_person_id from memberships where id = m) = first, 'main contact pays';
  assert (select directory_opt_out from people where first_name = 'Ray' and last_name = 'Weir'), 'preference saved';
  perform admin_save_medical(first, 'Penicillin allergy');
  assert (select details from get_medical_record(first)) = 'Penicillin allergy', 'admin adds medical';
  perform admin_save_medical(first, 'None');
  assert (select details from get_medical_record(first)) = 'None', 'admin changes medical';
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select pg_temp.expect_error($q$select admin_save_medical('20000000-0000-0000-0000-00000000000e', 'x')$q$, 'Only an admin');
reset role;
reset request.jwt.claim.sub;

\echo 'Public applications: anyone can apply, admins accept or decline'
set role anon;
reset request.jwt.claim.sub;
do $$ begin
  assert (select count(*) from join_options() where cover = 'junior') = 0, 'Junior not offered publicly';
  assert (select count(*) from join_options()) > 0, 'options offered';
end $$;
select pg_temp.expect_error($q$select * from membership_applications$q$, 'permission denied');
select pg_temp.expect_error($q$select submit_application(jsonb_build_object('type_id', (select type_id from join_options() where cover = 'individual' limit 1),
  'club_year_id', (select club_year_id from join_options() limit 1), 'address_line1', '1 A', 'postcode', 'BB1',
  'people', jsonb_build_array(jsonb_build_object('first_name', 'Ann', 'last_name', 'Apply', 'date_of_birth', '1982-02-02', 'email', 'a@example.com'))))$q$, 'already uses that email');
select pg_temp.expect_error($q$select submit_application(jsonb_build_object('type_id', (select type_id from join_options() where cover = 'dual' limit 1),
  'club_year_id', (select club_year_id from join_options() limit 1), 'address_line1', '1 A', 'postcode', 'BB1',
  'people', jsonb_build_array(jsonb_build_object('first_name', 'Ann', 'last_name', 'Apply', 'date_of_birth', '1982-02-02', 'email', 'ann@example.com'))))$q$, 'exactly two');
select pg_temp.expect_error($q$select accept_application(gen_random_uuid())$q$, 'permission denied');
select pg_temp.expect_error($q$select submit_application(jsonb_build_object('type_id', (select type_id from join_options() where cover = 'individual' limit 1),
  'club_year_id', (select club_year_id from join_options() limit 1), 'address_line1', '1 A', 'postcode', 'BB1',
  'people', jsonb_build_array(jsonb_build_object('first_name', 'Nod', 'last_name', 'Apply', 'email', 'nod@example.com'))))$q$, 'Date of birth is needed');
select submit_application(jsonb_build_object('type_id', (select type_id from join_options() where type_name = 'Family' and is_next_year limit 1),
  'club_year_id', (select club_year_id from join_options() where is_next_year limit 1), 'address_line1', '3 Dam Rd', 'postcode', 'bb3 3cc',
  'household_id', '10000000-0000-0000-0000-000000000001', 'payment_method', 'cash',
  'people', jsonb_build_array(
    jsonb_build_object('first_name', 'Ann', 'last_name', 'Apply', 'date_of_birth', '1982-02-02', 'email', 'Ann@Example.com', 'medical_details', 'Asthma', 'medical_consent', true),
    jsonb_build_object('first_name', 'Ben', 'last_name', 'Apply', 'date_of_birth', '2016-01-01')))) \gset app_
select submit_application(jsonb_build_object('type_id', (select type_id from join_options() where type_name = 'Club Membership' limit 1),
  'club_year_id', (select club_year_id from join_options() limit 1), 'address_line1', '4 Dam Rd', 'postcode', 'bb3 3cc',
  'people', jsonb_build_array(jsonb_build_object('first_name', 'Spam', 'last_name', 'Bot', 'date_of_birth', '1990-01-01', 'email', 'spam@example.com', 'medical_details', 'x', 'medical_consent', true)))) \gset spam_
select pg_temp.expect_error($q$select submit_application(jsonb_build_object('type_id', (select type_id from join_options() where type_name = 'Club Membership' limit 1),
  'club_year_id', (select club_year_id from join_options() limit 1), 'address_line1', '4 Dam Rd', 'postcode', 'bb3 3cc',
  'people', jsonb_build_array(jsonb_build_object('first_name', 'Spam', 'last_name', 'Bot', 'date_of_birth', '1990-01-01', 'email', 'spam@example.com'))))$q$, 'already an application');
reset role;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select pg_temp.expect_error(format('select accept_application(%L)', :'app_submit_application'), 'Only an admin');
do $$ begin
  assert (select count(*) from membership_applications) = 0, 'members can''t see applications';
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';
do $$ declare ann uuid; hh uuid; begin
  assert (select count(*) from pending_applications()) = 2, 'two waiting';
  assert (select has_medical from pending_applications() where contact_name = 'Ann Apply'), 'medical flagged, not shown';
  ann := accept_application((select id from pending_applications() where contact_name = 'Ann Apply'));
  select household_id into hh from people where id = ann;
  assert hh <> '10000000-0000-0000-0000-000000000001', 'can''t be slipped into an existing family';
  assert (select count(*) from people where household_id = hh) = 2, 'Ann and Ben in a new family';
  assert (select status::text from memberships where household_id = hh) = 'awaiting_payment', 'no payment recorded from outside';
  assert (select email from people where id = ann) = 'ann@example.com', 'email saved';
  assert exists (select 1 from member_directory() where id = ann), 'joined for next year, so in the directory now';
  assert not exists (select 1 from member_directory() where first_name = 'Ben' and last_name = 'Apply'), 'child not in directory';
  assert (select data is null and status = 'accepted' from membership_applications where person_id = ann), 'application closed';
  perform decline_application((select id from pending_applications() where contact_name = 'Spam Bot'), 'Spam');
  assert (select data is null and status = 'declined' from membership_applications where contact_name = 'Spam Bot'), 'declined details deleted';
end $$;
select pg_temp.expect_error(format('select accept_application(%L)', :'app_submit_application'), 'already been dealt with');
reset role;
reset request.jwt.claim.sub;

-- Membership types: club admins add, edit and switch them off; members can't; nobody deletes one in use.
insert into auth.users values ('00000000-0000-0000-0000-0000000000a7');
insert into people (id, auth_user_id, first_name, last_name, date_of_birth, email)
values ('20000000-0000-0000-0000-0000000000a7', '00000000-0000-0000-0000-0000000000a7', 'Adam', 'Admin', '1975-01-01', 'adam@example.com');
insert into user_roles (person_id, role) values ('20000000-0000-0000-0000-0000000000a7', 'admin');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select pg_temp.expect_error($q$insert into membership_types (club_year_id, code, name, category, cover, annual_price_pence) values ((select id from club_years where label = '2026'), 'W', 'Windsurf', 'non_sailing', 'individual', 5000)$q$, 'row-level security');
do $$ begin
  update membership_types set annual_price_pence = 1 where code = 'C';
  assert (select annual_price_pence from membership_types where code = 'C' and club_year_id = (select id from club_years where label = '2026')) = 3000, 'members can''t change prices';
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a7';
do $$ begin
  insert into membership_types (club_year_id, code, name, category, cover, annual_price_pence, sort_order) values ((select id from club_years where label = '2026'), 'W', 'Windsurf', 'non_sailing', 'individual', 5000, 120);
  update membership_types set annual_price_pence = 5500, is_open = false where code = 'W';
  assert (select annual_price_pence = 5500 and not is_open from membership_types where code = 'W'), 'admin edits and makes inactive';
  assert not exists (select 1 from join_options() where type_name = 'Windsurf'), 'inactive type not offered on Join';
  delete from membership_types where code = 'W';
  assert exists (select 1 from membership_types where code = 'W'), 'admins can''t delete types';
end $$;
select pg_temp.expect_error($q$insert into membership_types (club_year_id, code, name, category, cover, annual_price_pence) values ((select id from club_years where label = '2026'), 'bad code', 'X', 'non_sailing', 'individual', 0)$q$, 'membership_types_code_format');
select pg_temp.expect_error($q$select start_membership((select id from membership_types where code = 'W'), array['20000000-0000-0000-0000-0000000000a7'::uuid], (select id from club_years where label = '2026'))$q$, 'not available');
reset role;
reset request.jwt.claim.sub;

-- Email templates: admins only; a starter renewal reminder is there to edit.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ begin
  assert (select count(*) from email_templates) = 0, 'members can''t see email templates';
end $$;
select pg_temp.expect_error($q$insert into email_templates (name, subject, body) values ('X', 'Y', 'Z')$q$, 'row-level security');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a7';
do $$ begin
  assert (select purpose from email_templates where name = 'Renewal reminder') = 'renewal_reminder', 'starter template';
  update email_templates set subject = 'Renew now, {first_name}' where name = 'Renewal reminder';
  insert into email_templates (name, subject, body) values ('Open day', 'Come along', 'Hello {first_name}');
  assert (select count(*) from email_templates) = 2, 'admin adds templates';
end $$;
reset role;
reset request.jwt.claim.sub;

-- Renewal reminders go to whoever renews, only for memberships not yet renewed; admins only.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select pg_temp.expect_error($q$select * from renewal_reminder_recipients((select id from club_years where label = '2027'))$q$, 'Admins only');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a7';
do $$ declare y uuid := (select id from club_years where label = '2027'); begin
  assert not exists (select 1 from renewal_reminder_recipients(y) where email = 'a@example.com'), 'Alice is already covered for 2027';
  assert not exists (select 1 from renewal_reminder_recipients(y) where email = 'e@example.com'), 'Eve has renewed for 2027';
  assert (select membership_types from renewal_reminder_recipients(y) where first_name = 'Max') = 'Individual Sailing, Junior', 'Max renews for himself and his junior';
  assert not exists (select 1 from renewal_reminder_recipients(y) where first_name = 'Bob'), 'juniors aren''t emailed';
  assert (select count(*) from renewal_reminder_recipients(y) r group by r.person_id order by 1 desc limit 1) = 1, 'one row per person';
end $$;
reset role;
reset request.jwt.claim.sub;

-- Each type has its own start and end date: pro rata within those dates, and not offered once ended.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a7';
do $$ declare m uuid; begin
  insert into membership_types (code, name, category, cover, annual_price_pence, starts_on, ends_on)
  values ('SUM', 'Summer only', 'non_sailing', 'individual', 2000, '2026-05-01', '2026-09-30'),
         ('WIN', 'Winter series', 'non_sailing', 'individual', 4000, '2026-11-01', '2027-02-28');
  assert (select cy.label from membership_types t join club_years cy on cy.id = t.club_year_id where t.code = 'WIN') = '2026', 'club year follows the start date';
  -- 5 December: 3 of Winter series' 4 months are left (December to February).
  m := start_membership((select id from membership_types where code = 'WIN'), array['20000000-0000-0000-0000-0000000000a7'::uuid], (select id from club_years where label = '2026'));
  assert (select price_pence::text || '/' || prorata_months from memberships where id = m) = '3000/3', 'pro rata within the type''s own dates';
end $$;
select pg_temp.expect_error($q$select start_membership((select id from membership_types where code = 'SUM'), array['20000000-0000-0000-0000-0000000000a7'::uuid], (select id from club_years where label = '2026'))$q$, 'not available');
select pg_temp.expect_error($q$update membership_types set starts_on = '2027-11-01', ends_on = '2028-02-28' where code = 'WIN'$q$, 'already has memberships');
select pg_temp.expect_error($q$insert into membership_types (code, name, category, cover, annual_price_pence, starts_on, ends_on) values ('BAD', 'Bad', 'non_sailing', 'individual', 0, '2026-05-01', '2026-04-01')$q$, 'membership_types_dates');
reset role;
reset request.jwt.claim.sub;

-- Admins renew for members: Max (no 2027 membership yet) renewed by an admin onto 2027 Club.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select pg_temp.expect_error($q$select admin_renew_membership((select id from people where first_name = 'Max'), (select id from membership_types where code = 'C' and club_year_id = (select id from club_years where label = '2027')), array[(select id from people where first_name = 'Max')], (select id from club_years where label = '2027'))$q$, 'Only an admin');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a7';
do $$ declare n uuid; begin
  n := admin_renew_membership((select id from people where first_name = 'Max'),
         (select id from membership_types where code = 'C' and club_year_id = (select id from club_years where label = '2027')),
         array[(select id from people where first_name = 'Max')], (select id from club_years where label = '2027'));
  assert (select status::text || '/' || price_pence from memberships where id = n) = 'awaiting_payment/3500', 'admin renews at next year''s price';
end $$;
select pg_temp.expect_error($q$select admin_renew_membership((select id from people where first_name = 'Max'), (select id from membership_types where code = 'C' and club_year_id = (select id from club_years where label = '2027')), array['20000000-0000-0000-0000-00000000000e'::uuid], (select id from club_years where label = '2027'))$q$, 'own household');
reset role;
reset request.jwt.claim.sub;

-- Contacts for email lists: admins only, email needed, no membership or family.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select pg_temp.expect_error($q$select admin_add_contact('{"first_name":"Cy","last_name":"Contact","email":"cy@example.com"}')$q$, 'Only an admin');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a7';
select pg_temp.expect_error($q$select admin_add_contact('{"first_name":"Cy","last_name":"Contact"}')$q$, 'email address is needed');
do $$ declare c uuid; begin
  c := admin_add_contact('{"first_name":"Cy","last_name":"Contact","email":"Cy@Example.com","news_consent":true}');
  assert (select is_contact and news_consent and household_id is null and email = 'cy@example.com' from people where id = c), 'contact added';
  assert not exists (select 1 from membership_people where person_id = c), 'no membership';
end $$;
reset role;
reset request.jwt.claim.sub;

\echo 'All database tests passed'
