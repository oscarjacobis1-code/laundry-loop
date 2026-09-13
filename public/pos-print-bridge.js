(() => {
  'use strict';

  const isAndroid = /Android/i.test(navigator.userAgent);
  const packageName = 'com.laundryloop.printbridge';
  const browserPrint = window.print.bind(window);

  function textFrom(selector) {
    const node = document.querySelector(selector);
    return node && node.innerText ? node.innerText.trim() : '';
  }

  function receiptMeta() {
    const receipt = document.querySelector('#printable-receipt');
    if (!receipt) return { order: '', payment: '' };

    const order = (receipt.querySelector('h2')?.textContent || '').trim();
    const paymentLine = [...receipt.querySelectorAll('p')]
      .map((node) => (node.textContent || '').trim())
      .find((value) => value.toLowerCase().startsWith('payment:')) || '';
    const payment = paymentLine.replace(/^payment:\s*/i, '').split('·')[0].trim();
    return { order, payment };
  }

  function makeIntent(mode, text) {
    const params = new URLSearchParams();
    params.set('mode', mode);
    params.set('text', text);

    if (mode === 'receipt') {
      const meta = receiptMeta();
      if (meta.order) params.set('order', meta.order);
      if (meta.payment) params.set('payment', meta.payment);
    }

    return `intent://print?${params.toString()}#Intent;scheme=laundryloop-print;package=${packageName};end`;
  }

  function directPrint(mode) {
    const selector = mode === 'tag' ? '#printable-bag-tag' : '#printable-receipt';
    const text = textFrom(selector);
    if (!text) {
      alert('Receipt is not ready to print. Close it and open it again.');
      return false;
    }

    window.location.href = makeIntent(mode, text);
    return true;
  }

  window.__LAUNDRY_PRINT_BRIDGE__ = {
    available: isAndroid,
    directPrint,
    browserPrint,
  };

  if (!isAndroid) return;

  // On the dedicated Android POS, never enter the system PDF print pipeline.
  // If React calls window.print(), route the currently open receipt/tag directly
  // to the Laundry Loop companion app instead.
  window.print = function () {
    const modal = document.querySelector('.receipt-modal');
    if (!modal) return false;
    return directPrint(modal.classList.contains('print-tag') ? 'tag' : 'receipt');
  };

  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const button = target.closest('.modal-actions button.print-action');
    if (!button) return;

    const label = (button.textContent || '').trim().toLowerCase();
    const mode = label === 'print bag tag' ? 'tag' : label === 'print receipt' ? 'receipt' : null;
    if (!mode) return;

    // Capture the tap before React's onClick can schedule window.print().
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
    directPrint(mode);
  }, true);

  window.__LAUNDRY_DIRECT_PRINT_READY__ = true;
})();
