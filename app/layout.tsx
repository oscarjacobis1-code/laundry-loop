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
        <Script src="/pos-print-bridge.js?v=direct-escpos-v19" strategy="afterInteractive" />
        <Script id="laundry-direct-print-override" strategy="afterInteractive">{`
          (() => {
            if (!/Android/i.test(navigator.userAgent)) return;
            const originalPrint = window.print.bind(window);
            window.print = function () {
              const bridge = window.__LAUNDRY_PRINT_BRIDGE__;
              if (bridge && bridge.available) {
                const modal = document.querySelector('.receipt-modal');
                if (modal && modal.classList.contains('print-tag')) return bridge.printTag();
                return bridge.printReceipt();
              }
              return originalPrint();
            };
          })();
        `}</Script>
      </body>
    </html>
  );
}
