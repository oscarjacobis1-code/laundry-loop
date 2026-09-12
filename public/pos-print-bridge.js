(() => {
  'use strict';

  const isAndroid = /Android/i.test(navigator.userAgent);
  const browserPrint = window.print.bind(window);

  function textFrom(selector) {
    const node = document.querySelector(selector);
    return node && node.innerText ? node.innerText.trim() : '';
  }

  function launchAndroid(text, openDrawer = false) {
    if (!text) {
      alert('Receipt is not ready to print.');
      return false;
    }
    const params = new URLSearchParams({ text, drawer: openDrawer ? '1' : '0' });
    window.location.href = `intent://print?${params.toString()}#Intent;scheme=laundryloop-print;package=com.laundryloop.printbridge;end`;
    return true;
  }

  window.__LAUNDRY_PRINT_BRIDGE__ = {
    available: isAndroid,
    printReceipt(options = {}) {
      if (!isAndroid) { browserPrint(); return true; }
      return launchAndroid(textFrom('#printable-receipt'), options.openDrawer === true);
    },
    printTag() {
      if (!isAndroid) { browserPrint(); return true; }
      return launchAndroid(textFrom('#printable-bag-tag'), false);
    },
    configure() {
      if (!isAndroid) return false;
      window.location.href = 'intent://configure#Intent;scheme=laundryloop-print;package=com.laundryloop.printbridge;end';
      return true;
    },
    browserPrint,
  };
})();
