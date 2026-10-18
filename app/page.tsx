import Link from 'next/link'
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react'
import { DashboardShell, EstadoConexion, FormatoFecha, FormatoMonto, ImporteMovimiento } from '@/components/dashboard-shell'
import { obtenerMovimientos, obtenerPresupuestos, obtenerResumen } from '@/lib/bot-api'

export default async function Page() {
  const [resumen, movimientos, presupuestos] = await Promise.all([
    obtenerResumen(),
    obtenerMovimientos(),
    obtenerPresupuestos(),
  ])
  return (
    <DashboardShell pagina="Resumen">
      <div className="page-heading">
        <div><p className="eyebrow">DATOS DEL BOT</p><h1>Resumen financiero</h1><p className="subheading">Movimientos que registraste por WhatsApp.</p></div>
      </div>
      {!resumen.ok && <EstadoConexion motivo={resumen.motivo} seccion="Resumen" />}
      {!movimientos.ok && <EstadoConexion motivo={movimientos.motivo} seccion="Movimientos" />}
      {!presupuestos.ok && <EstadoConexion motivo={presupuestos.motivo} seccion="Presupuestos" />}
      {resumen.ok && <>
          <section className="stat-grid" aria-label="Resumen del mes">
            <article className="stat-card"><div className="stat-top"><span>Ingresos del mes</span><ArrowDownLeft size={17} /></div><strong><FormatoMonto valor={resumen.datos.ingresos} /></strong></article>
            <article className="stat-card"><div className="stat-top"><span>Gastos del mes</span><ArrowUpRight size={17} /></div><strong><FormatoMonto valor={resumen.datos.gastos} /></strong></article>
            <article className="stat-card"><div className="stat-top"><span>Balance del mes</span></div><strong><FormatoMonto valor={resumen.datos.balance} /></strong></article>
          </section>
      </>}
      {(resumen.ok || presupuestos.ok) && <section className="charts-grid">
        {resumen.ok && <article className="panel">
          <div className="panel-heading"><div><h2>Gastos por categoría</h2><p>{resumen.datos.mes}</p></div></div>
          {resumen.datos.porCategoria.length === 0
            ? <p className="subheading">{resumen.datos.ingresos === 0 && resumen.datos.gastos === 0 ? 'Aún no hay movimientos este mes.' : 'No hay gastos por categoría este mes.'}</p>
            : <ul className="data-list">{resumen.datos.porCategoria.slice(0, 8).map((fila) => <li key={fila.categoria}><span>{fila.categoria}</span><strong><FormatoMonto valor={fila.total} /></strong></li>)}</ul>}
        </article>}
        {presupuestos.ok && <article className="panel">
          <div className="panel-heading"><div><h2>Presupuestos</h2><p>Uso durante este mes</p></div><Link className="link-button" href="/presupuestos">Ver todos</Link></div>
          {presupuestos.datos.length === 0
            ? <p className="subheading">Todavía no has definido presupuestos.</p>
            : <ul className="data-list">{presupuestos.datos.slice(0, 5).map((fila) => <li key={fila.categoria}><span>{fila.categoria}</span><strong><FormatoMonto valor={fila.gastado} /> / <FormatoMonto valor={fila.limite} /></strong></li>)}</ul>}
        </article>}
      </section>}
      {movimientos.ok && <>
          <section className="panel transactions-panel">
            <div className="panel-heading"><div><h2>Movimientos recientes</h2><p>Más recientes primero</p></div><Link className="link-button" href="/movimientos">Ver movimientos</Link></div>
            {movimientos.datos.length === 0
              ? <p className="subheading">Todavía no hay movimientos registrados.</p>
              : <div className="transactions-table"><div className="table-head"><span>Movimiento</span><span>Categoría</span><span>Fecha</span><span>Importe</span></div>{movimientos.datos.slice(0, 5).map((fila) => <div className="transaction-row" key={fila.id}><div className="transaction-name"><strong>{fila.descripcion || fila.tipo}</strong></div><span className="category-pill">{fila.categoria}</span><span className="muted-cell"><FormatoFecha valor={fila.fecha} /></span><strong className={fila.tipo === 'ingreso' ? 'amount income' : 'amount'}><ImporteMovimiento tipo={fila.tipo} monto={fila.monto} /></strong></div>)}</div>}
          </section>
      </>}
      <footer className="page-footer"><span>Consulta de solo lectura al API del bot.</span></footer>
    </DashboardShell>
  )
}
