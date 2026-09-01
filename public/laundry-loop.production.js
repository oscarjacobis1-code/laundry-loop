(function () {
  'use strict';

  const SESSION_KEY = 'laundry_loop_customer_session';
  const CUSTOMER_IDLE_MS = 20 * 60 * 1000;
  let customerIdleTimer = null;
  const PREVIEW_DEMO = location.hostname === 'terminal.local';
  const PREVIEW_STAFF_EMAIL = 'staff@laundryloop.preview';
  const PREVIEW_STAFF_PASSWORD = 'Preview2026!';
  const PHOTO_BUCKET = 'scale-photos';
  const PHOTO_MAX_INPUT_BYTES = 20 * 1024 * 1024;
  const PHOTO_TARGET_BYTES = 900 * 1024;
  const PHOTO_HARD_LIMIT_BYTES = 5 * 1024 * 1024;
  const PHOTO_MAX_EDGE = 1600;
  const DEMO_INVENTORY = [
    { item_id: 'demo-detergent', item_name: 'Premium Detergent', unit: 'litres', on_hand: 12, reorder_level: 5, average_daily_usage_30: 1.4, estimated_days_remaining: 8.6, recommendation: 'Plan a restock within 2 weeks' },
    { item_id: 'demo-softener', item_name: 'Fabric Softener', unit: 'litres', on_hand: 4, reorder_level: 5, average_daily_usage_30: 0.5, estimated_days_remaining: 8, recommendation: 'Below reorder level — restock now' },
    { item_id: 'demo-bags', item_name: 'Laundry Bags', unit: 'each', on_hand: 42, reorder_level: 25, average_daily_usage_30: 3, estimated_days_remaining: 14, recommendation: 'Plan a restock within 2 weeks' }
  ];
  window.__LAUNDRY_PRODUCTION_READY__ = false;
  const backendReady = () => Boolean(sbClient);
  let staffOrdersChannel = null;
  let currentStaffRole = null;
  let compressedScalePhoto = null;
  let orderSubmissionInFlight = false;
  let planSubmissionInFlight = false;
  let loopCreditOptions = [];
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
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
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
    photo: row.scale_photo_url || row.scale_photo_path || null,
    payment: row.payment || { method: 'Cash', status: 'Pay at Pickup' }
  });

  async function rpc(name, values) {
    if (!backendReady()) throw new Error('The order service is unavailable. Please try again shortly.');
    const { data, error } = await sbClient.rpc(name, values);
    if (error) throw error;
    return data;
  }

  async function loadPublicConfiguration() {
    if (!backendReady()) return;
    const [contentResult, serviceResult] = await Promise.all([
      sbClient.from('site_content').select('business_name,tagline,hero_eyebrow,hero_title,hero_emphasis,hero_description,address,directions,maps_url,phone,mmg_number,mmg_name,estimate_disclaimer,loop_credit_options').eq('id', true).single(),
      sbClient.from('service_catalog').select('name,category,rate,unit,active').eq('active', true)
    ]);
    if (contentResult.data) {
      const content = contentResult.data;
      CONFIG = { ...CONFIG, name: content.business_name, tagline: content.tagline, address: content.address, phone: content.phone };
      applyConfig();
      const text = (id, value) => { const element = document.getElementById(id); if (element) element.textContent = value; };
      text('hero-eyebrow', content.hero_eyebrow);
      text('hero-title', content.hero_title);
      text('hero-emphasis', content.hero_emphasis);
      text('hero-description', content.hero_description);
      text('directions-text', content.directions);
      const mapsLink = document.getElementById('maps-link');
      if (mapsLink) mapsLink.href = content.maps_url;
      document.querySelectorAll('[data-mmg-number]').forEach((element) => { element.textContent = content.mmg_number; });
      document.querySelectorAll('[data-mmg-name]').forEach((element) => { element.textContent = content.mmg_name; });
      document.querySelectorAll('[data-estimate-disclaimer]').forEach((element) => { element.textContent = content.estimate_disclaimer; });
      loopCreditOptions = Array.isArray(content.loop_credit_options) ? content.loop_credit_options : [];
    }
    if (serviceResult.data) {
      for (const liveService of serviceResult.data) {
        const localService = SERVICE_OPTIONS.find((service) => service.label === liveService.name);
        if (localService) Object.assign(localService, { group: liveService.category, rate: Number(liveService.rate), unit: liveService.unit });
      }
      const regular = serviceResult.data.find((service) => service.name === 'Regular Laundry');
      const standard = serviceResult.data.find((service) => service.name === 'Standard Package');
      const monthly = serviceResult.data.find((service) => service.name === 'Monthly Package');
      if (regular) document.querySelectorAll('[data-regular-price]').forEach((element) => { element.textContent = `GYD $${Number(regular.rate).toLocaleString()}/${regular.unit}`; });
      if (standard) {
        CONFIG.standardPackagePrice = Number(standard.rate);
        document.querySelectorAll('[data-standard-price]').forEach((element) => { element.textContent = `GYD $${CONFIG.standardPackagePrice.toLocaleString()}`; });
      }
      if (monthly) {
        CONFIG.monthlyPackagePrice = Number(monthly.rate);
        document.querySelectorAll('[data-monthly-price]').forEach((element) => { element.textContent = `GYD $${CONFIG.monthlyPackagePrice.toLocaleString()}/month`; });
      }
      document.querySelectorAll('.service-select').forEach((select) => {
        const selected = Number(select.value || 0);
        select.innerHTML = serviceOptionsHtml(selected);
        select.value = String(selected);
      });
      ['dropoff', 'online', 'calc'].forEach((type) => updateOrderBuilder(type));
    }
    if (contentResult.error) console.warn('Website content could not be refreshed.', contentResult.error.message);
    if (serviceResult.error) console.warn('Live service pricing could not be refreshed.', serviceResult.error.message);
  }

  // The current staff and admin portals are React routes at /staff and /admin.
  // Keep the old static-dashboard compatibility code inactive so it cannot
  // register duplicate order listeners on the public homepage.
  if (false) {
  async function loadStaffOrders() {
    const { data, error } = await sbClient.from('orders').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    const hydrated = await Promise.all((data || []).map(async (row) => {
      if (!row.scale_photo_path) return row;
      const { data: signed } = await sbClient.storage.from(PHOTO_BUCKET).createSignedUrl(row.scale_photo_path, 900);
      return { ...row, scale_photo_url: signed?.signedUrl || null };
    }));
    ORDERS = hydrated.filter((row) => !['Picked Up (Archived)', 'Cancelled/Refunded'].includes(row.status)).map(mapOrder);
    ARCHIVED_ORDERS = hydrated.filter((row) => ['Picked Up (Archived)', 'Cancelled/Refunded'].includes(row.status)).map(mapOrder);
    renderStaffTable();
  }

  function formatBusinessHour(hour) {
    if (hour === null || hour === undefined) return 'Not enough data';
    const normalized = Number(hour) % 24;
    const suffix = normalized >= 12 ? 'PM' : 'AM';
    const display = normalized % 12 || 12;
    return `${display}:00 ${suffix}`;
  }

  function renderOperationsSummary(summary) {
    const box = document.getElementById('staff-operations-summary');
    if (!box) return;
    const cards = [
      ['Orders · 30 days', Number(summary.orders || 0).toLocaleString()],
      ['Revenue · 30 days', money(Number(summary.revenue || 0))],
      ['Busiest order hour', formatBusinessHour(summary.busiest_hour)],
      ['Average time to ready', summary.average_hours_to_ready == null ? 'Building history' : `${summary.average_hours_to_ready} hours`]
    ];
    box.innerHTML = cards.map(([label, value]) => `<div class="panel p-4"><div class="text-[10px] uppercase tracking-[0.08em]" style="color:var(--faint);">${escapeHtml(label)}</div><div class="font-display font-semibold text-xl mt-1">${escapeHtml(value)}</div></div>`).join('');
  }

  function renderInventorySummary(rows) {
    const list = document.getElementById('inventory-summary-list');
    const alerts = document.getElementById('staff-inventory-alerts');
    const select = document.getElementById('inventory-item-id');
    const cardHtml = rows.map((item) => {
      const urgent = /restock now|out of stock/i.test(item.recommendation || '');
      return `<div class="panel p-4" style="border-color:${urgent ? '#F1B7B2' : 'var(--line)'}"><div class="flex items-start justify-between gap-3"><div><div class="font-medium text-[13px]">${escapeHtml(item.item_name)}</div><div class="font-mono text-lg mt-1">${Number(item.on_hand || 0).toLocaleString()} <span class="text-[11px]" style="color:var(--faint);">${escapeHtml(item.unit)}</span></div></div><span class="chip ${urgent ? 'chip-cancelled' : 'chip-ready'}">${urgent ? 'Action' : 'Tracked'}</span></div><p class="text-[11px] mt-2" style="color:var(--sub);">${escapeHtml(item.recommendation)}</p></div>`;
    }).join('');
    if (list) list.innerHTML = cardHtml || '<p class="text-[13px]" style="color:var(--sub);">No inventory items configured.</p>';
    if (select) select.innerHTML = rows.map((item) => `<option value="${escapeHtml(item.item_id)}">${escapeHtml(item.item_name)} · ${escapeHtml(item.unit)}</option>`).join('');
    if (alerts) {
      const urgentRows = rows.filter((item) => /restock now|out of stock|within 7 days/i.test(item.recommendation || ''));
      alerts.innerHTML = urgentRows.map((item) => `<div class="panel px-4 py-3 flex flex-wrap items-center justify-between gap-2" style="border-color:#F1B7B2;background:#FFF8F7;"><span class="text-[12px] font-medium">Inventory: ${escapeHtml(item.item_name)}</span><span class="text-[12px]" style="color:#B42318;">${escapeHtml(item.recommendation)}</span></div>`).join('');
    }
  }

  async function loadStaffInsights() {
    if (PREVIEW_DEMO) {
      renderOperationsSummary({ orders: 18, revenue: 146500, busiest_hour: 10, average_hours_to_ready: 8.4 });
      renderInventorySummary(DEMO_INVENTORY);
      return;
    }
    const [operations, inventory] = await Promise.all([
      rpc('staff_operations_summary', { p_days: 30 }),
      rpc('staff_inventory_summary', {})
    ]);
    renderOperationsSummary(operations || {});
    renderInventorySummary(inventory || []);
  }

  window.openInventoryModal = async function () {
    if (!IS_STAFF_LOGGED_IN) return alert('Authorized staff only.');
    try {
      await loadStaffInsights();
      openModal('inventory-modal');
    } catch (error) {
      alert(error.message);
    }
  };

  window.submitInventoryMovement = async function (event) {
    event.preventDefault();
    if (!IS_STAFF_LOGGED_IN) return alert('Authorized staff only.');
    const itemId = document.getElementById('inventory-item-id').value;
    const movementType = document.getElementById('inventory-movement-type').value;
    const quantity = Number(document.getElementById('inventory-quantity').value);
    const unitCostValue = document.getElementById('inventory-unit-cost').value;
    const note = document.getElementById('inventory-note').value.trim();
    if (!Number.isFinite(quantity) || quantity === 0) return alert('Enter a valid non-zero quantity.');
    try {
      if (PREVIEW_DEMO) {
        const item = DEMO_INVENTORY.find((row) => row.item_id === itemId);
        if (item) item.on_hand += movementType === 'usage' || movementType === 'waste' ? -Math.abs(quantity) : movementType === 'restock' ? Math.abs(quantity) : quantity;
      } else {
        await rpc('staff_record_inventory_movement', {
          p_inventory_item_id: itemId,
          p_movement_type: movementType,
          p_quantity: quantity,
          p_unit_cost: unitCostValue ? Number(unitCostValue) : null,
          p_note: note
        });
      }
      event.target.reset();
      await loadStaffInsights();
      alert('Inventory record saved.');
    } catch (error) {
      alert(error.message);
    }
  };

  function subscribeToStaffOrders() {
    if (staffOrdersChannel) sbClient.removeChannel(staffOrdersChannel);
    staffOrdersChannel = sbClient
      .channel('staff-orders-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => Promise.all([loadStaffOrders(), loadStaffInsights()]).catch(() => {}))
      .subscribe();
  }
  }

  const canvasToBlob = (canvas, type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));

  async function decodeImage(file) {
    if ('createImageBitmap' in window) {
      try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch {}
    }
    const url = URL.createObjectURL(file);
    try {
      return await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('This image could not be read. Please use JPG, PNG or WebP.'));
        image.src = url;
      });
    } finally { URL.revokeObjectURL(url); }
  }

  async function compressScalePhoto(file) {
    if (!file || !file.type.startsWith('image/')) throw new Error('Please choose an image file.');
    if (file.size > PHOTO_MAX_INPUT_BYTES) throw new Error('Choose a photo smaller than 20 MB.');
    const source = await decodeImage(file);
    const sourceWidth = source.width || source.naturalWidth;
    const sourceHeight = source.height || source.naturalHeight;
    if (!sourceWidth || !sourceHeight) throw new Error('The photo has invalid dimensions.');
    const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: false });
    context.fillStyle = '#fff';
    context.fillRect(0, 0, width, height);
    context.drawImage(source, 0, 0, width, height);
    if (typeof source.close === 'function') source.close();
    let mime = 'image/webp';
    let quality = 0.84;
    let blob = await canvasToBlob(canvas, mime, quality);
    if (!blob) {
      mime = 'image/jpeg';
      blob = await canvasToBlob(canvas, mime, quality);
    }
    while (blob && blob.size > PHOTO_TARGET_BYTES && quality > 0.5) {
      quality -= 0.08;
      blob = await canvasToBlob(canvas, mime, quality);
    }
    if (!blob || blob.size > PHOTO_HARD_LIMIT_BYTES) throw new Error('The photo could not be compressed below 5 MB. Try a smaller image.');
    return { blob, width, height, mime, originalBytes: file.size };
  }

  async function uploadScalePhoto(order, photo) {
    if (!photo || !order.photo_upload_token) return null;
    const extension = photo.mime === 'image/webp' ? 'webp' : 'jpg';
    const path = `orders/${order.id}/${crypto.randomUUID()}.${extension}`;
    const { error } = await sbClient.storage.from(PHOTO_BUCKET).upload(path, photo.blob, {
      contentType: photo.mime,
      cacheControl: '3600',
      upsert: false,
      metadata: { upload_token: order.photo_upload_token }
    });
    if (error) throw error;
    await rpc('attach_public_scale_photo', {
      p_order_id: order.id,
      p_upload_token: order.photo_upload_token,
      p_path: path,
      p_bytes: photo.blob.size,
      p_width: photo.width,
      p_height: photo.height,
      p_mime: photo.mime
    });
    return path;
  }

  const photoInput = document.getElementById('dropoff-photo-input');
  if (photoInput) photoInput.addEventListener('change', async function (event) {
    event.stopImmediatePropagation();
    const file = event.target.files?.[0];
    const preview = document.getElementById('dropoff-photo-preview');
    compressedScalePhoto = null;
    dropoffPhotoBase64 = null;
    if (!file) {
      preview.innerHTML = '<span class="text-[10px] text-center px-1" style="color:var(--faint);">No photo</span>';
      return;
    }
    preview.innerHTML = '<span class="text-[10px] text-center px-1" style="color:var(--faint);">Compressing…</span>';
    try {
      compressedScalePhoto = await compressScalePhoto(file);
      dropoffPhotoBase64 = 'compressed-ready';
      const previewUrl = URL.createObjectURL(compressedScalePhoto.blob);
      preview.innerHTML = `<img src="${previewUrl}" alt="Compressed scale photo preview" class="w-full h-full object-cover">`;
      preview.querySelector('img').addEventListener('load', () => URL.revokeObjectURL(previewUrl), { once: true });
    } catch (error) {
      event.target.value = '';
      preview.innerHTML = '<span class="text-[10px] text-center px-1 text-red-700">Invalid photo</span>';
      alert(error.message);
    }
  }, true);

  window.submitCreateAccount = async function () {
    const name = document.getElementById('create-name').value.trim();
    const phone = document.getElementById('create-phone').value.trim();
    const passcode = document.getElementById('create-passcode').value;
    const confirm = document.getElementById('create-passcode-confirm').value;
    const errorBox = document.getElementById('create-error');
    errorBox.classList.add('hidden');
    if (!name || !phone || !passcode) return showError(errorBox, 'Please fill in all fields.');
    if (passcode !== confirm) return showError(errorBox, 'Passcodes do not match.');
    if (passcode.length < 6) return showError(errorBox, 'Use a passcode with at least six characters.');
    try {
      const result = await rpc('customer_signup', { p_name: name, p_phone: phone, p_passcode: passcode });
      sessionStorage.setItem(SESSION_KEY, result.session_token);
      resetCustomerIdleTimer();
      CURRENT_USER = { id: result.customer_id, name: result.name, phone: result.phone };
      if (result.recovery_code) alert(`Account created. Save this recovery code somewhere private: ${result.recovery_code}`);
      updateAccountNavButton();
      closeModal('auth-modal');
      showView('view-account');
    } catch (error) {
      showError(errorBox, error.message.includes('already') ? 'An account already exists for that phone number.' : error.message);
    }
  };

  window.submitLogin = async function () {
    const phone = document.getElementById('login-phone').value.trim();
    const passcode = document.getElementById('login-passcode').value;
    const errorBox = document.getElementById('login-error');
    errorBox.classList.add('hidden');
    try {
      const result = await rpc('customer_login', { p_phone: phone, p_passcode: passcode });
      sessionStorage.setItem(SESSION_KEY, result.session_token);
      resetCustomerIdleTimer();
      CURRENT_USER = { id: result.customer_id, name: result.name, phone: result.phone };
      document.getElementById('login-passcode').value = '';
      if (result.recovery_code) alert(`Your account now has password recovery. Save this private code: ${result.recovery_code}`);
      updateAccountNavButton();
      closeModal('auth-modal');
      showView('view-account');
    } catch {
      showError(errorBox, 'No account matches that phone number and passcode.');
    }
  };

  window.resetCustomerPasscode = async function () {
    const errorBox = document.getElementById('recover-error');
    errorBox.classList.add('hidden');
    try {
      const newRecoveryCode = await rpc('customer_reset_passcode', {
        p_phone: document.getElementById('recover-phone').value.trim(),
        p_recovery_code: document.getElementById('recover-code').value.trim(),
        p_new_passcode: document.getElementById('recover-passcode').value
      });
      document.getElementById('recover-code').value = '';
      document.getElementById('recover-passcode').value = '';
      switchAuthTab('login');
      alert(`Passcode reset and old sessions closed. Save your new recovery code: ${newRecoveryCode}`);
    } catch (error) { showError(errorBox, error.message); }
  };

  window.logOut = function () {
    const token = sessionStorage.getItem(SESSION_KEY);
    if (token) rpc('customer_logout', { p_session_token: token }).catch(() => {});
    sessionStorage.removeItem(SESSION_KEY);
    window.clearTimeout(customerIdleTimer);
    CURRENT_USER = null;
    ['login-passcode','create-passcode','create-passcode-confirm','acc-pass','recover-passcode','recover-code'].forEach((id) => { const field=document.getElementById(id); if(field) field.value=''; });
    updateAccountNavButton();
    goHome();
  };

  function resetCustomerIdleTimer() {
    if (!sessionStorage.getItem(SESSION_KEY)) return;
    window.clearTimeout(customerIdleTimer);
    customerIdleTimer = window.setTimeout(() => {
      window.logOut();
      alert('You were signed out after 20 minutes of inactivity.');
    }, CUSTOMER_IDLE_MS);
  }

  ['pointerdown', 'keydown', 'touchstart', 'scroll'].forEach((eventName) => {
    window.addEventListener(eventName, resetCustomerIdleTimer, { passive: true });
  });

  window.renderAccountView = async function () {
    const list = document.getElementById('account-orders-list');
    const token = sessionStorage.getItem(SESSION_KEY);
    if (!CURRENT_USER || !token) {
      list.innerHTML = '<p class="text-[14px]" style="color:var(--sub);">Please log in to view orders.</p>';
      return;
    }
    document.getElementById('account-welcome-msg').textContent = `Welcome back, ${CURRENT_USER.name}.`;
    try {
      const [rows, summary] = await Promise.all([
        rpc('customer_order_history', { p_session_token: token }),
        rpc('customer_account_summary', { p_session_token: token })
      ]);
      renderSubscriptionSummary(summary);
      const orders = (rows || []).map(mapOrder);
      if (!orders.length) {
        list.innerHTML = '<div class="panel p-6 text-[14px] text-center" style="color:var(--sub);">No orders found under this account.</div>';
        return;
      }
      list.innerHTML = orders.map((o) => `<div class="panel p-5 flex flex-wrap items-center justify-between gap-4"><div><div class="flex items-center gap-2"><div class="font-mono font-medium text-[13px]">${o.code}</div><button type="button" onclick="copyCode('${o.code}', this)" class="text-[10px] text-stone-500 hover:text-stone-900">Copy</button></div><div class="text-[12px] mt-1" style="color:var(--sub);">${o.date} · ${o.weight} · ${o.type}</div></div><div class="flex items-center gap-2">${statusChip(o.status)}${paymentChip(o.payment)}</div><div class="font-mono font-medium text-[14px]">${money(o.total)}</div></div>`).join('');
    } catch (error) {
      sessionStorage.removeItem(SESSION_KEY);
      CURRENT_USER = null;
      updateAccountNavButton();
      list.innerHTML = `<p class="text-[12px] text-red-700">${error.message}</p>`;
    }
  };

  function renderSubscriptionSummary(summary) {
    const box = document.getElementById('account-subscription');
    if (!box) return;
    const subscription = summary?.subscription;
    loopCreditOptions = summary?.loop_credit_options || loopCreditOptions;
    if (!subscription) { box.classList.add('hidden'); box.innerHTML=''; return; }
    box.classList.remove('hidden');
    box.innerHTML = `<div class="flex flex-wrap items-start justify-between gap-5"><div><span class="eyebrow">Active monthly plan</span><h3 class="font-display font-semibold text-2xl mt-1">${Number(subscription.remaining_pounds).toLocaleString()} lbs remaining this week</h3><p class="text-[13px] mt-2" style="color:var(--sub);">${Number(subscription.used_pounds).toLocaleString()} of ${Number(subscription.weekly_pounds).toLocaleString()} lbs used · ${subscription.days_remaining} days remaining · ${subscription.credit_balance} Loop Credits</p></div><button class="btn btn-accent" onclick="openLoopCredits()">Ran Out of Washes? Get more Loop Credits here</button></div>`;
  }

  window.openLoopCredits = function () {
    const list=document.getElementById('loop-credit-options');
    list.innerHTML=loopCreditOptions.map((option)=>`<button class="btn btn-outline w-full p-4 flex items-center justify-between" onclick="buyLoopCredits('${escapeHtml(option.id)}')"><span><strong>${Number(option.credits).toLocaleString()} credits</strong> / ${Number(option.pounds).toLocaleString()} lbs</span><strong>${money(option.price)}</strong></button>`).join('');
    openModal('loop-credit-modal');
  };

  window.buyLoopCredits = async function (optionId) {
    const option=loopCreditOptions.find((item)=>item.id===optionId); if(!option)return;
    const method=confirm('Press OK for MMG, or Cancel to pay cash in person.')?'MMG':'Cash';
    let reference=null; if(method==='MMG'){reference=prompt('Enter the MMG transaction reference:'); if(!reference)return;}
    try {
      const order=await rpc('create_loop_credit_request',{p_session_token:sessionStorage.getItem(SESSION_KEY),p_option_id:optionId,p_payment:cleanPayment({method,status:method==='MMG'?'Pending Confirmation':'Pay at Pickup',reference})});
      closeModal('loop-credit-modal');
      alert(`Loop Credit request ${order.tracking_code} received. Staff will verify payment and apply the credits.`);
      await renderAccountView();
    } catch(error){alert(error.message);}
  };

  window.finalizeOrder = async function (paymentInfo) {
    if (orderSubmissionInFlight) return;
    orderSubmissionInFlight = true;
    try {
      const result = await rpc('create_public_order', {
        p_name: PENDING_ORDER.name,
        p_phone: PENDING_ORDER.phone,
        p_items: PENDING_ORDER.items,
        p_notes: PENDING_ORDER.notes,
        p_order_type: PENDING_ORDER.type,
        p_scheduled_date: PENDING_ORDER.date,
        p_payment: cleanPayment(paymentInfo),
        p_session_token: sessionStorage.getItem(SESSION_KEY),
        p_has_scale_photo: Boolean(compressedScalePhoto)
      });
      if (compressedScalePhoto) await uploadScalePhoto(result, compressedScalePhoto);
      const order = mapOrder(result);
      ORDERS.unshift(order);
      renderDoneStep(order);
      showPaymentStep('done');
      document.getElementById('dropoff-form').reset();
      document.getElementById('online-order-form').reset();
      dropoffPhotoBase64 = null;
      compressedScalePhoto = null;
      document.getElementById('dropoff-photo-preview').innerHTML = '<span class="text-[10px] text-center px-1" style="color:var(--faint);">No photo</span>';
      ['dropoff-items', 'online-items'].forEach((id) => { const box = document.getElementById(id); if (box) box.innerHTML = ''; });
      initOrderBuilders();
    } catch (error) {
      alert(`We could not save this order: ${error.message}`);
    } finally {
      orderSubmissionInFlight = false;
    }
  };

  window.confirmMmgSent = function () {
    const ref = document.getElementById('payment-mmg-proof-ref').value.trim();
    if (!ref) return alert('Enter the MMG transaction reference so staff can verify the payment.');
    finalizeOrder({ method: 'MMG', status: 'Pending Confirmation', reference: ref });
  };

  window.handleAccountSubmit = async function (event) {
    event.preventDefault();
    if (planSubmissionInFlight) return;
    const reference = document.getElementById('invest-mmg-proof-ref').value.trim();
    if (selectedPaymentMethod === 'MMG' && !reference) {
      alert('Enter the MMG transaction reference so staff can verify the payment.');
      return;
    }
    const name = document.getElementById('acc-name').value.trim();
    const phone = document.getElementById('acc-phone').value.trim();
    const passcode = document.getElementById('acc-pass').value;
    const whatsappWindow = window.open('', '_blank');
    planSubmissionInFlight = true;
    try {
      let token = sessionStorage.getItem(SESSION_KEY);
      if (!CURRENT_USER || !token) {
        const account = await rpc('customer_signup', { p_name: name, p_phone: phone, p_passcode: passcode });
        token = account.session_token;
        sessionStorage.setItem(SESSION_KEY, token);
        resetCustomerIdleTimer();
        CURRENT_USER = { id: account.customer_id, name: account.name, phone: account.phone };
        if (account.recovery_code) alert(`Save this private account recovery code: ${account.recovery_code}`);
        updateAccountNavButton();
      }
      const row = activePlan.name === 'Monthly Package' ? await rpc('create_subscription_request', {
        p_name: name, p_phone: phone,
        p_payment: cleanPayment({ method: selectedPaymentMethod, status: selectedPaymentMethod === 'MMG' ? 'Pending Confirmation' : 'Pay at Pickup', reference }),
        p_session_token: token
      }) : await rpc('create_public_order', {
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
      const confirmation=`Thank you for choosing The Laundry Loop. Your subscription request ${row.tracking_code} is being processed. You will receive a message shortly confirming your active subscription.`;
      if (whatsappWindow) whatsappWindow.location.href=`https://wa.me/${String(phone).replace(/\D/g,'').replace(/^0?([0-9]{7})$/,'592$1')}?text=${encodeURIComponent(confirmation)}`;
    } catch (error) {
      if (whatsappWindow) whatsappWindow.close();
      alert(error.message.includes('already') ? 'An account already exists for this phone number. Log in first, then choose the plan again.' : error.message);
    } finally {
      planSubmissionInFlight = false;
    }
  };

  window.trackOrder = async function () {
    const code = document.getElementById('track-code-input').value.trim().toUpperCase();
    const resultEl = document.getElementById('track-result');
    try {
      const row = await rpc('track_public_order', { p_tracking_code: code });
      if (!row) throw new Error('Not found');
      const order = mapOrder(row);
      resultEl.innerHTML = `<div class="ticket p-5 mt-4"><div class="flex items-center justify-between mb-3"><div class="flex items-center gap-2"><div class="ticket-code text-base">${order.code}</div><button type="button" onclick="copyCode('${order.code}', this)" class="text-[10px] text-stone-500">Copy</button></div>${paymentChip(order.payment)}</div><div class="my-2">${statusChip(order.status)}</div><div class="ticket-divider"></div><div class="flex justify-between text-[13px]"><span style="color:var(--faint);">Qty/Weight</span><span class="font-medium">${order.weight}</span></div><div class="flex justify-between text-[13px] mt-1"><span style="color:var(--faint);">Total</span><span class="font-medium">${money(order.total)}</span></div></div>`;
    } catch {
      resultEl.innerHTML = `<p class="text-[12px] mt-4 text-red-700">No order found with code ${code}.</p>`;
    }
  };

  if (false) {
  window.submitStaffLogin = async function () {
    const email = document.getElementById('staff-user').value.trim();
    const password = document.getElementById('staff-pass').value;
    const errorBox = document.getElementById('staff-login-error');
    errorBox.classList.add('hidden');
    try {
      if (PREVIEW_DEMO && email === PREVIEW_STAFF_EMAIL && password === PREVIEW_STAFF_PASSWORD) {
        IS_STAFF_LOGGED_IN = true;
        ORDERS = JSON.parse(JSON.stringify(SEED_ORDERS));
        ARCHIVED_ORDERS = [];
        renderStaffTable();
        await loadStaffInsights();
        closeModal('staff-login-modal');
        showView('view-staff');
        return;
      }
      const { error } = await sbClient.auth.signInWithPassword({ email, password });
      if (error) throw error;
      const { data: profile, error: profileError } = await sbClient.from('staff_profiles').select('role, display_name, active').single();
      if (profileError || !profile) {
        await sbClient.auth.signOut();
        throw new Error('This account is not authorized for staff access.');
      }
      if (!profile.active) throw new Error('This staff account has been disabled.');
      currentStaffRole = profile.role;
      IS_STAFF_LOGGED_IN = true;
      applyStaffRole(profile);
      await loadStaffOrders();
      await loadStaffInsights();
      subscribeToStaffOrders();
      closeModal('staff-login-modal');
      showView('view-staff');
    } catch (error) {
      showError(errorBox, error.message || 'Invalid credentials.');
    }
  };

  window.staffLogOut = async function () {
    IS_STAFF_LOGGED_IN = false;
    currentStaffRole = null;
    if (staffOrdersChannel) {
      await sbClient.removeChannel(staffOrdersChannel);
      staffOrdersChannel = null;
    }
    await sbClient.auth.signOut();
    if (location.pathname === '/admin') {
      showView('view-landing');
      handleStaffNav();
    } else {
      goHome();
    }
  };

  function applyStaffRole(profile) {
    const role = profile?.role || 'staff';
    const isAdmin = role === 'admin';
    const title = document.getElementById('staff-dashboard-title');
    const chip = document.getElementById('staff-role-chip');
    if (title) title.textContent = isAdmin ? 'Administration Dashboard' : 'Staff Dashboard';
    if (chip) chip.textContent = isAdmin ? 'Administrator' : role === 'manager' ? 'Manager' : 'Staff';
    document.querySelectorAll('[data-admin-only]').forEach((element) => element.classList.toggle('hidden', !isAdmin));
  }

  window.openStaffRecovery = function () {
    const loginEmail = document.getElementById('staff-user')?.value.trim();
    const recoveryEmail = document.getElementById('staff-recovery-email');
    if (recoveryEmail && loginEmail) recoveryEmail.value = loginEmail;
    closeModal('staff-login-modal');
    openModal('staff-recovery-modal');
  };

  window.closeStaffRecovery = function () {
    closeModal('staff-recovery-modal');
    openModal('staff-login-modal');
  };

  window.requestStaffPasswordReset = async function () {
    const email = document.getElementById('staff-recovery-email').value.trim();
    const status = document.getElementById('staff-recovery-status');
    status.classList.add('hidden');
    if (!email) return showError(status, 'Enter your staff email address.');
    const { error } = await sbClient.auth.resetPasswordForEmail(email, {
      redirectTo: `${location.origin}/admin`
    });
    if (error) return showError(status, error.message);
    status.textContent = 'If this is an authorized account, a recovery email has been sent. Check your inbox and spam folder.';
    status.classList.remove('hidden', 'text-red-700');
    status.classList.add('text-blue-800');
  };

  window.completeStaffPasswordReset = async function () {
    const password = document.getElementById('staff-new-password').value;
    const confirmation = document.getElementById('staff-new-password-confirm').value;
    const status = document.getElementById('staff-new-password-status');
    status.classList.add('hidden');
    if (password.length < 10) return showError(status, 'Use at least 10 characters.');
    if (password !== confirmation) return showError(status, 'The passwords do not match.');
    const { error } = await sbClient.auth.updateUser({ password });
    if (error) return showError(status, error.message);
    status.textContent = 'Password updated. You can now enter the dashboard.';
    status.classList.remove('hidden', 'text-red-700');
    status.classList.add('text-blue-800');
    setTimeout(async () => {
      closeModal('staff-new-password-modal');
      await restoreStaffSession();
    }, 700);
  };

  async function restoreStaffSession() {
    if (location.pathname !== '/admin') return;
    const { data: { session } } = await sbClient.auth.getSession();
    if (!session) {
      handleStaffNav();
      return;
    }
    const { data: profile, error } = await sbClient.from('staff_profiles').select('role, display_name, active').single();
    if (error || !profile?.active) {
      await sbClient.auth.signOut();
      handleStaffNav();
      return;
    }
    currentStaffRole = profile.role;
    IS_STAFF_LOGGED_IN = true;
    applyStaffRole(profile);
    await loadStaffOrders();
    await loadStaffInsights();
    subscribeToStaffOrders();
    closeModal('staff-login-modal');
    showView('view-staff');
  }

  async function patchOrder(code, values) {
    if (PREVIEW_DEMO) {
      const order = ORDERS.find((item) => item.code === code) || ARCHIVED_ORDERS.find((item) => item.code === code);
      if (!order) throw new Error('Order not found.');
      if (values.status) order.status = values.status;
      if (values.payment) order.payment = values.payment;
      if (values.customer_name) order.name = values.customer_name;
      if (values.weight_summary) order.weight = values.weight_summary;
      if (values.total !== undefined) order.total = Number(values.total);
      if (typeof values.notes === 'string') order.notes = values.notes;
      if (order.status === 'Picked Up (Archived)' || order.status === 'Cancelled/Refunded') {
        ORDERS = ORDERS.filter((item) => item.code !== code);
        if (!ARCHIVED_ORDERS.some((item) => item.code === code)) ARCHIVED_ORDERS.unshift(order);
      }
      renderStaffTable();
      return;
    }
    const { error } = await sbClient.from('orders').update(values).eq('tracking_code', code);
    if (error) throw error;
    await loadStaffOrders();
  }
  window.updateOrderStatus = (code, status) => patchOrder(code, { status }).catch((error) => alert(error.message));
  window.markPaid = (code) => {
    const order = ORDERS.find((item) => item.code === code);
    if (!order) return;
    patchOrder(code, { payment: { ...order.payment, status: 'Paid' } }).catch((error) => alert(error.message));
  };
  window.applyDiscount = async function () {
    if (!IS_STAFF_LOGGED_IN) return alert('Authorized staff only.');
    const code = document.getElementById('discount-code').value.trim().toUpperCase();
    const value = Number(document.getElementById('discount-val').value);
    const type = document.getElementById('discount-type').value;
    const order = ORDERS.find((item) => item.code === code);
    if (!order) return alert('Order not found or already archived.');
    if (!Number.isFinite(value) || value <= 0) return alert('Enter a valid discount amount.');
    if (type === 'percent' && value > 100) return alert('Percentage discounts cannot exceed 100%.');
    const newTotal = type === 'percent'
      ? Math.max(0, order.total * (1 - value / 100))
      : Math.max(0, order.total - value);
    try {
      await patchOrder(code, { total: Math.round(newTotal * 100) / 100 });
      closeModal('discount-modal');
      document.getElementById('discount-code').value = '';
      document.getElementById('discount-val').value = '';
      alert(`Discount saved. New total: ${money(newTotal)}`);
    } catch (error) {
      alert(error.message);
    }
  };
  window.openScalePhoto = async function (code) {
    if (!IS_STAFF_LOGGED_IN) return alert('Authorized staff only.');
    const order = ORDERS.find((item) => item.code === code) || ARCHIVED_ORDERS.find((item) => item.code === code);
    if (!order?.photo) return alert('No scale photo is attached to this order.');
    if (/^https?:\/\//i.test(order.photo)) {
      window.open(order.photo, '_blank', 'noopener,noreferrer');
      return;
    }
    const { data, error } = await sbClient.storage.from('scale-photos').createSignedUrl(order.photo, 300);
    if (error) return alert(error.message);
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  };
  window.archiveOrder = (code) => patchOrder(code, { status: 'Picked Up (Archived)' }).catch((error) => alert(error.message));
  window.cancelRefundOrder = (code) => {
    if (confirm(`Cancel or refund order ${code}?`)) patchOrder(code, { status: 'Cancelled/Refunded' }).catch((error) => alert(error.message));
  };
  window.saveEditOrder = function () {
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
      if (PREVIEW_DEMO) {
        const previewOrder = {
          code: generateCode(),
          name: document.getElementById('pos-name').value.trim(),
          phone: document.getElementById('pos-phone').value.trim(),
          items,
          weight: items.map((item) => `${item.qty} ${item.unit}`).join(', '),
          total: items.reduce((sum, item) => sum + item.total, 0),
          notes: document.getElementById('pos-notes').value.trim() || 'In-store POS Entry',
          type: 'In-Store Walk-In POS',
          date: new Date().toISOString().slice(0, 10),
          status: 'Received',
          payment: cleanPayment({ method: document.getElementById('pos-payment-method').value, status: document.getElementById('pos-payment-status').value })
        };
        ORDERS.unshift(previewOrder);
        closeModal('pos-modal');
        posForm.reset();
        renderStaffTable();
        openReceiptModal(previewOrder.code);
        return;
      }
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
  }

  async function restoreCustomerSession() {
    const token = sessionStorage.getItem(SESSION_KEY);
    if (!token) return;
    try {
      const result = await rpc('customer_session_profile', { p_session_token: token });
      CURRENT_USER = { id: result.customer_id, name: result.name, phone: result.phone };
      updateAccountNavButton();
      resetCustomerIdleTimer();
    } catch {
      sessionStorage.removeItem(SESSION_KEY);
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
  window.__LAUNDRY_PRODUCTION_READY__ = true;
  loadPublicConfiguration().catch((error) => console.warn('Public configuration refresh failed.', error.message));
  restoreCustomerSession();
})();
