alter table public.orders
  add column if not exists entry_source text not null default 'live',
  add column if not exists original_transaction_at timestamptz,
  add column if not exists paper_reference text;

alter table public.orders drop constraint if exists orders_entry_source_check;
alter table public.orders add constraint orders_entry_source_check check (entry_source in ('live','paper_recovery'));
create unique index if not exists orders_paper_reference_unique on public.orders (paper_reference) where paper_reference is not null;

create table if not exists public.staff_attendance (
  id uuid primary key default gen_random_uuid(),
  staff_user_id uuid not null references auth.users(id) on delete cascade,
  check_in_at timestamptz not null default now(),
  check_out_at timestamptz,
  source text not null default 'tablet' check (source in ('tablet','admin_correction')),
  correction_note text,
  created_at timestamptz not null default now()
);
create unique index if not exists staff_attendance_one_open_shift on public.staff_attendance(staff_user_id) where check_out_at is null;
create index if not exists staff_attendance_staff_time_idx on public.staff_attendance(staff_user_id,check_in_at desc);

create table if not exists public.staff_access_sessions (
  id uuid primary key,
  staff_user_id uuid not null references auth.users(id) on delete cascade,
  login_at timestamptz not null default now(),
  logout_at timestamptz,
  last_activity_at timestamptz not null default now(),
  end_reason text,
  created_at timestamptz not null default now()
);
create index if not exists staff_access_sessions_staff_time_idx on public.staff_access_sessions(staff_user_id,login_at desc);

alter table public.staff_attendance enable row level security;
alter table public.staff_access_sessions enable row level security;
revoke all on public.staff_attendance, public.staff_access_sessions from anon, authenticated;
grant select on public.staff_attendance, public.staff_access_sessions to authenticated;

drop policy if exists "staff see own attendance admin sees all" on public.staff_attendance;
create policy "staff see own attendance admin sees all" on public.staff_attendance for select to authenticated
using (staff_user_id=auth.uid() or private.is_admin());
drop policy if exists "staff see own access admin sees all" on public.staff_access_sessions;
create policy "staff see own access admin sees all" on public.staff_access_sessions for select to authenticated
using (staff_user_id=auth.uid() or private.is_admin());

create or replace function public.staff_check_in()
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_row public.staff_attendance;
begin
  if not public.is_staff() then raise exception 'Not authorized'; end if;
  if exists(select 1 from public.staff_attendance where staff_user_id=auth.uid() and check_out_at is null) then
    raise exception 'You are already checked in';
  end if;
  insert into public.staff_attendance(staff_user_id) values(auth.uid()) returning * into v_row;
  return to_jsonb(v_row);
end $$;

create or replace function public.staff_check_out()
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_row public.staff_attendance;
begin
  if not public.is_staff() then raise exception 'Not authorized'; end if;
  update public.staff_attendance set check_out_at=now()
    where id=(select id from public.staff_attendance where staff_user_id=auth.uid() and check_out_at is null order by check_in_at desc limit 1)
    returning * into v_row;
  if v_row.id is null then raise exception 'No open shift was found'; end if;
  return to_jsonb(v_row);
end $$;

create or replace function public.staff_access_login(p_session_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.is_staff() then raise exception 'Not authorized'; end if;
  insert into public.staff_access_sessions(id,staff_user_id) values(p_session_id,auth.uid())
  on conflict(id) do update set last_activity_at=now();
end $$;
create or replace function public.staff_access_heartbeat(p_session_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  update public.staff_access_sessions set last_activity_at=now() where id=p_session_id and staff_user_id=auth.uid() and logout_at is null;
end $$;
create or replace function public.staff_access_logout(p_session_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  update public.staff_access_sessions set logout_at=now(),last_activity_at=now(),end_reason='signed_out' where id=p_session_id and staff_user_id=auth.uid() and logout_at is null;
end $$;

create or replace function public.staff_create_recovered_order(
  p_name text,p_phone text,p_items jsonb,p_notes text,p_payment jsonb,p_original_transaction_at timestamptz,p_paper_reference text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_order jsonb; v_saved public.orders;
begin
  if not public.is_staff() then raise exception 'Not authorized'; end if;
  if p_original_transaction_at is null or p_original_transaction_at > now() then raise exception 'Enter a valid original transaction time'; end if;
  if nullif(trim(p_paper_reference),'') is null then raise exception 'Paper reference is required'; end if;
  if coalesce(p_payment->>'method','') not in ('Cash','MMG') then raise exception 'Payment must be Cash or MMG'; end if;
  v_order := public.staff_create_order(p_name,p_phone,p_items,p_notes,p_payment);
  update public.orders set entry_source='paper_recovery',original_transaction_at=p_original_transaction_at,paper_reference=left(trim(p_paper_reference),80)
    where id=(v_order->>'id')::uuid returning * into v_saved;
  return to_jsonb(v_saved)-'photo_upload_token_hash'-'photo_upload_expires_at';
end $$;

create or replace function public.staff_update_order(
  p_order_id uuid,p_status text default null,p_payment_status text default null,p_discount_gyd numeric default null,p_notes text default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_order public.orders; v_subtotal numeric; v_discount numeric; v_role text;
begin
  if not public.is_staff() then raise exception 'Not authorized'; end if;
  select role into v_role from public.staff_profiles where user_id=auth.uid() and active;
  if (p_discount_gyd is not null or p_status='Cancelled/Refunded' or p_payment_status='Refunded') and v_role not in ('manager','admin') then
    raise exception 'Supervisor or administrator approval is required';
  end if;
  if p_status is not null and p_status not in ('Received','Washing','Drying','Ready for Pick-Up','Picked Up (Archived)','Cancelled/Refunded') then raise exception 'Invalid order status'; end if;
  if p_payment_status is not null and p_payment_status not in ('Pay at Pickup','Pending Confirmation','Paid','Refunded') then raise exception 'Invalid payment status'; end if;
  select * into v_order from public.orders where id=p_order_id for update;
  if v_order.id is null then raise exception 'Order not found'; end if;
  v_subtotal:=coalesce(v_order.subtotal,v_order.total+coalesce(v_order.discount,0));
  v_discount:=case when p_discount_gyd is null then coalesce(v_order.discount,0) else greatest(p_discount_gyd,0) end;
  if v_discount>v_subtotal then raise exception 'Discount cannot exceed subtotal'; end if;
  update public.orders set status=coalesce(p_status,status),payment=case when p_payment_status is null then payment else jsonb_set(payment,'{status}',to_jsonb(p_payment_status),true) end,
    subtotal=v_subtotal,discount=v_discount,total=v_subtotal-v_discount,notes=case when p_notes is null then notes else left(p_notes,1000) end
    where id=p_order_id returning * into v_order;
  return to_jsonb(v_order)-'photo_upload_token_hash'-'photo_upload_expires_at';
end $$;

revoke all on function public.staff_check_in(),public.staff_check_out(),public.staff_access_login(uuid),public.staff_access_heartbeat(uuid),public.staff_access_logout(uuid),public.staff_create_recovered_order(text,text,jsonb,text,jsonb,timestamptz,text) from public,anon;
grant execute on function public.staff_check_in(),public.staff_check_out(),public.staff_access_login(uuid),public.staff_access_heartbeat(uuid),public.staff_access_logout(uuid),public.staff_create_recovered_order(text,text,jsonb,text,jsonb,timestamptz,text) to authenticated;

update public.staff_profiles p set display_name='In-store Staff'
from auth.users u where u.id=p.user_id and lower(u.email)=lower('oscarjacobis1@gmail.com') and p.role='staff';
