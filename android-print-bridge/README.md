# Laundry Loop Android Print Bridge

This companion Android app receives receipt and bag-tag print requests from the Laundry Loop web POS and sends raw ESC/POS data directly to the Rongta network printer over the laundromat LAN.

## Production hardware path

Redmi tablet (Wi-Fi) -> router -> Ethernet -> Rongta RP326 -> cash drawer

## Production print path

Laundry Loop POS -> explicit Android intent -> Laundry Loop Printer app -> raw ESC/POS TCP -> Rongta

There is no Android PrintService, PDF generation, PDF preview, raster conversion, or system print spooler in the normal POS receipt path.

## Before deployment

1. Confirm the printer self-test shows the expected Ethernet settings.
2. Reserve the printer IP in the router so it does not change.
3. Install the Laundry Loop Printer app on the dedicated Redmi tablet.
4. Open the app, confirm IP `192.168.1.87` and port `9100`, then save.
5. Run **Test print** and **Test cash drawer** locally in the app.
6. Open the POS and test one real receipt from the Receipt modal.

## Safety / transaction behavior

Supabase remains the transaction system of record. Printing never creates or recreates an order.

Incoming browser text is normalized to printer-safe ASCII, ESC/control bytes are stripped, and receipt input length is capped before anything is sent to the printer.

The browser cannot request a raw drawer pulse. The app derives drawer behavior from structured receipt metadata: a valid first successful receipt print for a Cash order can open the drawer. The app remembers successfully printed order codes so reprints do not pulse the drawer again. MMG and bag-tag prints never open the drawer.

If the printer connection or write fails, the app remains open and shows the printer error so staff can retry. Failed jobs are not recorded as successfully printed.

## Printer assumptions verified on site

- ESC/POS compatible Rongta printer
- IP: `192.168.1.87`
- Raw TCP port: `9100`
- 80 mm paper
- Cutter tested
- Cash drawer pulse tested
- Direct text receipt test passed

## Release note

GitHub Actions currently produces a debug commissioning APK. Before final production handover, create a signed Android release keystore and store its values in repository Actions secrets so a signed release APK can be generated and updated safely.
