// Esqueleto mientras se consulta el API del bot
export default function Loading() {
  return (
    <main className="page-wrap" aria-busy="true" aria-live="polite">
      <p className="sr-only" role="status">Consultando el API del bot…</p>
      <div className="skeleton skeleton-title" />
      <div className="skeleton skeleton-hero" />
      <div className="stat-grid">
        <div className="skeleton skeleton-card" />
        <div className="skeleton skeleton-card" />
        <div className="skeleton skeleton-card" />
      </div>
      <div className="skeleton skeleton-panel" />
    </main>
  )
}
