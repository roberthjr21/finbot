// Fase 2: recordatorios, recurrentes, metas, contexto y alertas
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const temporal = fs.mkdtempSync(path.join(os.tmpdir(), 'finbot-fase2-'));
process.env.DB_ARCHIVO = path.join(temporal, 'finanzas.db');
for (const v of ['GEMINI_API_KEY', 'ANTHROPIC_API_KEY']) delete process.env[v];

const db = await import('./db.js');
const rec = await import('./recordatorios.js');
const recu = await import('./recurrentes.js');
const metas = await import('./metas.js');
const ctx = await import('./contexto.js');
const alertas = await import('./alertas.js');

after(() => { db.cerrarBase(); fs.rmSync(temporal, { recursive: true, force: true }); });

const A = '573001110001';
const B = '573001110002';
const HOY = '2026-11-10';

// ---------- Recordatorios ----------
test('recordatorios: crear, listar, editar, completar y cancelar, aislados por usuario', () => {
  const r = rec.crear({ usuario: A, texto: 'Pagar arriendo', monto: 800000, vence: '2026-11-15', hora: '08:00' }, { hoy: HOY });
  assert.ok(r.ok && r.id);
  assert.equal(rec.listar(A).length, 1);
  assert.equal(rec.listar(B).length, 0);
  assert.equal(rec.obtener(B, r.id), null);
  assert.equal(rec.cancelar(B, r.id), false); // otra cuenta no puede tocarlo
  assert.ok(rec.editar(A, r.id, { monto: 850000 }, { hoy: HOY }).ok);
  assert.equal(rec.obtener(A, r.id).monto, 850000);
  assert.equal(rec.completar(A, r.id), true);
  assert.equal(rec.listar(A).length, 0);
  assert.equal(rec.cancelar(A, r.id), false);
});

test('recordatorios: valida fecha pasada, texto vacío y hora inválida; idempotencia por mensaje', () => {
  assert.equal(rec.crear({ usuario: A, texto: 'x', vence: '2026-11-15' }, { hoy: HOY }).ok, false);
  assert.equal(rec.crear({ usuario: A, texto: 'Pagar luz', vence: '2026-11-01' }, { hoy: HOY }).ok, false);
  assert.equal(rec.crear({ usuario: A, texto: 'Pagar luz', vence: '2026-11-15', hora: '25:00' }, { hoy: HOY }).ok, false);
  const a = rec.crear({ usuario: A, texto: 'Pagar agua', vence: '2026-11-20', mensajeId: 'm1' }, { hoy: HOY });
  const b = rec.crear({ usuario: A, texto: 'Pagar agua', vence: '2026-11-20', mensajeId: 'm1' }, { hoy: HOY });
  assert.ok(a.id && b.duplicado);
});

test('recordatorios: vencidos se envían una sola vez, también si el bot estuvo apagado', () => {
  const u = '573001110003';
  const pasado = rec.crear({ usuario: u, texto: 'Pagar tarjeta', vence: '2026-11-10', hora: '09:00' }, { hoy: HOY }).id;
  const futuro = rec.crear({ usuario: u, texto: 'Pagar internet', vence: '2026-11-30' }, { hoy: HOY }).id;
  // 10 nov 09:30 Bogotá = 14:30 UTC
  const ahora = new Date('2026-11-10T14:30:00Z');
  const lista = rec.vencidos(ahora).filter((x) => x.usuario === u);
  assert.deepEqual(lista.map((x) => x.id), [pasado]);
  assert.equal(rec.marcarEnviado(pasado, ahora), true);
  assert.equal(rec.marcarEnviado(pasado, ahora), false); // no se envía dos veces
  assert.equal(rec.vencidos(ahora).filter((x) => x.usuario === u).length, 0);
  // Reinicio dos días después: el futuro ya venció y se recupera
  const tarde = new Date('2026-12-01T15:00:00Z');
  assert.deepEqual(rec.vencidos(tarde).filter((x) => x.usuario === u).map((x) => x.id), [futuro]);
  // Un recordatorio enviado se puede completar
  assert.equal(rec.completar(u, pasado), true);
});

