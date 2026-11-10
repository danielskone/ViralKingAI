-- Library items (products, avatars) live outside projects (project_id null), plus a "liked" flag.
alter table public.assets drop constraint if exists assets_kind_check;
alter table public.assets add constraint assets_kind_check check (kind = any (array['image','video','audio','logo','generated_clip','export','product','avatar']));
alter table public.assets add column if not exists liked boolean not null default false;
create index if not exists assets_owner_kind_idx on public.assets (owner_id, kind, created_at desc);
