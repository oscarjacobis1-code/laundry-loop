import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "The Laundry Loop | Wash, Dry & Fold",
  description: "Careful wash, dry and fold service on the West Bank of Demerara, with instant estimates and order tracking.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
        <Script id="laundry-direct-print" strategy="afterInteractive">{`
          (() => {
            if (!/Android/i.test(navigator.userAgent)) return;

            const packageName = 'com.laundryloop.printbridge';
            const originalPrint = window.print.bind(window);

            function directPrint(mode) {
              const selector = mode === 'tag' ? '#printable-bag-tag' : '#printable-receipt';
              const node = document.querySelector(selector);
              const text = node && node.innerText ? node.innerText.trim() : '';
              if (!text) {
                alert('Receipt is not ready to print. Close it and open it again.');
                return false;
              }

              const params = new URLSearchParams();
              params.set('text', text);
              params.set('drawer', '0');
              const target = 'intent://print?' + params.toString() + '#Intent;scheme=laundryloop-print;package=' + packageName + ';end';
              window.location.href = target;
              return true;
            }

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
              directPrint(mode);
            }, true);

            window.print = function () {
              const modal = document.querySelector('.receipt-modal');
              if (!modal) return originalPrint();
              const mode = modal.classList.contains('print-tag') ? 'tag' : 'receipt';
              return directPrint(mode);
            };

            window.__LAUNDRY_DIRECT_PRINT_READY__ = true;
          })();
        `}</Script>
      </body>
    </html>
  );
}