// ---------- Recurrentes ----------
test('recurrentes: siguiente fecha en cada frecuencia y fin de mes', () => {
  assert.equal(recu.siguienteFecha('2026-11-10', 'diaria'), '2026-11-11');
  assert.equal(recu.siguienteFecha('2026-11-10', 'semanal'), '2026-11-17');
  assert.equal(recu.siguienteFecha('2026-11-10', 'quincenal'), '2026-11-25');
  assert.equal(recu.siguienteFecha('2026-01-31', 'mensual', 31), '2026-02-28');
  assert.equal(recu.siguienteFecha('2026-02-28', 'mensual', 31), '2026-03-31');
  assert.equal(recu.siguienteFecha('2026-12-15', 'mensual', 15), '2027-01-15');
});

test('recurrentes: ejecuta lo atrasado una vez, no duplica y programado ≠ ejecutado', () => {
  const u = '573001110010';
  const r = recu.crear({ usuario: u, tipo: 'gasto', monto: 30000, categoria: 'Servicios', descripcion: 'Netflix', frecuencia: 'semanal', inicio: HOY, mensajeId: 'rc1' }, { hoy: HOY });
  assert.ok(r.ok);
  assert.equal(db.listarMovimientos({ usuario: u }).length, 0, 'crearla no registra nada: solo programa');
  // Bot apagado 15 días: al volver se ponen al día 3 fechas (10, 17 y 24 de nov)
  const hechos = recu.ejecutarPendientes({ hoy: '2026-11-25' }).filter((h) => h.usuario === u);
  assert.deepEqual(hechos.map((h) => h.fecha), ['2026-11-10', '2026-11-17', '2026-11-24']);
  assert.equal(db.listarMovimientos({ usuario: u }).length, 3);
  assert.equal(recu.obtener(u, r.id).proxima, '2026-12-01');
  // Repetir (reinicio, segundo ciclo): nada nuevo
  assert.equal(recu.ejecutarPendientes({ hoy: '2026-11-25' }).filter((h) => h.usuario === u).length, 0);
  assert.equal(db.listarMovimientos({ usuario: u }).length, 3);
  // Si por un fallo la proxima quedó atrasada, la clave única impide duplicar el movimiento
  db.base().prepare('UPDATE recurrentes SET proxima = ? WHERE id = ?').run('2026-11-17', r.id);
  recu.ejecutarPendientes({ hoy: '2026-11-25' });
  assert.equal(db.listarMovimientos({ usuario: u }).length, 3);
  assert.equal(recu.obtener(u, r.id).proxima, '2026-12-01');
});

test('recurrentes: pausar no ejecuta, reactivar no recupera lo de la pausa, eliminar conserva historial', () => {
  const u = '573001110011';
  const id = recu.crear({ usuario: u, tipo: 'ingreso', monto: 1500000, categoria: 'Salario', frecuencia: 'mensual', inicio: HOY }, { hoy: HOY }).id;
  assert.equal(recu.pausar(u, id), true);
  assert.equal(recu.ejecutarPendientes({ hoy: '2027-02-20' }).filter((h) => h.usuario === u).length, 0);
  assert.equal(recu.reactivar(u, id, { hoy: '2027-02-20' }), true);
  assert.equal(recu.obtener(u, id).proxima, '2027-03-10');
  assert.equal(db.listarMovimientos({ usuario: u }).length, 0);
  recu.ejecutarPendientes({ hoy: '2027-03-10' });
  assert.equal(db.listarMovimientos({ usuario: u }).length, 1);
  assert.equal(recu.eliminar(u, id), true);
  assert.equal(recu.listar(u).length, 0);
  assert.equal(db.listarMovimientos({ usuario: u }).length, 1, 'lo ya registrado se conserva');
  assert.equal(recu.ejecutarPendientes({ hoy: '2027-06-10' }).filter((h) => h.usuario === u).length, 0);
});

