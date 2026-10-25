-- Package/subscription operations and secure order editing.

create or replace function public.staff_package_summary()
returns table(
  record_id uuid,
  order_id uuid,
  plan_name text,
  plan_kind text,
  tracking_code text,
  customer_name text,
  customer_phone text,
  package_status text,
  payment_status text,
  payment_method text,
  included_pounds numeric,
  extra_pounds numeric,
  credit_balance integer,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = 'public'
as $$
begin
  if auth.uid() is null or not public.is_staff() then
    raise exception 'Staff access required';
  end if;

  return query
  select
    s.id,
    o.id,
    'Monthly Package'::text,
    'monthly'::text,
    o.tracking_code,
    o.customer_name,
    o.customer_phone,
    case when s.status='Active' and s.ends_at<=now() then 'Expired' else s.status end,
    coalesce(o.payment->>'status','Pay at Pickup'),
    coalesce(o.payment->>'method','Cash'),
    s.weekly_pounds,
    s.extra_pounds,
    s.credit_balance,
    s.starts_at,
    s.ends_at,
    s.created_at
  from public.customer_subscriptions s
  join public.orders o on o.id=s.order_id

  union all

  select
    o.id,
    o.id,
    'Standard Package'::text,
    'standard'::text,
    o.tracking_code,
    o.customer_name,
    o.customer_phone,
    case
      when o.status='Cancelled/Refunded' then 'Cancelled'
      when coalesce(o.payment->>'status','')='Paid' then 'Purchased'
      else 'Pending Verification'
    end,
    coalesce(o.payment->>'status','Pay at Pickup'),
    coalesce(o.payment->>'method','Cash'),
    20::numeric,
    coalesce((
      select sum((item->>'qty')::numeric)
      from jsonb_array_elements(o.items) item
      where item->>'label'='Package overage'
    ),0),
    0,
    null::timestamptz,
    null::timestamptz,
    o.created_at
  from public.orders o
  where o.order_type='Standard Package'

  order by created_at desc;
end;
$$;

revoke all on function public.staff_package_summary() from public, anon;
grant execute on function public.staff_package_summary() to authenticated;


create or replace function public.staff_edit_order(
  p_order_id uuid,
  p_items jsonb default null,
  p_notes text default null,
  p_standard_actual_weight numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_order public.orders;
  v_price jsonb;
  v_item jsonb;
  v_standard public.service_catalog;
  v_actual numeric;
  v_extra numeric;
  v_subtotal numeric;
  v_items jsonb;
begin
  if auth.uid() is null or not public.is_staff() then
    raise exception 'Staff access required';
  end if;

  select * into v_order
  from public.orders
  where id=p_order_id
  for update;

  if v_order.id is null then raise exception 'Order not found'; end if;
  if v_order.status in ('Picked Up (Archived)','Cancelled/Refunded') then
    raise exception 'Completed or cancelled orders cannot be edited';
  end if;

  if v_order.order_type='Standard Package' then
    if p_standard_actual_weight is null then
      v_actual := case
        when v_order.weight_summary ~ '^[0-9]+([.][0-9]+)? lb$'
          then split_part(v_order.weight_summary,' ',1)::numeric
        else 20
      end;
    else
      v_actual := round(p_standard_actual_weight,2);
    end if;

    if v_actual <= 0 or v_actual > 500 then
      raise exception 'Enter a valid actual weight';
    end if;

    select * into v_standard
    from public.service_catalog
    where name='Standard Package' and active
    limit 1;

    if v_standard.id is null then raise exception 'Standard Package pricing is unavailable'; end if;

    v_extra := greatest(v_actual-20,0);
    v_subtotal := round(v_standard.rate + (v_extra*200),2);
    v_items := jsonb_build_array(jsonb_build_object(
      'service_id',v_standard.id,
      'label','Standard Package',
      'category',v_standard.category,
      'rate',v_standard.rate,
      'unit',v_standard.unit,
      'qty',1,
      'total',v_standard.rate
    ));

    if v_extra > 0 then
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'service_id',null,
        'label','Package overage',
        'category','Package',
        'rate',200,
        'unit','lb',
        'qty',v_extra,
        'total',round(v_extra*200,2)
      ));
    end if;

    update public.orders
    set items=v_items,
        weight_summary=trim(to_char(v_actual,'FM999999990.##')) || ' lb',
        subtotal=v_subtotal,
        express_fee=case when express then round(v_subtotal*0.50,2) else 0 end,
        notes=case when p_notes is null then notes else left(p_notes,1000) end
    where id=v_order.id
    returning * into v_order;

    delete from public.order_items where order_id=v_order.id;
    insert into public.order_items(order_id,service_id,service_name,category,unit,quantity,unit_rate,line_total)
    values(v_order.id,v_standard.id,'Standard Package',v_standard.category,v_standard.unit,1,v_standard.rate,v_standard.rate);
    if v_extra > 0 then
      insert into public.order_items(order_id,service_id,service_name,category,unit,quantity,unit_rate,line_total)
      values(v_order.id,null,'Package overage','Package','lb',v_extra,200,round(v_extra*200,2));
    end if;
  elsif v_order.order_type='Monthly Package' then
    update public.orders
    set notes=case when p_notes is null then notes else left(p_notes,1000) end
    where id=v_order.id
    returning * into v_order;
  else
    if p_items is null then raise exception 'Order items are required'; end if;
    v_price := public.price_order_items(p_items);
    v_subtotal := (v_price->>'total')::numeric;

    update public.orders
    set items=v_price->'items',
        weight_summary=coalesce(v_price->>'weight_summary',''),
        subtotal=v_subtotal,
        express_fee=case when express then round(v_subtotal*0.50,2) else 0 end,
        notes=case when p_notes is null then notes else left(p_notes,1000) end
    where id=v_order.id
    returning * into v_order;

    delete from public.order_items where order_id=v_order.id;
    for v_item in select * from jsonb_array_elements(v_price->'items') loop
      insert into public.order_items(order_id,service_id,service_name,category,unit,quantity,unit_rate,line_total)
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
  end if;

  return to_jsonb(v_order)-'photo_upload_token_hash'-'photo_upload_expires_at';
end;
$$;

revoke all on function public.staff_edit_order(uuid,jsonb,text,numeric) from public, anon;
grant execute on function public.staff_edit_order(uuid,jsonb,text,numeric) to authenticated;
