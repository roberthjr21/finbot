import { origenValido } from '@/lib/auth-servidor'
import { escribirBot, leerMonto, texto, volverA } from '@/lib/escritura'

export async function POST(request: Request) {
  if (!origenValido(request)) return new Response(null, { status: 403 })
  const datos = await request.formData().catch(() => null)
  const id = Number(datos?.get('id'))
  if (!datos || !Number.isSafeInteger(id) || id <= 0) return volverA('/movimientos', { e: 'Movimiento no válido.' })
  const volver = `/movimientos/${id}`

  const monto = leerMonto(datos.get('monto'))
  if (monto === null) return volverA(volver, { e: 'El monto debe ser un número entero de pesos, por ejemplo 25000.' })

  const r = await escribirBot('/interno/movimientos/editar', {
    id,
    cambios: {
      tipo: texto(datos.get('tipo'), 10),
      monto,
      categoria: texto(datos.get('categoria'), 40),
      fecha: texto(datos.get('fecha'), 10),
      descripcion: texto(datos.get('descripcion'), 200),
    },
  })
  if (r.ok) return volverA('/movimientos', { aviso: 'editado' })
  if (r.sinSesion) return volverA('/login', { expirada: '1' })
  return volverA(volver, { e: r.error })
}
