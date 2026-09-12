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
        <Script src="/pos-print-bridge.js" strategy="afterInteractive" />
      </body>
    </html>
  );
}
