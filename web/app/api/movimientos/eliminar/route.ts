import { leerFormularioSeguro } from '@/lib/seguridad-http'
import { origenValido } from '@/lib/auth-servidor'
import { escribirBot, volverA } from '@/lib/escritura'

// Borra un movimiento. Exige la casilla de confirmación del formulario.
export async function POST(request: Request) {
  if (!origenValido(request)) return new Response(null, { status: 403 })
  const datos = await leerFormularioSeguro(request).catch(() => null)
  const id = Number(datos?.get('id'))
  if (!datos || !Number.isSafeInteger(id) || id <= 0) return volverA('/movimientos', { e: 'Movimiento no válido.' })
  if (datos.get('confirmar') !== 'si') return volverA(`/movimientos/${id}`, { e: 'Marca la casilla para confirmar que quieres borrarlo.' })

  const r = await escribirBot('/interno/movimientos/eliminar', { id })
  if (r.ok) return volverA('/movimientos', { aviso: 'eliminado' })
  if (r.sinSesion) return volverA('/login', { expirada: '1' })
  return volverA(`/movimientos/${id}`, { e: r.error })
}
