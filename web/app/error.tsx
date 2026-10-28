'use client'

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="page-wrap"><section className="panel" role="alert"><h1>No se pudo cargar esta página</h1><p className="subheading">Ocurrió un error al procesar la consulta. Intenta nuevamente.</p><button className="link-button" onClick={reset}>Reintentar</button></section></main>
}
