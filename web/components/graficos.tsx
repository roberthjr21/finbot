import { formatearMonto } from '@/lib/bot-api'

// Gráficos hechos con SVG, sin librerías. Reciben datos reales ya calculados por el bot.

const compacto = (valor: number) =>
  new Intl.NumberFormat('es-CO', { notation: 'compact', maximumFractionDigits: 1 }).format(valor)

export type PuntoMes = { etiqueta: string; ingresos: number; gastos: number }

// Barras agrupadas: ingresos frente a gastos por mes
export function BarrasIngresosGastos({ datos }: Readonly<{ datos: PuntoMes[] }>) {
  const ancho = 560
  const alto = 220
  const margen = { arriba: 12, abajo: 28, izq: 44, der: 8 }
  const maximo = Math.max(1, ...datos.flatMap((d) => [d.ingresos, d.gastos]))
  const util = alto - margen.arriba - margen.abajo
  const columna = (ancho - margen.izq - margen.der) / Math.max(datos.length, 1)
  const barra = Math.min(22, columna / 3)
  const y = (v: number) => margen.arriba + util - (v / maximo) * util
  const marcas = [0, 0.5, 1]
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${ancho} ${alto}`} role="img" aria-label="Ingresos frente a gastos por mes">
        {marcas.map((m) => (
          <g key={m}>
            <line x1={margen.izq} x2={ancho - margen.der} y1={y(maximo * m)} y2={y(maximo * m)} className="chart-grid" />
            <text x={margen.izq - 8} y={y(maximo * m) + 4} textAnchor="end" className="chart-axis">{compacto(maximo * m)}</text>
          </g>
        ))}
        {datos.map((d, i) => {
          const x0 = margen.izq + i * columna + columna / 2
          return (
            <g key={d.etiqueta}>
              <title>{`${d.etiqueta}: ingresos ${formatearMonto(d.ingresos)}, gastos ${formatearMonto(d.gastos)}`}</title>
              <rect x={x0 - barra - 1} y={y(d.ingresos)} width={barra} height={Math.max(0, margen.arriba + util - y(d.ingresos))} rx="4" className="bar-ingreso" />
              <rect x={x0 + 1} y={y(d.gastos)} width={barra} height={Math.max(0, margen.arriba + util - y(d.gastos))} rx="4" className="bar-gasto" />
              <text x={x0} y={alto - 8} textAnchor="middle" className="chart-axis">{d.etiqueta}</text>
            </g>
          )
        })}
      </svg>
      <figcaption className="chart-legend"><span><i className="dot dot-ingreso" /> Ingresos</span><span><i className="dot dot-gasto" /> Gastos</span></figcaption>
    </figure>
  )
}

// Barras horizontales: gastos por categoría (con su porcentaje del total)
export function BarrasCategorias({ filas }: Readonly<{ filas: Array<{ categoria: string; total: number }> }>) {
  const total = filas.reduce((s, f) => s + f.total, 0)
  const maximo = Math.max(1, ...filas.map((f) => f.total))
  return (
    <ul className="cat-bars">
      {filas.map((f) => (
        <li key={f.categoria}>
          <div className="cat-bars-top"><span>{f.categoria}</span><strong>{formatearMonto(f.total)} <em>{total > 0 ? Math.round((f.total / total) * 100) : 0}%</em></strong></div>
          <div className="meter" role="img" aria-label={`${f.categoria}: ${total > 0 ? Math.round((f.total / total) * 100) : 0}% de los gastos`}><span style={{ width: `${(f.total / maximo) * 100}%` }} /></div>
        </li>
      ))}
    </ul>
  )
}

// Indicador de tendencia contra el mes anterior. "bueno" dice si subir es positivo (ingresos) o negativo (gastos).
export function Tendencia({ actual, previo, subirEsBueno }: Readonly<{ actual: number; previo: number; subirEsBueno: boolean }>) {
  if (previo === 0 && actual === 0) return <span className="trend trend-neutral">Sin cambios</span>
  if (previo === 0) return <span className="trend trend-neutral">Nuevo este mes</span>
  const pct = Math.round(((actual - previo) / previo) * 100)
  if (pct === 0) return <span className="trend trend-neutral">Igual que el mes pasado</span>
  const sube = pct > 0
  const bueno = sube === subirEsBueno
  return (
    <span className={bueno ? 'trend trend-good' : 'trend trend-bad'}>
      {sube ? '▲' : '▼'} {Math.abs(pct)}% <small>vs mes anterior</small>
    </span>
  )
}

// Reparto de lo que tienes y lo que está en la calle: saldo, te deben, debes
export function BarraPatrimonio({ teDeben, debes }: Readonly<{ teDeben: number; debes: number }>) {
  const total = teDeben + debes
  if (total === 0) return null
  return (
    <div className="split" role="img" aria-label={`Te deben ${formatearMonto(teDeben)} y debes ${formatearMonto(debes)}`}>
      <span className="split-in" style={{ width: `${(teDeben / total) * 100}%` }} />
      <span className="split-out" style={{ width: `${(debes / total) * 100}%` }} />
    </div>
  )
}
