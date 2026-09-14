import fs from 'node:fs';

const path = 'app/portal/Portal.tsx';
let source = fs.readFileSync(path, 'utf8');

if (source.includes('Cash tender details did not sync')) {
  console.log('Cash tender persistence patch already applied.');
  process.exit(0);
}

const from = `      const firstActive = services.find((service) => service.active);\n      setPos(emptyPos); setPosItems([{ service_id: firstActive?.id ?? "", qty: 1 }]); await loadDashboard();\n      const saved = data as Order;\n      const receiptOrder = pos.paymentMethod === "Cash" ? { ...saved, payment: { ...(saved.payment || {}), method: "Cash", status: "Paid", cash_received: cashReceived, change_due: changeDue } } : saved;\n      setSelectedOrder(receiptOrder); setView("orders"); setMessage(\`Order \${saved.tracking_code} created. Receipt is ready to print.\`);`;

const to = `      const firstActive = services.find((service) => service.active);\n      const saved = data as Order;\n      let receiptOrder = pos.paymentMethod === "Cash" ? { ...saved, payment: { ...(saved.payment || {}), method: "Cash", status: "Paid", cash_received: cashReceived, change_due: changeDue } } : saved;\n      let cashSyncWarning = false;\n      if (pos.paymentMethod === "Cash") {\n        const { data: syncedOrder, error: cashSyncError } = await supabase\n          .from("orders")\n          .update({ payment: receiptOrder.payment })\n          .eq("id", saved.id)\n          .select(orderColumns)\n          .single();\n        if (!cashSyncError && syncedOrder) receiptOrder = syncedOrder as Order;\n        else cashSyncWarning = true;\n      }\n      setPos(emptyPos); setPosItems([{ service_id: firstActive?.id ?? "", qty: 1 }]);\n      await loadDashboard();\n      setSelectedOrder(receiptOrder); setView("orders");\n      setMessage(cashSyncWarning\n        ? \`Order \${saved.tracking_code} created. Cash tender details did not sync, but the receipt is ready to print.\`\n        : \`Order \${saved.tracking_code} created. Receipt is ready to print.\`);`;

if (!source.includes(from)) {
  throw new Error('Could not find generated cash receipt block. Run apply-pos-cash-tender.mjs first.');
}

source = source.replace(from, to);
fs.writeFileSync(path, source);
console.log('Applied cash tender persistence patch.');
