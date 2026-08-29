# The Laundry Loop

Production customer website and operations system built by SnapNest Solutions.

## Included

- Customer ordering, estimates, subscriptions and tracking
- Cash and MMG reference checkout
- Staff POS, WhatsApp updates, receipts and bag tags
- Affia supervisor discounts, cancellations and refunds
- Attendance, paper-order recovery, inventory and reporting
- Administrator CMS, service pricing and staff management
- Supabase schema, migrations and Row Level Security policies

## Routes

- `/` - customer website
- `/staff` - staff and supervisor portal
- `/admin` - administrator portal

## Local verification

```bash
npm ci
npm test
npm run build
```

## Deployment

See [NETLIFY-DEPLOYMENT.md](NETLIFY-DEPLOYMENT.md).

The Supabase browser publishable key is intentionally public and protected by Row Level Security. Never commit a service-role key, database password or user password.