test('recurrentes: rechaza categorías reservadas, fechas pasadas y otra cuenta no puede editar', () => {
  const u = '573001110012';
  assert.equal(recu.crear({ usuario: u, tipo: 'gasto', monto: 1000, categoria: 'Deudas', frecuencia: 'mensual' }, { hoy: HOY }).ok, false);
  assert.equal(recu.crear({ usuario: u, tipo: 'gasto', monto: 1000, categoria: 'Comida', frecuencia: 'anual' }, { hoy: HOY }).ok, false);
  assert.equal(recu.crear({ usuario: u, tipo: 'gasto', monto: 1000, categoria: 'Comida', frecuencia: 'diaria', inicio: '2026-01-01' }, { hoy: HOY }).ok, false);
  const id = recu.crear({ usuario: u, tipo: 'gasto', monto: 1000, categoria: 'Comida', frecuencia: 'diaria' }, { hoy: HOY }).id;
  assert.equal(recu.editar(B, id, { monto: 5 }, { hoy: HOY }).ok, false);
  assert.ok(recu.editar(u, id, { monto: 2000 }, { hoy: HOY }).ok);
  assert.equal(recu.obtener(u, id).monto, 2000);
});

// ---------- Metas ----------
test('metas: aportes y retiros, progreso, cumplida y sin doble conteo en movimientos', () => {
  const u = '573001110020';
  const m = metas.crear({ usuario: u, nombre: 'Viaje', objetivo: 1000000, aporte: 100000, frecuencia: 'mensual' }, { hoy: HOY });
  assert.ok(m.ok);
  assert.equal(metas.crear({ usuario: u, nombre: 'viaje', objetivo: 5 * 1000 }, { hoy: HOY }).ok, false, 'nombre repetido');
  let r = metas.aportar({ usuario: u, id: m.id, monto: 250000, fecha: HOY, mensajeId: 'a1' });
  assert.equal(r.meta.porcentaje, 25);
  assert.equal(r.meta.aportesRestantes, 8);
  assert.ok(metas.aportar({ usuario: u, id: m.id, monto: 250000, fecha: HOY, mensajeId: 'a1' }).duplicado);
  assert.equal(metas.obtener(u, m.id).ahorrado, 250000);
  assert.equal(metas.retirar({ usuario: u, id: m.id, monto: 300000 }).ok, false, 'no se puede retirar más de lo ahorrado');
  assert.equal(metas.retirar({ usuario: u, id: m.id, monto: 50000 }).meta.ahorrado, 200000);
  r = metas.aportar({ usuario: u, id: m.id, monto: 800000 });
  assert.equal(r.cumplida, true);
  assert.equal(r.meta.estado, 'cumplida');
  assert.equal(db.listarMovimientos({ usuario: u }).length, 0, 'los aportes no crean movimientos');
  assert.equal(metas.retirar({ usuario: u, id: m.id, monto: 100000 }).meta.estado, 'activa', 'al bajar del objetivo vuelve a activa');
});

test('metas: búsqueda por nombre, ambigüedad, aislamiento y cancelación', () => {
  const u = '573001110021';
  const a = metas.crear({ usuario: u, nombre: 'Moto nueva', objetivo: 9000000 }, { hoy: HOY }).id;
  metas.crear({ usuario: u, nombre: 'Moto repuestos', objetivo: 500000 }, { hoy: HOY });
  assert.equal(metas.buscar(u, 'nueva').meta.id, a);
  assert.equal(metas.buscar(u, 'moto').ambigua.length, 2);
  assert.equal(metas.buscar(u, `#${a}`).meta.nombre, 'Moto nueva');
  assert.equal(metas.buscar(B, 'moto').meta, undefined);
  assert.equal(metas.aportar({ usuario: B, id: a, monto: 1000 }).ok, false);
  assert.equal(metas.cancelar(u, a), true);
  assert.equal(metas.obtener(u, a), null);
  assert.equal(metas.crear({ usuario: u, nombre: 'Algo', objetivo: 1000, aporte: 100 }, { hoy: HOY }).ok, false, 'aporte sin frecuencia');
});

