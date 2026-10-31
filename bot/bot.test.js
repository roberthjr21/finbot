// Ejecutar con:  npm test      (no usa WhatsApp ni internet: la IA y la base de datos son simuladas)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';
import { spawnSync } from 'node:child_process';

const temporal = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-financiero-test-'));
process.env.DB_ARCHIVO = path.join(temporal, 'pruebas.db');
process.env.API_TOKEN = 'secreto-de-prueba';
process.env.API_PUERTO = '0';
process.env.ANTHROPIC_API_KEY = 'clave-falsa';
process.env.ESPERA_REINTENTO_MS = '0'; // sin pausas entre reintentos para que las pruebas sean rápidas
for (const variable of ['GEMINI_API_KEY', 'GEMINI_URL', 'ANTHROPIC_URL', 'MODELO_IA', 'MODELO_GEMINI', 'MODELO_ANTHROPIC', 'MODELO_RESPALDO']) {
  delete process.env[variable];
}

const db = await import('./db.js');
const { ejecutar } = await import('./acciones.js');
const { interpretarComando, atajoSinIA, AYUDA } = await import('./comandos.js');
const { CATEGORIAS } = await import('./categorias.js');
const { interpretar, analizarConIA } = await import('./ia.js');
const { datosAnalisis, responderAnalisis } = await import('./analisis.js');
const { crearServidorApi } = await import('./api.js');
const { pesos, rangoPeriodo, rangoMes, valida } = await import('./fechas.js');
const { parseMonto, tieneDecimalConPunto } = await import('./montos.js');
const { acotarAcciones } = await import('./politicas.js');
const { crearRespaldo, restaurarRespaldo } = await import('./db-admin.js');
const acceso = await import('./acceso.js');

after(() => {
  db.cerrarBase();
  fs.rmSync(temporal, { recursive: true, force: true });
});

const U = '573001234567';
const HOY = '2026-10-17'; // sábado

const reg = (datos, i = 0, id = 'm') => ejecutar({ nombre: 'registrar_movimiento', datos }, { usuario: U, hoy: HOY, mensajeId: id, indice: i });

test('fechas y formato de pesos', () => {
  assert.equal(pesos(20000), '$20.000');
  assert.equal(pesos(1500000), '$1.500.000');
  assert.equal(pesos(-5000), '-$5.000');
  assert.deepEqual(rangoPeriodo('semana', HOY), { desde: '2026-10-12', hasta: HOY, titulo: 'esta semana' }); // lunes
  assert.equal(rangoPeriodo('mes', HOY).desde, '2026-10-01');
  assert.equal(rangoPeriodo('mes_pasado', HOY).desde, '2026-09-01');
  assert.equal(rangoPeriodo('mes_pasado', HOY).hasta, '2026-09-30');
  assert.equal(rangoPeriodo('mes_pasado', '2026-01-15').desde, '2025-12-01');
  assert.deepEqual(rangoMes('2024-02'), { desde: '2024-02-01', hasta: '2024-02-29' });
  assert.ok(valida('2026-10-17'));
  assert.ok(!valida('2026-02-30'));
  assert.ok(!valida('ayer'));
});

test('comandos: /gasto, /ingreso y errores', () => {
  const g = interpretarComando('/gasto 20.000 comida almuerzo con Ana');
  assert.deepEqual(g.acciones[0].datos, { tipo: 'gasto', monto: 20000, categoria: 'Comida', descripcion: 'almuerzo con Ana' });
  const sinCategoria = interpretarComando('/gasto 15k bus al centro');
  assert.equal(sinCategoria.acciones[0].datos.monto, 15000);
  assert.equal(sinCategoria.acciones[0].datos.categoria, 'Otros');
  assert.equal(sinCategoria.acciones[0].datos.descripcion, 'bus al centro');
  assert.equal(interpretarComando('/ingreso 1500000 salario quincena').acciones[0].datos.tipo, 'ingreso');
  assert.match(interpretarComando('/gasto mucho').respuesta, /Usa: \/gasto/);
  assert.equal(interpretarComando('/inventado'), null);
  assert.equal(interpretarComando('/resumen año').acciones[0].datos.periodo, 'anio');
  assert.equal(interpretarComando('/gasto 20 mil comida almuerzo').acciones[0].datos.monto, 20000);
  assert.equal(interpretarComando('/gasto 8 lucas bus').acciones[0].datos.monto, 8000);
  assert.equal(interpretarComando('/gasto 20.5 comida').respuesta.includes('Usa:'), true);
  assert.equal(interpretarComando('/gasto 99999999999999999999 comida').respuesta.includes('Usa:'), true);
  assert.equal(parseMonto('1,5'), 2);
  assert.equal(parseMonto('1,5 millones'), 1500000);
  assert.equal(parseMonto('0,000001 millones'), 1);
  assert.equal(parseMonto('0,0000005 millones'), 1);
  assert.equal(parseMonto('0,0000004 millones'), null);
  assert.equal(parseMonto('2,675'), 3);
  assert.equal(parseMonto('20.000'), 20000);
  assert.equal(parseMonto('20.5'), null);
  assert.equal(tieneDecimalConPunto('pagué 20.5 por el almuerzo'), true);
  assert.equal(tieneDecimalConPunto('pagué $20.5 por el almuerzo.'), true);
  assert.equal(tieneDecimalConPunto('pagué 20.500 por el almuerzo'), false);
});

test('las acciones tienen límite por mensaje y una sola acción destructiva', () => {
  const lote = [
    { nombre: 'deshacer_ultimo' },
    { nombre: 'deshacer_ultimo' },
    { nombre: 'consultar_resumen' },
    { nombre: 'fijar_presupuesto' },
    { nombre: 'ver_presupuestos' },
    { nombre: 'ultimos_movimientos' },
  ];
  const resultado = acotarAcciones(lote);
  assert.equal(resultado.length, 4);
  assert.equal(resultado.filter((a) => a.nombre === 'deshacer_ultimo').length, 1);
  assert.deepEqual(acotarAcciones(null), []);
});

