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

\echo 'Member (Alice): visibility, pricing and household rules'
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ begin
  assert (select count(*) from people) = 2, 'Alice should see only herself and Bob';
  perform start_membership((select id from membership_types where code = 'IS'), array['20000000-0000-0000-0000-00000000000a'::uuid], '2026-03-05');
  perform start_membership((select id from membership_types where code = 'J1'), array['20000000-0000-0000-0000-00000000000b'::uuid], '2026-03-05');
  assert (select price_pence from memberships m join membership_types t on t.id = m.membership_type_id where t.code = 'IS') = 18500, 'IS full price';
  assert (select price_pence from memberships m join membership_types t on t.id = m.membership_type_id where t.code = 'J1') = 9500, 'J1 full price';
end $$;
select pg_temp.expect_error($q$update people set first_joined_on = '2000-01-01' where first_name = 'Alice'$q$, 'Only an admin');
select pg_temp.expect_error($q$insert into memberships (club_year_id, membership_type_id, payer_person_id, price_pence) select (select id from club_years limit 1), (select id from membership_types where code = 'IS'), '20000000-0000-0000-0000-00000000000a', 0$q$, 'row-level security');
select pg_temp.expect_error($q$select start_membership((select id from membership_types where code = 'IS'), array['20000000-0000-0000-0000-00000000000e'::uuid], '2026-03-05')$q$, 'own household');
select pg_temp.expect_error($q$select start_membership((select id from membership_types where code = 'U21'), array['20000000-0000-0000-0000-00000000000a'::uuid], '2026-03-05')$q$, 'age limit');
do $$ begin
  update people set news_consent = true where first_name = 'Alice';
  assert (select news_consent_at is not null from people where first_name = 'Alice'), 'consent should be time-stamped';
  insert into medical_records (person_id, details, consent_given_at) values ('20000000-0000-0000-0000-00000000000a', 'Asthma', now());
  assert (select count(*) from audit_log) = 0, 'members cannot read the change log';
end $$;

\echo 'Member (Eve): pro rata, approval and medical privacy'
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';
do $$ begin
  assert (select count(*) from people) = 1, 'Eve should see only herself';
  perform start_membership((select id from membership_types where code = 'C'), array['20000000-0000-0000-0000-00000000000e'::uuid], '2026-09-10');
  perform start_membership((select id from membership_types where code = 'A'), array['20000000-0000-0000-0000-00000000000e'::uuid], '2026-09-10');
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
select pg_temp.expect_error($q$select start_membership(gen_random_uuid(), array[]::uuid[])$q$, 'permission denied');
select pg_temp.expect_error($q$select * from people$q$, 'permission denied');
reset role;

do $$ begin
  assert prorata_months('2026-03-01') = 12 and prorata_months('2026-09-10') = 6 and prorata_months('2027-02-01') = 1, 'pro rata months';
end $$;
\echo 'All database tests passed'