// ---------- Contexto ----------
test('contexto: guarda por usuario, vence y se puede borrar', () => {
  const t0 = 1_000_000_000_000;
  ctx.guardar(A, { ultimo: { id: 7 } }, t0);
  ctx.guardar(A, { pendiente: { tipo: 'x' } }, t0 + 1000);
  assert.deepEqual(ctx.obtener(A, t0 + 2000), { ultimo: { id: 7 }, pendiente: { tipo: 'x' } });
  assert.deepEqual(ctx.obtener(B, t0 + 2000), {}, 'otra persona no ve nada');
  ctx.guardar(A, { pendiente: null }, t0 + 3000);
  assert.equal(ctx.obtener(A, t0 + 4000).pendiente, undefined);
  assert.deepEqual(ctx.obtener(A, t0 + 31 * 60_000 + 4000), {}, 'a los 30 minutos vence');
  assert.equal(db.base().prepare('SELECT COUNT(*) AS n FROM contexto WHERE usuario = ?').get(A).n, 0, 'el vencido se borra');
  ctx.guardar(B, { ultimo: { id: 1 } }, t0);
  assert.equal(ctx.purgar(t0 + 40 * 60_000), 1);
});

test('contexto: confirmaciones y correcciones', () => {
  assert.equal(ctx.respuestaDeConfirmacion('Sí'), 'si');
  assert.equal(ctx.respuestaDeConfirmacion('dale'), 'si');
  assert.equal(ctx.respuestaDeConfirmacion('no'), 'no');
  assert.equal(ctx.respuestaDeConfirmacion('no, cámbialo a transporte por favor'), null, 'frases largas no son confirmación');
  assert.equal(ctx.respuestaDeConfirmacion('gasté 20 mil en comida'), null);
  assert.deepEqual(ctx.interpretarCorreccion('mejor ponlo en transporte'), { categoria: 'Transporte' });
  assert.deepEqual(ctx.interpretarCorreccion('No, era de 30 mil'), { monto: 30000 });
  assert.deepEqual(ctx.interpretarCorreccion('cámbialo a Salud, fueron 45.000'), { categoria: 'Salud', monto: 45000 });
  assert.equal(ctx.interpretarCorreccion('compré aceite por 20 mil'), null);
  assert.equal(ctx.interpretarCorreccion('ponlo en deudas'), null, 'categorías reservadas no se asignan por corrección');
});

// ---------- Alertas ----------
test('alertas: presupuesto 80/90/100 sin repetir, agrupadas y con silencio', () => {
  const u = '573001110030';
  db.fijarPresupuesto(u, 'Comida', 100000);
  db.agregarMovimiento({ usuario: u, tipo: 'gasto', monto: 85000, categoria: 'Comida', descripcion: '', fecha: HOY, mensajeId: 'al1' });
  const ahora = new Date('2026-11-10T17:00:00Z'); // 12:00 Bogotá
  let p = alertas.pendientes(u, ahora);
  assert.match(p.texto, /85%/);
  assert.deepEqual(p.claves, ['pres:Comida:2026-11:80']);
  alertas.registrarEnviadas(u, p.claves, HOY);
  assert.equal(alertas.pendientes(u, ahora), null, 'la misma alerta no se repite');
  db.agregarMovimiento({ usuario: u, tipo: 'gasto', monto: 20000, categoria: 'Comida', descripcion: '', fecha: HOY, mensajeId: 'al2' });
  p = alertas.pendientes(u, ahora);
  assert.match(p.texto, /Pasaste el presupuesto/);
  // Horario de silencio (23:30 Bogotá = 04:30 UTC del día siguiente): no envía
  assert.equal(alertas.pendientes(u, new Date('2026-11-11T04:30:00Z')), null);
});

