-- Service catalog maintenance is an operational responsibility for managers,
-- while destructive deletion remains administrator-only.
create or replace function private.can_manage_services()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.staff_profiles
    where user_id = (select auth.uid())
      and active
      and role in ('manager', 'admin')
  );
$$;

revoke all on function private.can_manage_services() from public;
grant execute on function private.can_manage_services() to authenticated;

drop policy if exists "admins insert services" on public.service_catalog;
drop policy if exists "admins update services" on public.service_catalog;
drop policy if exists "managers and admins insert services" on public.service_catalog;
drop policy if exists "managers and admins update services" on public.service_catalog;

create policy "managers and admins insert services"
on public.service_catalog
for insert
to authenticated
with check ((select private.can_manage_services()));

create policy "managers and admins update services"
on public.service_catalog
for update
to authenticated
using ((select private.can_manage_services()))
with check ((select private.can_manage_services()));
