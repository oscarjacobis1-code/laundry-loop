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


export type OfflineStaffDirectoryEntry = {
  user_id: string;
  display_name: string;
  role: "staff" | "manager";
};

export type OfflineAttendanceEvent = {
  eventId: string;
  userId: string;
  mode: "in" | "out";
  occurredAt: string;
};

type OfflineCredential = {
  userId: string;
  salt: string;
  verifier: string;
  iterations: number;
  savedAt: string;
};

const staffDirectoryKey = `${PREFIX}:staff-directory`;
const credentialKey = (userId: string) => `${PREFIX}:credential:${userId}`;
const attendanceQueueKey = `${PREFIX}:attendance-queue`;

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((value) => { binary += String.fromCharCode(value); });
  return btoa(binary);
}

async function deriveOfflineVerifier(password: string, salt: Uint8Array, iterations: number) {
  const pbkdfSalt = Uint8Array.from(salt).buffer;
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: pbkdfSalt, iterations },
    material,
    256,
  );
  return bytesToBase64(new Uint8Array(bits));
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function cacheStaffDirectory(staff: OfflineStaffDirectoryEntry[]) {
  writeJson(staffDirectoryKey, { value: staff, savedAt: new Date().toISOString() });
}

export function readCachedStaffDirectory(): OfflineStaffDirectoryEntry[] {
  const cached = readJson<{ value?: OfflineStaffDirectoryEntry[] } | null>(staffDirectoryKey, null);
  return Array.isArray(cached?.value) ? cached!.value! : [];
}

export async function provisionOfflineCredential(userId: string, password: string) {
  if (!userId || !password || !crypto?.subtle) return;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iterations = 210000;
  const verifier = await deriveOfflineVerifier(password, salt, iterations);
  const credential: OfflineCredential = {
    userId,
    salt: bytesToBase64(salt),
    verifier,
    iterations,
    savedAt: new Date().toISOString(),
  };
  writeJson(credentialKey(userId), credential);
}

export async function verifyOfflineCredential(userId: string, password: string) {
  const credential = readJson<OfflineCredential | null>(credentialKey(userId), null);
  if (!credential || credential.userId !== userId || !password || !crypto?.subtle) return false;
  const verifier = await deriveOfflineVerifier(password, base64ToBytes(credential.salt), credential.iterations);
  if (verifier.length !== credential.verifier.length) return false;
  let mismatch = 0;
  for (let i = 0; i < verifier.length; i += 1) mismatch |= verifier.charCodeAt(i) ^ credential.verifier.charCodeAt(i);
  return mismatch === 0;
}

export function queueOfflineAttendance(userId: string, mode: "in" | "out") {
  const queue = readQueuedOfflineAttendance();
  const event: OfflineAttendanceEvent = {
    eventId: crypto.randomUUID(),
    userId,
    mode,
    occurredAt: new Date().toISOString(),
  };
  queue.push(event);
  writeJson(attendanceQueueKey, queue);
  return event;
}

export function readQueuedOfflineAttendance(): OfflineAttendanceEvent[] {
  const queue = readJson<OfflineAttendanceEvent[]>(attendanceQueueKey, []);
  return Array.isArray(queue) ? queue : [];
}

export function removeQueuedOfflineAttendance(eventId: string) {
  writeJson(attendanceQueueKey, readQueuedOfflineAttendance().filter((item) => item.eventId !== eventId));
}

export function offlineAttendanceState(userId: string) {
  const events = readQueuedOfflineAttendance()
    .filter((item) => item.userId === userId)
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  return events.length ? events[events.length - 1].mode : null;
}
