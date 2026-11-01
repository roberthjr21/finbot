import { NextResponse } from 'next/server'
import { cookieSegura, ipCliente, origenValido, postBot } from '@/lib/auth-servidor'
import { COOKIE_SESION } from '@/lib/sesion'

// Comprueba el código con el bot y, si es correcto, guarda la sesión en una cookie HttpOnly.
export async function POST(request: Request) {
  if (!origenValido(request)) return NextResponse.json({ ok: false }, { status: 403 })
  let cuerpo: { telefono?: unknown; codigo?: unknown }
  try {
    cuerpo = await request.json()
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 })
  }
  const telefono = typeof cuerpo.telefono === 'string' ? cuerpo.telefono.slice(0, 30) : ''
  const codigo = typeof cuerpo.codigo === 'string' ? cuerpo.codigo.slice(0, 12) : ''
  const ip = ipCliente(request)

  const r = await postBot('/interno/verificar', { telefono, codigo }, ip)
  const datos = r.json as { ok?: boolean; token?: string; expira?: number } | null
  if (r.estado !== 200 || !datos?.ok || typeof datos.token !== 'string' || typeof datos.expira !== 'number') {
    return NextResponse.json({ ok: false }, { status: r.estado === 0 ? 503 : 401 })
  }

  // Una sesión nueva reemplaza a la anterior: la vieja se revoca en el bot
  const anterior = request.headers.get('cookie')?.match(new RegExp(`(?:^|;\\s*)${COOKIE_SESION}=([^;]+)`))?.[1]
  if (anterior) await postBot('/interno/salir', { token: decodeURIComponent(anterior) }, ip)

  const respuesta = NextResponse.json({ ok: true })
  respuesta.cookies.set({
    name: COOKIE_SESION,
    value: datos.token,
    httpOnly: true,
    sameSite: 'lax',
    secure: cookieSegura(request),
    path: '/',
    maxAge: Math.max(60, datos.expira - Math.floor(Date.now() / 1000)),
  })
  return respuesta
}
