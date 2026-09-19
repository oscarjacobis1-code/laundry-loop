"use client";

import { useEffect } from "react";

const MIN_WEIGHT_LB = 5;
const STYLE_ID = "ll-pos-efficiency-style";
const QUICK_ID = "ll-pos-quick-services";
const CHECKOUT_ID = "ll-pos-fast-checkout";

function isWeightService(select: HTMLSelectElement) {
  const option = select.selectedOptions?.[0];
  if (!option) return false;
  return /\/lb\b/i.test(option.textContent || "");
}

function setNativeValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function applyGuard() {
  document.querySelectorAll<HTMLElement>(".service-row").forEach((row) => {
    const select = row.querySelector<HTMLSelectElement>("select");
    const input = row.querySelector<HTMLInputElement>('input[type="number"]');
    if (!select || !input) return;

    if (isWeightService(select)) {
      input.min = String(MIN_WEIGHT_LB);
      const current = Number(input.value || 0);
      if (current > 0 && current < MIN_WEIGHT_LB) setNativeValue(input, String(MIN_WEIGHT_LB));
    } else {
      input.min = "0.5";
    }
  });
}

function findServiceOption(select: HTMLSelectElement, serviceName: string) {
  return Array.from(select.options).find((option) =>
    (option.textContent || "").trim().toLowerCase().startsWith(serviceName.toLowerCase()),
  );
}

