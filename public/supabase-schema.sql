begin;

create schema if not exists extensions;
create schema if not exists private;
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
  subtotal numeric(12,2) not null default 0 check (subtotal >= 0),
  discount numeric(12,2) not null default 0 check (discount >= 0 and discount <= subtotal),
  total numeric(12,2) not null check (total >= 0),
  status text not null default 'Received' check (status in ('Received','Washing','Drying','Ready for Pick-Up','Picked Up (Archived)','Cancelled/Refunded')),
  notes text not null default '',
  order_type text not null,
  scheduled_date date,
  scale_photo_url text,
  scale_photo_path text,
  scale_photo_bytes bigint check (scale_photo_bytes is null or scale_photo_bytes between 1 and 5242880),
  scale_photo_width integer check (scale_photo_width is null or scale_photo_width between 1 and 10000),
  scale_photo_height integer check (scale_photo_height is null or scale_photo_height between 1 and 10000),
  scale_photo_mime text check (scale_photo_mime is null or scale_photo_mime in ('image/jpeg','image/png','image/webp')),
  photo_upload_token_hash text,
  photo_upload_expires_at timestamptz,
  payment jsonb not null default '{"method":"Cash","status":"Pay at Pickup"}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists orders_customer_idx on public.orders(customer_id, created_at desc);
create index if not exists orders_status_idx on public.orders(status, created_at desc);
create index if not exists orders_phone_idx on public.orders(customer_phone);
create index if not exists orders_created_by_idx on public.orders(created_by) where created_by is not null;

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end; $$;

drop trigger if exists customers_set_updated_at on public.customers;
create trigger customers_set_updated_at before update on public.customers
for each row execute function public.set_updated_at();
drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at before update on public.orders
for each row execute function public.set_updated_at();

create or replace function public.normalize_order_totals()
returns trigger language plpgsql set search_path = public
as $$
begin
  if new.subtotal = 0 and new.total > 0 and new.discount = 0 then new.subtotal := new.total; end if;
  new.total := new.subtotal - new.discount;
  return new;
end; $$;

drop trigger if exists orders_normalize_totals on public.orders;
create trigger orders_normalize_totals before insert or update of subtotal, discount on public.orders
for each row execute function public.normalize_order_totals();

create table if not exists public.order_items (
  id uuid primary key default extensions.gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  service_id uuid references public.service_catalog(id) on delete set null,
  service_name text not null,
  category text not null,
  unit text not null,
  quantity numeric(12,3) not null check (quantity > 0),
  unit_rate numeric(12,2) not null check (unit_rate >= 0),
  line_total numeric(12,2) not null check (line_total >= 0),
  created_at timestamptz not null default now()
);
create index if not exists order_items_order_idx on public.order_items(order_id);
create index if not exists order_items_service_created_idx on public.order_items(service_id, created_at desc);

create table if not exists public.order_status_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  from_status text,
  to_status text not null,
  changed_by uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now()
);
create index if not exists order_status_events_order_time_idx on public.order_status_events(order_id, changed_at);
create index if not exists order_status_events_status_time_idx on public.order_status_events(to_status, changed_at desc);
create index if not exists order_status_events_changed_by_idx on public.order_status_events(changed_by) where changed_by is not null;

