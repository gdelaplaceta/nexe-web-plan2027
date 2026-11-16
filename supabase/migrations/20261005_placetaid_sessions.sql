-- Apply this migration when the PlacetaID login works but Nexe's document API
-- reports that public.nexe_documents is missing from the PostgREST schema.
alter table public.nexe_profiles
  add column if not exists terminos_version text,
  add column if not exists terminos_accepted_at timestamptz,
  add column if not exists privacidad_version text,
  add column if not exists privacidad_acknowledged_at timestamptz;
alter table public.nexe_profiles alter column id set default gen_random_uuid();

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

notify pgrst, 'reload schema';
