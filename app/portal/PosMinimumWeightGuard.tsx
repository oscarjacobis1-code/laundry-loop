"use client";

import { useEffect } from "react";

const MIN_WEIGHT_LB = 5;

function isWeightService(select: HTMLSelectElement) {
  const option = select.selectedOptions?.[0];
  if (!option) return false;
  return /\/lb\b/i.test(option.textContent || "");
}

function applyGuard() {
  document.querySelectorAll<HTMLElement>(".service-row").forEach((row) => {
    const select = row.querySelector<HTMLSelectElement>("select");
    const input = row.querySelector<HTMLInputElement>('input[type="number"]');
    if (!select || !input) return;

    if (isWeightService(select)) {
      input.min = String(MIN_WEIGHT_LB);
      const current = Number(input.value || 0);
      if (current > 0 && current < MIN_WEIGHT_LB) input.value = String(MIN_WEIGHT_LB);
    } else {
      input.min = "0.5";
    }
  });
}

export default function PosMinimumWeightGuard() {
  useEffect(() => {
    const onChange = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest(".service-row")) return;
      window.requestAnimationFrame(applyGuard);
    };

    const observer = new MutationObserver(() => window.requestAnimationFrame(applyGuard));
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("change", onChange, true);
    applyGuard();

    return () => {
      observer.disconnect();
      document.removeEventListener("change", onChange, true);
    };
  }, []);

  return null;
}