test('registrar movimientos y evitar duplicados', () => {
  const r = reg({ tipo: 'gasto', monto: 20000, categoria: 'Comida', descripcion: 'almuerzo' }, 0, 'msg1');
  assert.match(r, /Gasto registrado: \$20\.000 en Comida \(almuerzo\)/);
  assert.equal(reg({ tipo: 'gasto', monto: 20000, categoria: 'Comida', descripcion: 'almuerzo' }, 0, 'msg1'), null); // mismo mensaje
  assert.match(reg({ tipo: 'ingreso', monto: 1500000, categoria: 'Salario', descripcion: 'quincena' }, 0, 'msg2'), /Ingreso registrado: \$1\.500\.000/);
  assert.match(reg({ tipo: 'gasto', monto: 12000, categoria: 'Inventada', descripcion: '' }, 0, 'msg3'), /No entendí/);
  assert.match(reg({ tipo: 'gasto', monto: -5, categoria: 'Comida' }, 0, 'msg4'), /No entendí/);
  assert.match(reg({ tipo: 'gasto', monto: 8000, categoria: 'Transporte', descripcion: 'bus', fecha: '2026-10-15' }, 0, 'msg5'), /2026-10-15/);
  // fecha futura o inválida: se usa la del mensaje
  assert.doesNotMatch(reg({ tipo: 'gasto', monto: 1000, categoria: 'Otros', descripcion: 'x', fecha: '2027-01-01' }, 0, 'msg6'), /2027/);
  assert.match(reg({ tipo: 'gasto', monto: true, categoria: 'Otros' }, 0, 'msg7'), /No entendí/);
  assert.match(reg({ tipo: 'gasto', monto: 1e12, categoria: 'Otros' }, 0, 'msg8'), /No entendí/);
  assert.match(reg({ tipo: 'transferencia', monto: 100, categoria: 'Otros' }, 0, 'msg9'), /No entendí/);
});

test('las restricciones financieras rechazan datos inválidos y solo se ignora un mensaje duplicado', () => {
  assert.equal(db.agregarMovimiento({ usuario: 'restricciones', tipo: 'gasto', monto: 100, categoria: 'Otros', fecha: HOY, mensajeId: 'restriccion-dup' }) !== null, true);
  assert.equal(db.agregarMovimiento({ usuario: 'restricciones', tipo: 'gasto', monto: 100, categoria: 'Otros', fecha: HOY, mensajeId: 'restriccion-dup' }), null);
  assert.throws(() => db.agregarMovimiento({ usuario: 'restricciones', tipo: 'transferencia', monto: 100, categoria: 'Otros', fecha: HOY, mensajeId: 'restriccion-tipo' }));
  assert.throws(() => db.agregarMovimiento({ usuario: 'restricciones', tipo: 'gasto', monto: 0, categoria: 'Otros', fecha: HOY, mensajeId: 'restriccion-monto' }));
});

test('SQLite crea el esquema, conserva importes enteros y aísla usuarios', () => {
  assert.deepEqual(db.configuracionSQLite(), { journal_mode: 'wal', busy_timeout: 5000 });
  const conexion = new DatabaseSync(process.env.DB_ARCHIVO, { readOnly: true });
  try {
    assert.equal(conexion.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
    const tablas = new Set(conexion.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name));
    assert.deepEqual([...['movimientos', 'presupuestos', 'procesados'].filter((tabla) => tablas.has(tabla))], ['movimientos', 'presupuestos', 'procesados']);
  } finally { conexion.close(); }

  const id = db.agregarMovimiento({ usuario: 'cuenta-a', tipo: 'ingreso', monto: 987654, categoria: 'Salario', fecha: HOY, mensajeId: 'aislamiento-a' });
  assert.ok(id);
  assert.equal(db.listarMovimientos({ usuario: 'cuenta-a' }).find((m) => m.id === id).monto, 987654);
  assert.equal(db.listarMovimientos({ usuario: 'cuenta-b' }).some((m) => m.id === id), false);
  assert.equal(db.resumen('cuenta-b', HOY, HOY).ingresos, 0);
  db.fijarPresupuesto('cuenta-a', 'Comida', 50000);
  assert.equal(db.presupuestoDe('cuenta-b', 'Comida'), null);
  assert.equal(db.borrarMovimiento('cuenta-b', id), null);
  assert.equal(db.borrarMovimiento('cuenta-a', id).monto, 987654);
});

test('las acciones y la marca de procesado se revierten juntas ante fallo', () => {
  assert.throws(() => db.enTransaccion(() => {
    db.agregarMovimiento({ usuario: 'rollback', tipo: 'gasto', monto: 100, categoria: 'Otros', fecha: HOY, mensajeId: 'rollback:0' });
    db.marcarProcesado('rollback-msg');
    throw new Error('fallo simulado');
  }), /fallo simulado/);
  assert.deepEqual(db.listarMovimientos({ usuario: 'rollback' }), []);
  assert.equal(db.yaProcesado('rollback-msg'), false);
});

