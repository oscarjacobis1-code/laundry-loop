-- Security gate hardening for Laundry Loop.
-- Enforce backend authorization instead of relying on UI controls.

create table if not exists public.staff_login_failures (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_started_at timestamptz not null default now(),
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  blocked_until timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.staff_login_failures enable row level security;
revoke all on table public.staff_login_failures from public, anon, authenticated;

create or replace function public.staff_login_guard(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_row public.staff_login_failures;
begin
  select * into v_row from public.staff_login_failures where user_id = p_user_id;
  if v_row.user_id is null then
    return jsonb_build_object('allowed', true, 'retry_after_seconds', 0);
  end if;
  if v_row.blocked_until is not null and v_row.blocked_until > now() then
    return jsonb_build_object(
      'allowed', false,
      'retry_after_seconds', greatest(1, ceil(extract(epoch from (v_row.blocked_until - now())))::int)
    );
  end if;
  if v_row.window_started_at < now() - interval '15 minutes' then
    delete from public.staff_login_failures where user_id = p_user_id;
  end if;
  return jsonb_build_object('allowed', true, 'retry_after_seconds', 0);
end;
$$;

create or replace function public.staff_login_record_failure(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_attempts integer;
begin
  insert into public.staff_login_failures(user_id, window_started_at, failed_attempts, blocked_until, updated_at)
  values (p_user_id, now(), 1, null, now())
  on conflict (user_id) do update
  set window_started_at = case
        when public.staff_login_failures.window_started_at < now() - interval '15 minutes' then now()
        else public.staff_login_failures.window_started_at
      end,
      failed_attempts = case
        when public.staff_login_failures.window_started_at < now() - interval '15 minutes' then 1
        else public.staff_login_failures.failed_attempts + 1
      end,
      blocked_until = case
        when public.staff_login_failures.window_started_at < now() - interval '15 minutes' then null
        else public.staff_login_failures.blocked_until
      end,
      updated_at = now()
  returning failed_attempts into v_attempts;

  if v_attempts >= 5 then
    update public.staff_login_failures
    set blocked_until = now() + interval '15 minutes', updated_at = now()
    where user_id = p_user_id;
  end if;
end;
$$;

create or replace function public.staff_login_clear_failures(p_user_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.staff_login_failures where user_id = p_user_id;
$$;

revoke all on function public.staff_login_guard(uuid) from public, anon, authenticated;
revoke all on function public.staff_login_record_failure(uuid) from public, anon, authenticated;
revoke all on function public.staff_login_clear_failures(uuid) from public, anon, authenticated;
grant execute on function public.staff_login_guard(uuid) to service_role;
grant execute on function public.staff_login_record_failure(uuid) to service_role;
grant execute on function public.staff_login_clear_failures(uuid) to service_role;

-- New inventory items are a supervisor/admin capability, not a regular-staff capability.
create or replace function public.admin_create_inventory_item(
  p_name text,
  p_unit text,
  p_reorder_level numeric default 0,
  p_opening_stock numeric default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.inventory_items;
  v_role text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select role into v_role from public.staff_profiles where user_id = auth.uid() and active;
  if v_role not in ('manager','admin') then raise exception 'Supervisor or administrator access required'; end if;
  if char_length(trim(coalesce(p_name,''))) < 2 or char_length(trim(p_name)) > 80
     or char_length(trim(coalesce(p_unit,''))) < 1 or char_length(trim(p_unit)) > 30
  then raise exception 'Enter a valid item name and unit'; end if;
  if coalesce(p_reorder_level,0) < 0 or coalesce(p_opening_stock,0) < 0
  then raise exception 'Stock values cannot be negative'; end if;

  insert into public.inventory_items(name,unit,reorder_level,active)
  values(trim(p_name),trim(p_unit),round(coalesce(p_reorder_level,0),3),true)
  returning * into v_item;

  if coalesce(p_opening_stock,0) > 0 then
    insert into public.inventory_movements(inventory_item_id,movement_type,quantity_delta,note,recorded_by)
    values(v_item.id,'restock',round(p_opening_stock,3),'Opening stock',auth.uid());
  end if;

  return to_jsonb(v_item);
exception when unique_violation then
  raise exception 'An inventory item with this name already exists';
end;
$$;

create or replace function public.staff_create_inventory_item(
  p_name text,
  p_unit text,
  p_reorder_level numeric default 0,
  p_opening_stock numeric default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.inventory_items;
  v_role text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select role into v_role from public.staff_profiles where user_id = auth.uid() and active;
  if v_role not in ('manager','admin') then raise exception 'Supervisor or administrator access required'; end if;
  if char_length(trim(coalesce(p_name,''))) < 2 or char_length(trim(p_name)) > 80
  then raise exception 'Item name must be between 2 and 80 characters'; end if;
  if char_length(trim(coalesce(p_unit,''))) < 1 or char_length(trim(p_unit)) > 30
  then raise exception 'Enter a valid inventory unit'; end if;
  if coalesce(p_reorder_level,0) < 0 or coalesce(p_opening_stock,0) < 0
  then raise exception 'Stock values cannot be negative'; end if;

  insert into public.inventory_items(name,unit,reorder_level,active)
  values(trim(p_name),trim(p_unit),round(coalesce(p_reorder_level,0),3),true)
  returning * into v_item;

  if coalesce(p_opening_stock,0) > 0 then
    insert into public.inventory_movements(inventory_item_id,movement_type,quantity_delta,note,recorded_by)
    values(v_item.id,'restock',round(p_opening_stock,3),'Opening stock',auth.uid());
  end if;

  return jsonb_build_object('item',to_jsonb(v_item),'opening_stock',round(coalesce(p_opening_stock,0),3));
exception when unique_violation then
  raise exception 'An inventory item with this name already exists';
end;
$$;

-- Regular staff can see today's headline only. Managers/admins can request wider analytics.
create or replace function public.staff_operations_summary(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_role text;
  v_days integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select role into v_role from public.staff_profiles where user_id = auth.uid() and active;
  if v_role is null then raise exception 'Staff access required'; end if;

  v_days := case when v_role = 'staff' then 1 else p_days end;
  if v_days < 1 or v_days > 365 then raise exception 'Days must be between 1 and 365'; end if;

  with recent_orders as (
    select * from public.orders where created_at >= now() - make_interval(days => v_days)
  ), busiest_hour as (
    select extract(hour from created_at at time zone 'America/Guyana')::int as hour_of_day, count(*) as order_count
    from recent_orders group by 1 order by 2 desc, 1 asc limit 1
  ), ready_times as (
    select o.id, extract(epoch from (min(e.changed_at) - o.created_at))/3600.0 as hours_to_ready
    from recent_orders o
    join public.order_status_events e on e.order_id=o.id and e.to_status='Ready for Pick-Up'
    group by o.id, o.created_at
  )
  select case when v_role = 'staff' then
    jsonb_build_object(
      'period_days',1,
      'orders',count(*),
      'revenue',coalesce(sum(total) filter (where status <> 'Cancelled/Refunded'),0)
    )
  else
    jsonb_build_object(
      'period_days',v_days,
      'orders',count(*),
      'revenue',coalesce(sum(total) filter (where status <> 'Cancelled/Refunded'),0),
      'average_order_value',coalesce(round(avg(total) filter (where status <> 'Cancelled/Refunded'),2),0),
      'repeat_customers',count(distinct customer_phone) filter (
        where customer_phone in (select customer_phone from recent_orders group by customer_phone having count(*) > 1)
      ),
      'busiest_hour',(select hour_of_day from busiest_hour),
      'average_hours_to_ready',(select round(avg(hours_to_ready)::numeric,1) from ready_times)
    )
  end
  into v_result
  from recent_orders;

  return v_result;
end;
$$;

-- Staff read orders directly; writes must go through role-checked RPCs.
revoke insert, update, delete on table public.orders from authenticated;
grant select on table public.orders to authenticated;

-- Billing tables are authenticated-only and least privilege.
revoke all on table public.snapnest_client_billing_config from anon, authenticated;
revoke all on table public.snapnest_client_payment_submissions from anon, authenticated;
grant select on table public.snapnest_client_billing_config to authenticated;
grant select, insert on table public.snapnest_client_payment_submissions to authenticated;
revoke execute on function public.is_snapnest_billing_contact() from anon;

-- Legacy receipts bucket is unused: make it private and remove anonymous upload/read.
update storage.buckets set public = false where id = 'receipts';
drop policy if exists "Public Access" on storage.objects;
drop policy if exists "Public Upload" on storage.objects;
