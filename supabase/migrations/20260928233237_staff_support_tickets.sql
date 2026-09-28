create table public.staff_support_tickets (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null default auth.uid() references auth.users(id),
  category text not null check (category in ('Login', 'Orders', 'Payments', 'Printing', 'Other')),
  description text not null check (char_length(trim(description)) between 10 and 2000),
  order_code text check (order_code is null or (char_length(order_code) between 6 and 20 and order_code ~ '^[A-Za-z0-9-]+$')),
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved')),
  created_at timestamptz not null default now()
);

create index staff_support_tickets_created_at_idx on public.staff_support_tickets (created_at desc);
create index staff_support_tickets_created_by_idx on public.staff_support_tickets (created_by, created_at desc);

alter table public.staff_support_tickets enable row level security;
revoke all on public.staff_support_tickets from anon, authenticated;
grant select on public.staff_support_tickets to authenticated;
grant insert (category, description, order_code) on public.staff_support_tickets to authenticated;
grant update (status) on public.staff_support_tickets to authenticated;

create policy "staff submit own support tickets" on public.staff_support_tickets
for insert to authenticated
with check (created_by = (select auth.uid()) and (select public.is_staff()) and status = 'open');

create policy "staff see own tickets admins see all" on public.staff_support_tickets
for select to authenticated
using (created_by = (select auth.uid()) or (select private.is_admin()));

create policy "admins update ticket status" on public.staff_support_tickets
for update to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));
