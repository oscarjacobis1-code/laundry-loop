import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const publicHtml = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const production = await readFile(new URL("../public/laundry-loop.production.js", import.meta.url), "utf8");
const portal = await readFile(new URL("../app/portal/Portal.tsx", import.meta.url), "utf8");
const cmsMigration = await readFile(new URL("../supabase/migrations/20260823030000_site_content_cms.sql", import.meta.url), "utf8");

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
