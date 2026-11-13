import { NextResponse } from "next/server";

// Native Android POS checks this endpoint directly, bypassing its WebView cache.
// Keep this route available when the public website and staff portal are suspended.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export function GET() {
  const suspended = process.env.LAUNDRY_SERVICE_SUSPENDED === "true";
  return NextResponse.json(
    { suspended },
    {
      headers: {
        "Cache-Control": "private, no-store, no-cache, must-revalidate, max-age=0",
        "Pragma": "no-cache",
        "Expires": "0",
        "X-Robots-Tag": "noindex, nofollow",
      },
    },
  );
}
