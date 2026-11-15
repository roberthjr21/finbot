import 'server-only'
import { configuracionBot } from './sesion'

export { comprobarOrigen as origenValido, ipConfiable as ipCliente, requiereCookieSegura as cookieSegura } from './seguridad-http'

// Llama a las rutas internas del bot con la clave del servidor. Devuelve estado 0 si no responde.
export async function postBot(ruta: string, cuerpo: unknown, ip: string) {
  const config = configuracionBot()
  if (!config) return { estado: 0, json: null as unknown }
  try {
    const respuesta = await fetch(`${config.base}${ruta}`, {
      method: 'POST',
      redirect: 'error',
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
