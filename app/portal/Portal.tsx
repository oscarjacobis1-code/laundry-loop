"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createPortalSupabase, runAttendanceAction } from "./supabase";
import "./portal.css";

type PortalKind = "admin" | "staff";
type Role = "staff" | "manager" | "admin";
type Profile = { user_id: string; display_name: string; role: Role; active?: boolean };
type Service = { id: string; name: string; category: string; rate: number; unit: string; active: boolean };
type Payment = { method?: string; status?: string; reference?: string; discount?: number };
type OrderItem = { service_id?: string; label: string; category?: string; rate: number; unit: string; qty: number; total: number };
type Order = {
  id: string; tracking_code: string; customer_name: string; customer_phone: string; items: OrderItem[];
  weight_summary: string; subtotal?: number; discount?: number; total: number; status: string; notes: string;
  order_type: string; scheduled_date?: string | null; scale_photo_path?: string | null; payment: Payment; created_at: string;
  entry_source?: string; original_transaction_at?: string | null; paper_reference?: string | null;
};
type Attendance = { id:string; staff_user_id:string; check_in_at:string; check_out_at:string|null };
type AccessSession = { id:string; staff_user_id:string; login_at:string; logout_at:string|null; last_activity_at:string };
type Inventory = {
  item_id: string; item_name: string; unit: string; on_hand: number; reorder_level: number;
  average_daily_usage_30: number; estimated_days_remaining: number | null; recommendation: string;
};
type Alert = { id: string; requester_email: string; created_at: string; resolved_at: string | null };
type Summary = { period_days: number; orders: number; revenue: number; average_order_value: number; repeat_customers: number; busiest_hour: number | null; average_hours_to_ready: number | null };
type Subscription = { subscription_id:string; tracking_code:string; customer_name:string; customer_phone:string; subscription_status:string; payment_status:string; payment_method:string; weekly_pounds:number; extra_pounds:number; credit_balance:number; starts_at:string|null; ends_at:string|null; created_at:string };
type View = "orders" | "pos" | "paper" | "inventory" | "operations" | "content" | "services" | "team" | "security";
type DiscountMode = "amount" | "percent";
type PosState = { name: string; phone: string; notes: string; paymentMethod: "Cash" | "MMG"; paymentStatus: string; paymentReference: string; discountMode: DiscountMode; discountValue: string };
type SiteContent = {
  id: boolean; business_name: string; tagline: string; hero_eyebrow: string; hero_title: string; hero_emphasis: string;
  hero_description: string; address: string; directions: string; maps_url: string; phone: string; mmg_number: string;
  mmg_name: string; estimate_disclaimer: string;
  loop_credit_options: Array<{ id: string; credits: number; pounds: number; price: number }>;
};

