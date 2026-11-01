import 'server-only'
import { redirect } from 'next/navigation'
import { configuracionBot, tokenDeSesion } from './sesion'

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

// Consulta de solo lectura al bot en nombre de la persona que tiene la sesión abierta.
// La cuenta la decide el bot a partir del token de sesión (cookie HttpOnly): aquí nunca se envía
// ni se acepta un número de teléfono o un id de usuario para elegir de quién son los datos.
async function consultar<T>(ruta: string, validar: (valor: unknown) => valor is T): Promise<Resultado<T>> {
  const sesion = await tokenDeSesion()
  if (!sesion) redirect('/login')

  const config = configuracionBot()
  if (!config) return { ok: false, motivo: 'configuracion' }

  let resultado: Resultado<T> = { ok: false, motivo: 'conexion' }
  let sesionVencida = false
  try {
    const respuesta = await fetch(`${config.base}${ruta}`, {
      headers: { Authorization: `Bearer ${config.token}`, 'X-Sesion': sesion },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    })
    const cuerpo: unknown = await respuesta.json().catch(() => null)
    if (respuesta.status === 401 && (cuerpo as { error?: unknown } | null)?.error === 'Sesión no válida') {
      sesionVencida = true
    } else if (respuesta.ok && validar(cuerpo)) {
      resultado = { ok: true, datos: cuerpo }
    }
  } catch {
    // se queda en "conexion"
  }
  // La redirección va fuera del try para que no se confunda con un error de conexión
  if (sesionVencida) redirect('/login?expirada=1')
  return resultado
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

export type Saldo = { ingresos: number; gastos: number; balance: number }
export type DeudaPersona = {
  persona: string
  saldo: number
  historial: Array<{ tipo: 'debo' | 'abono'; monto: number; descripcion: string; fecha: string }>
}
export type Deudas = { total: number; personas: DeudaPersona[] }

export async function obtenerYo(): Promise<Resultado<{ telefono: string }>> {
  return consultar('/api/yo', (dato): dato is { telefono: string } =>
    !!dato && typeof dato === 'object' && typeof (dato as Record<string, unknown>).telefono === 'string')
}

export async function obtenerSaldo(): Promise<Resultado<Saldo>> {
  return consultar('/api/saldo', (dato): dato is Saldo => {
    if (!dato || typeof dato !== 'object') return false
    const valor = dato as Record<string, unknown>
    return Number.isSafeInteger(valor.ingresos) && Number.isSafeInteger(valor.gastos) && Number.isSafeInteger(valor.balance)
  })
}

export async function obtenerDeudas(): Promise<Resultado<Deudas>> {
  return consultar('/api/deudas', (dato): dato is Deudas => {
    if (!dato || typeof dato !== 'object') return false
    const valor = dato as Record<string, unknown>
    return Number.isSafeInteger(valor.total) && Array.isArray(valor.personas) && valor.personas.every((p) => {
      if (!p || typeof p !== 'object') return false
      const fila = p as Record<string, unknown>
      return typeof fila.persona === 'string' && Number.isSafeInteger(fila.saldo) && Array.isArray(fila.historial) &&
        fila.historial.every((h) => {
          if (!h || typeof h !== 'object') return false
          const mov = h as Record<string, unknown>
          return (mov.tipo === 'debo' || mov.tipo === 'abono') && Number.isSafeInteger(mov.monto) &&
            typeof mov.descripcion === 'string' && typeof mov.fecha === 'string'
        })
    })
  })
}
