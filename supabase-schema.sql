begin;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.service_catalog (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null unique,
  category text not null,
  rate numeric(12,2) not null check (rate >= 0),
  unit text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.service_catalog (name, category, rate, unit) values
  ('Regular Laundry', 'Wash – Dry – Fold', 300, 'lb'),
  ('Bed Sheets', 'Wash – Dry – Fold', 350, 'lb'),
  ('Comforters', 'Wash – Dry – Fold', 5000, 'each'),
  ('Regular Pillows', 'Wash – Dry – Fold', 800, 'each'),
  ('Curtains', 'Wash – Dry – Fold', 600, 'panel'),
  ('Suits', 'Ironing', 2000, 'each'),
  ('Denim', 'Ironing', 2000, 'each'),
  ('Dress', 'Ironing', 2000, 'each'),
  ('Curtains (Ironing)', 'Ironing', 2500, 'panel'),
  ('Standard Package', 'Package', 5000, 'package'),
  ('Monthly Package', 'Package', 40000, 'month')
on conflict (name) do update set category = excluded.category, rate = excluded.rate, unit = excluded.unit, active = true;

create table if not exists public.customers (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  phone text not null unique,
  passcode_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.customer_sessions (
  token_hash text primary key,
  customer_id uuid not null references public.customers(id) on delete cascade,
  expires_at timestamptz not null default (now() + interval '30 days'),
  created_at timestamptz not null default now()
);
create index if not exists customer_sessions_customer_idx on public.customer_sessions(customer_id);
create index if not exists customer_sessions_expiry_idx on public.customer_sessions(expires_at);

create table if not exists public.staff_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role text not null default 'staff' check (role in ('staff','manager','admin')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default extensions.gen_random_uuid(),
  tracking_code text not null unique check (tracking_code ~ '^[A-Z2-9]{6,10}$'),
  customer_id uuid references public.customers(id) on delete set null,
  customer_name text not null,
  customer_phone text not null,
  items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) > 0),
  weight_summary text not null default '',
  total numeric(12,2) not null check (total >= 0),
  status text not null default 'Received' check (status in ('Received','Washing','Drying','Ready for Pick-Up','Picked Up (Archived)','Cancelled/Refunded')),
  notes text not null default '',
  order_type text not null,
  scheduled_date date,
  scale_photo_url text,
  payment jsonb not null default '{"method":"Cash","status":"Pay at Pickup"}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists orders_customer_idx on public.orders(customer_id, created_at desc);
create index if not exists orders_status_idx on public.orders(status, created_at desc);
create index if not exists orders_phone_idx on public.orders(customer_phone);

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.staff_profiles where user_id = auth.uid() and active); $$;

alter table public.service_catalog enable row level security;
alter table public.customers enable row level security;
alter table public.customer_sessions enable row level security;
alter table public.staff_profiles enable row level security;
alter table public.orders enable row level security;

drop policy if exists "public reads active services" on public.service_catalog;
create policy "public reads active services" on public.service_catalog for select to anon, authenticated using (active);
drop policy if exists "staff manage services" on public.service_catalog;
create policy "staff manage services" on public.service_catalog for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists "staff read own profile" on public.staff_profiles;
create policy "staff read own profile" on public.staff_profiles for select to authenticated using (user_id = auth.uid() and active);
drop policy if exists "staff manage orders" on public.orders;
create policy "staff manage orders" on public.orders for all to authenticated using (public.is_staff()) with check (public.is_staff());

create or replace function public.normalized_phone(value text)
returns text language sql immutable set search_path = public
as $$ select regexp_replace(coalesce(value,''), '[^0-9]', '', 'g'); $$;

create or replace function public.customer_id_for_session(raw_token text)
returns uuid language sql stable security definer set search_path = public, extensions
as $$
  select customer_id from public.customer_sessions
  where token_hash = encode(extensions.digest(coalesce(raw_token,''), 'sha256'), 'hex')
    and expires_at > now();
$$;

