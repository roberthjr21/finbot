import Link from 'next/link'
import { DashboardShell, EstadoConexion, FormatoFecha, ImporteMovimiento } from '@/components/dashboard-shell'
import { obtenerMovimientos } from '@/lib/bot-api'

const POR_PAGINA = 100
const MAX_OFFSET = 1_000_000

export default async function MovimientosPage({ searchParams }: { searchParams: Promise<{ offset?: string }> }) {
  const parametros = await searchParams
  const solicitado = Number(parametros.offset ?? 0)
  const offset = Number.isSafeInteger(solicitado) && solicitado > 0 ? Math.min(solicitado, MAX_OFFSET) : 0
  const resultado = await obtenerMovimientos(offset)

  return (
    <DashboardShell pagina="Movimientos">
      <div className="page-heading"><div><p className="eyebrow">HISTORIAL</p><h1>Movimientos</h1><p className="subheading">Registros guardados por el bot.</p></div></div>
      {!resultado.ok && <EstadoConexion motivo={resultado.motivo} />}
      {resultado.ok && (resultado.datos.length === 0
        ? <section className="panel"><h2>No hay movimientos para mostrar</h2><p className="subheading">Cuando registres un movimiento por WhatsApp, aparecerá aquí.</p></section>
        : <section className="panel transactions-panel"><div className="transactions-table"><div className="table-head"><span>Movimiento</span><span>Categoría</span><span>Fecha</span><span>Importe</span></div>{resultado.datos.map((fila) => <div className="transaction-row" key={fila.id}><div className="transaction-name"><strong>{fila.descripcion || fila.tipo}</strong></div><span className="category-pill">{fila.categoria}</span><span className="muted-cell"><FormatoFecha valor={fila.fecha} /></span><strong className={fila.tipo === 'ingreso' ? 'amount income' : 'amount'}><ImporteMovimiento tipo={fila.tipo} monto={fila.monto} /></strong></div>)}</div>
          <nav className="pagination" aria-label="Paginación de movimientos">
            {offset > 0 && <Link className="link-button" href={`/movimientos?offset=${Math.max(0, offset - POR_PAGINA)}`}>← Anteriores</Link>}
            {resultado.datos.length === POR_PAGINA && offset + POR_PAGINA <= MAX_OFFSET && <Link className="link-button" href={`/movimientos?offset=${offset + POR_PAGINA}`}>Siguientes →</Link>}
          </nav>
        </section>)}
    </DashboardShell>
  )
}
