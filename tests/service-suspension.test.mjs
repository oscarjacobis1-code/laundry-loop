import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const proxy = await readFile(new URL("../proxy.ts", import.meta.url), "utf8");
const admin = await readFile(new URL("../app/admin/page.tsx", import.meta.url), "utf8");
const staff = await readFile(new URL("../app/staff/page.tsx", import.meta.url), "utf8");
const portal = await readFile(new URL("../app/portal/Portal.tsx", import.meta.url), "utf8");
const serviceWorker = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");

test("suspension defaults off, and only the private server-side flag enables it", () => {
  assert.match(proxy, /process\.env\[SERVICE_FLAG\] !== "true"/);
  assert.match(proxy, /LAUNDRY_SERVICE_SUSPENDED/);
  assert.doesNotMatch(proxy, /NEXT_PUBLIC_LAUNDRY_SERVICE_SUSPENDED/);
});

test("public website produces a genuine 404 with a neutral message", () => {
  assert.match(proxy, /"404 - Page Not Found"/);
  assert.match(proxy, /"Please contact administrator\."/);
  assert.match(proxy, /new Response\(publicPage, \{ status: 404/);
  assert.match(proxy, /\/index\.html/);
  assert.match(proxy, /noindex, nofollow/);
});

test("staff receives a neutral message without any billing information", () => {
  assert.match(proxy, /path === "\/staff"/);
  assert.match(proxy, /"Service Temporarily Suspended"/);
  assert.match(proxy, /"Please contact administrator for more information\."/);
  assert.match(proxy, /new Response\(staffPage, \{ status: 200/);
  const notice = proxy.match(/const staffPage = noticeHtml\([\s\S]*?\);/)?.[0];
  assert.ok(notice);
  assert.doesNotMatch(notice, /GYD|fees|payment|development|hosting|SnapNest/i);
  assert.match(staff, /<Portal portal="staff"/);
});

test("staff response can replace the old service-worker cached POS, without deleting queued orders", () => {
  assert.match(serviceWorker, /onlineResponse && onlineResponse\.ok/);
  assert.match(proxy, /status: 200/);
  assert.match(proxy, /localStorage\.removeItem/);
  assert.match(proxy, /laundry-loop-staff-auth-v2/);
  assert.doesNotMatch(proxy, /localStorage\.clear\(/);
  assert.doesNotMatch(proxy, /indexedDB\.deleteDatabase/);
});

test("administration and staff routes both show neutral suspension notices", () => {
  assert.match(proxy, /path === "\/admin" \|\| path\.startsWith\("\/admin\/"\)/);
  assert.match(proxy, /new Response\(adminPage, \{ status: 200/);
  assert.match(proxy, /"Service Temporarily Suspended"/);
  assert.match(proxy, /"Please contact administrator for more information\."/);
  const adminNotice = proxy.match(/const adminPage = noticeHtml\([\s\S]*?\);/)?.[0];
  assert.ok(adminNotice);
  assert.doesNotMatch(adminNotice, /GYD|fees|payment|development|hosting|SnapNest/i);
  assert.match(proxy, /laundry-loop-admin-auth-v2/);
  assert.match(admin, /<Portal portal="admin"/);
  assert.match(portal, /portal === "admin" && isAdmin && serviceSuspended/);
  assert.match(admin, /dynamic = "force-dynamic"/);
});
