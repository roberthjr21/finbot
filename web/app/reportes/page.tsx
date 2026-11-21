import Link from 'next/link'
import { DashboardShell, EstadoConexion, FormatoMonto } from '@/components/dashboard-shell'
import { BarraPatrimonio, BarrasCategorias, BarrasIngresosGastos, Tendencia } from '@/components/graficos'
import { SelectorPeriodo, periodoSeleccionado } from '@/components/selector-periodo'
import { mesesRecientes, nombreMes, obtenerDeudas, obtenerPrestamos, obtenerResumenes, obtenerSalud } from '@/lib/bot-api'

export default async function ReportesPage({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const { mes, meses } = periodoSeleccionado((await searchParams).mes)
  const comparados = mesesRecientes(6, mes)
  const [historico, deudas, prestamos, salud] = await Promise.all([
    obtenerResumenes(comparados), obtenerDeudas(), obtenerPrestamos(), obtenerSalud(),
  ])
  const actual = historico[historico.length - 1]
  const anterior = historico[historico.length - 2]
  const porcentajeAhorro = actual.ok && actual.datos.ingresos > 0
    ? Math.round(100 * actual.datos.balance / actual.datos.ingresos) : null
  const serie = historico.flatMap((resultado, i) => resultado.ok
    ? [{ etiqueta: nombreMes(comparados[i]), ingresos: resultado.datos.ingresos, gastos: resultado.datos.gastos }] : [])

  return (
    <DashboardShell pagina="Reportes" salud={salud}>
      <header className="page-heading resumen-v2-header">
        <h1>Reportes</h1>
        <div className="resumen-v2-acciones">
          <SelectorPeriodo mes={mes} meses={meses} />
          <Link className="link-button" href={{ pathname: '/', query: { mes } }}>Volver al resumen</Link>
        </div>
      </header>
      {!actual.ok && <EstadoConexion motivo={actual.motivo} seccion="Reportes" />}
      {actual.ok && (
        <div className="charts-grid">
          <section className="stat-grid span-2" aria-label="Cifras del periodo">
            <article className="stat-card">
              <span className="stat-top">Ingresos del periodo</span>
              <strong><FormatoMonto valor={actual.datos.ingresos} /></strong>
              {anterior.ok && <Tendencia actual={actual.datos.ingresos} previo={anterior.datos.ingresos} subirEsBueno />}
            </article>
            <article className="stat-card">
              <span className="stat-top">Gastos del periodo</span>
              <strong><FormatoMonto valor={actual.datos.gastos} /></strong>
              {anterior.ok && <Tendencia actual={actual.datos.gastos} previo={anterior.datos.gastos} subirEsBueno={false} />}
            </article>
            <article className="stat-card">
              <span className="stat-top">Tasa de ahorro del periodo</span>
              <strong>{porcentajeAhorro === null ? '—' : `${porcentajeAhorro}%`}</strong>
              <span className="subheading">{porcentajeAhorro === null ? 'Sin ingresos registrados' : 'Balance sobre ingresos'}</span>
            </article>
          </section>
          <section className="panel span-2">
            <div className="panel-heading"><div><h2>Ingresos frente a gastos</h2><p>Seis meses hasta el periodo seleccionado</p></div></div>
            {serie.some(punto => punto.ingresos > 0 || punto.gastos > 0)
              ? <BarrasIngresosGastos datos={serie} />
              : <p className="empty-note">Todavía no hay movimientos en estos meses.</p>}
          </section>
          <section className="panel">
            <h2>Gastos por categoría</h2>
            {actual.datos.porCategoria.length
              ? <BarrasCategorias filas={actual.datos.porCategoria} />
              : <p className="empty-note">No hay gastos en este periodo.</p>}
          </section>
          {(actual.datos.prestado > 0 || actual.datos.cobrado > 0 || actual.datos.pagosDeuda > 0) && (
            <section className="panel">
              <h2>Otros movimientos de caja del periodo</h2>
              <ul className="data-list">
                {actual.datos.prestado > 0 && <li><span>Prestado</span><strong>−<FormatoMonto valor={actual.datos.prestado} /></strong></li>}
                {actual.datos.cobrado > 0 && <li><span>Cobrado de préstamos</span><strong>+<FormatoMonto valor={actual.datos.cobrado} /></strong></li>}
                {actual.datos.pagosDeuda > 0 && <li><span>Pagos de deudas</span><strong>−<FormatoMonto valor={actual.datos.pagosDeuda} /></strong></li>}
              </ul>
            </section>
          )}
          {(deudas.ok || prestamos.ok) && (
            <section className="panel">
              <h2>Deudas y préstamos actuales</h2>
              {deudas.ok && prestamos.ok && <BarraPatrimonio teDeben={prestamos.datos.total} debes={deudas.datos.total} />}
              <ul className="data-list">
                {prestamos.ok && <li><Link href="/prestamos">Te deben</Link><strong><FormatoMonto valor={prestamos.datos.total} /></strong></li>}
                {deudas.ok && <li><Link href="/deudas">Debes</Link><strong><FormatoMonto valor={deudas.datos.total} /></strong></li>}
              </ul>
            </section>
          )}
        </div>
      )}
    </DashboardShell>
  )
}
