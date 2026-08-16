# Laundry Loop

Production foundation for the Spin & Scale / Laundry Loop customer ordering, tracking, subscription and staff POS system.

## Setup

1. Run `supabase-schema.sql` once in the Supabase SQL Editor.
2. Create each staff member in Supabase Authentication using email and password.
3. Insert the staff Auth user ID into `public.staff_profiles` using the example at the bottom of the schema.
4. Deploy the repository as a static site. `netlify.toml` contains the required redirects and security headers.

The browser receives only the Supabase anonymous key. That key is intended for public clients; the database RLS policies and security-definer RPC functions enforce access. Never place the Supabase service-role key in this repository.

## Security model

- Customer passcodes are bcrypt-hashed through `extensions.crypt`.
- Customer sessions are opaque random tokens; only SHA-256 hashes are stored.
- Anonymous visitors cannot select or modify the orders, customers or sessions tables directly.
- Public order creation recalculates every price against `service_catalog`; client totals are never trusted.
- Staff access uses Supabase Auth plus `staff_profiles` and RLS.
- The previous hard-coded staff credentials and browser-only order/account storage are disabled by `laundry-loop.production.js`.

## Before launch

- Replace the placeholder business telephone number.
- Configure the first staff account.
- Run end-to-end tests against the live Supabase project.
- Connect a real card-payment processor before enabling card payments. The current production layer intentionally blocks simulated card approvals.
