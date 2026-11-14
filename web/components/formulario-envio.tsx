'use client'
import { useEffect, useRef, useState, type ReactNode, type FormEvent } from 'react'

export function FormularioEnvio({ children, action, className }: { children: ReactNode; action: string; className: string }) {
  const ocupado = useRef(false)
  const botones = useRef(new Map<HTMLButtonElement, boolean>())
  const [enviando, setEnviando] = useState(false)
  useEffect(() => {
    const restaurar = () => {
      ocupado.current = false
      for (const [boton, deshabilitado] of botones.current) boton.disabled = deshabilitado
      botones.current.clear()
      setEnviando(false)
    }
    window.addEventListener('pageshow', restaurar)
    return () => window.removeEventListener('pageshow', restaurar)
  }, [])
  function enviar(evento: FormEvent<HTMLFormElement>) {
    if (ocupado.current) { evento.preventDefault(); return }
    ocupado.current = true
    for (const boton of evento.currentTarget.querySelectorAll<HTMLButtonElement>('button[type=submit]')) {
      botones.current.set(boton, boton.disabled)
      boton.disabled = true
    }
    setEnviando(true)
  }
  return <form className={className} method="post" action={action} onSubmit={enviar} aria-busy={enviando}>
    {children}
    {enviando && <p role="status">Enviando…</p>}
  </form>
}
