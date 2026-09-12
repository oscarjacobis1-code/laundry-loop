(() => {
  'use strict';

  const isAndroid = /Android/i.test(navigator.userAgent);
  if (!isAndroid) return;

  const browserPrint = window.print.bind(window);

  function printableText() {
    const candidates = [
      '[data-print-sheet]',
      '.print-sheet',
      '.receipt',
      '.order-print',
      'main'
    ];
    for (const selector of candidates) {
      const node = document.querySelector(selector);
      if (node && node.innerText && node.innerText.trim()) return node.innerText.trim();
    }
    return document.body.innerText.trim();
  }

  function bridgeUrl(text) {
    const params = new URLSearchParams({ text, source: location.origin });
    return `laundryloop-print://print?${params.toString()}`;
  }

  window.__LAUNDRY_BROWSER_PRINT__ = browserPrint;
  window.__LAUNDRY_PRINT_BRIDGE__ = {
    printText(text) {
      if (!text || !String(text).trim()) throw new Error('Nothing to print.');
      location.href = bridgeUrl(String(text));
    },
    configure() {
      location.href = 'laundryloop-print://configure';
    },
    browserPrint
  };

  // The existing POS already calls window.print(). On the dedicated Android
  // tablet, redirect that action to the local ESC/POS bridge. Other devices
  // retain normal browser printing.
  window.print = () => {
    const text = printableText();
    location.href = bridgeUrl(text);
  };
})();
