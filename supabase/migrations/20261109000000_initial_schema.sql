-- Applied to Supabase project zlpzfavcieiyfitviaoe on 2026-11-09
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

create table public.brand_kits (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name text not null default 'My brand',
  logo_path text,
  primary_color text,
  secondary_color text,
  font_family text,
  created_at timestamptz not null default now()
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  title text not null,
  offer_description text,
  aspect_ratio text not null default '9:16' check (aspect_ratio in ('9:16','16:9','1:1')),
  brand_kit_id uuid references public.brand_kits(id) on delete set null,
  status text not null default 'draft' check (status in ('draft','generating','ready','failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  project_id uuid references public.projects(id) on delete cascade,
  kind text not null check (kind in ('image','video','audio','logo','generated_clip','export')),
  storage_path text not null unique,
  file_name text,
  mime_type text,
  size_bytes bigint,
  created_at timestamptz not null default now()
);

create table public.generation_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  job_type text not null check (job_type in ('script','video','caption','render')),
  status text not null default 'queued' check (status in ('queued','running','succeeded','failed','cancelled')),
  idempotency_key text unique,
  input jsonb not null default '{}'::jsonb,
  output jsonb,
  error text,
  gpu_seconds numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on public.brand_kits(owner_id);
create index on public.projects(owner_id);
create index on public.projects(brand_kit_id);
create index on public.assets(owner_id);
create index on public.assets(project_id);
create index on public.generation_jobs(owner_id);
create index on public.generation_jobs(project_id);

alter table public.profiles enable row level security;
alter table public.brand_kits enable row level security;
alter table public.projects enable row level security;
alter table public.assets enable row level security;
alter table public.generation_jobs enable row level security;

create policy "own profile" on public.profiles for all to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create policy "own brand kits" on public.brand_kits for all to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "own projects" on public.projects for all to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "own assets" on public.assets for all to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
-- jobs: users can read and create; only the server (service role) updates status
create policy "read own jobs" on public.generation_jobs for select to authenticated
  using ((select auth.uid()) = owner_id);
create policy "create own jobs" on public.generation_jobs for insert to authenticated
  with check ((select auth.uid()) = owner_id);

create or replace function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end; $$;
create trigger projects_updated before update on public.projects
  for each row execute function public.set_updated_at();
create trigger jobs_updated before update on public.generation_jobs
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name) values (new.id, new.raw_user_meta_data->>'display_name');
  return new;
end; $$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

insert into storage.buckets (id, name, public, file_size_limit)
values ('media', 'media', false, 524288000);

create policy "own media read" on storage.objects for select to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own media insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own media update" on storage.objects for update to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own media delete" on storage.objects for delete to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);
