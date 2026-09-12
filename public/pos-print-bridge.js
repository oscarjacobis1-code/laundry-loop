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
    const data = query(text, openDrawer);
    return `intent://print?${data}#Intent;scheme=laundryloop-print;package=com.laundryloop.printbridge;S.browser_fallback_url=${encodeURIComponent(location.href)};end`;
  }

  function launchAndroidBridge(text, openDrawer = false) {
    if (!text || !String(text).trim()) {
      alert('Receipt is not ready to print. Close this message and try again.');
      return false;
    }

    // This navigation must happen synchronously inside the user's tap. Chrome
    // and MIUI can block external-app intents launched later by setTimeout.
    window.location.href = androidIntentUrl(String(text), openDrawer);
    return true;
  }

  function sendToBridge(text, openDrawer = false) {
    if (!text || !String(text).trim()) throw new Error('Nothing to print.');
    if (isAndroid) return launchAndroidBridge(text, openDrawer);
    window.location.href = customSchemeUrl(String(text), openDrawer);
    return true;
  }

  window.__LAUNDRY_BROWSER_PRINT__ = browserPrint;
  window.__LAUNDRY_PRINT_BRIDGE__ = {
    available: isAndroid,
    printText(text, options = {}) {
      if (!isAndroid) return browserPrint();
      return launchAndroidBridge(text, options.openDrawer === true);
    },
    printReceipt(options = {}) {
      const text = printableText('receipt');
      if (!isAndroid) return browserPrint();
      return launchAndroidBridge(text, options.openDrawer === true);
    },
    printTag(options = {}) {
      const text = printableText('tag');
      if (!isAndroid) return browserPrint();
      return launchAndroidBridge(text, options.openDrawer === true);
    },
    configure() {
      if (isAndroid) {
        window.location.href = `intent://configure#Intent;scheme=laundryloop-print;package=com.laundryloop.printbridge;S.browser_fallback_url=${encodeURIComponent(location.href)};end`;
      }
    },
    browserPrint,
  };

  if (!isAndroid) return;

  // IMPORTANT: launch the Android intent during the physical button tap.
  // Portal.tsx currently delays window.print() with setTimeout, which loses
  // Chrome's user-activation permission for opening an external app.
  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest('button.print-action');
    if (!button) return;

    const label = (button.textContent || '').trim().toLowerCase();
    let mode = null;
    if (label.includes('print receipt')) mode = 'receipt';
    if (label.includes('print bag tag')) mode = 'tag';
    if (!mode) return;

    const text = printableText(mode);
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    launchAndroidBridge(text, false);
  }, true);

  // Compatibility fallback only. The primary Android path above is the direct
  // physical click because this function may be reached after a timer.
  window.print = () => {
    const tagVisible = document.body.classList.contains('print-tag');
    const text = printableText(tagVisible ? 'tag' : 'receipt');
    launchAndroidBridge(text, false);
  };
})();
