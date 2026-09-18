import fs from 'node:fs';

const path = 'app/portal/Portal.tsx';
let source = fs.readFileSync(path, 'utf8');

if (source.includes('cashReceived: string') && source.includes('change_due')) {
  console.log('Cash tender patch already applied.');
  process.exit(0);
}

function replaceOnce(from, to, label) {
  if (!source.includes(from)) throw new Error(`Could not find ${label}`);
  source = source.replace(from, to);
}

replaceOnce(
  'import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";',
  'import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";',
  'React import',
);

replaceOnce(
  'type Payment = { method?: string; status?: string; reference?: string; discount?: number };',
  'type Payment = { method?: string; status?: string; reference?: string; discount?: number; cash_received?: number; change_due?: number };',
  'Payment type',
);

replaceOnce(
  'type PosState = { name: string; phone: string; notes: string; paymentMethod: "Cash" | "MMG"; paymentStatus: string; paymentReference: string; discountMode: DiscountMode; discountValue: string };',
  'type PosState = { name: string; phone: string; notes: string; paymentMethod: "Cash" | "MMG"; paymentStatus: string; paymentReference: string; cashReceived: string; discountMode: DiscountMode; discountValue: string };',
  'PosState type',
);

replaceOnce(
  'const emptyPos: PosState = { name: "", phone: "", notes: "", paymentMethod: "Cash", paymentStatus: "Pay at Pickup", paymentReference: "", discountMode: "amount", discountValue: "" };',
  'const emptyPos: PosState = { name: "", phone: "", notes: "", paymentMethod: "Cash", paymentStatus: "Paid", paymentReference: "", cashReceived: "", discountMode: "amount", discountValue: "" };',
  'empty POS state',
);

replaceOnce(
  '  const [pos, setPos] = useState(emptyPos);\n  const [posItems, setPosItems] = useState<Array<{ service_id: string; qty: number }>>([{ service_id: "", qty: 1 }]);',
  '  const [pos, setPos] = useState(emptyPos);\n  const posSubmitLock = useRef(false);\n  const [posItems, setPosItems] = useState<Array<{ service_id: string; qty: number }>>([{ service_id: "", qty: 1 }]);',
  'POS state block',
);

replaceOnce(
  '  const posTotal = Math.max(0, posSubtotal - posDiscount);',
  '  const posTotal = Math.max(0, posSubtotal - posDiscount);\n  const cashReceived = Math.max(0, Number(pos.cashReceived || 0));\n  const changeDue = pos.paymentMethod === "Cash" ? Math.max(0, cashReceived - posTotal) : 0;\n  const cashShort = pos.paymentMethod === "Cash" && cashReceived < posTotal;',
  'POS total calculation',
);

replaceOnce(
  '  async function submitPos(event: FormEvent) {\n    event.preventDefault(); setBusy(true); setMessage(""); setPosMessage("");',
  '  async function submitPos(event: FormEvent) {\n    event.preventDefault();\n    if (posSubmitLock.current) return;\n    posSubmitLock.current = true;\n    setBusy(true); setMessage(""); setPosMessage("");',
  'submit POS start',
);

replaceOnce(
  '    if (pos.name.trim().length < 2) { setPosMessage("Enter the customer\'s full name."); setBusy(false); return; }',
  '    if (pos.name.trim().length < 2) { setPosMessage("Enter the customer\'s full name."); setBusy(false); posSubmitLock.current = false; return; }',
  'name validation',
);
replaceOnce(
  '    if (!validPhone(pos.phone)) { setPosMessage("Enter a valid 7-digit Guyana number or a full international number."); setBusy(false); return; }',
  '    if (!validPhone(pos.phone)) { setPosMessage("Enter a valid 7-digit Guyana number or a full international number."); setBusy(false); posSubmitLock.current = false; return; }',
  'phone validation',
);
replaceOnce(
  '    if (!items.length) { setPosMessage("Choose at least one laundry service and enter a quantity."); setBusy(false); return; }',
  '    if (!items.length) { setPosMessage("Choose at least one laundry service and enter a quantity."); setBusy(false); posSubmitLock.current = false; return; }',
  'item validation',
);
replaceOnce(
  '    if (pos.paymentMethod === "MMG" && !pos.paymentReference.trim()) { setPosMessage("Enter the MMG transaction reference so the payment can be verified."); setBusy(false); return; }',
  '    if (pos.paymentMethod === "MMG" && !pos.paymentReference.trim()) { setPosMessage("Enter the MMG transaction reference so the payment can be verified."); setBusy(false); posSubmitLock.current = false; return; }\n    if (pos.paymentMethod === "Cash" && cashShort) { setPosMessage(`Cash received must be at least ${money(posTotal)}.`); setBusy(false); posSubmitLock.current = false; return; }',
  'MMG validation',
);
replaceOnce(
  '      setPosMessage(pos.discountMode === "percent" ? "Enter a percentage from 0 to 100." : "The discount cannot exceed the subtotal."); setBusy(false); return;',
  '      setPosMessage(pos.discountMode === "percent" ? "Enter a percentage from 0 to 100." : "The discount cannot exceed the subtotal."); setBusy(false); posSubmitLock.current = false; return;',
  'discount validation',
);

