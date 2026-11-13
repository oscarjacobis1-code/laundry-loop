import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const endpoint = fs.readFileSync("app/api/pos-access/route.ts", "utf8");
const proxy = fs.readFileSync("proxy.ts", "utf8");
const native = fs.readFileSync("android-print-bridge/app/src/main/java/com/laundryloop/printbridge/RemotePosAccess.kt", "utf8");
const activity = fs.readFileSync("android-print-bridge/app/src/main/java/com/laundryloop/printbridge/PosActivity.kt", "utf8");
const gradle = fs.readFileSync("android-print-bridge/app/build.gradle.kts", "utf8");

test("native status endpoint reads existing Netlify flag, never reveals payment information", () => {
  assert.match(endpoint, /process\.env\.LAUNDRY_SERVICE_SUSPENDED === "true"/);
  assert.match(endpoint, /\{ suspended \}/);
  assert.match(endpoint, /no-store/);
  assert.doesNotMatch(endpoint, /amount_due|payment|developer|invoice|61,000|service_role/i);
  assert.match(proxy, /path\.startsWith\("\/api\/"\)/);
});

test("native gate polls the public, cache-bypassing endpoint, not the cached WebView", () => {
  assert.match(native, /https:\/\/thelaundryloop\.net\/api\/pos-access/);
  assert.match(native, /HttpURLConnection/);
  assert.match(native, /useCaches = false/);
  assert.match(native, /Cache-Control/);
  assert.match(native, /POLL_INTERVAL_MS = 60_000L/);
  assert.doesNotMatch(native, /service_role|secret_key|password/i);
});

test("suspended status cannot be cleared by network outage or app restart", () => {
  assert.match(native, /KEY_SUSPENDED/);
  assert.match(native, /if \(preferences\.getBoolean\(KEY_SUSPENDED, false\)\) return State\.SUSPENDED/);
  assert.match(native, /if \(serverSuspended != null\)/);
  assert.match(native, /OFFLINE_LEASE_MS = 24L \* 60L \* 60L \* 1000L/);
  assert.match(native, /State\.CONNECTION_REQUIRED/);
  assert.doesNotMatch(native, /preferences\.edit\(\)\.clear/);
});

test("native suspension blocks POS WebView interaction and native receipt printing", () => {
  assert.match(activity, /accessOverlay\.visibility = View\.VISIBLE/);
  assert.match(activity, /isClickable = true/);
  assert.match(activity, /accessState != RemotePosAccess\.State\.ALLOWED/);
  assert.match(activity, /Service Temporarily Suspended/);
  assert.match(activity, /Please contact administrator for more information/);
  assert.match(activity, /accessControl\.close\(\)/);
  assert.doesNotMatch(activity, /deleteDatabase|clearCache\(true\)|clearHistory\(\)/);
  assert.match(gradle, /versionCode = 28/);
  assert.match(gradle, /versionName = "2\.3\.0"/);
});
