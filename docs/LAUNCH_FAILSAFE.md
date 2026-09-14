# Laundry Loop Launch Failsafe Runbook

Launch target: Saturday, September 19, 2026.

This is the operational fallback plan for failures that cannot be fixed immediately on-site.

## Critical rule

Do not stop taking business because one layer fails. Preserve the order, payment state, customer contact, and original transaction time first; repair the digital record second.

## Failure channels

| Failure | Immediate fallback | Recovery path |
| --- | --- | --- |
| Public website unavailable | Take orders in-store or by WhatsApp; do not send customers to a broken page | Check Netlify deployment/status, domain/DNS, then redeploy the last known-good main commit |
| Supabase unavailable / internet down | Use numbered paper receipts and write customer, phone, service, quantity/weight, payment method, amount, exact time | When service returns, use **Enter paper order** so original transaction time and entry time are both preserved |
| Staff portal will not load | Refresh once, then test internet; use another browser/tab only if needed | If backend is healthy, sign out/in. If the site is down, use the paper-order procedure |
| Affia / staff login fails | Confirm the correct identity was selected; use password recovery only for the affected account | Admin can verify the staff profile is active; keep taking paper orders while access is restored |
| Admin login fails | Use the second active administrator account if available | Recover the affected admin account later; staff operations do not need to stop |
| Tablet loses internet | Switch from primary internet to mobile hotspot | Keep router/tablet on UPS; back-enter any paper receipts later |
| Printer does not print | In the printer app run **Test print** and confirm printer IP `192.168.1.87`, port `9100` | Check Ethernet cable, printer power, router connection, then printer IP. Handwrite/photograph the order code if printing cannot be restored immediately |
| Printer IP changes | Open Laundry Loop Printer and correct the saved IP, then Test print | Reserve the printer address in the router so it remains stable |
| Cash drawer does not open | Open it manually with the key if safe/available; continue recording payment in POS | Test drawer from printer app. Drawer failure must not block receipt/order creation |
| Android printer app crashes / missing | Keep the order saved in POS; use handwritten receipt/order code temporarily | Reinstall the last known-good APK and restore printer IP/port settings |
| Receipt reprint needed | Open the order and reprint | Reprints must not pulse/open the cash drawer |
| Scale photo upload fails | Record weight and notes; take the photo with the tablet camera and keep it temporarily | Attach/record evidence later if needed; do not hold up the order solely for upload failure |
| MMG cannot be confirmed | Leave payment as pending confirmation; do not mark Paid without verification | Confirm transaction reference when MMG access returns |
| Cash calculation uncertainty | Enter Cash Received; POS calculates Change Due | If POS is unavailable, calculate manually and write both tendered amount and change on the paper receipt |
| Power outage | UPS keeps tablet/router/printer alive as long as possible | If power or internet is fully unavailable, use numbered paper receipts and later back-enter them |

## Launch-day checks before opening

1. Open the public homepage from a phone using mobile data, not store Wi-Fi.
2. Sign in as Affia on `/staff` and confirm the dashboard loads.
3. Sign in as In-store Staff and confirm a normal staff account cannot access manager-only actions.
4. Sign in to `/admin` using an administrator account.
5. Create one small test cash order, enter a tendered amount above the total, and confirm the change shown is correct.
6. Print the receipt and confirm two copies, correct item/amount alignment, total weight where applicable, cash received, change, and one drawer pulse only on the first cash print.
7. Reprint the same receipt and confirm the drawer does not open.
8. Create one MMG test flow and confirm it remains pending until verified.
9. Test the printer app directly using `192.168.1.87:9100`.
10. Test the mobile hotspot fallback.
11. Confirm at least one numbered paper receipt book, pen, calculator, printer key, and charging cables are at the counter.

## Data protection / recovery

- Never delete an order to correct a mistake. Use cancel/refund with a reason so the audit trail remains.
- Never reuse an old order code for a new customer.
- Paper orders must be back-entered using the recovery screen, not recreated as a normal new POS order.
- Keep completed orders searchable by customer name, phone number, and order code.
- Do not expose staff/admin routes in public navigation.

## Remote-support information to have ready

- Public site/domain
- GitHub repository and current main commit
- Supabase project
- Printer IP: `192.168.1.87`
- Printer port: `9100`
- Router gateway: `192.168.1.1`
- Android printer bridge package: `com.laundryloop.printbridge`

If the failure is physical (power, Ethernet cable, printer, router, cash drawer), remote software changes may not solve it. Use the operational fallback first and repair hardware without stopping intake.