replaceOnce(
  '      p_payment: { method: pos.paymentMethod, status: pos.paymentStatus, reference: pos.paymentReference.trim() || null },',
  '      p_payment: { method: pos.paymentMethod, status: pos.paymentStatus, reference: pos.paymentReference.trim() || null, ...(pos.paymentMethod === "Cash" ? { cash_received: cashReceived, change_due: changeDue } : {}) },',
  'payment payload',
);

replaceOnce(
  '      const saved = data as Order; setSelectedOrder(saved); setView("orders"); setMessage(`Order ${saved.tracking_code} created. Receipt is ready to print.`);',
  '      const saved = data as Order;\n      const receiptOrder = pos.paymentMethod === "Cash" ? { ...saved, payment: { ...(saved.payment || {}), method: "Cash", status: "Paid", cash_received: cashReceived, change_due: changeDue } } : saved;\n      setSelectedOrder(receiptOrder); setView("orders"); setMessage(`Order ${saved.tracking_code} created. Receipt is ready to print.`);',
  'saved cash receipt data',
);

replaceOnce(
  '    setBusy(false);\n  }\n\n  async function submitPaper',
  '    setBusy(false);\n    posSubmitLock.current = false;\n  }\n\n  async function submitPaper',
  'submit POS end',
);

replaceOnce(
  '<label>Payment method<select value={pos.paymentMethod} onChange={(e) => { const method = e.target.value as "Cash" | "MMG"; setPos({ ...pos, paymentMethod: method, paymentStatus: method === "MMG" ? "Pending Confirmation" : "Pay at Pickup", paymentReference: method === "Cash" ? "" : pos.paymentReference }); }}>',
  '<label>Payment method<select value={pos.paymentMethod} onChange={(e) => { const method = e.target.value as "Cash" | "MMG"; setPos({ ...pos, paymentMethod: method, paymentStatus: method === "MMG" ? "Pending Confirmation" : "Paid", paymentReference: method === "Cash" ? "" : pos.paymentReference, cashReceived: method === "Cash" ? pos.cashReceived : "" }); }}>',
  'payment method control',
);

replaceOnce(
  '<label>Payment status<select value={pos.paymentStatus} onChange={(e) => setPos({ ...pos, paymentStatus: e.target.value })}>{(pos.paymentMethod === "MMG" ? ["Pending Confirmation", "Paid"] : ["Pay at Pickup", "Paid"]).map((status) => <option key={status}>{status}</option>)}</select>\n</label>',
  '{pos.paymentMethod === "MMG" ? <label>Payment status<select value={pos.paymentStatus} onChange={(e) => setPos({ ...pos, paymentStatus: e.target.value })}>{["Pending Confirmation", "Paid"].map((status) => <option key={status}>{status}</option>)}</select>\n</label> : <label>Payment status<input value="Paid" readOnly /></label>}',
  'payment status control',
);

replaceOnce(
  '{pos.paymentMethod === "MMG" && <label>MMG transaction reference<input value={pos.paymentReference} onChange={(e) => setPos({ ...pos, paymentReference: e.target.value })} placeholder="Required for verification" maxLength={120} required /></label>}\n{profile.role !== "staff" && <fieldset className="discount-box">',
  '{pos.paymentMethod === "MMG" && <label>MMG transaction reference<input value={pos.paymentReference} onChange={(e) => setPos({ ...pos, paymentReference: e.target.value })} placeholder="Required for verification" maxLength={120} required /></label>}\n{pos.paymentMethod === "Cash" && <fieldset className="discount-box">\n<legend>Cash checkout</legend>\n<div className="discount-grid">\n<label>Cash received<input type="number" min="0" step="1" inputMode="numeric" value={pos.cashReceived} onChange={(e) => setPos({ ...pos, cashReceived: e.target.value })} placeholder={String(Math.ceil(posTotal))} required /></label>\n<label>Change due<input value={money(changeDue)} readOnly /></label>\n</div>\n<div className="segmented">\n<button type="button" className={cashReceived === posTotal && posTotal > 0 ? "active" : ""} onClick={() => setPos({ ...pos, cashReceived: String(posTotal) })}>Exact</button>\n{[1000, 2000, 5000, 10000].filter((amount) => amount >= posTotal).map((amount) => <button type="button" key={amount} className={cashReceived === amount ? "active" : ""} onClick={() => setPos({ ...pos, cashReceived: String(amount) })}>{money(amount)}</button>)}\n</div>\n{cashShort && pos.cashReceived && <p>Cash received is {money(posTotal - cashReceived)} short.</p>}\n</fieldset>}\n{profile.role !== "staff" && <fieldset className="discount-box">',
  'cash tender UI',
);

