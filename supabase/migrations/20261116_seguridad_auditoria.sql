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
