import { createHash, timingSafeEqual } from 'node:crypto'

function iguales(a: string, b: string) {
  const hashA = createHash('sha256').update(a, 'utf8').digest()
  const hashB = createHash('sha256').update(b, 'utf8').digest()
  return timingSafeEqual(hashA, hashB)
}

export function credencialesDashboardValidas(cabecera: string | null) {
  const usuarioEsperado = process.env.DASHBOARD_USER
  const claveEsperada = process.env.DASHBOARD_PASSWORD
  if (!usuarioEsperado || !claveEsperada || !cabecera?.startsWith('Basic ')) return false

  let decodificado: string
  try {
    decodificado = Buffer.from(cabecera.slice(6), 'base64').toString('utf8')
  } catch {
    return false
  }

  const separador = decodificado.indexOf(':')
  if (separador < 0) return false
  const usuario = decodificado.slice(0, separador)
  const clave = decodificado.slice(separador + 1)
  return iguales(usuario, usuarioEsperado) && iguales(clave, claveEsperada)
}

export function dashboardConfigurado() {
  const usuario = process.env.DASHBOARD_USER
  const clave = process.env.DASHBOARD_PASSWORD
  return Boolean(usuario?.trim() && !usuario.includes(':') && clave?.trim())
}
