# Laundry Loop service suspension (reversible)

This feature is OFF by default. It changes page responses only; it does not delete or edit orders, customers, Supabase data, or local queued transactions.

## Messages when enabled

| Visitor | Response |
| --- | --- |
| Public website: `/`, `/index.html`, other public HTML | HTTP 404: "404 - Page Not Found. Please contact administrator." |
| Staff POS: `/staff`, including `/staff?app=1` in the Android app | HTTP 200: "Service Temporarily Suspended. Please contact administrator for more information." |
| Admin: `/admin`, including subroutes | HTTP 200: "Service Temporarily Suspended. Please contact administrator for more information." No login access. |

Billing information is deliberately **not** shown on any suspended page, including the administrator route. To restore service, manage the server-side Netlify variable outside the website.

## Activation

1. Complete any required written contractual notice and preserve customer records.
2. Verify `npm test` and `npm run build` in the repository and Netlify Deploy Preview.
3. Netlify → Laundry Loop project → Project configuration → Environment variables.
4. Add `LAUNDRY_SERVICE_SUSPENDED` with value `true` for the appropriate deployment context. This is a server-side variable, **not** a `NEXT_PUBLIC_` variable.
5. Deploy a new build, and check public `/` and `/index.html` (404), `/staff?app=1` (neutral message), and `/admin` (neutral suspension notice, no login).
6. Verify the Android tablet online and confirm it no longer shows the live POS screen.

## Restoration

Change `LAUNDRY_SERVICE_SUSPENDED` to `false` (or remove it) and **redeploy**. Confirm that the public website and staff POS return normally. Staff who had online auth storage cleared will need to sign in again. Customer records are preserved.

## Limitations and safeguards

- The current installed APK uses a service worker and cached offline staff credentials. An offline tablet or an already-open old POS session can continue functioning until it reconnects/reloads. This feature is not a guaranteed immediate remote logout.
- The staff suspension page returns HTTP 200 intentionally because the existing `public/sw.js` network-first strategy only replaces its cached staff shell when the response is `ok`. A 503 response would cause the cached working POS to be displayed.
- The staff and admin suspension pages clear the saved Supabase *online* session storage keys when shown; they do not erase offline credentials or any locally queued order data.
- Netlify page suspension does not itself revoke Supabase sessions or block direct Supabase calls. If preventing online transactions is required, add authorized database-level enforcement separately.
- Leave Netlify/Supabase projects and customer data intact. Do not use account-wide hosting suspension or destructive device-management commands for this purpose.
