import fs from "node:fs";

const path = "app/portal/Portal.tsx";
let source = fs.readFileSync(path, "utf8");

if (source.includes("LL_OFFLINE_POS_PATCH")) {
  console.log("Offline POS patch already applied.");
  process.exit(0);
}

function replaceOnce(from, to, label) {
  if (!source.includes(from)) throw new Error("Could not find " + label);
  source = source.replace(from, to);
}

replaceOnce(
  'import { createPortalSupabase } from "./supabase";',
  'import { createPortalSupabase } from "./supabase";\nimport AndroidPrintBridge from "./AndroidPrintBridge";\nimport { cacheOrders, cacheProfile, cacheServices, createOfflineTrackingCode, isLaundryLoopApp, queuedOfflineCount, queueOfflineOrder, readCachedOrders, readCachedProfile, readCachedServices, readQueuedOfflineOrders, registerOfflineWorker, removeQueuedOfflineOrder } from "./offline";\n// LL_OFFLINE_POS_PATCH',
  "offline imports",
);

replaceOnce(
  '  const [subscriptionFilter, setSubscriptionFilter] = useState("Pending");',
  '  const [subscriptionFilter, setSubscriptionFilter] = useState("Pending");\n  const [pendingOffline, setPendingOffline] = useState(0);\n  const [isOnline, setIsOnline] = useState(true);',
  "offline state",
);

replaceOnce(
  '    if (orderResult.error) setMessage(orderResult.error.message);\n    setOrders((orderResult.data as Order[]) ?? []);\n    const loadedServices = (serviceResult.data as Service[]) ?? [];\n    setServices(loadedServices);',
  '    if (orderResult.error && !orderResult.data) setMessage(orderResult.error.message);\n    const loadedOrders = (orderResult.data as Order[]) ?? [];\n    const loadedServices = (serviceResult.data as Service[]) ?? [];\n    if (loadedOrders.length) { setOrders(loadedOrders); cacheOrders(loadedOrders as unknown as Record<string, unknown>[]); }\n    else if (!navigator.onLine) setOrders(readCachedOrders() as unknown as Order[]);\n    if (loadedServices.length) { setServices(loadedServices); cacheServices(loadedServices); }\n    else if (!navigator.onLine) setServices(readCachedServices() as Service[]);',
  "dashboard offline cache",
);

replaceOnce(
  '    setProfile(data as Profile); setMessage("");',
  '    setProfile(data as Profile); cacheProfile(portal, data as Profile); setMessage("");',
  "profile cache",
);

const authEffect = [
'  useEffect(() => {',
'    supabase.auth.getSession().then(async ({ data }) => { if (data.session) await validateRole(data.session.user.id); setBusy(false); });',
'    const { data: listener } = supabase.auth.onAuthStateChange((event) => {',
'      if (event === "PASSWORD_RECOVERY") setRecovery(true);',
'      if (event === "SIGNED_OUT") setProfile(null);',
'    });',
'    return () => listener.subscription.unsubscribe();',
'  }, [supabase, validateRole]);'
].join("\n");

const offlineAuthEffect = [
'  useEffect(() => {',
'    registerOfflineWorker();',
'    const refreshConnection = () => {',
'      const online = navigator.onLine;',
'      setIsOnline(online);',
'      setPendingOffline(queuedOfflineCount());',
'    };',
'    refreshConnection();',
'    window.addEventListener("online", refreshConnection);',
'    window.addEventListener("offline", refreshConnection);',
'',
'    if (portal === "staff" && isLaundryLoopApp() && !navigator.onLine) {',
'      const cached = readCachedProfile(portal) as Profile | null;',
'      if (cached) {',
'        setProfile(cached);',
'        setServices(readCachedServices() as Service[]);',
'        setOrders(readCachedOrders() as unknown as Order[]);',
'        setMessage("Offline mode: orders can still be taken and printed. Cloud changes will sync when internet returns.");',
'        setBusy(false);',
'      }',
'    }',
'',
'    return () => {',
'      window.removeEventListener("online", refreshConnection);',
'      window.removeEventListener("offline", refreshConnection);',
'    };',
'  }, [portal]);',
'',
'  useEffect(() => {',
'    if (portal === "staff" && isLaundryLoopApp() && !navigator.onLine && readCachedProfile(portal)) return;',
'    supabase.auth.getSession().then(async ({ data }) => { if (data.session) await validateRole(data.session.user.id); setBusy(false); });',
'    const { data: listener } = supabase.auth.onAuthStateChange((event) => {',
'      if (event === "PASSWORD_RECOVERY") setRecovery(true);',
'      if (event === "SIGNED_OUT") setProfile(null);',
'    });',
'    return () => listener.subscription.unsubscribe();',
'  }, [portal, supabase, validateRole]);'
].join("\n");

