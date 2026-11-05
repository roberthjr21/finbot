import Link from 'next/link'
import type { ReactNode } from 'react'
import { ArrowDownLeft, ArrowUpRight, BarChart3, HandCoins, Handshake, LayoutDashboard, LogOut, Menu, PiggyBank, Sparkles, X } from 'lucide-react'
import { formatearFecha, formatearMonto, type Resultado } from '@/lib/bot-api'

// Solo rutas que existen. Ingresos y Gastos son filtros del listado de movimientos.
const secciones = [
  {
    titulo: 'PRINCIPAL',
    enlaces: [
      { href: '/', etiqueta: 'Resumen', Icono: LayoutDashboard },
      { href: '/movimientos', etiqueta: 'Movimientos', Icono: BarChart3 },
      { href: '/movimientos?tipo=ingreso', etiqueta: 'Ingresos', Icono: ArrowDownLeft },
      { href: '/movimientos?tipo=gasto', etiqueta: 'Gastos', Icono: ArrowUpRight },
    ],
  },
  {
    titulo: 'PLANIFICACIÓN',
    enlaces: [{ href: '/presupuestos', etiqueta: 'Presupuestos', Icono: PiggyBank }],
  },
  {
    titulo: 'LIBRETA',
    enlaces: [
      { href: '/deudas', etiqueta: 'Deudas', Icono: HandCoins },
      { href: '/prestamos', etiqueta: 'Préstamos', Icono: Handshake },
    ],
  },
]

export function DashboardShell({
  children,
  pagina,
  salud,
  consultado,
}: Readonly<{ children: ReactNode; pagina: string; salud?: Resultado<{ ok: true }>; consultado?: string }>) {
  return (
    <div className="app-shell">
      {/* Menú móvil sin JavaScript: la casilla abre y cierra la barra lateral */}
      <input id="menu-movil" className="menu-toggle" type="checkbox" aria-hidden="true" tabIndex={-1} />
      <label htmlFor="menu-movil" className="menu-scrim" aria-hidden="true" />
      <aside className="sidebar">
        <div className="brand-row">
          <div className="brand-mark"><Sparkles size={18} /></div>
          <span>FinBot<span className="brand-muted"> Finance</span></span>
          <label htmlFor="menu-movil" className="menu-close" aria-label="Cerrar menú"><X size={18} /></label>
        </div>
        <nav className="nav-list" aria-label="Navegación principal">
          {secciones.map((seccion) => (
            <div className="nav-group" key={seccion.titulo}>
              <div className="workspace-label">{seccion.titulo}</div>
              {seccion.enlaces.map(({ href, etiqueta, Icono }) => (
                <Link
                  key={href}
                  href={href}
                  className={pagina === etiqueta ? 'nav-item active' : 'nav-item'}
                  aria-current={pagina === etiqueta ? 'page' : undefined}
                >
                  <Icono size={17} /> <span>{etiqueta}</span>
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="whatsapp-card">
            <div className="whatsapp-icon"><Sparkles size={16} /></div>
            <div><strong>Canal de registro</strong><span>WhatsApp</span></div>
          </div>
        </div>
      </aside>
      <main className="main-content">
        <header className="topbar">
          <label htmlFor="menu-movil" className="menu-button" aria-label="Abrir menú"><Menu size={20} /></label>
          <div className="breadcrumb"><span>FinBot</span><span>/</span><strong>{pagina}</strong></div>
          <form method="post" action="/api/auth/salir">
            <button className="link-button" type="submit"><LogOut size={14} /> Cerrar sesión</button>
          </form>
        </header>
        <div className="page-wrap">{children}</div>
        {salud && <p className="api-status" role="status">API: {salud.ok ? 'disponible' : 'sin respuesta'}{consultado ? ` · Consulta: ${new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Bogota' }).format(new Date(consultado))}` : ''}</p>}
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
  return <>{formatearMonto(valor)}</>
}

export function ImporteMovimiento({ tipo, monto }: { tipo: 'gasto' | 'ingreso'; monto: number }) {
  return <>{tipo === 'gasto' ? '−' : '+'}<FormatoMonto valor={monto} /></>
}

export function FormatoFecha({ valor }: { valor: string }) {
  return <>{formatearFecha(valor)}</>
}
