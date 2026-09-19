import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const portal = await readFile(new URL("../app/portal/Portal.tsx", import.meta.url), "utf8");
const supabaseClient = await readFile(new URL("../app/portal/supabase.ts", import.meta.url), "utf8");
const css = await readFile(new URL("../app/portal/portal.css", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/migrations/20260820230000_restore_operations_portal.sql", import.meta.url), "utf8");
const publicHtml = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const staffDirectoryFunction = await readFile(new URL("../supabase/functions/staff-login-directory/index.ts", import.meta.url), "utf8");

test("restores the original staff operations workflow", () => {
  for (const feature of [
    "Manual POS", "Customer name", "Laundry services", "Garment / care notes",
    "Payment method", "Payment status", "Create order & receipt", "WhatsApp",
    "Print receipt", "Print bag tag", "Cancel / Refund", "Cancel only", "Cancel &amp; refund",
    "Record inventory", "Operational snapshot",
  ]) assert.ok(portal.includes(feature), feature);
});

test("normalizes Guyana phone numbers before order intake", () => {
  assert.ok(portal.includes('if (digits.length === 7) return `592${digits}`'));
  assert.ok(portal.includes("validPhone(pos.phone)"));
  assert.ok(portal.includes("validPhone(paper.phone)"));
});

test("requires supervisor approval and a reason for cancellation or refund", () => {
  assert.ok(portal.includes('profile.role !== "staff"'));
  assert.ok(portal.includes("orderActionReason.trim()"));
  assert.ok(portal.includes('paymentStatus: orderAction.type === "refund" ? "Refunded" : undefined'));
  assert.ok(portal.includes('status: "Cancelled/Refunded"'));
});

test("keeps attendance authentication isolated from system access", () => {
  assert.match(portal, /staff-login-directory/);
  assert.match(portal, /action: "attendance"/);
  assert.match(staffDirectoryFunction, /signInWithPassword/);
  assert.match(staffDirectoryFunction, /staff_check_in/);
  assert.match(staffDirectoryFunction, /staff_check_out/);
  assert.match(portal, /attendancePassword/);
  assert.ok(!portal.includes('await supabase.auth.signOut(); setPassword("")'));
});

test("staff login directory is dynamic and excludes admins", () => {
  assert.match(portal, /staffDirectory\.map/);
  assert.match(staffDirectoryFunction, /\.eq\("active", true\)/);
  assert.match(staffDirectoryFunction, /\.in\("role", \["staff", "manager"\]\)/);
  assert.doesNotMatch(staffDirectoryFunction, /\.in\("role", \["staff", "manager", "admin"\]\)/);
});

test("isolates staff and administrator browser sessions", () => {
  assert.match(supabaseClient, /laundry-loop-\$\{portal\}-auth-v2/);
  assert.match(portal, /createPortalSupabase\(portal\)/);
  assert.doesNotMatch(portal, /event === "SIGNED_IN".*validateRole/);
  assert.doesNotMatch(portal, /auth\.signOut\(\)/);
  assert.match(portal, /auth\.signOut\(\{ scope: "local" \}\)/);
});

test("keeps staff and administrator capabilities separated", () => {
  assert.ok(portal.includes('data.role === "admin"'));
  assert.ok(portal.includes("Staff accounts must sign in at /staff"));
  assert.ok(portal.includes("Administrator accounts must sign in at /admin"));
  assert.ok(portal.includes('isAdmin ? [["content"'));
  assert.ok(portal.includes("Administrator only"));
  assert.ok(migration.includes("private.is_admin()"));
  assert.ok(migration.includes("admins manage staff profiles"));
});

test("keeps recovery, receipts, discounts, and private photos functional", () => {
  assert.ok(portal.includes("resetPasswordForEmail"));
  assert.ok(staffDirectoryFunction.includes("request_staff_password_recovery"));
  assert.ok(portal.includes("Use only the newest link"));
  assert.ok(portal.includes("createSignedUrl"));
  assert.ok(portal.includes("staff_update_order"));
  assert.ok(migration.includes("Discount cannot exceed subtotal"));
  assert.ok(css.includes("@media print"));
});

test("does not expose a staff or administrator login in public navigation", () => {
  assert.ok(!publicHtml.includes(">Staff Login<"));
  assert.ok(!publicHtml.includes(">Admin Login<"));
});


test("regular staff sees only daily revenue metrics", () => {
  assert.ok(portal.includes('profile?.role === "staff" ? "Revenue · today" : "Revenue · 30 days"'));
  assert.ok(portal.includes('profile?.role === "staff" ? "Orders · today" : "Orders · 30 days"'));
  assert.ok(portal.includes('profile?.role !== "staff"'));
  assert.ok(portal.includes('loadDashboard(profile?.role)'));
});


test("receipt modal does not duplicate the POS discount controls", () => {
  assert.ok(portal.includes("Order discount"));
  assert.ok(!portal.includes("receipt-discount-type"));
  assert.ok(!portal.includes(">Apply discount<"));
});
