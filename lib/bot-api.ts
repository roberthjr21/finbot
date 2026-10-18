import 'server-only'
import { headers } from 'next/headers'
import { credencialesDashboardValidas } from './dashboard-auth'

export type Movimiento = {
  id: number
  tipo: 'gasto' | 'ingreso'
  monto: number
  categoria: string
  descripcion: string
  fecha: string
}
export type Resumen = {
  mes: string
  desde: string
  hasta: string
  ingresos: number
  gastos: number
  balance: number
  porCategoria: Array<{ categoria: string; total: number }>
}

export type Presupuesto = {
  categoria: string
  limite: number
  gastado: number
  porcentaje: number
}

export type Resultado<T> =
  | { ok: true; datos: T }
  | { ok: false; motivo: 'configuracion' | 'conexion' }

function configuracion() {
  const base = process.env.BOT_API_URL?.trim().replace(/\/+$/, '')
  const token = process.env.BOT_API_TOKEN?.trim()
  if (!base || !token) return null
  try {
    const url = new URL(base)
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    if (!['https:', 'http:'].includes(url.protocol) || (url.protocol === 'http:' && !local)) return null
    if (url.username || url.password || url.search || url.hash) return null
  } catch {
    return null
  }
  return { base, token }
}

async function consultar<T>(ruta: string, validar: (valor: unknown) => valor is T): Promise<Resultado<T>> {
  const cabecerasSolicitud = await headers()
  if (!credencialesDashboardValidas(cabecerasSolicitud.get('authorization'))) {
    return { ok: false, motivo: 'conexion' }
  }

  const config = configuracion()
  if (!config) return { ok: false, motivo: 'configuracion' }

  try {
    const respuesta = await fetch(`${config.base}${ruta}`, {
      headers: { Authorization: `Bearer ${config.token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    })
    if (!respuesta.ok) return { ok: false, motivo: 'conexion' }
    const datos: unknown = await respuesta.json()
    if (!validar(datos)) return { ok: false, motivo: 'conexion' }
    return { ok: true, datos }
  } catch {
    return { ok: false, motivo: 'conexion' }
  }
}

function mesActual() {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date())
  const año = partes.find((parte) => parte.type === 'year')?.value
  const mes = partes.find((parte) => parte.type === 'month')?.value
  return `${año}-${mes}`
}

export async function obtenerResumen(): Promise<Resultado<Resumen>> {
  return consultar(`/api/resumen?mes=${mesActual()}`, (dato): dato is Resumen => {
    if (!dato || typeof dato !== 'object') return false
    const valor = dato as Record<string, unknown>
    return typeof valor.mes === 'string' && typeof valor.ingresos === 'number' && Number.isSafeInteger(valor.ingresos) && valor.ingresos >= 0 &&
      typeof valor.gastos === 'number' && Number.isSafeInteger(valor.gastos) && valor.gastos >= 0 &&
      typeof valor.balance === 'number' && Number.isSafeInteger(valor.balance) &&
      Array.isArray(valor.porCategoria) && valor.porCategoria.every((fila) =>
        !!fila && typeof fila === 'object' && typeof (fila as Record<string, unknown>).categoria === 'string' &&
        Number.isSafeInteger((fila as Record<string, unknown>).total) && (fila as Record<string, number>).total >= 0)
  })
}

export async function obtenerMovimientos(offset = 0): Promise<Resultado<Movimiento[]>> {
  const seguro = Number.isSafeInteger(offset) && offset >= 0 ? Math.min(offset, 1_000_000) : 0
  return consultar(`/api/movimientos?limite=100&offset=${seguro}`, (dato): dato is Movimiento[] =>
    Array.isArray(dato) && dato.every((fila) => {
      if (!fila || typeof fila !== 'object') return false
      const valor = fila as Record<string, unknown>
      return Number.isSafeInteger(valor.id) && (valor.tipo === 'gasto' || valor.tipo === 'ingreso') &&
        typeof valor.monto === 'number' && Number.isSafeInteger(valor.monto) &&
        typeof valor.categoria === 'string' && typeof valor.descripcion === 'string' && typeof valor.fecha === 'string'
    }))
}

export async function obtenerPresupuestos(): Promise<Resultado<Presupuesto[]>> {
  return consultar(`/api/presupuestos?mes=${mesActual()}`, (dato): dato is Presupuesto[] =>
    Array.isArray(dato) && dato.every((fila) => {
      if (!fila || typeof fila !== 'object') return false
      const valor = fila as Record<string, unknown>
      return typeof valor.categoria === 'string' && typeof valor.limite === 'number' && Number.isSafeInteger(valor.limite) && valor.limite > 0 &&
        typeof valor.gastado === 'number' && Number.isSafeInteger(valor.gastado) && valor.gastado >= 0 &&
        typeof valor.porcentaje === 'number' && Number.isSafeInteger(valor.porcentaje)
    }))
}
