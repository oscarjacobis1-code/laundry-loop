import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

type Role = "staff" | "manager" | "admin";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRole) return json({ error: "Server configuration is unavailable." }, 500);

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: "Authentication required." }, 401);

  const admin = createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: authData, error: authError } = await admin.auth.getUser(token);
  const caller = authData.user;
  if (authError || !caller) return json({ error: "Invalid session." }, 401);

  const { data: profile, error: profileError } = await admin
    .from("staff_profiles")
    .select("role,active")
    .eq("user_id", caller.id)
    .maybeSingle();

  if (profileError || !profile?.active || profile.role !== "admin") {
    return json({ error: "Administrator access required." }, 403);
  }

  const body = await req.json().catch(() => ({}));
  const action = String(body?.action ?? "");

  if (action === "list") {
    const { data: profiles, error } = await admin
      .from("staff_profiles")
      .select("user_id,display_name,role,active,created_at")
      .order("display_name");
    if (error) return json({ error: error.message }, 400);

    const team = await Promise.all((profiles ?? []).map(async (member) => {
      const { data } = await admin.auth.admin.getUserById(member.user_id);
      return {
        ...member,
        email: data.user?.email ?? "",
        last_sign_in_at: data.user?.last_sign_in_at ?? null,
      };
    }));
    return json({ team });
  }

  if (action === "create") {
    const email = String(body?.email ?? "").trim().toLowerCase();
    const displayName = String(body?.display_name ?? "").trim();
    const password = String(body?.password ?? "");
    const role = String(body?.role ?? "staff") as Role;
    if (!/^\S+@\S+\.\S+$/.test(email)) return json({ error: "Enter a valid email address." }, 400);
    if (displayName.length < 2 || displayName.length > 80) return json({ error: "Enter a valid staff name." }, 400);
    if (!["staff","manager","admin"].includes(role)) return json({ error: "Invalid role." }, 400);
    if (password.length < 10) return json({ error: "Temporary password must be at least 10 characters." }, 400);

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: displayName },
    });
    if (createError || !created.user) return json({ error: createError?.message ?? "Could not create login." }, 400);

    const { error: profileInsertError } = await admin.from("staff_profiles").insert({
      user_id: created.user.id,
      display_name: displayName,
      role,
      active: true,
    });

    if (profileInsertError) {
      await admin.auth.admin.deleteUser(created.user.id).catch(() => undefined);
      return json({ error: profileInsertError.message }, 400);
    }
    return json({ ok: true, user_id: created.user.id });
  }

  if (action === "update") {
    const userId = String(body?.user_id ?? "");
    const displayName = String(body?.display_name ?? "").trim();
    const role = String(body?.role ?? "") as Role;
    const active = Boolean(body?.active);
    if (!userId) return json({ error: "Staff account is required." }, 400);
    if (displayName.length < 2 || displayName.length > 80) return json({ error: "Enter a valid staff name." }, 400);
    if (!["staff","manager","admin"].includes(role)) return json({ error: "Invalid role." }, 400);
    if (userId === caller.id && (!active || role !== "admin")) {
      return json({ error: "You cannot remove your own administrator access." }, 400);
    }

    const { error: updateProfileError } = await admin
      .from("staff_profiles")
      .update({ display_name: displayName, role, active })
      .eq("user_id", userId);
    if (updateProfileError) return json({ error: updateProfileError.message }, 400);

    const { error: authUpdateError } = await admin.auth.admin.updateUserById(userId, {
      ban_duration: active ? "none" : "876000h",
      user_metadata: { display_name: displayName },
    });
    if (authUpdateError) return json({ error: authUpdateError.message }, 400);

    return json({ ok: true });
  }

  if (action === "set_password") {
    const userId = String(body?.user_id ?? "");
    const password = String(body?.password ?? "");
    if (!userId) return json({ error: "Staff account is required." }, 400);
    if (password.length < 10) return json({ error: "Password must be at least 10 characters." }, 400);
    const { error } = await admin.auth.admin.updateUserById(userId, { password });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  return json({ error: "Unknown action." }, 400);
});
