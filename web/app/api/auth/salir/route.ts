import { NextResponse } from 'next/server'
import { cookieSegura, ipCliente, origenValido, postBot } from '@/lib/auth-servidor'
import { COOKIE_SESION } from '@/lib/sesion'

// Cierra la sesión: se revoca en el bot y se borra la cookie.
export async function POST(request: Request) {
  if (!origenValido(request)) return new Response(null, { status: 403 })
  const token = request.headers.get('cookie')?.match(new RegExp(`(?:^|;\\s*)${COOKIE_SESION}=([^;]+)`))?.[1]
  if (token) await postBot('/interno/salir', { token: decodeURIComponent(token) }, ipCliente(request))

  const respuesta = new NextResponse(null, { status: 303, headers: { Location: '/login' } })
  respuesta.cookies.set({ name: COOKIE_SESION, value: '', httpOnly: true, sameSite: 'lax', secure: cookieSegura(request), path: '/', maxAge: 0 })
  return respuesta
}
