import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'finbot-seguridad-'));
process.env.DB_ARCHIVO = path.join(carpeta, 'pruebas.db');
process.env.API_TOKEN = 'token-exclusivo-de-pruebas';
const db = await import('./db.js');
const { crearLimitadorPersistente } = await import('./limites-sqlite.js');
const acceso = await import('./acceso.js');
const { ejecutar } = await import('./acciones.js');
const { separarRegistros } = await import('./media.js');
const { leerJsonAcotado } = await import('./http-seguro.js');
const { restaurarRespaldo, crearRespaldo } = await import('./db-admin.js');
const { DatabaseSync } = await import('node:sqlite');
const correr = promisify(execFile);
const worker = async (codigo) => JSON.parse((await correr(process.execPath, ['--input-type=module', '-e', `const db = await import('./db.js'); ${codigo}; db.cerrarBase();`], { cwd: import.meta.dirname, env: { ...process.env } })).stdout.trim().split('\n').pop());
after(() => { db.cerrarBase(); fs.rmSync(carpeta, { recursive: true, force: true }); });
const usuario = '573001119991';
const hoy = '2026-11-11';
const run = (nombre, datos) => ejecutar({ nombre, datos }, { usuario, hoy, mensajeId: `${nombre}:${Math.random()}`, indice: 0 });

