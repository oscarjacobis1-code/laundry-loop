create table if not exists public.staff_device_bindings (
  staff_user_id uuid primary key references auth.users(id) on delete cascade,
  device_hash text not null,
  device_label text,
  first_bound_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

alter table public.staff_device_bindings enable row level security;

revoke all on table public.staff_device_bindings from anon, authenticated;

create index if not exists staff_device_bindings_last_seen_idx
  on public.staff_device_bindings(last_seen_at);
