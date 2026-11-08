import { origenValido } from '@/lib/auth-servidor'
import { escribirBot, leerMonto, texto, volverA } from '@/lib/escritura'

// Crea un movimiento desde el formulario. La "clave" viaja oculta en el formulario: si se envía dos veces
// (doble clic, reintento), el bot lo registra una sola vez.
export async function POST(request: Request) {
  if (!origenValido(request)) return new Response(null, { status: 403 })
  const datos = await request.formData().catch(() => null)
  if (!datos) return volverA('/movimientos/nuevo', { e: 'Formulario no válido.' })

  const monto = leerMonto(datos.get('monto'))
  if (monto === null) return volverA('/movimientos/nuevo', { e: 'El monto debe ser un número entero de pesos, por ejemplo 25000.' })

  const r = await escribirBot('/interno/movimientos/crear', {
    clave: texto(datos.get('clave'), 64),
    tipo: texto(datos.get('tipo'), 10),
    monto,
    categoria: texto(datos.get('categoria'), 40),
    fecha: texto(datos.get('fecha'), 10),
    descripcion: texto(datos.get('descripcion'), 200),
  })
  if (r.ok) return volverA('/movimientos', { aviso: r.duplicado ? 'duplicado' : 'creado' })
  if (r.sinSesion) return volverA('/login', { expirada: '1' })
  return volverA('/movimientos/nuevo', { e: r.error })
}
