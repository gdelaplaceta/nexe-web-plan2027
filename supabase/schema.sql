-- Nexe · modelo de datos y seguridad Supabase
-- Ejecutar en Supabase SQL Editor. La clave service_role nunca debe llegar al navegador.
create extension if not exists pgcrypto;

create type public.nexe_role as enum ('aspirante','administracion','presidencia');

create table if not exists public.nexe_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  dip text not null unique check (dip ~ '^[0-9]{8}[A-Z]$' or dip ~ '^[XYZ][0-9]{7}[A-Z]$'),
  nombre text not null,
  rol public.nexe_role not null default 'aspirante',
  rsp_verificado boolean not null default false,
  rsp_verificado_at timestamptz,
  datos_placetaid jsonb not null default '{}'::jsonb,
  placetaid_synced_at timestamptz,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.nexe_tests (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  nombre text not null,
  ambito text not null,
  preguntas jsonb not null default '[]'::jsonb,
  activa boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.nexe_calls (
  id uuid primary key default gen_random_uuid(), titulo text not null,
  proyecto text, plazas integer not null check (plazas > 0), estado text not null default 'abierta',
  cierre date, created_by uuid not null references auth.users(id), created_at timestamptz not null default now()
);

create table if not exists public.nexe_call_tests (
  call_id uuid not null references public.nexe_calls(id) on delete cascade,
  test_id uuid not null references public.nexe_tests(id),
  primary key (call_id,test_id)
);

create table if not exists public.nexe_attempts (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  test_id uuid not null references public.nexe_tests(id), call_id uuid references public.nexe_calls(id) on delete set null,
  respuestas jsonb not null default '{}', estado text not null default 'enviado', nota numeric,
  realizado_at timestamptz not null default now(), vigente_hasta timestamptz generated always as (realizado_at + interval '6 months') stored,
  unique(user_id,test_id,realizado_at)
);

create or replace function public.nexe_is_president() returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.nexe_profiles where id=auth.uid() and dip='23749931M' and rol='presidencia' and activo);
$$;

-- Registros operativos consultados por el BFF de Nexe.
do $$ declare t text; begin
  foreach t in array array['departments','projects','tasks','task_comments','calls','tests','call_tests','enrolments','attempts','agreements','payroll_complements'] loop
    execute format('create table if not exists public.nexe_%I (id uuid primary key default gen_random_uuid(), owner_id uuid references auth.users(id), payload jsonb not null default ''{}''::jsonb, created_at timestamptz not null default now())', t);
    execute format('alter table public.nexe_%I enable row level security', t);
    execute format('create policy "nexe %s read" on public.nexe_%I for select using (owner_id=auth.uid() or public.nexe_is_president())', t, t);
    execute format('create policy "nexe %s insert" on public.nexe_%I for insert with check (owner_id=auth.uid())', t, t);
  end loop;
end $$;

alter table public.nexe_profiles enable row level security;
alter table public.nexe_tests enable row level security;
alter table public.nexe_calls enable row level security;
alter table public.nexe_call_tests enable row level security;
alter table public.nexe_attempts enable row level security;

create policy "profiles own or president" on public.nexe_profiles for select using (id=auth.uid() or public.nexe_is_president());
create policy "profiles own update" on public.nexe_profiles for update using (id=auth.uid()) with check (id=auth.uid() and rol='aspirante');
create policy "tests visible" on public.nexe_tests for select using (activa or public.nexe_is_president());
create policy "tests president write" on public.nexe_tests for all using (public.nexe_is_president()) with check (public.nexe_is_president());
create policy "calls visible" on public.nexe_calls for select using (true);
create policy "calls president write" on public.nexe_calls for all using (public.nexe_is_president()) with check (public.nexe_is_president());
create policy "call tests visible" on public.nexe_call_tests for select using (true);
create policy "call tests president write" on public.nexe_call_tests for all using (public.nexe_is_president()) with check (public.nexe_is_president());
create policy "attempts own read" on public.nexe_attempts for select using (user_id=auth.uid() or public.nexe_is_president());
create policy "attempts own insert" on public.nexe_attempts for insert with check (user_id=auth.uid() and vigente_hasta > now());

-- El presidente se asigna exclusivamente mediante una operación administrativa/Edge Function
-- que verifica el DIP en RSP. No se permite elevar el rol desde el cliente.
