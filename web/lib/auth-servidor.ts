import 'server-only'
import { configuracionBot } from './sesion'

// Las rutas POST solo aceptan peticiones hechas desde esta misma web (protección contra CSRF).
export function origenValido(request: Request) {
  const origen = request.headers.get('origin')
  const anfitrion = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
  if (!origen || !anfitrion) return false
  try {
    return new URL(origen).host === anfitrion
  } catch {
    return false
  }
}

// IP del visitante, para los límites del bot. Detrás de Cloudflare viene en cf-connecting-ip.
export function ipCliente(request: Request) {
  return (
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    '?'
  ).slice(0, 64)
}

export function cookieSegura(request: Request) {
  return request.headers.get('x-forwarded-proto') === 'https' || new URL(request.url).protocol === 'https:'
}

// Llama a las rutas internas del bot con la clave del servidor. Devuelve estado 0 si no responde.
export async function postBot(ruta: string, cuerpo: unknown, ip: string) {
  const config = configuracionBot()
  if (!config) return { estado: 0, json: null as unknown }
  try {
    const respuesta = await fetch(`${config.base}${ruta}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json', 'X-Cliente-Ip': ip },
      body: JSON.stringify(cuerpo),
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    })
    return { estado: respuesta.status, json: (await respuesta.json().catch(() => null)) as unknown }
  } catch {
    return { estado: 0, json: null as unknown }
  }
}
