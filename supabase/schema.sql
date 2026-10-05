-- Nexe · modelo de datos para sesiones PlacetaID gestionadas por el servidor.
-- SUPABASE_SECRET_KEY debe permanecer exclusivamente en el servidor.
create extension if not exists pgcrypto;

do $$ begin
  create type public.nexe_role as enum ('aspirante', 'administracion', 'presidencia');
exception
  when duplicate_object then null;
end $$;

-- PlacetaID autentica por DIP y Nexe firma su propia cookie de sesión.
-- Por eso el perfil no depende de que exista un usuario en auth.users.
create table if not exists public.nexe_profiles (
  id uuid primary key default gen_random_uuid(),
  dip text not null unique check (dip ~ '^[0-9]{8}[A-Z]$' or dip ~ '^[XYZ][0-9]{7}[A-Z]$'),
  nombre text not null,
  rol public.nexe_role not null default 'aspirante',
  rsp_verificado boolean not null default false,
  rsp_verificado_at timestamptz,
  datos_placetaid jsonb not null default '{}'::jsonb,
  placetaid_synced_at timestamptz,
  terminos_version text,
  terminos_accepted_at timestamptz,
  privacidad_version text,
  privacidad_acknowledged_at timestamptz,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.nexe_profiles
  add column if not exists terminos_version text,
  add column if not exists terminos_accepted_at timestamptz,
  add column if not exists privacidad_version text,
  add column if not exists privacidad_acknowledged_at timestamptz;
alter table public.nexe_profiles alter column id set default gen_random_uuid();

-- Previous Nexe schemas tied these PlacetaID profiles to Supabase Auth users.
-- Nexe now owns the session and maps it to a profile by DIP.
do $$ declare
  constraint_name text;
begin
  for constraint_name in
    select c.conname
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
    where c.conrelid = 'public.nexe_profiles'::regclass
      and c.confrelid = 'auth.users'::regclass
      and c.contype = 'f'
      and a.attname = 'id'
  loop
    execute format('alter table public.nexe_profiles drop constraint %I', constraint_name);
  end loop;
end $$;

create or replace function public.nexe_is_president()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.nexe_profiles
    where id = auth.uid()
      and dip = '23749931M'
      and rol = 'presidencia'
      and activo
  );
$$;

-- These JSON records are the storage format used by api/nexe-records.js.
-- They deliberately have no FK to auth.users: the authenticated server
-- resolves PlacetaID sessions to nexe_profiles.id.
do $$ declare
  table_name text;
  constraint_name text;
begin
  foreach table_name in array array[
    'departments', 'projects', 'tasks', 'task_comments', 'calls', 'tests',
    'call_tests', 'enrolments', 'attempts', 'agreements', 'payroll_complements'
  ] loop
    execute format(
      'create table if not exists public.nexe_%I (
        id uuid primary key default gen_random_uuid(),
        owner_id uuid not null references public.nexe_profiles(id),
        payload jsonb not null default ''{}''::jsonb,
        created_at timestamptz not null default now()
      )',
      table_name
    );
    execute format(
      'alter table public.nexe_%I add column if not exists owner_id uuid',
      table_name
    );
    execute format(
      'alter table public.nexe_%I add column if not exists payload jsonb not null default ''{}''::jsonb',
      table_name
    );
    execute format(
      'alter table public.nexe_%I add column if not exists created_at timestamptz not null default now()',
      table_name
    );
    for constraint_name in
      select c.conname
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
      where c.conrelid = format('public.nexe_%I', table_name)::regclass
        and c.confrelid = 'auth.users'::regclass
        and c.contype = 'f'
        and a.attname = 'owner_id'
    loop
      execute format('alter table public.nexe_%I drop constraint %I', table_name, constraint_name);
    end loop;
    if not exists (
      select 1
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
      where c.conrelid = format('public.nexe_%I', table_name)::regclass
        and c.confrelid = 'public.nexe_profiles'::regclass
        and c.contype = 'f'
        and a.attname = 'owner_id'
    ) then
      execute format(
        'alter table public.nexe_%I add constraint %I foreign key (owner_id) references public.nexe_profiles(id) not valid',
        table_name,
        'nexe_' || table_name || '_owner_profile_fkey'
      );
    end if;
    execute format('alter table public.nexe_%I enable row level security', table_name);
    execute format('drop policy if exists %I on public.nexe_%I', 'nexe ' || table_name || ' read', table_name);
    execute format(
      'create policy %I on public.nexe_%I for select using (owner_id = auth.uid() or public.nexe_is_president())',
      'nexe ' || table_name || ' read',
      table_name
    );
    execute format('drop policy if exists %I on public.nexe_%I', 'nexe ' || table_name || ' insert', table_name);
    execute format(
      'create policy %I on public.nexe_%I for insert with check (owner_id = auth.uid())',
      'nexe ' || table_name || ' insert',
      table_name
    );
  end loop;
end $$;

alter table public.nexe_profiles enable row level security;
drop policy if exists "profiles own or president" on public.nexe_profiles;
create policy "profiles own or president"
  on public.nexe_profiles for select
  using (id = auth.uid() or public.nexe_is_president());
drop policy if exists "profiles own update" on public.nexe_profiles;
create policy "profiles own update"
  on public.nexe_profiles for update
  using (id = auth.uid())
  with check (id = auth.uid() and rol = 'aspirante');

-- Server-backed document store for the existing Nexe UI. Access is mediated
-- by api/nexe-records.js using the signed Nexe session; do not expose the
-- server secret key to browser clients.
create table if not exists public.nexe_documents (
  id uuid primary key default gen_random_uuid(),
  collection_path text not null,
  document_id text not null,
  owner_id uuid not null references public.nexe_profiles(id),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (collection_path, document_id)
);
alter table public.nexe_documents enable row level security;
revoke all on public.nexe_documents from anon, authenticated;
grant all on public.nexe_documents to service_role;

-- New aspirant accounts are inserted only after explicit acceptance of the
-- current Nexe terms and acknowledgment of the privacy notice.
notify pgrst, 'reload schema';