replaceOnce(
  '<button className="primary-wide" type="submit" disabled={busy}>Create order & receipt</button>',
  '<button className="primary-wide" type="submit" disabled={busy || cashShort}>Create order & receipt</button>',
  'submit button',
);

replaceOnce(
  '<dl className="pos-total-breakdown"><div><dt>Subtotal</dt><dd>{money(posSubtotal)}</dd></div>{posDiscount > 0 && <div><dt>Discount</dt><dd>− {money(posDiscount)}</dd></div>}<div className="grand-total"><dt>Total</dt><dd>{money(posTotal)}</dd></div></dl>',
  '<dl className="pos-total-breakdown"><div><dt>Subtotal</dt><dd>{money(posSubtotal)}</dd></div>{posDiscount > 0 && <div><dt>Discount</dt><dd>− {money(posDiscount)}</dd></div>}<div className="grand-total"><dt>Total</dt><dd>{money(posTotal)}</dd></div>{pos.paymentMethod === "Cash" && <><div><dt>Cash received</dt><dd>{money(cashReceived)}</dd></div><div><dt>Change due</dt><dd>{money(changeDue)}</dd></div></>}</dl>',
  'order summary',
);

replaceOnce(
  '<p>Payment: {selectedOrder.payment?.method} · {selectedOrder.payment?.status}</p>',
  '{selectedOrder.payment?.method === "Cash" && Number.isFinite(Number(selectedOrder.payment?.cash_received)) && <><div className="receipt-line"><span>Cash Received</span><strong>{money(selectedOrder.payment?.cash_received)}</strong></div><div className="receipt-line"><span>Change</span><strong>{money(selectedOrder.payment?.change_due)}</strong></div></>}\n<p>Payment: {selectedOrder.payment?.method} · {selectedOrder.payment?.status}</p>',
  'receipt cash lines',
);


replaceOnce(
  'type PosState = { name: string; phone: string; notes: string; paymentMethod: "Cash" | "MMG"; paymentStatus: string; paymentReference: string; cashReceived: string; discountMode: DiscountMode; discountValue: string };',
  'type PosState = { name: string; phone: string; notes: string; paymentMethod: "Cash" | "MMG"; paymentStatus: string; paymentReference: string; cashReceived: string; express: boolean; discountMode: DiscountMode; discountValue: string };',
  'Express POS state',
);

replaceOnce(
  'const emptyPos: PosState = { name: "", phone: "", notes: "", paymentMethod: "Cash", paymentStatus: "Paid", paymentReference: "", cashReceived: "", discountMode: "amount", discountValue: "" };',
  'const emptyPos: PosState = { name: "", phone: "", notes: "", paymentMethod: "Cash", paymentStatus: "Paid", paymentReference: "", cashReceived: "", express: false, discountMode: "amount", discountValue: "" };',
  'Express empty POS state',
);

replaceOnce(
  '  entry_source?: string; original_transaction_at?: string | null; paper_reference?: string | null;\n};',
  '  express?: boolean; express_fee?: number; entry_source?: string; original_transaction_at?: string | null; paper_reference?: string | null;\n};',
  'Express order fields',
);

replaceOnce(
  'const orderColumns = "id,tracking_code,customer_name,customer_phone,items,weight_summary,subtotal,discount,total,status,notes,order_type,scheduled_date,scale_photo_path,payment,created_at,entry_source,original_transaction_at,paper_reference";',
  'const orderColumns = "id,tracking_code,customer_name,customer_phone,items,weight_summary,subtotal,discount,total,status,notes,order_type,scheduled_date,scale_photo_path,payment,express,express_fee,created_at,entry_source,original_transaction_at,paper_reference";',
  'Express order columns',
);

replaceOnce(
  '  const posTotal = Math.max(0, posSubtotal - posDiscount);\n  const cashReceived = Math.max(0, Number(pos.cashReceived || 0));',
  '  const expressFee = pos.express ? Math.round(posSubtotal * 0.50 * 100) / 100 : 0;\n  const posTotal = Math.max(0, posSubtotal + expressFee - posDiscount);\n  const cashReceived = Math.max(0, Number(pos.cashReceived || 0));',
  'Express total calculation',
);

replaceOnce(
  '      p_payment: { method: pos.paymentMethod, status: pos.paymentStatus, reference: pos.paymentReference.trim() || null, ...(pos.paymentMethod === "Cash" ? { cash_received: cashReceived, change_due: changeDue } : {}) },',
  '      p_payment: { method: pos.paymentMethod, status: pos.paymentStatus, reference: pos.paymentReference.trim() || null, express: pos.express, ...(pos.paymentMethod === "Cash" ? { cash_received: cashReceived, change_due: changeDue } : {}) },',
  'Express payment payload',
);

