import Link from 'next/link'
import type { ReactNode } from 'react'
import { BarChart3, LayoutDashboard, PiggyBank, Sparkles } from 'lucide-react'

const enlaces = [
  { href: '/', etiqueta: 'Resumen', Icono: LayoutDashboard },
  { href: '/movimientos', etiqueta: 'Movimientos', Icono: BarChart3 },
  { href: '/presupuestos', etiqueta: 'Presupuestos', Icono: PiggyBank },
]

export function DashboardShell({
  children,
  pagina,
}: Readonly<{ children: ReactNode; pagina: string }>) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-row">
          <div className="brand-mark"><Sparkles size={18} /></div>
          <span>FinBot<span className="brand-muted"> Finance</span></span>
        </div>
        <div className="workspace-label">TUS FINANZAS</div>
        <nav className="nav-list" aria-label="Navegación principal">
          {enlaces.map(({ href, etiqueta, Icono }) => (
            <Link
              key={href}
              href={href}
              className={pagina === etiqueta ? 'nav-item active' : 'nav-item'}
              aria-current={pagina === etiqueta ? 'page' : undefined}
            >
              <Icono size={17} /> <span>{etiqueta}</span>
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="whatsapp-card">
            <div className="whatsapp-icon"><Sparkles size={16} /></div>
            <div><strong>Origen de datos</strong><span>WhatsApp · SQLite</span></div>
          </div>
        </div>
      </aside>
      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb"><span>FinBot</span><span>/</span><strong>{pagina}</strong></div>
        </header>
        <div className="page-wrap">{children}</div>
      </main>
    </div>
  )
}

export function EstadoConexion({ motivo, seccion }: { motivo: 'configuracion' | 'conexion'; seccion?: string }) {
  const configurando = motivo === 'configuracion'
  return (
    <section className="panel" role="status" aria-live="polite">
      <h2>{seccion ? `${seccion}: ` : ''}{configurando ? 'Falta conectar el bot' : 'No se pudieron cargar los datos'}</h2>
      <p className="subheading">
        {configurando
          ? 'Configura BOT_API_URL y BOT_API_TOKEN en el entorno del servidor web.'
          : 'Comprueba que el bot esté activo y que la URL y el token del API sean correctos.'}
      </p>
    </section>
  )
}

export function FormatoMonto({ valor }: { valor: number }) {
  return <>{new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(valor)}</>
}

export function ImporteMovimiento({ tipo, monto }: { tipo: 'gasto' | 'ingreso'; monto: number }) {
  return <>{tipo === 'gasto' ? '−' : '+'}<FormatoMonto valor={monto} /></>
}

export function FormatoFecha({ valor }: { valor: string }) {
  const fecha = new Date(`${valor}T12:00:00Z`)
  if (Number.isNaN(fecha.getTime())) return <>{valor}</>
  return <>{new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeZone: 'America/Bogota' }).format(fecha)}</>
}
