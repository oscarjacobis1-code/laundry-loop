import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const bridge = readFileSync("app/portal/AndroidPrintBridge.tsx", "utf8");
const layout = readFileSync("app/layout.tsx", "utf8");
const supervisorGate = readFileSync("app/portal/SupervisorServiceGate.tsx", "utf8");
const mainActivity = readFileSync("android-print-bridge/app/src/main/java/com/laundryloop/printbridge/MainActivity.kt", "utf8");
const manifest = readFileSync("android-print-bridge/app/src/main/AndroidManifest.xml", "utf8");

test("root layout mounts direct printing and the supervisor service gate", () => {
  assert.match(layout, /AndroidPrintBridge/);
  assert.match(layout, /SupervisorServiceGate/);
});

test("Android receipt taps are captured before React can enter browser PDF printing", () => {
  assert.match(bridge, /document\.addEventListener\("click", onClick, true\)/);
  assert.match(bridge, /stopImmediatePropagation/);
  assert.match(bridge, /window\.print = \(\) =>/);
  assert.match(bridge, /window\.__LAUNDRY_DIRECT_PRINT_READY__ = true/);
});

test("direct bridge launches the installed Android app with safe receipt metadata", () => {
  assert.match(bridge, /package=com\.laundryloop\.printbridge/);
  assert.match(bridge, /params\.set\("order", meta\.order\)/);
  assert.match(bridge, /params\.set\("payment", meta\.payment\)/);
  assert.match(bridge, /suppress_drawer/);
});

test("supervisor service management requires current password", () => {
  assert.match(supervisorGate, /Services & pricing/);
  assert.match(supervisorGate, /signInWithPassword/);
  assert.match(supervisorGate, /Supervisor password/);
  assert.match(supervisorGate, /stopImmediatePropagation/);
});

test("Android app exposes only the direct receipt intent and no PrintService", () => {
  assert.match(manifest, /android:scheme="laundryloop-print" android:host="print"/);
  assert.doesNotMatch(manifest, /android\.printservice\.PrintService/);
  assert.doesNotMatch(manifest, /BIND_PRINT_SERVICE/);
});

test("Android app sanitizes, styles and protects drawer pulses", () => {
  assert.match(mainActivity, /sanitizeReceipt/);
  assert.match(mainActivity, /Charsets\.US_ASCII/);
  assert.match(mainActivity, /MAX_INPUT_CHARS/);
  assert.match(mainActivity, /suppressDrawer/);
  assert.match(mainActivity, /payment == "cash"/);
  assert.match(mainActivity, /!wasPrinted\(order\)/);
  assert.match(mainActivity, /writeStyledReceipt/);
  assert.match(mainActivity, /byteArrayOf\(0x1D, 0x21, 0x10\)/);
  assert.match(mainActivity, /byteArrayOf\(0x1B, 0x4D, 0x00\)/);
  assert.doesNotMatch(mainActivity, /getQueryParameter\("drawer"\)/);
});