test('límite persiste tras reinicio, aísla ámbitos, vence y no guarda IP en claro', async () => {
  const opciones = { ambito: 'reinicio', max: 1, ventanaMs: 60000 };
  const t = Date.now();
  assert.equal(crearLimitadorPersistente(opciones).intentar('1.2.3.4', t).ok, true);
  assert.equal(await worker(`const { crearLimitadorPersistente: c } = await import('./limites-sqlite.js'); console.log(JSON.stringify(c(${JSON.stringify(opciones)}).intentar('1.2.3.4', ${t})))`).then(r => r.ok), false);
  assert.equal(crearLimitadorPersistente({ ...opciones, ambito: 'otro' }).intentar('1.2.3.4', t).ok, true);
  assert.equal(crearLimitadorPersistente(opciones).intentar('1.2.3.4', t + 60000).ok, true);
  assert.equal(db.base().prepare("SELECT COUNT(*) AS n FROM limites_intentos WHERE clave = '1.2.3.4'").get().n, 0);
});
test('dos procesos no pueden exceder el contador compartido', async () => {
  const codigo = `const { crearLimitadorPersistente: c } = await import('./limites-sqlite.js'); const l = c({ambito:'carrera',max:5,ventanaMs:60000}); console.log(JSON.stringify(Array.from({length:10},()=>l.intentar('misma').ok).filter(Boolean).length))`;
  const resultados = await Promise.all([worker(codigo), worker(codigo)]);
  assert.equal(resultados.reduce((a,b) => a+b, 0), 5);
});
test('un código verificado simultáneamente crea una sola sesión', async () => {
  db.asegurarUsuario(usuario);
  let codigo;
  await acceso.solicitarCodigo({ telefono: usuario, ip: 'otp', enviar: async (_, t) => { codigo = t.match(/\*(\d{6})\*/)[1]; } });
  const script = `const a = await import('./acceso.js'); console.log(JSON.stringify(a.verificarCodigo({telefono:'${usuario}',codigo:'${codigo}',ip:'otp'}).ok))`;
  const resultados = await Promise.all([worker(script), worker(script)]);
  assert.equal(resultados.filter(Boolean).length, 1);
});
test('verificaciones incorrectas persisten y no se evaden cambiando IP', async () => {
  const tel = '573001119992'; db.asegurarUsuario(tel);
  let codigo;
  await acceso.solicitarCodigo({ telefono: tel, ip: 'wrong', enviar: async (_, t) => { codigo = t.match(/\*(\d{6})\*/)[1]; } });
  const incorrecto = codigo === '000000' ? '000001' : '000000';
  for (let i=0;i<5;i++) assert.equal(acceso.verificarCodigo({ telefono: tel, codigo: incorrecto, ip: `wrong-${i}` }).ok, false);
  assert.equal(await worker(`const a = await import('./acceso.js'); console.log(JSON.stringify(a.verificarCodigo({telefono:'${tel}',codigo:'${codigo}',ip:'nueva'}).ok))`), false);
});
test('abono sin monto no paga toda una deuda; solo todo=true lo permite', () => {
  run('registrar_deuda', { persona: 'Ana', monto: 10000 });
  assert.match(run('abonar_deuda', { persona: 'Ana' }), /monto/);
  assert.equal(db.resumenDeudas(usuario)[0].saldo, 10000);
  run('abonar_deuda', { persona: 'Ana', todo: true });
  assert.equal(db.resumenDeudas(usuario)[0].saldo, 0);
});
test('la capa de datos impide editar y eliminar movimientos ligados', () => {
  run('registrar_prestamo', { persona: 'Juan', monto: 10000 });
  const id = db.listarMovimientos({ usuario }).find(m => m.origen === 'prestamo').id;
  assert.equal(db.editarMovimiento(usuario, id, { monto: 1 }), null);
  assert.equal(db.eliminarMovimiento(usuario, id), null);
  assert.equal(db.obtenerMovimiento(usuario, id).monto, 10000);
  run('registrar_pago_recibido', { persona: 'Juan', monto: 5000 });
  assert.equal(db.borrarMovimiento(usuario, id), null);
  assert.throws(() => db.borrarDatos(usuario, 'gastos'), { code: 'INTEGRIDAD_FINANCIERA' });
  assert.equal(db.resumenPrestamos(usuario).find(p => p.persona === 'Juan').saldo, 5000);
});
test('borrado masivo guarda snapshot de cada registro y conserva cuentas ajenas', () => {
  const otro = '573001119993';
  const id = db.agregarMovimiento({ usuario: otro, tipo: 'gasto', monto: 100, categoria: 'Otros', fecha: hoy });
  db.borrarDatos(usuario, 'movimientos');
  assert.ok(db.obtenerMovimiento(otro, id));
  const snapshot = db.listarAuditoria(usuario, 200).find(a => a.accion === 'eliminar_registro' && a.entidad === 'movimiento');
  assert.ok(JSON.parse(snapshot.detalle).monto > 0);
});
test('error a mitad de una acción financiera revierte movimiento y auditoría', () => {
  db.base().exec("CREATE TRIGGER fallo_prestamo BEFORE INSERT ON prestamos BEGIN SELECT RAISE(ABORT, 'fallo simulado'); END;");
  const antes = db.listarMovimientos({ usuario }).length;
  assert.throws(() => run('registrar_prestamo', { persona: 'Error', monto: 1000 }), /fallo simulado/);
  assert.equal(db.listarMovimientos({ usuario }).length, antes);
  db.base().exec('DROP TRIGGER fallo_prestamo');
});
test('rechaza transacciones asíncronas para no confirmar operaciones parciales', () => {
  assert.throws(() => db.enTransaccion(() => Promise.resolve()), /síncrona/);
});
test('audio no puede ejecutar borrados, abonos ni confirmaciones sin texto autorizado', () => {
  const r = separarRegistros(['confirmar_borrado','abonar_deuda','registrar_prestamo','crear_recurrente','confirmar_pendiente'].map(nombre => ({ nombre, datos: {} })), hoy);
  assert.equal(r.resto.length, 0); assert.equal(r.items.length, 0); assert.equal(r.descartados, 5);
});
test('respuestas IA demasiado grandes o JSON mal formado se rechazan', async () => {
  await assert.rejects(leerJsonAcotado(new Response('x'.repeat(100)), 50), /grande/);
  await assert.rejects(leerJsonAcotado(new Response('{')));
  assert.deepEqual(await leerJsonAcotado(new Response('{"ok":true}')), { ok: true });
});
test('respaldo y restauración conservan sesiones, auditoría y límites persistentes', () => {
  const copia = path.join(carpeta, 'copia.db'); const restaurada = path.join(carpeta, 'restaurada.db');
  crearRespaldo(process.env.DB_ARCHIVO, copia); restaurarRespaldo(copia, restaurada);
  const restored = new DatabaseSync(restaurada, { readOnly: true });
  try {
    for (const tabla of ['movimientos','auditoria','sesiones_web','limites_intentos']) assert.equal(restored.prepare(`SELECT COUNT(*) AS n FROM ${tabla}`).get().n, db.base().prepare(`SELECT COUNT(*) AS n FROM ${tabla}`).get().n);
    assert.equal(restored.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  } finally { restored.close(); }
});

test('descarga multimedia corta por tamaño y tiempo sin confiar en metadatos', async () => {
  const { Readable } = await import('node:stream');
  const { acumularMedia } = await import('./recursos.js');
  assert.equal((await acumularMedia(Readable.from([Buffer.from('abc')]), 5)).toString(), 'abc');
  await assert.rejects(acumularMedia(Readable.from([Buffer.alloc(10)]), 5), /grande/);
  const lento = new Readable({ read() {} });
  await assert.rejects(acumularMedia(lento, 5, 20), /tiempo/);
});

test('registro público requiere opt-in exacto, también en producción', async () => {
  const { registroAbierto } = await import('./politicas.js');
  for (const valor of [undefined, '', '0', 'true', 'yes', '01']) assert.equal(registroAbierto({ NODE_ENV: 'production', REGISTRO_ABIERTO: valor }), false);
  assert.equal(registroAbierto({ NODE_ENV: 'production', REGISTRO_ABIERTO: '1' }), true);
});