replaceOnce(
  '<button type="button" className="secondary add-line" onClick={() => setPosItems([...posItems, { service_id: services.find((s) => s.active)?.id || "", qty: 1 }])}>+ Add another service</button>\n</div>\n<label>Garment / care notes<textarea value={pos.notes} onChange={(e) => setPos({ ...pos, notes: e.target.value })} placeholder="Item count, stains, special care…" rows={3}/>\n</label>',
  '<button type="button" className="secondary add-line" onClick={() => setPosItems([...posItems, { service_id: services.find((s) => s.active)?.id || "", qty: 1 }])}>+ Add another service</button>\n</div>\n<label className="express-toggle"><span><input type="checkbox" checked={pos.express} onChange={(e) => setPos({ ...pos, express: e.target.checked })}/> Express service +50%</span><small>Same-day / 4–6 hour turnaround when available.</small></label>{pos.express && <div className="express-disclaimer">Laundry received before 12:00 PM → ready by 5:00–6:00 PM<br/>Orders received after 12 PM → ready next morning<br/>Express service is subject to machine availability.<br/>Heavy stains, special treatment and bulky items can attract additional charges.</div>}\n<label>Garment / care notes<textarea value={pos.notes} onChange={(e) => setPos({ ...pos, notes: e.target.value })} placeholder="Item count, stains, special care…" rows={3}/>\n</label>',
  'Express POS control',
);

replaceOnce(
  '<dl className="pos-total-breakdown"><div><dt>Subtotal</dt><dd>{money(posSubtotal)}</dd></div>{posDiscount > 0 && <div><dt>Discount</dt><dd>− {money(posDiscount)}</dd></div>}<div className="grand-total"><dt>Total</dt><dd>{money(posTotal)}</dd></div>{pos.paymentMethod === "Cash" && <><div><dt>Cash received</dt><dd>{money(cashReceived)}</dd></div><div><dt>Change due</dt><dd>{money(changeDue)}</dd></div></>}</dl>',
  '<dl className="pos-total-breakdown"><div><dt>Subtotal</dt><dd>{money(posSubtotal)}</dd></div>{pos.express && <div><dt>Express +50%</dt><dd>{money(expressFee)}</dd></div>}{posDiscount > 0 && <div><dt>Discount</dt><dd>− {money(posDiscount)}</dd></div>}<div className="grand-total"><dt>Total</dt><dd>{money(posTotal)}</dd></div>{pos.paymentMethod === "Cash" && <><div><dt>Cash received</dt><dd>{money(cashReceived)}</dd></div><div><dt>Change due</dt><dd>{money(changeDue)}</dd></div></>}</dl>',
  'Express POS summary',
);

replaceOnce(
  '{selectedOrder.payment?.method === "Cash" && Number.isFinite(Number(selectedOrder.payment?.cash_received)) && <><div className="receipt-line"><span>Cash Received</span><strong>{money(selectedOrder.payment?.cash_received)}</strong></div><div className="receipt-line"><span>Change</span><strong>{money(selectedOrder.payment?.change_due)}</strong></div></>}\n<p>Payment: {selectedOrder.payment?.method} · {selectedOrder.payment?.status}</p>',
  '{selectedOrder.payment?.method === "Cash" && Number.isFinite(Number(selectedOrder.payment?.cash_received)) && <><div className="receipt-line"><span>Cash Received</span><strong>{money(selectedOrder.payment?.cash_received)}</strong></div><div className="receipt-line"><span>Change</span><strong>{money(selectedOrder.payment?.change_due)}</strong></div></>}{selectedOrder.express && <><div className="receipt-line"><span>Express service +50%</span><strong>{money(selectedOrder.express_fee || 0)}</strong></div><p className="express-receipt-note">Laundry received before 12:00 PM → ready by 5:00–6:00 PM<br/>Orders received after 12 PM → ready next morning<br/>Express service is subject to machine availability.<br/>Heavy stains, special treatment and bulky items can attract additional charges.</p></>}\n<p>Payment: {selectedOrder.payment?.method} · {selectedOrder.payment?.status}</p>',
  'Express receipt details',
);

replaceOnce(
  '<strong>{order.weight_summary || \`${order.items?.length || 0} service(s)\`}</strong>\n<small>{order.notes || order.order_type}</small>',
  '<strong>{order.weight_summary || \`${order.items?.length || 0} service(s)\`}</strong>{order.express && <span className="badge express-badge">Express</span>}\n<small>{order.notes || order.order_type}</small>',
  'Express order badge',
);

fs.writeFileSync(path, source);
console.log('Applied POS cash tender and change calculation patch.');
