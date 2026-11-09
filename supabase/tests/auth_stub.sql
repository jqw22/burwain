-- Minimal stand-in for the parts of Supabase the migrations rely on,
-- so they can be tested on plain Postgres. Not used in Supabase itself.
do $$ begin
  if not exists (select from pg_roles where rolname = 'anon') then
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
  end if;
end $$;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create or replace function auth.jwt() returns jsonb language sql stable as
  $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid(), auth.jwt() to anon, authenticated;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
