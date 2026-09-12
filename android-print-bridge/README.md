# Laundry Loop Android Print Bridge

This companion Android app receives print requests from the Laundry Loop web POS and sends raw ESC/POS data to the receipt printer over the laundromat LAN.

## Intended hardware path

Redmi tablet (Wi-Fi) -> router -> Ethernet -> Rongta RP326 -> cash drawer

## Before deployment

1. Confirm the RP326 variant has an Ethernet/LAN interface and supports raw ESC/POS network printing.
2. Connect the printer to the router and print its self-test/configuration receipt.
3. Record the printer IP and raw print port. Port 9100 is the app default, not an assumption that every RP326 uses it.
4. Reserve the printer IP in the router/DHCP settings so it does not change.
5. Install this app on the dedicated Redmi tablet.
6. Open Laundry Loop Printer, enter the printer IP/port, save, and run Test print.
7. Connect the cash drawer to the printer's DK/DRAWER port, never the LAN port, then run Test cash drawer.

## Safety / transaction behavior

The bridge does not create or update orders. Supabase remains the transaction system of record. A printer failure therefore cannot erase a completed order. Receipt printing and drawer opening are separate operations. The drawer is not automatically opened by a normal receipt print in this first integration; that will be enabled only for confirmed cash-payment events after hardware testing.

## Browser fallback

The existing browser print path remains available as `window.__LAUNDRY_BROWSER_PRINT__()` on Android and remains the normal behavior on non-Android devices.

## Next hardware test

Verify the exact RP326 interface, IP/port, character encoding, cutter command, and drawer pulse against the physical unit before enabling automatic cash drawer opening in production.
