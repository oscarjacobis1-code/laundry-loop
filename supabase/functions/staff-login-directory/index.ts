import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !serviceRole || !anonKey) return json({ error: "Server configuration is unavailable." }, 500);

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
    if (error) return json({ error: error.message }, 400);
    return json({ staff: data ?? [] });
  }

  const userId = String(body?.user_id ?? "");
  if (!userId) return json({ error: "Choose a staff member." }, 400);

  const { data: profile, error: profileError } = await admin
    .from("staff_profiles")
    .select("user_id,display_name,role,active")
    .eq("user_id", userId)
    .maybeSingle();
  if (profileError || !profile?.active || !["staff","manager"].includes(profile.role)) {
    return json({ error: "This staff account is unavailable." }, 403);
  }

  const { data: userData, error: userError } = await admin.auth.admin.getUserById(userId);
  const email = userData.user?.email?.trim().toLowerCase();
  if (userError || !email) return json({ error: "This staff login is not configured correctly." }, 400);

  if (action === "login") {
    const password = String(body?.password ?? "");
    const { data, error } = await anon.auth.signInWithPassword({ email, password });
    if (error || !data.session) return json({ error: "Password is incorrect." }, 401);
    return json({
      session: { access_token: data.session.access_token, refresh_token: data.session.refresh_token },
      user_id: data.user.id,
    });
  }

  if (action === "attendance") {
    const password = String(body?.password ?? "");
    const mode = body?.mode === "out" ? "out" : "in";
    const { data, error } = await anon.auth.signInWithPassword({ email, password });
    if (error || !data.session) return json({ error: "Password is incorrect." }, 401);

    const staffClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: rpcError } = await staffClient.rpc(mode === "in" ? "staff_check_in" : "staff_check_out");
    if (rpcError) return json({ error: rpcError.message }, 400);
    return json({ ok: true });
  }

  if (action === "recovery") {
    const redirectTo = String(body?.redirect_to ?? "").trim();
    const { error } = await anon.auth.resetPasswordForEmail(email, redirectTo ? { redirectTo } : undefined);
    if (error) return json({ error: error.status === 429 ? "A recovery email was requested too recently." : error.message }, 400);
    await admin.rpc("request_staff_password_recovery", { p_email: email }).catch(() => undefined);
    return json({ ok: true });
  }

  return json({ error: "Unknown action." }, 400);
});
