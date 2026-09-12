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
    window.location.assign(bridgeUrl(String(text), openDrawer));
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
      const text = printableText('receipt');
      if (!text) throw new Error('Receipt is not available to print.');
      if (!isAndroid) {
        browserPrint();
        return;
      }
      sendToBridge(text, options.openDrawer === true);
    },
    configure() {
      if (isAndroid) window.location.assign('laundryloop-print://configure');
    },
    browserPrint,
  };

  if (!isAndroid) return;

  // Intercept the POS print controls during the normal bubbling phase.
  // React's own onClick still gets blocked, but Android receives the custom
  // scheme navigation as a direct consequence of the user's tap.
  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest('button.print-action');
    if (!button) return;

    const label = (button.textContent || '').trim().toLowerCase();
    if (!label.includes('print receipt') && !label.includes('print bag tag')) return;

    const mode = label.includes('bag tag') ? 'tag' : 'receipt';
    const text = printableText(mode);
    if (!text) return;

    event.preventDefault();
    event.stopPropagation();
    sendToBridge(text, false);
  }, false);

  // Fallback for any existing React print action that reaches window.print().
  window.print = () => {
    const text = printableText('receipt');
    if (!text) return;
    sendToBridge(text, false);
  };
})();
