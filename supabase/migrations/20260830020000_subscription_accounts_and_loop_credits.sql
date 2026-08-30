-- Subscription lifecycle, customer recovery, Loop Credits, and shared staff inventory creation.

alter table public.customers add column if not exists recovery_code_hash text;

alter table public.site_content
  add column if not exists loop_credit_options jsonb not null default '[
    {"id":"loop-100","credits":100,"pounds":10,"price":3000},
    {"id":"loop-200","credits":200,"pounds":20,"price":5500},
    {"id":"loop-300","credits":300,"pounds":30,"price":8000}
  ]'::jsonb;

alter table public.site_content drop constraint if exists site_content_loop_credit_options_valid;
alter table public.site_content add constraint site_content_loop_credit_options_valid check (
  jsonb_typeof(loop_credit_options) = 'array'
  and jsonb_array_length(loop_credit_options) between 1 and 8
);

create or replace function public.admin_update_loop_credit_options(p_options jsonb)
returns jsonb language plpgsql security definer set search_path = public, private
as $$
begin
  if not private.is_admin() then raise exception 'Administrator access required'; end if;
  if jsonb_typeof(p_options)<>'array' or jsonb_array_length(p_options) not between 1 and 8
    or exists(select 1 from jsonb_array_elements(p_options) option where
      coalesce((option->>'credits')::numeric,0)<=0 or coalesce((option->>'pounds')::numeric,0)<=0 or coalesce((option->>'price')::numeric,-1)<0
      or coalesce(option->>'id','') !~ '^loop-[a-zA-Z0-9_-]+$') then raise exception 'Invalid Loop Credit options'; end if;
  update public.site_content set loop_credit_options=p_options,updated_by=auth.uid() where id;
  return p_options;
end; $$;

create table if not exists public.customer_subscriptions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  order_id uuid not null unique references public.orders(id) on delete restrict,
  status text not null default 'Pending Verification' check (status in ('Pending Verification','Active','Expired','Cancelled')),
  weekly_pounds numeric(8,2) not null default 40 check (weekly_pounds > 0),
  extra_pounds numeric(8,2) not null default 0 check (extra_pounds >= 0),
  credit_balance integer not null default 0 check (credit_balance >= 0),
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists customer_subscriptions_customer_status_idx on public.customer_subscriptions(customer_id,status,created_at desc);

create table if not exists public.loop_credit_purchases (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  subscription_id uuid references public.customer_subscriptions(id) on delete set null,
  order_id uuid not null unique references public.orders(id) on delete restrict,
  credits integer not null check (credits > 0),
  pounds numeric(8,2) not null check (pounds > 0),
  price numeric(12,2) not null check (price >= 0),
  status text not null default 'Pending Verification' check (status in ('Pending Verification','Applied','Cancelled')),
  created_at timestamptz not null default now(),
  applied_at timestamptz
);
create index if not exists loop_credit_purchases_customer_idx on public.loop_credit_purchases(customer_id,created_at desc);

alter table public.customer_subscriptions enable row level security;
alter table public.loop_credit_purchases enable row level security;
revoke all on public.customer_subscriptions, public.loop_credit_purchases from public, anon, authenticated;

drop trigger if exists customer_subscriptions_set_updated_at on public.customer_subscriptions;
create trigger customer_subscriptions_set_updated_at before update on public.customer_subscriptions
for each row execute function public.set_updated_at();

create or replace function public.customer_signup(p_name text, p_phone text, p_passcode text)
returns jsonb language plpgsql security definer set search_path = public, extensions
as $$
declare v_customer public.customers; v_phone text; v_token text; v_recovery text;
begin
  v_phone := public.normalized_phone(p_phone);
  if char_length(trim(p_name)) < 2 or char_length(v_phone) < 10 or char_length(v_phone) > 15 or char_length(p_passcode) < 6 or char_length(p_passcode) > 72 then
    raise exception 'Invalid account details';
  end if;
  v_recovery := upper(substr(encode(extensions.gen_random_bytes(8),'hex'),1,10));
  insert into public.customers(name,phone,passcode_hash,recovery_code_hash)
  values(trim(p_name),v_phone,extensions.crypt(p_passcode,extensions.gen_salt('bf',10)),extensions.crypt(v_recovery,extensions.gen_salt('bf',10))) returning * into v_customer;
  v_token := encode(extensions.gen_random_bytes(32),'hex');
  insert into public.customer_sessions(token_hash,customer_id) values(encode(extensions.digest(v_token,'sha256'),'hex'),v_customer.id);
  return jsonb_build_object('customer_id',v_customer.id,'name',v_customer.name,'phone',v_customer.phone,'session_token',v_token,'recovery_code',v_recovery);
