// Errores de Gemini (429, 503, tiempo, clave) y redacción de registros, con un servidor simulado
import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.GEMINI_API_KEY = 'AIzaSyFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE12';
process.env.ESPERA_REINTENTO_MS = '0';
process.env.TIEMPO_IA_MS = '200';
delete process.env.ANTHROPIC_API_KEY;

let guion = [];
let peticiones = 0;
const servidor = http.createServer((req, res) => {
  req.resume();
  req.on('end', async () => {
    peticiones++;
    const paso = guion.shift() ?? { estado: 200, cuerpo: { candidates: [{ content: { parts: [{ text: 'hola' }] } }] } };
    if (paso.demora) await new Promise((r) => setTimeout(r, paso.demora));
    res.writeHead(paso.estado ?? 200, { 'content-type': 'application/json', ...(paso.cabeceras ?? {}) });
    res.end(JSON.stringify(paso.cuerpo ?? {}));
  });
});
await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
process.env.GEMINI_URL = `http://127.0.0.1:${servidor.address().port}/`;

const ia = await import('./ia.js');
const { redactar } = await import('./registro.js');

beforeEach(() => { guion = []; peticiones = 0; ia.reiniciarEnfriamientos(); });
after(() => { servidor.close(); servidor.closeAllConnections?.(); });

test('429 sin espera indicada: una sola petición, enfriamiento y las siguientes no llaman a la API', async () => {
  guion = [{ estado: 429, cuerpo: { error: { message: 'quota exceeded' } } }];
  await assert.rejects(ia.interpretar('hola', '2026-11-10'), (e) => e.codigo === 'cuota' && e.estado === 429);
  assert.equal(peticiones, 1, 'no se reintenta un límite de cuota');
  await assert.rejects(ia.interpretar('hola', '2026-11-10'), (e) => e.codigo === 'cuota' && e.reintentarEnMs > 0);
  await assert.rejects(ia.interpretar('otra', '2026-11-10'), /429/);
  assert.equal(peticiones, 1, 'durante el enfriamiento no se toca la red');
  assert.ok(ia.estadoEnfriamiento() > 50_000);
  ia.reiniciarEnfriamientos();
  assert.ok((await ia.interpretar('hola', '2026-11-10')).texto);
  assert.equal(peticiones, 2);
});

test('429 con Retry-After corto se espera y se reintenta una vez; con Retry-After largo no', async () => {
  guion = [{ estado: 429, cabeceras: { 'retry-after': '0' } }];
  assert.ok((await ia.interpretar('hola', '2026-11-10')).texto);
  assert.equal(peticiones, 2);

  ia.reiniciarEnfriamientos();
  peticiones = 0;
  guion = [{ estado: 429, cabeceras: { 'retry-after': '120' } }];
  await assert.rejects(ia.interpretar('hola', '2026-11-10'), (e) => e.codigo === 'cuota');
  assert.equal(peticiones, 1);
  assert.ok(ia.estadoEnfriamiento() > 100_000 && ia.estadoEnfriamiento() <= 120_000);
});

test('429 con retryDelay en el cuerpo respeta ese tiempo (con tope de 15 minutos)', async () => {
  guion = [{ estado: 429, cuerpo: { error: { details: [{ retryDelay: '3600s' }] } } }];
  await assert.rejects(ia.interpretar('hola', '2026-11-10'), (e) => e.codigo === 'cuota');
  assert.ok(ia.estadoEnfriamiento() <= 15 * 60_000 && ia.estadoEnfriamiento() > 14 * 60_000);
});

test('503: un reintento y luego error "saturado", sin enfriamiento', async () => {
  guion = [{ estado: 503, cuerpo: { error: 'saturado' } }, { estado: 503, cuerpo: { error: 'saturado' } }];
  await assert.rejects(ia.interpretar('hola', '2026-11-10'), (e) => e.codigo === 'saturado' && /API 503/.test(e.message));
  assert.equal(peticiones, 2);
  assert.equal(ia.estadoEnfriamiento(), 0);
  assert.ok((await ia.interpretar('hola', '2026-11-10')).texto, 'la siguiente petición sí intenta de nuevo');
});

test('tiempo agotado: se reintenta y el error lleva el código "tiempo"', async () => {
  guion = [{ demora: 400 }, { demora: 400 }];
  await assert.rejects(ia.interpretar('hola', '2026-11-10'), (e) => e.codigo === 'tiempo' && /a tiempo/.test(e.message));
  assert.equal(peticiones, 2);
});

test('clave inválida (401): sin reintentos y el mensaje no contiene la clave aunque el servidor la devuelva', async () => {
  guion = [{ estado: 401, cuerpo: { error: `API key not valid: ${process.env.GEMINI_API_KEY}` } }];
  await assert.rejects(ia.interpretar('hola', '2026-11-10'), (e) => {
    assert.equal(e.codigo, 'clave');
    assert.ok(!e.message.includes('AIzaSyFAKE'), e.message);
    return true;
  });
  assert.equal(peticiones, 1);
});

test('mensajes para la persona según el tipo de fallo', () => {
  assert.match(ia.mensajeErrorIA({ codigo: 'cuota', reintentarEnMs: 150_000 }), /límite de uso.*3 min/);
  assert.match(ia.mensajeErrorIA({ codigo: 'saturado' }), /saturado/);
  assert.match(ia.mensajeErrorIA({ codigo: 'tiempo' }), /a tiempo/);
  assert.match(ia.mensajeErrorIA({ codigo: 'clave' }), /administrador/);
  assert.match(ia.mensajeErrorIA(new Error('x')), /no respondió/);
  for (const c of ['cuota', 'saturado', 'tiempo', 'clave']) assert.ok(!/AIza|API 4|API 5/.test(ia.mensajeErrorIA({ codigo: c })));
});

test('redactar oculta claves, tokens, material criptográfico y números de tarjeta o cuenta', () => {
  assert.equal(redactar('fallo con AIzaSyA1234567890abcdefghijklmnopqrstuv'), 'fallo con [clave oculta]');
  assert.match(redactar('Authorization: Bearer abc123def456ghi789'), /Bearer \[oculto\]/);
  assert.match(redactar('url?api_key=secreto123&x=1'), /api_key=\[oculto\]/);
  assert.match(redactar('token: "abcd1234efgh"'), /token: "\[oculto\]/);
  assert.match(redactar('-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg\n-----END PRIVATE KEY-----'), /material criptográfico oculto/);
  assert.match(redactar('clave ' + 'A'.repeat(44) + '='), /dato largo oculto/);
  assert.match(redactar('tarjeta 4111 1111 1111 1111 vence'), /\[número oculto\]/);
  assert.match(redactar('cuenta 12345678901234'), /\[número oculto\]/);
  assert.equal(redactar('Gasté $45.300 en comida el 2026-11-10 (573001234567)'), 'Gasté $45.300 en comida el 2026-11-10 (573001234567)');
  assert.match(redactar(new Error('falló sk-ant-api03-abcdefghijklmn')), /\[clave oculta\]/);
});
