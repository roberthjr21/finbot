import test from 'node:test'
import assert from 'node:assert/strict'
import { ipConfiable, comprobarOrigen, requiereCookieSegura, leerJsonSeguro, leerFormularioSeguro, tokenCookie } from './lib/seguridad-http.ts'
const req = (headers = {}, url = 'https://finbot.example/api/auth/solicitar') => new Request(url, { headers })

test('sin proxy autenticado se ignoran todas las IP aportadas por el cliente', () => {
  for (const h of ['x-forwarded-for', 'x-real-ip', 'x-vercel-forwarded-for', 'cf-connecting-ip', 'x-cliente-ip']) {
    assert.equal(ipConfiable(req({ [h]: '1.2.3.4' }), {}), '?')
  }
})
test('Vercel usa exclusivamente el encabezado sobrescrito por su infraestructura', () => {
  assert.equal(ipConfiable(req({ 'x-forwarded-for': '1.2.3.4', 'cf-connecting-ip': '6.6.6.6' }), { VERCEL: '1' }), '1.2.3.4')
  for (const ip of ['1.2.3.4, 8.8.8.8', 'invalid', '127.1', '']) assert.equal(ipConfiable(req({ 'x-forwarded-for': ip }), { VERCEL: '1' }), '?')
  assert.equal(ipConfiable(req({ 'x-forwarded-for': '2001:0db8:0:0:0:0:0:1' }), { VERCEL: '1' }), '2001:db8::1')
})
test('Cloudflare requiere prueba autenticada del gateway, no basta activar una opción', () => {
  const env = { PROXY_IP: 'cloudflare', PROXY_SECRETO: 's'.repeat(32) }
  assert.equal(ipConfiable(req({ 'cf-connecting-ip': '1.2.3.4' }), env), '?')
  assert.equal(ipConfiable(req({ 'cf-connecting-ip': '1.2.3.4', 'x-finbot-proxy': 's'.repeat(32) }), env), '1.2.3.4')
  assert.equal(ipConfiable(req({ 'cf-connecting-ip': '1.2.3.4', 'x-finbot-proxy': 'x'.repeat(32) }), env), '?')
})
test('CSRF compara el origen configurado completo, ignora forwarded-host y rechaza downgrade', () => {
  const env = { NODE_ENV: 'production', WEB_ORIGEN: 'https://finbot.example' }
  assert.equal(comprobarOrigen(req({ origin: env.WEB_ORIGEN }), env), true)
  for (const origin of ['http://finbot.example', 'https://evil.example', 'null', 'https://finbot.example:8443']) {
    assert.equal(comprobarOrigen(req({ origin, 'x-forwarded-host': new URL(origin === 'null' ? 'http://evil' : origin).host }), env), false)
  }
  assert.equal(comprobarOrigen(req({ origin: env.WEB_ORIGEN }), { NODE_ENV: 'production' }), false)
  assert.equal(comprobarOrigen(req({ origin: 'http://localhost:3000' }, 'http://localhost:3000'), {}), true)
  assert.equal(comprobarOrigen(req({ origin: env.WEB_ORIGEN, 'sec-fetch-site': 'cross-site' }), env), false)
})
test('cookies seguras en producción aunque se falsifique forwarded-proto', () => {
  assert.equal(requiereCookieSegura(req({ 'x-forwarded-proto': 'http' }, 'http://localhost'), { NODE_ENV: 'production' }), true)
  assert.equal(requiereCookieSegura(req({ 'x-forwarded-proto': 'https' }, 'http://localhost'), {}), false)
  assert.equal(tokenCookie(req({ cookie: 'finbot_sesion=%ZZ' }), 'finbot_sesion'), null)
})
test('lectores rechazan null, arrays, tipo incorrecto y cuerpo grande sin Content-Length', async () => {
  for (const body of ['null', '[]', '"texto"', '{', JSON.stringify({ x: 'a'.repeat(9000) })]) {
    await assert.rejects(leerJsonSeguro(new Request('http://localhost', { method: 'POST', headers: { 'content-type': 'application/json' }, body })))
  }
  assert.deepEqual(await leerJsonSeguro(new Request('http://localhost', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"codigo":"123456"}' })), { codigo: '123456' })
  const form = await leerFormularioSeguro(new Request('http://localhost', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'monto=100&tipo=gasto' }))
  assert.equal(form.get('monto'), '100')
})