create table if not exists public.inventory_items (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null unique,
  unit text not null,
  reorder_level numeric(12,3) not null default 0 check (reorder_level >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.inventory_items (name, unit, reorder_level) values
  ('Premium Detergent', 'litres', 5),
  ('Fabric Softener', 'litres', 5),
  ('Bleach', 'litres', 3),
  ('Laundry Bags', 'each', 25),
  ('Hangers', 'each', 30)
on conflict (name) do nothing;

create table if not exists public.inventory_movements (
  id bigint generated always as identity primary key,
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  order_id uuid references public.orders(id) on delete set null,
  movement_type text not null check (movement_type in ('restock','usage','waste','adjustment')),
  quantity_delta numeric(12,3) not null check (quantity_delta <> 0),
  unit_cost numeric(12,2) check (unit_cost is null or unit_cost >= 0),
  note text not null default '',
  recorded_by uuid references auth.users(id) on delete set null,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint inventory_movement_direction check (
    (movement_type = 'restock' and quantity_delta > 0) or
    (movement_type in ('usage','waste') and quantity_delta < 0) or
    movement_type = 'adjustment'
  ),
  unique (order_id, inventory_item_id, movement_type)
);
create index if not exists inventory_movements_item_time_idx on public.inventory_movements(inventory_item_id, occurred_at desc);
create index if not exists inventory_movements_order_idx on public.inventory_movements(order_id) where order_id is not null;
create index if not exists inventory_movements_recorded_by_idx on public.inventory_movements(recorded_by) where recorded_by is not null;

create table if not exists public.service_inventory_usage (
  service_id uuid not null references public.service_catalog(id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items(id) on delete cascade,
  quantity_per_service_unit numeric(12,4) not null check (quantity_per_service_unit > 0),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (service_id, inventory_item_id)
);
create index if not exists service_inventory_usage_item_idx on public.service_inventory_usage(inventory_item_id);
create index if not exists service_inventory_usage_updated_by_idx on public.service_inventory_usage(updated_by) where updated_by is not null;

drop trigger if exists inventory_items_set_updated_at on public.inventory_items;
create trigger inventory_items_set_updated_at before update on public.inventory_items
for each row execute function public.set_updated_at();

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.staff_profiles where user_id = auth.uid() and active); $$;

create or replace function private.is_admin()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists(
    select 1 from public.staff_profiles
    where user_id = auth.uid() and active and role = 'admin'
  );
$$;

create table if not exists public.staff_security_alerts (
  id uuid primary key default extensions.gen_random_uuid(),
  requester_email text not null,
  portal text not null default 'staff' check (portal = 'staff'),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null
);
create index if not exists staff_security_alerts_open_idx
  on public.staff_security_alerts(created_at desc) where resolved_at is null;

alter table public.staff_security_alerts enable row level security;
drop policy if exists "admins read staff security alerts" on public.staff_security_alerts;
create policy "admins read staff security alerts" on public.staff_security_alerts
  for select to authenticated using (private.is_admin());

create or replace function public.request_staff_password_recovery(p_email text)
returns boolean language plpgsql security definer
set search_path = public, auth
as $$
declare v_email text := lower(trim(coalesce(p_email, '')));
begin
  if v_email ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'
    and exists (
      select 1 from auth.users u
      join public.staff_profiles p on p.user_id = u.id
      where lower(u.email) = v_email and p.active and p.role in ('staff', 'manager')
    )
    and not exists (
      select 1 from public.staff_security_alerts
      where requester_email = v_email and created_at > now() - interval '10 minutes'
    )
  then
    insert into public.staff_security_alerts(requester_email) values (v_email);
  end if;
  return true;
end;
$$;

create or replace function public.resolve_staff_security_alert(p_alert_id uuid)
returns boolean language plpgsql security definer set search_path = public
as $$
begin
  if not private.is_admin() then raise exception 'Not authorized'; end if;
  update public.staff_security_alerts
  set resolved_at = now(), resolved_by = auth.uid()
  where id = p_alert_id and resolved_at is null;
  return found;
end;
$$;

alter table public.service_catalog enable row level security;
alter table public.customers enable row level security;
alter table public.customer_sessions enable row level security;
alter table public.staff_profiles enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_status_events enable row level security;
alter table public.inventory_items enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.service_inventory_usage enable row level security;

drop policy if exists "public reads active services" on public.service_catalog;
create policy "public reads active services" on public.service_catalog for select to anon, authenticated using (active);
drop policy if exists "staff manage services" on public.service_catalog;
create policy "staff manage services" on public.service_catalog for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists "staff read own profile" on public.staff_profiles;
create policy "staff read own profile" on public.staff_profiles for select to authenticated using (user_id = (select auth.uid()) and active);
drop policy if exists "staff manage orders" on public.orders;
create policy "staff manage orders" on public.orders for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists "staff read order items" on public.order_items;
create policy "staff read order items" on public.order_items for select to authenticated using (public.is_staff());
drop policy if exists "staff read status events" on public.order_status_events;
create policy "staff read status events" on public.order_status_events for select to authenticated using (public.is_staff());
drop policy if exists "staff manage inventory items" on public.inventory_items;
create policy "staff manage inventory items" on public.inventory_items for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists "staff manage inventory movements" on public.inventory_movements;
create policy "staff manage inventory movements" on public.inventory_movements for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists "staff manage service inventory usage" on public.service_inventory_usage;
create policy "staff manage service inventory usage" on public.service_inventory_usage for all to authenticated using (public.is_staff()) with check (public.is_staff());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('scale-photos', 'scale-photos', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function private.valid_photo_upload(p_order_id text, p_raw_token text)
returns boolean language plpgsql stable security definer set search_path = public, extensions
as $$
declare v_id uuid;
begin
  v_id := p_order_id::uuid;
  return exists(
    select 1 from public.orders
    where id=v_id
      and photo_upload_token_hash=encode(extensions.digest(coalesce(p_raw_token,''),'sha256'),'hex')
      and photo_upload_expires_at > now()
      and scale_photo_path is null
  );
exception when others then return false;
end; $$;

drop policy if exists "customers upload scale photos" on storage.objects;
drop policy if exists "customers upload authorized scale photos" on storage.objects;
create policy "customers upload authorized scale photos" on storage.objects
for insert to anon, authenticated
with check (
  bucket_id='scale-photos'
  and name ~ '^orders/[0-9a-f-]{36}/[0-9a-f-]{36}\.(webp|jpe?g|png)$'
  and private.valid_photo_upload((storage.foldername(name))[2],user_metadata->>'upload_token')
);

drop policy if exists "staff view scale photos" on storage.objects;
create policy "staff view scale photos" on storage.objects
for select to authenticated
using (bucket_id = 'scale-photos' and public.is_staff());

drop policy if exists "staff delete scale photos" on storage.objects;
create policy "staff delete scale photos" on storage.objects
for delete to authenticated
using (bucket_id = 'scale-photos' and public.is_staff());

create or replace function public.normalized_phone(value text)
returns text language sql immutable set search_path = public
as $$
  with cleaned as (
    select regexp_replace(coalesce(value,''), '[^0-9]', '', 'g') as digits
  )
  select case
    when char_length(digits) = 7 then '592' || digits
    when char_length(digits) = 8 and left(digits,1) = '0' then '592' || substring(digits from 2)
    else digits
  end
  from cleaned;
$$;

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
  if char_length(trim(p_name)) < 2 or char_length(v_phone) < 10 or char_length(v_phone) > 15 or char_length(p_passcode) < 6 or char_length(p_passcode) > 72 then
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
    v_items := v_items || jsonb_build_array(jsonb_build_object('service_id',v_service.id,'label',v_service.name,'category',v_service.category,'rate',v_service.rate,'unit',v_service.unit,'qty',v_qty,'total',v_service.rate*v_qty));
    v_total := v_total + (v_service.rate*v_qty);
    v_weight := v_weight || case when v_weight='' then '' else ', ' end || v_qty::text || ' ' || v_service.unit;
  end loop;
  return jsonb_build_object('items',v_items,'total',v_total,'weight_summary',v_weight);
exception when invalid_text_representation then raise exception 'Invalid quantity';
end; $$;

create or replace function public.capture_order_status_event()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.order_status_events(order_id, from_status, to_status, changed_by)
    values(new.id, null, new.status, auth.uid());
  elsif new.status is distinct from old.status then
    insert into public.order_status_events(order_id, from_status, to_status, changed_by)
    values(new.id, old.status, new.status, auth.uid());
  end if;
  return new;
end; $$;

drop trigger if exists orders_capture_status_event on public.orders;
create trigger orders_capture_status_event
after insert or update of status on public.orders
for each row execute function public.capture_order_status_event();

create or replace function public.consume_inventory_when_washing()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.status = 'Washing' and old.status is distinct from 'Washing' then
    insert into public.inventory_movements(inventory_item_id, order_id, movement_type, quantity_delta, note, recorded_by)
    select
      usage.inventory_item_id,
      new.id,
      'usage',
      -sum(items.quantity * usage.quantity_per_service_unit),
      'Automatic estimated usage when order entered Washing',
      auth.uid()
    from public.order_items items
    join public.service_inventory_usage usage on usage.service_id = items.service_id
    where items.order_id = new.id
    group by usage.inventory_item_id
    on conflict (order_id, inventory_item_id, movement_type) do nothing;
  end if;
  return new;
end; $$;

drop trigger if exists orders_consume_inventory on public.orders;
create trigger orders_consume_inventory
after update of status on public.orders
for each row execute function public.consume_inventory_when_washing();

create or replace function public.create_public_order(p_name text, p_phone text, p_items jsonb, p_notes text, p_order_type text, p_scheduled_date date, p_payment jsonb, p_session_token text default null, p_has_scale_photo boolean default false)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_price jsonb; v_order public.orders; v_customer_id uuid; v_phone text; v_item jsonb; v_photo_token text;
begin
  v_phone := public.normalized_phone(p_phone);
  if char_length(trim(p_name)) < 2 or char_length(v_phone) < 10 or char_length(v_phone) > 15 then raise exception 'Invalid customer details'; end if;
  v_price := public.price_order_items(p_items);
  v_customer_id := public.customer_id_for_session(p_session_token);
  if v_customer_id is not null and not exists(select 1 from public.customers where id=v_customer_id and phone=v_phone) then v_customer_id := null; end if;
  if p_has_scale_photo then v_photo_token := encode(extensions.gen_random_bytes(32),'hex'); end if;
  insert into public.orders(tracking_code,customer_id,customer_name,customer_phone,items,weight_summary,total,notes,order_type,scheduled_date,payment,photo_upload_token_hash,photo_upload_expires_at)
  values(public.new_tracking_code(),v_customer_id,trim(p_name),v_phone,v_price->'items',v_price->>'weight_summary',(v_price->>'total')::numeric,left(coalesce(p_notes,''),1000),left(coalesce(p_order_type,'Order'),80),p_scheduled_date,
    jsonb_build_object('method',coalesce(p_payment->>'method','Cash'),'status',coalesce(p_payment->>'status','Pay at Pickup'),'reference',nullif(p_payment->>'reference','')),
    case when v_photo_token is null then null else encode(extensions.digest(v_photo_token,'sha256'),'hex') end,
    case when v_photo_token is null then null else now()+interval '20 minutes' end)
  returning * into v_order;
  for v_item in select * from jsonb_array_elements(v_price->'items') loop
    insert into public.order_items(order_id, service_id, service_name, category, unit, quantity, unit_rate, line_total)
    values(
      v_order.id,
      (v_item->>'service_id')::uuid,
      v_item->>'label',
      v_item->>'category',
      v_item->>'unit',
      (v_item->>'qty')::numeric,
      (v_item->>'rate')::numeric,
      (v_item->>'total')::numeric
    );
  end loop;
  return (to_jsonb(v_order)-'photo_upload_token_hash'-'photo_upload_expires_at') || jsonb_build_object('photo_upload_token',v_photo_token);
end; $$;

create or replace function public.attach_public_scale_photo(p_order_id uuid,p_upload_token text,p_path text,p_bytes bigint,p_width integer,p_height integer,p_mime text)
returns void language plpgsql security definer set search_path = public, storage, extensions
as $$
begin
  if p_bytes < 1 or p_bytes > 5242880 or p_width < 1 or p_width > 10000 or p_height < 1 or p_height > 10000
    or p_mime not in ('image/jpeg','image/png','image/webp')
    or p_path !~ ('^orders/'||p_order_id::text||'/[0-9a-f-]{36}\.(webp|jpe?g|png)$') then
    raise exception 'Invalid photo metadata';
  end if;
  if not exists(select 1 from storage.objects where bucket_id='scale-photos' and name=p_path) then
    raise exception 'Photo upload was not found';
  end if;
  update public.orders set scale_photo_path=p_path,scale_photo_bytes=p_bytes,scale_photo_width=p_width,
    scale_photo_height=p_height,scale_photo_mime=p_mime,photo_upload_token_hash=null,photo_upload_expires_at=null
  where id=p_order_id
    and photo_upload_token_hash=encode(extensions.digest(coalesce(p_upload_token,''),'sha256'),'hex')
    and photo_upload_expires_at > now() and scale_photo_path is null;
  if not found then raise exception 'Photo upload authorization expired'; end if;
end; $$;

create or replace function public.track_public_order(p_tracking_code text)
returns jsonb language sql stable security definer set search_path = public
as $$
  select jsonb_build_object('tracking_code',tracking_code,'items',items,'weight_summary',weight_summary,'total',total,'status',status,'order_type',order_type,'scheduled_date',scheduled_date,'payment',payment - 'reference','created_at',created_at)
  from public.orders where tracking_code = upper(trim(p_tracking_code));
$$;

create or replace function public.customer_order_history(p_session_token text)
returns setof jsonb language sql stable security definer set search_path = public
as $$ select to_jsonb(o)-'photo_upload_token_hash'-'photo_upload_expires_at' from public.orders o where customer_id=public.customer_id_for_session(p_session_token) order by created_at desc; $$;

create or replace function public.staff_create_order(p_name text, p_phone text, p_items jsonb, p_notes text, p_payment jsonb, p_discount_gyd numeric default 0)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_created jsonb; v_order public.orders; v_role text; v_discount numeric := coalesce(p_discount_gyd,0);
begin
  if not public.is_staff() then raise exception 'Not authorized'; end if;
  select role into v_role from public.staff_profiles where user_id=auth.uid() and active;
  if v_discount < 0 then raise exception 'Discount cannot be negative'; end if;
  if v_discount > 0 and v_role not in ('manager','admin') then raise exception 'Supervisor approval is required for discounts'; end if;
  v_created := public.create_public_order(p_name,p_phone,p_items,p_notes,'In-Store Walk-In POS',current_date,p_payment,null,false);
  select * into v_order from public.orders where id=(v_created->>'id')::uuid for update;
  if v_discount > v_order.subtotal then raise exception 'Discount cannot exceed subtotal'; end if;
  update public.orders set created_by=auth.uid(),discount=round(v_discount,2) where id=v_order.id returning * into v_order;
  return to_jsonb(v_order);
end; $$;

create or replace function public.admin_create_inventory_item(p_name text,p_unit text,p_reorder_level numeric default 0,p_opening_stock numeric default 0)
returns jsonb language plpgsql security definer set search_path = public, private
as $$
declare v_item public.inventory_items;
begin
  if not private.is_admin() then raise exception 'Administrator access required'; end if;
  if char_length(trim(coalesce(p_name,''))) < 2 or char_length(trim(p_name)) > 80 then raise exception 'Item name must be between 2 and 80 characters'; end if;
  if char_length(trim(coalesce(p_unit,''))) < 1 or char_length(trim(p_unit)) > 30 then raise exception 'Enter a valid inventory unit'; end if;
  if coalesce(p_reorder_level,0) < 0 or coalesce(p_opening_stock,0) < 0 then raise exception 'Stock values cannot be negative'; end if;
  insert into public.inventory_items(name,unit,reorder_level,active) values(trim(p_name),trim(p_unit),round(coalesce(p_reorder_level,0),3),true) returning * into v_item;
  if coalesce(p_opening_stock,0) > 0 then
    insert into public.inventory_movements(inventory_item_id,movement_type,quantity_delta,note,recorded_by)
    values(v_item.id,'restock',round(p_opening_stock,3),'Opening stock',auth.uid());
  end if;
  return to_jsonb(v_item);
exception when unique_violation then raise exception 'An inventory item with this name already exists';
end; $$;

create or replace function public.staff_record_inventory_movement(
  p_inventory_item_id uuid,
  p_movement_type text,
  p_quantity numeric,
  p_unit_cost numeric default null,
  p_note text default ''
)
returns bigint language plpgsql security definer set search_path = public
as $$
declare v_id bigint; v_delta numeric;
begin
  if not public.is_staff() then raise exception 'Not authorized'; end if;
  if p_movement_type not in ('restock','usage','waste','adjustment') or p_quantity = 0 then raise exception 'Invalid inventory movement'; end if;
  v_delta := case when p_movement_type in ('usage','waste') then -abs(p_quantity) when p_movement_type = 'restock' then abs(p_quantity) else p_quantity end;
  insert into public.inventory_movements(inventory_item_id,movement_type,quantity_delta,unit_cost,note,recorded_by)
  values(p_inventory_item_id,p_movement_type,v_delta,p_unit_cost,left(coalesce(p_note,''),500),auth.uid())
  returning id into v_id;
  return v_id;
end; $$;

create or replace function public.staff_inventory_summary()
returns table(
  item_id uuid,
  item_name text,
  unit text,
  on_hand numeric,
  reorder_level numeric,
  average_daily_usage_30 numeric,
  estimated_days_remaining numeric,
  recommendation text
) language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_staff() then raise exception 'Not authorized'; end if;
  return query
  with movement_totals as (
    select
      m.inventory_item_id,
      coalesce(sum(m.quantity_delta),0)::numeric as stock,
      coalesce(abs(sum(m.quantity_delta) filter (where m.quantity_delta < 0 and m.occurred_at >= now() - interval '30 days')) / 30.0,0)::numeric as daily_usage
    from public.inventory_movements m
    group by m.inventory_item_id
  )
  select
    i.id,
    i.name,
    i.unit,
    round(coalesce(t.stock,0),3),
    i.reorder_level,
    round(coalesce(t.daily_usage,0),3),
    case when coalesce(t.daily_usage,0) > 0 then round(greatest(coalesce(t.stock,0),0) / t.daily_usage,1) else null end,
    case
      when coalesce(t.stock,0) <= 0 then 'Out of stock — restock now'
      when coalesce(t.stock,0) <= i.reorder_level then 'Below reorder level — restock now'
      when coalesce(t.daily_usage,0) = 0 then 'Record usage to estimate runout'
      when coalesce(t.stock,0) / t.daily_usage <= 7 then 'Likely to run out within 7 days'
      when coalesce(t.stock,0) / t.daily_usage <= 14 then 'Plan a restock within 2 weeks'
      else 'Stock level is healthy'
    end
  from public.inventory_items i
  left join movement_totals t on t.inventory_item_id = i.id
  where i.active
  order by i.name;
end; $$;

create or replace function public.staff_operations_summary(p_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare v_result jsonb;
begin
  if not public.is_staff() then raise exception 'Not authorized'; end if;
  if p_days < 1 or p_days > 365 then raise exception 'Days must be between 1 and 365'; end if;
  with recent_orders as (
    select * from public.orders where created_at >= now() - make_interval(days => p_days)
  ), busiest_hour as (
    select extract(hour from created_at at time zone 'America/Guyana')::int as hour_of_day, count(*) as order_count
    from recent_orders group by 1 order by 2 desc, 1 asc limit 1
  ), ready_times as (
    select o.id, extract(epoch from (min(e.changed_at) - o.created_at))/3600.0 as hours_to_ready
    from recent_orders o join public.order_status_events e on e.order_id=o.id and e.to_status='Ready for Pick-Up'
    group by o.id, o.created_at
  )
  select jsonb_build_object(
    'period_days',p_days,
    'orders',count(*),
    'revenue',coalesce(sum(total) filter (where status <> 'Cancelled/Refunded'),0),
    'average_order_value',coalesce(round(avg(total) filter (where status <> 'Cancelled/Refunded'),2),0),
    'repeat_customers',count(distinct customer_phone) filter (where customer_phone in (select customer_phone from recent_orders group by customer_phone having count(*) > 1)),
    'busiest_hour',(select hour_of_day from busiest_hour),
    'average_hours_to_ready',(select round(avg(hours_to_ready)::numeric,1) from ready_times)
  ) into v_result from recent_orders;
  return v_result;
end; $$;

revoke all on public.customers, public.customer_sessions, public.orders, public.order_items, public.order_status_events, public.inventory_items, public.inventory_movements, public.service_inventory_usage from anon, authenticated;
revoke all on public.service_catalog, public.staff_profiles from anon, authenticated;
revoke all on public.staff_security_alerts from anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.capture_order_status_event() from public, anon, authenticated;
revoke execute on function public.consume_inventory_when_washing() from public, anon, authenticated;
revoke execute on function public.is_staff() from public, anon;
revoke execute on function private.is_admin() from public, anon, authenticated;
revoke execute on function public.request_staff_password_recovery(text) from public, anon, authenticated;
revoke execute on function public.resolve_staff_security_alert(uuid) from public, anon, authenticated;
revoke execute on function public.normalized_phone(text) from public, anon, authenticated;
revoke execute on function public.laundry_loop_health() from public, anon, authenticated;
revoke execute on function public.customer_signup(text,text,text) from public, anon, authenticated;
revoke execute on function public.customer_login(text,text) from public, anon, authenticated;
revoke execute on function public.customer_logout(text) from public, anon, authenticated;
revoke execute on function public.customer_session_profile(text) from public, anon, authenticated;
revoke execute on function public.create_public_order(text,text,jsonb,text,text,date,jsonb,text,boolean) from public, anon, authenticated;
revoke execute on function public.attach_public_scale_photo(uuid,text,text,bigint,integer,integer,text) from public, anon, authenticated;
revoke execute on function public.track_public_order(text) from public, anon, authenticated;
revoke execute on function public.customer_order_history(text) from public, anon, authenticated;
revoke execute on function public.staff_create_order(text,text,jsonb,text,jsonb,numeric) from public, anon, authenticated;
revoke execute on function public.admin_create_inventory_item(text,text,numeric,numeric) from public, anon, authenticated;
revoke execute on function public.staff_record_inventory_movement(uuid,text,numeric,numeric,text) from public, anon, authenticated;
revoke execute on function public.staff_inventory_summary() from public, anon, authenticated;
revoke execute on function public.staff_operations_summary(integer) from public, anon, authenticated;
grant select on public.service_catalog to anon, authenticated;
grant insert, update, delete on public.service_catalog to authenticated;
grant select, insert, update, delete on public.orders to authenticated;
grant select on public.staff_profiles to authenticated;
grant select on public.staff_security_alerts to authenticated;
grant execute on function public.is_staff() to authenticated;
grant execute on function private.is_admin() to authenticated;
grant execute on function public.request_staff_password_recovery(text) to anon, authenticated;
grant execute on function public.resolve_staff_security_alert(uuid) to authenticated;
grant execute on function public.laundry_loop_health() to anon, authenticated;
grant execute on function public.customer_signup(text,text,text) to anon, authenticated;
grant execute on function public.customer_login(text,text) to anon, authenticated;
grant execute on function public.customer_logout(text) to anon, authenticated;
grant execute on function public.customer_session_profile(text) to anon, authenticated;
grant execute on function public.create_public_order(text,text,jsonb,text,text,date,jsonb,text,boolean) to anon, authenticated;
grant execute on function public.attach_public_scale_photo(uuid,text,text,bigint,integer,integer,text) to anon, authenticated;
grant execute on function public.track_public_order(text) to anon, authenticated;
grant execute on function public.customer_order_history(text) to anon, authenticated;
grant execute on function public.staff_create_order(text,text,jsonb,text,jsonb,numeric) to authenticated;
grant execute on function public.admin_create_inventory_item(text,text,numeric,numeric) to authenticated;
grant execute on function public.staff_record_inventory_movement(uuid,text,numeric,numeric,text) to authenticated;
grant execute on function public.staff_inventory_summary() to authenticated;
grant execute on function public.staff_operations_summary(integer) to authenticated;
revoke execute on function public.customer_id_for_session(text) from public, anon, authenticated;
revoke execute on function public.price_order_items(jsonb) from public, anon, authenticated;
revoke execute on function public.new_tracking_code() from public, anon, authenticated;
grant usage on schema private to anon, authenticated;
revoke execute on function private.valid_photo_upload(text,text) from public;
grant execute on function private.valid_photo_upload(text,text) to anon, authenticated;

do $$
begin
  alter publication supabase_realtime add table public.orders;
exception when duplicate_object then null;
end $$;

commit;

-- After creating a staff user in Supabase Authentication, authorize that user with:
-- insert into public.staff_profiles (user_id, display_name, role)
-- values ('AUTH-USER-UUID', 'Staff Name', 'admin');
