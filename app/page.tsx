'use client'

import { useState } from 'react'
import {
  ArrowDownLeft,
  ArrowUpRight,
  BarChart3,
  Bell,
  CalendarDays,
  ChevronDown,
  CircleDollarSign,
  CreditCard,
  FileText,
  LayoutDashboard,
  Menu,
  MoreHorizontal,
  PiggyBank,
  Plus,
  Search,
  Settings,
  Sparkles,
  Target,
  TrendingUp,
  Wallet,
  X,
  Zap,
  KeyRound,
  Copy,
  Eye,
} from 'lucide-react'

const money = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })

const transactions = [
  { label: 'Nómina mensual', category: 'Ingresos', account: 'Cuenta Bancolombia', date: 'Hoy, 8:42 AM', amount: 4200000, type: 'income', icon: ArrowDownLeft },
  { label: 'Mercado del mes', category: 'Alimentación', account: 'Tarjeta débito', date: 'Ayer, 6:18 PM', amount: -186450, type: 'expense', icon: Wallet },
  { label: 'Pago de arriendo', category: 'Hogar', account: 'Cuenta Bancolombia', date: '12 Jun, 9:10 AM', amount: -1450000, type: 'expense', icon: LayoutDashboard },
  { label: 'Aporte fondo emergencia', category: 'Ahorro', account: 'Bolsillo Nu', date: '10 Jun, 11:32 AM', amount: -300000, type: 'saving', icon: PiggyBank },
]

const bars = [42, 58, 47, 72, 63, 85, 68, 76, 54, 92, 78, 88]

type ApiKey = { id: string; name: string; value: string; createdAt: string }

function ApiSection() {
  const [apiName, setApiName] = useState('')
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([])
  const [visibleKey, setVisibleKey] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [error, setError] = useState('')

  const createApiKey = () => {
    const name = apiName.trim()
    if (!name) {
      setError('Escribe un nombre para identificar esta integración.')
      return
    }

    const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 24)
    const newKey: ApiKey = {
      id: crypto.randomUUID(),
      name,
      value: `fb_live_${suffix}`,
      createdAt: new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date()),
    }
    setApiKeys((currentKeys) => [newKey, ...currentKeys])
    setApiName('')
    setError('')
    setVisibleKey(newKey.id)
    setCopied(null)
  }

  const copyApiKey = async (key: ApiKey) => {
    await navigator.clipboard?.writeText(key.value)
    setCopied(key.id)
    window.setTimeout(() => setCopied((current) => current === key.id ? null : current), 1800)
  }

  return (
    <div className="api-page">
      <div className="page-heading"><div><p className="eyebrow">DESARROLLADORES</p><h1>API de FinBot</h1><p className="subheading">Conecta tus finanzas con tus propias aplicaciones y automatizaciones.</p></div><button className="primary-button" onClick={() => document.getElementById('api-name')?.focus()}><Plus size={18} /> Crear API</button></div>
      <section className="api-layout">
        <article className="panel api-create-card"><div className="api-icon"><KeyRound size={22} /></div><h2>Crea una clave API</h2><p>Usa una clave para consultar tus movimientos, saldos y presupuestos desde una integración externa.</p><label htmlFor="api-name">Nombre de la integración</label><input id="api-name" value={apiName} onChange={(event) => { setApiName(event.target.value); setError('') }} onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229) createApiKey() }} placeholder="Ej. Mi app de finanzas" aria-invalid={Boolean(error)} />{error && <span className="api-error" role="alert">{error}</span>}<button className="primary-button api-submit" onClick={createApiKey}><KeyRound size={17} /> Generar clave</button></article>
        <article className="panel api-info-card"><div className="panel-heading"><div><h2>Claves activas</h2><p>Administra el acceso a tu cuenta</p></div><span className="alert-count">{apiKeys.length}</span></div>{apiKeys.length ? <div className="api-key-list">{apiKeys.map((key) => <div className="api-key-row" key={key.id}><div><strong>{key.name}</strong><small>Creada el {key.createdAt}</small><span className="api-key-value">{visibleKey === key.id ? key.value : 'fb_live_••••••••••••••••'}</span></div><div className="api-key-actions"><button className="icon-button" onClick={() => setVisibleKey(visibleKey === key.id ? null : key.id)} aria-label="Mostrar u ocultar clave"><Eye size={17} /></button><button className="icon-button" onClick={() => copyApiKey(key)} aria-label={`Copiar clave de ${key.name}`}><Copy size={17} /></button></div>{copied === key.id && <span className="api-copied">Clave copiada.</span>}</div>)}</div> : <div className="api-empty"><KeyRound size={22} /><strong>No hay claves creadas</strong><span>Crea tu primera clave para comenzar.</span></div>}</article>
      </section>
      <div className="api-security"><KeyRound size={17} /><span><strong>Consejo de seguridad:</strong> nunca compartas tu clave API. Podrás revocarla desde aquí en cualquier momento.</span></div>
    </div>
  )
}

