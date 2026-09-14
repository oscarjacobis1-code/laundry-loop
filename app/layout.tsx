import type { Metadata } from "next";
import AndroidPrintBridge from "./portal/AndroidPrintBridge";
import SupervisorServiceGate from "./portal/SupervisorServiceGate";
import "./globals.css";

export const metadata: Metadata = {
  title: "The Laundry Loop | Wash, Dry & Fold",
  description: "Careful wash, dry and fold service on the West Bank of Demerara, with instant estimates and order tracking.",
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
        <AndroidPrintBridge />
        <SupervisorServiceGate />
        {children}
      </body>
    </html>
  );
}
