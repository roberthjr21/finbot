import 'server-only'
import { cookies } from 'next/headers'

export const COOKIE_SESION = 'finbot_sesion'

// El token de sesión vive en una cookie HttpOnly: el código del navegador nunca lo lee.
export async function tokenDeSesion() {
  return (await cookies()).get(COOKIE_SESION)?.value ?? null
}

// Dirección y clave del servidor del bot. Solo existen en el servidor de Next.js (sin prefijo NEXT_PUBLIC_).
export function configuracionBot() {
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
