-- Keep express fees inside the authoritative order total.
-- Fixes a trigger regression that reset total to subtotal - discount
-- after create_public_order had already added express_fee.

create or replace function public.normalize_order_totals()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.subtotal = 0 and new.total > 0 and new.discount = 0 and coalesce(new.express_fee, 0) = 0 then
    new.subtotal := new.total;
  end if;

  new.total := greatest(
    0,
    round(
      coalesce(new.subtotal, 0)
      + case when coalesce(new.express, false) then coalesce(new.express_fee, 0) else 0 end
      - coalesce(new.discount, 0),
      2
    )
  );

  return new;
end;
$$;

drop trigger if exists orders_normalize_totals on public.orders;

create trigger orders_normalize_totals
before insert or update of subtotal, discount, express, express_fee
on public.orders
for each row
execute function public.normalize_order_totals();

update public.orders
set total = greatest(
  0,
  round(
    coalesce(subtotal, 0)
    + case when coalesce(express, false) then coalesce(express_fee, 0) else 0 end
    - coalesce(discount, 0),
    2
  )
)
where total is distinct from greatest(
  0,
  round(
    coalesce(subtotal, 0)
    + case when coalesce(express, false) then coalesce(express_fee, 0) else 0 end
    - coalesce(discount, 0),
    2
  )
);
