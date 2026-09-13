"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createPortalSupabase } from "./supabase";

export default function SupervisorServiceGate() {
  const supabase = useMemo(() => createPortalSupabase("staff"), []);
  const bypassOnce = useRef(false);
  const pendingButton = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!window.location.pathname.startsWith("/staff")) return;

    const onClick = (event: MouseEvent) => {
      if (bypassOnce.current) {
        bypassOnce.current = false;
        return;
      }

      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest<HTMLButtonElement>(".ops-sidebar nav button");
      if (!button) return;
      if ((button.textContent || "").toLowerCase().includes("services & pricing") === false) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      pendingButton.current = button;
      setPassword("");
      setError("");
      setOpen(true);
    };

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  async function unlock(event: FormEvent) {
    event.preventDefault();
    if (!password) return;
    setBusy(true);
    setError("");

    const { data: userResult } = await supabase.auth.getUser();
    const email = userResult.user?.email;
    if (!email) {
      setError("Your staff session could not be verified. Sign in again.");
      setBusy(false);
      return;
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      setError("Incorrect password.");
      setBusy(false);
      return;
    }

    const button = pendingButton.current;
    setOpen(false);
    setPassword("");
    setBusy(false);
    if (button) {
      bypassOnce.current = true;
      button.click();
    }
  }

  if (!open) return null;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, display: "grid", placeItems: "center", background: "rgba(5,11,29,.72)", padding: 20 }}>
      <form onSubmit={unlock} style={{ width: "min(100%, 390px)", background: "#fff", color: "#101827", borderRadius: 8, padding: 24, boxShadow: "0 24px 70px rgba(0,0,0,.35)", borderTop: "4px solid #b8a17b" }}>
        <p style={{ margin: "0 0 6px", fontSize: 11, fontWeight: 850, letterSpacing: ".13em", textTransform: "uppercase", color: "#8a671e" }}>Supervisor verification</p>
        <h2 style={{ margin: "0 0 8px" }}>Services & pricing</h2>
        <p style={{ margin: "0 0 18px", color: "#64748b", lineHeight: 1.5 }}>Enter your current Laundry Loop password to manage or add services.</p>
        <label style={{ display: "grid", gap: 7, fontWeight: 750 }}>
          Password
          <input autoFocus type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <p role="alert" style={{ margin: "12px 0 0", color: "#842f2f", fontWeight: 700 }}>{error}</p>}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 18 }}>
          <button type="button" onClick={() => { setOpen(false); setPassword(""); setError(""); pendingButton.current = null; }} style={{ background: "#edf1ee", color: "#07194f", border: "1px solid #d9e1ea" }}>Cancel</button>
          <button type="submit" disabled={busy}>{busy ? "Checking…" : "Unlock"}</button>
        </div>
      </form>
    </div>
  );
}
