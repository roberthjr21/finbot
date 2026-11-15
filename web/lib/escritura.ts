import 'server-only'
import { configuracionBot, tokenDeSesion } from './sesion'

export type ResultadoEscritura =
  | { ok: true; duplicado: boolean }
  | { ok: false; sinSesion?: boolean; error: string }

// Envía una escritura al bot con la clave del servidor y la sesión de quien la hace.
// El bot decide la cuenta por la sesión: aquí nunca se envía un teléfono ni un usuario.
export async function escribirBot(ruta: string, cuerpo: unknown): Promise<ResultadoEscritura> {
  const sesion = await tokenDeSesion()
  if (!sesion) return { ok: false, sinSesion: true, error: 'Tu sesión terminó. Entra de nuevo.' }
  const config = configuracionBot()
  if (!config) return { ok: false, error: 'La web no está conectada con el bot.' }
  try {
    const respuesta = await fetch(`${config.base}${ruta}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json', 'X-Sesion': sesion },
      body: JSON.stringify(cuerpo),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
    })
    const json = (await respuesta.json().catch(() => null)) as { ok?: unknown; error?: unknown; duplicado?: unknown } | null
    if (respuesta.status === 401) return { ok: false, sinSesion: true, error: 'Tu sesión terminó. Entra de nuevo.' }
    if (respuesta.ok && json?.ok === true) return { ok: true, duplicado: json.duplicado === true }
    const error = typeof json?.error === 'string' ? json.error.slice(0, 160) : 'No se pudo completar la operación.'
    return { ok: false, error }
  } catch {
    return { ok: false, error: 'El bot no respondió. Inténtalo de nuevo en un momento.' }
  }
}

// "25000", "25.000", "$ 25.000" → 25000. Cualquier otra cosa (decimales, letras, vacío) → null.
export function leerMonto(texto: FormDataEntryValue | null): number | null {
  if (typeof texto !== 'string') return null
  const limpio = texto.replace(/[\s$]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '')
  if (!/^\d{1,12}$/.test(limpio)) return null
  const numero = Number(limpio)
  return Number.isSafeInteger(numero) && numero > 0 ? numero : null
}

export function texto(valor: FormDataEntryValue | null, maximo = 200): string {
  return typeof valor === 'string' ? valor.slice(0, maximo) : ''
}

// Redirección 303 (POST → GET) a una página propia, con aviso o error en la URL.
export function volverA(ruta: string, parametros: Record<string, string>) {
  const consulta = new URLSearchParams(parametros).toString()
  return new Response(null, { status: 303, headers: { Location: consulta ? `${ruta}?${consulta}` : ruta } })
}
