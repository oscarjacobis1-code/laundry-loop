(() => {
  'use strict';

  const isAndroid = /Android/i.test(navigator.userAgent);
  const browserPrint = window.print.bind(window);

  function printableText() {
    const receipt = document.querySelector('#printable-receipt');
    if (receipt && receipt.innerText && receipt.innerText.trim()) return receipt.innerText.trim();

    const candidates = ['[data-print-sheet]', '.print-sheet', '.receipt', '.order-print'];
    for (const selector of candidates) {
      const node = document.querySelector(selector);
      if (node && node.innerText && node.innerText.trim()) return node.innerText.trim();
    }
    return '';
  }

  function bridgeUrl(text, openDrawer = false) {
    const params = new URLSearchParams({
      text,
      drawer: openDrawer ? '1' : '0',
      source: location.origin,
    });
    return `laundryloop-print://print?${params.toString()}`;
  }

  function sendToBridge(text, openDrawer = false) {
    if (!text || !String(text).trim()) throw new Error('Nothing to print.');
    window.location.href = bridgeUrl(String(text), openDrawer);
  }

  window.__LAUNDRY_BROWSER_PRINT__ = browserPrint;
  window.__LAUNDRY_PRINT_BRIDGE__ = {
    available: isAndroid,
    printText(text, options = {}) {
      if (!isAndroid) {
        browserPrint();
        return;
      }
      sendToBridge(text, options.openDrawer === true);
    },
    printReceipt(options = {}) {
      const text = printableText();
      if (!text) throw new Error('Receipt is not available to print.');
      if (!isAndroid) {
        browserPrint();
        return;
      }
      sendToBridge(text, options.openDrawer === true);
    },
    configure() {
      if (isAndroid) window.location.href = 'laundryloop-print://configure';
    },
    browserPrint,
  };

  // Laundry Loop's dedicated Android POS must never enter Android's document
  // print/PDF preview for receipts. Existing POS code that calls window.print()
  // is routed straight to the installed ESC/POS bridge instead. Desktop and
  // non-Android devices retain browser printing as the emergency fallback.
  if (isAndroid) {
    window.print = () => {
      const text = printableText();
      if (!text) return;
      sendToBridge(text, false);
    };
  }
})();