const statuses = ["Received", "Washing", "Drying", "Ready for Pick-Up", "Picked Up (Archived)", "Cancelled/Refunded"];
const paymentStatuses = ["Pay at Pickup", "Pending Confirmation", "Paid", "Refunded"];
const emptyPos: PosState = { name: "", phone: "", notes: "", paymentMethod: "Cash", paymentStatus: "Pay at Pickup", paymentReference: "", discountMode: "amount", discountValue: "" };
const money = (value: number | string | null | undefined) => `GYD ${Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const phoneDigits = (value: string) => {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 7) return `592${digits}`;
  if (digits.length === 8 && digits.startsWith("0")) return `592${digits.slice(1)}`;
  return digits;
};
const validPhone = (value: string) => /^\d{10,15}$/.test(phoneDigits(value));
const dateTime = (value: string) => new Date(value).toLocaleString("en-GY", { dateStyle: "medium", timeStyle: "short" });

export default function Portal({ portal }: { portal: PortalKind }) {
  const supabase = useMemo(() => createPortalSupabase(portal), [portal]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [attendancePassword, setAttendancePassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [recovery, setRecovery] = useState(false);
  const [recoveryRequested, setRecoveryRequested] = useState(false);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");
  const [view, setView] = useState<View>("orders");
  const [menuOpen, setMenuOpen] = useState(false);
  const [orders, setOrders] = useState<Order[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [inventory, setInventory] = useState<Inventory[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [team, setTeam] = useState<Profile[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("Active");
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [pos, setPos] = useState(emptyPos);
  const [posItems, setPosItems] = useState<Array<{ service_id: string; qty: number }>>([{ service_id: "", qty: 1 }]);
  const [inventoryForm, setInventoryForm] = useState({ itemId: "", type: "restock", quantity: "", unitCost: "", note: "" });
  const [inventoryItemForm, setInventoryItemForm] = useState({ name: "", unit: "", reorderLevel: "", openingStock: "" });
  const [identity, setIdentity] = useState<"affia" | "staff" | "">("");
  const [attendanceMode, setAttendanceMode] = useState<"in"|"out">("in");
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [accessSessions, setAccessSessions] = useState<AccessSession[]>([]);
  const [paper, setPaper] = useState({ originalAt:"", reference:"", name:"", phone:"", notes:"", paymentMethod:"Cash", paymentStatus:"Pay at Pickup" });
  const [paperItems, setPaperItems] = useState<Array<{service_id:string;qty:number}>>([{service_id:"",qty:1}]);
  const [orderAction, setOrderAction] = useState<{ order: Order; type: "cancel" | "refund" } | null>(null);
  const [orderActionReason, setOrderActionReason] = useState("");
  const [posMessage, setPosMessage] = useState("");
  const [printMode, setPrintMode] = useState<"receipt" | "tag">("receipt");
  const [siteContent, setSiteContent] = useState<SiteContent | null>(null);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [subscriptionFilter, setSubscriptionFilter] = useState("Pending");

  const isAdmin = profile?.role === "admin";

  const loadDashboard = useCallback(async () => {
    const [orderResult, serviceResult, inventoryResult, summaryResult, subscriptionResult] = await Promise.all([
      supabase.from("orders").select("id,tracking_code,customer_name,customer_phone,items,weight_summary,subtotal,discount,total,status,notes,order_type,scheduled_date,scale_photo_path,payment,created_at,entry_source,original_transaction_at,paper_reference").order("created_at", { ascending: false }).limit(500),
      supabase.from("service_catalog").select("id,name,category,rate,unit,active").order("category").order("name"),
      supabase.rpc("staff_inventory_summary"),
      supabase.rpc("staff_operations_summary", { p_days: 30 }),
      supabase.rpc("staff_subscription_summary"),
    ]);
    if (orderResult.error) setMessage(orderResult.error.message);
    setOrders((orderResult.data as Order[]) ?? []);
    const loadedServices = (serviceResult.data as Service[]) ?? [];
    setServices(loadedServices);
    const firstActive = loadedServices.find((service) => service.active);
    if (firstActive) {
      setPosItems((rows) => rows.map((row, index) => index === 0 && !row.service_id ? { ...row, service_id: firstActive.id } : row));
      setPaperItems((rows) => rows.map((row, index) => index === 0 && !row.service_id ? { ...row, service_id: firstActive.id } : row));
    }
    setInventory((inventoryResult.data as Inventory[]) ?? []);
    setSummary((summaryResult.data as Summary) ?? null);
    setSubscriptions((subscriptionResult.data as Subscription[]) ?? []);
  }, [supabase]);

  const loadAdmin = useCallback(async () => {
    const weekStart = new Date(); weekStart.setDate(weekStart.getDate()-7);
    const [alertResult, teamResult, attendanceResult, accessResult, contentResult] = await Promise.all([
      supabase.from("staff_security_alerts").select("id,requester_email,created_at,resolved_at").order("created_at", { ascending: false }).limit(100),
      supabase.from("staff_profiles").select("user_id,display_name,role,active").order("display_name"),
      supabase.from("staff_attendance").select("id,staff_user_id,check_in_at,check_out_at").gte("check_in_at",weekStart.toISOString()).order("check_in_at",{ascending:false}),
      supabase.from("staff_access_sessions").select("id,staff_user_id,login_at,logout_at,last_activity_at").gte("login_at",weekStart.toISOString()).order("login_at",{ascending:false}),
      supabase.from("site_content").select("id,business_name,tagline,hero_eyebrow,hero_title,hero_emphasis,hero_description,address,directions,maps_url,phone,mmg_number,mmg_name,estimate_disclaimer,loop_credit_options").eq("id",true).single(),
    ]);
    setAlerts((alertResult.data as Alert[]) ?? []);
    setTeam((teamResult.data as Profile[]) ?? []);
    setAttendance((attendanceResult.data as Attendance[]) ?? []);
    setAccessSessions((accessResult.data as AccessSession[]) ?? []);
    if (!contentResult.error) setSiteContent(contentResult.data as SiteContent);
  }, [supabase]);

  const validateRole = useCallback(async (userId: string) => {
    const { data, error } = await supabase.from("staff_profiles").select("user_id,display_name,role,active").eq("user_id", userId).eq("active", true).maybeSingle();
    if (error) {
      setMessage("We could not verify this account right now. Check the connection and try again."); setProfile(null); return false;
    }
    if (!data) {
      await supabase.auth.signOut({ scope: "local" }); setMessage("This account is not authorized for Laundry Loop operations."); setProfile(null); return false;
    }
    const allowed = portal === "admin" ? data.role === "admin" : data.role === "staff" || data.role === "manager";
    if (!allowed) {
      await supabase.auth.signOut({ scope: "local" });
      setMessage(portal === "admin" ? "Staff accounts must sign in at /staff." : "Administrator accounts must sign in at /admin.");
      setProfile(null); return false;
    }
    setProfile(data as Profile); setMessage("");
    if (portal === "staff") {
      let sessionId=sessionStorage.getItem("ll-access-session");
      if(!sessionId){sessionId=crypto.randomUUID();sessionStorage.setItem("ll-access-session",sessionId);}
      await supabase.rpc("staff_access_login",{p_session_id:sessionId});
    }
    await loadDashboard();
    if (data.role === "admin") await loadAdmin();
    return true;
  }, [portal, loadAdmin, loadDashboard, supabase]);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => { if (data.session) await validateRole(data.session.user.id); setBusy(false); });
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
      if (event === "SIGNED_OUT") setProfile(null);
    });
    return () => listener.subscription.unsubscribe();
  }, [supabase, validateRole]);

  useEffect(()=>{
    if(!profile||portal!=="staff")return;
    const timer=window.setInterval(()=>{const id=sessionStorage.getItem("ll-access-session");if(id)void supabase.rpc("staff_access_heartbeat",{p_session_id:id});},300000);
    return()=>window.clearInterval(timer);
  },[profile,portal,supabase]);

  useEffect(()=>{
    if(!profile)return;
    const idleMs=20*60*1000;
    let timer:number;
    const expire=async()=>{
      const sessionId=sessionStorage.getItem("ll-access-session");
      if(sessionId)await supabase.rpc("staff_access_logout",{p_session_id:sessionId});
      sessionStorage.removeItem("ll-access-session");
      await supabase.auth.signOut({scope:"local"});
      setPassword("");setAttendancePassword("");setEmail("");setProfile(null);setMessage("You were signed out after 20 minutes of inactivity.");
    };
    const reset=()=>{window.clearTimeout(timer);timer=window.setTimeout(()=>void expire(),idleMs);};
    ["pointerdown","keydown","touchstart","scroll"].forEach(event=>window.addEventListener(event,reset,{passive:true}));
    reset();
    return()=>{window.clearTimeout(timer);["pointerdown","keydown","touchstart","scroll"].forEach(event=>window.removeEventListener(event,reset));};
  },[profile,supabase]);

  const filteredOrders = useMemo(() => orders.filter((order) => {
    const q = search.toLowerCase().trim();
    const matchesSearch = !q || order.tracking_code.toLowerCase().includes(q) || order.customer_name.toLowerCase().includes(q) || order.customer_phone.includes(q);
    const matchesStatus = statusFilter === "All" || (statusFilter === "Active" ? !["Picked Up (Archived)", "Cancelled/Refunded"].includes(order.status) : order.status === statusFilter);
    return matchesSearch && matchesStatus;
  }), [orders, search, statusFilter]);

  const posSubtotal = useMemo(() => posItems.reduce((sum, row) => {
    const service = services.find((item) => item.id === row.service_id); return sum + (service ? Number(service.rate) * Number(row.qty || 0) : 0);
  }, 0), [posItems, services]);
  const posDiscount = useMemo(() => {
    if (profile?.role === "staff") return 0;
    const entered = Math.max(0, Number(pos.discountValue || 0));
    const calculated = pos.discountMode === "percent" ? posSubtotal * Math.min(entered, 100) / 100 : entered;
    return Math.min(posSubtotal, Math.round(calculated * 100) / 100);
  }, [pos.discountMode, pos.discountValue, posSubtotal, profile?.role]);
  const posTotal = Math.max(0, posSubtotal - posDiscount);

  async function signIn(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) setMessage("Email or password is incorrect."); else if (data.user) { setPassword(""); await validateRole(data.user.id); }
    setBusy(false);
  }

  async function forgotPassword() {
    if (!email.trim()) { setMessage("Enter your email first, then select Forgot password."); return; }
    setBusy(true); setMessage("");
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/${portal}` });
    if (portal === "staff") await supabase.rpc("request_staff_password_recovery", { p_email: email.trim() });
    if (error) setMessage(error.status === 429 ? "A recovery email was requested too recently. Wait about 60 seconds, then use only the newest link. If delivery still fails, contact the administrator." : "The recovery email could not be sent right now. Please try again later.");
    else { setRecoveryRequested(true); window.setTimeout(()=>setRecoveryRequested(false),60000); setMessage("If this account is authorized, a password reset email is on its way. Use only the newest link; each link works once."); }
    setBusy(false);
  }

  async function attendanceAction(event:FormEvent){
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      await runAttendanceAction(email.trim(), attendancePassword, attendanceMode);
      setMessage(`${identity==="affia"?"Affia":"In-store Staff"} checked ${attendanceMode} at ${new Date().toLocaleTimeString()}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The attendance request could not be completed.");
    } finally {
      setAttendancePassword(""); setBusy(false);
    }
  }

  async function signOut(){
    const sessionId=sessionStorage.getItem("ll-access-session");
    if(sessionId) await supabase.rpc("staff_access_logout",{p_session_id:sessionId});
    sessionStorage.removeItem("ll-access-session"); await supabase.auth.signOut({ scope: "local" });
    setPassword(""); setAttendancePassword(""); setNewPassword(""); setEmail(""); setProfile(null);
  }

  async function savePassword(event: FormEvent) {
    event.preventDefault();
    if (newPassword.length < 10) { setMessage("Use at least 10 characters for the new password."); return; }
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) setMessage(error.message); else { setRecovery(false); setNewPassword(""); setMessage("Password updated. You can continue securely."); }
  }

  async function patchOrder(order: Order, patch: { status?: string; paymentStatus?: string; discount?: number; notes?: string }) {
    setBusy(true); setMessage("");
    const { error } = await supabase.rpc("staff_update_order", {
      p_order_id: order.id, p_status: patch.status ?? null, p_payment_status: patch.paymentStatus ?? null,
      p_discount_gyd: patch.discount ?? null, p_notes: patch.notes ?? null,
    });
    if (error) setMessage(error.message); else await loadDashboard();
    setBusy(false);
  }

  async function submitPos(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage(""); setPosMessage("");
    if (pos.name.trim().length < 2) { setPosMessage("Enter the customer's full name."); setBusy(false); return; }
    if (!validPhone(pos.phone)) { setPosMessage("Enter a valid 7-digit Guyana number or a full international number."); setBusy(false); return; }
    const items = posItems.map((row) => ({ service: services.find((item) => item.id === row.service_id), qty: Number(row.qty) })).filter((row) => row.service && row.qty > 0);
    if (!items.length) { setPosMessage("Choose at least one laundry service and enter a quantity."); setBusy(false); return; }
    if (pos.paymentMethod === "MMG" && !pos.paymentReference.trim()) { setPosMessage("Enter the MMG transaction reference so the payment can be verified."); setBusy(false); return; }
    const enteredDiscount = Number(pos.discountValue || 0);
    if (profile?.role !== "staff" && (!Number.isFinite(enteredDiscount) || enteredDiscount < 0 || (pos.discountMode === "percent" && enteredDiscount > 100) || posDiscount > posSubtotal)) {
      setPosMessage(pos.discountMode === "percent" ? "Enter a percentage from 0 to 100." : "The discount cannot exceed the subtotal."); setBusy(false); return;
    }
    const { data, error } = await supabase.rpc("staff_create_order", {
      p_name: pos.name.trim(), p_phone: phoneDigits(pos.phone),
      p_items: items.map((row) => ({ label: row.service!.name, qty: row.qty })), p_notes: pos.notes.trim(),
      p_payment: { method: pos.paymentMethod, status: pos.paymentStatus, reference: pos.paymentReference.trim() || null },
      p_discount_gyd: profile?.role === "staff" ? 0 : posDiscount,
    });
    if (error) setPosMessage(`The order was not saved: ${error.message}`);
    else {
      const firstActive = services.find((service) => service.active);
      setPos(emptyPos); setPosItems([{ service_id: firstActive?.id ?? "", qty: 1 }]); await loadDashboard();
      const saved = data as Order; setSelectedOrder(saved); setView("orders"); setMessage(`Order ${saved.tracking_code} created. Receipt is ready to print.`);
    }
    setBusy(false);
  }

  async function submitPaper(event:FormEvent){
    event.preventDefault();setBusy(true);setMessage("");
    if(!validPhone(paper.phone)){setMessage("Enter a valid 7-digit Guyana number or a full international number.");setBusy(false);return;}
    const items=paperItems.map(row=>({service:services.find(s=>s.id===row.service_id),qty:Number(row.qty)})).filter(row=>row.service&&row.qty>0);
    if(!items.length){setMessage("Add at least one laundry service.");setBusy(false);return;}
    const {data,error}=await supabase.rpc("staff_create_recovered_order",{p_name:paper.name.trim(),p_phone:phoneDigits(paper.phone),p_items:items.map(row=>({label:row.service!.name,qty:row.qty})),p_notes:paper.notes.trim(),p_payment:{method:paper.paymentMethod,status:paper.paymentStatus},p_original_transaction_at:new Date(paper.originalAt).toISOString(),p_paper_reference:paper.reference.trim()});
    if(error)setMessage(error.message);else{setPaper({originalAt:"",reference:"",name:"",phone:"",notes:"",paymentMethod:"Cash",paymentStatus:"Pay at Pickup"});setPaperItems([{service_id:services[0]?.id??"",qty:1}]);await loadDashboard();setSelectedOrder(data as Order);setView("orders");setMessage("Paper order entered. Original and entry times were both preserved.");}setBusy(false);
  }

  async function submitInventory(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    const { error } = await supabase.rpc("staff_record_inventory_movement", {
      p_inventory_item_id: inventoryForm.itemId, p_movement_type: inventoryForm.type,
      p_quantity: Number(inventoryForm.quantity), p_unit_cost: inventoryForm.unitCost ? Number(inventoryForm.unitCost) : null, p_note: inventoryForm.note,
    });
    if (error) setMessage(error.message); else { setInventoryForm({ itemId: "", type: "restock", quantity: "", unitCost: "", note: "" }); await loadDashboard(); setMessage("Inventory movement recorded."); }
    setBusy(false);
  }

  async function createInventoryItem(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    const reorderLevel = Number(inventoryItemForm.reorderLevel || 0);
    const openingStock = Number(inventoryItemForm.openingStock || 0);
    if (inventoryItemForm.name.trim().length < 2 || !inventoryItemForm.unit.trim()) { setMessage("Enter an item name and unit."); setBusy(false); return; }
    if (!Number.isFinite(reorderLevel) || reorderLevel < 0 || !Number.isFinite(openingStock) || openingStock < 0) { setMessage("Reorder level and opening stock cannot be negative."); setBusy(false); return; }
    const { data, error } = await supabase.rpc("staff_create_inventory_item", {
      p_name: inventoryItemForm.name.trim(), p_unit: inventoryItemForm.unit.trim(), p_reorder_level: reorderLevel, p_opening_stock: openingStock,
    });
    if (error) setMessage(`Inventory item was not added: ${error.message}`);
    else { setInventoryItemForm({ name: "", unit: "", reorderLevel: "", openingStock: "" }); await loadDashboard(); setMessage(`${String((data as {item?:{name?:string}})?.item?.name || "New inventory item")} added successfully.`); }
    setBusy(false);
  }

  async function openPhoto(order: Order) {
    if (!order.scale_photo_path) return;
    const { data, error } = await supabase.storage.from("scale-photos").createSignedUrl(order.scale_photo_path, 300);
    if (error) setMessage(error.message); else setPhotoUrl(data.signedUrl);
  }

  async function resolveAlert(id: string) { const { error } = await supabase.rpc("resolve_staff_security_alert", { p_alert_id: id }); if (error) setMessage(error.message); else await loadAdmin(); }
  async function updateService(service: Service) { const { error } = await supabase.from("service_catalog").update({ name: service.name, category: service.category, rate: Number(service.rate), unit: service.unit, active: service.active }).eq("id", service.id); if (error) setMessage(error.message); else { await loadDashboard(); setMessage("Service pricing updated."); } }
  async function updateTeam(member: Profile) { const { error } = await supabase.from("staff_profiles").update({ display_name: member.display_name, role: member.role, active: member.active }).eq("user_id", member.user_id); if (error) setMessage(error.message); else { await loadAdmin(); setMessage("Team access updated."); } }
  async function updateSiteContent(event: FormEvent) {
    event.preventDefault();
    if (!siteContent?.id || !profile) return;
    setBusy(true); setMessage("");
    const values: Partial<SiteContent> = { ...siteContent };
    delete values.id;
    delete values.loop_credit_options;
    const [{ error }, { error: creditError }] = await Promise.all([
      supabase.from("site_content").update({ ...values, updated_by: profile.user_id }).eq("id", true),
      supabase.rpc("admin_update_loop_credit_options", { p_options: siteContent.loop_credit_options }),
    ]);
    if (error || creditError) setMessage(`Website content was not saved: ${(error || creditError)?.message}`);
    else { await loadAdmin(); setMessage("Website content published. Refresh the public homepage to see it."); }
    setBusy(false);
  }

  function whatsapp(order: Order) {
    const phone = phoneDigits(order.customer_phone);
    const isSubscription = order.order_type === "Monthly Package";
    const copy = isSubscription && order.payment?.status === "Paid"
      ? `Welcome to The Laundry Loop, ${order.customer_name}! Your monthly subscription is now active. You can log in to see your weekly pounds and remaining subscription days. Thank you for choosing The Laundry Loop.`
      : isSubscription
        ? `Thank you for choosing The Laundry Loop. Your subscription request ${order.tracking_code} is being processed. We will message you as soon as payment is verified and your subscription is active.`
        : `Laundry Loop update: order ${order.tracking_code} is ${order.status}. Total ${money(order.total)}. Thank you.`;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(copy)}`, "_blank", "noopener,noreferrer");
  }

  function whatsappSubscription(item: Subscription) {
    const active = item.subscription_status === "Active";
    const copy = active
      ? `Welcome to The Laundry Loop, ${item.customer_name}! Your monthly subscription is active. You have ${Number(item.weekly_pounds) + Number(item.extra_pounds)} lbs available each week. Thank you for choosing The Laundry Loop.`
      : `Thank you for choosing The Laundry Loop. Your subscription request ${item.tracking_code} is being processed. We will message you as soon as payment is verified and your subscription is active.`;
    window.open(`https://wa.me/${phoneDigits(item.customer_phone)}?text=${encodeURIComponent(copy)}`, "_blank", "noopener,noreferrer");
  }

  function printOrder(mode: "receipt" | "tag") {
    setPrintMode(mode);
    window.setTimeout(() => window.print(), 0);
  }

  async function confirmOrderAction(event: FormEvent) {
    event.preventDefault();
    if (!orderAction || !orderActionReason.trim()) return;
    const actionLabel = orderAction.type === "refund" ? "Refunded" : "Cancelled";
    const auditNote = `${orderAction.order.notes ? `${orderAction.order.notes}\n\n` : ""}${actionLabel} by ${profile?.display_name || "authorized user"} on ${new Date().toLocaleString()}. Reason: ${orderActionReason.trim()}`;
    await patchOrder(orderAction.order, {
      status: "Cancelled/Refunded",
      paymentStatus: orderAction.type === "refund" ? "Refunded" : undefined,
      notes: auditNote,
    });
    setOrderAction(null); setOrderActionReason("");
  }
  function showView(next: View) { setView(next); setMenuOpen(false); setMessage(""); }

  if (busy && !profile) return <main className="portal-shell">
