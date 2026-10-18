-- Persist POS cash tender details inside the role-checked RPC.
-- Direct client UPDATE access to orders remains revoked.

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
set search_path = 'public'
as $$
declare
  v_created jsonb;
  v_order public.orders;
  v_role text;
  v_discount numeric := coalesce(p_discount_gyd, 0);
  v_total_lb numeric := 0;
  v_has_lb_items boolean := false;
  v_cash_received numeric;
begin
  if not public.is_staff() then raise exception 'Not authorized'; end if;
  select role into v_role from public.staff_profiles where user_id = auth.uid() and active;
  if v_discount < 0 then raise exception 'Discount cannot be negative'; end if;
  if v_discount > 0 and v_role not in ('manager', 'admin') then raise exception 'Supervisor approval is required for discounts'; end if;

  select
    coalesce(sum(case when lower(sc.unit) in ('lb','lbs') then (item->>'qty')::numeric else 0 end), 0),
    bool_or(lower(sc.unit) in ('lb','lbs'))
  into v_total_lb, v_has_lb_items
  from jsonb_array_elements(p_items) item
  join public.service_catalog sc on sc.name = item->>'label' and sc.active = true;

  if coalesce(v_has_lb_items, false) and v_total_lb < 5 then raise exception 'Laundry by weight has a 5 lb minimum'; end if;

  v_created := public.create_public_order(
    p_name, p_phone, p_items, p_notes, 'In-Store Walk-In POS',
    current_date, p_payment, null, false
  );

  select * into v_order from public.orders where id = (v_created->>'id')::uuid for update;

  if v_discount > v_order.subtotal then raise exception 'Discount cannot exceed subtotal'; end if;

  update public.orders
  set created_by = auth.uid(), discount = round(v_discount, 2)
  where id = v_order.id
  returning * into v_order;

  if coalesce(p_payment->>'method', 'Cash') = 'Cash' and p_payment ? 'cash_received' then
    if coalesce(p_payment->>'cash_received','') !~ '^[0-9]+([.][0-9]{1,2})?$' then raise exception 'Invalid cash received amount'; end if;
    v_cash_received := round((p_payment->>'cash_received')::numeric, 2);
    if v_cash_received < v_order.total then raise exception 'Cash received cannot be less than the order total'; end if;

    update public.orders
    set payment = coalesce(payment, '{}'::jsonb) || jsonb_build_object(
      'cash_received', v_cash_received,
      'change_due', round(v_cash_received - v_order.total, 2)
    )
    where id = v_order.id
    returning * into v_order;
  end if;

  return to_jsonb(v_order)-'photo_upload_token_hash'-'photo_upload_expires_at';
end;
$$;

revoke all on function public.staff_create_order(text,text,jsonb,text,jsonb,numeric) from public, anon;
grant execute on function public.staff_create_order(text,text,jsonb,text,jsonb,numeric) to authenticated;
