# Laundry Loop functional audit

This checklist is the regression contract for the customer website and operations portals. UI styling is intentionally outside this document.

## Public customer website

| Area | Function | Destination / result | Check |
|---|---|---|---|
| Navigation | Home | Landing view | Browser |
| Navigation | Services & Subscriptions | Package selection view | Browser + wiring test |
| Navigation | Pricing | Calculator view | Wiring test |
| Navigation | Schedule Pickup | Scheduled-order form | Wiring test |
| Navigation | Drop-Off / Order Now / Estimate | Same-page estimator and order form | Browser + wiring test |
| Location | Map pin / directions | Approved Google Maps share link in a new tab | Browser + wiring test |
| Service cards | Regular Wash | Same-page custom order calculator | Wiring test |
| Service cards | Standard Package | Subscription/package view | Wiring test |
| Service cards | Monthly Care Plan | Subscription/package view | Wiring test |
| Calculator | Add/remove services | Recalculates total from the service catalog | Unit + browser check |
| Calculator | Quantity/weight | Accepts positive half-unit increments | Unit + HTML validation |
| Drop-off order | Continue to Payment | Opens Cash/MMG choice | Browser regression test |
| Scheduled order | Continue to Payment | Opens Cash/MMG choice with selected date | Wiring test |
| Cash checkout | Confirm order | Saves order, generates tracking code and receipt | Transactional database test |
| MMG checkout | Reference verification | Requires reference and saves Pending Confirmation | Transactional database test |
| Scale photo | Compress/upload/attach | Private storage path with short upload token | Code + RPC permissions check |
| Tracking | Look up code | Returns limited public status, total and payment data | Transactional database test |
| Customer account | Create/login/logout | Token-based customer session | Transactional database test |
| Customer account | Order history | Only orders tied to the customer session | Transactional database test |
| Packages | Cash/MMG selection | Creates the selected Standard or Monthly order | Wiring + pricing test |
| CMS content | Page load | Loads live business/hero/location/MMG content | Browser + RLS test |
| CMS pricing | Page load | Loads prices from `service_catalog` (single source of truth) | Browser + RLS test |

## Staff and supervisor portal

| Area | Function | Permission / result | Check |
|---|---|---|---|
| Identity | Affia / In-store Staff selector | Chooses the correct email identity | Browser |
| Attendance | Check in / check out | Separate non-persistent auth session; does not enter POS | Transactional DB + source test |
| System access | Sign in / sign out | Separate staff session with access log and heartbeat | Transactional DB + source test |
| Recovery | Forgot password | Supabase recovery with resend delay and admin alert | Source + UI test |
| Orders | List/search/filter | Active, archived and cancelled order views | Source + RLS test |
| Orders | Status change | Staff workflow statuses; cancellation excluded for regular staff | Transactional role test |
| Orders | Payment status | Cash/MMG payment state changes | Transactional DB test |
| Orders | WhatsApp | Opens `wa.me` with order code, status and total | Source test |
| Orders | Receipt | Dedicated 80 mm receipt output | Print regression test |
| Orders | Bag tag | Separate large-code bag label output | Print regression test |
| Orders | Photo | Five-minute signed private photo URL | Source + storage rule check |
| Supervisor | Discount | Database-enforced discount up to subtotal | Transactional role test |
| Supervisor | Cancel/refund | Requires reason; regular staff denied in database | Transactional role test |
| POS | Customer validation | Name and Guyana/international phone validation | Unit/source test |
| POS | Service/quantity | First service preselected; live service catalog | Unit + transactional test |
| POS | Calculation | Live rate × quantity total | Unit + transactional test |
| POS | Cash/MMG | MMG reference required and stored | Unit + transactional test |
| POS | Create order | Saves, refreshes queue and opens receipt | Transactional DB + source test |
| Outage recovery | Paper order back-entry | Preserves original and entry times plus paper reference | Transactional DB test |
| Inventory | Summary | On-hand, reorder and days-remaining data | Transactional DB test |
| Inventory | Movement | Restock/usage/waste/adjustment audit record | Transactional DB test |
| Operations | 30-day summary | Orders, revenue, average, repeat and timing metrics | Transactional DB test |

## Administrator portal

| Area | Function | Permission / result | Check |
|---|---|---|---|
| Login | Admin route | Admin-only profile validation and isolated session | RLS + source test |
| CMS | Website content | Admin-only live hero/contact/location/MMG editor | RLS + source test |
| Services | Pricing/catalog | Admin-only service name/category/rate/unit/active editor | RLS + browser wiring |
| Staff | Role/access editor | Admin-only staff/supervisor/admin role and activation | RLS + source test |
| Staff | Attendance report | Last seven days, hours and open sessions | RLS + source test |
| Staff | Access report | Login/logout/last activity | RLS + source test |
| Security | Recovery alerts | Admin resolves staff recovery requests | RLS + source test |

## Intentional external dependencies

- MMG is reference capture and staff confirmation, not a direct MMG payment API.
- Rongta printing still requires the tablet print bridge and physical hardware.
- Full offline POS synchronization is not included; the approved failsafe is UPS + hotspot + numbered paper orders + audited back-entry.
- Production password email delivery depends on custom SMTP; Supabase's test mail quota remains unsuitable for normal operations.