exception when unique_violation then raise exception 'An account already exists for this phone number';
end; $$;

create or replace function public.customer_reset_passcode(p_phone text,p_recovery_code text,p_new_passcode text)
returns text language plpgsql security definer set search_path = public, extensions
as $$
declare v_customer public.customers; v_new_recovery text;
begin
  if char_length(p_new_passcode) < 6 or char_length(p_new_passcode) > 72 then raise exception 'Use a passcode between 6 and 72 characters'; end if;
  select * into v_customer from public.customers where phone=public.normalized_phone(p_phone);
  if v_customer.id is null or v_customer.recovery_code_hash is null or v_customer.recovery_code_hash <> extensions.crypt(upper(trim(p_recovery_code)),v_customer.recovery_code_hash) then
    raise exception 'Recovery details are invalid';
  end if;
  v_new_recovery := upper(substr(encode(extensions.gen_random_bytes(8),'hex'),1,10));
  update public.customers set passcode_hash=extensions.crypt(p_new_passcode,extensions.gen_salt('bf',10)),recovery_code_hash=extensions.crypt(v_new_recovery,extensions.gen_salt('bf',10)) where id=v_customer.id;
  delete from public.customer_sessions where customer_id=v_customer.id;
  return v_new_recovery;
end; $$;

create or replace function public.create_subscription_request(p_name text,p_phone text,p_payment jsonb,p_session_token text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_customer_id uuid; v_order jsonb;
begin
  v_customer_id := public.customer_id_for_session(p_session_token);
  if v_customer_id is null then raise exception 'Log in before choosing a subscription'; end if;
  v_order := public.create_public_order(p_name,p_phone,jsonb_build_array(jsonb_build_object('label','Monthly Package','qty',1)),
    'Wash & Fold · Once per week · Free premium detergent · Up to 40 lbs per week','Monthly Package',current_date,p_payment,p_session_token,false);
  insert into public.customer_subscriptions(customer_id,order_id) values(v_customer_id,(v_order->>'id')::uuid);
  return v_order;
end; $$;

create or replace function public.create_loop_credit_request(p_session_token text,p_option_id text,p_payment jsonb)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_customer public.customers; v_subscription public.customer_subscriptions; v_option jsonb; v_order public.orders;
begin
  select * into v_customer from public.customers where id=public.customer_id_for_session(p_session_token);
  if v_customer.id is null then raise exception 'Session expired'; end if;
  select * into v_subscription from public.customer_subscriptions where customer_id=v_customer.id and status='Active' and ends_at>now() order by created_at desc limit 1;
  if v_subscription.id is null then raise exception 'An active monthly subscription is required'; end if;
  select value into v_option from public.site_content s cross join lateral jsonb_array_elements(s.loop_credit_options) where s.id and value->>'id'=p_option_id limit 1;
  if v_option is null then raise exception 'This Loop Credit option is unavailable'; end if;
  insert into public.orders(customer_id,customer_name,customer_phone,items,weight_summary,subtotal,total,status,notes,order_type,scheduled_date,payment)
  values(v_customer.id,v_customer.name,v_customer.phone,jsonb_build_array(jsonb_build_object('label','Loop Credits','qty',(v_option->>'credits')::int,'unit','credits','rate',(v_option->>'price')::numeric/(v_option->>'credits')::numeric,'total',(v_option->>'price')::numeric)),
    (v_option->>'pounds')||' lbs','0'::numeric+(v_option->>'price')::numeric,(v_option->>'price')::numeric,'Received','Additional subscription wash allowance','Loop Credits',current_date,p_payment)
  returning * into v_order;
  insert into public.loop_credit_purchases(customer_id,subscription_id,order_id,credits,pounds,price)
  values(v_customer.id,v_subscription.id,v_order.id,(v_option->>'credits')::int,(v_option->>'pounds')::numeric,(v_option->>'price')::numeric);
  return to_jsonb(v_order);
end; $$;

create or replace function public.customer_account_summary(p_session_token text)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare v_customer_id uuid; v_subscription public.customer_subscriptions; v_used numeric:=0; v_options jsonb;
begin
  v_customer_id:=public.customer_id_for_session(p_session_token);
  if v_customer_id is null then raise exception 'Session expired'; end if;
  select * into v_subscription from public.customer_subscriptions where customer_id=v_customer_id and status='Active' and ends_at>now() order by created_at desc limit 1;
  select loop_credit_options into v_options from public.site_content where id;
  if v_subscription.id is not null then
    select coalesce(sum((item->>'qty')::numeric),0) into v_used from public.orders o cross join lateral jsonb_array_elements(o.items) item
    where o.customer_id=v_customer_id and o.created_at>=date_trunc('week',now()) and o.order_type not in ('Monthly Package','Loop Credits') and item->>'unit'='lb' and o.status<>'Cancelled/Refunded';
  end if;
  return jsonb_build_object('subscription',case when v_subscription.id is null then null else jsonb_build_object(
    'status',v_subscription.status,'weekly_pounds',v_subscription.weekly_pounds,'used_pounds',round(v_used,2),
    'remaining_pounds',greatest(v_subscription.weekly_pounds+v_subscription.extra_pounds-v_used,0),'credit_balance',v_subscription.credit_balance,
    'days_remaining',greatest(ceil(extract(epoch from (v_subscription.ends_at-now()))/86400),0),'ends_at',v_subscription.ends_at) end,
    'loop_credit_options',v_options);
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
  return new;
end; $$;
drop trigger if exists orders_sync_subscription_payment on public.orders;
create trigger orders_sync_subscription_payment after update of payment on public.orders for each row execute function public.sync_subscription_payment();

create or replace function public.admin_create_inventory_item(p_name text,p_unit text,p_reorder_level numeric default 0,p_opening_stock numeric default 0)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_item public.inventory_items;
begin
  if not public.is_staff() then raise exception 'Staff access required'; end if;
  if char_length(trim(coalesce(p_name,''))) < 2 or char_length(trim(p_name))>80 or char_length(trim(coalesce(p_unit,'')))<1 or char_length(trim(p_unit))>30 then raise exception 'Enter a valid item name and unit'; end if;
  if coalesce(p_reorder_level,0)<0 or coalesce(p_opening_stock,0)<0 then raise exception 'Stock values cannot be negative'; end if;
  insert into public.inventory_items(name,unit,reorder_level,active) values(trim(p_name),trim(p_unit),round(coalesce(p_reorder_level,0),3),true) returning * into v_item;
  if coalesce(p_opening_stock,0)>0 then insert into public.inventory_movements(inventory_item_id,movement_type,quantity_delta,note,recorded_by) values(v_item.id,'restock',round(p_opening_stock,3),'Opening stock',auth.uid()); end if;
  return to_jsonb(v_item);
exception when unique_violation then raise exception 'An inventory item with this name already exists';
end; $$;

revoke execute on function public.customer_reset_passcode(text,text,text), public.create_subscription_request(text,text,jsonb,text), public.create_loop_credit_request(text,text,jsonb), public.customer_account_summary(text) from public;
grant execute on function public.customer_reset_passcode(text,text,text), public.create_subscription_request(text,text,jsonb,text), public.create_loop_credit_request(text,text,jsonb), public.customer_account_summary(text) to anon, authenticated;
revoke execute on function public.sync_subscription_payment() from public,anon,authenticated;
revoke execute on function public.admin_update_loop_credit_options(jsonb) from public,anon;
grant execute on function public.admin_update_loop_credit_options(jsonb) to authenticated;