<section className="login-card">
<p>Loading secure portal…</p>
</section>
</main>;
  if (recovery) return <main className="portal-shell">
<section className="login-card">
<p className="eyebrow">Secure account recovery</p>
<h1>Choose a new password</h1>
<form onSubmit={savePassword}>
<label>New password<input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} minLength={10} required />
</label>
<button type="submit">Update password</button>
</form>{message && <p className="notice">{message}</p>}</section>
</main>;
  if (!profile && portal === "staff") return <main className="portal-shell staff-entry">
<div className="logo-watermark" aria-hidden="true"/>
<section className="staff-welcome">
<p className="eyebrow">Secure staff portal</p><h1>Welcome to The Laundry Loop</h1><p className="muted">Who are you?</p>
<div className="identity-grid">
<button type="button" className={identity==="affia"?"identity active":"identity"} onClick={()=>{setIdentity("affia");setEmail("affiamcpherson382@gmail.com");setMessage("");}}><strong>Affia</strong><small>Supervisor</small></button>
<button type="button" className={identity==="staff"?"identity active":"identity"} onClick={()=>{setIdentity("staff");setEmail("oscarjacobis1@gmail.com");setMessage("");}}><strong>In-store Staff</strong><small>Operations</small></button>
</div>
<div className="staff-entry-grid">
<section className="login-card compact"><p className="eyebrow">Attendance</p><h2>Check in or out</h2><p className="muted">Use your own password so the correct work time is recorded.</p>
<div className="segmented"><button type="button" className={attendanceMode==="in"?"active":""} onClick={()=>setAttendanceMode("in")}>Check in</button><button type="button" className={attendanceMode==="out"?"active":""} onClick={()=>setAttendanceMode("out")}>Check out</button></div>
<form onSubmit={attendanceAction}><label>Password<input type="password" autoComplete="current-password" value={attendancePassword} onChange={e=>setAttendancePassword(e.target.value)} disabled={!identity} required/></label><button disabled={busy||!identity}>Confirm {attendanceMode}</button></form></section>
<section className="login-card compact"><p className="eyebrow">System access</p><h2>{identity?`Welcome, ${identity==="affia"?"Affia":"In-store Staff"}`:"Choose your name"}</h2><p className="muted">Sign in to take and manage orders.</p>
<form onSubmit={signIn}><label>Password<input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} disabled={!identity} required/></label><button disabled={busy||!identity}>Sign in</button></form>
<button className="text-button" type="button" onClick={forgotPassword} disabled={busy || recoveryRequested || !email}>{recoveryRequested?"Try again in 60 seconds":"Forgot password?"}</button></section>
</div>{message&&<p className="notice" role="status">{message}</p>}<Link className="admin-route-note" href="/admin">Administrator sign in</Link>
</section></main>;
  if (!profile) return <main className="portal-shell staff-entry admin-entry">
