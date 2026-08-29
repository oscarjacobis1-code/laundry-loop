create table if not exists public.site_content (
  id boolean primary key default true check (id),
  business_name text not null default 'The Laundry Loop' check (char_length(business_name) between 2 and 80),
  tagline text not null default 'Clean Clothes. Fresh Start.' check (char_length(tagline) between 2 and 120),
  hero_eyebrow text not null default '#1 Laundromat on the West Bank of Demerara' check (char_length(hero_eyebrow) between 2 and 120),
  hero_title text not null default 'Your laundry.' check (char_length(hero_title) between 2 and 80),
  hero_emphasis text not null default 'Fresh, folded, done.' check (char_length(hero_emphasis) between 2 and 80),
  hero_description text not null default 'The Laundry Loop gives your clothes careful, dependable wash, dry and fold service—with clear prices and order tracking from drop-off to pickup.' check (char_length(hero_description) between 10 and 400),
  address text not null default '1181 La Parfait Harmonie, West Bank Demerara' check (char_length(address) between 5 and 200),
  directions text not null default 'Obliquely opposite the Police Station at Four Corner' check (char_length(directions) between 5 and 200),
  maps_url text not null default 'https://maps.app.goo.gl/bLhw3EexXEfnfAVGA' check (maps_url ~ '^https://maps\\.app\\.goo\\.gl/[A-Za-z0-9_-]+$'),
  phone text not null default '+592 600-1234' check (char_length(phone) between 7 and 30),
  mmg_number text not null default '6351452' check (mmg_number ~ '^[0-9]{7,15}$'),
  mmg_name text not null default 'Jermaine McPherson' check (char_length(mmg_name) between 2 and 120),
  regular_rate numeric(12,2) not null default 300 check (regular_rate >= 0),
  standard_package_price numeric(12,2) not null default 5000 check (standard_package_price >= 0),
  monthly_plan_price numeric(12,2) not null default 40000 check (monthly_plan_price >= 0),
  estimate_disclaimer text not null default 'The final price is confirmed after weighing.' check (char_length(estimate_disclaimer) between 5 and 240),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

insert into public.site_content (id) values (true)
on conflict (id) do nothing;

drop trigger if exists site_content_set_updated_at on public.site_content;
create trigger site_content_set_updated_at
before update on public.site_content
for each row execute function public.set_updated_at();

alter table public.site_content enable row level security;

drop policy if exists "public reads site content" on public.site_content;
create policy "public reads site content" on public.site_content
for select to anon, authenticated
using (id);

drop policy if exists "admins update site content" on public.site_content;
create policy "admins update site content" on public.site_content
for update to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()) and id);

revoke all on public.site_content from public, anon, authenticated;
grant select on public.site_content to anon, authenticated;
grant update (
  business_name, tagline, hero_eyebrow, hero_title, hero_emphasis, hero_description,
  address, directions, maps_url, phone, mmg_number, mmg_name, regular_rate,
  standard_package_price, monthly_plan_price, estimate_disclaimer, updated_by
) on public.site_content to authenticated;
