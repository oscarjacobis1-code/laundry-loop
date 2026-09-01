import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://coohutrnqcxjhkxprama.supabase.co";
const publishableKey = "sb_publishable_WwvZpvMkiHM3YOLhwty85g_wGZKQ84e";

export function createPortalSupabase(portal: "admin" | "staff") {
  return createClient(supabaseUrl, publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: `laundry-loop-${portal}-auth-v2`,
      storage: typeof window === "undefined" ? undefined : window.sessionStorage,
    },
  });
}

// Attendance authentication must never share or revoke the persistent
// operating-session used by the staff dashboard.
export const attendanceSupabase = createClient(
  supabaseUrl,
  publishableKey,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: "laundry-loop-attendance-auth",
    },
  },
);
