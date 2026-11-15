import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { pedirAGemini, ErrorIA, mensajeErrorIA, reiniciarEnfriamientos, seleccionarProveedorIA, modeloPreferidoIA } from './ia.js';

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

test('reintento no ignora cuota activada por otra solicitud concurrente', async () => {
  const esperaAnterior = process.env.ESPERA_REINTENTO_MS;
  process.env.ESPERA_REINTENTO_MS = '80';
  reiniciarEnfriamientos();
  let llamadas = 0;
  globalThis.fetch = async () => {
    llamadas++;
    return llamadas === 1
      ? new Response('transitorio', { status: 503 })
      : new Response('cuota', { status: 429, headers: { 'retry-after': '120' } });
  };
  try {
    const primer = pedirAGemini({});
    await new Promise(resolve => setTimeout(resolve, 10));
    await assert.rejects(pedirAGemini({}), e => e.codigo === 'cuota');
    await assert.rejects(primer, e => e.codigo === 'cuota');
    assert.equal(llamadas, 2, 'no debe reintentarse después de que otro recibió cuota');
  } finally {
    reiniciarEnfriamientos();
    if (esperaAnterior === undefined) delete process.env.ESPERA_REINTENTO_MS;
    else process.env.ESPERA_REINTENTO_MS = esperaAnterior;
  }
});

test('selección explícita, automática y modelos heredados no mezclan proveedores', () => {
  const ambos = { GEMINI_API_KEY: 'gemini-demo', ANTHROPIC_API_KEY: 'claude-demo', MODELO_IA: 'claude-haiku-5-5' };
  assert.equal(seleccionarProveedorIA(ambos), 'claude');
  assert.equal(seleccionarProveedorIA({ ...ambos, PROVEEDOR_IA: 'gemini' }), 'gemini');
  assert.equal(seleccionarProveedorIA({ ...ambos, PROVEEDOR_IA: 'claude' }), 'claude');
  assert.equal(seleccionarProveedorIA({ ...ambos, PROVEEDOR_IA: 'claude', ANTHROPIC_API_KEY: '' }), null);
  assert.equal(seleccionarProveedorIA({ GEMINI_API_KEY: 'demo' }), 'gemini');
  assert.throws(() => seleccionarProveedorIA({ PROVEEDOR_IA: 'otro' }), /PROVEEDOR_IA/);
  assert.equal(modeloPreferidoIA('gemini', ambos), 'gemini-3.5-flash');
  assert.equal(modeloPreferidoIA('claude', ambos), 'claude-haiku-5-5');
  assert.equal(modeloPreferidoIA('claude', { ...ambos, MODELO_ANTHROPIC: 'claude-sonnet-test' }), 'claude-sonnet-test');
  assert.equal(modeloPreferidoIA('gemini', { ...ambos, MODELO_GEMINI: 'gemini-test' }), 'gemini-test');
});
