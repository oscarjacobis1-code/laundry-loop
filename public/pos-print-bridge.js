(() => {
  'use strict';

  const isAndroid = /Android/i.test(navigator.userAgent);
  const browserPrint = window.print.bind(window);

  function textFrom(selector) {
    const node = document.querySelector(selector);
    return node && node.innerText && node.innerText.trim() ? node.innerText.trim() : '';
  }

  function printableText(mode = 'receipt') {
    if (mode === 'tag') {
      const tag = textFrom('#printable-bag-tag');
      if (tag) return tag;
    }
    const receipt = textFrom('#printable-receipt');
    if (receipt) return receipt;
    const candidates = ['[data-print-sheet]', '.print-sheet', '.receipt', '.order-print'];
    for (const selector of candidates) {
      const text = textFrom(selector);
      if (text) return text;
    }
    return '';
  }

  function query(text, openDrawer = false) {
    return new URLSearchParams({
      text: String(text),
      drawer: openDrawer ? '1' : '0',
      source: location.origin,
    }).toString();
  }

  function customSchemeUrl(text, openDrawer = false) {
    return `laundryloop-print://print?${query(text, openDrawer)}`;
  }

  function androidIntentUrl(text, openDrawer = false) {
    return `intent://print?${query(text, openDrawer)}#Intent;scheme=laundryloop-print;package=com.laundryloop.printbridge;end`;
  }

  function sendToBridge(text, openDrawer = false) {
    if (!text || !String(text).trim()) throw new Error('Nothing to print.');
    window.location.href = isAndroid
      ? androidIntentUrl(String(text), openDrawer)
      : customSchemeUrl(String(text), openDrawer);
  }

  window.__LAUNDRY_BROWSER_PRINT__ = browserPrint;
  window.__LAUNDRY_PRINT_BRIDGE__ = {
    available: isAndroid,
    printText(text, options = {}) {
      if (!isAndroid) return browserPrint();
      sendToBridge(text, options.openDrawer === true);
    },
    printReceipt(options = {}) {
      const text = printableText('receipt');
      if (!text) throw new Error('Receipt is not available to print.');
      if (!isAndroid) return browserPrint();
      sendToBridge(text, options.openDrawer === true);
    },
    configure() {
      if (isAndroid) {
        window.location.href = 'intent://configure#Intent;scheme=laundryloop-print;package=com.laundryloop.printbridge;end';
      }
    },
    browserPrint,
  };

  if (!isAndroid) return;

  // Leave the React button alone. Portal.tsx sets the requested print mode and
  // then calls window.print(); on Android this replacement sends the rendered
  // receipt directly to the installed bridge using Chrome's intent syntax.
  window.print = () => {
    const tagVisible = document.body.classList.contains('print-tag');
    const mode = tagVisible ? 'tag' : 'receipt';
    const text = printableText(mode);
    if (!text) return;
    sendToBridge(text, false);
  };
})();
