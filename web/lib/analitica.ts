// Solo rutas agregadas: no enviar queries, fragmentos ni IDs de movimientos.
export function urlAnalitica(valor: string) {
  const url = new URL(valor)
  url.search = ''
  url.hash = ''
  url.pathname = url.pathname.replace(/^\/movimientos\/\d+\/?$/, '/movimientos/detalle')
  return url.href
}