test('alertas: configuración por tipo, máximo diario y validación', () => {
  const u = '573001110031';
  db.fijarPresupuesto(u, 'Comida', 1000);
  db.fijarPresupuesto(u, 'Ocio', 1000);
  db.fijarPresupuesto(u, 'Ropa', 1000);
  for (const [i, c] of ['Comida', 'Ocio', 'Ropa'].entries()) {
    db.agregarMovimiento({ usuario: u, tipo: 'gasto', monto: 1500, categoria: c, descripcion: '', fecha: HOY, mensajeId: `mx${i}` });
  }
  const ahora = new Date('2026-11-10T17:00:00Z');
  const todas = alertas.pendientes(u, ahora);
  assert.equal(todas.claves.length, 3);
  assert.match(todas.texto, /3 avisos/, 'varias alertas llegan en un solo mensaje');
  assert.ok(alertas.configurar(u, { max_diarias: 2 }).ok);
  assert.equal(alertas.pendientes(u, ahora).claves.length, 2);
  assert.ok(alertas.configurar(u, { presupuestos: false }).ok);
  assert.equal(alertas.pendientes(u, ahora), null);
  assert.equal(alertas.configurar(u, { silencio_desde: '99:99' }).ok, false);
  assert.equal(alertas.configurar(u, { max_diarias: 50 }).ok, false);
  assert.equal(alertas.configurar(u, {}).ok, false);
  assert.equal(alertas.configuracion(B).presupuestos, true, 'la configuración es por persona');
});

test('alertas: pico de gasto, gasto inusual, pagos próximos, metas y cierre de mes', () => {
  const u = '573001110032';
  const dia = (n) => `2026-10-${String(n + 19).padStart(2, '0')}`;
  for (let i = 1; i <= 9; i++) db.agregarMovimiento({ usuario: u, tipo: 'gasto', monto: 10000, categoria: 'Comida', descripcion: '', fecha: dia(i), mensajeId: `p${i}` });
  db.agregarMovimiento({ usuario: u, tipo: 'gasto', monto: 120000, categoria: 'Comida', descripcion: 'fiesta', fecha: HOY, mensajeId: 'pico1' });
  rec.crear({ usuario: u, texto: 'Pagar arriendo', monto: 900000, vence: '2026-11-12' }, { hoy: HOY });
  const meta = metas.crear({ usuario: u, nombre: 'Casa', objetivo: 1000000 }, { hoy: HOY }).id;
  metas.aportar({ usuario: u, id: meta, monto: 600000, fecha: HOY });
  const claves = alertas.calcular(u, HOY).map((a) => a.clave);
  assert.ok(claves.includes(`pico:${HOY}`));
  assert.ok(claves.some((c) => c.startsWith('inusual:')));
  assert.ok(claves.some((c) => c.startsWith('pago:')));
  assert.ok(claves.includes(`meta:${meta}:50`));
  assert.ok(!claves.some((c) => c.startsWith('cierre:')), 'el cierre solo aparece al final del mes');
  assert.ok(alertas.calcular(u, '2026-11-29').some((a) => a.clave === 'cierre:2026-11'));
});

test('alertas: deudas y préstamos atrasados más de 30 días', () => {
  const u = '573001110033';
  db.agregarDeuda({ usuario: u, persona: 'Juan', tipo: 'debo', monto: 50000, fecha: '2026-09-01', mensajeId: 'd1' });
  db.agregarPrestamo({ usuario: u, persona: 'Pedro', tipo: 'presto', monto: 70000, fecha: '2026-09-02', mensajeId: 'pr1' });
  const textos = alertas.calcular(u, HOY).filter((a) => a.tipo === 'deudas').map((a) => a.texto).join('\n');
  assert.match(textos, /debiendo \$50\.000 a Juan/);
  assert.match(textos, /Pedro te debe \$70\.000/);
});

test('migración v3 deja las tablas nuevas y la versión 3', () => {
  const tablas = db.base().prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name);
  for (const t of ['recordatorios', 'recurrentes', 'recurrentes_ejecuciones', 'metas', 'metas_aportes', 'alertas_config', 'alertas_enviadas', 'contexto']) {
    assert.ok(tablas.includes(t), t);
  }
  assert.equal(db.base().prepare('SELECT MAX(version) AS v FROM schema_migraciones').get().v >= 3, true);
});

