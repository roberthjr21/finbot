import { DashboardShell, EstadoConexion, FormatoMonto } from '@/components/dashboard-shell'
import { SelectorPeriodo, periodoSeleccionado } from '@/components/selector-periodo'
import { obtenerPresupuestos, obtenerSaldo, obtenerSalud } from '@/lib/bot-api'

export default async function PresupuestosPage({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const { mes, meses } = periodoSeleccionado((await searchParams).mes)
  const [resultado, saldo, salud] = await Promise.all([obtenerPresupuestos(mes), obtenerSaldo(), obtenerSalud()])
  const consultado = new Date().toISOString()
  return (
    <DashboardShell pagina="Presupuestos" salud={salud} consultado={consultado}>
      <header className="page-heading resumen-v2-header">
        <h1>Presupuestos</h1>
        <SelectorPeriodo mes={mes} meses={meses} />
      </header>
      {saldo.ok && (
        <section className="panel" aria-labelledby="ahorro-general">
          <div className="panel-heading">
            <h2 id="ahorro-general">Ahorro general</h2>
            {saldo.datos.ahorroGeneral !== undefined && <strong><FormatoMonto valor={saldo.datos.ahorroGeneral} /></strong>}
          </div>
          {saldo.datos.ahorroGeneral === undefined && <p className="subheading">Para apartar dinero, escríbele al bot por WhatsApp.</p>}
        </section>
      )}
      {!saldo.ok && resultado.ok && <EstadoConexion motivo={saldo.motivo} seccion="Ahorro general" />}
      {!resultado.ok && <EstadoConexion motivo={resultado.motivo} />}
      {resultado.ok && (resultado.datos.length === 0
        ? <section className="panel"><h2>Aún no tienes presupuestos</h2><p className="subheading">Puedes crear uno escribiendo al bot por WhatsApp.</p></section>
        : <section className="stat-grid" aria-label="Presupuestos mensuales">
          {resultado.datos.map((fila) => {
            const restante = fila.limite - fila.gastado
            const porcentaje = Math.min(100, Math.max(0, fila.porcentaje))
            return (
              <article className="stat-card" key={fila.categoria}>
                <div className="stat-top"><span>{fila.categoria}</span><span>{fila.porcentaje}% usado</span></div>
                <strong><FormatoMonto valor={Math.abs(restante)} /></strong>
                <p className="subheading">{restante < 0 ? 'Por encima del límite' : 'Disponibles'} · límite de <FormatoMonto valor={fila.limite} /></p>
                <div className={fila.porcentaje >= 100 ? 'budget-progress meter-over' : fila.porcentaje >= 80 ? 'budget-progress meter-warn' : 'budget-progress'} role="progressbar" aria-label={`Uso del presupuesto ${fila.categoria}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={porcentaje}>
                  <span style={{ width: `${porcentaje}%` }} />
                </div>
              </article>
            )
          })}
        </section>)}
    </DashboardShell>
  )
}
