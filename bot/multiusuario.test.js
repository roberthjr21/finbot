// Pruebas de varias personas usando el mismo bot y la misma web.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const temporal = fs.mkdtempSync(path.join(os.tmpdir(), 'finbot-multi-'));
process.env.DB_ARCHIVO = path.join(temporal, 'multi.db');
process.env.API_TOKEN = 'secreto-de-prueba';
process.env.API_PUERTO = '0';
for (const v of ['GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'SECRETO_SESION']) delete process.env[v];

const db = await import('./db.js');
const { ejecutar } = await import('./acciones.js');
const acceso = await import('./acceso.js');
const { crearServidorApi } = await import('./api.js');
const { crearLimitador } = await import('./limites.js');
const { identificarRemitente, esChatIndividual } = await import('./identidad.js');

after(() => {
  db.cerrarBase();
  fs.rmSync(temporal, { recursive: true, force: true });
});

const A = '573001110001';
const B = '573002220002';
const HOY = '2026-10-31';
const run = (usuario, nombre, datos = {}, id = `${nombre}-${Math.random()}`) =>
  ejecutar({ nombre, datos }, { usuario, hoy: HOY, mensajeId: id, indice: 0 });
const mov = (usuario, tipo, monto, categoria = 'Otros') =>
  run(usuario, 'registrar_movimiento', { tipo, monto, categoria, descripcion: 'prueba' });

// Pide un código y lo "lee" del mensaje de WhatsApp que se habría enviado
async function pedirCodigo(telefono, opciones = {}) {
  const enviados = [];
  const r = await acceso.solicitarCodigo({ telefono, enviar: async (tel, texto) => enviados.push({ tel, texto }), ...opciones });
  const codigo = enviados[0]?.texto.match(/\*(\d{6})\*/)?.[1];
  return { r, enviados, codigo };
}
// Reloj simulado que siempre avanza, para no chocar con la espera mínima entre códigos
let reloj = acceso.ahoraS() + 100000;
async function iniciarSesion(telefono) {
  acceso.reiniciarLimites();
  const ahora = (reloj += 1000);
  const { codigo } = await pedirCodigo(telefono, { ahora });
  return acceso.verificarCodigo({ telefono, codigo, ahora }).token;
}

test('1-3. cuentas nuevas: se crean una sola vez, sin movimientos y con saldo $0', () => {
  const a = db.asegurarUsuario(A);
  assert.equal(a.nuevo, true);
  assert.equal(db.listarMovimientos({ usuario: A }).length, 0);
  assert.equal(db.resumen(A, '0001-01-01', HOY).balance, 0);
  assert.match(run(A, 'consultar_saldo'), /Todavía no tienes movimientos/);

  const otra = db.asegurarUsuario(A); // A vuelve a escribir
  assert.equal(otra.nuevo, false);
  assert.equal(otra.id, a.id);

  const b = db.asegurarUsuario(B);
  assert.equal(b.nuevo, true);
  assert.notEqual(b.id, a.id);
  assert.equal(db.resumen(B, '0001-01-01', HOY).balance, 0);
});

test('4-6. los saldos y movimientos de cada persona son independientes', () => {
  mov(A, 'ingreso', 500000, 'Salario');
  mov(A, 'gasto', 30000, 'Comida');
  assert.match(run(A, 'consultar_saldo'), /Tienes \$470\.000/);
  assert.match(run(B, 'consultar_saldo'), /Todavía no tienes movimientos/);
  assert.equal(db.listarMovimientos({ usuario: B }).length, 0);

  mov(B, 'ingreso', 90000, 'Ventas');
  assert.match(run(B, 'consultar_saldo'), /Tienes \$90\.000/);
  assert.match(run(A, 'consultar_saldo'), /Tienes \$470\.000/); // A no cambió
  assert.equal(db.listarMovimientos({ usuario: A }).length, 2);
  assert.doesNotMatch(run(B, 'ultimos_movimientos'), /Comida|500\.000/);
});

test('7. presupuestos y deudas con el mismo nombre no se mezclan', () => {
  run(A, 'fijar_presupuesto', { categoria: 'Comida', limite_mensual: 100000 });
  run(B, 'fijar_presupuesto', { categoria: 'Comida', limite_mensual: 300000 });
  assert.match(run(A, 'ver_presupuestos'), /de \$100\.000/);
  assert.match(run(B, 'ver_presupuestos'), /de \$300\.000/);

  run(A, 'registrar_deuda', { persona: 'Juan', monto: 50000 });
  assert.match(run(B, 'consultar_deudas', { persona: 'Juan' }), /No tengo ninguna deuda anotada con Juan/);
  run(B, 'registrar_deuda', { persona: 'Juan', monto: 7000 });
  assert.match(run(A, 'abonar_deuda', { persona: 'Juan', monto: 20000 }), /Sigues debiéndole \$30\.000/);
  assert.match(run(B, 'consultar_deudas', { persona: 'Juan' }), /Sigues debiéndole \$7\.000/);
  assert.match(run(B, 'abonar_deuda', { persona: 'Juan', monto: 20000 }), /Solo le debes \$7\.000/);
  // el abono de A bajó el saldo de A, no el de B
  assert.match(run(A, 'consultar_saldo'), /Tienes \$450\.000/);
  assert.match(run(B, 'consultar_saldo'), /Tienes \$90\.000/);
});

test('8. un ID de otra persona no se puede ver, borrar ni deshacer', () => {
  const idA = db.listarMovimientos({ usuario: A })[0].id;
  assert.equal(db.borrarMovimiento(B, idA), null);
  assert.equal(db.listarMovimientos({ usuario: A }).some((m) => m.id === idA), true);

  const deudaA = db.ultimaDeudaBorrable(A);
  assert.ok(deudaA);
  assert.equal(db.borrarDeuda(B, deudaA.id), null);

  // /deshacer de B solo ve lo de B
  const pregunta = run(B, 'deshacer_ultimo');
  assert.doesNotMatch(pregunta, /Comida|Juan.*50/);
  assert.match(run(B, 'confirmar_deshacer'), /Borré/);
  assert.equal(db.listarMovimientos({ usuario: A }).length, 3); // 2 de A + el abono de A a Juan
  // confirmar sin haber pedido: no borra nada de nadie
  assert.match(run('573009990009', 'confirmar_deshacer'), /No hay un borrado pendiente/);
});

test('9-10. el código llega solo al WhatsApp de su dueño y no sirve si es incorrecto, vencido o repetido', async () => {
  acceso.reiniciarLimites();
  const { enviados, codigo } = await pedirCodigo(A);
  assert.equal(enviados.length, 1);
  assert.equal(enviados[0].tel, A);
  assert.match(codigo, /^\d{6}$/);

  // El código de A no sirve para B
  assert.equal(acceso.verificarCodigo({ telefono: B, codigo }).ok, false);
  // Código incorrecto
  const malo = codigo === '000000' ? '111111' : '000000';
  assert.equal(acceso.verificarCodigo({ telefono: A, codigo: malo }).ok, false);
  // Formato inválido
  assert.equal(acceso.verificarCodigo({ telefono: A, codigo: '12' }).ok, false);
  // Correcto una vez; la segunda vez ya no sirve
  const bueno = acceso.verificarCodigo({ telefono: A, codigo });
  assert.equal(bueno.ok, true);
  assert.ok(bueno.token.length >= 40);
  assert.equal(acceso.verificarCodigo({ telefono: A, codigo }).ok, false);

  // Vencido (más de 5 minutos)
  acceso.reiniciarLimites();
  const v = await pedirCodigo(A, { ahora: acceso.ahoraS() + 1000 });
  assert.equal(acceso.verificarCodigo({ telefono: A, codigo: v.codigo, ahora: acceso.ahoraS() + 1000 + 301 }).ok, false);

  // Demasiados intentos: tras 5 fallos, ni el código correcto sirve
  acceso.reiniciarLimites();
  const t = await pedirCodigo(A, { ahora: acceso.ahoraS() + 5000 });
  const ahora = acceso.ahoraS() + 5000;
  const incorrecto = t.codigo === '999999' ? '888888' : '999999';
  for (let i = 0; i < 5; i++) assert.equal(acceso.verificarCodigo({ telefono: A, codigo: incorrecto, ahora }).ok, false);
  assert.equal(acceso.verificarCodigo({ telefono: A, codigo: t.codigo, ahora }).ok, false);

  // Un código nuevo invalida el anterior
  acceso.reiniciarLimites();
  const primero = await pedirCodigo(A, { ahora: acceso.ahoraS() + 9000 });
  acceso.reiniciarLimites();
  const segundo = await pedirCodigo(A, { ahora: acceso.ahoraS() + 9100 });
  if (primero.codigo !== segundo.codigo) {
    assert.equal(acceso.verificarCodigo({ telefono: A, codigo: primero.codigo, ahora: acceso.ahoraS() + 9100 }).ok, false);
  }
  assert.equal(acceso.verificarCodigo({ telefono: A, codigo: segundo.codigo, ahora: acceso.ahoraS() + 9100 }).ok, true);
});

test('9. la base no guarda el código en texto plano y no se revela si el número tiene cuenta', async () => {
  acceso.reiniciarLimites();
  const { codigo } = await pedirCodigo(B, { ahora: acceso.ahoraS() + 20000 });
  const crudo = new DatabaseSync(process.env.DB_ARCHIVO, { readOnly: true });
  const filas = crudo.prepare('SELECT hash FROM codigos_login').all();
  crudo.close();
  assert.ok(filas.length > 0 && filas.every((f) => f.hash !== codigo && /^[0-9a-f]{64}$/.test(f.hash)));

  // Número sin cuenta: misma respuesta y no se envía nada
  acceso.reiniciarLimites();
  const desconocido = await pedirCodigo('573007770007');
  assert.deepEqual(desconocido.r, { ok: true });
  assert.equal(desconocido.enviados.length, 0);
  // Formato inválido sí se informa (no depende de la cuenta)
  assert.deepEqual((await pedirCodigo('abc')).r, { ok: false, motivo: 'formato' });
});

test('límite de solicitudes de código por número y por IP', async () => {
  acceso.reiniciarLimites();
  assert.equal((await pedirCodigo(A)).r.ok, true);
  const segunda = await pedirCodigo(A);
  assert.deepEqual(segunda.r, { ok: false, motivo: 'espera' }); // sin esperar un minuto
  assert.equal(segunda.enviados.length, 0);
  acceso.reiniciarLimites();
  for (let i = 0; i < 15; i++) await acceso.solicitarCodigo({ telefono: `57300000${String(i).padStart(4, '0')}`, ip: '9.9.9.9', enviar: async () => {} });
  assert.equal((await acceso.solicitarCodigo({ telefono: '573000009999', ip: '9.9.9.9', enviar: async () => {} })).motivo, 'espera');
});

test('11. sesiones: cada una es de su dueño, se cierran y un bloqueo las revoca', async () => {
  const tokenA = await iniciarSesion(A);
  const tokenB = await iniciarSesion(B);
  assert.equal(acceso.validarSesion(tokenA).telefono, A);
  assert.equal(acceso.validarSesion(tokenB).telefono, B);
  assert.equal(acceso.validarSesion('x'.repeat(43)), null);

  assert.equal(acceso.cerrarSesion(tokenA), true);
  assert.equal(acceso.validarSesion(tokenA), null); // cerrar sesión la invalida
  assert.equal(acceso.validarSesion(tokenB).telefono, B); // la de B sigue

  assert.equal(acceso.validarSesion(tokenB, acceso.ahoraS() + 10 * 24 * 3600), null); // vence a los 7 días

  db.cambiarEstadoUsuario(B, 'bloqueado');
  assert.equal(acceso.validarSesion(tokenB), null);
  assert.equal((await pedirCodigo(B, { ahora: acceso.ahoraS() + 99999 })).enviados.length, 0);
  db.cambiarEstadoUsuario(B, 'activo');
});

test('API: la cuenta sale de la sesión; una sesión no ve datos de otra y las rutas internas están protegidas', async () => {
  const enviados = [];
  const servidor = crearServidorApi({ enviar: async (tel, texto) => enviados.push({ tel, texto }) });
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const pedir = (ruta, { metodo = 'GET', sesion, cuerpo, token = 'secreto-de-prueba', extra = {} } = {}) =>
    fetch(base + ruta, {
      method: metodo,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(sesion ? { 'x-sesion': sesion } : {}), 'content-type': 'application/json', ...extra },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
  try {
    acceso.reiniciarLimites();
    const tokenA = await iniciarSesion(A);
    const tokenB = await iniciarSesion(B);

    const saldoA = await pedir('/api/saldo', { sesion: tokenA });
    const saldoB = await pedir('/api/saldo', { sesion: tokenB });
    assert.equal(saldoA.json.balance, 450000);
    assert.equal(saldoB.json.balance, 90000);
    // Intentar elegir otra cuenta por la URL no funciona
    assert.equal((await pedir(`/api/saldo?usuario=${B}&telefono=${B}`, { sesion: tokenA })).json.balance, 450000);
    assert.equal((await pedir('/api/yo', { sesion: tokenA })).json.telefono, '••••••0001');
    assert.equal((await pedir('/api/movimientos', { sesion: tokenB })).json.some((m) => m.categoria === 'Comida'), false);
    const deudasA = (await pedir('/api/deudas', { sesion: tokenA })).json;
    const deudasB = (await pedir('/api/deudas', { sesion: tokenB })).json;
    assert.equal(deudasA.total, 30000);
    assert.equal(deudasB.total, 0);
    assert.deepEqual(deudasA.personas.map((p) => p.persona), ['Juan']);

    // Sin sesión o con el token del servidor solamente: no hay datos
    assert.equal((await pedir('/api/saldo')).status, 401);
    assert.equal((await pedir('/api/saldo', { sesion: tokenA, token: 'malo' })).status, 401);
    await pedir('/interno/salir', { metodo: 'POST', cuerpo: { token: tokenA } });
    assert.equal((await pedir('/api/saldo', { sesion: tokenA })).status, 401);

    // Rutas internas: exigen el token del servidor, y no se aceptan desde un navegador (Origin)
    assert.equal((await pedir('/interno/codigo', { metodo: 'POST', token: null, cuerpo: { telefono: A } })).status, 401);
    assert.equal((await pedir('/interno/codigo', { metodo: 'POST', cuerpo: { telefono: A }, extra: { origin: 'http://localhost:3000' } })).status, 403);
    assert.equal((await pedir('/api/otra', { metodo: 'POST', cuerpo: {} })).status, 403);

    // Solicitar código por la API (con una cuenta nueva C): respuesta idéntica exista o no la cuenta,
    // y solo se envía a la cuenta que existe
    const C = '573003330003';
    db.asegurarUsuario(C);
    acceso.reiniciarLimites();
    const real = await pedir('/interno/codigo', { metodo: 'POST', cuerpo: { telefono: C } });
    const falsa = await pedir('/interno/codigo', { metodo: 'POST', cuerpo: { telefono: '573005550005' } });
    assert.deepEqual(real, falsa);
    assert.deepEqual(enviados.map((e) => e.tel), [C]);
    const codigo = enviados[0].texto.match(/\*(\d{6})\*/)[1];
    const mal = await pedir('/interno/verificar', { metodo: 'POST', cuerpo: { telefono: B, codigo } });
    assert.deepEqual(mal, { status: 401, json: { ok: false } });
    const bien = await pedir('/interno/verificar', { metodo: 'POST', cuerpo: { telefono: C, codigo } });
    assert.equal(bien.status, 200);
    // La cuenta nueva ve saldo $0 y nada de las demás
    assert.deepEqual((await pedir('/api/saldo', { sesion: bien.json.token })).json, { ingresos: 0, gastos: 0, balance: 0 });
    assert.deepEqual((await pedir('/api/movimientos', { sesion: bien.json.token })).json, []);
    assert.deepEqual((await pedir('/api/deudas', { sesion: bien.json.token })).json, { total: 0, personas: [] });
  } finally {
    servidor.closeAllConnections?.();
    servidor.close();
  }
});

test('13. grupos, estados, difusión y canales no crean cuentas; los teléfonos y LID se identifican bien', async () => {
  for (const jid of ['120363000000000000@g.us', 'status@broadcast', '573001112222@broadcast', '12345@newsletter', '', undefined]) {
    assert.equal(esChatIndividual(jid), false, String(jid));
  }
  assert.equal(esChatIndividual('573001112222@s.whatsapp.net'), true);
  assert.equal(esChatIndividual('99887766554433@lid'), true);

  const sinMapa = {};
  const id = (key, sock = sinMapa) => identificarRemitente(sock, { key });
  assert.equal(await id({ remoteJid: '573001112222@s.whatsapp.net' }), '573001112222');
  assert.equal(await id({ remoteJid: '573001112222:7@s.whatsapp.net' }), '573001112222'); // con dispositivo
  assert.equal(await id({ remoteJid: '99887766554433@lid', remoteJidAlt: '573004445555@s.whatsapp.net' }), '573004445555');
  assert.equal(await id({ remoteJid: '99887766554433@lid' }), null); // LID sin traducción: no se inventa un teléfono
  const conMapa = { signalRepository: { lidMapping: { getPNForLID: async () => '573006667777@s.whatsapp.net' } } };
  assert.equal(await id({ remoteJid: '99887766554433@lid' }, conMapa), '573006667777');
  assert.equal(await id({ remoteJid: '123@s.whatsapp.net' }), null); // número demasiado corto
  assert.equal(await id({ remoteJid: '5730011122223333444@s.whatsapp.net' }), null); // demasiado largo
  assert.equal(await id({ remoteJid: '12345@newsletter' }), null);
});

test('idempotencia: dos personas pueden recibir un mensaje con el mismo id, y las marcas antiguas siguen valiendo', () => {
  db.marcarProcesado(`${A}:ABC123`);
  assert.equal(db.yaProcesadoDe(A, 'ABC123'), true);
  assert.equal(db.yaProcesadoDe(B, 'ABC123'), false); // mismo id de mensaje, otra persona: se procesa
  db.marcarProcesado('MENSAJE-ANTIGUO'); // marca de antes de la migración (sin usuario)
  assert.equal(db.yaProcesadoDe(A, 'MENSAJE-ANTIGUO'), true);
  // y el registro financiero también es por persona
  assert.notEqual(run(A, 'registrar_movimiento', { tipo: 'gasto', monto: 1000, categoria: 'Otros', descripcion: '' }, `${A}:ZZ`), null);
  assert.notEqual(run(B, 'registrar_movimiento', { tipo: 'gasto', monto: 1000, categoria: 'Otros', descripcion: '' }, `${B}:ZZ`), null);
});

test('uso diario y limitador de ventana', () => {
  assert.deepEqual(db.usoDelDia(A, '2026-01-01'), { mensajes: 0, ia: 0 });
  db.sumarUso(A, '2026-01-01', { mensajes: 1 });
  assert.deepEqual(db.sumarUso(A, '2026-01-01', { mensajes: 1, ia: 1 }), { mensajes: 2, ia: 1 });
  assert.deepEqual(db.usoDelDia(B, '2026-01-01'), { mensajes: 0, ia: 0 });

  const l = crearLimitador({ max: 2, ventanaMs: 1000 });
  assert.equal(l.intentar('x', 0).ok, true);
  assert.equal(l.intentar('x', 10).ok, true);
  assert.equal(l.intentar('x', 20).ok, false);
  assert.equal(l.intentar('y', 20).ok, true);
  assert.equal(l.intentar('x', 1100).ok, true);
});

test('12. migración: una base anterior se respalda, conserva sus datos y asigna cada dato a su dueño real', () => {
  const archivo = path.join(temporal, 'anterior.db');
  const vieja = new DatabaseSync(archivo);
  vieja.exec(`
    CREATE TABLE movimientos (id INTEGER PRIMARY KEY AUTOINCREMENT, usuario TEXT NOT NULL, tipo TEXT NOT NULL, monto INTEGER NOT NULL,
      categoria TEXT NOT NULL, descripcion TEXT NOT NULL DEFAULT '', fecha TEXT NOT NULL, creado TEXT NOT NULL DEFAULT (datetime('now')), mensaje_id TEXT UNIQUE);
    CREATE TABLE presupuestos (usuario TEXT NOT NULL, categoria TEXT NOT NULL, limite INTEGER NOT NULL, PRIMARY KEY (usuario, categoria));
    CREATE TABLE procesados (id TEXT PRIMARY KEY, creado TEXT NOT NULL DEFAULT (datetime('now')));
    INSERT INTO movimientos (usuario, tipo, monto, categoria, fecha) VALUES ('573001110001', 'ingreso', 1000000, 'Salario', '2026-10-01');
    INSERT INTO movimientos (usuario, tipo, monto, categoria, fecha) VALUES ('573001110001', 'gasto', 25000, 'Comida', '2026-10-02');
    INSERT INTO movimientos (usuario, tipo, monto, categoria, fecha) VALUES ('573002220002', 'gasto', 9000, 'Ocio', '2026-10-03');
    INSERT INTO presupuestos VALUES ('573002220002', 'Ocio', 50000);
    INSERT INTO procesados (id) VALUES ('viejo-1');
  `);
  vieja.close();

  const guion = `
    const db = await import('./db.js');
    const dueños = (t) => db.listarMovimientos({ usuario: t, limite: 50 }).map((m) => m.monto);
    console.log(JSON.stringify({
      a: dueños('573001110001'), b: dueños('573002220002'),
      saldoA: db.resumen('573001110001', '0001-01-01', '2026-12-31').balance,
      usuarios: [db.usuarioPorTelefono('573001110001')?.telefono, db.usuarioPorTelefono('573002220002')?.telefono, db.usuarioPorTelefono('573009990009')],
      viejo: db.yaProcesadoDe('573001110001', 'viejo-1'),
    }));
    db.cerrarBase();
  `;
  const ejecutarBot = () => spawnSync(process.execPath, ['--input-type=module', '-e', guion], {
    cwd: import.meta.dirname, env: { ...process.env, DB_ARCHIVO: archivo }, encoding: 'utf8',
  });
  const copias = () => fs.readdirSync(temporal).filter((f) => f.startsWith('anterior.db.antes-multiusuario-'));

  const primera = ejecutarBot();
  assert.equal(primera.status, 0, primera.stderr);
  const r = JSON.parse(primera.stdout.trim().split('\n').pop());
  assert.deepEqual(r.a.sort((x, y) => x - y), [25000, 1000000]);
  assert.deepEqual(r.b, [9000]);
  assert.equal(r.saldoA, 975000);
  assert.deepEqual(r.usuarios, ['573001110001', '573002220002', undefined].map((v) => v ?? null));
  assert.equal(r.viejo, true);

  // Se creó una copia verificada con los datos originales
  assert.equal(copias().length, 1);
  const copia = new DatabaseSync(path.join(temporal, copias()[0]), { readOnly: true });
  assert.equal(copia.prepare('SELECT COUNT(*) AS n FROM movimientos').get().n, 3);
  assert.equal(copia.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'usuarios'").get().n, 0);
  copia.close();

  // Una segunda ejecución no vuelve a migrar ni cambia nada
  const segunda = ejecutarBot();
  assert.equal(segunda.status, 0, segunda.stderr);
  assert.deepEqual(JSON.parse(segunda.stdout.trim().split('\n').pop()), r);
  assert.equal(copias().length, 1);
});
