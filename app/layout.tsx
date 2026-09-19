import type { Metadata } from "next";
import AndroidPrintBridge from "./portal/AndroidPrintBridge";
import SupervisorServiceGate from "./portal/SupervisorServiceGate";
import PosMinimumWeightGuard from "./portal/PosMinimumWeightGuard";
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
        <div style={{
          position: "sticky", top: 0, zIndex: 99999, width: "100%",
          background: "#7f1d1d", color: "#fff", textAlign: "center",
          fontWeight: 800, letterSpacing: "0.08em", padding: "8px 12px",
          fontSize: "12px"
        }}>
          SANDBOX / TEST MODE — NOT LIVE
        </div>
        <AndroidPrintBridge />
        <SupervisorServiceGate />
        <PosMinimumWeightGuard />
        {children}
      </body>
    </html>
  );
}
