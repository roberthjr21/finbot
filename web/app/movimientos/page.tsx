import Link from 'next/link'
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react'
import { DashboardShell, EstadoConexion, FormatoFecha, ImporteMovimiento } from '@/components/dashboard-shell'
import { Aviso } from '@/components/formulario-movimiento'
import { obtenerMovimientos, obtenerSalud } from '@/lib/bot-api'

const POR_PAGINA = 100
const MAX_OFFSET = 1_000_000

type Tipo = 'gasto' | 'ingreso'
const FILTROS: Array<{ etiqueta: string; tipo?: Tipo; ruta: string }> = [
  { etiqueta: 'Todos', ruta: '/movimientos' },
  { etiqueta: 'Ingresos', tipo: 'ingreso', ruta: '/movimientos?tipo=ingreso' },
  { etiqueta: 'Gastos', tipo: 'gasto', ruta: '/movimientos?tipo=gasto' },
]

export default async function MovimientosPage({ searchParams }: { searchParams: Promise<{ offset?: string; tipo?: string; aviso?: string; e?: string }> }) {
  const parametros = await searchParams
  const solicitado = Number(parametros.offset ?? 0)
  const offset = Number.isSafeInteger(solicitado) && solicitado >= 0 && solicitado <= MAX_OFFSET ? solicitado : 0
  const tipo: Tipo | undefined = parametros.tipo === 'ingreso' || parametros.tipo === 'gasto' ? parametros.tipo : undefined
  const [resultado, salud] = await Promise.all([obtenerMovimientos({ offset, limite: POR_PAGINA, tipo }), obtenerSalud()])
  const consultado = new Date().toISOString()
  const pagina = tipo === 'ingreso' ? 'Ingresos' : tipo === 'gasto' ? 'Gastos' : 'Movimientos'
  const base = tipo ? `/movimientos?tipo=${tipo}&` : '/movimientos?'

  return (
    <DashboardShell pagina={pagina} salud={salud} consultado={consultado}>
      <div className="page-heading"><div><p className="eyebrow">HISTORIAL</p><h1>{pagina}</h1><p className="subheading">Registros guardados desde WhatsApp y desde la web.</p></div><Link className="primary-button button-inline" href="/movimientos/nuevo">+ Nuevo</Link></div>
      <Aviso aviso={parametros.aviso} error={parametros.e} />
      <nav className="filter-bar" aria-label="Filtrar movimientos">
        {FILTROS.map((f) => (
          <Link key={f.etiqueta} href={f.ruta} className={f.tipo === tipo ? 'filter-chip active' : 'filter-chip'} aria-current={f.tipo === tipo ? 'page' : undefined}>{f.etiqueta}</Link>
        ))}
      </nav>
      {!resultado.ok && <EstadoConexion motivo={resultado.motivo} />}
      {resultado.ok && (resultado.datos.length === 0
        ? <section className="panel"><h2>No hay movimientos para mostrar</h2><p className="subheading">Cuando registres un movimiento por WhatsApp, aparecerá aquí.</p></section>
        : <section className="panel transactions-panel"><div className="transactions-table"><div className="table-head"><span>Movimiento</span><span>Categoría</span><span>Fecha</span><span>Importe</span></div>{resultado.datos.map((fila) => <div className="transaction-row" key={fila.id}><div className="transaction-name"><span className={fila.tipo === 'ingreso' ? 'tx-icon tx-in' : 'tx-icon tx-out'}>{fila.tipo === 'ingreso' ? <ArrowDownLeft size={14} /> : <ArrowUpRight size={14} />}</span>{fila.origen ? <strong>{fila.descripcion || fila.tipo}</strong> : <Link className="row-link" href={`/movimientos/${fila.id}`}><strong>{fila.descripcion || fila.tipo}</strong></Link>}</div><span className="category-pill">{fila.categoria}</span><span className="muted-cell"><FormatoFecha valor={fila.fecha} /></span><strong className={fila.tipo === 'ingreso' ? 'amount income' : 'amount'}><ImporteMovimiento tipo={fila.tipo} monto={fila.monto} /></strong></div>)}</div>
          <nav className="pagination" aria-label="Paginación de movimientos">
            {offset > 0 && <Link className="link-button" href={`${base}offset=${Math.max(0, offset - POR_PAGINA)}`}>← Anteriores</Link>}
            {resultado.datos.length === POR_PAGINA && offset + POR_PAGINA <= MAX_OFFSET && <Link className="link-button" href={`${base}offset=${offset + POR_PAGINA}`}>Siguientes →</Link>}
          </nav>
        </section>)}
    </DashboardShell>
  )
}
