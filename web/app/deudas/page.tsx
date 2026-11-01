import { DashboardShell, EstadoConexion, FormatoFecha, FormatoMonto } from '@/components/dashboard-shell'
import { obtenerDeudas, obtenerSalud } from '@/lib/bot-api'

export default async function DeudasPage() {
  const [deudas, salud] = await Promise.all([obtenerDeudas(), obtenerSalud()])
  const consultado = new Date().toISOString()
  return (
    <DashboardShell pagina="Deudas" salud={salud} consultado={consultado}>
      <div className="page-heading"><div><p className="eyebrow">LIBRETA</p><h1>Deudas</h1><p className="subheading">Lo que debes y lo que ya has abonado, por persona.</p></div></div>
      {!deudas.ok && <EstadoConexion motivo={deudas.motivo} seccion="Deudas" />}
      {deudas.ok && (deudas.datos.personas.length === 0
        ? <section className="panel"><h2>No tienes deudas anotadas</h2><p className="subheading">Escríbele al bot, por ejemplo: &quot;le debo 50 mil a Juan&quot;.</p></section>
        : <>
          <section className="stat-grid" aria-label="Total que debes">
            <article className="stat-card"><div className="stat-top"><span>Debes en total</span></div><strong><FormatoMonto valor={deudas.datos.total} /></strong></article>
          </section>
          {deudas.datos.personas.map((p) => (
            <section className="panel" key={p.persona}>
              <div className="panel-heading">
                <div><h2>{p.persona}</h2><p>{p.saldo > 0 ? 'Pendiente por pagar' : 'Deuda pagada'}</p></div>
                <strong>{p.saldo > 0 ? <FormatoMonto valor={p.saldo} /> : '✅ Al día'}</strong>
              </div>
              <ul className="data-list">
                {p.historial.map((h, i) => (
                  <li key={`${h.fecha}-${i}`}>
                    <span>{h.tipo === 'debo' ? 'Debías' : 'Abonaste'}{h.descripcion ? ` · ${h.descripcion}` : ''} · <FormatoFecha valor={h.fecha} /></span>
                    <strong>{h.tipo === 'debo' ? '+' : '−'}<FormatoMonto valor={h.monto} /></strong>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>)}
    </DashboardShell>
  )
}
