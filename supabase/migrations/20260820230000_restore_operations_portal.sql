begin;

alter table public.orders
  add column if not exists subtotal numeric(12,2),
  add column if not exists discount numeric(12,2) not null default 0 check (discount >= 0);

update public.orders
set subtotal = total + coalesce(discount, 0)
where subtotal is null;

alter table public.orders
  alter column subtotal set not null,
  alter column subtotal set default 0;

alter table public.orders
  drop constraint if exists orders_discount_not_above_subtotal;
alter table public.orders
  add constraint orders_discount_not_above_subtotal check (discount <= subtotal);

create or replace function public.normalize_order_totals()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.subtotal = 0 and new.total > 0 and new.discount = 0 then
    new.subtotal := new.total;
  end if;
  new.total := new.subtotal - new.discount;
  return new;
end;
$$;

drop trigger if exists orders_normalize_totals on public.orders;
create trigger orders_normalize_totals
before insert or update of subtotal, discount on public.orders
for each row execute function public.normalize_order_totals();

create or replace function public.staff_update_order(
  p_order_id uuid,
  p_status text default null,
  p_payment_status text default null,
  p_discount_gyd numeric default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_subtotal numeric;
  v_discount numeric;
begin
  if not public.is_staff() then raise exception 'Not authorized'; end if;
  if p_status is not null and p_status not in ('Received','Washing','Drying','Ready for Pick-Up','Picked Up (Archived)','Cancelled/Refunded') then
    raise exception 'Invalid order status';
  end if;
  if p_payment_status is not null and p_payment_status not in ('Pay at Pickup','Pending Confirmation','Paid','Refunded') then
    raise exception 'Invalid payment status';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null then raise exception 'Order not found'; end if;
  v_subtotal := coalesce(v_order.subtotal, v_order.total + coalesce(v_order.discount, 0));
  v_discount := case when p_discount_gyd is null then coalesce(v_order.discount, 0) else greatest(p_discount_gyd, 0) end;
  if v_discount > v_subtotal then raise exception 'Discount cannot exceed subtotal'; end if;

  update public.orders
  set
    status = coalesce(p_status, status),
    payment = case when p_payment_status is null then payment else jsonb_set(payment, '{status}', to_jsonb(p_payment_status), true) end,
    subtotal = v_subtotal,
    discount = v_discount,
    total = v_subtotal - v_discount,
    notes = case when p_notes is null then notes else left(p_notes, 1000) end
  where id = p_order_id
  returning * into v_order;

  return to_jsonb(v_order) - 'photo_upload_token_hash' - 'photo_upload_expires_at';
end;
$$;

revoke execute on function public.staff_update_order(uuid,text,text,numeric,text) from public, anon, authenticated;
grant execute on function public.staff_update_order(uuid,text,text,numeric,text) to authenticated;
revoke execute on function public.normalize_order_totals() from public, anon, authenticated;

drop policy if exists "staff manage services" on public.service_catalog;
drop policy if exists "staff reads all services" on public.service_catalog;
drop policy if exists "admins manage services" on public.service_catalog;
create policy "staff reads all services" on public.service_catalog
  for select to authenticated using (public.is_staff());
create policy "admins manage services" on public.service_catalog
  for all to authenticated using (private.is_admin()) with check (private.is_admin());

drop policy if exists "admins manage staff profiles" on public.staff_profiles;
create policy "admins manage staff profiles" on public.staff_profiles
  for all to authenticated using (private.is_admin()) with check (private.is_admin());
grant insert, update, delete on public.staff_profiles to authenticated;

commit;
