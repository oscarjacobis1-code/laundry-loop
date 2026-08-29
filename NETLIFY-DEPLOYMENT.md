# Laundry Loop - Netlify deployment

This repository contains the complete customer website, staff portal, administrator portal, tests and Supabase migrations.

## Deploy from GitHub

1. In Netlify, choose **Add new project** and **Import an existing project**.
2. Select GitHub and choose `oscarjacobis1-code/laundry-loop`.
3. Netlify should detect Next.js automatically.
4. Build command: `npm run build`.
5. Do not manually set a publish directory. Netlify's current Next.js adapter handles the output.
6. Deploy the site.

## Required Supabase update after the first Netlify deployment

Copy the final Netlify URL, then open Supabase:

1. Go to **Authentication > URL Configuration**.
2. Set **Site URL** to the final production domain.
3. Add these redirect URLs:
   - `https://YOUR-NETLIFY-DOMAIN/staff`
   - `https://YOUR-NETLIFY-DOMAIN/admin`
4. Keep the old address temporarily until the Netlify deployment has passed acceptance testing.

The Supabase publishable key included in the browser code is intentionally public and is protected by Row Level Security. No service-role key, database password or private credential belongs in this repository.

## Production routes

- `/` - customer website
- `/staff` - staff and Affia supervisor portal
- `/admin` - administrator portal

## Before switching the client to Netlify

- Run `npm test`.
- Run `npm run build`.
- Confirm customer Cash and MMG orders save successfully.
- Confirm Staff and Admin sessions remain separate.
- Confirm password recovery returns to the new Netlify domain.
- Confirm the client administrator account exists.
- Connect the custom domain only after those checks pass.

## External commissioning still required

- Rongta RP326 tablet print bridge and cash-drawer testing
- Custom SMTP for dependable password-recovery delivery
- Supabase leaked-password protection
- Final staff acceptance test
