import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const portal = fs.readFileSync("app/portal/Portal.tsx", "utf8");
const offline = fs.readFileSync("app/portal/offline.ts", "utf8");
const worker = fs.readFileSync("public/sw.js", "utf8");
const manifest = fs.readFileSync("android-print-bridge/app/src/main/AndroidManifest.xml", "utf8");
const posActivity = fs.readFileSync("android-print-bridge/app/src/main/java/com/laundryloop/printbridge/PosActivity.kt", "utf8");
const migration = fs.readFileSync("supabase/migrations/20260923133000_offline_pos_sync.sql", "utf8");
const securityMigration = fs.readFileSync("supabase/migrations/20260923193500_security_gate_hardening.sql", "utf8");
const xssMigration = fs.readFileSync("supabase/migrations/20260923200500_public_order_xss_hardening.sql", "utf8");
const publicApp = fs.readFileSync("public/laundry-loop.production.js", "utf8");
const publicHtml = fs.readFileSync("public/index.html", "utf8");

test("offline POS queue is wired into staff order creation", () => {
  assert.match(portal, /saveCurrentPosOffline/);
  assert.match(portal, /staff_sync_offline_order/);
  assert.match(portal, /Offline ·/);
  assert.match(portal, /AndroidPrintBridge/);
});

test("offline order tracking codes are stable and queued locally", () => {
  assert.match(offline, /const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"/);
  assert.match(offline, /queueOfflineOrder/);
  assert.match(offline, /removeQueuedOfflineOrder/);
  assert.match(offline, /14 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(offline, /slice\(0, 100\)/);
});

test("staff shell is cacheable for offline relaunch", () => {
  assert.match(worker, /\/staff\?app=1/);
  assert.match(worker, /request\.mode === "navigate"/);
});

test("Android APK launches a locked-down POS with internal printing", () => {
  assert.match(manifest, /android:name="\.PosActivity"/);
  assert.match(manifest, /android\.intent\.category\.LAUNCHER/);
  assert.match(manifest, /android:name="\.MainActivity"[\s\S]*android:exported="false"/);
  assert.match(manifest, /android:usesCleartextTraffic="false"/);
  assert.match(manifest, /android:allowBackup="false"/);
  assert.doesNotMatch(manifest, /android:scheme="laundryloop-print"/);
  assert.match(posActivity, /LaundryLoopPOS\/2\.1/);
  assert.match(posActivity, /FLAG_SECURE/);
  assert.match(posActivity, /createConfirmDeviceCredentialIntent/);
  assert.match(posActivity, /LaundryLoopNative/);
  assert.match(posActivity, /MIXED_CONTENT_NEVER_ALLOW/);
});

test("offline sync RPC keeps printed tracking code", () => {
  assert.match(migration, /staff_sync_offline_order/);
  assert.match(migration, /tracking_code = v_code/);
  assert.match(migration, /paper_reference = 'APP:' \|\| v_code/);
});

test("security migration enforces backend authorization", () => {
  assert.match(securityMigration, /staff_login_failures/);
  assert.match(securityMigration, /failed_attempts >= 0/);
  assert.match(securityMigration, /v_role not in \('manager','admin'\)/);
  assert.match(securityMigration, /when v_role = 'staff' then 1/);
  assert.match(securityMigration, /revoke insert, update, delete on table public\.orders from authenticated/);
  assert.match(securityMigration, /update storage\.buckets set public = false where id = 'receipts'/);
});

test("public customer order output cannot store or render active markup", () => {
  assert.match(xssMigration, /orders_order_type_safe_text/);
  assert.match(xssMigration, /orders_payment_method_allowed/);
  assert.match(xssMigration, /orders_payment_status_allowed/);
  assert.match(publicApp, /escapeHtml\(o\.type\)/);
  assert.match(publicApp, /escapeHtml\(error\?\.message/);
  assert.match(publicHtml, /safeHtml\(payment\.method\)/);
  assert.match(publicHtml, /safeHtml\(payment\.status\)/);
});
