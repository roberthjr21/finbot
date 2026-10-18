import { DashboardShell, EstadoConexion, FormatoMonto } from '@/components/dashboard-shell'
import { obtenerPresupuestos } from '@/lib/bot-api'

export default async function PresupuestosPage() {
  const resultado = await obtenerPresupuestos()
  return (
    <DashboardShell pagina="Presupuestos">
      <div className="page-heading"><div><p className="eyebrow">CONTROL MENSUAL</p><h1>Presupuestos</h1><p className="subheading">Límites y gastos registrados en el bot.</p></div></div>
      {!resultado.ok && <EstadoConexion motivo={resultado.motivo} />}
      {resultado.ok && (resultado.datos.length === 0
        ? <section className="panel"><h2>Aún no tienes presupuestos</h2><p className="subheading">Puedes crear uno escribiendo al bot por WhatsApp.</p></section>
        : <section className="stat-grid" aria-label="Presupuestos mensuales">{resultado.datos.map((fila) => <article className="stat-card" key={fila.categoria}><div className="stat-top"><span>{fila.categoria}</span><span>{fila.porcentaje}%</span></div><strong><FormatoMonto valor={fila.gastado} /></strong><p className="subheading">de <FormatoMonto valor={fila.limite} /></p><div className="budget-progress" role="progressbar" aria-label={`Uso del presupuesto ${fila.categoria}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.max(0, fila.porcentaje))}><span style={{ width: `${Math.min(100, Math.max(0, fila.porcentaje))}%` }} /></div></article>)}</section>)}
    </DashboardShell>
  )
}