<div className="logo-watermark" aria-hidden="true"/>
<section className="staff-welcome admin-welcome">
<h1>Welcome to The Laundry Loop</h1>
<section className="login-card compact admin-login" data-portal={portal}>
<Link className="brand" href="/index.html">The Laundry Loop</Link>
<p className="eyebrow">{portal === "admin" ? "Administrator access" : "Staff access"}</p>
<h1>{portal === "admin" ? "Admin sign in" : "Staff sign in"}</h1>
<p className="muted">Authorized {portal === "admin" ? "administrators" : "team members"} only.</p>
<form onSubmit={signIn}>
<label><span className="field-label">Email address</span><input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@business.com" required />
</label>
<label><span className="field-label">Password</span><input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter your password" required />
</label>
<button type="submit" disabled={busy}>Sign in</button>
</form>
<button className="text-button" type="button" onClick={forgotPassword} disabled={busy || recoveryRequested}>{recoveryRequested ? "Try again in 60 seconds" : "Forgot password?"}</button>{message && <p className="notice" role="status">{message}</p>}</section>
</section></main>;

  const navigation: Array<[View, string, string]> = [
    ["orders", "Orders", String(filteredOrders.length)], ["pos", "New POS order", "+"], ["paper", "Enter paper order", ""], ["inventory", "Inventory", ""], ["operations", "Operations", ""],
    ...(isAdmin ? [["content", "Website content", ""], ["services", "Services & pricing", ""], ["team", "Staff", ""], ["security", "Recovery alerts", String(alerts.filter((a) => !a.resolved_at).length)]] as Array<[View, string, string]> : []),
  ];

  return <main className="ops-shell">
    <aside className={`ops-sidebar ${menuOpen ? "open" : ""}`}>
      <div className="ops-brand">
<span>LL</span>
<div>
<strong>Laundry Loop</strong>
<small>{isAdmin ? "Administrator" : "Staff workspace"}</small>
</div>
</div>
      <nav>{navigation.map(([key, label, count]) => <button key={key} className={view === key ? "active" : ""} onClick={() => showView(key)}>
<span>{label}</span>{count && <b>{count}</b>}</button>)}</nav>
      <div className="sidebar-user">
<strong>{profile.display_name}</strong>
<small>{profile.role}</small>
<button onClick={() => void signOut()}>Sign out</button>
</div>
    </aside>
    <section className="ops-main">
      <header className="ops-topbar">
