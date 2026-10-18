create table if not exists public.pos_device_status (
  device_id text primary key,
  staff_user_id uuid not null references auth.users(id) on delete cascade,
  device_label text not null default 'Laundry Loop POS',
  app_version text,
  last_seen_at timestamptz not null default now(),
  last_sync_at timestamptz,
  pending_orders integer not null default 0 check (pending_orders >= 0),
  pending_attendance integer not null default 0 check (pending_attendance >= 0),
  last_order_code text,
  online boolean not null default true,
  user_agent text,
  updated_at timestamptz not null default now()
);

alter table public.pos_device_status enable row level security;
grant select, insert, update on public.pos_device_status to authenticated;

create policy "owner_monitor_select_device_status"
on public.pos_device_status for select to authenticated
using (
  staff_user_id = (select auth.uid())
  or exists (
    select 1 from public.staff_profiles p
    where p.user_id = (select auth.uid()) and p.active = true and p.role = 'admin'
  )
);

create policy "staff_report_device_status"
on public.pos_device_status for insert to authenticated
with check (
  staff_user_id = (select auth.uid())
  and exists (
    select 1 from public.staff_profiles p
    where p.user_id = (select auth.uid()) and p.active = true and p.role in ('staff','manager','admin')
  )
);

create policy "staff_update_device_status"
on public.pos_device_status for update to authenticated
using (staff_user_id = (select auth.uid()))
with check (staff_user_id = (select auth.uid()));

create index if not exists pos_device_status_last_seen_idx on public.pos_device_status (last_seen_at desc);