test('borrar todo limpia también recordatorios, recurrentes, metas, alertas y contexto de esa persona (y solo la suya)', () => {
  const u = '573001110040';
  const o = '573001110041';
  for (const x of [u, o]) {
    rec.crear({ usuario: x, texto: 'Pagar luz', vence: '2026-11-20' }, { hoy: HOY });
    const rid = recu.crear({ usuario: x, tipo: 'gasto', monto: 1000, categoria: 'Comida', frecuencia: 'diaria', inicio: HOY }, { hoy: HOY }).id;
    recu.ejecutarPendientes({ hoy: HOY });
    const m = metas.crear({ usuario: x, nombre: 'Meta', objetivo: 5000 }, { hoy: HOY }).id;
    metas.aportar({ usuario: x, id: m, monto: 1000 });
    alertas.configurar(x, { max_diarias: 3 });
    alertas.registrarEnviadas(x, ['k'], HOY);
    ctx.guardar(x, { ultimo: { id: rid } });
  }
  db.enTransaccion(() => db.borrarDatos(u, 'todo'));
  const cuenta = (t, x) => db.base().prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE usuario = ?`).get(x).n;
  for (const t of ['recordatorios', 'recurrentes', 'metas', 'metas_aportes', 'alertas_config', 'alertas_enviadas', 'contexto', 'movimientos']) {
    assert.equal(cuenta(t, u), 0, t);
    assert.ok(cuenta(t, o) > 0, `${t} de la otra persona se conserva`);
  }
  assert.equal(db.base().prepare('SELECT COUNT(*) AS n FROM recurrentes_ejecuciones').get().n >= 1, true);
});

test('programador: envía recordatorios y alertas una sola vez, registra recurrentes y reintenta si WhatsApp falla', async () => {
  const { ciclo, _reiniciar } = await import('./programador.js');
  const u = '573001110050';
  db.asegurarUsuario(u);
  rec.crear({ usuario: u, texto: 'Pagar tarjeta', vence: '2026-11-10', hora: '09:00' }, { hoy: HOY });
  recu.crear({ usuario: u, tipo: 'gasto', monto: 12000, categoria: 'Servicios', descripcion: 'Spotify', frecuencia: 'mensual', inicio: HOY }, { hoy: HOY });
  db.fijarPresupuesto(u, 'Comida', 1000);
  db.agregarMovimiento({ usuario: u, tipo: 'gasto', monto: 2000, categoria: 'Comida', descripcion: '', fecha: HOY, mensajeId: 'prog1' });
  const ahora = new Date('2026-11-10T17:00:00Z'); // 12:00 Bogotá
  const enviados = [];

  // WhatsApp caído: no se marca nada
  _reiniciar();
  let r = await ciclo({ ahora, enviar: async () => { throw new Error('WhatsApp no está conectado'); } });
  assert.equal(r.recordatorios, 0);
  assert.equal(rec.vencidos(ahora).filter((x) => x.usuario === u).length, 1, 'sigue pendiente');
  assert.equal(db.listarMovimientos({ usuario: u }).filter((m) => m.categoria === 'Servicios').length, 1, 'el recurrente sí se registra aunque el aviso falle');

  // WhatsApp de vuelta: se envía todo, una vez
  _reiniciar();
  r = await ciclo({ ahora, enviar: async (usuario, texto) => { enviados.push([usuario, texto]); } });
  assert.equal(r.recordatorios, 1);
  assert.ok(enviados.some(([x, t]) => x === u && /Recordatorio: Pagar tarjeta/.test(t)));
  assert.ok(enviados.some(([x, t]) => x === u && /presupuesto de Comida/.test(t)));

  _reiniciar();
  enviados.length = 0;
  r = await ciclo({ ahora: new Date(ahora.getTime() + 60_000), enviar: async (usuario, texto) => { enviados.push([usuario, texto]); } });
  assert.equal(enviados.filter(([x]) => x === u).length, 0, 'nada se repite en el siguiente ciclo');
  assert.equal(db.listarMovimientos({ usuario: u }).filter((m) => m.categoria === 'Servicios').length, 1, 'ni el recurrente');
});
