-- Expose only the current status timestamp and Express flag to public order tracking.
-- Do not expose staff identities, the history of changes, customer details or payment references.
create or replace function public.track_public_order(p_tracking_code text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'tracking_code', o.tracking_code,
    'items', o.items,
    'weight_summary', o.weight_summary,
    'total', o.total,
    'status', o.status,
    'order_type', o.order_type,
    'scheduled_date', o.scheduled_date,
    'payment', o.payment - 'reference',
    'created_at', o.created_at,
    'express', coalesce(o.express, false),
    'status_changed_at', coalesce((
      select e.changed_at from public.order_status_events e
      where e.order_id = o.id and e.to_status = o.status
      order by e.changed_at desc, e.id desc limit 1
    ), o.created_at)
  )
  from public.orders o
  where o.tracking_code = upper(trim(p_tracking_code));
$$;
