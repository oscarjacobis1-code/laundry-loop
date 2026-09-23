-- Offline-first in-store POS sync.
-- Offline receipts keep the same tracking code after reconnecting.

create or replace function public.staff_sync_offline_order(
  p_client_tracking_code text,
  p_name text,
  p_phone text,
  p_items jsonb,
  p_notes text,
  p_payment jsonb,
  p_discount_gyd numeric,
  p_original_transaction_at timestamptz,
  p_express boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.orders;
  v_created jsonb;
  v_order public.orders;
  v_code text := upper(trim(coalesce(p_client_tracking_code, '')));
begin
  if auth.uid() is null or not public.is_staff() then
    raise exception 'Staff access required';
  end if;

  if v_code !~ '^P[A-HJ-NP-Z2-9]{8}
    raise exception 'Invalid offline tracking code';
  end if;

  if p_original_transaction_at is null or p_original_transaction_at > now() + interval '2 minutes' then
    raise exception 'Invalid original transaction time';
  end if;

  select * into v_existing from public.orders where tracking_code = v_code limit 1;
  if v_existing.id is not null then
    if coalesce(v_existing.paper_reference, '') <> ('APP:' || v_code) then
      raise exception 'Tracking code already exists';
    end if;
    return to_jsonb(v_existing)-'photo_upload_token_hash'-'photo_upload_expires_at';
  end if;

  v_created := public.staff_create_order(
    p_name,
    p_phone,
    p_items,
    p_notes,
    p_payment,
    coalesce(p_discount_gyd, 0)
  );

  select * into v_order
  from public.orders
  where id = (v_created->>'id')::uuid
  for update;

  update public.orders
  set tracking_code = v_code,
      entry_source = 'live',
      original_transaction_at = p_original_transaction_at,
      paper_reference = 'APP:' || v_code,
      express = coalesce(p_express, false),
      express_fee = case when coalesce(p_express, false) then round(coalesce(v_order.subtotal, 0) * 0.50, 2) else 0 end
  where id = v_order.id
  returning * into v_order;

  return to_jsonb(v_order)-'photo_upload_token_hash'-'photo_upload_expires_at';
end;
$$;

revoke all on function public.staff_sync_offline_order(text,text,text,jsonb,text,jsonb,numeric,timestamptz,boolean) from public, anon;
grant execute on function public.staff_sync_offline_order(text,text,text,jsonb,text,jsonb,numeric,timestamptz,boolean) to authenticated;
 then
    raise exception 'Invalid offline tracking code';
  end if;

  if p_original_transaction_at is null or p_original_transaction_at > now() + interval '2 minutes' then
    raise exception 'Invalid original transaction time';
  end if;

  select * into v_existing from public.orders where tracking_code = v_code limit 1;
  if v_existing.id is not null then
    if v_existing.entry_source <> 'offline_sync' then
      raise exception 'Tracking code already exists';
    end if;
    return to_jsonb(v_existing)-'photo_upload_token_hash'-'photo_upload_expires_at';
  end if;

  v_created := public.staff_create_order(
    p_name,
    p_phone,
    p_items,
    p_notes,
    p_payment,
    coalesce(p_discount_gyd, 0)
  );

  select * into v_order
  from public.orders
  where id = (v_created->>'id')::uuid
  for update;

  update public.orders
  set tracking_code = v_code,
      entry_source = 'offline_sync',
      original_transaction_at = p_original_transaction_at,
      paper_reference = v_code,
      express = coalesce(p_express, false),
      express_fee = case when coalesce(p_express, false) then round(coalesce(v_order.subtotal, 0) * 0.50, 2) else 0 end
  where id = v_order.id
  returning * into v_order;

  return to_jsonb(v_order)-'photo_upload_token_hash'-'photo_upload_expires_at';
end;
$$;

revoke all on function public.staff_sync_offline_order(text,text,text,jsonb,text,jsonb,numeric,timestamptz,boolean) from public, anon;
grant execute on function public.staff_sync_offline_order(text,text,text,jsonb,text,jsonb,numeric,timestamptz,boolean) to authenticated;
