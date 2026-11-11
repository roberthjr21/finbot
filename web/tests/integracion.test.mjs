import test from 'node:test'
import assert from 'node:assert/strict'
import { fork, spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer } from 'node:net'
import { once } from 'node:events'

const pausa = (ms) => new Promise(r => setTimeout(r, ms))
test('integración Next.js y API real: OTP, cuentas, CRUD, revocación y caída del bot', { timeout: 120000 }, async () => {
  const carpeta = mkdtempSync(path.join(tmpdir(), 'finbot-web-integracion-'))
  const token = 'token-interno-exclusivo-de-integracion-123456'
  const bot = fork(new URL('./bot-fixture.mjs', import.meta.url), { env: { ...process.env, NODE_ENV: 'production', DB_ARCHIVO: path.join(carpeta, 'test.db'), API_TOKEN: token, SECRETO_SESION: 'secreto-de-integracion-independiente-123456', API_PUERTO: '0' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
  let web
  let logs = ''
  const codigos = new Map()
  bot.on('message', m => { if (m.tipo === 'codigo') codigos.set(m.telefono, m.codigo) })
  const botListo = new Promise((resolve, reject) => {
    bot.on('message', m => { if (m.tipo === 'listo') resolve(m.puerto) })
    bot.once('error', reject); bot.once('exit', code => reject(new Error(`Bot de pruebas terminó ${code}`)))
  })
  try {
    const puertoBot = await botListo
    const reserva = createServer(); reserva.listen(0, '127.0.0.1'); await once(reserva, 'listening')
    const puerto = reserva.address().port; await new Promise(r => reserva.close(r))
    const base = `http://127.0.0.1:${puerto}`
    web = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(puerto)], { cwd: path.resolve(import.meta.dirname, '..'), env: { ...process.env, NODE_ENV: 'production', BOT_API_URL: `http://127.0.0.1:${puertoBot}`, BOT_API_TOKEN: token, WEB_ORIGEN: base }, stdio: ['ignore', 'pipe', 'pipe'] })
    web.stdout.on('data', d => { logs += d }); web.stderr.on('data', d => { logs += d })
    let listo = false
    for (let i=0;i<100;i++) {
      if (web.exitCode !== null) throw new Error(`Next terminó: ${logs}`)
      try { if ((await fetch(base+'/login')).ok) { listo = true; break } } catch {}
      await pausa(100)
    }
    assert.ok(listo, logs)
    const pedir = (ruta, { cuerpo, cookie, origen = base, json = true } = {}) => fetch(base+ruta, {
      method: cuerpo !== undefined ? 'POST' : 'GET', redirect: 'manual',
      headers: { ...(cookie ? { cookie } : {}), ...(cuerpo !== undefined ? { origin: origen, 'content-type': json ? 'application/json' : 'application/x-www-form-urlencoded' } : {}) },
      body: cuerpo !== undefined ? (json ? JSON.stringify(cuerpo) : new URLSearchParams(cuerpo)) : undefined,
    })
    const login = async (telefono) => {
      assert.equal((await pedir('/api/auth/solicitar', { cuerpo: { telefono } })).status, 200)
      for (let i=0;!codigos.has(telefono) && i<50;i++) await pausa(10)
      assert.ok(codigos.get(telefono))
      const r = await pedir('/api/auth/verificar', { cuerpo: { telefono, codigo: codigos.get(telefono) } })
      assert.equal(r.status, 200)
      const cookie = r.headers.get('set-cookie')
      assert.match(cookie, /HttpOnly/i); assert.match(cookie, /Secure/i); assert.match(cookie, /SameSite=lax/i)
      return cookie.split(';')[0]
    }
    assert.equal((await pedir('/')).status, 307)
    assert.equal((await pedir('/api/movimientos/crear', { cuerpo: {} })).status, 401)
    assert.equal((await pedir('/api/auth/solicitar', { cuerpo: {}, origen: 'https://evil.example' })).status, 403)
    assert.equal((await pedir('/api/auth/verificar', { cuerpo: null })).status, 400)
    const a = await login('573000001111'); const b = await login('573000002222')
    assert.equal((await pedir('/', { cookie: a })).status, 200)
    const datos = { clave: 'integracion-0001', tipo: 'gasto', monto: '5000', categoria: 'Otros', fecha: '2026-11-01', descripcion: 'privado-cuenta-A' }
    const crear = () => pedir('/api/movimientos/crear', { cuerpo: datos, cookie: a, json: false })
    assert.match((await crear()).headers.get('location'), /aviso=creado/)
    assert.match((await crear()).headers.get('location'), /aviso=duplicado/)
    const listar = async cookie => (await fetch(`http://127.0.0.1:${puertoBot}/api/movimientos`, { headers: { authorization: `Bearer ${token}`, 'x-sesion': cookie.split('=')[1] } })).json()
    const filas = await listar(a); assert.equal(filas.length, 1); assert.equal((await listar(b)).length, 0)
    const id = String(filas[0].id)
    const ajeno = await pedir('/api/movimientos/editar', { cookie: b, json: false, cuerpo: { ...datos, id, monto: '1' } })
    assert.match(ajeno.headers.get('location'), /e=/)
    assert.equal((await listar(a))[0].monto, 5000)
    const editar = await pedir('/api/movimientos/editar', { cookie: a, json: false, cuerpo: { ...datos, id, monto: '6000' } })
    assert.match(editar.headers.get('location'), /aviso=editado/); assert.equal((await listar(a))[0].monto, 6000)
    assert.match((await pedir('/api/movimientos/eliminar', { cookie: b, json: false, cuerpo: { id, confirmar: 'si' } })).headers.get('location'), /e=/)
    assert.match((await pedir('/api/movimientos/eliminar', { cookie: a, json: false, cuerpo: { id, confirmar: 'si' } })).headers.get('location'), /aviso=eliminado/)
    assert.equal((await listar(a)).length, 0)
    const salir = await pedir('/api/auth/salir', { cookie: a, cuerpo: {} })
    assert.equal(salir.status, 303); assert.match(salir.headers.get('set-cookie'), /Max-Age=0/)
    const revocada = await pedir('/', { cookie: a })
    // Next puede transmitir el shell con 200 y redirigir dentro del stream.
    if (revocada.status === 200) assert.match(await revocada.text(), /login\?expirada=1/)
    else assert.equal(revocada.status, 307)
    const accesoRevocado = await fetch(`http://127.0.0.1:${puertoBot}/api/saldo`, { headers: { authorization: `Bearer ${token}`, 'x-sesion': a.split('=')[1] } })
    assert.equal(accesoRevocado.status, 401)
    const desconectado = new Promise(r => bot.on('message', m => { if (m.tipo === 'desconectado') r() }))
    bot.send('desconectar'); await desconectado
    const falloSalir = await pedir('/api/auth/salir', { cookie: b, cuerpo: {} })
    assert.equal(falloSalir.status, 503); assert.equal(falloSalir.headers.get('set-cookie'), null)
    const pagina = await pedir('/', { cookie: b }); assert.equal(pagina.status, 200); assert.match(await pagina.text(), /No se pudieron cargar los datos/)
    assert.equal((await pedir('/api/auth/solicitar', { cuerpo: { telefono: '573000003333' } })).status, 503)
  } finally {
    if (web && web.exitCode === null) { web.kill('SIGTERM'); await once(web, 'exit') }
    if (bot.exitCode === null) { bot.kill('SIGTERM'); await once(bot, 'exit') }
    rmSync(carpeta, { recursive: true, force: true })
  }
})
