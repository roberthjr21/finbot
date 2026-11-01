import { ipCliente, origenValido, postBot } from '@/lib/auth-servidor'

// Pide al bot que envíe un código por WhatsApp. La respuesta es la misma tenga o no cuenta el número.
export async function POST(request: Request) {
  if (!origenValido(request)) return Response.json({ ok: false }, { status: 403 })
  let cuerpo: unknown
  try {
    cuerpo = await request.json()
  } catch {
    return Response.json({ ok: false, motivo: 'formato' }, { status: 400 })
  }
  const telefono = typeof (cuerpo as { telefono?: unknown })?.telefono === 'string' ? (cuerpo as { telefono: string }).telefono.slice(0, 30) : ''
  const r = await postBot('/interno/codigo', { telefono }, ipCliente(request))
  if (r.estado === 200) return Response.json({ ok: true })
  if (r.estado === 429) return Response.json({ ok: false, motivo: 'espera' }, { status: 429 })
  if (r.estado === 400) return Response.json({ ok: false, motivo: 'formato' }, { status: 400 })
  return Response.json({ ok: false, motivo: 'no_disponible' }, { status: 503 })
}
