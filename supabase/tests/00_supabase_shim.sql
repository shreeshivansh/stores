-- ============================================================================
-- Supabase environment shim for running migrations + pgTAP tests against a
-- bare local Postgres (no Supabase CLI / no real GoTrue).
--
-- This is NOT part of the production migration set and must never be applied
-- to a real Supabase project (Supabase already provides all of this).
-- It exists purely so `supabase/tests/database.test.sql` can run in CI or any
-- plain Postgres instance. See README.md "Running the pgTAP suite locally".
--
-- Provides the minimum surface the migrations touch:
--   - roles: anon, authenticated, service_role
--   - schema auth, table auth.users (id, email, raw_user_meta_data)
--   - auth.uid() reading request.jwt.claim.sub, the same local-setting
--     convention Supabase's Postgres uses under PostgREST
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end
$$;

grant anon, authenticated, service_role to current_user;

create schema if not exists auth;

create table if not exists auth.users (
  id                  uuid primary key default gen_random_uuid(),
  email               text unique,
  raw_user_meta_data  jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now()
);

create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.role', true), '')::text;
$$;