export default function Page() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [activeNav, setActiveNav] = useState('Resumen')
  const [showAll, setShowAll] = useState(false)
  const [darkMode, setDarkMode] = useState(true)

  return (
    <div className={darkMode ? 'app-shell dark-mode' : 'app-shell'}>
      <aside className={menuOpen ? 'sidebar sidebar-open' : 'sidebar'}>
        <div className="brand-row">
          <div className="brand-mark"><Sparkles size={18} /></div>
          <span>FinBot<span className="brand-muted"> Finance</span></span>
          <button className="mobile-close" onClick={() => setMenuOpen(false)} aria-label="Cerrar menú"><X size={18} /></button>
        </div>
        <div className="workspace-label">MI ESPACIO</div>
        <nav className="nav-list" aria-label="Navegación principal">
          {[
            [LayoutDashboard, 'Resumen'], [ArrowUpRight, 'Movimientos'], [Target, 'Presupuestos'], [PiggyBank, 'Ahorros'], [CreditCard, 'Deudas y préstamos'], [Wallet, 'Cuentas'], [BarChart3, 'Informes'], [KeyRound, 'API'],
          ].map(([Icon, label]) => (
            <button key={label as string} className={activeNav === label ? 'nav-item active' : 'nav-item'} onClick={() => { setActiveNav(label as string); setMenuOpen(false) }}>
              <Icon size={17} /> <span>{label as string}</span>
              {label === 'Movimientos' && <span className="nav-count">12</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="whatsapp-card"><div className="whatsapp-icon"><Zap size={16} /></div><div><strong>Conectado a WhatsApp</strong><span>Último mensaje hace 8 min</span></div><span className="online-dot" /></div>
          <button className="nav-item"><Settings size={17} /><span>Configuración</span></button>
        </div>
      </aside>
      <main className="main-content">
        <header className="topbar"><button className="menu-button" onClick={() => setMenuOpen(true)} aria-label="Abrir menú"><Menu size={20} /></button><div className="breadcrumb"><span>Mi espacio</span><span>/</span><strong>{activeNav}</strong></div><div className="top-actions"><button className="icon-button" aria-label="Buscar"><Search size={18} /></button><button className="icon-button notification" aria-label="Notificaciones"><Bell size={18} /><i /></button><button className="mode-toggle" onClick={() => setDarkMode(!darkMode)} aria-label="Cambiar tema"><span className={darkMode ? 'mode-dot dark' : 'mode-dot'} /></button></div></header>
        <div className="page-wrap">
          {activeNav === 'API' ? <ApiSection /> : <>
          <div className="page-heading"><div><p className="eyebrow">MARTES, 18 DE JUNIO DE 2024</p><h1>Buenos días, Juan <span className="wave">✦</span></h1><p className="subheading">Este es el resumen de tus finanzas este mes.</p></div><button className="primary-button"><Plus size={18} /> Registrar movimiento</button></div>
          <section className="stat-grid" aria-label="Resumen financiero">
            <article className="stat-card balance-card"><div className="stat-top"><span>Saldo total</span><CircleDollarSign size={17} /></div><strong>{money.format(8756430)}</strong><div className="stat-foot positive"><TrendingUp size={14} /> 8,4% <span>vs. mes anterior</span></div><div className="sparkline"><i/><i/><i/><i/><i/><i/><i/><i/><i/></div></article>
            <article className="stat-card"><div className="stat-top"><span>Ingresos del mes</span><ArrowDownLeft size={17} className="income-icon" /></div><strong>{money.format(4200000)}</strong><div className="stat-foot positive"><TrendingUp size={14} /> 12,2% <span>vs. mes anterior</span></div></article>
            <article className="stat-card"><div className="stat-top"><span>Gastos del mes</span><ArrowUpRight size={17} className="expense-icon" /></div><strong>{money.format(2481370)}</strong><div className="stat-foot negative"><ArrowUpRight size={14} /> 4,8% <span>vs. mes anterior</span></div></article>
            <article className="stat-card"><div className="stat-top"><span>Ahorro acumulado</span><PiggyBank size={17} className="saving-icon" /></div><strong>{money.format(1325000)}</strong><div className="stat-foot positive"><TrendingUp size={14} /> 18,6% <span>vs. mes anterior</span></div></article>
          </section>
          <section className="charts-grid"><article className="panel evolution-panel"><div className="panel-heading"><div><h2>Evolución financiera</h2><p>Ingresos y gastos de los últimos 12 meses</p></div><button className="select-button">Últimos 12 meses <ChevronDown size={15} /></button></div><div className="legend"><span><i className="legend-income" />Ingresos</span><span><i className="legend-expense" />Gastos</span></div><div className="chart"><div className="y-labels"><span>$5M</span><span>$4M</span><span>$3M</span><span>$2M</span><span>$1M</span><span>$0</span></div><div className="chart-area"><div className="grid-lines"><i/><i/><i/><i/><i/><i/></div><div className="bar-group">{bars.map((height, index) => <div className="bar-pair" key={index}><i className="bar income-bar" style={{ height: `${height}%` }} /><i className="bar expense-bar" style={{ height: `${Math.max(25, height - 23)}%` }} /></div>)}</div><div className="x-labels">{['Jul','Ago','Sep','Oct','Nov','Dic','Ene','Feb','Mar','Abr','May','Jun'].map((month) => <span key={month}>{month}</span>)}</div></div></div></article><article className="panel budget-panel"><div className="panel-heading"><div><h2>Presupuesto mensual</h2><p>Junio 2024</p></div><button className="more-button" aria-label="Más opciones"><MoreHorizontal size={18} /></button></div><div className="budget-ring"><div><strong>63%</strong><span>utilizado</span></div></div><div className="budget-numbers"><div><span>Gastado</span><strong>{money.format(2481370)}</strong></div><div><span>Disponible</span><strong>{money.format(1428630)}</strong></div></div><div className="budget-progress"><span style={{ width: '63%' }} /></div><p className="budget-note"><span className="status-dot" /> Vas bien. Tienes <strong>12 días</strong> para terminar el mes.</p></article></section>
          <section className="bottom-grid"><article className="panel transactions-panel"><div className="panel-heading"><div><h2>Últimos movimientos</h2><p>Actividad reciente de tus cuentas</p></div><button className="link-button" onClick={() => setShowAll(!showAll)}>{showAll ? 'Ver menos' : 'Ver todos'} <ArrowUpRight size={15} /></button></div><div className="transactions-table"><div className="table-head"><span>Movimiento</span><span>Categoría</span><span>Cuenta</span><span>Fecha</span><span>Importe</span></div>{(showAll ? [...transactions, ...transactions] : transactions).map((transaction, index) => { const Icon = transaction.icon; return <div className="transaction-row" key={`${transaction.label}-${index}`}><div className="transaction-name"><div className={`transaction-icon ${transaction.type}`}><Icon size={16} /></div><strong>{transaction.label}</strong></div><span className="category-pill">{transaction.category}</span><span className="muted-cell">{transaction.account}</span><span className="muted-cell">{transaction.date}</span><strong className={transaction.amount > 0 ? 'amount income' : 'amount'}>{transaction.amount > 0 ? '+' : ''}{money.format(transaction.amount)}</strong></div> })}</div></article><article className="panel alerts-panel"><div className="panel-heading"><div><h2>Alertas inteligentes</h2><p>Recomendaciones de FinBot</p></div><span className="alert-count">2</span></div><div className="alert-item"><div className="alert-icon amber"><Bell size={16} /></div><div><strong>Alimentación al 84%</strong><p>Has usado {money.format(504000)} de tu presupuesto.</p><button>Ver presupuesto <ArrowUpRight size={13} /></button></div></div><div className="alert-item"><div className="alert-icon green"><PiggyBank size={16} /></div><div><strong>Meta “Fondo de emergencia”</strong><p>Vas en el 68%. ¡Sigue así!</p><button>Ver meta <ArrowUpRight size={13} /></button></div></div><div className="whatsapp-tip"><Sparkles size={16} /><span>Escribe <strong>“resumen”</strong> en WhatsApp para recibir tu reporte.</span></div></article></section>
          </>}
          <footer className="page-footer"><span><span className="live-dot" /> Datos actualizados hace 2 min</span><span>FinBot Finance · Tus datos están protegidos</span></footer>
        </div>
      </main>
    </div>
  )
}
