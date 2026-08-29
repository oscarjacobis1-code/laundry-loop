create index if not exists site_content_updated_by_idx on public.site_content(updated_by);
create index if not exists staff_security_alerts_resolved_by_idx on public.staff_security_alerts(resolved_by);

drop policy if exists "staff see own attendance admin sees all" on public.staff_attendance;
create policy "staff see own attendance admin sees all" on public.staff_attendance
for select to authenticated
using (staff_user_id = (select auth.uid()) or (select private.is_admin()));

drop policy if exists "staff see own access admin sees all" on public.staff_access_sessions;
create policy "staff see own access admin sees all" on public.staff_access_sessions
for select to authenticated
using (staff_user_id = (select auth.uid()) or (select private.is_admin()));

drop policy if exists "admins manage services" on public.service_catalog;
drop policy if exists "public reads active services" on public.service_catalog;
drop policy if exists "staff reads all services" on public.service_catalog;
create policy "public reads active services" on public.service_catalog
for select to anon using (active);
create policy "authenticated staff read services" on public.service_catalog
for select to authenticated using (active or (select public.is_staff()));
create policy "admins insert services" on public.service_catalog
for insert to authenticated with check ((select private.is_admin()));
create policy "admins update services" on public.service_catalog
for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "admins delete services" on public.service_catalog
for delete to authenticated using ((select private.is_admin()));

drop policy if exists "admins manage staff profiles" on public.staff_profiles;
drop policy if exists "staff read own profile" on public.staff_profiles;
create policy "staff read own profile or admin reads all" on public.staff_profiles
for select to authenticated
using (((user_id = (select auth.uid())) and active) or (select private.is_admin()));
create policy "admins insert staff profiles" on public.staff_profiles
for insert to authenticated with check ((select private.is_admin()));
create policy "admins update staff profiles" on public.staff_profiles
for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "admins delete staff profiles" on public.staff_profiles
for delete to authenticated using ((select private.is_admin()));
