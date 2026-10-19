import Link from 'next/link'

export default function NotFound() {
  return <main className="page-wrap"><section className="panel"><h1>Página no encontrada</h1><p className="subheading">Esta ruta no corresponde a una sección disponible.</p><Link className="link-button" href="/">Volver al resumen</Link></section></main>
}
