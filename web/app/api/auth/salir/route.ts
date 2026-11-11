import { NextResponse } from 'next/server'
import { cookieSegura, ipCliente, origenValido, postBot } from '@/lib/auth-servidor'
import { COOKIE_SESION } from '@/lib/sesion'
import { tokenCookie } from '@/lib/seguridad-http'

export async function POST(request: Request) {
  if (!origenValido(request)) return new Response(null, { status: 403 })
  const token = tokenCookie(request, COOKIE_SESION)
  if (token) {
    // Revocar es idempotente: un reintento cubre una respuesta perdida tras COMMIT.
    let r = await postBot('/interno/salir', { token }, ipCliente(request))
    if (r.estado === 0 || r.estado >= 500) r = await postBot('/interno/salir', { token }, ipCliente(request))
    if (r.estado !== 200 || (r.json as { ok?: unknown } | null)?.ok !== true) {
      console.error('Revocación de sesión no confirmada', { estado: r.estado })
      // Conserva la cookie para poder reintentar; no anuncia un cierre que no ocurrió.
      return new Response('No pudimos cerrar tu sesión. Vuelve atrás e inténtalo de nuevo.', {
        status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '5', 'Content-Type': 'text/plain; charset=utf-8' },
      })
    }
  }
  const respuesta = new NextResponse(null, { status: 303, headers: { Location: '/login' } })
  respuesta.cookies.set({ name: COOKIE_SESION, value: '', httpOnly: true, sameSite: 'lax', secure: cookieSegura(request), path: '/', maxAge: 0 })
  return respuesta
}