replaceOnce(authEffect, offlineAuthEffect, "auth effect");

replaceOnce(
  '    if (portal !== "staff") return;\n    const timer = window.setTimeout(() => void loadStaffDirectory(), 0);',
  '    if (portal !== "staff" || !navigator.onLine) return;\n    const timer = window.setTimeout(() => void loadStaffDirectory(), 0);',
  "offline staff directory",
);

const insertBeforeValidate = '  const validateRole = useCallback(async (userId: string) => {';
const syncBlock = [
'  const syncQueuedOfflineOrders = useCallback(async () => {',
'    if (!profile || !navigator.onLine) return;',
'    const queue = readQueuedOfflineOrders();',
'    if (!queue.length) { setPendingOffline(0); return; }',
'',
'    let synced = 0;',
'    for (const item of queue) {',
'      const { error } = await supabase.rpc("staff_sync_offline_order", {',
'        p_client_tracking_code: item.trackingCode,',
'        p_name: item.name,',
'        p_phone: item.phone,',
'        p_items: item.items,',
'        p_notes: item.notes,',
'        p_payment: item.payment,',
'        p_discount_gyd: item.discount,',
'        p_original_transaction_at: item.createdAt,',
'        p_express: item.express,',
'      });',
'      if (error) break;',
'      removeQueuedOfflineOrder(item.trackingCode);',
'      synced += 1;',
'    }',
'',
'    setPendingOffline(queuedOfflineCount());',
'    if (synced > 0) {',
'      await loadDashboard(profile.role);',
'      setMessage(String(synced) + " offline order" + (synced === 1 ? "" : "s") + " synced to Laundry Loop cloud records.");',
'    }',
'  }, [loadDashboard, profile, supabase]);',
'',
'  useEffect(() => {',
'    if (!profile) return;',
'    const onOnline = () => void syncQueuedOfflineOrders();',
'    window.addEventListener("online", onOnline);',
'    if (navigator.onLine && queuedOfflineCount() > 0) void syncQueuedOfflineOrders();',
'    return () => window.removeEventListener("online", onOnline);',
'  }, [profile, syncQueuedOfflineOrders]);',
'',
].join("\n");

replaceOnce(insertBeforeValidate, syncBlock + insertBeforeValidate, "offline sync block");

const submitMarker = '  async function submitPos(event: FormEvent) {';
const helper = [
'  function saveCurrentPosOffline(items: Array<{ service: Service; qty: number }>, trackingCode = createOfflineTrackingCode(), createdAt = new Date().toISOString(), present = true) {',
'    const orderItems: OrderItem[] = items.map(({ service, qty }) => ({',
'      service_id: service.id,',
'      label: service.name,',
'      category: service.category,',
'      rate: Number(service.rate),',
'      unit: service.unit,',
'      qty,',
'      total: Math.round(Number(service.rate) * qty * 100) / 100,',
'    }));',
'    const totalWeight = orderItems.filter((item) => item.unit.toLowerCase() === "lb").reduce((sum, item) => sum + item.qty, 0);',
'    const payment: Payment = {',
'      method: pos.paymentMethod,',
'      status: pos.paymentMethod === "Cash" ? "Paid" : pos.paymentStatus,',
'      reference: pos.paymentReference.trim() || undefined,',
'      ...(pos.paymentMethod === "Cash" ? { cash_received: cashReceived, change_due: changeDue } : {}),',
'    };',
'    const localOrder: Order = {',
'      id: "offline:" + trackingCode,',
'      tracking_code: trackingCode,',
'      customer_name: pos.name.trim(),',
'      customer_phone: phoneDigits(pos.phone),',
'      items: orderItems,',
'      weight_summary: totalWeight > 0 ? String(totalWeight) + " lbs" : String(orderItems.length) + " service(s)",',
'      subtotal: posSubtotal,',
'      discount: posDiscount,',
'      total: posTotal,',
'      status: "Received",',
'      notes: pos.notes.trim(),',
'      order_type: "In-Store Walk-In POS",',
'      scheduled_date: createdAt.slice(0, 10),',
'      payment,',
'      express: pos.express,',
'      express_fee: expressFee,',
'      created_at: createdAt,',
'      entry_source: "offline_pending",',
'      original_transaction_at: createdAt,',
'      paper_reference: trackingCode,',
'    };',
'',
'    queueOfflineOrder({',
'      trackingCode,',
'      createdAt,',
'      name: localOrder.customer_name,',
'      phone: localOrder.customer_phone,',
'      items: items.map(({ service, qty }) => ({ label: service.name, qty })),',
'      notes: localOrder.notes,',
'      payment: payment as Record<string, unknown>,',
'      discount: posDiscount,',
'      express: pos.express,',
'      localOrder: localOrder as unknown as Record<string, unknown>,',
'    });',
'',
'    setPendingOffline(queuedOfflineCount());',
'    if (!present) return localOrder;',
'',
'    setOrders((current) => {',
'      const withoutDuplicate = current.filter((order) => order.tracking_code !== trackingCode);',
'      const next = [localOrder, ...withoutDuplicate];',
'      cacheOrders(next as unknown as Record<string, unknown>[]);',
'      return next;',
'    });',
'    const firstActive = services.find((service) => service.active);',
'    const defaultPosService = services.find((service) => service.active && service.name.trim().toLowerCase() === "regular laundry") ?? firstActive;',
'    setPos(emptyPos);',
'    setPosItems([{ service_id: defaultPosService?.id ?? "", qty: 1 }]);',
'    setSelectedOrder(localOrder);',
'    setView("orders");',
'    setMessage("Order " + trackingCode + " saved OFFLINE. Receipt is ready to print; it will sync automatically when internet returns.");',
'    return localOrder;',
'  }',
'',
].join("\n");

