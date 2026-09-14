"use client";

export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang="en">
      <body>
        <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, fontFamily: "system-ui, sans-serif" }}>
          <section style={{ width: "min(100%, 520px)", border: "1px solid #dce5f0", padding: 24, background: "white" }}>
            <h1>The Laundry Loop</h1>
            <p>The application hit an unexpected error. Try again or reload the page.</p>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <button type="button" onClick={reset}>Try again</button>
              <button type="button" onClick={() => window.location.reload()}>Reload</button>
            </div>
          </section>
        </main>
      </body>
    </html>
  );
}
