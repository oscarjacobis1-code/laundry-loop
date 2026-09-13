import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const bridge = await readFile(new URL("../public/pos-print-bridge.js", import.meta.url), "utf8");
const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
const manifest = await readFile(new URL("../android-print-bridge/app/src/main/AndroidManifest.xml", import.meta.url), "utf8");
const mainActivity = await readFile(new URL("../android-print-bridge/app/src/main/java/com/laundryloop/printbridge/MainActivity.kt", import.meta.url), "utf8");

test("Android POS loads the direct print bridge before interaction", () => {
  assert.match(layout, /pos-print-bridge\.js\?v=escpos-v2/);
  assert.match(layout, /strategy="beforeInteractive"/);
});

test("Android receipt taps never enter browser PDF printing", () => {
  assert.match(bridge, /if \(!isAndroid\) return/);
  assert.match(bridge, /window\.print = function/);
  assert.match(bridge, /directPrint\(/);
  assert.doesNotMatch(bridge, /browser_fallback_url/);
  assert.doesNotMatch(bridge, /window\.location\.href = .*printer-bridge/);
});

test("direct print bridge sends structured receipt metadata", () => {
  assert.match(bridge, /params\.set\('mode', mode\)/);
  assert.match(bridge, /params\.set\('text', text\)/);
  assert.match(bridge, /params\.set\('order', meta\.order\)/);
  assert.match(bridge, /params\.set\('payment', meta\.payment\)/);
  assert.doesNotMatch(bridge, /params\.set\('drawer'/);
});

test("an Android Print receipt tap launches the app intent without calling browser print", () => {
  let clickHandler;
  let browserPrintCalls = 0;

  class FakeElement {
    constructor(textContent = "") { this.textContent = textContent; }
    closest(selector) { return selector === ".modal-actions button.print-action" ? this : null; }
  }

  const receipt = {
    innerText: "Laundry Loop\nFresh. Folded. Done.\nLL-TEST-001\nPayment: Cash · Paid\nTotal GYD 300",
    querySelector(selector) {
      if (selector === "h2") return { textContent: "LL-TEST-001" };
      return null;
    },
    querySelectorAll(selector) {
      if (selector === "p") return [{ textContent: "Payment: Cash · Paid" }];
      return [];
    },
  };

  const context = {
    navigator: { userAgent: "Mozilla/5.0 (Linux; Android 12) Chrome/140" },
    URLSearchParams,
    Element: FakeElement,
    alert() {},
    window: {
      print() { browserPrintCalls += 1; },
      location: { href: "" },
    },
    document: {
      querySelector(selector) {
        if (selector === "#printable-receipt") return receipt;
        if (selector === ".receipt-modal") return { classList: { contains: () => false } };
        return null;
      },
      addEventListener(type, handler) {
        if (type === "click") clickHandler = handler;
      },
    },
  };

  vm.runInNewContext(bridge, context);
  assert.equal(context.window.__LAUNDRY_DIRECT_PRINT_READY__, true);
  assert.equal(typeof clickHandler, "function");

  const button = new FakeElement("Print receipt");
  clickHandler({
    target: button,
    preventDefault() {},
    stopPropagation() {},
    stopImmediatePropagation() {},
  });

  assert.equal(browserPrintCalls, 0);
  assert.match(context.window.location.href, /^intent:\/\/print\?/);
  assert.match(context.window.location.href, /mode=receipt/);
  assert.match(context.window.location.href, /order=LL-TEST-001/);
  assert.match(context.window.location.href, /payment=Cash/);
  assert.match(context.window.location.href, /package=com\.laundryloop\.printbridge/);
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
