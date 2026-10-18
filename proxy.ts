import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { credencialesDashboardValidas, dashboardConfigurado } from './lib/dashboard-auth'

export function proxy(request: NextRequest) {
  if (!dashboardConfigurado()) {
    return new Response('El panel no está configurado para acceso seguro.', { status: 503 })
  }

  if (credencialesDashboardValidas(request.headers.get('authorization'))) {
    return NextResponse.next()
  }

  return new Response('Autenticación requerida.', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="FinBot", charset="UTF-8"' },
  })
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:png|jpg|jpeg|svg|ico|webp)$).*)'],
}
