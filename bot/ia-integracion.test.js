import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { pedirAGemini, ErrorIA, mensajeErrorIA, reiniciarEnfriamientos } from './ia.js';

const fetchOriginal = globalThis.fetch;
const urlOriginal = process.env.GEMINI_URL;
const keyOriginal = process.env.GEMINI_API_KEY;
process.env.GEMINI_URL = 'https://example.invalid/finbot-test';
process.env.GEMINI_API_KEY = 'clave-ficticia-para-pruebas';
after(() => {
  globalThis.fetch = fetchOriginal;
  if (urlOriginal === undefined) delete process.env.GEMINI_URL; else process.env.GEMINI_URL = urlOriginal;
  if (keyOriginal === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = keyOriginal;
  reiniciarEnfriamientos();
});
test('429 con Retry-After HTTP-date activa enfriamiento sin llamadas redundantes', async () => {
  reiniciarEnfriamientos();
  let llamadas = 0;
  globalThis.fetch = async () => {
    llamadas++;
    return new Response('{"error":"cuota"}', { status: 429, headers: { 'retry-after': new Date(Date.now() + 120000).toUTCString() } });
  };
  await assert.rejects(pedirAGemini({}), e => e instanceof ErrorIA && e.codigo === 'cuota' && e.reintentarEnMs > 90000);
  await assert.rejects(pedirAGemini({}), e => e.codigo === 'cuota');
  assert.equal(llamadas, 1);
  reiniciarEnfriamientos();
});
test('errores 401 nunca exponen el cuerpo ni las credenciales', async () => {
  globalThis.fetch = async () => new Response('token secreto', { status: 401 });
  await assert.rejects(pedirAGemini({}), e => e.codigo === 'clave' && !e.message.includes('token secreto'));
  assert.match(mensajeErrorIA({ codigo: 'clave' }), /administrador/);
  assert.ok(!mensajeErrorIA({ codigo: 'clave' }).includes('401'));
});
