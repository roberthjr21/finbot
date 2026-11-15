import Link from 'next/link'
import { ArrowDownLeft, ArrowUpRight, HandCoins, Handshake, PiggyBank, Wallet } from 'lucide-react'
import { DashboardShell, EstadoConexion, FormatoFecha, FormatoMonto, ImporteMovimiento } from '@/components/dashboard-shell'
import { BarraPatrimonio, BarrasCategorias, BarrasIngresosGastos, Tendencia, type PuntoMes } from '@/components/graficos'
import {
  mesesRecientes,
  nombreMes,
  obtenerCategorias,
  obtenerDeudas,
  obtenerMovimientos,
  obtenerPrestamos,
  obtenerPresupuestos,
  obtenerResumenes,
  obtenerSalud,
  obtenerSaldo,
} from '@/lib/bot-api'

const MESES_GRAFICO = 6

export default async function Page() {
  const meses = mesesRecientes(MESES_GRAFICO)
  const [saldo, deudas, prestamos, historico, movimientos, presupuestos, categorias, salud] = await Promise.all([
    obtenerSaldo(),
    obtenerDeudas(),
    obtenerPrestamos(),
    obtenerResumenes(meses),
    obtenerMovimientos({ limite: 6 }),
    obtenerPresupuestos(),
    obtenerCategorias(),
    obtenerSalud(),
  ])
  const consultado = new Date().toISOString()

  const resumen = historico[historico.length - 1]
  const previo = historico[historico.length - 2]
  const serie: PuntoMes[] = historico.flatMap((r, i) =>
    r.ok ? [{ etiqueta: nombreMes(meses[i]), ingresos: r.datos.ingresos, gastos: r.datos.gastos }] : [])
  const hayHistorico = serie.some((p) => p.ingresos > 0 || p.gastos > 0)
  const ahorro = resumen.ok && resumen.datos.ingresos > 0
    ? Math.round(((resumen.datos.ingresos - resumen.datos.gastos) / resumen.datos.ingresos) * 100)
    : null

  return (
    <DashboardShell pagina="Resumen" salud={salud} consultado={consultado}>
      <div className="page-heading">
        <div><p className="eyebrow">DATOS DEL BOT</p><h1>Resumen financiero</h1><p className="subheading">Lo que registraste por WhatsApp, siempre al día.</p></div>
      </div>
      {!resumen.ok && <EstadoConexion motivo={resumen.motivo} seccion="Resumen" />}
      {!movimientos.ok && <EstadoConexion motivo={movimientos.motivo} seccion="Movimientos" />}
      {!presupuestos.ok && <EstadoConexion motivo={presupuestos.motivo} seccion="Presupuestos" />}

      {saldo.ok && (
        <section className="hero-card" aria-label="Saldo disponible">
          <div className="hero-main">
            <span className="hero-label"><Wallet size={15} /> Saldo disponible</span>
            <strong className="hero-amount"><FormatoMonto valor={saldo.datos.balance} /></strong>
            <span className="hero-note">Todo lo que has registrado, desde que empezaste.</span>
          </div>
          <div className="hero-side">
            {prestamos.ok && <div><span>Te deben</span><strong><FormatoMonto valor={prestamos.datos.total} /></strong></div>}
            {deudas.ok && <div><span>Debes</span><strong><FormatoMonto valor={deudas.datos.total} /></strong></div>}
            {resumen.ok && <div><span>Balance del mes</span><strong><FormatoMonto valor={resumen.datos.balance} /></strong></div>}
          </div>
        </section>
      )}

      {resumen.ok && (
        <section className="stat-grid" aria-label="Resumen del mes">
          <article className="stat-card">
            <div className="stat-top"><span>Ingresos del mes</span><ArrowDownLeft size={17} className="icon-ingreso" /></div>
            <strong><FormatoMonto valor={resumen.datos.ingresos} /></strong>
            {previo.ok && <Tendencia actual={resumen.datos.ingresos} previo={previo.datos.ingresos} subirEsBueno />}
          </article>
          <article className="stat-card">
            <div className="stat-top"><span>Gastos del mes</span><ArrowUpRight size={17} className="icon-gasto" /></div>
            <strong><FormatoMonto valor={resumen.datos.gastos} /></strong>
            {previo.ok && <Tendencia actual={resumen.datos.gastos} previo={previo.datos.gastos} subirEsBueno={false} />}
          </article>
          <article className="stat-card">
            <div className="stat-top"><span>Ahorro del mes</span><PiggyBank size={17} /></div>
            <strong>{ahorro === null ? '—' : `${ahorro}%`}</strong>
            <span className="trend trend-neutral">{ahorro === null ? 'Aún sin ingresos este mes' : 'de tus ingresos'}</span>
          </article>
        </section>
      )}

      <nav className="quick-links" aria-label="Accesos rápidos">
        <Link href="/movimientos">Movimientos</Link>
        <Link href="/presupuestos"><PiggyBank size={15} /> Presupuestos</Link>
        <Link href="/deudas"><HandCoins size={15} /> Deudas</Link>
        <Link href="/prestamos"><Handshake size={15} /> Préstamos</Link>
      </nav>

      <section className="charts-grid">
        {serie.length > 0 && (
          <article className="panel span-2">
            <div className="panel-heading"><div><h2>Ingresos frente a gastos</h2><p>Últimos {MESES_GRAFICO} meses</p></div></div>
            {hayHistorico
              ? <BarrasIngresosGastos datos={serie} />
              : <p className="empty-note">Todavía no hay movimientos en estos meses. Registra uno por WhatsApp y aparecerá aquí.</p>}
          </article>
        )}
        {resumen.ok && (
          <article className="panel">
            <div className="panel-heading"><div><h2>Gastos por categoría</h2><p>{resumen.datos.mes}</p></div></div>
            {resumen.datos.porCategoria.length === 0
              ? <p className="empty-note">{resumen.datos.ingresos === 0 && resumen.datos.gastos === 0 ? 'Aún no hay movimientos este mes.' : 'No hay gastos por categoría este mes.'}</p>
              : <BarrasCategorias filas={resumen.datos.porCategoria.slice(0, 6)} />}
          </article>
        )}
        {resumen.ok && (resumen.datos.prestado > 0 || resumen.datos.cobrado > 0 || resumen.datos.pagosDeuda > 0) && (
          <article className="panel">
            <div className="panel-heading"><div><h2>Aparte del mes</h2><p>No cuentan como ingreso ni gasto, pero sí mueven tu saldo</p></div></div>
            <ul className="data-list">
              {resumen.datos.prestado > 0 && <li><span>Prestado (sale de tu saldo)</span><strong>−<FormatoMonto valor={resumen.datos.prestado} /></strong></li>}
              {resumen.datos.cobrado > 0 && <li><span>Cobrado de préstamos (entra a tu saldo)</span><strong>+<FormatoMonto valor={resumen.datos.cobrado} /></strong></li>}
              {resumen.datos.pagosDeuda > 0 && <li><span>Pagos de deudas (salen de tu saldo)</span><strong>−<FormatoMonto valor={resumen.datos.pagosDeuda} /></strong></li>}
            </ul>
          </article>
        )}
        {presupuestos.ok && (
          <article className="panel">
            <div className="panel-heading"><div><h2>Presupuestos</h2><p>Uso durante este mes</p></div><Link className="link-button" href="/presupuestos">Ver todos</Link></div>
            {presupuestos.datos.length === 0
              ? <p className="empty-note">Todavía no has definido presupuestos. Escríbele al bot: &quot;presupuesto de 300 mil en comida&quot;.</p>
              : <ul className="cat-bars">{presupuestos.datos.slice(0, 5).map((fila) => {
                  const pct = Math.min(100, Math.max(0, fila.porcentaje))
                  return (
                    <li key={fila.categoria}>
                      <div className="cat-bars-top"><span>{fila.categoria}</span><strong><FormatoMonto valor={fila.gastado} /> / <FormatoMonto valor={fila.limite} /> <em>{fila.porcentaje}%</em></strong></div>
                      <div className={fila.porcentaje >= 100 ? 'meter meter-over' : fila.porcentaje >= 80 ? 'meter meter-warn' : 'meter'} role="progressbar" aria-label={`Uso del presupuesto ${fila.categoria}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><span style={{ width: `${pct}%` }} /></div>
                    </li>
                  )
                })}</ul>}
          </article>
        )}
        {(deudas.ok || prestamos.ok) && (
          <article className="panel">
            <div className="panel-heading"><div><h2>Deudas y préstamos</h2><p>Lo que debes y lo que te deben</p></div></div>
            {deudas.ok && prestamos.ok && <BarraPatrimonio teDeben={prestamos.datos.total} debes={deudas.datos.total} />}
            <ul className="data-list">
              {prestamos.ok && <li><span><Link href="/prestamos">Te deben</Link></span><strong><FormatoMonto valor={prestamos.datos.total} /></strong></li>}
              {deudas.ok && <li><span><Link href="/deudas">Debes</Link></span><strong><FormatoMonto valor={deudas.datos.total} /></strong></li>}
            </ul>
            {deudas.ok && prestamos.ok && deudas.datos.total === 0 && prestamos.datos.total === 0 && <p className="empty-note">Sin deudas ni cobros pendientes.</p>}
          </article>
        )}
        {categorias.ok && categorias.datos.length > 0 && (
          <article className="panel">
            <div className="panel-heading"><div><h2>Categorías</h2><p>Disponibles en el bot</p></div></div>
            <div className="chips">{categorias.datos.map((categoria) => <span className="category-pill" key={categoria}>{categoria}</span>)}</div>
          </article>
        )}
      </section>

      {movimientos.ok && (
        <section className="panel transactions-panel">
          <div className="panel-heading"><div><h2>Movimientos recientes</h2><p>Más recientes primero</p></div><Link className="link-button" href="/movimientos">Ver todos</Link></div>
          {movimientos.datos.length === 0
            ? <p className="empty-note">Todavía no hay movimientos registrados. Escríbele al bot, por ejemplo: &quot;gasté 20 mil en almuerzo&quot;.</p>
            : <div className="transactions-table"><div className="table-head"><span>Movimiento</span><span>Categoría</span><span>Fecha</span><span>Importe</span></div>{movimientos.datos.slice(0, 5).map((fila) => <div className="transaction-row" key={fila.id}><div className="transaction-name"><span className={fila.tipo === 'ingreso' ? 'tx-icon tx-in' : 'tx-icon tx-out'}>{fila.tipo === 'ingreso' ? <ArrowDownLeft size={14} /> : <ArrowUpRight size={14} />}</span><strong>{fila.descripcion || fila.tipo}</strong></div><span className="category-pill">{fila.categoria}</span><span className="muted-cell"><FormatoFecha valor={fila.fecha} /></span><strong className={fila.tipo === 'ingreso' ? 'amount income' : 'amount'}><ImporteMovimiento tipo={fila.tipo} monto={fila.monto} /></strong></div>)}</div>}
        </section>
      )}
      <footer className="page-footer"><span>Consulta de solo lectura al API del bot.</span></footer>
    </DashboardShell>
  )
}
