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

type AttendanceMode = "in" | "out";

type ApiError = {
  error_description?: string;
  message?: string;
  msg?: string;
};

async function readApiError(response: Response) {
  const body = await response.json().catch(() => ({})) as ApiError;
  return body.error_description || body.message || body.msg || "The attendance request could not be completed.";
}

// Attendance is intentionally authenticated with a one-use token instead of a
// second GoTrueClient. This keeps it isolated from the persistent staff/admin
// portal sessions and avoids multiple auth clients competing in one tab.
export async function runAttendanceAction(email: string, password: string, mode: AttendanceMode) {
  const loginResponse = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: publishableKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  if (!loginResponse.ok) throw new Error("Password is incorrect.");
  const login = await loginResponse.json() as { access_token?: string };
  if (!login.access_token) throw new Error("Attendance authentication did not return a valid session.");

  try {
    const rpcResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/${mode === "in" ? "staff_check_in" : "staff_check_out"}`, {
      method: "POST",
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${login.access_token}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    if (!rpcResponse.ok) throw new Error(await readApiError(rpcResponse));
  } finally {
    await fetch(`${supabaseUrl}/auth/v1/logout`, {
      method: "POST",
      headers: { apikey: publishableKey, Authorization: `Bearer ${login.access_token}` },
    }).catch(() => undefined);
  }
}
