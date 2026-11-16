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
-- Nexe · seguridad y auditoría (16 nov 2026).
-- Idempotente: puede ejecutarse sobre una instalación existente.
--
-- Qué añade:
--  1. Registro de auditoría inmutable (nexe_audit_log). Ni UPDATE, ni DELETE
--     ni TRUNCATE están permitidos, ni siquiera para el servicio.
--  2. Funciones que escriben el dato y su auditoría en una única transacción.
--     Si la auditoría falla, la escritura se revierte.
--  3. Roles previstos en el documento de diseño (sin permisos nuevos todavía:
--     se tratan como aspirante hasta que se definan).

alter type public.nexe_role add value if not exists 'colaborador';
alter type public.nexe_role add value if not exists 'direccion';
alter type public.nexe_role add value if not exists 'secretaria';
alter type public.nexe_role add value if not exists 'vicepresidencia';

-- 1. Registro de auditoría -------------------------------------------------
create table if not exists public.nexe_audit_log (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  actor_id uuid,
  action text not null check (action in ('create', 'update', 'delete', 'consent', 'login', 'logout')),
  collection_path text,
  document_id text,
  before jsonb,
  after jsonb,
  ip text
);

create index if not exists nexe_audit_log_target_idx
  on public.nexe_audit_log (collection_path, document_id, created_at);
create index if not exists nexe_audit_log_actor_idx
  on public.nexe_audit_log (actor_id, created_at);

create or replace function public.nexe_audit_read_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'nexe_audit_log es de solo lectura' using errcode = '42501';
end;
$$;

drop trigger if exists nexe_audit_log_no_change on public.nexe_audit_log;
create trigger nexe_audit_log_no_change
  before update or delete on public.nexe_audit_log
  for each row execute function public.nexe_audit_read_only();

drop trigger if exists nexe_audit_log_no_truncate on public.nexe_audit_log;
create trigger nexe_audit_log_no_truncate
  before truncate on public.nexe_audit_log
  for each statement execute function public.nexe_audit_read_only();

alter table public.nexe_audit_log enable row level security;
revoke all on public.nexe_audit_log from anon, authenticated;
grant select on public.nexe_audit_log to service_role;
drop policy if exists "audit president read" on public.nexe_audit_log;
create policy "audit president read"
  on public.nexe_audit_log for select
  using (public.nexe_is_president());

-- 2. Escrituras atómicas con auditoría -------------------------------------
create or replace function public.nexe_save_document(
  p_collection text,
  p_document_id text,
  p_owner uuid,
  p_actor uuid,
  p_payload jsonb,
  p_merge boolean default false,
  p_ip text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_exists boolean;
begin
  select true, d.payload into v_exists, v_before
  from public.nexe_documents d
  where d.collection_path = p_collection and d.document_id = p_document_id
  for update;

  v_exists := coalesce(v_exists, false);
  v_after := case
    when p_merge then coalesce(v_before, '{}'::jsonb) || p_payload
    else p_payload
  end;

  insert into public.nexe_documents (collection_path, document_id, owner_id, payload)
  values (p_collection, p_document_id, p_owner, v_after)
  on conflict (collection_path, document_id)
  do update set owner_id = excluded.owner_id, payload = excluded.payload;

  insert into public.nexe_audit_log (actor_id, action, collection_path, document_id, before, after, ip)
  values (p_actor, case when v_exists then 'update' else 'create' end,
          p_collection, p_document_id, v_before, v_after, p_ip);

  return jsonb_build_object('document_id', p_document_id, 'payload', v_after);
end;
$$;

create or replace function public.nexe_delete_document(
  p_collection text,
  p_document_id text,
  p_actor uuid,
  p_ip text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb;
begin
  delete from public.nexe_documents
  where collection_path = p_collection and document_id = p_document_id
  returning payload into v_before;

  if not found then
    return false;
  end if;

  insert into public.nexe_audit_log (actor_id, action, collection_path, document_id, before, ip)
  values (p_actor, 'delete', p_collection, p_document_id, v_before, p_ip);
  return true;
end;
$$;

create or replace function public.nexe_insert_record(
  p_table text,
  p_owner uuid,
  p_actor uuid,
  p_payload jsonb,
  p_ip text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb;
begin
  if p_table not in (
    'departments', 'projects', 'tasks', 'task_comments', 'calls', 'tests',
    'call_tests', 'enrolments', 'attempts', 'agreements', 'payroll_complements'
  ) then
    raise exception 'invalid_table' using errcode = '22023';
  end if;

  execute format(
    'with ins as (insert into public.nexe_%I (owner_id, payload) values ($1, $2) returning *) select to_jsonb(ins) from ins',
    p_table
  ) into v_row using p_owner, p_payload;

  insert into public.nexe_audit_log (actor_id, action, collection_path, document_id, after, ip)
  values (p_actor, 'create', p_table, v_row->>'id', p_payload, p_ip);

  return v_row;
end;
$$;

create or replace function public.nexe_log_event(
  p_actor uuid,
  p_action text,
  p_collection text,
  p_document_id text,
  p_after jsonb,
  p_ip text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.nexe_audit_log (actor_id, action, collection_path, document_id, after, ip)
  values (p_actor, p_action, p_collection, p_document_id, p_after, p_ip);
end;
$$;

-- Solo el servidor (clave secreta) puede llamar a estas funciones.
revoke all on function public.nexe_save_document(text, text, uuid, uuid, jsonb, boolean, text) from public, anon, authenticated;
revoke all on function public.nexe_delete_document(text, text, uuid, text) from public, anon, authenticated;
revoke all on function public.nexe_insert_record(text, uuid, uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.nexe_log_event(uuid, text, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.nexe_save_document(text, text, uuid, uuid, jsonb, boolean, text) to service_role;
grant execute on function public.nexe_delete_document(text, text, uuid, text) to service_role;
grant execute on function public.nexe_insert_record(text, uuid, uuid, jsonb, text) to service_role;
grant execute on function public.nexe_log_event(uuid, text, text, text, jsonb, text) to service_role;

notify pgrst, 'reload schema';
-- (fin del bloque de seguridad y auditoría)
