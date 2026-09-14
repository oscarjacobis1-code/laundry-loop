"use client";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="portal-shell">
      <section className="login-card">
        <p className="eyebrow">Laundry Loop</p>
        <h1>Something did not load correctly</h1>
        <p>Please try again. If the problem continues, orders can still be recorded using the outage recovery process.</p>
        <div>
          <button type="button" onClick={reset}>Try again</button>
          <button type="button" onClick={() => window.location.reload()}>Reload page</button>
        </div>
      </section>
    </main>
  );
}
