(function () {
  'use strict';

  const SESSION_KEY = 'laundry_loop_customer_session';
  window.__LAUNDRY_PRODUCTION_READY__ = true;
  const backendReady = () => Boolean(sbClient);
  const showError = (element, message) => {
    if (!element) return;
    element.textContent = message;
    element.classList.remove('hidden');
  };
  const cleanPayment = (payment = {}) => ({
    method: payment.method || 'Cash',
    status: payment.status || 'Pay at Pickup',
    reference: payment.reference || null
  });
  const mapOrder = (row) => ({
    id: row.id,
    code: row.tracking_code,
    name: row.customer_name,
    phone: row.customer_phone,
    items: row.items || [],
    weight: row.weight_summary || '',
    total: Number(row.total || 0),
    status: row.status,
    notes: row.notes || '',
    type: row.order_type,
    date: row.scheduled_date || String(row.created_at || '').slice(0, 10),
    photo: row.scale_photo_url || null,
    payment: row.payment || { method: 'Cash', status: 'Pay at Pickup' }
  });

  async function rpc(name, values) {
    if (!backendReady()) throw new Error('The order service is unavailable. Please try again shortly.');
    const { data, error } = await sbClient.rpc(name, values);
    if (error) throw error;
    return data;
  }

  async function loadStaffOrders() {
    const { data, error } = await sbClient.from('orders').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    ORDERS = (data || []).filter((row) => !['Picked Up (Archived)', 'Cancelled/Refunded'].includes(row.status)).map(mapOrder);
    ARCHIVED_ORDERS = (data || []).filter((row) => ['Picked Up (Archived)', 'Cancelled/Refunded'].includes(row.status)).map(mapOrder);
    renderStaffTable();
  }

  submitCreateAccount = async function () {
    const name = document.getElementById('create-name').value.trim();
    const phone = document.getElementById('create-phone').value.trim();
    const passcode = document.getElementById('create-passcode').value;
    const confirm = document.getElementById('create-passcode-confirm').value;
    const errorBox = document.getElementById('create-error');
    errorBox.classList.add('hidden');
    if (!name || !phone || !passcode) return showError(errorBox, 'Please fill in all fields.');
    if (passcode !== confirm) return showError(errorBox, 'Passcodes do not match.');
    if (passcode.length < 4) return showError(errorBox, 'Use a passcode with at least four characters.');
    try {
      const result = await rpc('customer_signup', { p_name: name, p_phone: phone, p_passcode: passcode });
      localStorage.setItem(SESSION_KEY, result.session_token);
      CURRENT_USER = { id: result.customer_id, name: result.name, phone: result.phone };
      updateAccountNavButton();
      closeModal('auth-modal');
      showView('view-account');
    } catch (error) {
      showError(errorBox, error.message.includes('already') ? 'An account already exists for that phone number.' : error.message);
    }
  };

  submitLogin = async function () {
    const phone = document.getElementById('login-phone').value.trim();
    const passcode = document.getElementById('login-passcode').value;
    const errorBox = document.getElementById('login-error');
    errorBox.classList.add('hidden');
    try {
      const result = await rpc('customer_login', { p_phone: phone, p_passcode: passcode });
      localStorage.setItem(SESSION_KEY, result.session_token);
      CURRENT_USER = { id: result.customer_id, name: result.name, phone: result.phone };
      updateAccountNavButton();
      closeModal('auth-modal');
      showView('view-account');
    } catch (_) {
      showError(errorBox, 'No account matches that phone number and passcode.');
    }
  };

  logOut = function () {
    const token = localStorage.getItem(SESSION_KEY);
    if (token) rpc('customer_logout', { p_session_token: token }).catch(() => {});
    localStorage.removeItem(SESSION_KEY);
    CURRENT_USER = null;
    updateAccountNavButton();
    goHome();
  };

  renderAccountView = async function () {
    const list = document.getElementById('account-orders-list');
    const token = localStorage.getItem(SESSION_KEY);
    if (!CURRENT_USER || !token) {
      list.innerHTML = '<p class="text-[14px]" style="color:var(--sub);">Please log in to view orders.</p>';
      return;
    }
    document.getElementById('account-welcome-msg').textContent = `Welcome back, ${CURRENT_USER.name}.`;
    try {
      const rows = await rpc('customer_order_history', { p_session_token: token });
      const orders = (rows || []).map(mapOrder);
      if (!orders.length) {
        list.innerHTML = '<div class="panel p-6 text-[14px] text-center" style="color:var(--sub);">No orders found under this account.</div>';
        return;
      }
      list.innerHTML = orders.map((o) => `<div class="panel p-5 flex flex-wrap items-center justify-between gap-4"><div><div class="flex items-center gap-2"><div class="font-mono font-medium text-[13px]">${o.code}</div><button type="button" onclick="copyCode('${o.code}', this)" class="text-[10px] text-stone-500 hover:text-stone-900">Copy</button></div><div class="text-[12px] mt-1" style="color:var(--sub);">${o.date} · ${o.weight} · ${o.type}</div></div><div class="flex items-center gap-2">${statusChip(o.status)}${paymentChip(o.payment)}</div><div class="font-mono font-medium text-[14px]">${money(o.total)}</div></div>`).join('');
    } catch (error) {
      localStorage.removeItem(SESSION_KEY);
      CURRENT_USER = null;
      updateAccountNavButton();
      list.innerHTML = `<p class="text-[12px] text-red-700">${error.message}</p>`;
    }
  };

  finalizeOrder = async function (paymentInfo) {
    try {
      const result = await rpc('create_public_order', {
        p_name: PENDING_ORDER.name,
        p_phone: PENDING_ORDER.phone,
        p_items: PENDING_ORDER.items,
        p_notes: PENDING_ORDER.notes,
        p_order_type: PENDING_ORDER.type,
        p_scheduled_date: PENDING_ORDER.date,
        p_payment: cleanPayment(paymentInfo),
        p_session_token: localStorage.getItem(SESSION_KEY)
      });
      const order = mapOrder(result);
      ORDERS.unshift(order);
      renderDoneStep(order);
      showPaymentStep('done');
      document.getElementById('dropoff-form').reset();
      document.getElementById('online-order-form').reset();
      ['dropoff-items', 'online-items'].forEach((id) => { const box = document.getElementById(id); if (box) box.innerHTML = ''; });
      initOrderBuilders();
    } catch (error) {
      alert(`We could not save this order: ${error.message}`);
    }
  };

  processCardPayment = function () {
    alert('Card processing is not active yet. Please choose cash or MMG.');
    showPaymentStep('choose');
  };

  confirmMmgSent = function () {
    const ref = document.getElementById('payment-mmg-proof-ref').value.trim();
    if (!ref) return alert('Enter the MMG transaction reference so staff can verify the payment.');
    finalizeOrder({ method: 'MMG', status: 'Pending Confirmation', reference: ref });
  };

  handleAccountSubmit = async function (event) {
    event.preventDefault();
    if (selectedPaymentMethod === 'Card') {
      alert('Card processing is not active yet. Please choose cash or MMG.');
      return;
    }
    const reference = document.getElementById('invest-mmg-proof-ref').value.trim();
    if (selectedPaymentMethod === 'MMG' && !reference) {
      alert('Enter the MMG transaction reference so staff can verify the payment.');
      return;
    }
    const name = document.getElementById('acc-name').value.trim();
    const phone = document.getElementById('acc-phone').value.trim();
    const passcode = document.getElementById('acc-pass').value;
    try {
      let token = localStorage.getItem(SESSION_KEY);
      if (!CURRENT_USER || !token) {
        const account = await rpc('customer_signup', { p_name: name, p_phone: phone, p_passcode: passcode });
        token = account.session_token;
        localStorage.setItem(SESSION_KEY, token);
        CURRENT_USER = { id: account.customer_id, name: account.name, phone: account.phone };
        updateAccountNavButton();
      }
      const row = await rpc('create_public_order', {
        p_name: name,
        p_phone: phone,
        p_items: [{ label: activePlan.name, qty: 1 }],
        p_notes: activePlan.name === 'Monthly Package' ? 'Wash & Fold · Once per week · Free premium detergent · Up to 40 lbs per week' : 'Wash & Fold · Up to 20 lbs · $200 per additional lb',
        p_order_type: activePlan.name,
        p_scheduled_date: new Date().toISOString().slice(0, 10),
        p_payment: cleanPayment({ method: selectedPaymentMethod, status: selectedPaymentMethod === 'MMG' ? 'Pending Confirmation' : 'Pay at Pickup', reference }),
        p_session_token: token
      });
      document.getElementById('acc-backup-code').innerText = row.tracking_code;
      document.getElementById('step-invest-account').classList.add('hidden');
      document.getElementById('step-invest-success').classList.remove('hidden');
    } catch (error) {
      alert(error.message.includes('already') ? 'An account already exists for this phone number. Log in first, then choose the plan again.' : error.message);
    }
  };

  trackOrder = async function () {
    const code = document.getElementById('track-code-input').value.trim().toUpperCase();
    const resultEl = document.getElementById('track-result');
    try {
      const row = await rpc('track_public_order', { p_tracking_code: code });
      if (!row) throw new Error('Not found');
      const order = mapOrder(row);
      resultEl.innerHTML = `<div class="ticket p-5 mt-4"><div class="flex items-center justify-between mb-3"><div class="flex items-center gap-2"><div class="ticket-code text-base">${order.code}</div><button type="button" onclick="copyCode('${order.code}', this)" class="text-[10px] text-stone-500">Copy</button></div>${paymentChip(order.payment)}</div><div class="my-2">${statusChip(order.status)}</div><div class="ticket-divider"></div><div class="flex justify-between text-[13px]"><span style="color:var(--faint);">Qty/Weight</span><span class="font-medium">${order.weight}</span></div><div class="flex justify-between text-[13px] mt-1"><span style="color:var(--faint);">Total</span><span class="font-medium">${money(order.total)}</span></div></div>`;
    } catch (_) {
      resultEl.innerHTML = `<p class="text-[12px] mt-4 text-red-700">No order found with code ${code}.</p>`;
    }
  };

  submitStaffLogin = async function () {
    const email = document.getElementById('staff-user').value.trim();
    const password = document.getElementById('staff-pass').value;
    const errorBox = document.getElementById('staff-login-error');
    errorBox.classList.add('hidden');
    try {
      const { error } = await sbClient.auth.signInWithPassword({ email, password });
      if (error) throw error;
      const { data: profile, error: profileError } = await sbClient.from('staff_profiles').select('role').single();
      if (profileError || !profile) {
        await sbClient.auth.signOut();
        throw new Error('This account is not authorized for staff access.');
      }
      IS_STAFF_LOGGED_IN = true;
      await loadStaffOrders();
      closeModal('staff-login-modal');
      showView('view-staff');
    } catch (error) {
      showError(errorBox, error.message || 'Invalid credentials.');
    }
  };

  staffLogOut = async function () {
    IS_STAFF_LOGGED_IN = false;
    await sbClient.auth.signOut();
    goHome();
  };

  async function patchOrder(code, values) {
    const { error } = await sbClient.from('orders').update(values).eq('tracking_code', code);
    if (error) throw error;
    await loadStaffOrders();
  }
  updateOrderStatus = (code, status) => patchOrder(code, { status }).catch((error) => alert(error.message));
  markPaid = (code) => {
    const order = ORDERS.find((item) => item.code === code);
    if (!order) return;
    patchOrder(code, { payment: { ...order.payment, status: 'Paid' } }).catch((error) => alert(error.message));
  };
  archiveOrder = (code) => patchOrder(code, { status: 'Picked Up (Archived)' }).catch((error) => alert(error.message));
  cancelRefundOrder = (code) => {
    if (confirm(`Cancel or refund order ${code}?`)) patchOrder(code, { status: 'Cancelled/Refunded' }).catch((error) => alert(error.message));
  };
  saveEditOrder = function () {
    const code = document.getElementById('edit-code').value;
    patchOrder(code, {
      customer_name: document.getElementById('edit-name').value.trim(),
      weight_summary: document.getElementById('edit-weight').value,
      notes: document.getElementById('edit-notes').value.trim()
    }).then(() => closeModal('edit-order-modal')).catch((error) => alert(error.message));
  };

  const posForm = document.getElementById('pos-form');
  posForm.addEventListener('submit', async function (event) {
    if (!IS_STAFF_LOGGED_IN) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const items = getOrderItems('pos');
    if (!items.length) return alert('Please add at least one laundry service.');
    try {
      const result = await rpc('staff_create_order', {
        p_name: document.getElementById('pos-name').value.trim(),
        p_phone: document.getElementById('pos-phone').value.trim(),
        p_items: items,
        p_notes: document.getElementById('pos-notes').value.trim() || 'In-store POS Entry',
        p_payment: cleanPayment({ method: document.getElementById('pos-payment-method').value, status: document.getElementById('pos-payment-status').value })
      });
      closeModal('pos-modal');
      posForm.reset();
      await loadStaffOrders();
      openReceiptModal(result.tracking_code);
    } catch (error) { alert(error.message); }
  }, true);

  async function restoreCustomerSession() {
    const token = localStorage.getItem(SESSION_KEY);
    if (!token) return;
    try {
      const result = await rpc('customer_session_profile', { p_session_token: token });
      CURRENT_USER = { id: result.customer_id, name: result.name, phone: result.phone };
      updateAccountNavButton();
    } catch (_) {
      localStorage.removeItem(SESSION_KEY);
    }
  }

  // The production backend is authoritative. Demo accounts, orders and passcodes
  // stored by older browser-only builds are deliberately ignored.
  ACCOUNTS = [];
  ORDERS = [];
  ARCHIVED_ORDERS = [];
  localStorage.removeItem('lt_accounts');
  localStorage.removeItem('lt_orders');
  localStorage.removeItem('lt_archived');
  localStorage.removeItem('lt_session');
  restoreCustomerSession();
})();
