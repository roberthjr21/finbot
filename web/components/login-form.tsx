'use client'

import { useState, type FormEvent } from 'react'

type Paso = 'telefono' | 'codigo'

// Dos pasos: 1) número de WhatsApp  2) código de 6 dígitos que llega a ese mismo WhatsApp.
// El navegador nunca recibe el token de sesión: el servidor lo guarda en una cookie HttpOnly.
export function LoginForm({ expirada }: Readonly<{ expirada?: boolean }>) {
  const [paso, setPaso] = useState<Paso>('telefono')
  const [telefono, setTelefono] = useState('')
  const [codigo, setCodigo] = useState('')
  const [mensaje, setMensaje] = useState<string | null>(expirada ? 'Tu sesión venció. Entra de nuevo.' : null)
  const [cargando, setCargando] = useState(false)

  async function enviar(ruta: string, cuerpo: Record<string, string>) {
    setCargando(true)
    try {
      return await fetch(ruta, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpo),
      })
    } catch {
      return null
    } finally {
      setCargando(false)
    }
  }

  async function pedirCodigo(evento: FormEvent) {
    evento.preventDefault()
    setMensaje(null)
    const r = await enviar('/api/auth/solicitar', { telefono })
    if (!r) return setMensaje('No se pudo conectar. Inténtalo de nuevo.')
    if (r.status === 429) return setMensaje('Espera un momento antes de pedir otro código.')
    if (r.status === 400) return setMensaje('Escribe tu número con el indicativo del país, por ejemplo 573001234567.')
    if (!r.ok) return setMensaje('El servicio no está disponible ahora. Inténtalo en unos minutos.')
    setPaso('codigo')
    // Respuesta idéntica exista o no la cuenta
    setMensaje('Si ese número tiene cuenta, te enviamos un código por WhatsApp. Si aún no la tienes, escríbele primero al bot para crearla.')
  }

  async function entrar(evento: FormEvent) {
    evento.preventDefault()
    setMensaje(null)
    const r = await enviar('/api/auth/verificar', { telefono, codigo })
    if (r?.ok) {
      window.location.assign('/')
      return
    }
    if (!r || r.status === 503) return setMensaje('El servicio no está disponible ahora. Inténtalo en unos minutos.')
    setMensaje('El código es incorrecto o venció. Pide uno nuevo si hace falta.')
  }

  return (
    <main className="login-wrap">
      <section className="panel login-card">
        <p className="eyebrow">FINBOT</p>
        <h1>Entra a tus finanzas</h1>
        <p className="subheading">Te enviamos un código por WhatsApp. Cada persona ve solo sus propios datos.</p>

        {paso === 'telefono' ? (
          <form onSubmit={pedirCodigo} className="login-form">
            <label htmlFor="telefono">Tu número de WhatsApp</label>
            <input
              id="telefono"
              name="telefono"
              type="tel"
              inputMode="numeric"
              autoComplete="tel"
              placeholder="573001234567"
              value={telefono}
              onChange={(e) => setTelefono(e.target.value)}
              required
            />
            <button className="primary-button" type="submit" disabled={cargando}>
              {cargando ? 'Enviando…' : 'Enviarme el código'}
            </button>
          </form>
        ) : (
          <form onSubmit={entrar} className="login-form">
            <label htmlFor="codigo">Código de 6 dígitos</label>
            <input
              id="codigo"
              name="codigo"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              placeholder="123456"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))}
              required
            />
            <button className="primary-button" type="submit" disabled={cargando || codigo.length !== 6}>
              {cargando ? 'Comprobando…' : 'Entrar'}
            </button>
            <button className="link-button" type="button" onClick={() => { setPaso('telefono'); setCodigo(''); setMensaje(null) }}>
              Usar otro número o pedir otro código
            </button>
          </form>
        )}

        {mensaje && <p className="login-mensaje" role="status">{mensaje}</p>}
      </section>
    </main>
  )
}
