import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

// Reversible hosting-level notice. Default is OFF unless explicitly enabled
// in Netlify's server-side environment, followed by a new deploy.
const SERVICE_FLAG = "LAUNDRY_SERVICE_SUSPENDED";
const AUTH_STORAGE_KEY = "laundry-loop-staff-auth-v2";

function noticeHtml(title: string, heading: string, message: string, staff: boolean): string {
  const style = [
    "html,body{margin:0;min-height:100%;font-family:system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif}",
    "body{display:grid;place-items:center;background:#f6f7f9;color:#172033;padding:24px;box-sizing:border-box}",
    "main{max-width:460px;width:100%;box-sizing:border-box;text-align:center;background:#fff;border:1px solid #e2e6ec;border-radius:14px;padding:44px 32px;box-shadow:0 10px 35px rgba(19,30,50,.05)}",
    "h1{font-size:clamp(1.6rem,4vw,2rem);line-height:1.2;margin:0 0 14px;font-weight:700;letter-spacing:-.025em}",
    "p{font-size:1rem;line-height:1.6;color:#5b6676;margin:0}",
    "@media(max-width:480px){main{padding:36px 24px}}",
  ].join("");
  // Clear only the persisted *online* staff session, not offline orders,
  // attendance, service catalog, receipts, or cached customer data.
  const logout = staff
    ? '<script>try{localStorage.removeItem("'+AUTH_STORAGE_KEY+'");sessionStorage.removeItem("'+AUTH_STORAGE_KEY+'")}catch(_){}</script>'
    : "";
  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<meta name="robots" content="noindex,nofollow">',
    '<title>', title, '</title><style>', style, '</style></head><body>',
    '<main role="main"><h1>', heading, '</h1><p>', message, '</p></main>',
    logout,
    '</body></html>',
  ].join("");
}

const publicPage = noticeHtml(
  "404 - Page Not Found",
  "404 - Page Not Found",
  "Please contact administrator.",
  false,
);
const staffPage = noticeHtml(
  "Service Temporarily Suspended",
  "Service Temporarily Suspended",
  "Please contact administrator for more information.",
  true,
);

const NO_CACHE_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store, max-age=0, must-revalidate",
  "X-Robots-Tag": "noindex, nofollow",
  "X-Content-Type-Options": "nosniff",
};

export function proxy(request: NextRequest) {
  if (process.env[SERVICE_FLAG] !== "true") return NextResponse.next();

  const path = request.nextUrl.pathname;
  // Management remains accessible so administrators can view the reason and
  // SnapNest can restore service. Next.js and static resources must still load.
  if (
    path === "/admin" || path.startsWith("/admin/") ||
    path.startsWith("/_next/") || path.startsWith("/api/") ||
    path.startsWith("/_netlify/") || path.startsWith("/.well-known/") ||
    path === "/sw.js" ||
    (path !== "/" && /\.(?!html$)[a-z0-9]+$/i.test(path))
  ) {
    return NextResponse.next();
  }

  if (path === "/staff" || path.startsWith("/staff/")) {
    // Intentionally HTTP 200: the existing service worker only adopts fresh
    // staff-page responses when response.ok is true; using 503 would
    // incorrectly make it fall back to a cached, functional POS.
    return new Response(staffPage, { status: 200, headers: NO_CACHE_HEADERS });
  }

  // Covers /, /index.html (the homepage redirect target), and other public
  // HTML pages, without touching the customer/order database.
  return new Response(publicPage, { status: 404, headers: NO_CACHE_HEADERS });
}

export const config = {
  matcher: ["/:path*"],
};
