import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const portal = fs.readFileSync("app/portal/Portal.tsx", "utf8");
const offline = fs.readFileSync("app/portal/offline.ts", "utf8");
const worker = fs.readFileSync("public/sw.js", "utf8");
const manifest = fs.readFileSync("android-print-bridge/app/src/main/AndroidManifest.xml", "utf8");
const posActivity = fs.readFileSync("android-print-bridge/app/src/main/java/com/laundryloop/printbridge/PosActivity.kt", "utf8");
const migration = fs.readFileSync("supabase/migrations/20260923133000_offline_pos_sync.sql", "utf8");

test("offline POS queue is wired into staff order creation", () => {
  assert.match(portal, /saveCurrentPosOffline/);
  assert.match(portal, /staff_sync_offline_order/);
  assert.match(portal, /Offline ·/);
  assert.match(portal, /AndroidPrintBridge/);
});

test("offline order tracking codes are stable and queued locally", () => {
  assert.match(offline, /LL-OFF-/);
  assert.match(offline, /queueOfflineOrder/);
  assert.match(offline, /removeQueuedOfflineOrder/);
});

test("staff shell is cacheable for offline relaunch", () => {
  assert.match(worker, /\/staff\?app=1/);
  assert.match(worker, /request\.mode === "navigate"/);
});

test("Android APK launches POS and preserves native printer bridge", () => {
  assert.match(manifest, /android:name="\.PosActivity"/);
  assert.match(manifest, /android\.intent\.category\.LAUNCHER/);
  assert.match(manifest, /laundryloop-print/);
  assert.match(posActivity, /LaundryLoopPOS\/1\.0/);
  assert.match(posActivity, /thelaundryloop\.net\/staff\?app=1/);
});

test("offline sync RPC keeps printed tracking code", () => {
  assert.match(migration, /staff_sync_offline_order/);
  assert.match(migration, /tracking_code = v_code/);
  assert.match(migration, /entry_source = 'offline_sync'/);
});
