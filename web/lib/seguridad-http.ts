import { isIP } from 'node:net'
import { timingSafeEqual } from 'node:crypto'

type Entorno = Record<string, string | undefined>

function autenticarProxy(headers: Headers, env: Entorno) {
  const secreto = env.PROXY_SECRETO
  const recibido = headers.get('x-finbot-proxy') ?? ''
  if (!secreto || secreto.length < 32 || recibido.length > 256) return false
  const a = Buffer.from(secreto)
  const b = Buffer.from(recibido)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function ipConfiable(request: Request, env: Entorno = process.env) {
  // Request no expone el socket remoto. Sin infraestructura autenticada se comparte
  // una clave conservadora; jamás se acepta XFF arbitrario para decisiones de seguridad.
  let valor: string | null = null
  if (env.VERCEL === '1') valor = request.headers.get('x-forwarded-for')
  else if (env.PROXY_IP === 'cloudflare' && autenticarProxy(request.headers, env)) {
    valor = request.headers.get('cf-connecting-ip')
  }
  if (!valor || !isIP(valor.trim())) return '?'
  const ip = valor.trim()
  if (isIP(ip) === 4) return ip
  // Forma canónica para que escrituras equivalentes de IPv6 compartan límite.
  return new URL(`http://[${ip}]/`).hostname.slice(1, -1)
}

export function comprobarOrigen(request: Request, env: Entorno = process.env) {
  const recibido = request.headers.get('origin')
  if (!recibido || request.headers.get('sec-fetch-site') === 'cross-site') return false
  try {
    const esperado = env.WEB_ORIGEN || (env.VERCEL === '1' && env.VERCEL_URL ? `https://${env.VERCEL_URL}` : '')
    const url = new URL(esperado || request.url)
    if (!esperado && env.NODE_ENV === 'production') return false
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || (esperado && url.pathname !== '/')) return false
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    if (env.NODE_ENV === 'production' && !local && url.protocol !== 'https:') return false
    return recibido === url.origin
  } catch { return false }
}

export function requiereCookieSegura(request: Request, env: Entorno = process.env) {
  return env.NODE_ENV === 'production' || new URL(request.url).protocol === 'https:'
}

// Tamaño real del stream, también sin Content-Length y con transferencia fragmentada.
export async function leerCuerpo(request: Request, limite = 8192) {
  if (Number(request.headers.get('content-length')) > limite) throw new Error('Cuerpo demasiado grande')
  const lector = request.body?.getReader()
  if (!lector) return ''
  const partes: Uint8Array[] = []
  let total = 0
  let temporizador: ReturnType<typeof setTimeout> | undefined
  const vencido = new Promise<never>((_, reject) => {
    temporizador = setTimeout(() => { void lector.cancel(); reject(new Error('Tiempo agotado')) }, 5000)
  })
  try {
    while (true) {
      const { done, value } = await Promise.race([lector.read(), vencido])
      if (done) break
      total += value.byteLength
      if (total > limite) throw new Error('Cuerpo demasiado grande')
      partes.push(value)
    }
    return Buffer.concat(partes).toString('utf8')
  } catch (error) {
    void lector.cancel().catch(() => {})
    throw error
  } finally { clearTimeout(temporizador); lector.releaseLock() }
}

export async function leerJsonSeguro(request: Request) {
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') throw new Error('Tipo no permitido')
  const valor: unknown = JSON.parse(await leerCuerpo(request))
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) throw new Error('Objeto requerido')
  return valor as Record<string, unknown>
}

export async function leerFormularioSeguro(request: Request) {
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/x-www-form-urlencoded') throw new Error('Tipo no permitido')
  const datos = new FormData()
  for (const [clave, valor] of new URLSearchParams(await leerCuerpo(request))) datos.append(clave, valor)
  return datos
}

export function tokenCookie(request: Request, nombre: string) {
  const valor = request.headers.get('cookie')?.split(';').map((c) => c.trim()).find((c) => c.startsWith(`${nombre}=`))?.slice(nombre.length + 1)
  if (!valor) return null
  try { return decodeURIComponent(valor) } catch { return null }
}
