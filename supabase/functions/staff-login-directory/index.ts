import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const allowedOrigins = new Set([
  "https://thelaundryloop.net",
  "https://www.thelaundryloop.net",
]);

const SNAPNEST_SUPPORT_EMAIL = "snapnestsolutions@gmail.com";

function corsFor(req: Request) {
  const origin = req.headers.get("origin");
  if (origin && !allowedOrigins.has(origin)) return null;
  return {
    "Access-Control-Allow-Origin": origin ?? "https://thelaundryloop.net",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(body: unknown, status = 200, cors: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

function fail(code: string, error: string, status: number, cors: Record<string, string>) {
  return json({ ok: false, code, error }, status, cors);
}

function attendanceFailure(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes("already checked in")) return { code: "LL-ATT-001", error: "You are already checked in. Check out the open shift before checking in again." };
  if (normalized.includes("no open shift")) return { code: "LL-ATT-002", error: "No open shift was found to check out." };
  if (normalized.includes("not authorized")) return { code: "LL-ATT-003", error: "This account is not authorized for attendance." };
  return { code: "LL-ATT-500", error: "Attendance could not be recorded." };
}

Deno.serve(async (req) => {
  const cors = corsFor(req);
  if (!cors) return new Response(JSON.stringify({ ok: false, code: "LL-SEC-001", error: "Origin not allowed" }), { status: 403, headers: { "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail("LL-REQ-001", "Method not allowed.", 405, cors);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !serviceRole || !anonKey) return fail("LL-SYS-001", "Server configuration is unavailable.", 500, cors);

  const admin = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
  const anon = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const body = await req.json().catch(() => ({}));
  const action = String(body?.action ?? "");

  if (action === "list") {
    const { data, error } = await admin
      .from("staff_profiles")
      .select("user_id,display_name,role")
      .eq("active", true)
      .in("role", ["staff", "manager"])
      .order("display_name");
    if (error) return fail("LL-DIR-001", "Staff list could not be loaded.", 500, cors);
    return json({ ok: true, staff: data ?? [] }, 200, cors);
  }

  // Kept temporarily for compatibility with already-loaded browser clients.
  // It now verifies only the authenticated staff role; there is no device binding.
  if (action === "device_check") {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) return fail("LL-AUTH-005", "A valid session is required.", 401, cors);
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    const caller = authData.user;
    if (authError || !caller) return fail("LL-AUTH-005", "Your session could not be verified. Sign in again.", 401, cors);

    const { data: profile, error: profileError } = await admin
      .from("staff_profiles")
      .select("role,active")
      .eq("user_id", caller.id)
      .maybeSingle();
    if (profileError || !profile?.active || !["staff", "manager"].includes(profile.role)) {
      return fail("LL-AUTH-006", "This account is not authorized for staff access.", 403, cors);
    }
    return json({ ok: true }, 200, cors);
  }

  const userId = String(body?.user_id ?? "");
  if (!userId) return fail("LL-AUTH-000", "Choose a staff member.", 400, cors);

  const { data: profile, error: profileError } = await admin
    .from("staff_profiles")
    .select("user_id,display_name,role,active")
    .eq("user_id", userId)
    .maybeSingle();
  if (profileError || !profile?.active || !["staff", "manager"].includes(profile.role)) {
    return fail("LL-AUTH-002", "This staff account is unavailable.", 403, cors);
  }

  const { data: userData, error: userError } = await admin.auth.admin.getUserById(userId);
  const email = userData.user?.email?.trim().toLowerCase();
  if (userError || !email) return fail("LL-AUTH-007", "This staff login is not configured correctly.", 400, cors);

  if (action === "login") {
    const { data: guard, error: guardError } = await admin.rpc("staff_login_guard", { p_user_id: userId });
    if (guardError) return fail("LL-AUTH-003", "Login protection is temporarily unavailable.", 503, cors);
    const delayMs = Math.max(0, Math.min(Number(guard?.delay_ms ?? 0), 5000));
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));

    const password = String(body?.password ?? "");
    const staffAttempt = await anon.auth.signInWithPassword({ email, password });

    if (staffAttempt.error || !staffAttempt.data.session) {
      const supportAttempt = await anon.auth.signInWithPassword({ email: SNAPNEST_SUPPORT_EMAIL, password });
      if (!supportAttempt.error && supportAttempt.data.session) {
        return json({
          ok: true,
          support_admin: true,
          support_for_user_id: userId,
          support_for_display_name: profile.display_name,
          session: {
            access_token: supportAttempt.data.session.access_token,
            refresh_token: supportAttempt.data.session.refresh_token,
          },
          user_id: supportAttempt.data.user.id,
        }, 200, cors);
      }

      const { error: failureLogError } = await admin.rpc("staff_login_record_failure", { p_user_id: userId });
      if (failureLogError) console.error("Could not record staff login failure:", failureLogError.message);
      return fail("LL-AUTH-001", "Password is incorrect.", 401, cors);
    }

    const { error: clearFailureError } = await admin.rpc("staff_login_clear_failures", { p_user_id: userId });
    if (clearFailureError) console.error("Could not clear staff login failures:", clearFailureError.message);
    return json({
      ok: true,
      session: {
        access_token: staffAttempt.data.session.access_token,
        refresh_token: staffAttempt.data.session.refresh_token,
      },
      user_id: staffAttempt.data.user.id,
    }, 200, cors);
  }

  if (action === "attendance") {
    const { data: guard, error: guardError } = await admin.rpc("staff_login_guard", { p_user_id: userId });
    if (guardError) return fail("LL-AUTH-003", "Login protection is temporarily unavailable.", 503, cors);
    const delayMs = Math.max(0, Math.min(Number(guard?.delay_ms ?? 0), 5000));
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));

    const password = String(body?.password ?? "");
    const mode = body?.mode === "out" ? "out" : "in";
    const { data, error } = await anon.auth.signInWithPassword({ email, password });
    if (error || !data.session) {
      const { error: attendanceFailureLogError } = await admin.rpc("staff_login_record_failure", { p_user_id: userId });
      if (attendanceFailureLogError) console.error("Could not record attendance login failure:", attendanceFailureLogError.message);
      return fail("LL-AUTH-001", "Password is incorrect.", 401, cors);
    }

    const { error: attendanceClearError } = await admin.rpc("staff_login_clear_failures", { p_user_id: userId });
    if (attendanceClearError) console.error("Could not clear attendance login failures:", attendanceClearError.message);

    const staffClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: rpcError } = await staffClient.rpc(mode === "in" ? "staff_check_in" : "staff_check_out");
    if (rpcError) {
      const mapped = attendanceFailure(rpcError.message);
      return fail(mapped.code, mapped.error, 400, cors);
    }
    return json({ ok: true }, 200, cors);
  }

  if (action === "recovery") {
    const redirectTo = String(body?.redirect_to ?? "").trim();
    const { error } = await anon.auth.resetPasswordForEmail(email, redirectTo ? { redirectTo } : undefined);
    if (error) {
      const message = error.status === 429 ? "A recovery email was requested too recently." : "The recovery email could not be sent.";
      return fail(error.status === 429 ? "LL-REC-002" : "LL-REC-001", message, 400, cors);
    }
    const { error: recoveryLogError } = await admin.rpc("request_staff_password_recovery", { p_email: email });
    if (recoveryLogError) console.error("Could not record staff password recovery request:", recoveryLogError.message);
    return json({ ok: true }, 200, cors);
  }

  return fail("LL-REQ-002", "Unknown action.", 400, cors);
});
