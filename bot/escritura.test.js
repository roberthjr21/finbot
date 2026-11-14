// Escritura desde la web: crear, editar y eliminar movimientos con la identidad de la sesión
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const temporal = fs.mkdtempSync(path.join(os.tmpdir(), 'finbot-escritura-'));
process.env.DB_ARCHIVO = path.join(temporal, 'escritura.db');
process.env.API_TOKEN = 'secreto-de-prueba';
process.env.API_PUERTO = '0';
process.env.MAX_ESCRITURAS_MINUTO = '500';
for (const v of ['GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'SECRETO_SESION']) delete process.env[v];

const db = await import('./db.js');
const finanzas = await import('./finanzas.js');
const acceso = await import('./acceso.js');
const { ejecutar } = await import('./acciones.js');
const { crearServidorApi } = await import('./api.js');
const { fechaBogota } = await import('./fechas.js');

const servidor = crearServidorApi();
await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${servidor.address().port}`;
after(() => {
  servidor.closeAllConnections?.();
  servidor.close();
  db.cerrarBase();
  fs.rmSync(temporal, { recursive: true, force: true });
});

const A = '573008880001';
const B = '573008880002';
const HOY = fechaBogota();
let tic = 0;

async function sesion(tel) {
  db.asegurarUsuario(tel);
  acceso.reiniciarLimites();
  const ahora = acceso.ahoraS() + 300000 + (tic += 1000);
  const enviados = [];
  await acceso.solicitarCodigo({ telefono: tel, enviar: async (t, texto) => enviados.push(texto), ahora });
  return acceso.verificarCodigo({ telefono: tel, codigo: enviados[0].match(/\*(\d{6})\*/)[1], ahora }).token;
}
const post = async (ruta, cuerpo, token, extra = {}) => {
  const r = await fetch(base + ruta, {
    method: 'POST',
    headers: { Authorization: 'Bearer secreto-de-prueba', 'Content-Type': 'application/json', ...(token ? { 'X-Sesion': token } : {}), ...extra },
    body: JSON.stringify(cuerpo),
  });
  return { estado: r.status, cuerpo: await r.json().catch(() => null) };
};
const get = async (ruta, token) =>
  (await fetch(base + ruta, { headers: { Authorization: 'Bearer secreto-de-prueba', 'X-Sesion': token } })).json();

const tA = await sesion(A);
const tB = await sesion(B);
const nuevo = (extra = {}) => ({ clave: `clave-${Math.random().toString(36).slice(2, 12)}`, tipo: 'gasto', monto: 25000, categoria: 'Comida', descripcion: 'almuerzo', fecha: HOY, ...extra });

test('crear: se guarda, aparece en la lista y en el saldo, y deja auditoría', async () => {
  const datos = nuevo();
  const r = await post('/interno/movimientos/crear', datos, tA);
  assert.equal(r.estado, 201);
  assert.ok(Number.isSafeInteger(r.cuerpo.id));
  const lista = await get('/api/movimientos', tA);
  assert.equal(lista.find((m) => m.id === r.cuerpo.id).descripcion, 'almuerzo');
  assert.equal(finanzas.caja(A, HOY).balance, -25000);
  const aud = db.listarAuditoria(A);
  assert.equal(aud[0].accion, 'crear');
  assert.equal(aud[0].origen, 'web');
});

test('crear con la misma clave (doble clic o reintento) no duplica', async () => {
  const datos = nuevo({ monto: 1000 });
  const antes = finanzas.caja(A, HOY).balance;
  assert.equal((await post('/interno/movimientos/crear', datos, tA)).estado, 201);
  const otra = await post('/interno/movimientos/crear', datos, tA);
  assert.equal(otra.estado, 200);
  assert.equal(otra.cuerpo.duplicado, true);
  assert.equal(finanzas.caja(A, HOY).balance, antes - 1000);
  // La misma clave en otra cuenta es otra operación
  assert.equal((await post('/interno/movimientos/crear', datos, tB)).estado, 201);
});

test('datos inválidos se rechazan sin guardar nada', async () => {
  const antes = finanzas.caja(A, HOY).balance;
  const malos = [
    { clave: undefined },
    { clave: 'corta' },
    { monto: 0 }, { monto: -5 }, { monto: 12.5 }, { monto: '100' }, { monto: 1e12 },
    { tipo: 'transferencia' },
    { categoria: 'Inventada' },
    { categoria: 'Préstamos' }, { categoria: 'Deudas' },
    { fecha: '2999-01-01' }, { fecha: '2026-02-31' }, { fecha: 'ayer' },
    { descripcion: 'x'.repeat(121) },
    { descripcion: 123 },
  ];
  for (const m of malos) {
    const r = await post('/interno/movimientos/crear', nuevo(m), tA);
    assert.equal(r.estado, 400, JSON.stringify(m));
  }
  assert.equal(finanzas.caja(A, HOY).balance, antes);
});

test('editar cambia solo lo pedido, actualiza el saldo y deja el antes y el después', async () => {
  const { cuerpo } = await post('/interno/movimientos/crear', nuevo({ monto: 30000, descripcion: 'taxi' }), tA);
  const antes = finanzas.caja(A, HOY).balance;
  const r = await post('/interno/movimientos/editar', { id: cuerpo.id, cambios: { categoria: 'Transporte', monto: 20000 } }, tA);
  assert.equal(r.estado, 200);
  const m = (await get('/api/movimientos', tA)).find((x) => x.id === cuerpo.id);
  assert.deepEqual([m.categoria, m.monto, m.descripcion], ['Transporte', 20000, 'taxi']);
  assert.equal(finanzas.caja(A, HOY).balance, antes + 10000);
  const aud = db.listarAuditoria(A)[0];
  assert.equal(aud.accion, 'editar');
  assert.match(aud.detalle, /"antes"[\s\S]*"despues"/);
  // Cambios inválidos o vacíos
  assert.equal((await post('/interno/movimientos/editar', { id: cuerpo.id, cambios: {} }, tA)).estado, 400);
  assert.equal((await post('/interno/movimientos/editar', { id: cuerpo.id, cambios: { monto: -1 } }, tA)).estado, 400);
  assert.equal((await post('/interno/movimientos/editar', { id: cuerpo.id, cambios: { categoria: 'Préstamos' } }, tA)).estado, 400);
});

test('eliminar: borra, no se puede repetir y queda en la auditoría', async () => {
  const { cuerpo } = await post('/interno/movimientos/crear', nuevo({ monto: 7000 }), tA);
  const antes = finanzas.caja(A, HOY).balance;
  assert.equal((await post('/interno/movimientos/eliminar', { id: cuerpo.id }, tA)).estado, 200);
  assert.equal(finanzas.caja(A, HOY).balance, antes + 7000);
  assert.equal((await post('/interno/movimientos/eliminar', { id: cuerpo.id }, tA)).estado, 404);
  assert.equal(db.listarAuditoria(A)[0].accion, 'eliminar');
});

test('un movimiento ligado a un préstamo o deuda no se edita ni se borra desde aquí', async () => {
  ejecutar({ nombre: 'registrar_prestamo', datos: { persona: 'Pedro', monto: 15000 } }, { usuario: A, hoy: HOY, mensajeId: 'p-1', indice: 0 });
  const prestamo = (await get('/api/movimientos', tA)).find((m) => m.origen === 'prestamo');
  assert.ok(prestamo);
  assert.equal((await post('/interno/movimientos/editar', { id: prestamo.id, cambios: { monto: 1 } }, tA)).estado, 409);
  assert.equal((await post('/interno/movimientos/eliminar', { id: prestamo.id }, tA)).estado, 409);
  assert.equal(finanzas.prestamos(A).total, 15000);
});

test('aislamiento: B no puede ver, editar ni borrar movimientos de A, ni usando su id', async () => {
  const { cuerpo } = await post('/interno/movimientos/crear', nuevo({ monto: 4000, descripcion: 'privado' }), tA);
  const antes = finanzas.caja(A, HOY).balance;
  assert.equal((await post('/interno/movimientos/editar', { id: cuerpo.id, cambios: { monto: 1 } }, tB)).estado, 404);
  assert.equal((await post('/interno/movimientos/eliminar', { id: cuerpo.id }, tB)).estado, 404);
  assert.equal(finanzas.caja(A, HOY).balance, antes);
  assert.equal((await get('/api/movimientos', tB)).some((m) => m.id === cuerpo.id), false);
  // Intentar elegir cuenta por el cuerpo no sirve: se ignora
  const r = await post('/interno/movimientos/crear', { ...nuevo(), usuario: A, telefono: A }, tB);
  assert.equal(r.estado, 201);
  assert.equal(db.listarAuditoria(A).some((a) => a.entidad_id === r.cuerpo.id), false);
  assert.equal(db.listarAuditoria(B)[0].entidad_id, r.cuerpo.id);
});

test('sin sesión, con sesión falsa, sin token o desde un navegador: no se escribe', async () => {
  const antes = finanzas.caja(A, HOY).balance;
  assert.equal((await post('/interno/movimientos/crear', nuevo(), undefined)).estado, 401);
  assert.equal((await post('/interno/movimientos/crear', nuevo(), 'x'.repeat(40))).estado, 401);
  assert.equal((await post('/interno/movimientos/crear', nuevo(), tA, { Authorization: 'Bearer otro' })).estado, 401);
  assert.equal((await post('/interno/movimientos/crear', nuevo(), tA, { Origin: 'http://malo.example' })).estado, 403);
  assert.equal((await fetch(base + '/interno/movimientos/crear', { method: 'DELETE', headers: { Authorization: 'Bearer secreto-de-prueba' } })).status, 405);
  assert.equal(finanzas.caja(A, HOY).balance, antes);
});

test('límite de operaciones por minuto', async () => {
  process.env.MAX_ESCRITURAS_MINUTO = '12';
  const chico = crearServidorApi();
  await new Promise((r) => chico.listen(0, '127.0.0.1', r));
  const t = await sesion('573008880003');
  const estados = [];
  try {
    for (let i = 0; i < 14; i++) {
      const r = await fetch(`http://127.0.0.1:${chico.address().port}/interno/movimientos/crear`, {
        method: 'POST',
        headers: { Authorization: 'Bearer secreto-de-prueba', 'Content-Type': 'application/json', 'X-Sesion': t },
        body: JSON.stringify(nuevo({ monto: 100 })),
      });
      estados.push(r.status);
    }
  } finally {
    chico.closeAllConnections?.();
    chico.close();
    process.env.MAX_ESCRITURAS_MINUTO = '500';
  }
  assert.ok(estados.includes(429));
  assert.equal(estados.filter((e) => e === 201).length, 12);
});