test('conexiones concurrentes escriben sin perder filas', async () => {
  const archivo = path.join(temporal, 'concurrencia.db');
  const inicial = new DatabaseSync(archivo);
  inicial.exec('PRAGMA journal_mode=WAL; CREATE TABLE operaciones (id INTEGER PRIMARY KEY, escritor INTEGER NOT NULL, valor INTEGER NOT NULL);');
  inicial.close();
  const codigo = `const { parentPort, workerData } = require('node:worker_threads'); const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync(workerData.archivo); db.exec('PRAGMA busy_timeout=5000'); const ins = db.prepare('INSERT INTO operaciones(escritor, valor) VALUES (?, ?)'); for (let i=0;i<100;i++) ins.run(workerData.escritor, i); db.close(); parentPort.postMessage('ok');`;
  await Promise.all(Array.from({ length: 4 }, (_, escritor) => new Promise((resolve, reject) => {
    const worker = new Worker(codigo, { eval: true, workerData: { archivo, escritor }, execArgv: [] });
    worker.once('message', resolve);
    worker.once('error', reject);
    worker.once('exit', (code) => { if (code !== 0) reject(new Error(`worker terminó con código ${code}`)); });
  })));
  const verificacion = new DatabaseSync(archivo, { readOnly: true });
  try {
    assert.equal(verificacion.prepare('SELECT count(*) AS total FROM operaciones').get().total, 400);
    assert.equal(verificacion.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  } finally { verificacion.close(); }
});

test('resumen del periodo y por categoría', () => {
  const texto = ejecutar({ nombre: 'consultar_resumen', datos: { periodo: 'mes' } }, { usuario: U, hoy: HOY });
  assert.match(texto, /Ingresos: \$1\.500\.000/);
  assert.match(texto, /Gastos: \$29\.000/); // 20.000 + 8.000 + 1.000; categoría inválida rechazada
  assert.match(texto, /• Comida: \$20\.000/);
  const vacio = ejecutar({ nombre: 'consultar_resumen', datos: { periodo: 'mes_pasado' } }, { usuario: U, hoy: HOY });
  assert.match(vacio, /No tienes movimientos/);
});

test('presupuestos con alertas al 80% y al pasarse', () => {
  assert.match(ejecutar({ nombre: 'fijar_presupuesto', datos: { categoria: 'Ocio', limite_mensual: 100000 } }, { usuario: U, hoy: HOY }), /\$100\.000/);
  assert.doesNotMatch(reg({ tipo: 'gasto', monto: 50000, categoria: 'Ocio', descripcion: 'cine' }, 0, 'o1'), /⚠️|🚨/);
  assert.match(reg({ tipo: 'gasto', monto: 35000, categoria: 'Ocio', descripcion: 'salida' }, 0, 'o2'), /⚠️ Llevas el 85%/);
  assert.match(reg({ tipo: 'gasto', monto: 30000, categoria: 'Ocio', descripcion: 'juego' }, 0, 'o3'), /🚨 Te pasaste/);
  assert.match(ejecutar({ nombre: 'ver_presupuestos', datos: {} }, { usuario: U, hoy: HOY }), /Ocio: \$115\.000 de \$100\.000 \(115%\)/);
  assert.match(ejecutar({ nombre: 'fijar_presupuesto', datos: { categoria: 'Ocio', limite_mensual: 1e12 } }, { usuario: U, hoy: HOY }), /Dime la categoría/);
});

test('últimos movimientos y deshacer con confirmación', () => {
  const ultimos = ejecutar({ nombre: 'ultimos_movimientos', datos: { cantidad: 2 } }, { usuario: U, hoy: HOY });
  assert.equal(ultimos.split('\n').length, 3);
  assert.match(ejecutar({ nombre: 'deshacer_ultimo', datos: {} }, { usuario: U, hoy: HOY }), /\/deshacer confirmar/);
  assert.match(ejecutar({ nombre: 'confirmar_deshacer', datos: {} }, { usuario: U, hoy: HOY }), /Borré el movimiento confirmado/);
  ejecutar({ nombre: 'deshacer_ultimo', datos: {} }, { usuario: U, hoy: HOY });
  assert.match(ejecutar({ nombre: 'cancelar_deshacer', datos: {} }, { usuario: U, hoy: HOY }), /cancelé/);
  assert.match(ejecutar({ nombre: 'confirmar_deshacer', datos: {} }, { usuario: U, hoy: HOY }), /No hay un borrado pendiente/);
  assert.match(ejecutar({ nombre: 'deshacer_ultimo', datos: {} }, { usuario: 'otro' }), /No hay movimientos/);
});

test('respaldo y restauración conservan datos en WAL sin sobrescribir', () => {
  const origen = path.join(temporal, 'wal-origen.db');
  const respaldo = path.join(temporal, 'respaldo.db');
  const restaurada = path.join(temporal, 'restaurada.db');
  const origenDb = new DatabaseSync(origen);
  origenDb.exec("PRAGMA journal_mode=WAL; CREATE TABLE movimientos (id INTEGER PRIMARY KEY AUTOINCREMENT, usuario TEXT NOT NULL, tipo TEXT NOT NULL CHECK(tipo IN ('gasto','ingreso')), monto INTEGER NOT NULL CHECK(monto > 0), categoria TEXT NOT NULL, descripcion TEXT NOT NULL DEFAULT '', fecha TEXT NOT NULL, creado TEXT NOT NULL DEFAULT (datetime('now')), mensaje_id TEXT UNIQUE); CREATE INDEX idx_mov_usuario_fecha ON movimientos(usuario,fecha); CREATE TABLE presupuestos (usuario TEXT NOT NULL, categoria TEXT NOT NULL, limite INTEGER NOT NULL CHECK(limite > 0), PRIMARY KEY(usuario,categoria)); CREATE TABLE procesados (id TEXT PRIMARY KEY, creado TEXT NOT NULL DEFAULT (datetime('now')));");
  const insertar = origenDb.prepare('INSERT INTO movimientos (usuario, tipo, monto, categoria, fecha) VALUES (?, ?, ?, ?, ?)');
  for (let i = 1; i <= 100; i++) insertar.run('prueba', 'gasto', i, 'Otros', '2026-01-01');
  assert.throws(() => restaurarRespaldo(origen, path.join(temporal, 'restauracion-insegura.db')), /WAL\/SHM/);
  crearRespaldo(origen, respaldo);
  assert.equal(fs.statSync(respaldo).mode & 0o777, 0o600);
  origenDb.close();
  restaurarRespaldo(respaldo, restaurada);
  assert.equal(fs.statSync(restaurada).mode & 0o777, 0o600);
  const restauradaDb = new DatabaseSync(restaurada, { readOnly: true });
  assert.equal(restauradaDb.prepare('SELECT count(*) AS n FROM movimientos').get().n, 100);
  restauradaDb.close();
  const restauradaReabierta = new DatabaseSync(restaurada, { readOnly: true });
  assert.equal(restauradaReabierta.prepare('SELECT count(*) AS n FROM movimientos').get().n, 100);
  restauradaReabierta.close();
  const integridadDb = new DatabaseSync(restaurada, { readOnly: true });
  assert.equal(integridadDb.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  integridadDb.close();
  assert.throws(() => restaurarRespaldo(respaldo, restaurada), /ya existe/);
});

test('respaldo y restauración rechazan archivos corruptos y limpian ante errores de permiso', () => {
  const corrupta = path.join(temporal, 'corrupta.db');
  const destino = path.join(temporal, 'corrupta-restaurada.db');
  fs.writeFileSync(corrupta, 'esto no es una base SQLite');
  assert.throws(() => crearRespaldo(corrupta, path.join(temporal, 'respaldo-corrupto.db')));
  assert.throws(() => restaurarRespaldo(corrupta, destino));
  const incompatible = path.join(temporal, 'esquema-incompatible.db');
  const incompatibleDb = new DatabaseSync(incompatible);
  incompatibleDb.exec('CREATE TABLE movimientos (id INTEGER); CREATE TABLE presupuestos (id INTEGER); CREATE TABLE procesados (id INTEGER);');
  incompatibleDb.close();
  assert.throws(() => restaurarRespaldo(incompatible, path.join(temporal, 'incompatible-restaurada.db')), /Esquema incompatible/);
  const respaldoDenegado = path.join(temporal, 'respaldo-denegado.db');
  const restauracionDenegada = path.join(temporal, 'restauracion-denegada.db');
  const fuenteIndependiente = path.join(temporal, 'fuente-independiente.db');
  const fuenteDb = new DatabaseSync(fuenteIndependiente);
  fuenteDb.exec("CREATE TABLE movimientos (id INTEGER PRIMARY KEY AUTOINCREMENT, usuario TEXT NOT NULL, tipo TEXT NOT NULL CHECK(tipo IN ('gasto','ingreso')), monto INTEGER NOT NULL CHECK(monto > 0), categoria TEXT NOT NULL, descripcion TEXT NOT NULL DEFAULT '', fecha TEXT NOT NULL, creado TEXT NOT NULL DEFAULT (datetime('now')), mensaje_id TEXT UNIQUE); CREATE INDEX idx_mov_usuario_fecha ON movimientos(usuario,fecha); CREATE TABLE presupuestos (usuario TEXT NOT NULL, categoria TEXT NOT NULL, limite INTEGER NOT NULL CHECK(limite > 0), PRIMARY KEY(usuario,categoria)); CREATE TABLE procesados (id TEXT PRIMARY KEY, creado TEXT NOT NULL DEFAULT (datetime('now')));");
  fuenteDb.close();
  const linkOriginal = fs.linkSync;
  fs.linkSync = () => { const error = new Error('permiso denegado simulado'); error.code = 'EACCES'; throw error; };
  try {
    assert.throws(() => crearRespaldo(process.env.DB_ARCHIVO, respaldoDenegado), { code: 'EACCES' });
    assert.throws(() => restaurarRespaldo(fuenteIndependiente, restauracionDenegada), { code: 'EACCES' });
  } finally { fs.linkSync = linkOriginal; }
  assert.equal(fs.existsSync(respaldoDenegado), false);
  assert.equal(fs.existsSync(restauracionDenegada), false);
});

test('restauración conserva datos al cerrar y volver a abrir SQLite', () => {
  const archivo = path.join(temporal, 'persistencia.db');
  const primera = new DatabaseSync(archivo);
  primera.exec('CREATE TABLE prueba (valor INTEGER NOT NULL); INSERT INTO prueba VALUES (42);');
  primera.close();
  const segunda = new DatabaseSync(archivo, { readOnly: true });
  try { assert.equal(segunda.prepare('SELECT valor FROM prueba').get().valor, 42); }
  finally { segunda.close(); }
});

test('los datos de cada persona están separados', () => {
  const otro = ejecutar({ nombre: 'consultar_resumen', datos: { periodo: 'mes' } }, { usuario: 'otra-persona', hoy: HOY });
  assert.match(otro, /No tienes movimientos/);
});

test('IA simulada: interpreta varias herramientas en un mensaje', async () => {
  let recibido;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, opciones) => {
    recibido = { cabeceras: opciones.headers, cuerpo: JSON.parse(opciones.body) };
    return new Response(JSON.stringify({
        content: [
          { type: 'text', text: 'Listo, anoté los dos.' },
          { type: 'tool_use', id: 'a', name: 'registrar_movimiento', input: { tipo: 'gasto', monto: 5000, categoria: 'Transporte', descripcion: 'bus' } },
          { type: 'tool_use', id: 'b', name: 'registrar_movimiento', input: { tipo: 'gasto', monto: 12000, categoria: 'Comida', descripcion: 'almuerzo' } },
        ],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const { interpretar: interpretarConUrl } = await import('./ia.js?respuesta-falsa');
    const r = await interpretarConUrl('bus 5 mil y almuerzo 12 mil', HOY);

    assert.equal(r.acciones.length, 2);
    assert.equal(r.acciones[1].datos.monto, 12000);
    assert.equal(r.texto, 'Listo, anoté los dos.');
    assert.equal(recibido.cabeceras['x-api-key'], 'clave-falsa');
    assert.equal(recibido.cuerpo.tools.length, 11);
    assert.match(recibido.cuerpo.system, /consultar_saldo/);
    assert.match(recibido.cuerpo.system, /Mascotas/);
    assert.match(recibido.cuerpo.system, /Hoy es 2026-10-17/);
    assert.equal(typeof interpretar, 'function');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('IA simulada: un error de la API se propaga con un mensaje claro', async () => {
  const originalFetch = globalThis.fetch;
  let intentos = 0;
  globalThis.fetch = async () => { intentos++; return new Response('sobrecargada', { status: 529 }); };
  try {
    const { interpretar: otra } = await import('./ia.js?respuesta-caida');
    await assert.rejects(() => otra('hola', HOY), /API 529/);
    assert.equal(intentos, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('IA simulada: Gemini usa su modelo y sus herramientas sin salir a internet', async () => {
  const originalFetch = globalThis.fetch;
  process.env.GEMINI_API_KEY = 'clave-falsa-gemini';
  process.env.MODELO_GEMINI = 'modelo-prueba';
  let recibido;
  globalThis.fetch = async (url, opciones) => {
    recibido = { url, opciones };
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [
      { functionCall: { name: 'registrar_movimiento', args: { tipo: 'gasto', monto: 8000, categoria: 'Transporte' } } },
    ] } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const r = await interpretar('8 lucas en bus', HOY);
    assert.equal(r.acciones[0].datos.monto, 8000);
    assert.equal(recibido.opciones.headers['x-goog-api-key'], 'clave-falsa-gemini');
    assert.match(recibido.url, /modelo-prueba/);
  } finally {
    delete process.env.GEMINI_API_KEY;
    delete process.env.MODELO_GEMINI;
    globalThis.fetch = originalFetch;
  }
});

// --- Análisis de gastos ---
const AN = 'persona-analisis';
const HOY_AN = '2026-10-17'; // día 17 de 31
const mov = (tipo, monto, categoria, fecha, id) =>
  db.agregarMovimiento({ usuario: AN, tipo, monto, categoria, descripcion: 'secreto personal', fecha, mensajeId: `an:${id}` });

test('análisis: compara este mes con el mismo tramo del mes pasado', () => {
  mov('ingreso', 1000000, 'Salario', '2026-10-01', 1);
  mov('gasto', 100000, 'Comida', '2026-10-03', 2);
  mov('gasto', 20000, 'Transporte', '2026-10-10', 3);
  mov('gasto', 60000, 'Ocio', '2026-10-12', 4);
  mov('gasto', 50000, 'Comida', '2026-09-05', 5);
  mov('gasto', 40000, 'Transporte', '2026-09-10', 6);
  mov('gasto', 70000, 'Comida', '2026-09-25', 7); // después del día 17: no entra en el tramo
  db.fijarPresupuesto(AN, 'Ocio', 100000);

  const d = datosAnalisis(AN, HOY_AN);
  assert.equal(d.hay_datos, true);
  assert.equal(d.este_mes.gastos, 180000);
  assert.equal(d.este_mes.ahorro_pct, 82);
  assert.equal(d.mes_pasado_mismo_tramo.gastos, 90000);
  assert.equal(d.variacion_gastos_pct, 100);
  assert.equal(d.periodo.mes_pasado_hasta, '2026-09-17');
  assert.equal(d.periodo.avance_del_mes_pct, 55);
  const por = Object.fromEntries(d.categorias.map((c) => [c.categoria, c]));
  assert.equal(por.Comida.variacion_pct, 100);
  assert.equal(por.Transporte.variacion_pct, -50);
  assert.equal(por.Ocio.variacion_pct, null);
  assert.deepEqual(d.presupuestos, [{ categoria: 'Ocio', limite: 100000, gastado: 60000, porcentaje: 60 }]);
  assert.deepEqual(d.mayores_gastos[0], { monto: 100000, categoria: 'Comida' });
  assert.ok(!JSON.stringify(d).includes('secreto personal'), 'no debe incluir descripciones escritas por la persona');
});

test('análisis: sin movimientos no llama a la IA y no mezcla datos entre personas', async () => {
  let llamadas = 0;
  const generar = async () => { llamadas++; return 'x'; };
  const texto = await responderAnalisis('persona-sin-datos', HOY_AN, { generar });
  assert.match(texto, /Todavía no tengo movimientos suficientes/);
  assert.equal(llamadas, 0);
  assert.equal(datosAnalisis('persona-sin-datos', HOY_AN).hay_datos, false);
});

test('análisis: usa la IA y, si falla, responde con un análisis básico', async () => {
  let recibido;
  const bien = await responderAnalisis(AN, HOY_AN, {
    generar: async (datos, hoy) => { recibido = { datos, hoy }; return 'Vas bien.'; },
  });
  assert.equal(bien, '📈 Vas bien.');
  assert.equal(recibido.hoy, HOY_AN);
  assert.equal(recibido.datos.este_mes.gastos, 180000);

  const consolaError = console.error;
  console.error = () => {};
  try {
    const caido = await responderAnalisis(AN, HOY_AN, { generar: async () => { throw new Error('timeout'); } });
    assert.match(caido, /Gastos: \$180\.000/);
    assert.match(caido, /Comida: \$100\.000 \(\+100%\)/);
    assert.match(caido, /Ocio: \$60\.000 \(nuevo este mes\)/);
    assert.match(caido, /La IA no estuvo disponible/);
  } finally {
    console.error = consolaError;
  }

  const sinIA = await responderAnalisis(AN, HOY_AN, { generar: null });
  assert.doesNotMatch(sinIA, /La IA no estuvo disponible/);
  assert.match(sinIA, /Tus mayores gastos: \$100\.000 en Comida/);
});

test('IA simulada: el análisis envía solo cifras y sin herramientas', async () => {
  const originalFetch = globalThis.fetch;
  const respuesta = (cuerpo) => new Response(JSON.stringify(cuerpo), { status: 200, headers: { 'content-type': 'application/json' } });
  let recibido;
  try {
    const datos = datosAnalisis(AN, HOY_AN);

    globalThis.fetch = async (_url, opciones) => {
      recibido = JSON.parse(opciones.body);
      return respuesta({ content: [{ type: 'text', text: 'Vas bien este mes.' }] });
    };
    assert.equal(await analizarConIA(datos, HOY_AN), 'Vas bien este mes.');
    assert.equal(recibido.tools, undefined);
    assert.match(recibido.system, /Usa SOLO los números del JSON/);
    assert.equal(JSON.parse(recibido.messages[0].content).este_mes.gastos, 180000);

    process.env.GEMINI_API_KEY = 'clave-falsa-gemini';
    globalThis.fetch = async (_url, opciones) => {
      recibido = JSON.parse(opciones.body);
      return respuesta({ candidates: [{ content: { parts: [{ text: 'razonando', thought: true }, { text: 'Gastas más en Comida.' }] } }] });
    };
    assert.equal(await analizarConIA(datos, HOY_AN), 'Gastas más en Comida.');
    assert.equal(recibido.tools, undefined);

    globalThis.fetch = async () => respuesta({ candidates: [{ content: { parts: [] } }] });
    await assert.rejects(() => analizarConIA(datos, HOY_AN), /no devolvió el análisis/);
  } finally {
    delete process.env.GEMINI_API_KEY;
    globalThis.fetch = originalFetch;
  }
});

test('/analisis y la acción analizar_gastos', () => {
  assert.deepEqual(interpretarComando('/analisis'), { acciones: [{ nombre: 'analizar_gastos', datos: {} }] });
  assert.equal(interpretarComando('/analizar').acciones[0].nombre, 'analizar_gastos');
  assert.equal(ejecutar({ nombre: 'analizar_gastos', datos: {} }, { usuario: U, hoy: HOY }), null);
  assert.match(AYUDA, /\/analisis/);
});

// --- Mejoras de IA: reintentos, modelo de respaldo, saldo y atajos ---
const respuestaGemini = (estado, cuerpo) =>
  new Response(JSON.stringify(cuerpo), { status: estado, headers: { 'content-type': 'application/json' } });
const gastoGemini = {
  candidates: [{ content: { parts: [{ functionCall: { name: 'registrar_movimiento', args: { tipo: 'gasto', monto: 1500, categoria: 'Comida' } } }] } }],
};

// Ejecuta `tarea` con un Gemini falso. `manejador(modelo)` decide qué responde cada modelo;
// `tarea` recibe la lista de modelos que se llamaron, en orden.
async function conGeminiFalso(manejador, tarea) {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const llamadas = [];
  process.env.GEMINI_API_KEY = 'clave-falsa-gemini';
  process.env.MODELO_GEMINI = 'principal';
  process.env.MODELO_RESPALDO = 'respaldo';
  globalThis.fetch = async (url) => {
    const modelo = String(url).match(/models\/([^:]+):/)[1];
    llamadas.push(modelo);
    return manejador(modelo);
  };
  console.warn = () => {};
  try {
    return await tarea(llamadas);
  } finally {
    delete process.env.GEMINI_API_KEY;
    delete process.env.MODELO_GEMINI;
    delete process.env.MODELO_RESPALDO;
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
  }
}

test('Gemini: si el modelo principal está saturado, reintenta y usa el de respaldo', () =>
  conGeminiFalso(
    (modelo) => (modelo === 'principal' ? respuestaGemini(503, { error: 'saturado' }) : respuestaGemini(200, gastoGemini)),
    async (llamadas) => {
      const r = await interpretar('gasté 1500 en una gaseosa', HOY);
      assert.equal(r.acciones[0].datos.monto, 1500);
      assert.deepEqual(llamadas, ['principal', 'principal', 'respaldo']);
    },
  ));

test('Gemini: un modelo retirado (404) pasa directo al de respaldo, sin reintentar', () =>
  conGeminiFalso(
    (modelo) => (modelo === 'principal' ? respuestaGemini(404, { error: 'ya no existe' }) : respuestaGemini(200, gastoGemini)),
    async (llamadas) => {
      const r = await interpretar('gasté 1500', HOY);
      assert.equal(r.acciones[0].datos.monto, 1500);
      assert.deepEqual(llamadas, ['principal', 'respaldo']);
    },
  ));

test('Gemini: un error de clave (401) no se reintenta ni cambia de modelo', () =>
  conGeminiFalso(
    () => respuestaGemini(401, { error: 'clave inválida' }),
    async (llamadas) => {
      await assert.rejects(() => interpretar('hola', HOY), /API 401/);
      assert.deepEqual(llamadas, ['principal']);
    },
  ));

test('Gemini: si todo se queda sin responder, el error dice que fue por tiempo', () =>
  conGeminiFalso(
    () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError'); },
    async (llamadas) => {
      await assert.rejects(() => interpretar('hola', HOY), /no respondió a tiempo/);
      assert.deepEqual(llamadas, ['principal', 'principal', 'respaldo']);
    },
  ));

test('Gemini: sin MODELO_RESPALDO solo se usa el principal', async () => {
  await conGeminiFalso(
    () => respuestaGemini(503, { error: 'saturado' }),
    async (llamadas) => {
      process.env.MODELO_RESPALDO = '';
      await assert.rejects(() => interpretar('hola', HOY), /API 503/);
      assert.deepEqual(llamadas, ['principal', 'principal']);
    },
  );
});

test('categoría Mascotas disponible', () => {
  assert.ok(CATEGORIAS.includes('Mascotas'));
  assert.match(reg({ tipo: 'gasto', monto: 2000, categoria: 'Mascotas', descripcion: 'comida de gatos' }, 0, 'masc1'), /Mascotas/);
});

test('saldo: suma todo lo registrado, sin límite de mes', () => {
  const P = 'persona-saldo';
  const m = (tipo, monto, fecha, id) =>
    db.agregarMovimiento({ usuario: P, tipo, monto, categoria: 'Otros', descripcion: '', fecha, mensajeId: `saldo:${id}` });
  const consultar = () => ejecutar({ nombre: 'consultar_saldo', datos: {} }, { usuario: P, hoy: HOY });

  assert.match(consultar(), /Todavía no tienes movimientos/);
  m('ingreso', 100000, '2026-09-10', 1); // mes pasado: cuenta en el saldo, no en "este mes"
  m('gasto', 30000, '2026-10-05', 2);
  const texto = consultar();
  assert.match(texto, /Tu saldo: \$70\.000/);
  assert.match(texto, /Este mes: -\$30\.000/);
  assert.match(ejecutar({ nombre: 'consultar_saldo', datos: {} }, { usuario: 'otra-persona-saldo', hoy: HOY }), /Todavía no tienes movimientos/);
});

test('atajos sin IA para las preguntas más comunes', () => {
  const nombre = (t) => atajoSinIA(t)?.acciones[0].nombre ?? null;
  assert.equal(nombre('Cuánta plata tengo ?'), 'consultar_saldo');
  assert.equal(nombre('cuánto me queda'), 'consultar_saldo');
  assert.equal(nombre('Mi saldo'), 'consultar_saldo');
  assert.equal(nombre('¿cuánto gasté esta semana?'), 'consultar_resumen');
  assert.deepEqual(atajoSinIA('cuánto gasté en comida este mes').acciones[0].datos, { periodo: 'mes', categoria: 'Comida' });
  assert.equal(atajoSinIA('cuanto gaste hoy').acciones[0].datos.periodo, 'hoy');
  assert.equal(nombre('cómo van mis gastos'), 'analizar_gastos');
  assert.equal(nombre('en qué estoy fallando'), 'analizar_gastos');
  assert.equal(nombre('mis últimos movimientos'), 'ultimos_movimientos');
  assert.equal(nombre('mis presupuestos'), 'ver_presupuestos');
  // No debe confundir un registro o un mensaje largo con una pregunta
  assert.equal(nombre('me quedan 20 mil de saldo'), null);
  assert.equal(nombre('compré aceite por 20 mil'), null);
  assert.equal(nombre('cuánto me queda de presupuesto'), null);
  assert.equal(nombre('x'.repeat(200)), null);
  assert.equal(nombre(''), null);
});

test('deudas: anotar, abonar y saber si sigues debiendo o ya pagaste', () => {
  const D = 'persona-deudas';
  const run = (nombre, datos, id) => ejecutar({ nombre, datos }, { usuario: D, hoy: HOY, mensajeId: `deuda:${id}`, indice: 0 });
  const saldo = () => ejecutar({ nombre: 'consultar_saldo', datos: {} }, { usuario: D, hoy: HOY });

  assert.match(run('consultar_deudas', {}, 0), /No tienes deudas anotadas/);
  assert.match(run('consultar_deudas', { persona: 'Juan' }, 0), /No tengo ninguna deuda anotada con Juan/);
  assert.match(run('abonar_deuda', { persona: 'Juan', monto: 5000 }, 0), /No tengo ninguna deuda anotada/);

  // Anotar una deuda no cambia el saldo en pesos
  db.agregarMovimiento({ usuario: D, tipo: 'ingreso', monto: 100000, categoria: 'Salario', descripcion: '', fecha: HOY, mensajeId: 'deuda:ingreso' });
  assert.match(run('registrar_deuda', { persona: 'Juan Pérez', monto: 11000 }, 1), /le debes \$11\.000 a Juan Pérez/);
  assert.match(saldo(), /Tu saldo: \$100\.000/);
  assert.match(saldo(), /Debes en total: \$11\.000/);

  // Ya existe "Juan Pérez": "juan" suma a la misma persona
  assert.match(run('registrar_deuda', { persona: 'juan', monto: 9000, descripcion: 'almuerzo' }, 2), /En total le debes \$20\.000 a Juan Pérez/);

  // Abono parcial: baja la deuda y sale de tu saldo como gasto en Deudas
  const abono = run('abonar_deuda', { persona: 'Juan', monto: 5000 }, 3);
  assert.match(abono, /Abono registrado: \$5\.000 a Juan Pérez/);
  assert.match(abono, /Sigues debiéndole \$15\.000/);
  assert.match(saldo(), /Tu saldo: \$95\.000/);
  assert.match(run('consultar_deudas', { persona: 'JUAN' }, 4), /Sigues debiéndole \$15\.000 a Juan Pérez/);
  assert.match(run('consultar_deudas', {}, 5), /• Juan Pérez: \$15\.000[\s\S]*Total: \$15\.000/);

  // El mismo mensaje no se registra dos veces
  assert.equal(run('abonar_deuda', { persona: 'Juan', monto: 5000 }, 3), null);
  assert.match(run('consultar_deudas', { persona: 'Juan' }, 6), /\$15\.000/);

  // No se puede abonar más de lo que se debe
  assert.match(run('abonar_deuda', { persona: 'Juan', monto: 99000 }, 7), /Solo le debes \$15\.000/);
  assert.match(saldo(), /Tu saldo: \$95\.000/);

  // Pagar todo termina la deuda
  assert.match(run('abonar_deuda', { persona: 'Juan', todo: true }, 8), /Ya pagaste toda la deuda/);
  assert.match(run('consultar_deudas', { persona: 'Juan' }, 9), /Ya pagaste toda la deuda con Juan Pérez/);
  assert.match(run('abonar_deuda', { persona: 'Juan', monto: 1000 }, 10), /Ya pagaste toda la deuda/);
  assert.match(run('consultar_deudas', {}, 11), /No le debes nada a nadie/);
  assert.doesNotMatch(saldo(), /Debes en total/);
  assert.match(saldo(), /Tu saldo: \$80\.000/);

  // Datos inválidos y otra persona
  assert.match(run('registrar_deuda', { persona: '', monto: 1000 }, 12), /Dime a quién le debes/);
  assert.match(run('registrar_deuda', { persona: 'Ana', monto: -5 }, 13), /Dime a quién le debes/);
  assert.match(ejecutar({ nombre: 'consultar_deudas', datos: { persona: 'Juan' } }, { usuario: 'otro-sin-deudas', hoy: HOY }), /No tengo ninguna deuda/);
});

test('deudas: dos personas parecidas piden precisar el nombre', () => {
  const D = 'persona-ambigua';
  const run = (nombre, datos, id) => ejecutar({ nombre, datos }, { usuario: D, hoy: HOY, mensajeId: `amb:${id}`, indice: 0 });
  run('registrar_deuda', { persona: 'Juan Pérez', monto: 1000 }, 1);
  run('registrar_deuda', { persona: 'Juan López', monto: 2000 }, 2);
  assert.match(run('abonar_deuda', { persona: 'Juan', monto: 500 }, 3), /¿A cuál te refieres: Juan López o Juan Pérez/);
  assert.match(run('abonar_deuda', { persona: 'Juan López', monto: 500 }, 4), /Sigues debiéndole \$1\.500/);
});

test('deudas: /deshacer borra la deuda o el abono más reciente', () => {
  const D = 'persona-deshacer-deuda';
  const run = (nombre, datos, id) => ejecutar({ nombre, datos }, { usuario: D, hoy: HOY, mensajeId: `desh:${id}`, indice: 0 });
  const deshacer = () => {
    const pregunta = run('deshacer_ultimo', {}, 'x');
    return { pregunta, resultado: run('confirmar_deshacer', {}, 'y') };
  };
  const debe = () => run('consultar_deudas', { persona: 'Ana' }, 'q');

  db.agregarMovimiento({ usuario: D, tipo: 'gasto', monto: 3000, categoria: 'Comida', descripcion: '', fecha: HOY, mensajeId: 'desh:gasto' });
  run('registrar_deuda', { persona: 'Ana', monto: 10000 }, 1);
  run('abonar_deuda', { persona: 'Ana', monto: 4000 }, 2);
  assert.match(debe(), /Sigues debiéndole \$6\.000/);

  // Lo más reciente es el abono: se borra el abono (y su gasto)
  let r = deshacer();
  assert.match(r.pregunta, /borrar este movimiento[\s\S]*Abono a Ana/);
  assert.match(debe(), /Sigues debiéndole \$10\.000/);

  // Ahora lo más reciente es la deuda (no el gasto de Comida, que es anterior)
  r = deshacer();
  assert.match(r.pregunta, /borrar esta deuda[\s\S]*\$10\.000 a Ana/);
  assert.match(r.resultado, /Borré la deuda confirmada/);
  assert.match(debe(), /No tengo ninguna deuda anotada con Ana/);

  // Y por último el gasto
  r = deshacer();
  assert.match(r.pregunta, /borrar este movimiento[\s\S]*Comida/);
});

test('deudas: una deuda con abonos no se borra si quedaría negativa', () => {
  const D = 'persona-deuda-bloqueada';
  const run = (nombre, datos, id) => ejecutar({ nombre, datos }, { usuario: D, hoy: HOY, mensajeId: `blq:${id}`, indice: 0 });
  run('registrar_deuda', { persona: 'Luis', monto: 10000 }, 1);
  run('abonar_deuda', { persona: 'Luis', monto: 10000 }, 2);
  const fila = db.ultimaDeudaBorrable(D);
  assert.deepEqual(db.borrarDeuda(D, fila.id), { bloqueada: true });
  assert.match(run('consultar_deudas', { persona: 'Luis' }, 3), /Ya pagaste toda la deuda/);
});

test('deudas: comandos y atajos sin IA', () => {
  assert.deepEqual(interpretarComando('/debo 50000 Juan Pérez'), { acciones: [{ nombre: 'registrar_deuda', datos: { persona: 'Juan Pérez', monto: 50000 } }] });
  assert.deepEqual(interpretarComando('/debo 11 mil Ana'), { acciones: [{ nombre: 'registrar_deuda', datos: { persona: 'Ana', monto: 11000 } }] });
  assert.deepEqual(interpretarComando('/abono 20000 Juan'), { acciones: [{ nombre: 'abonar_deuda', datos: { persona: 'Juan', monto: 20000 } }] });
  assert.deepEqual(interpretarComando('/abono todo Juan'), { acciones: [{ nombre: 'abonar_deuda', datos: { persona: 'Juan', todo: true } }] });
  assert.deepEqual(interpretarComando('/deudas'), { acciones: [{ nombre: 'consultar_deudas', datos: {} }] });
  assert.deepEqual(interpretarComando('/deudas Juan'), { acciones: [{ nombre: 'consultar_deudas', datos: { persona: 'Juan' } }] });
  assert.match(interpretarComando('/debo Juan').respuesta, /Usa: \/debo/);
  assert.match(interpretarComando('/abono 5000').respuesta, /Usa: \/abono/);

  assert.deepEqual(atajoSinIA('¿Cuánto debo?'), { acciones: [{ nombre: 'consultar_deudas', datos: {} }] });
  assert.deepEqual(atajoSinIA('cuánto le debo a Juan'), { acciones: [{ nombre: 'consultar_deudas', datos: { persona: 'juan' } }] });
  assert.match(AYUDA, /\/debo/);
});

test('deudas: una base antigua sin la tabla se actualiza sola y conserva sus datos', () => {
  const archivo = path.join(temporal, 'antigua.db');
  const vieja = new DatabaseSync(archivo);
  vieja.exec(`
    CREATE TABLE movimientos (id INTEGER PRIMARY KEY AUTOINCREMENT, usuario TEXT NOT NULL, tipo TEXT NOT NULL, monto INTEGER NOT NULL,
      categoria TEXT NOT NULL, descripcion TEXT NOT NULL DEFAULT '', fecha TEXT NOT NULL, creado TEXT NOT NULL DEFAULT (datetime('now')), mensaje_id TEXT UNIQUE);
    INSERT INTO movimientos (usuario, tipo, monto, categoria, fecha) VALUES ('u', 'gasto', 1234, 'Comida', '2026-10-01');
  `);
  vieja.close();
  const salida = spawnSync(process.execPath, ['--input-type=module', '-e', `
    const db = await import('./db.js');
    db.agregarDeuda({ usuario: 'u', persona: 'Ana', tipo: 'debo', monto: 500, fecha: '2026-10-01' });
    console.log(JSON.stringify({ movs: db.listarMovimientos({ usuario: 'u', limite: 5 }).length, deudas: db.resumenDeudas('u') }));
    db.cerrarBase();
  `], { cwd: import.meta.dirname, env: { ...process.env, DB_ARCHIVO: archivo }, encoding: 'utf8' });
  assert.equal(salida.status, 0, salida.stderr);
  const r = JSON.parse(salida.stdout.trim().split('\n').pop());
  assert.equal(r.movs, 1);
  assert.deepEqual(r.deudas.map((d) => [d.persona, d.saldo]), [['Ana', 500]]);
});

test('/saldo y ayuda', () => {
  assert.deepEqual(interpretarComando('/saldo'), { acciones: [{ nombre: 'consultar_saldo', datos: {} }] });
  assert.match(AYUDA, /\/saldo/);
});

test('API para la página: token, resumen, movimientos y presupuestos', async () => {
  const servidor = crearServidorApi({});
  // La cuenta sale de la sesión web: se abre una con un código enviado "por WhatsApp"
  db.asegurarUsuario(U);
  let codigoEnviado;
  await acceso.solicitarCodigo({ telefono: U, enviar: async (_tel, texto) => { codigoEnviado = texto.match(/\*(\d{6})\*/)[1]; } });
  const { token: sesion } = acceso.verificarCodigo({ telefono: U, codigo: codigoEnviado });
  const solicitar = (url, { method = 'GET', headers = {} } = {}) => {
    const req = { method, url, headers };
    const res = {
      headersSent: false,
      writeHead(status, cabeceras) { this.statusCode = status; this.headers = cabeceras; this.headersSent = true; },
      end(body = '') { this.body = body; },
    };
    servidor.emit('request', req, res);
    return { status: res.statusCode, headers: res.headers, json: res.body ? JSON.parse(res.body) : undefined };
  };
  const con = { headers: { authorization: 'Bearer secreto-de-prueba', 'x-sesion': sesion } };
  const sinSesion = { headers: { authorization: 'Bearer secreto-de-prueba' } };

  assert.equal(solicitar('/api/resumen?mes=2026-10', sinSesion).status, 401); // el token del servidor no basta
  assert.equal(solicitar('/api/resumen?mes=2026-10', { headers: { ...sinSesion.headers, 'x-sesion': 'inventada-'.repeat(5) } }).status, 401);
  assert.equal(solicitar('/api/salud').status, 401);
  assert.equal(solicitar('/api/salud', { headers: { authorization: 'Bearer malo' } }).status, 401);
  assert.equal(solicitar('/api/salud', con).status, 200);

  const resumen = solicitar('/api/resumen?mes=2026-10', con).json;
  assert.equal(resumen.ingresos, 1500000);
  assert.ok(resumen.gastos > 0 && Array.isArray(resumen.porCategoria));
  assert.deepEqual(solicitar('/api/resumen?mes=2026-10&usuario=otra-persona', con).json, resumen);

  const movs = solicitar('/api/movimientos?tipo=gasto&categoria=Ocio', con).json;
  assert.ok(movs.length >= 2 && movs.every((m) => m.categoria === 'Ocio' && m.tipo === 'gasto'));

  assert.equal(solicitar('/api/movimientos?desde=ayer', con).status, 400);
  assert.equal(solicitar('/api/resumen?mes=octubre', con).status, 400);
  assert.equal(solicitar('/api/resumen?mes=0000-01', con).status, 400);
  assert.equal(solicitar('/api/categorias?mes=abc', con).status, 200);
  assert.equal(solicitar('/api/nada', con).status, 404);

  const pagina1 = solicitar('/api/movimientos?limite=1&offset=0', con).json;
  const pagina2 = solicitar('/api/movimientos?limite=1&offset=1', con).json;
  assert.equal(pagina1.length, 1);
  assert.equal(pagina2.length, 1);
  assert.notEqual(pagina1[0].id, pagina2[0].id);
  assert.equal(solicitar('/api/movimientos?offset=-1', con).status, 400);

  const presu = solicitar('/api/presupuestos?mes=2026-10', con).json;
  assert.equal(presu[0].categoria, 'Ocio');

  const preflight = solicitar('/api/resumen', { method: 'OPTIONS' });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers['Access-Control-Allow-Origin'], 'http://localhost:3000');
  assert.equal(solicitar('/api/salud', { method: 'PUT', ...con }).status, 405);
  assert.equal(solicitar('/api/salud', { method: 'POST', ...con }).status, 403); // POST solo en /interno/
  assert.equal(solicitar('/api/salud', { headers: { ...con.headers, origin: 'https://malicioso.example' } }).status, 403);
});