create or replace function public.new_tracking_code()
returns text language plpgsql volatile security definer set search_path = public
as $$
declare candidate text;
begin
  loop
    candidate := upper(substr(replace(extensions.gen_random_uuid()::text, '-', ''), 1, 8));
    candidate := translate(candidate, '01', '23');
    exit when not exists(select 1 from public.orders where tracking_code = candidate);
  end loop;
  return candidate;
end; $$;

create or replace function public.laundry_loop_health()
returns boolean language sql stable set search_path = public as $$ select true; $$;

create or replace function public.customer_signup(p_name text, p_phone text, p_passcode text)
returns jsonb language plpgsql security definer set search_path = public, extensions
as $$
declare v_customer public.customers; v_phone text; v_token text;
begin
  v_phone := public.normalized_phone(p_phone);
  if char_length(trim(p_name)) < 2 or char_length(v_phone) < 10 or char_length(v_phone) > 15 or char_length(p_passcode) < 4 or char_length(p_passcode) > 72 then
    raise exception 'Invalid account details';
  end if;
  insert into public.customers(name, phone, passcode_hash)
  values(trim(p_name), v_phone, extensions.crypt(p_passcode, extensions.gen_salt('bf', 10))) returning * into v_customer;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.customer_sessions(token_hash, customer_id) values(encode(extensions.digest(v_token,'sha256'),'hex'), v_customer.id);
  return jsonb_build_object('customer_id',v_customer.id,'name',v_customer.name,'phone',v_customer.phone,'session_token',v_token);
exception when unique_violation then raise exception 'An account already exists for this phone number';
end; $$;

create or replace function public.customer_login(p_phone text, p_passcode text)
returns jsonb language plpgsql security definer set search_path = public, extensions
as $$
declare v_customer public.customers; v_token text;
begin
  select * into v_customer from public.customers where phone = public.normalized_phone(p_phone);
  if v_customer.id is null or v_customer.passcode_hash <> extensions.crypt(p_passcode, v_customer.passcode_hash) then
    raise exception 'Invalid credentials';
  end if;
  delete from public.customer_sessions where expires_at <= now();
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.customer_sessions(token_hash, customer_id) values(encode(extensions.digest(v_token,'sha256'),'hex'), v_customer.id);
  return jsonb_build_object('customer_id',v_customer.id,'name',v_customer.name,'phone',v_customer.phone,'session_token',v_token);
end; $$;

create or replace function public.customer_logout(p_session_token text)
returns void language sql security definer set search_path = public, extensions
as $$ delete from public.customer_sessions where token_hash = encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex'); $$;

create or replace function public.customer_session_profile(p_session_token text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_customer public.customers;
begin
  select c.* into v_customer from public.customers c where c.id = public.customer_id_for_session(p_session_token);
  if v_customer.id is null then raise exception 'Session expired'; end if;
  return jsonb_build_object('customer_id',v_customer.id,'name',v_customer.name,'phone',v_customer.phone);
end; $$;

create or replace function public.price_order_items(p_items jsonb)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare v_item jsonb; v_service public.service_catalog; v_qty numeric; v_items jsonb := '[]'::jsonb; v_total numeric := 0; v_weight text := '';
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 20 then raise exception 'Invalid order items'; end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'qty')::numeric;
    select * into v_service from public.service_catalog where lower(name) = lower(v_item->>'label') and active;
    if v_service.id is null or v_qty <= 0 or v_qty > 500 then raise exception 'Invalid service or quantity'; end if;
    v_items := v_items || jsonb_build_array(jsonb_build_object('label',v_service.name,'rate',v_service.rate,'unit',v_service.unit,'qty',v_qty,'total',v_service.rate*v_qty));
    v_total := v_total + (v_service.rate*v_qty);
    v_weight := v_weight || case when v_weight='' then '' else ', ' end || v_qty::text || ' ' || v_service.unit;
  end loop;
  return jsonb_build_object('items',v_items,'total',v_total,'weight_summary',v_weight);
exception when invalid_text_representation then raise exception 'Invalid quantity';
end; $$;

