-- Preserve existing monthly requests and enroll legacy customer accounts in recovery.

insert into public.customer_subscriptions(customer_id,order_id,status,starts_at,ends_at)
select o.customer_id,o.id,
  case when o.payment->>'status'='Paid' then 'Active' else 'Pending Verification' end,
  case when o.payment->>'status'='Paid' then o.created_at else null end,
  case when o.payment->>'status'='Paid' then o.created_at+interval '30 days' else null end
from public.orders o
where o.customer_id is not null and o.order_type='Monthly Package'
on conflict (order_id) do nothing;

create or replace function public.customer_login(p_phone text,p_passcode text)
returns jsonb language plpgsql security definer set search_path = public, extensions
as $$
declare v_customer public.customers; v_token text; v_recovery text;
begin
  select * into v_customer from public.customers where phone=public.normalized_phone(p_phone);
  if v_customer.id is null or v_customer.passcode_hash<>extensions.crypt(p_passcode,v_customer.passcode_hash) then raise exception 'Invalid credentials'; end if;
  if v_customer.recovery_code_hash is null then
    v_recovery:=upper(substr(encode(extensions.gen_random_bytes(8),'hex'),1,10));
    update public.customers set recovery_code_hash=extensions.crypt(v_recovery,extensions.gen_salt('bf',10)) where id=v_customer.id;
  end if;
  delete from public.customer_sessions where expires_at<=now();
  v_token:=encode(extensions.gen_random_bytes(32),'hex');
  insert into public.customer_sessions(token_hash,customer_id) values(encode(extensions.digest(v_token,'sha256'),'hex'),v_customer.id);
  return jsonb_build_object('customer_id',v_customer.id,'name',v_customer.name,'phone',v_customer.phone,'session_token',v_token,'recovery_code',v_recovery);
end; $$;