replaceOnce(submitMarker, helper + submitMarker, "offline order helper");

const rpcStart = '    const { data, error } = await supabase.rpc("staff_create_order", {';
const idempotentRpc = [
'    const appTrackingCode = isLaundryLoopApp() ? createOfflineTrackingCode() : null;',
'    const appCreatedAt = new Date().toISOString();',
'    if (appTrackingCode) saveCurrentPosOffline(items as Array<{ service: Service; qty: number }>, appTrackingCode, appCreatedAt, false);',
'    if (!navigator.onLine) {',
'      saveCurrentPosOffline(items as Array<{ service: Service; qty: number }>, appTrackingCode ?? createOfflineTrackingCode(), appCreatedAt, true);',
'      setBusy(false); posSubmitLock.current = false; return;',
'    }',
'    const { data, error } = appTrackingCode',
'      ? await supabase.rpc("staff_sync_offline_order", {',
'          p_client_tracking_code: appTrackingCode,',
'          p_name: pos.name.trim(),',
'          p_phone: phoneDigits(pos.phone),',
'          p_items: items.map((row) => ({ label: row.service!.name, qty: row.qty })),',
'          p_notes: pos.notes.trim(),',
'          p_payment: { method: pos.paymentMethod, status: pos.paymentStatus, reference: pos.paymentReference.trim() || null, express: pos.express, ...(pos.paymentMethod === "Cash" ? { cash_received: cashReceived, change_due: changeDue } : {}) },',
'          p_discount_gyd: profile?.role === "staff" ? 0 : posDiscount,',
'          p_original_transaction_at: appCreatedAt,',
'          p_express: pos.express,',
'        })',
'      : await supabase.rpc("staff_create_order", {',
].join("\n");

replaceOnce(rpcStart, idempotentRpc, "idempotent APK order RPC");

replaceOnce(
  '    if (error) setPosMessage(`The order was not saved: ${error.message}`);\n    else {',
  [
'    if (error && appTrackingCode && /fetch|network|connection|offline/i.test(error.message || "")) {',
'      saveCurrentPosOffline(items as Array<{ service: Service; qty: number }>, appTrackingCode, appCreatedAt, true);',
'    } else if (error) {',
'      if (appTrackingCode) removeQueuedOfflineOrder(appTrackingCode);',
'      setPendingOffline(queuedOfflineCount());',
'      setPosMessage("The order was not saved: " + error.message);',
'    } else {',
'      if (appTrackingCode) removeQueuedOfflineOrder(appTrackingCode);',
'      setPendingOffline(queuedOfflineCount());'
  ].join("\n"),
  "idempotent network failure fallback",
);

replaceOnce(
  '<span className="live-dot">Secure · Live</span>',
  '<span className={isOnline ? "live-dot" : "live-dot offline"}>{isOnline ? "Secure · Live" : "Offline · " + pendingOffline + " pending"}</span>',
  "connection indicator",
);

replaceOnce(
  '  </main>;\n}',
  '    {portal === "staff" && <AndroidPrintBridge/>}\n  </main>;\n}',
  "native print bridge mount",
);

fs.writeFileSync(path, source);
console.log("Applied Laundry Loop offline-first POS patch.");
