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

test('un 429 de otra solicitud impide reintentar durante la pausa', async () => {
  const esperaPrevia = process.env.ESPERA_REINTENTO_MS;
  process.env.ESPERA_REINTENTO_MS = '80';
  reiniciarEnfriamientos();
  let llamadas = 0;
  globalThis.fetch = async () => {
    llamadas++;
    if (llamadas === 1) return new Response('servicio temporal', { status: 503 });
    return new Response('cuota', { status: 429, headers: { 'retry-after': '120' } });
  };
  try {
    const primerIntento = pedirAGemini({});
    await new Promise(resolve => setTimeout(resolve, 10));
    await assert.rejects(pedirAGemini({}), e => e.codigo === 'cuota');
    await assert.rejects(primerIntento, e => e.codigo === 'cuota');
    assert.equal(llamadas, 2, 'no debe emitir un tercer request después del enfriamiento');
  } finally {
    reiniciarEnfriamientos();
    if (esperaPrevia === undefined) delete process.env.ESPERA_REINTENTO_MS;
    else process.env.ESPERA_REINTENTO_MS = esperaPrevia;
  }
});
