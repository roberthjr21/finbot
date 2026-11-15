'use client'
import { Analytics } from '@vercel/analytics/next'
import { urlAnalitica } from '@/lib/analitica'

export function Analitica() {
  return <Analytics beforeSend={evento => ({ ...evento, url: urlAnalitica(evento.url) })} />
}
