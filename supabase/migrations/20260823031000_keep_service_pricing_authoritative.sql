-- Prices are managed only in service_catalog. Keeping a single source of truth
-- prevents the public estimator, staff POS and homepage cards from drifting.
alter table public.site_content
  drop column if exists regular_rate,
  drop column if exists standard_package_price,
  drop column if exists monthly_plan_price;
