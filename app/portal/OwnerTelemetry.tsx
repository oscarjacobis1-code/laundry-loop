"use client";

import { useEffect } from "react";
import { createPortalSupabase } from "./supabase";
import {
  isLaundryLoopApp,
  queuedOfflineCount,
  readCachedOrders,
  readQueuedOfflineAttendance,
} from "./offline";

const DEVICE_KEY = "laundry-loop-owner-monitor-device-id";

function deviceId() {
  let id = window.localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    window.localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

function appVersion() {
  const match = navigator.userAgent.match(/LaundryLoopPOS\/([^\s]+)/i);
  return match?.[1] ?? "web";
}

export default function OwnerTelemetry() {
  useEffect(() => {
    if (!isLaundryLoopApp()) return;
    const supabase = createPortalSupabase("staff");
    let stopped = false;

    const report = async () => {
      if (stopped || !navigator.onLine) return;
      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;
      if (!user) return;

      const pendingOrders = queuedOfflineCount();
      const cachedOrders = readCachedOrders();
      const latest = cachedOrders[0] as { tracking_code?: string } | undefined;
      const now = new Date().toISOString();

      await supabase.from("pos_device_status").upsert({
        device_id: deviceId(),
        staff_user_id: user.id,
        device_label: "Laundry Loop Counter Tablet",
        app_version: appVersion(),
        last_seen_at: now,
        last_sync_at: pendingOrders === 0 ? now : null,
        pending_orders: pendingOrders,
        pending_attendance: readQueuedOfflineAttendance().length,
        last_order_code: latest?.tracking_code ?? null,
        online: true,
        user_agent: navigator.userAgent.slice(0, 500),
        updated_at: now,
      }, { onConflict: "device_id" });
    };

    void report();
    const timer = window.setInterval(() => void report(), 30000);
    const online = () => void report();
    window.addEventListener("online", online);

    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.removeEventListener("online", online);
    };
  }, []);

  return null;
}
