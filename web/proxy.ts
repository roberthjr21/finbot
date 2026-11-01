import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const COOKIE_SESION = 'finbot_sesion'

// Cada persona entra con su propia sesión. Aquí solo se comprueba que exista la cookie
// (para mandar a /login a quien no entró); la sesión se valida de verdad en el bot en
// cada consulta de datos, así que una cookie inventada no muestra nada.
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const publica = pathname === '/login' || pathname.startsWith('/api/auth/')
  const conSesion = Boolean(request.cookies.get(COOKIE_SESION)?.value)

  let respuesta: NextResponse
  if (publica || conSesion) {
    respuesta = NextResponse.next()
  } else if (pathname.startsWith('/api/')) {
    respuesta = NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  } else {
    const destino = request.nextUrl.clone()
    destino.pathname = '/login'
    destino.search = ''
    respuesta = NextResponse.redirect(destino)
  }

  respuesta.headers.set('Cache-Control', 'no-store')
  respuesta.headers.set('X-Frame-Options', 'DENY')
  respuesta.headers.set('X-Content-Type-Options', 'nosniff')
  respuesta.headers.set('Referrer-Policy', 'same-origin')
  return respuesta
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:png|jpg|jpeg|svg|ico|webp)$).*)'],
}
