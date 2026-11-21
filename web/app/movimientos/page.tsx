import Link from 'next/link'
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react'
import { DashboardShell, EstadoConexion, FormatoFecha, ImporteMovimiento } from '@/components/dashboard-shell'
import { Aviso } from '@/components/formulario-movimiento'
import { fechaValida, obtenerCategorias, obtenerMovimientos, obtenerSalud } from '@/lib/bot-api'

const POR_PAGINA = 25
const MAX_OFFSET = 1_000_000
const tipos = [
  { etiqueta: 'Todos', valor: '' },
  { etiqueta: 'Ingresos', valor: 'ingreso' },
  { etiqueta: 'Gastos', valor: 'gasto' },
] as const

type Parametros = Partial<Record<'offset' | 'tipo' | 'aviso' | 'e' | 'desde' | 'hasta' | 'categoria' | 'buscar', string>>
const campo = (valor: unknown) => typeof valor === 'string' ? valor.trim() : ''

export default async function MovimientosPage({ searchParams }: { searchParams: Promise<Parametros> }) {
  const parametros = await searchParams
  const solicitado = Number(campo(parametros.offset))
  const offset = Number.isSafeInteger(solicitado) && solicitado >= 0 && solicitado <= MAX_OFFSET ? solicitado : 0
  const tipo = parametros.tipo === 'ingreso' || parametros.tipo === 'gasto' ? parametros.tipo : undefined
  const desde = campo(parametros.desde)
  const hasta = campo(parametros.hasta)
  const categoriaSolicitada = campo(parametros.categoria)
  const buscar = campo(parametros.buscar).slice(0, 80)
  const rangoValido = (!desde || fechaValida(desde)) && (!hasta || fechaValida(hasta)) && (!desde || !hasta || desde <= hasta)
  const consultaCategorias = obtenerCategorias()
  const consultaSalud = obtenerSalud()
  const validacion = categoriaSolicitada ? await consultaCategorias : null
  const categoria = validacion?.ok && validacion.datos.includes(categoriaSolicitada) ? categoriaSolicitada : ''
  const consultaMovimientos = rangoValido ? obtenerMovimientos({
    offset, limite: POR_PAGINA + 1, tipo, desde: desde || undefined, hasta: hasta || undefined,
    categoria: categoria || undefined, buscar: buscar || undefined,
  }) : null
  const [categorias, salud, resultado] = await Promise.all([consultaCategorias, consultaSalud, consultaMovimientos])
  const pagina = tipo === 'ingreso' ? 'Ingresos' : tipo === 'gasto' ? 'Gastos' : 'Movimientos'

  function enlace(nuevoTipo = tipo ?? '', nuevoOffset = 0) {
    const query = new URLSearchParams()
    if (nuevoTipo) query.set('tipo', nuevoTipo)
    if (categoria) query.set('categoria', categoria)
    if (desde) query.set('desde', desde)
    if (hasta) query.set('hasta', hasta)
    if (buscar) query.set('buscar', buscar)
    if (nuevoOffset) query.set('offset', String(nuevoOffset))
    return query.size ? `/movimientos?${query}` : '/movimientos'
  }

  return (
    <DashboardShell pagina={pagina} salud={salud} consultado={new Date().toISOString()}>
      <header className="page-heading resumen-v2-header">
        <h1>{pagina}</h1>
        <Link className="primary-button button-inline" href="/movimientos/nuevo">+ Nuevo</Link>
      </header>
      <Aviso aviso={parametros.aviso} error={parametros.e} />
      <nav className="filter-bar" aria-label="Filtrar movimientos">
        {tipos.map((filtro) => <Link key={filtro.etiqueta} href={enlace(filtro.valor)} className={filtro.valor === (tipo ?? '') ? 'filter-chip active' : 'filter-chip'} aria-current={filtro.valor === (tipo ?? '') ? 'page' : undefined}>{filtro.etiqueta}</Link>)}
      </nav>
      <form method="get" className="movimientos-filtros" aria-label="Buscar y filtrar movimientos">
        {tipo && <input type="hidden" name="tipo" value={tipo} />}
        <label className="movimientos-buscar">Concepto <input type="search" name="buscar" maxLength={80} defaultValue={buscar} placeholder="Buscar por concepto" /></label>
        <label>Desde <input type="date" name="desde" defaultValue={desde} /></label>
        <label>Hasta <input type="date" name="hasta" defaultValue={hasta} /></label>
        {categorias.ok && <label className="finbot-periodo">Categoría
          <select name="categoria" defaultValue={categoria}>
            <option value="">Todas</option>
            {categorias.datos.map(c => <option key={c}>{c}</option>)}
          </select>
        </label>}
        <button className="link-button" type="submit">Aplicar filtros</button>
        {(buscar || categoria || desde || hasta) && <Link className="link-button" href={tipo ? `/movimientos?tipo=${tipo}` : '/movimientos'}>Limpiar</Link>}
      </form>
      {!rangoValido && <p className="panel" role="alert">Revisa las fechas. La fecha inicial debe ser anterior o igual a la final.</p>}
      {resultado && !resultado.ok && <EstadoConexion motivo={resultado.motivo} />}
      {resultado?.ok && (resultado.datos.length === 0 ? (
        <section className="panel"><h2>No hay movimientos para mostrar</h2><p className="subheading">Prueba otro filtro o registra un movimiento.</p></section>
      ) : (
        <section className="panel transactions-panel">
          <div className="transactions-table">
            <div className="table-head"><span>Movimiento</span><span>Categoría</span><span>Fecha</span><span>Importe</span></div>
            {resultado.datos.slice(0, POR_PAGINA).map((fila) => (
              <div className="transaction-row" key={fila.id}>
                <div className="transaction-name">
                  <span className={fila.tipo === 'ingreso' ? 'tx-icon tx-in' : 'tx-icon tx-out'}>
                    {fila.tipo === 'ingreso' ? <ArrowDownLeft size={14} /> : <ArrowUpRight size={14} />}
                  </span>
                  {fila.origen
                    ? <strong>{fila.descripcion || fila.tipo}</strong>
                    : <Link className="row-link" href={`/movimientos/${fila.id}`}><strong>{fila.descripcion || fila.tipo}</strong></Link>}
                </div>
                <span className="category-pill">{fila.categoria}</span>
                <span className="muted-cell"><FormatoFecha valor={fila.fecha} /></span>
                <strong className={fila.tipo === 'ingreso' ? 'amount income' : 'amount'}><ImporteMovimiento tipo={fila.tipo} monto={fila.monto} /></strong>
              </div>
            ))}
          </div>
          <nav className="pagination" aria-label="Paginación de movimientos">
            {offset > 0 && <Link className="link-button" href={enlace(tipo, Math.max(0, offset - POR_PAGINA))}>← Anteriores</Link>}
            {resultado.datos.length > POR_PAGINA && offset + POR_PAGINA <= MAX_OFFSET && <Link className="link-button" href={enlace(tipo, offset + POR_PAGINA)}>Siguientes →</Link>}
          </nav>
        </section>
      ))}
    </DashboardShell>
  )
}