function chooseQuickService(serviceName: string) {
  const form = document.querySelector<HTMLFormElement>("form.pos-form");
  if (!form) return;

  const rows = Array.from(form.querySelectorAll<HTMLElement>(".service-row"));
  let targetRow = rows.find((row) => {
    const select = row.querySelector<HTMLSelectElement>("select");
    return !!select && !!findServiceOption(select, serviceName) && select.selectedOptions[0]?.textContent?.trim().toLowerCase().startsWith(serviceName.toLowerCase());
  });

  if (!targetRow) {
    targetRow = rows.find((row) => !(row.querySelector<HTMLSelectElement>("select")?.value));
  }

  const applyToRow = (row: HTMLElement | undefined) => {
    if (!row) return;
    const select = row.querySelector<HTMLSelectElement>("select");
    const qty = row.querySelector<HTMLInputElement>('input[type="number"]');
    if (!select || !qty) return;
    const option = findServiceOption(select, serviceName);
    if (!option) return;
    select.value = option.value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    window.requestAnimationFrame(() => {
      applyGuard();
      if (Number(qty.value || 0) < MIN_WEIGHT_LB) setNativeValue(qty, String(MIN_WEIGHT_LB));
      qty.focus();
      qty.select();
    });
  };

  if (targetRow) {
    applyToRow(targetRow);
    return;
  }

  const addButton = form.querySelector<HTMLButtonElement>("button.add-line");
  if (!addButton) return;
  addButton.click();
  window.setTimeout(() => {
    const updatedRows = Array.from(form.querySelectorAll<HTMLElement>(".service-row"));
    applyToRow(updatedRows.at(-1));
  }, 0);
}

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .pos-efficiency-active{grid-template-columns:minmax(0,1fr) 340px!important;gap:12px!important}
    .pos-efficiency-active .pos-form{gap:10px!important;padding:14px!important}
    .pos-efficiency-active .pos-form .section-heading{margin-bottom:0!important}
    .pos-efficiency-active .pos-form .form-grid{gap:8px!important}
    .pos-efficiency-active .pos-form .field-group{gap:6px!important}
    .pos-efficiency-active .pos-form label{gap:4px!important}
    .pos-efficiency-active .pos-form input,
    .pos-efficiency-active .pos-form select,
    .pos-efficiency-active .pos-form textarea{padding:8px 9px!important}
    .pos-efficiency-active .pos-form textarea{min-height:60px!important;max-height:72px!important}
    .pos-efficiency-active .service-row{gap:6px!important;grid-template-columns:minmax(0,1fr) 88px 38px!important}
    .pos-efficiency-active .service-row button{padding:7px!important}
    .pos-efficiency-active .add-line{padding:8px 11px!important}
    .pos-efficiency-active .discount-box{padding:10px!important}
    .pos-efficiency-active .primary-wide.ll-original-submit{display:none!important}
    .pos-efficiency-active .total-card{padding:14px!important;top:12px!important}
    .pos-efficiency-active .total-card>p:not(.eyebrow),
    .pos-efficiency-active .total-card>ul{display:none!important}
    .pos-efficiency-active .pos-total-breakdown{margin-top:10px!important;padding-top:10px!important;gap:6px!important}
    .pos-efficiency-active .pos-total-breakdown .grand-total{padding-top:8px!important;margin-top:2px!important}
    .ll-pos-quick{display:flex;gap:8px;align-items:center;margin:2px 0 6px}
    .ll-pos-quick button{min-width:76px;padding:8px 12px;background:#07194f;color:#fff;border:1px solid #1f3c7b;border-radius:5px}
    .ll-pos-quick button strong{display:block;font-size:.92rem;line-height:1}
    .ll-pos-quick button span{display:block;margin-top:3px;font-size:.62rem;font-weight:650;opacity:.82}
    .ll-pos-fast-checkout{display:grid;gap:8px;margin-top:12px;padding:11px;background:#fff;border-radius:6px;color:#101827}
    .ll-pos-fast-checkout label{display:grid;gap:4px;color:#101827!important;font-size:.78rem;font-weight:800}
    .ll-pos-fast-checkout input{padding:9px 10px;background:#fff;color:#101827!important;border:1px solid #c8d1dc;border-radius:4px}
    .ll-pos-cash-quick{display:flex;flex-wrap:wrap;gap:6px}
    .ll-pos-cash-quick button{padding:7px 9px;border:1px solid #c8d1dc;border-radius:4px;background:#f7f9fc;color:#101827;font-size:.72rem;font-weight:800}
    .ll-pos-cash-quick button:hover{background:#eef3f8}
    .ll-pos-fast-checkout .ll-change-row{display:flex;justify-content:space-between;align-items:center;padding:8px 0 2px;color:#101827}
    .ll-pos-fast-checkout .ll-change-row strong{color:#101827!important;font-size:1.05rem}
    .ll-pos-fast-checkout .ll-fast-submit{width:100%;margin-top:2px;background:#b8a17b;color:#101827}
    .ll-pos-original-tender{position:absolute!important;left:-9999px!important;width:1px!important;height:1px!important;overflow:hidden!important}
    @media(max-width:899px){
      .pos-efficiency-active{grid-template-columns:1fr!important}
      .pos-efficiency-active .primary-wide.ll-original-submit{display:block!important}
      .ll-pos-fast-checkout .ll-fast-submit{display:none!important}
    }
  `;
  document.head.appendChild(style);
}

function labelText(label: HTMLLabelElement) {
  return (label.childNodes[0]?.textContent || label.textContent || "").trim().toLowerCase();
}

function ensureQuickButtons(form: HTMLFormElement) {
  if (document.getElementById(QUICK_ID)) return;
  const firstRow = form.querySelector<HTMLElement>(".service-row");
  if (!firstRow) return;

  const wrap = document.createElement("div");
  wrap.id = QUICK_ID;
  wrap.className = "ll-pos-quick";
  wrap.setAttribute("aria-label", "Quick services");

  const services = [
    { code: "RL", name: "Regular Laundry" },
    { code: "WC", name: "Whites" },
  ];

  services.forEach(({ code, name }) => {
    const button = document.createElement("button");
    button.type = "button";
    button.innerHTML = `<strong>${code}</strong><span>${name}</span>`;
    button.addEventListener("click", () => chooseQuickService(name));
    wrap.appendChild(button);
  });

  firstRow.parentElement?.insertBefore(wrap, firstRow);
}

function findPaymentMethod(form: HTMLFormElement) {
  const label = Array.from(form.querySelectorAll<HTMLLabelElement>("label")).find((item) => labelText(item).startsWith("payment method"));
  return label?.querySelector<HTMLSelectElement>("select") || null;
}

function findTenderInput(form: HTMLFormElement) {
  const label = Array.from(form.querySelectorAll<HTMLLabelElement>("label")).find((item) => {
    const text = labelText(item);
    return text.startsWith("cash received") || text.startsWith("amount tendered") || text.startsWith("money received");
  });
  return { label: label || null, input: label?.querySelector<HTMLInputElement>("input") || null };
}

function findChangeSource(form: HTMLFormElement) {
  const label = Array.from(form.querySelectorAll<HTMLLabelElement>("label")).find((item) => labelText(item).startsWith("change due") || labelText(item).startsWith("change given"));
  if (label) return { holder: label, input: label.querySelector<HTMLInputElement>("input") };

  const candidates = Array.from(form.querySelectorAll<HTMLElement>("dt,span,strong,p,div"));
  const holder = candidates.find((item) => /^(change due|change given|change)$/i.test((item.textContent || "").trim()));
  return { holder: holder?.parentElement || holder || null, input: holder?.parentElement?.querySelector<HTMLInputElement>("input") || null };
}

function readTotalFromAside(aside: HTMLElement) {
  const grand = aside.querySelector<HTMLElement>(".grand-total dd") || aside.querySelector<HTMLElement>(".grand-total");
  const text = grand?.textContent || "";
  const match = text.replace(/,/g, "").match(/([0-9]+(?:\.[0-9]+)?)/);
  return match ? Number(match[1]) : 0;
}

function quickCashAmounts(total: number) {
  if (!Number.isFinite(total) || total <= 0) return [];
  const first = Math.ceil(total / 5000) * 5000;
  return [first, first + 5000, first + 10000, first + 15000];
}

function ensureFastCheckout(form: HTMLFormElement, aside: HTMLElement) {
  const originalSubmit = form.querySelector<HTMLButtonElement>('button[type="submit"].primary-wide');
  if (originalSubmit) originalSubmit.classList.add("ll-original-submit");

  let box = document.getElementById(CHECKOUT_ID) as HTMLDivElement | null;
  if (!box) {
    box = document.createElement("div");
    box.id = CHECKOUT_ID;
    box.className = "ll-pos-fast-checkout";

    const fastSubmit = document.createElement("button");
    fastSubmit.type = "button";
    fastSubmit.className = "ll-fast-submit";
    fastSubmit.textContent = "Create order & receipt";
    fastSubmit.addEventListener("click", () => form.requestSubmit());
    box.appendChild(fastSubmit);

    const breakdown = aside.querySelector(".pos-total-breakdown");
    breakdown?.insertAdjacentElement("afterend", box);
    if (!breakdown) aside.appendChild(box);
  }

  const paymentMethod = findPaymentMethod(form);
  const cashMode = !paymentMethod || paymentMethod.value.toLowerCase() === "cash";
  box.style.display = cashMode ? "grid" : "grid";

  const tender = findTenderInput(form);
  const change = findChangeSource(form);

  let proxy = box.querySelector<HTMLInputElement>('[data-role="tender-proxy"]');
  if (cashMode && tender.input) {
    if (!proxy) {
      const proxyLabel = document.createElement("label");
      proxyLabel.textContent = "Cash received";
      proxy = document.createElement("input");
      proxy.type = "number";
      proxy.min = "0";
      proxy.step = "1";
      proxy.inputMode = "numeric";
      proxy.dataset.role = "tender-proxy";
      proxyLabel.appendChild(proxy);
      box.insertBefore(proxyLabel, box.firstChild);
      proxy.addEventListener("input", () => {
        const latest = findTenderInput(form).input;
        if (latest) setNativeValue(latest, proxy!.value);
      });
    }
    if (proxy.value !== tender.input.value) proxy.value = tender.input.value;
    tender.label?.classList.add("ll-pos-original-tender");

    let quick = box.querySelector<HTMLDivElement>('[data-role="cash-quick"]');
    if (!quick) {
      quick = document.createElement("div");
      quick.className = "ll-pos-cash-quick";
      quick.dataset.role = "cash-quick";
      const proxyLabel = proxy.closest("label");
      proxyLabel?.insertAdjacentElement("afterend", quick);
    }

    const total = readTotalFromAside(aside);
    const amounts = quickCashAmounts(total);
    const signature = [total, ...amounts].join("|");
    if (quick.dataset.signature !== signature) {
      quick.dataset.signature = signature;
      quick.innerHTML = "";

      const exact = document.createElement("button");
      exact.type = "button";
      exact.textContent = "Exact";
      exact.addEventListener("click", () => {
        const latest = findTenderInput(form).input;
        if (!latest) return;
        setNativeValue(latest, String(total));
        const visible = box.querySelector<HTMLInputElement>('[data-role="tender-proxy"]');
        if (visible) visible.value = String(total);
      });
      quick.appendChild(exact);

      amounts.forEach((amount) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = "GYD " + amount.toLocaleString("en-US");
        button.addEventListener("click", () => {
          const latest = findTenderInput(form).input;
          if (!latest) return;
          setNativeValue(latest, String(amount));
          const visible = box.querySelector<HTMLInputElement>('[data-role="tender-proxy"]');
          if (visible) visible.value = String(amount);
        });
        quick!.appendChild(button);
      });
    }
  } else if (proxy) {
    proxy.closest("label")?.remove();
    box.querySelector('[data-role="cash-quick"]')?.remove();
  }

  let changeRow = box.querySelector<HTMLElement>('[data-role="change-row"]');
  if (cashMode && change.holder) {
    if (!changeRow) {
      changeRow = document.createElement("div");
      changeRow.className = "ll-change-row";
      changeRow.dataset.role = "change-row";
      changeRow.innerHTML = '<span>Change due</span><strong data-role="change-value">GYD 0</strong>';
      const submit = box.querySelector(".ll-fast-submit");
      box.insertBefore(changeRow, submit);
    }
    const raw = change.input?.value || change.holder.textContent || "GYD 0";
    const value = raw.match(/GYD\s*[\d,.]+/i)?.[0] || raw.match(/[\d,.]+/)?.[0] || "0";
    const display = value.toUpperCase().startsWith("GYD") ? value : `GYD ${value}`;
    const target = changeRow.querySelector<HTMLElement>('[data-role="change-value"]');
    if (target) target.textContent = display;
    change.holder.classList.add("ll-pos-original-tender");
  } else if (changeRow) {
    changeRow.remove();
  }
}

function enhancePos() {
  ensureStyles();
  applyGuard();

  const form = document.querySelector<HTMLFormElement>("form.pos-form");
  if (!form || !form.textContent?.includes("Manual POS")) return;
  const split = form.closest<HTMLElement>(".split-layout");
  const aside = split?.querySelector<HTMLElement>(".total-card");
  if (!split || !aside) return;

  split.classList.add("pos-efficiency-active");
  ensureQuickButtons(form);
  ensureFastCheckout(form, aside);
}

export default function PosMinimumWeightGuard() {
  useEffect(() => {
    let queued = false;
    const schedule = () => {
      if (queued) return;
      queued = true;
      window.requestAnimationFrame(() => {
        queued = false;
        enhancePos();
      });
    };

    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    document.addEventListener("change", schedule, true);
    document.addEventListener("input", schedule, true);
    schedule();

    return () => {
      observer.disconnect();
      document.removeEventListener("change", schedule, true);
      document.removeEventListener("input", schedule, true);
      document.getElementById(STYLE_ID)?.remove();
    };
  }, []);

  return null;
}