test('GET /api/movimiento: devuelve el propio y da 404 para el de otra cuenta', async () => {
  const { cuerpo } = await post('/interno/movimientos/crear', nuevo({ descripcion: 'solo mío' }), tA);
  const propio = await fetch(`${base}/api/movimiento?id=${cuerpo.id}`, { headers: { Authorization: 'Bearer secreto-de-prueba', 'X-Sesion': tA } });
  assert.equal(propio.status, 200);
  assert.equal((await propio.json()).descripcion, 'solo mío');
  const ajeno = await fetch(`${base}/api/movimiento?id=${cuerpo.id}`, { headers: { Authorization: 'Bearer secreto-de-prueba', 'X-Sesion': tB } });
  assert.equal(ajeno.status, 404);
  const basura = await fetch(`${base}/api/movimiento?id=abc`, { headers: { Authorization: 'Bearer secreto-de-prueba', 'X-Sesion': tA } });
  assert.equal(basura.status, 404);
});

test('histórico por lotes conserva las cifras, limita recursos y exige sesión propia', async () => {
  const token = await sesion(A);
  const pedir = (ruta, sesionToken = token) => fetch(base + ruta, { headers: { Authorization: 'Bearer secreto-de-prueba', 'X-Sesion': sesionToken } });
  const meses = ['2026-09', '2026-10', '2026-11'];
  const lote = await (await pedir(`/api/resumenes?meses=${meses.join(',')}`)).json();
  const individuales = await Promise.all(meses.map(async mes => (await pedir(`/api/resumen?mes=${mes}`)).json()));
  assert.deepEqual(lote, individuales);
  assert.equal((await pedir('/api/resumenes?meses=2026-11,2026-11')).status, 400);
  assert.equal((await pedir('/api/resumenes?meses=invalid')).status, 400);
  assert.equal((await pedir('/api/resumenes?meses=2026-11', 'inventada')).status, 401);
});

