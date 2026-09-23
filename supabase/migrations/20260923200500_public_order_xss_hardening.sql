-- Prevent stored markup in public order fields that are rendered in customer views.
-- Existing production data was checked before this constraint was introduced.

alter table public.orders
  drop constraint if exists orders_order_type_safe_text,
  add constraint orders_order_type_safe_text
    check (order_type !~ '[<>[:cntrl:]]');

alter table public.orders
  drop constraint if exists orders_payment_method_allowed,
  add constraint orders_payment_method_allowed
    check (coalesce(payment->>'method','Cash') in ('Cash','MMG'));

alter table public.orders
  drop constraint if exists orders_payment_status_allowed,
  add constraint orders_payment_status_allowed
    check (coalesce(payment->>'status','Pay at Pickup') in ('Pay at Pickup','Pending Confirmation','Paid','Refunded'));
