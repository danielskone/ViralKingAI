-- Users may only queue script jobs for their own projects, and may withdraw
-- a job that the worker has not picked up yet. Everything else is service-role only.
drop policy "create own jobs" on public.generation_jobs;
create policy "create own jobs" on public.generation_jobs for insert to authenticated
  with check (
    (select auth.uid()) = owner_id
    and status = 'queued'
    and job_type = 'script'
    and exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid()))
  );
create policy "withdraw own queued jobs" on public.generation_jobs for delete to authenticated
  using ((select auth.uid()) = owner_id and status = 'queued');
