import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const publicHtml = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const production = await readFile(new URL("../public/laundry-loop.production.js", import.meta.url), "utf8");
const portal = await readFile(new URL("../app/portal/Portal.tsx", import.meta.url), "utf8");
const portalCss = await readFile(new URL("../app/portal/portal.css", import.meta.url), "utf8");
const cmsMigration = await readFile(new URL("../supabase/migrations/20260823030000_site_content_cms.sql", import.meta.url), "utf8");
const posInventoryMigration = await readFile(new URL("../supabase/migrations/20260830010000_pos_discounts_and_inventory_creation.sql", import.meta.url), "utf8");
const subscriptionMigration = await readFile(new URL("../supabase/migrations/20260830020000_subscription_accounts_and_loop_credits.sql", import.meta.url), "utf8");

test("every public payment panel referenced by the controller exists", () => {
  const panelIds = new Set([...publicHtml.matchAll(/id="payment-step-([a-z]+)"/g)].map((match) => match[1]));
  const controller = publicHtml.match(/function showPaymentStep\(step\)\{([\s\S]*?)\n  \}/)?.[1] ?? "";
  const controlled = controller.match(/\[([^\]]+)]/)?.[1]
    .split(",")
    .map((value) => value.replaceAll(/[\s'"]/g, ""))
    .filter(Boolean) ?? [];
  assert.deepEqual(new Set(controlled), panelIds);
  assert.equal(panelIds.has("card"), false);
  assert.match(controller, /if \(panel\)/);
});

test("the production order layer initializes and owns public persistence", () => {
  assert.match(production, /window\.__LAUNDRY_PRODUCTION_READY__ = true/);
  assert.match(production, /window\.finalizeOrder = async function/);
  assert.match(production, /rpc\('create_public_order'/);
  assert.match(production, /window\.confirmMmgSent = function/);
  assert.doesNotMatch(publicHtml, /selectPaymentMethod\('Card'\)/);
});

test("public service cards go to their correct buying flows", () => {
  assert.match(publicHtml, /aria-label="Build a regular wash order" onclick="scrollToDropoff\(\)"/);
  assert.match(publicHtml, /aria-label="View and select the Standard Package" onclick="showView\('view-services'\)"/);
  assert.match(publicHtml, /aria-label="View and select the Monthly Care Plan" onclick="showView\('view-services'\)"/);
});

test("public estimator calculations use the approved catalog rates", () => {
  const literal = publicHtml.match(/const SERVICE_OPTIONS = (\[[\s\S]*?\n  \]);/)?.[1];
  assert.ok(literal, "SERVICE_OPTIONS literal");
  const services = vm.runInNewContext(literal);
  const byName = Object.fromEntries(services.map((service) => [service.label, service]));
  assert.equal(byName["Regular Laundry"].rate, 300);
  assert.equal(byName["Comforters"].rate, 5000);
  assert.equal(byName["Curtains (Ironing)"].rate, 2500);
  const estimate = byName["Regular Laundry"].rate * 12.5 + byName["Regular Pillows"].rate * 2;
  assert.equal(estimate, 5350);
});

test("counter POS starts with a service and reports actionable errors", () => {
  assert.match(portal, /const firstActive = services\.find\(\(service\) => service\.active\)/);
  assert.match(portal, /setPosMessage\(`The order was not saved:/);
  assert.match(portal, /MMG transaction reference/);
  assert.match(portal, /p_payment: \{ method: pos\.paymentMethod, status: pos\.paymentStatus, reference:/);
  assert.match(portal, /role="alert"/);
});

test("portal login fields keep visible descriptions", () => {
  assert.match(portal, /className="field-label">Email address/);
  assert.match(portal, /className="field-label">Password/);
  assert.match(portalCss, /\.login-card label,\.login-card \.field-label\{color:var\(--ink\)\}/);
});

test("supervisor POS discounts support fixed amounts and percentages", () => {
  assert.match(portal, /type DiscountMode = "amount" \| "percent"/);
  assert.match(portal, /pos\.discountMode === "percent"/);
  assert.match(portal, /p_discount_gyd: profile\?\.role === "staff" \? 0 : posDiscount/);
  assert.match(portal, /<option value="percent">Percentage<\/option>/);
  assert.match(posInventoryMigration, /v_role not in \('manager', 'admin'\)/);
  assert.match(posInventoryMigration, /Discount cannot exceed subtotal/);
});

test("staff and administrators can create new inventory items", () => {
  assert.match(portal, /rpc\("admin_create_inventory_item"/);
  assert.match(portal, /<form className="panel add-inventory-form"/);
  assert.doesNotMatch(portal, /\{isAdmin && <form className="panel add-inventory-form"/);
  assert.match(subscriptionMigration, /if not public\.is_staff\(\)/);
  assert.match(posInventoryMigration, /'Opening stock'/);
  assert.match(posInventoryMigration, /grant execute on function public\.admin_create_inventory_item/);
});

test("logout clears credentials and customer recovery invalidates old sessions", () => {
  assert.match(portal, /setPassword\(""\); setAttendancePassword\(""\); setNewPassword\(""\); setEmail\(""\)/);
  assert.match(production, /\['login-passcode','create-passcode','create-passcode-confirm','acc-pass','recover-passcode','recover-code'\]/);
  assert.match(subscriptionMigration, /customer_reset_passcode/);
  assert.match(subscriptionMigration, /delete from public\.customer_sessions/);
});

test("subscription requests activate after payment and expose account allowance", () => {
  assert.match(production, /create_subscription_request/);
  assert.match(production, /customer_account_summary/);
  assert.match(production, /remaining_pounds/);
  assert.match(subscriptionMigration, /orders_sync_subscription_payment/);
  assert.match(portal, /Your monthly subscription is now active/);
});

test("Loop Credit options are CMS-managed and purchasable", () => {
  assert.match(portal, /loop_credit_options/);
  assert.match(production, /create_loop_credit_request/);
  assert.match(subscriptionMigration, /loop_credit_options jsonb/);
  assert.match(subscriptionMigration, /loop_credit_purchases/);
});

test("receipt and action styling use the approved wording and fills", () => {
  assert.match(portal, /Fresh\. Folded\. Done\./);
  assert.match(portalCss, /\.whatsapp-action:before\{background:#169b62\}/);
  assert.match(portalCss, /\.print-action:before\{background:var\(--green2\)\}/);
});

test("receipt and bag tag printing are separate outputs", () => {
  assert.match(portal, /printOrder\("receipt"\)/);
  assert.match(portal, /printOrder\("tag"\)/);
  assert.match(portal, /id="printable-bag-tag"/);
});

test("the published location link is wired to the map pin", () => {
  assert.match(publicHtml, /href="https:\/\/maps\.app\.goo\.gl\/bLhw3EexXEfnfAVGA"/);
});

test("admin CMS publishes public content without duplicating operational prices", () => {
  assert.match(portal, /\["content", "Website content"/);
  assert.match(portal, /updateSiteContent/);
  assert.match(production, /loadPublicConfiguration/);
  assert.match(production, /from\('site_content'\)/);
  assert.match(production, /from\('service_catalog'\)/);
  assert.match(cmsMigration, /public reads site content/);
  assert.match(cmsMigration, /admins update site content/);
  assert.doesNotMatch(portal, /siteContent\.regular_rate/);
});
