import { DashboardShell, EstadoConexion, FormatoFecha, FormatoMonto } from '@/components/dashboard-shell'
import { obtenerPrestamos, obtenerSalud } from '@/lib/bot-api'

export default async function PrestamosPage() {
  const [prestamos, salud] = await Promise.all([obtenerPrestamos(), obtenerSalud()])
  const consultado = new Date().toISOString()
  return (
    <DashboardShell pagina="Préstamos" salud={salud} consultado={consultado}>
      <div className="page-heading"><div><p className="eyebrow">LIBRETA</p><h1>Préstamos</h1><p className="subheading">Lo que has prestado, lo que ya te devolvieron y lo que falta por cobrar, por persona.</p></div></div>
      {!prestamos.ok && <EstadoConexion motivo={prestamos.motivo} seccion="Préstamos" />}
      {prestamos.ok && (prestamos.datos.personas.length === 0
        ? <section className="panel"><h2>No tienes préstamos anotados</h2><p className="subheading">Escríbele al bot, por ejemplo: &quot;le presté 50 mil a Pedro&quot;.</p></section>
        : <>
          <section className="stat-grid" aria-label="Resumen de préstamos">
            <article className="stat-card"><div className="stat-top"><span>Te deben en total</span></div><strong><FormatoMonto valor={prestamos.datos.total} /></strong></article>
            <article className="stat-card"><div className="stat-top"><span>Total prestado</span></div><strong><FormatoMonto valor={prestamos.datos.prestado} /></strong></article>
            <article className="stat-card"><div className="stat-top"><span>Total cobrado</span></div><strong><FormatoMonto valor={prestamos.datos.pagado} /></strong></article>
          </section>
          {prestamos.datos.personas.every((p) => p.saldo === 0) && (
            <section className="panel"><h2>✅ Nadie te debe nada</h2><p className="subheading">Todos tus préstamos ya fueron pagados. Abajo puedes ver el historial.</p></section>
          )}
          {[...prestamos.datos.personas.filter((p) => p.saldo > 0), ...prestamos.datos.personas.filter((p) => p.saldo === 0)].map((p) => (
            <section className={p.saldo === 0 ? 'panel panel-paid' : 'panel'} key={p.persona}>
              <div className="panel-heading">
                <div><h2>{p.persona}</h2><p>Prestado <FormatoMonto valor={p.prestado} /> · Pagado <FormatoMonto valor={p.pagado} /></p></div>
                <strong>{p.saldo > 0 ? <><FormatoMonto valor={p.saldo} /> por cobrar</> : '✅ Al día'}</strong>
              </div>
              <ul className="data-list">
                {p.historial.map((h, i) => (
                  <li key={`${h.fecha}-${i}`}>
                    <span>{h.tipo === 'presto' ? 'Le prestaste' : 'Te pagó'}{h.descripcion ? ` · ${h.descripcion}` : ''} · <FormatoFecha valor={h.fecha} /></span>
                    <strong>{h.tipo === 'presto' ? '+' : '−'}<FormatoMonto valor={h.monto} /></strong>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>)}
    </DashboardShell>
  )
}
