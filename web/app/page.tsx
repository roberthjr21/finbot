import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { ArrowDownLeft, ArrowUpRight, PiggyBank, Plus, Wallet } from 'lucide-react'
import { DashboardShell, EstadoConexion, FormatoFecha, FormatoMonto, ImporteMovimiento } from '@/components/dashboard-shell'
import { SelectorPeriodo, periodoSeleccionado } from '@/components/selector-periodo'
import { obtenerMovimientos, obtenerPresupuestos, obtenerResumen, obtenerSalud, obtenerSaldo } from '@/lib/bot-api'
import { tokenDeSesion } from '@/lib/sesion'

type Rango = { desde: string; hasta: string }
const MOVIMIENTOS_RECIENTES = 5

function Cargando({ texto }: { texto: string }) {
  return <p className="panel subheading resumen-cargando" role="status">{texto}</p>
}

async function SaldoActual() {
  const saldo = await obtenerSaldo()
  if (!saldo.ok) return <EstadoConexion motivo={saldo.motivo} seccion="Saldo" />

  return (
    <div className="resumen-v2-saldo">
      <section className="hero-card resumen-v2-total" aria-label="Saldo registrado">
        <span className="hero-label"><Wallet size={17} /> Saldo registrado</span>
        <strong className="hero-amount"><FormatoMonto valor={saldo.datos.balance} /></strong>
        <span className="hero-note">Incluye el dinero apartado en Ahorro general.</span>
      </section>
      <section className="stat-card resumen-v2-ahorro" aria-label="Ahorro general">
        <div className="stat-top"><span>Ahorro general</span><PiggyBank size={18} /></div>
        <strong><FormatoMonto valor={saldo.datos.ahorroGeneral ?? 0} /></strong>
        <Link className="resumen-v2-link" href="/presupuestos">Ver en presupuestos</Link>
      </section>
    </div>
  )
}

async function CifrasDelPeriodo({ mes }: { mes: string }) {
  const resumen = await obtenerResumen(mes)
  if (!resumen.ok) return <EstadoConexion motivo={resumen.motivo} seccion="Resumen" />
  return (
    <section className="stat-card resumen-v2-periodo" aria-label="Ingresos y gastos del periodo">
      <div>
        <div className="stat-top"><span>Ingresos del periodo</span><ArrowDownLeft className="icon-ingreso" size={17} /></div>
        <strong><FormatoMonto valor={resumen.datos.ingresos} /></strong>
      </div>
      <div>
        <div className="stat-top"><span>Gastos del periodo</span><ArrowUpRight className="icon-gasto" size={17} /></div>
        <strong><FormatoMonto valor={resumen.datos.gastos} /></strong>
      </div>
    </section>
  )
}

async function MovimientosDelPeriodo({ rango }: { rango: Rango }) {
  const resultado = await obtenerMovimientos({ ...rango, limite: MOVIMIENTOS_RECIENTES })
  if (!resultado.ok) return <EstadoConexion motivo={resultado.motivo} seccion="Movimientos" />

  return (
    <section className="panel transactions-panel" aria-labelledby="movimientos-recientes">
      <div className="panel-heading">
        <h2 id="movimientos-recientes">Movimientos recientes</h2>
        <Link className="link-button" href={{ pathname: '/movimientos', query: rango }}>Ver todos</Link>
      </div>
      {resultado.datos.length === 0 ? (
        <p className="empty-note">Todavía no hay movimientos en este periodo.</p>
      ) : (
        <div className="transactions-table">
          {resultado.datos.map((fila) => (
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
      )}
    </section>
  )
}

async function PresupuestosDelPeriodo({ mes }: { mes: string }) {
  const resultado = await obtenerPresupuestos(mes)
  if (!resultado.ok) return <EstadoConexion motivo={resultado.motivo} seccion="Presupuestos" />

  return (
    <section className="panel" aria-labelledby="presupuestos-resumen">
      <div className="panel-heading">
        <h2 id="presupuestos-resumen">Presupuestos</h2>
        <Link className="link-button" href={{ pathname: '/presupuestos', query: { mes } }}>Ver todos</Link>
      </div>
      {resultado.datos.length === 0 ? (
        <p className="empty-note">Crea un presupuesto desde WhatsApp para seguir tus límites aquí.</p>
      ) : (
        <ul className="cat-bars">
          {resultado.datos.slice(0, 4).map((fila) => {
            const restante = fila.limite - fila.gastado
            const porcentaje = Math.min(100, Math.max(0, fila.porcentaje))
            return (
              <li key={fila.categoria}>
                <div className="cat-bars-top">
                  <span>{fila.categoria}</span>
                  <strong><FormatoMonto valor={Math.abs(restante)} /> {restante < 0 ? 'por encima' : 'restantes'}</strong>
                </div>
                <div className={fila.porcentaje >= 100 ? 'meter meter-over' : fila.porcentaje >= 80 ? 'meter meter-warn' : 'meter'}
                  role="progressbar" aria-label={`Uso del presupuesto de ${fila.categoria}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={porcentaje}>
                  <span style={{ width: `${porcentaje}%` }} />
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

async function EstadoDelBot() {
  const salud = await obtenerSalud()
  return <p className="page-footer" role="status">API: {salud.ok ? 'disponible' : 'sin respuesta'}</p>
}

export default async function Page({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  if (!await tokenDeSesion()) redirect('/login')
  const { mes, meses, rango } = periodoSeleccionado((await searchParams).mes)
  return (
    <DashboardShell pagina="Resumen">
      <header className="page-heading resumen-v2-header">
        <h1>Resumen financiero</h1>
        <div className="resumen-v2-acciones">
          <SelectorPeriodo mes={mes} meses={meses} />
          <Link className="link-button" href={{ pathname: '/reportes', query: { mes } }}>Reportes</Link>
          <Link className="primary-button button-inline" href="/movimientos/nuevo"><Plus size={17} /> Registrar movimiento</Link>
        </div>
      </header>
      <div className="resumen-v2-metricas">
        <Suspense fallback={<Cargando texto="Cargando saldo y ahorro…" />}><SaldoActual /></Suspense>
        <Suspense key={mes} fallback={<Cargando texto="Cargando cifras del periodo…" />}><CifrasDelPeriodo mes={mes} /></Suspense>
      </div>
      <div className="resumen-v2-actividad">
        <Suspense key={`movimientos-${mes}`} fallback={<Cargando texto="Cargando movimientos…" />}><MovimientosDelPeriodo rango={rango} /></Suspense>
        <Suspense key={`presupuestos-${mes}`} fallback={<Cargando texto="Cargando presupuestos…" />}><PresupuestosDelPeriodo mes={mes} /></Suspense>
      </div>
      <nav className="quick-links" aria-label="Accesos rápidos">
        <Link href="/deudas">Deudas</Link>
        <Link href="/prestamos">Préstamos</Link>
      </nav>
      <Suspense fallback={null}><EstadoDelBot /></Suspense>
    </DashboardShell>
  )
}