create or replace function public.create_public_order(p_name text, p_phone text, p_items jsonb, p_notes text, p_order_type text, p_scheduled_date date, p_payment jsonb, p_session_token text default null)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_price jsonb; v_order public.orders; v_customer_id uuid; v_phone text;
begin
  v_phone := public.normalized_phone(p_phone);
  if char_length(trim(p_name)) < 2 or char_length(v_phone) < 10 or char_length(v_phone) > 15 then raise exception 'Invalid customer details'; end if;
  v_price := public.price_order_items(p_items);
  v_customer_id := public.customer_id_for_session(p_session_token);
  if v_customer_id is not null and not exists(select 1 from public.customers where id=v_customer_id and phone=v_phone) then v_customer_id := null; end if;
  insert into public.orders(tracking_code,customer_id,customer_name,customer_phone,items,weight_summary,total,notes,order_type,scheduled_date,payment)
  values(public.new_tracking_code(),v_customer_id,trim(p_name),v_phone,v_price->'items',v_price->>'weight_summary',(v_price->>'total')::numeric,left(coalesce(p_notes,''),1000),left(coalesce(p_order_type,'Order'),80),p_scheduled_date,
    jsonb_build_object('method',coalesce(p_payment->>'method','Cash'),'status',coalesce(p_payment->>'status','Pay at Pickup'),'reference',nullif(p_payment->>'reference','')))
  returning * into v_order;
  return to_jsonb(v_order);
end; $$;

create or replace function public.track_public_order(p_tracking_code text)
returns jsonb language sql stable security definer set search_path = public
as $$
  select jsonb_build_object('tracking_code',tracking_code,'items',items,'weight_summary',weight_summary,'total',total,'status',status,'order_type',order_type,'scheduled_date',scheduled_date,'payment',payment,'created_at',created_at)
  from public.orders where tracking_code = upper(trim(p_tracking_code));
$$;

create or replace function public.customer_order_history(p_session_token text)
returns setof public.orders language sql stable security definer set search_path = public
as $$ select * from public.orders where customer_id = public.customer_id_for_session(p_session_token) order by created_at desc; $$;

create or replace function public.staff_create_order(p_name text, p_phone text, p_items jsonb, p_notes text, p_payment jsonb)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_order jsonb;
begin
  if not public.is_staff() then raise exception 'Not authorized'; end if;
  v_order := public.create_public_order(p_name,p_phone,p_items,p_notes,'In-Store Walk-In POS',current_date,p_payment,null);
  update public.orders set created_by=auth.uid() where id=(v_order->>'id')::uuid;
  return v_order;
end; $$;

revoke all on public.customers, public.customer_sessions, public.orders from anon;
grant select on public.service_catalog to anon, authenticated;
grant select, insert, update, delete on public.orders to authenticated;
grant select on public.staff_profiles to authenticated;
grant execute on function public.laundry_loop_health() to anon, authenticated;
grant execute on function public.customer_signup(text,text,text) to anon, authenticated;
grant execute on function public.customer_login(text,text) to anon, authenticated;
grant execute on function public.customer_logout(text) to anon, authenticated;
grant execute on function public.customer_session_profile(text) to anon, authenticated;
grant execute on function public.create_public_order(text,text,jsonb,text,text,date,jsonb,text) to anon, authenticated;
grant execute on function public.track_public_order(text) to anon, authenticated;
grant execute on function public.customer_order_history(text) to anon, authenticated;
grant execute on function public.staff_create_order(text,text,jsonb,text,jsonb) to authenticated;
revoke execute on function public.customer_id_for_session(text) from public, anon, authenticated;
revoke execute on function public.price_order_items(jsonb) from public, anon, authenticated;
revoke execute on function public.new_tracking_code() from public, anon, authenticated;

commit;

-- After creating a staff user in Supabase Authentication, authorize that user with:
-- insert into public.staff_profiles (user_id, display_name, role)
-- values ('AUTH-USER-UUID', 'Staff Name', 'admin');