test('rotación de API acepta temporalmente la clave anterior y la rechaza al retirarla', async () => {
  const anterior = 'anterior-exclusiva-de-pruebas-123456789';
  const pedir = () => fetch(base + '/api/salud', { headers: { Authorization: `Bearer ${anterior}` } });
  process.env.API_TOKEN_ANTERIOR = anterior;
  try { assert.equal((await pedir()).status, 200); }
  finally { delete process.env.API_TOKEN_ANTERIOR; }
  assert.equal((await pedir()).status, 401);
});

test('producción rechaza claves cortas, ausentes o compartidas entre API y códigos', () => {
  const previo = { NODE_ENV: process.env.NODE_ENV, API_TOKEN: process.env.API_TOKEN, SECRETO_SESION: process.env.SECRETO_SESION, API_TOKEN_ANTERIOR: process.env.API_TOKEN_ANTERIOR };
  try {
    process.env.NODE_ENV = 'production';
    assert.throws(() => crearServidorApi(), /Producción requiere/);
    process.env.API_TOKEN = 'a'.repeat(40); process.env.SECRETO_SESION = process.env.API_TOKEN;
    assert.throws(() => crearServidorApi(), /independientes/);
    process.env.SECRETO_SESION = 'b'.repeat(40);
    process.env.API_TOKEN_ANTERIOR = 'corta';
    assert.throws(() => crearServidorApi(), /clave anterior/);
    delete process.env.API_TOKEN_ANTERIOR;
    const seguro = crearServidorApi(); assert.ok(seguro); seguro.close();
  } finally {
    for (const [k, v] of Object.entries(previo)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});
