-- Add protected POS discounts and administrator-managed inventory creation.

drop function if exists public.staff_create_order(text,text,jsonb,text,jsonb);

create or replace function public.staff_create_order(
  p_name text,
  p_phone text,
  p_items jsonb,
  p_notes text,
  p_payment jsonb,
  p_discount_gyd numeric default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_created jsonb;
  v_order public.orders;
  v_role text;
  v_discount numeric := coalesce(p_discount_gyd, 0);
begin
  if not public.is_staff() then
    raise exception 'Not authorized';
  end if;

  select role into v_role
  from public.staff_profiles
  where user_id = auth.uid() and active;

  if v_discount < 0 then
    raise exception 'Discount cannot be negative';
  end if;
  if v_discount > 0 and v_role not in ('manager', 'admin') then
    raise exception 'Supervisor approval is required for discounts';
  end if;

  v_created := public.create_public_order(
    p_name,
    p_phone,
    p_items,
    p_notes,
    'In-Store Walk-In POS',
    current_date,
    p_payment,
    null,
    false
  );

  select * into v_order
  from public.orders
  where id = (v_created->>'id')::uuid
  for update;

  if v_discount > v_order.subtotal then
    raise exception 'Discount cannot exceed subtotal';
  end if;

  update public.orders
  set created_by = auth.uid(), discount = round(v_discount, 2)
  where id = v_order.id
  returning * into v_order;

  return to_jsonb(v_order);
end;
$$;

create or replace function public.admin_create_inventory_item(
  p_name text,
  p_unit text,
  p_reorder_level numeric default 0,
  p_opening_stock numeric default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_item public.inventory_items;
begin
  if not private.is_admin() then
    raise exception 'Administrator access required';
  end if;
  if char_length(trim(coalesce(p_name, ''))) < 2 or char_length(trim(p_name)) > 80 then
    raise exception 'Item name must be between 2 and 80 characters';
  end if;
  if char_length(trim(coalesce(p_unit, ''))) < 1 or char_length(trim(p_unit)) > 30 then
    raise exception 'Enter a valid inventory unit';
  end if;
  if coalesce(p_reorder_level, 0) < 0 or coalesce(p_opening_stock, 0) < 0 then
    raise exception 'Stock values cannot be negative';
  end if;

  insert into public.inventory_items(name, unit, reorder_level, active)
  values(trim(p_name), trim(p_unit), round(coalesce(p_reorder_level, 0), 3), true)
  returning * into v_item;

  if coalesce(p_opening_stock, 0) > 0 then
    insert into public.inventory_movements(
      inventory_item_id,
      movement_type,
      quantity_delta,
      note,
      recorded_by
    ) values (
      v_item.id,
      'restock',
      round(p_opening_stock, 3),
      'Opening stock',
      auth.uid()
    );
  end if;

  return to_jsonb(v_item);
exception
  when unique_violation then
    raise exception 'An inventory item with this name already exists';
end;
$$;

revoke execute on function public.staff_create_order(text,text,jsonb,text,jsonb,numeric) from public, anon;
grant execute on function public.staff_create_order(text,text,jsonb,text,jsonb,numeric) to authenticated;

revoke execute on function public.admin_create_inventory_item(text,text,numeric,numeric) from public, anon;
grant execute on function public.admin_create_inventory_item(text,text,numeric,numeric) to authenticated;
