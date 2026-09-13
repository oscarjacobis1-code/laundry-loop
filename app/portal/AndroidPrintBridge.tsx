"use client";

import { useEffect } from "react";

declare global {
  interface Navigator {
    userAgentData?: { platform?: string; mobile?: boolean };
  }
  interface Window {
    __LAUNDRY_DIRECT_PRINT_READY__?: boolean;
    __LAUNDRY_DIRECT_PRINT__?: (mode: "receipt" | "tag") => boolean;
  }
}

function isAndroidTablet() {
  const ua = navigator.userAgent || "";
  const platform = navigator.userAgentData?.platform || navigator.platform || "";
  return /Android/i.test(ua) || /Android/i.test(platform);
}

export default function AndroidPrintBridge() {
  useEffect(() => {
    if (!isAndroidTablet()) return;

    const packageName = "com.laundryloop.printbridge";
    const originalPrint = window.print.bind(window);

    function textFrom(selector: string) {
      const node = document.querySelector<HTMLElement>(selector);
      return node?.innerText?.trim() ?? "";
    }

    function receiptMeta() {
      const receipt = document.querySelector<HTMLElement>("#printable-receipt");
      if (!receipt) return { order: "", payment: "" };

      const order = receipt.querySelector("h2")?.textContent?.trim() ?? "";
      const paymentLine = Array.from(receipt.querySelectorAll("p"))
        .map((node) => node.textContent?.trim() ?? "")
        .find((value) => value.toLowerCase().startsWith("payment:")) ?? "";
      const payment = paymentLine.replace(/^payment:\s*/i, "").split("·")[0].trim();
      return { order, payment };
    }

    function directPrint(mode: "receipt" | "tag") {
      const selector = mode === "tag" ? "#printable-bag-tag" : "#printable-receipt";
      const text = textFrom(selector);
      if (!text) {
        window.alert("Receipt is not ready to print. Close it and open it again.");
        return false;
      }

      const params = new URLSearchParams();
      params.set("mode", mode);
      params.set("text", text);
      if (mode === "receipt") {
        const meta = receiptMeta();
        if (meta.order) params.set("order", meta.order);
        if (meta.payment) params.set("payment", meta.payment);
      }

      const target = `intent://print?${params.toString()}#Intent;scheme=laundryloop-print;package=${packageName};end`;
      window.location.assign(target);
      return true;
    }

    function onClick(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest<HTMLButtonElement>(".modal-actions button.print-action");
      if (!button) return;

      const label = (button.textContent ?? "").trim().toLowerCase();
      const mode = label.includes("bag tag") ? "tag" : label.includes("receipt") ? "receipt" : null;
      if (!mode) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      directPrint(mode);
    }

    window.__LAUNDRY_DIRECT_PRINT_READY__ = true;
    window.__LAUNDRY_DIRECT_PRINT__ = directPrint;
    document.documentElement.dataset.laundryDirectPrint = "ready";

    window.print = () => {
      const modal = document.querySelector(".receipt-modal");
      if (!modal) {
        window.alert("Laundry Loop direct printing is active, but no receipt is open.");
        return;
      }
      directPrint(modal.classList.contains("print-tag") ? "tag" : "receipt");
    };

    document.addEventListener("click", onClick, true);

    return () => {
      document.removeEventListener("click", onClick, true);
      window.print = originalPrint;
      delete window.__LAUNDRY_DIRECT_PRINT_READY__;
      delete window.__LAUNDRY_DIRECT_PRINT__;
      delete document.documentElement.dataset.laundryDirectPrint;
    };
  }, []);

  return null;
}
