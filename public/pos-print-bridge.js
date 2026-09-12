(() => {
  'use strict';

  const isAndroid = /Android/i.test(navigator.userAgent);
  const browserPrint = window.print.bind(window);

  function textFrom(selector) {
    const node = document.querySelector(selector);
    return node && node.innerText && node.innerText.trim() ? node.innerText.trim() : '';
  }

  function printableText(mode) {
    const selector = mode === 'tag' ? '#printable-bag-tag' : '#printable-receipt';
    return textFrom(selector);
  }

  function bridgeUrl(text, openDrawer = false) {
    const params = new URLSearchParams({
      text: String(text),
      drawer: openDrawer ? '1' : '0',
    });
    return `laundryloop-print://print?${params.toString()}`;
  }

  function launch(mode, openDrawer = false) {
    const text = printableText(mode);
    if (!text) {
      alert('Receipt is not ready to print.');
      return;
    }
    window.location.assign(bridgeUrl(text, openDrawer));
  }

  window.__LAUNDRY_BROWSER_PRINT__ = browserPrint;
  window.__LAUNDRY_PRINT_BRIDGE__ = {
    available: isAndroid,
    printReceipt(options = {}) {
      if (!isAndroid) return browserPrint();
      launch('receipt', options.openDrawer === true);
    },
    printTag() {
      if (!isAndroid) return browserPrint();
      launch('tag', false);
    },
    browserPrint,
  };

  if (!isAndroid) return;

  // Launch directly from the user's tap. Do not route through window.print,
  // timers, Android intent URLs, or the browser print/PDF system.
  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest('button.print-action');
    if (!button) return;

    const label = (button.textContent || '').toLowerCase();
    const mode = label.includes('bag tag') ? 'tag' : label.includes('receipt') ? 'receipt' : null;
    if (!mode) return;

    event.preventDefault();
    event.stopPropagation();
    launch(mode, false);
  }, true);

  // Existing React code calls window.print after a timer. The direct click
  // handler above already handled Android printing, so suppress that second path.
  window.print = () => {};
})();