<button className="menu-button" onClick={() => setMenuOpen(!menuOpen)} aria-label="Open staff menu">☰</button>
<div>
<p className="eyebrow">Laundry operations</p>
<h1>{navigation.find(([key]) => key === view)?.[1]}</h1>
</div>
<div className="top-actions">
<span className="live-dot">Live</span>
<button className="secondary" onClick={() => { void loadDashboard(); if (isAdmin) void loadAdmin(); }}>Refresh</button>
</div>
</header>
      {message && <p className="notice" role="status">{message}</p>}

      {view === "orders" && <section>
        <div className="toolbar">
<input aria-label="Search orders" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search code, customer or phone…"/>
<select aria-label="Filter orders" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
<option>Active</option>
<option>All</option>{statuses.map((status) => <option key={status}>{status}</option>)}</select>
<button onClick={() => showView("pos")}>+ New order</button>
</div>
        <div className="queue-summary">
<article>
<small>Active queue</small>
<strong>{orders.filter((o) => !["Picked Up (Archived)", "Cancelled/Refunded"].includes(o.status)).length}</strong>
</article>
<article>
<small>Ready for pickup</small>
<strong>{orders.filter((o) => o.status === "Ready for Pick-Up").length}</strong>
</article>
<article>
<small>Pending payment</small>
<strong>{orders.filter((o) => !["Paid", "Refunded"].includes(o.payment?.status || "")).length}</strong>
</article>
<article>
<small>Today&apos;s orders</small>
<strong>{orders.filter((o) => new Date(o.created_at).toDateString() === new Date().toDateString()).length}</strong>
</article>
</div>
        <div className="panel table-panel">
<div className="table-wrap">
<table>
<thead>
<tr>
<th>Code / received</th>
<th>Customer</th>
<th>Laundry / notes</th>
<th>Total</th>
<th>Payment</th>
<th>Status</th>
<th>Actions</th>
</tr>
</thead>
<tbody>{filteredOrders.length ? filteredOrders.map((order) => <tr key={order.id}>
<td>
<strong className="mono">{order.tracking_code}</strong>
<small>{dateTime(order.created_at)}</small>
</td>
<td>
<strong>{order.customer_name}</strong>
<small>{order.customer_phone}</small>
</td>
<td>
<strong>{order.weight_summary || `${order.items?.length || 0} service(s)`}</strong>
<small>{order.notes || order.order_type}</small>
</td>
<td>
<strong>{money(order.total)}</strong>{Number(order.discount) > 0 && <small>{money(order.discount)} discount</small>}</td>
<td>
<span className={`badge pay-${(order.payment?.status || "").toLowerCase().replaceAll(" ", "-")}`}>{order.payment?.status || "Pay at Pickup"}</span>
<select aria-label={`Payment for ${order.tracking_code}`} value={order.payment?.status || "Pay at Pickup"} onChange={(e) => void patchOrder(order, { paymentStatus: e.target.value })}>{paymentStatuses.filter(status=>profile.role!=="staff"||status!=="Refunded").map((status) => <option key={status}>{status}</option>)}</select>
</td>
<td>
<span className={`badge status-${order.status.toLowerCase().replaceAll(" ", "-").replaceAll("/", "-")}`}>{order.status}</span>
<select aria-label={`Status for ${order.tracking_code}`} value={order.status} onChange={(e) => void patchOrder(order, { status: e.target.value })}>{statuses.filter(status=>profile.role!=="staff"||status!=="Cancelled/Refunded").map((status) => <option key={status}>{status}</option>)}</select>
</td>
<td>
<div className="row-actions">
<button className="print-action" onClick={() => setSelectedOrder(order)}>Receipt</button>
<button className="whatsapp-action" onClick={() => whatsapp(order)}>WhatsApp</button>
{order.scale_photo_path && <button onClick={() => void openPhoto(order)}>Photo</button>}
{profile.role !== "staff" && order.status !== "Cancelled/Refunded" && <button className="danger-action" onClick={() => { setOrderAction({ order, type: order.payment?.status === "Paid" ? "refund" : "cancel" }); setOrderActionReason(""); }}>Cancel / Refund</button>}</div>
</td>
</tr>) : <tr>
<td colSpan={7} className="empty">No matching orders.</td>
</tr>}</tbody>
</table>
</div>
</div>
      </section>}

      {view === "pos" && <section className="split-layout">
<form className="panel pos-form" onSubmit={submitPos}>
<div className="section-heading">
<div>
<p className="eyebrow">Counter order</p>
<h2>Manual POS</h2>
</div>
<span className="badge">Staff authenticated</span>
</div>
<div className="form-grid">
<label>Customer name<input value={pos.name} onChange={(e) => setPos({ ...pos, name: e.target.value })} minLength={2} required />
</label>
<label>WhatsApp / phone<input value={pos.phone} onChange={(e) => setPos({ ...pos, phone: e.target.value })} placeholder="5926001234" inputMode="tel" required />
</label>
</div>
<div className="field-group">
<div className="inline-heading">
<label>Laundry services</label>
<small>Mix and match</small>
</div>{posItems.map((row, index) => <div className="service-row" key={index}>
<select aria-label={`Service ${index + 1}`} value={row.service_id} onChange={(e) => setPosItems(posItems.map((item, i) => i === index ? { ...item, service_id: e.target.value } : item))} required>
<option value="">Choose service</option>{services.filter((service) => service.active).map((service) => <option key={service.id} value={service.id}>{service.name} — {money(service.rate)}/{service.unit}</option>)}</select>
<input aria-label={`Quantity ${index + 1}`} type="number" min="0.5" max="500" step="0.5" value={row.qty} onChange={(e) => setPosItems(posItems.map((item, i) => i === index ? { ...item, qty: Number(e.target.value) } : item))} required/>
<button type="button" className="danger-text" onClick={() => posItems.length > 1 && setPosItems(posItems.filter((_, i) => i !== index))}>×</button>
</div>)}<button type="button" className="secondary add-line" onClick={() => setPosItems([...posItems, { service_id: services.find((s) => s.active)?.id || "", qty: 1 }])}>+ Add another service</button>
</div>
<label>Garment / care notes<textarea value={pos.notes} onChange={(e) => setPos({ ...pos, notes: e.target.value })} placeholder="Item count, stains, special care…" rows={3}/>
</label>
<div className="form-grid">
<label>Payment method<select value={pos.paymentMethod} onChange={(e) => { const method = e.target.value as "Cash" | "MMG"; setPos({ ...pos, paymentMethod: method, paymentStatus: method === "MMG" ? "Pending Confirmation" : "Pay at Pickup", paymentReference: method === "Cash" ? "" : pos.paymentReference }); }}>
<option>Cash</option>
<option>MMG</option>
</select>
</label>
<label>Payment status<select value={pos.paymentStatus} onChange={(e) => setPos({ ...pos, paymentStatus: e.target.value })}>{(pos.paymentMethod === "MMG" ? ["Pending Confirmation", "Paid"] : ["Pay at Pickup", "Paid"]).map((status) => <option key={status}>{status}</option>)}</select>
</label>
</div>
{pos.paymentMethod === "MMG" && <label>MMG transaction reference<input value={pos.paymentReference} onChange={(e) => setPos({ ...pos, paymentReference: e.target.value })} placeholder="Required for verification" maxLength={120} required /></label>}
{profile.role !== "staff" && <fieldset className="discount-box">
<legend>Order discount</legend>
<div className="discount-grid">
<label>Discount type<select value={pos.discountMode} onChange={(e) => setPos({ ...pos, discountMode: e.target.value as DiscountMode, discountValue: "" })}>
<option value="amount">Fixed amount (GYD)</option>
<option value="percent">Percentage (%)</option>
</select></label>
<label>{pos.discountMode === "percent" ? "Percentage" : "Discount amount"}<input type="number" min="0" max={pos.discountMode === "percent" ? 100 : posSubtotal} step={pos.discountMode === "percent" ? "0.1" : "1"} value={pos.discountValue} onChange={(e) => setPos({ ...pos, discountValue: e.target.value })} placeholder={pos.discountMode === "percent" ? "e.g. 10" : "e.g. 500"}/></label>
</div>
<p>Supervisor/administrator only. The final GYD discount is recorded on the receipt and in reports.</p>
</fieldset>}
{posMessage && <p className="form-error" role="alert">{posMessage}</p>}
<button className="primary-wide" type="submit" disabled={busy}>Create order & receipt</button>
</form>
<aside className="panel total-card">
<p className="eyebrow">Order summary</p>
<dl className="pos-total-breakdown"><div><dt>Subtotal</dt><dd>{money(posSubtotal)}</dd></div>{posDiscount > 0 && <div><dt>Discount</dt><dd>− {money(posDiscount)}</dd></div>}<div className="grand-total"><dt>Total</dt><dd>{money(posTotal)}</dd></div></dl>
<p>Prices come from the live service catalog. The receipt opens immediately after the order is saved.</p>
<ul>
<li>Cash and MMG supported</li>
<li>Tracking code generated automatically</li>
<li>Receipt and bag-tag print layout included</li>
</ul>
</aside>
</section>}

      {view === "paper" && <section className="split-layout">
<form className="panel pos-form" onSubmit={submitPaper}><div className="section-heading"><div><p className="eyebrow">Outage recovery</p><h2>Enter a paper order</h2></div><span className="badge">Back-entry</span></div>
<p className="muted">Use this after power or internet returns. The original sale time and the time entered online are stored separately.</p>
<div className="form-grid"><label>Original date & time<input type="datetime-local" value={paper.originalAt} onChange={e=>setPaper({...paper,originalAt:e.target.value})} required/></label><label>Paper receipt/reference<input value={paper.reference} onChange={e=>setPaper({...paper,reference:e.target.value})} placeholder="BOOK-001" required/></label><label>Customer name<input value={paper.name} onChange={e=>setPaper({...paper,name:e.target.value})} required/></label><label>WhatsApp / phone<input value={paper.phone} onChange={e=>setPaper({...paper,phone:e.target.value})} required/></label></div>
<div className="field-group"><label>Laundry services</label>{paperItems.map((row,index)=><div className="service-row" key={index}><select value={row.service_id} onChange={e=>setPaperItems(paperItems.map((item,i)=>i===index?{...item,service_id:e.target.value}:item))} required><option value="">Choose service</option>{services.filter(s=>s.active).map(s=><option key={s.id} value={s.id}>{s.name} — {money(s.rate)}/{s.unit}</option>)}</select><input type="number" min="0.5" step="0.5" value={row.qty} onChange={e=>setPaperItems(paperItems.map((item,i)=>i===index?{...item,qty:Number(e.target.value)}:item))}/><button type="button" className="danger-text" onClick={()=>paperItems.length>1&&setPaperItems(paperItems.filter((_,i)=>i!==index))}>×</button></div>)}<button type="button" className="secondary add-line" onClick={()=>setPaperItems([...paperItems,{service_id:"",qty:1}])}>+ Add another service</button></div>
<label>Notes<textarea value={paper.notes} onChange={e=>setPaper({...paper,notes:e.target.value})} rows={3}/></label><div className="form-grid"><label>Payment method<select value={paper.paymentMethod} onChange={e=>setPaper({...paper,paymentMethod:e.target.value})}><option>Cash</option><option>MMG</option></select></label><label>Payment status<select value={paper.paymentStatus} onChange={e=>setPaper({...paper,paymentStatus:e.target.value})}>{paymentStatuses.slice(0,3).map(s=><option key={s}>{s}</option>)}</select></label></div><button className="primary-wide" disabled={busy}>Save recovered order</button></form>
<aside className="panel total-card"><p className="eyebrow">Failsafe checklist</p><h2>During an outage</h2><ul><li>Keep the tablet and router on the UPS.</li><li>Try the mobile hotspot if internet alone is down.</li><li>If both fail, issue a numbered paper receipt.</li><li>Record customer, phone, service, weight, payment and exact time.</li><li>Back-enter each receipt here once service returns.</li></ul></aside></section>}

      {view === "inventory" && <section>
<form className="panel add-inventory-form" onSubmit={createInventoryItem}>
<div className="section-heading"><div><p className="eyebrow">Staff inventory tool</p><h2>Add inventory item</h2></div><span className="badge">New stock line</span></div>
<p className="muted">Create supplies that are not already listed. Existing names cannot be duplicated.</p>
<div className="add-inventory-grid">
<label>Item name<input value={inventoryItemForm.name} onChange={(e) => setInventoryItemForm({ ...inventoryItemForm, name: e.target.value })} placeholder="e.g. Stain remover" minLength={2} maxLength={80} required/></label>
<label>Unit<input value={inventoryItemForm.unit} onChange={(e) => setInventoryItemForm({ ...inventoryItemForm, unit: e.target.value })} placeholder="litres, kg, each…" maxLength={30} required/></label>
<label>Reorder level<input type="number" min="0" step="0.001" value={inventoryItemForm.reorderLevel} onChange={(e) => setInventoryItemForm({ ...inventoryItemForm, reorderLevel: e.target.value })} placeholder="0"/></label>
<label>Opening stock<input type="number" min="0" step="0.001" value={inventoryItemForm.openingStock} onChange={(e) => setInventoryItemForm({ ...inventoryItemForm, openingStock: e.target.value })} placeholder="0"/></label>
<button disabled={busy}>Add item</button>
</div>
</form>
<div className="inventory-grid">{inventory.map((item) => <article className={`panel stock-card ${Number(item.on_hand) <= Number(item.reorder_level) ? "low" : ""}`} key={item.item_id}>
<div>
<h3>{item.item_name}</h3>
<span>{item.recommendation}</span>
</div>
<strong>{Number(item.on_hand).toLocaleString()} <small>{item.unit}</small>
</strong>
<dl>
<div>
<dt>Reorder level</dt>
<dd>{item.reorder_level}</dd>
</div>
<div>
<dt>30-day daily use</dt>
<dd>{item.average_daily_usage_30}</dd>
</div>
<div>
<dt>Days remaining</dt>
<dd>{item.estimated_days_remaining ?? "—"}</dd>
</div>
</dl>
</article>)}</div>
<form className="panel movement-form" onSubmit={submitInventory}>
<div className="section-heading">
<div>
<p className="eyebrow">Stock movement</p>
<h2>Record inventory</h2>
</div>
</div>
<div className="movement-grid">
<label>Item<select value={inventoryForm.itemId} onChange={(e) => setInventoryForm({ ...inventoryForm, itemId: e.target.value })} required>
<option value="">Choose inventory item</option>{inventory.map((item) => <option key={item.item_id} value={item.item_id}>{item.item_name}</option>)}</select>
</label>
<label>Movement<select value={inventoryForm.type} onChange={(e) => setInventoryForm({ ...inventoryForm, type: e.target.value })}>
<option value="restock">Restock</option>
<option value="usage">Usage</option>
<option value="waste">Waste</option>
<option value="adjustment">Adjustment (+ or −)</option>
</select>
</label>
<label>Quantity<input type="number" step="0.001" value={inventoryForm.quantity} onChange={(e) => setInventoryForm({ ...inventoryForm, quantity: e.target.value })} required />
</label>
<label>Unit cost (optional)<input type="number" min="0" step="0.01" value={inventoryForm.unitCost} onChange={(e) => setInventoryForm({ ...inventoryForm, unitCost: e.target.value })}/>
</label>
<label className="wide">Note<input value={inventoryForm.note} onChange={(e) => setInventoryForm({ ...inventoryForm, note: e.target.value })} placeholder="Supplier, invoice, reason…"/>
</label>
<button type="submit">Record movement</button>
</div>
</form>
</section>}

      {view === "operations" && <section>
<div className="queue-summary ops-summary">
<article>
<small>Orders · 30 days</small>
<strong>{summary?.orders ?? 0}</strong>
</article>
<article>
<small>Revenue · 30 days</small>
<strong>{money(summary?.revenue)}</strong>
</article>
<article>
<small>Average order</small>
<strong>{money(summary?.average_order_value)}</strong>
</article>
<article>
<small>Repeat customers</small>
<strong>{summary?.repeat_customers ?? 0}</strong>
</article>
</div>
<div className="panel operations-detail">
<h2>Operational snapshot</h2>
<p>Average time from received to ready: <strong>{summary?.average_hours_to_ready == null ? "Not enough data" : `${summary.average_hours_to_ready} hours`}</strong>
</p>
<p>Busiest order hour: <strong>{summary?.busiest_hour == null ? "Not enough data" : `${String(summary.busiest_hour).padStart(2, "0")}:00`}</strong>
</p>
<p className="muted">This view updates from real order and status history—not browser storage.</p>
</div>
<div className="panel subscription-operations">
<div className="section-heading"><div><p className="eyebrow">Subscriptions</p><h2>Subscription control</h2></div><span className="badge">{subscriptions.filter(item=>item.subscription_status==="Pending Verification").length} new</span></div>
<div className="subscription-filters" role="group" aria-label="Filter subscriptions">
{["Pending","Active","Inactive","All"].map(filter=><button type="button" key={filter} className={subscriptionFilter===filter?"active":""} onClick={()=>setSubscriptionFilter(filter)}>{filter}</button>)}
</div>
<div className="subscription-list">
{subscriptions.filter(item=>subscriptionFilter==="All"||(subscriptionFilter==="Pending"&&item.subscription_status==="Pending Verification")||(subscriptionFilter==="Active"&&item.subscription_status==="Active")||(subscriptionFilter==="Inactive"&&["Expired","Cancelled"].includes(item.subscription_status))).map(item=><article className="subscription-row" key={item.subscription_id}>
<div><strong>{item.customer_name}</strong><small>{item.customer_phone} · {item.tracking_code}</small></div>
<div><span className={`badge subscription-${item.subscription_status.toLowerCase().replaceAll(" ","-")}`}>{item.subscription_status}</span><small>{item.payment_method} · {item.payment_status}</small></div>
<div><strong>{Number(item.weekly_pounds)+Number(item.extra_pounds)} lbs/week</strong><small>{item.credit_balance} credits</small></div>
<div><strong>{item.ends_at?new Date(item.ends_at).toLocaleDateString("en-GY"):"Awaiting activation"}</strong><small>{item.starts_at?"Active period":"Payment must be verified"}</small></div>
<button className="whatsapp-action" onClick={()=>whatsappSubscription(item)}>WhatsApp</button>
</article>)}
{subscriptions.filter(item=>subscriptionFilter==="All"||(subscriptionFilter==="Pending"&&item.subscription_status==="Pending Verification")||(subscriptionFilter==="Active"&&item.subscription_status==="Active")||(subscriptionFilter==="Inactive"&&["Expired","Cancelled"].includes(item.subscription_status))).length===0&&<p className="empty">No {subscriptionFilter.toLowerCase()} subscriptions.</p>}
</div>
</div>
</section>}

      {view === "content" && isAdmin && <section>
{siteContent ? <form className="panel cms-form" onSubmit={updateSiteContent}>
<div className="section-heading"><div><p className="eyebrow">Administrator only</p><h2>Website content</h2></div><span className="badge">Live homepage</span></div>
<p className="muted">Edit customer-facing wording, contact details and payment details. Prices remain under Services &amp; pricing so estimates and POS totals use one source.</p>
<fieldset><legend>Brand &amp; hero</legend><div className="form-grid">
<label>Business name<input value={siteContent.business_name} onChange={e=>setSiteContent({...siteContent,business_name:e.target.value})} minLength={2} maxLength={80} required/></label>
<label>Tagline<input value={siteContent.tagline} onChange={e=>setSiteContent({...siteContent,tagline:e.target.value})} minLength={2} maxLength={120} required/></label>
<label>Hero eyebrow<input value={siteContent.hero_eyebrow} onChange={e=>setSiteContent({...siteContent,hero_eyebrow:e.target.value})} maxLength={120} required/></label>
<label>Hero first line<input value={siteContent.hero_title} onChange={e=>setSiteContent({...siteContent,hero_title:e.target.value})} maxLength={80} required/></label>
<label>Hero emphasized line<input value={siteContent.hero_emphasis} onChange={e=>setSiteContent({...siteContent,hero_emphasis:e.target.value})} maxLength={80} required/></label>
<label className="wide-field">Hero description<textarea value={siteContent.hero_description} onChange={e=>setSiteContent({...siteContent,hero_description:e.target.value})} minLength={10} maxLength={400} rows={3} required/></label>
</div></fieldset>
<fieldset><legend>Location &amp; contact</legend><div className="form-grid">
<label>Address<input value={siteContent.address} onChange={e=>setSiteContent({...siteContent,address:e.target.value})} maxLength={200} required/></label>
<label>Directions<input value={siteContent.directions} onChange={e=>setSiteContent({...siteContent,directions:e.target.value})} maxLength={200} required/></label>
<label>Google Maps share link<input type="url" value={siteContent.maps_url} onChange={e=>setSiteContent({...siteContent,maps_url:e.target.value})} pattern="https://maps\.app\.goo\.gl/.+" required/></label>
<label>Business phone<input value={siteContent.phone} onChange={e=>setSiteContent({...siteContent,phone:e.target.value})} maxLength={30} required/></label>
</div></fieldset>
<fieldset><legend>Payment details &amp; estimate notice</legend><div className="form-grid">
<label>MMG number<input inputMode="numeric" value={siteContent.mmg_number} onChange={e=>setSiteContent({...siteContent,mmg_number:e.target.value.replace(/\D/g,"")})} minLength={7} maxLength={15} required/></label>
<label>MMG account name<input value={siteContent.mmg_name} onChange={e=>setSiteContent({...siteContent,mmg_name:e.target.value})} maxLength={120} required/></label>
<label>Estimate disclaimer<input value={siteContent.estimate_disclaimer} onChange={e=>setSiteContent({...siteContent,estimate_disclaimer:e.target.value})} maxLength={240} required/></label>
</div></fieldset>
<fieldset><legend>Loop Credit top-ups</legend><p className="muted">Customers with an active monthly subscription see these options in My Account.</p><div className="admin-list">
{siteContent.loop_credit_options.map((option,index)=><div className="admin-row credit-option-row" key={option.id}>
<label>Credits<input type="number" min="1" value={option.credits} onChange={e=>setSiteContent({...siteContent,loop_credit_options:siteContent.loop_credit_options.map((item,i)=>i===index?{...item,credits:Number(e.target.value)}:item)})}/></label>
<label>Pounds<input type="number" min="0.5" step="0.5" value={option.pounds} onChange={e=>setSiteContent({...siteContent,loop_credit_options:siteContent.loop_credit_options.map((item,i)=>i===index?{...item,pounds:Number(e.target.value)}:item)})}/></label>
<label>Price (GYD)<input type="number" min="0" step="100" value={option.price} onChange={e=>setSiteContent({...siteContent,loop_credit_options:siteContent.loop_credit_options.map((item,i)=>i===index?{...item,price:Number(e.target.value)}:item)})}/></label>
</div>)}
</div></fieldset>
<button className="primary-wide" disabled={busy}>Publish website content</button>
</form> : <div className="panel"><p>Loading website content…</p></div>}
</section>}

      {view === "services" && isAdmin && <section className="panel">
<div className="section-heading">
<div>
<p className="eyebrow">Administrator only</p>
<h2>Services & pricing</h2>
</div>
</div>
<div className="admin-list">{services.map((service, index) => <div className="admin-row" key={service.id}>
<input aria-label="Service name" value={service.name} onChange={(e) => setServices(services.map((s, i) => i === index ? { ...s, name: e.target.value } : s))}/>
<input aria-label="Category" value={service.category} onChange={(e) => setServices(services.map((s, i) => i === index ? { ...s, category: e.target.value } : s))}/>
<input aria-label="Rate" type="number" min="0" value={service.rate} onChange={(e) => setServices(services.map((s, i) => i === index ? { ...s, rate: Number(e.target.value) } : s))}/>
<input aria-label="Unit" value={service.unit} onChange={(e) => setServices(services.map((s, i) => i === index ? { ...s, unit: e.target.value } : s))}/>
<label className="toggle">
<input type="checkbox" checked={service.active} onChange={(e) => setServices(services.map((s, i) => i === index ? { ...s, active: e.target.checked } : s))}/> Active</label>
<button onClick={() => void updateService(service)}>Save</button>
</div>)}</div>
</section>}

      {view === "team" && isAdmin && <section className="panel">
<div className="section-heading">
<div>
<p className="eyebrow">Administrator only</p>
<h2>Staff access</h2>
</div>
</div>
<p className="muted">Change roles or deactivate access. New login accounts are created in Supabase Authentication before they appear here.</p>
<div className="admin-list">{team.map((member, index) => <div className="admin-row team-row" key={member.user_id}>
<input aria-label="Display name" value={member.display_name} onChange={(e) => setTeam(team.map((s, i) => i === index ? { ...s, display_name: e.target.value } : s))}/>
<select aria-label="Role" value={member.role} onChange={(e) => setTeam(team.map((s, i) => i === index ? { ...s, role: e.target.value as Role } : s))}>
<option value="staff">Staff</option>
<option value="manager">Supervisor</option>
<option value="admin">Administrator</option>
</select>
<label className="toggle">
<input type="checkbox" checked={member.active !== false} onChange={(e) => setTeam(team.map((s, i) => i === index ? { ...s, active: e.target.checked } : s))}/> Active</label>
<button onClick={() => void updateTeam(member)}>Save access</button>
</div>)}</div>
<h3 className="report-heading">Attendance · last 7 days</h3><div className="table-wrap"><table><thead><tr><th>Staff</th><th>Check in</th><th>Check out</th><th>Hours</th></tr></thead><tbody>{attendance.map(row=>{const member=team.find(m=>m.user_id===row.staff_user_id);const hours=row.check_out_at?((new Date(row.check_out_at).getTime()-new Date(row.check_in_at).getTime())/3600000).toFixed(2):"Open";return <tr key={row.id}><td>{member?.display_name||"Staff"}</td><td>{dateTime(row.check_in_at)}</td><td>{row.check_out_at?dateTime(row.check_out_at):"Still checked in"}</td><td>{hours}</td></tr>})}</tbody></table></div>
<h3 className="report-heading">System access · last 7 days</h3><div className="table-wrap"><table><thead><tr><th>Staff</th><th>Login</th><th>Logout</th><th>Last activity</th></tr></thead><tbody>{accessSessions.map(row=>{const member=team.find(m=>m.user_id===row.staff_user_id);return <tr key={row.id}><td>{member?.display_name||"Staff"}</td><td>{dateTime(row.login_at)}</td><td>{row.logout_at?dateTime(row.logout_at):"Active / not signed out"}</td><td>{dateTime(row.last_activity_at)}</td></tr>})}</tbody></table></div>
</section>}

      {view === "security" && isAdmin && <section className="panel">
<div className="section-heading">
<div>
<p className="eyebrow">Administrator only</p>
<h2>Staff recovery alerts</h2>
</div>
<span>{alerts.filter((a) => !a.resolved_at).length} open</span>
</div>{alerts.length ? <div className="table-wrap">
<table>
<thead>
<tr>
<th>Staff email</th>
<th>Requested</th>
<th>Status</th>
<th>
</th>
</tr>
</thead>
<tbody>{alerts.map((alert) => <tr key={alert.id}>
<td>{alert.requester_email}</td>
<td>{dateTime(alert.created_at)}</td>
<td>{alert.resolved_at ? "Resolved" : "Open"}</td>
<td>{!alert.resolved_at && <button onClick={() => void resolveAlert(alert.id)}>Resolve</button>}</td>
</tr>)}</tbody>
</table>
</div> : <p className="empty">No password recovery alerts.</p>}</section>}
    </section>

    {selectedOrder && <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Order receipt">
<div className={`modal-card receipt-modal print-${printMode}`}>
<button className="modal-close" onClick={() => setSelectedOrder(null)}>×</button>
<div id="printable-receipt" className="receipt">
<header>
<strong>Laundry Loop</strong>
<small>Fresh. Folded. Done.</small>
</header>
<h2>{selectedOrder.tracking_code}</h2>
<p>{dateTime(selectedOrder.created_at)}</p>
<div className="receipt-rule"/>
<p>
<strong>{selectedOrder.customer_name}</strong>
<br/>{selectedOrder.customer_phone}</p>{selectedOrder.items?.map((item, index) => <div className="receipt-line" key={index}>
<span>{item.label} × {item.qty} {item.unit}</span>
<strong>{money(item.total)}</strong>
</div>)}<div className="receipt-rule"/>{Number(selectedOrder.discount) > 0 && <div className="receipt-line">
<span>Discount</span>
<strong>− {money(selectedOrder.discount)}</strong>
</div>}<div className="receipt-line receipt-total">
<span>Total</span>
<strong>{money(selectedOrder.total)}</strong>
</div>
<p>Payment: {selectedOrder.payment?.method} · {selectedOrder.payment?.status}</p>
<p>Status: {selectedOrder.status}</p>{selectedOrder.notes && <p>Notes: {selectedOrder.notes}</p>}<footer>Present this order code at pickup.<br/>Thank you for choosing Laundry Loop.</footer>
</div>
<div id="printable-bag-tag" className="bag-tag">
<strong>Laundry Loop</strong>
<span className="bag-code">{selectedOrder.tracking_code}</span>
<span>{selectedOrder.customer_name}</span>
<small>{selectedOrder.customer_phone}</small>
<small>{selectedOrder.weight_summary}</small>
</div>
<div className="modal-actions">
<button className="print-action" onClick={() => printOrder("receipt")}>Print receipt</button>
<button className="print-action" onClick={() => printOrder("tag")}>Print bag tag</button>
<button className="whatsapp-action" onClick={() => whatsapp(selectedOrder)}>WhatsApp</button>
{profile.role!=="staff" && selectedOrder.status!=="Cancelled/Refunded" && <button className="danger-action" onClick={() => { setOrderAction({order:selectedOrder,type:selectedOrder.payment?.status==="Paid"?"refund":"cancel"}); setOrderActionReason(""); setSelectedOrder(null); }}>Cancel / Refund</button>}
</div>
{profile.role!=="staff" && <div className="discount-control">
<label>Discount type<select id="receipt-discount-type" defaultValue="amount"><option value="amount">Fixed GYD</option><option value="percent">Percentage</option></select></label>
<label>Value<input id="receipt-discount" type="number" min="0" step="0.1" defaultValue={selectedOrder.discount || 0}/></label>
<button className="secondary" onClick={() => { const input = document.getElementById("receipt-discount") as HTMLInputElement; const type = (document.getElementById("receipt-discount-type") as HTMLSelectElement).value; const entered = Number(input.value); const subtotal = Number(selectedOrder.subtotal ?? selectedOrder.total + Number(selectedOrder.discount || 0)); if (!Number.isFinite(entered) || entered < 0 || (type === "percent" && entered > 100)) { setMessage(type === "percent" ? "Enter a percentage from 0 to 100." : "Enter a valid discount amount."); return; } const amount = type === "percent" ? Math.round(subtotal * entered) / 100 : entered; if (amount > subtotal) { setMessage("The discount cannot exceed the order subtotal."); return; } void patchOrder(selectedOrder, { discount: amount }); setSelectedOrder(null); }}>Apply discount</button>
</div>}
</div>
</div>}
    {orderAction && <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Cancel or refund order">
<form className="modal-card action-modal" onSubmit={confirmOrderAction}>
<button type="button" className="modal-close" onClick={() => { setOrderAction(null); setOrderActionReason(""); }}>×</button>
<p className="eyebrow">Supervisor approval</p>
<h2>Cancel or refund {orderAction.order.tracking_code}</h2>
<p className="muted">This action is recorded in the order notes and cannot be performed by regular staff.</p>
<div className="segmented action-choice">
<button type="button" className={orderAction.type==="cancel"?"active":""} onClick={()=>setOrderAction({...orderAction,type:"cancel"})}>Cancel only</button>
<button type="button" className={orderAction.type==="refund"?"active":""} onClick={()=>setOrderAction({...orderAction,type:"refund"})}>Cancel &amp; refund</button>
</div>
<label>Reason<textarea value={orderActionReason} onChange={e=>setOrderActionReason(e.target.value)} minLength={3} maxLength={500} rows={4} placeholder="Explain why this order is being cancelled or refunded…" required/></label>
<button className="danger-confirm" disabled={busy || orderActionReason.trim().length<3}>{orderAction.type==="refund"?"Confirm refund":"Confirm cancellation"}</button>
</form>
</div>}
    {photoUrl && <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Scale photo">
<div className="modal-card photo-modal">
<button className="modal-close" onClick={() => setPhotoUrl(null)}>×</button>
<img src={photoUrl} alt="Private order scale photo"/>
<p>This private link expires in five minutes.</p>
</div>
</div>}
  </main>;
}
