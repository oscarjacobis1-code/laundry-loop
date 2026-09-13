(() => {
  'use strict';

  const isAndroid = /Android/i.test(navigator.userAgent);
  const browserPrint = window.print.bind(window);
  const packageName = 'com.laundryloop.printbridge';

  function textFrom(selector) {
    const node = document.querySelector(selector);
    return node && node.innerText ? node.innerText.trim() : '';
  }

  function makeIntent(action, text = '', openDrawer = false) {
    const params = new URLSearchParams();
    if (text) params.set('text', text);
    if (action === 'print') params.set('drawer', openDrawer ? '1' : '0');

    const query = params.toString() ? `?${params.toString()}` : '';
    const fallback = encodeURIComponent(`${window.location.origin}/printer-bridge?fallback=1`);
    return `intent://${action}${query}#Intent;scheme=laundryloop-print;package=${packageName};S.browser_fallback_url=${fallback};end`;
  }

  function launchPrint(mode, openDrawer = false) {
    const selector = mode === 'tag' ? '#printable-bag-tag' : '#printable-receipt';
    const text = textFrom(selector);
    if (!text) {
      alert('Receipt is not ready to print. Close this receipt and open it again.');
      return false;
    }

    // This navigation must happen synchronously inside the user's tap.
    // Delaying it with setTimeout can cause Android/Chrome to block the app handoff.
    window.location.href = makeIntent('print', text, openDrawer);
    return true;
  }

  window.__LAUNDRY_PRINT_BRIDGE__ = {
    available: isAndroid,
    printReceipt(options = {}) {
      if (!isAndroid) {
        browserPrint();
        return true;
      }
      return launchPrint('receipt', options.openDrawer === true);
    },
    printTag() {
      if (!isAndroid) {
        browserPrint();
        return true;
      }
      return launchPrint('tag', false);
    },
    configure() {
      if (!isAndroid) return false;
      window.location.href = makeIntent('configure');
      return true;
    },
    browserPrint,
  };

  if (!isAndroid) return;

  // Only intercept the actual Print receipt / Print bag tag buttons inside the
  // open receipt modal. The Orders table also has a "Receipt" button whose job
  // is only to open the modal, so it must NOT be intercepted.
  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const button = target.closest('.modal-actions button.print-action');
    if (!button) return;

    const label = (button.textContent || '').trim().toLowerCase();
    const mode = label === 'print bag tag' ? 'tag' : label === 'print receipt' ? 'receipt' : null;
    if (!mode) return;

    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();

    launchPrint(mode, false);
  }, true);
})();
