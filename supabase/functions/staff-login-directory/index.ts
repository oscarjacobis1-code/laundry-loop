import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const allowedOrigins = new Set([
  "https://thelaundryloop.net",
  "https://www.thelaundryloop.net",
]);

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

Deno.serve(async (req) => {
  const cors = corsFor(req);
  if (!cors) return new Response(JSON.stringify({ error: "Origin not allowed" }), { status: 403, headers: { "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, cors);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !serviceRole || !anonKey) return json({ error: "Server configuration is unavailable." }, 500, cors);

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
    if (error) return json({ error: error.message }, 400, cors);
    return json({ staff: data ?? [] }, 200, cors);
  }

  const userId = String(body?.user_id ?? "");
  if (!userId) return json({ error: "Choose a staff member." }, 400, cors);

  const { data: profile, error: profileError } = await admin
    .from("staff_profiles")
    .select("user_id,display_name,role,active")
    .eq("user_id", userId)
    .maybeSingle();
  if (profileError || !profile?.active || !["staff","manager"].includes(profile.role)) {
    return json({ error: "This staff account is unavailable." }, 403, cors);
  }

  const { data: userData, error: userError } = await admin.auth.admin.getUserById(userId);
  const email = userData.user?.email?.trim().toLowerCase();
  if (userError || !email) return json({ error: "This staff login is not configured correctly." }, 400, cors);

  if (action === "login") {
    const { data: guard, error: guardError } = await admin.rpc("staff_login_guard", { p_user_id: userId });
    if (guardError) return json({ error: "Login protection is temporarily unavailable." }, 503, cors);
    const delayMs = Math.max(0, Math.min(Number(guard?.delay_ms ?? 0), 5000));
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));

    const password = String(body?.password ?? "");
    const { data, error } = await anon.auth.signInWithPassword({ email, password });
    if (error || !data.session) {
      await admin.rpc("staff_login_record_failure", { p_user_id: userId }).catch(() => undefined);
      return json({ error: "Password is incorrect." }, 401, cors);
    }
    await admin.rpc("staff_login_clear_failures", { p_user_id: userId }).catch(() => undefined);
    return json({
      session: { access_token: data.session.access_token, refresh_token: data.session.refresh_token },
      user_id: data.user.id,
    }, 200, cors);
  }

  if (action === "attendance") {
    const { data: guard, error: guardError } = await admin.rpc("staff_login_guard", { p_user_id: userId });
    if (guardError) return json({ error: "Login protection is temporarily unavailable." }, 503, cors);
    const delayMs = Math.max(0, Math.min(Number(guard?.delay_ms ?? 0), 5000));
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));

    const password = String(body?.password ?? "");
    const mode = body?.mode === "out" ? "out" : "in";
    const { data, error } = await anon.auth.signInWithPassword({ email, password });
    if (error || !data.session) {
      await admin.rpc("staff_login_record_failure", { p_user_id: userId }).catch(() => undefined);
      return json({ error: "Password is incorrect." }, 401, cors);
    }
    await admin.rpc("staff_login_clear_failures", { p_user_id: userId }).catch(() => undefined);

    const staffClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: rpcError } = await staffClient.rpc(mode === "in" ? "staff_check_in" : "staff_check_out");
    if (rpcError) return json({ error: rpcError.message }, 400, cors);
    return json({ ok: true }, 200, cors);
  }

  if (action === "recovery") {
    const redirectTo = String(body?.redirect_to ?? "").trim();
    const { error } = await anon.auth.resetPasswordForEmail(email, redirectTo ? { redirectTo } : undefined);
    if (error) return json({ error: error.status === 429 ? "A recovery email was requested too recently." : error.message }, 400, cors);
    await admin.rpc("request_staff_password_recovery", { p_email: email }).catch(() => undefined);
    return json({ ok: true }, 200, cors);
  }

  return json({ error: "Unknown action." }, 400, cors);
});
