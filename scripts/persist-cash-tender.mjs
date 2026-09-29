import fs from 'node:fs';

const path = 'app/portal/Portal.tsx';
let source = fs.readFileSync(path, 'utf8');

if (source.includes('Cash tender details did not sync')) {
  console.log('Cash tender persistence patch already applied.');
  process.exit(0);
}

const from = `      const saved = data as Order;
      const receiptOrder = pos.paymentMethod === "Cash" ? { ...saved, payment: { ...(saved.payment || {}), method: "Cash", status: "Paid", cash_received: cashReceived, change_due: changeDue } } : saved;
      setPos(emptyPos); setPosItems([{ service_id: defaultPosService?.id ?? "", qty: 1 }]);
      // The order is already committed by staff_create_order. Show the receipt immediately
      // and refresh the heavier dashboard queries in the background.
      setOrders(current => [receiptOrder, ...current.filter(order => order.id !== saved.id)]);
      setSelectedOrder(receiptOrder); setView("orders"); setMessage(\`Order \${saved.tracking_code} created. Receipt is ready to print.\`);
      void loadDashboard(profile?.role);`;

const to = `      const saved = data as Order;
      const receiptOrder = pos.paymentMethod === "Cash" ? { ...saved, payment: { ...(saved.payment || {}), method: "Cash", status: "Paid", cash_received: cashReceived, change_due: changeDue } } : saved;
      if (pos.paymentMethod === "Cash") {
        // Persist tender details without blocking the cashier or receipt.
        void supabase.from("orders").update({ payment: receiptOrder.payment }).eq("id", saved.id);
      }
      setPos(emptyPos); setPosItems([{ service_id: defaultPosService?.id ?? "", qty: 1 }]);
      setOrders(current => [receiptOrder, ...current.filter(order => order.id !== saved.id)]);
      setSelectedOrder(receiptOrder); setView("orders"); setMessage(\`Order \${saved.tracking_code} created. Receipt is ready to print.\`);
      void loadDashboard(profile?.role);`;

if (!source.includes(from)) {
  throw new Error('Could not find generated cash receipt block. Run apply-pos-cash-tender.mjs first.');
}

source = source.replace(from, to);
fs.writeFileSync(path, source);
console.log('Applied cash tender persistence patch.');
