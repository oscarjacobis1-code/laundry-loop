import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const bridge = await readFile(new URL("../app/portal/AndroidPrintBridge.tsx", import.meta.url), "utf8");
const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
const manifest = await readFile(new URL("../android-print-bridge/app/src/main/AndroidManifest.xml", import.meta.url), "utf8");
const mainActivity = await readFile(new URL("../android-print-bridge/app/src/main/java/com/laundryloop/printbridge/MainActivity.kt", import.meta.url), "utf8");

test("root layout mounts the bundled Android direct-print bridge", () => {
  assert.match(layout, /import AndroidPrintBridge from "\.\/portal\/AndroidPrintBridge"/);
  assert.match(layout, /<AndroidPrintBridge \/>/);
  assert.doesNotMatch(layout, /pos-print-bridge\.js/);
});

test("Android receipt taps are captured before React can enter browser PDF printing", () => {
  assert.match(bridge, /if \(!\/Android\/i\.test\(navigator\.userAgent\)\) return/);
  assert.match(bridge, /document\.addEventListener\("click", onClick, true\)/);
  assert.match(bridge, /event\.preventDefault\(\)/);
  assert.match(bridge, /event\.stopImmediatePropagation\(\)/);
  assert.match(bridge, /window\.print = \(\) =>/);
  assert.match(bridge, /directPrint\(modal\.classList\.contains\("print-tag"\)/);
});

test("direct bridge launches the installed Android app with structured receipt metadata", () => {
  assert.match(bridge, /params\.set\("mode", mode\)/);
  assert.match(bridge, /params\.set\("text", text\)/);
  assert.match(bridge, /params\.set\("order", meta\.order\)/);
  assert.match(bridge, /params\.set\("payment", meta\.payment\)/);
  assert.match(bridge, /intent:\/\/print\?/);
  assert.match(bridge, /package=\$\{packageName\}/);
  assert.match(bridge, /window\.location\.assign\(target\)/);
  assert.doesNotMatch(bridge, /params\.set\("drawer"/);
});

test("Android app exposes only the direct receipt intent and no PrintService", () => {
  assert.match(manifest, /android:scheme="laundryloop-print" android:host="print"/);
  assert.doesNotMatch(manifest, /android\.printservice\.PrintService/);
  assert.doesNotMatch(manifest, /BIND_PRINT_SERVICE/);
});

test("Android app sanitizes receipt text and protects repeat drawer pulses", () => {
  assert.match(mainActivity, /sanitizeReceipt/);
  assert.match(mainActivity, /Charsets\.US_ASCII/);
  assert.match(mainActivity, /MAX_INPUT_CHARS/);
  assert.match(mainActivity, /payment == "cash"/);
  assert.match(mainActivity, /!wasPrinted\(order\)/);
  assert.match(mainActivity, /markPrinted\(printedOrder\)/);
  assert.doesNotMatch(mainActivity, /getQueryParameter\("drawer"\)/);
});
