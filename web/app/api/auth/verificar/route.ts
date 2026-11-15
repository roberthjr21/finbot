import { tokenCookie, leerJsonSeguro } from '@/lib/seguridad-http'
import { NextResponse } from 'next/server'
import { cookieSegura, ipCliente, origenValido, postBot } from '@/lib/auth-servidor'
import { COOKIE_SESION } from '@/lib/sesion'

// Comprueba el código con el bot y, si es correcto, guarda la sesión en una cookie HttpOnly.
export async function POST(request: Request) {
  if (!origenValido(request)) return NextResponse.json({ ok: false }, { status: 403 })
  let cuerpo: { telefono?: unknown; codigo?: unknown }
  try {
    cuerpo = await leerJsonSeguro(request)
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 })
  }
  const telefono = typeof cuerpo.telefono === 'string' ? cuerpo.telefono.slice(0, 30) : ''
  const codigo = typeof cuerpo.codigo === 'string' ? cuerpo.codigo.slice(0, 12) : ''
  const ip = ipCliente(request)

  const anterior = tokenCookie(request, COOKIE_SESION)
  const r = await postBot('/interno/verificar', { telefono, codigo, tokenAnterior: anterior }, ip)
  const datos = r.json as { ok?: boolean; token?: string; expira?: number } | null
  if (r.estado !== 200 || !datos?.ok || typeof datos.token !== 'string' || !Number.isSafeInteger(datos.expira) || typeof datos.expira !== 'number' || datos.expira <= Math.floor(Date.now() / 1000) || !/^[A-Za-z0-9_-]{43}$/.test(datos.token)) {
    return NextResponse.json({ ok: false }, { status: r.estado === 0 ? 503 : 401 })
  }

  // El bot crea la sesión nueva y revoca la anterior dentro de la misma transacción.
  const respuesta = NextResponse.json({ ok: true })
  respuesta.cookies.set({
    name: COOKIE_SESION,
    value: datos.token,
    httpOnly: true,
    sameSite: 'lax',
    secure: cookieSegura(request),
    path: '/',
    maxAge: Math.min(604800, datos.expira - Math.floor(Date.now() / 1000)),
  })
  return respuesta
}
