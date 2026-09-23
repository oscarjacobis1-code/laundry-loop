"use client";

export type OfflineProfile = {
  user_id: string;
  display_name: string;
  role: "staff" | "manager" | "admin";
  active?: boolean;
};

export type OfflineService = {
  id: string;
  name: string;
  category: string;
  rate: number;
  unit: string;
  active: boolean;
};

export type OfflineOrderPayload = {
  trackingCode: string;
  createdAt: string;
  name: string;
  phone: string;
  items: Array<{ label: string; qty: number }>;
  notes: string;
  payment: Record<string, unknown>;
  discount: number;
  express: boolean;
  localOrder: Record<string, unknown>;
};

const PREFIX = "laundry-loop-offline-v1";
const profileKey = (portal: string) => `${PREFIX}:profile:${portal}`;
const servicesKey = `${PREFIX}:services`;
const ordersKey = `${PREFIX}:orders`;
const queueKey = `${PREFIX}:queue`;

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // A full/disabled local store must never stop a live POS transaction.
  }
}

export function isLaundryLoopApp() {
  if (typeof window === "undefined") return false;
  return /LaundryLoopPOS/i.test(window.navigator.userAgent) || new URLSearchParams(window.location.search).get("app") === "1";
}

export function cacheProfile(portal: string, profile: OfflineProfile) {
  writeJson(profileKey(portal), { value: profile, savedAt: new Date().toISOString() });
}

export function readCachedProfile(portal: string): OfflineProfile | null {
  const cached = readJson<{ value?: OfflineProfile } | null>(profileKey(portal), null);
  return cached?.value ?? null;
}

export function cacheServices(services: OfflineService[]) {
  writeJson(servicesKey, { value: services, savedAt: new Date().toISOString() });
}

export function readCachedServices(): OfflineService[] {
  const cached = readJson<{ value?: OfflineService[] } | null>(servicesKey, null);
  return Array.isArray(cached?.value) ? cached!.value! : [];
}

export function cacheOrders(orders: Record<string, unknown>[]) {
  const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
  const recent = orders
    .filter((order) => {
      const created = Date.parse(String(order.created_at ?? ""));
      return Number.isFinite(created) ? created >= cutoff : true;
    })
    .slice(0, 100);
  writeJson(ordersKey, { value: recent, savedAt: new Date().toISOString() });
}

export function readCachedOrders(): Record<string, unknown>[] {
  const cached = readJson<{ value?: Record<string, unknown>[] } | null>(ordersKey, null);
  return Array.isArray(cached?.value) ? cached!.value! : [];
}

export function createOfflineTrackingCode() {
  // Existing Laundry Loop tracking codes allow A-Z and 2-9 only, 6-10 chars.
  // Prefix with P so staff can recognize APK-created POS transactions.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return "P" + Array.from(bytes, (value) => alphabet[value % alphabet.length]).join("");
}

export function queueOfflineOrder(order: OfflineOrderPayload) {
  const queue = readQueuedOfflineOrders();
  if (!queue.some((item) => item.trackingCode === order.trackingCode)) queue.push(order);
  writeJson(queueKey, queue);
}

export function readQueuedOfflineOrders(): OfflineOrderPayload[] {
  const queue = readJson<OfflineOrderPayload[]>(queueKey, []);
  return Array.isArray(queue) ? queue : [];
}

export function removeQueuedOfflineOrder(trackingCode: string) {
  writeJson(queueKey, readQueuedOfflineOrders().filter((item) => item.trackingCode !== trackingCode));
}

export function queuedOfflineCount() {
  return readQueuedOfflineOrders().length;
}

export function registerOfflineWorker() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
}
