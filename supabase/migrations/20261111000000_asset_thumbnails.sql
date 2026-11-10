-- Small preview images for fast-loading grids (made in the browser at upload time).
alter table public.assets add column if not exists thumb_path text;
