-- Verified inventory RPC, idle customer sessions, and staff subscription operations.

alter table public.customer_sessions
  add column if not exists last_activity_at timestamptz not null default now();
create index if not exists customer_sessions_activity_idx on public.customer_sessions(last_activity_at);
create index if not exists loop_credit_purchases_subscription_idx on public.loop_credit_purchases(subscription_id);

create or replace function public.customer_id_for_session(raw_token text)
returns uuid language plpgsql volatile security definer set search_path = public, extensions
as $$
declare v_hash text; v_customer_id uuid;
begin
  v_hash:=encode(extensions.digest(coalesce(raw_token,''),'sha256'),'hex');
  update public.customer_sessions
  set last_activity_at=now()
  where token_hash=v_hash and expires_at>now() and last_activity_at>now()-interval '20 minutes'
  returning customer_id into v_customer_id;
  return v_customer_id;
end; $$;

-- These customer reads now refresh the sliding session timestamp, so they must
-- be volatile rather than read-only/stable functions.
do $$ begin
  if to_regprocedure('public.customer_order_history(text)') is not null then
    alter function public.customer_order_history(text) volatile;
  end if;
  if to_regprocedure('public.customer_account_summary(text)') is not null then
    alter function public.customer_account_summary(text) volatile;
  end if;
end $$;

create or replace function public.staff_create_inventory_item(
  p_name text,p_unit text,p_reorder_level numeric default 0,p_opening_stock numeric default 0
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_item public.inventory_items;
begin
  if auth.uid() is null or not public.is_staff() then raise exception 'Staff access required'; end if;
  if char_length(trim(coalesce(p_name,'')))<2 or char_length(trim(p_name))>80 then raise exception 'Item name must be between 2 and 80 characters'; end if;
  if char_length(trim(coalesce(p_unit,'')))<1 or char_length(trim(p_unit))>30 then raise exception 'Enter a valid inventory unit'; end if;
  if coalesce(p_reorder_level,0)<0 or coalesce(p_opening_stock,0)<0 then raise exception 'Stock values cannot be negative'; end if;
  insert into public.inventory_items(name,unit,reorder_level,active)
  values(trim(p_name),trim(p_unit),round(coalesce(p_reorder_level,0),3),true)
  returning * into v_item;
  if coalesce(p_opening_stock,0)>0 then
    insert into public.inventory_movements(inventory_item_id,movement_type,quantity_delta,note,recorded_by)
    values(v_item.id,'restock',round(p_opening_stock,3),'Opening stock',auth.uid());
  end if;
  return jsonb_build_object('item',to_jsonb(v_item),'opening_stock',round(coalesce(p_opening_stock,0),3));
exception when unique_violation then raise exception 'An inventory item with this name already exists';
end; $$;

create or replace function public.sync_subscription_payment()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if coalesce(new.payment->>'status','')='Paid' and coalesce(old.payment->>'status','') is distinct from 'Paid' then
    update public.customer_subscriptions set status='Active',starts_at=coalesce(starts_at,now()),ends_at=coalesce(ends_at,now()+interval '30 days') where order_id=new.id and status='Pending Verification';
    update public.loop_credit_purchases set status='Applied',applied_at=now() where order_id=new.id and status='Pending Verification';
    update public.customer_subscriptions s set credit_balance=s.credit_balance+p.credits,extra_pounds=s.extra_pounds+p.pounds from public.loop_credit_purchases p where p.order_id=new.id and p.subscription_id=s.id and p.status='Applied' and p.applied_at>=now()-interval '5 seconds';
  end if;
  if new.status='Cancelled/Refunded' and old.status is distinct from 'Cancelled/Refunded' then
    update public.customer_subscriptions set status='Cancelled' where order_id=new.id and status<>'Cancelled';
    update public.loop_credit_purchases set status='Cancelled' where order_id=new.id and status='Pending Verification';
  end if;
  return new;
end; $$;

create or replace function public.staff_subscription_summary()
returns table(
  subscription_id uuid, tracking_code text, customer_name text, customer_phone text,
  subscription_status text, payment_status text, payment_method text,
  weekly_pounds numeric, extra_pounds numeric, credit_balance integer,
  starts_at timestamptz, ends_at timestamptz, created_at timestamptz
) language plpgsql stable security definer set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_staff() then raise exception 'Staff access required'; end if;
  return query select s.id,o.tracking_code,o.customer_name,o.customer_phone,
    case when s.status='Active' and s.ends_at<=now() then 'Expired' else s.status end,
    coalesce(o.payment->>'status','Pay at Pickup'),coalesce(o.payment->>'method','Cash'),
    s.weekly_pounds,s.extra_pounds,s.credit_balance,s.starts_at,s.ends_at,s.created_at
  from public.customer_subscriptions s join public.orders o on o.id=s.order_id
  order by case when s.status='Pending Verification' then 0 when s.status='Active' then 1 else 2 end,s.created_at desc;
end; $$;

revoke execute on function public.staff_create_inventory_item(text,text,numeric,numeric) from public,anon;
grant execute on function public.staff_create_inventory_item(text,text,numeric,numeric) to authenticated;
revoke execute on function public.staff_subscription_summary() from public,anon;
grant execute on function public.staff_subscription_summary() to authenticated;
revoke execute on function public.customer_id_for_session(text) from public,anon,authenticated;
