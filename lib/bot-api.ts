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
export type MovimientoFiltros = {
  desde?: string
  hasta?: string
  tipo?: 'gasto' | 'ingreso'
  categoria?: string
  limite?: number
  offset?: number
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

function fechaValida(fecha: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return false
  const valor = new Date(`${fecha}T12:00:00Z`)
  return !Number.isNaN(valor.getTime()) && valor.toISOString().slice(0, 10) === fecha
}

function mesValido(mes: string) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(mes)
}

export function formatearMonto(valor: number) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(valor)
}

export function formatearFecha(valor: string) {
  const fecha = new Date(`${valor}T12:00:00Z`)
  if (Number.isNaN(fecha.getTime())) return valor
  return new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeZone: 'America/Bogota' }).format(fecha)
}

export async function obtenerSalud(): Promise<Resultado<{ ok: true }>> {
  return consultar('/api/salud', (dato): dato is { ok: true } =>
    !!dato && typeof dato === 'object' && (dato as Record<string, unknown>).ok === true)
}

export async function obtenerCategorias(): Promise<Resultado<string[]>> {
  return consultar('/api/categorias', (dato): dato is string[] =>
    Array.isArray(dato) && dato.every((categoria) => typeof categoria === 'string'))
}

export async function obtenerResumen(mes = mesActual()): Promise<Resultado<Resumen>> {
  if (!mesValido(mes)) return { ok: false, motivo: 'conexion' }
  return consultar(`/api/resumen?mes=${encodeURIComponent(mes)}`, (dato): dato is Resumen => {
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

export async function obtenerMovimientos(filtros: MovimientoFiltros = {}): Promise<Resultado<Movimiento[]>> {
  const { desde, hasta, tipo, categoria, limite = 100, offset = 0 } = filtros
  if ((desde !== undefined && !fechaValida(desde)) || (hasta !== undefined && !fechaValida(hasta)) ||
      (desde && hasta && desde > hasta) || (tipo !== undefined && tipo !== 'gasto' && tipo !== 'ingreso') ||
      (categoria !== undefined && (categoria.length === 0 || categoria.length > 100)) ||
      !Number.isSafeInteger(limite) || limite < 1 || limite > 500 ||
      !Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000) {
    return { ok: false, motivo: 'conexion' }
  }
  const parametros = new URLSearchParams({ limite: String(limite), offset: String(offset) })
  if (desde) parametros.set('desde', desde)
  if (hasta) parametros.set('hasta', hasta)
  if (tipo) parametros.set('tipo', tipo)
  if (categoria) parametros.set('categoria', categoria)
  return consultar(`/api/movimientos?${parametros}`, (dato): dato is Movimiento[] =>
    Array.isArray(dato) && dato.every((fila) => {
      if (!fila || typeof fila !== 'object') return false
      const valor = fila as Record<string, unknown>
      return Number.isSafeInteger(valor.id) && (valor.tipo === 'gasto' || valor.tipo === 'ingreso') &&
        typeof valor.monto === 'number' && Number.isSafeInteger(valor.monto) &&
        typeof valor.categoria === 'string' && typeof valor.descripcion === 'string' && typeof valor.fecha === 'string'
    }))
}

export async function obtenerPresupuestos(mes = mesActual()): Promise<Resultado<Presupuesto[]>> {
  if (!mesValido(mes)) return { ok: false, motivo: 'conexion' }
  return consultar(`/api/presupuestos?mes=${encodeURIComponent(mes)}`, (dato): dato is Presupuesto[] =>
    Array.isArray(dato) && dato.every((fila) => {
      if (!fila || typeof fila !== 'object') return false
      const valor = fila as Record<string, unknown>
      return typeof valor.categoria === 'string' && typeof valor.limite === 'number' && Number.isSafeInteger(valor.limite) && valor.limite > 0 &&
        typeof valor.gastado === 'number' && Number.isSafeInteger(valor.gastado) && valor.gastado >= 0 &&
        typeof valor.porcentaje === 'number' && Number.isSafeInteger(valor.porcentaje)
    }))
}
