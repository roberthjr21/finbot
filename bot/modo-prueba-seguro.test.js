// El modo de pruebas nunca debe modificar las finanzas reales, ni por mensajes simultáneos, ni por el programador
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'finbot-prueba-seguro-'));
process.env.DB_ARCHIVO = path.join(carpeta, 'real.db');
for (const v of ['GEMINI_API_KEY', 'ANTHROPIC_API_KEY']) delete process.env[v];

const db = await import('./db.js');
const { ejecutar } = await import('./acciones.js');
const { responderPrueba } = await import('./modo-prueba.js');
const recu = await import('./recurrentes.js');
const rec = await import('./recordatorios.js');
const metas = await import('./metas.js');
const contexto = await import('./contexto.js');
const { ciclo, _reiniciar } = await import('./programador.js');

after(() => { db.cerrarBase(); fs.rmSync(carpeta, { recursive: true, force: true }); });

const A = '573004440001';
const B = '573004440002';
const HOY = '2026-11-10';
let n = 0;
const run = (usuario, nombre, datos = {}) => ejecutar({ nombre, datos }, { usuario, hoy: HOY, mensajeId: `ps-${++n}`, indice: 0 });

// Huella de TODAS las tablas de la base real, salvo el contador de uso diario (que sí debe contar)
function huella() {
  const tablas = db.enBaseReal(() => db.base().prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((t) => t.name));
  const h = crypto.createHash('sha256');
  for (const t of tablas.filter((x) => x !== 'uso_diario')) {
    h.update(t + JSON.stringify(db.enBaseReal(() => db.base().prepare(`SELECT * FROM ${t} ORDER BY rowid`).all())));
  }
  return h.digest('hex');
}

test('preparación: finanzas reales de A y B', () => {
  for (const u of [A, B]) {
    db.asegurarUsuario(u);
    run(u, 'registrar_movimiento', { tipo: 'ingreso', monto: 1_000_000, categoria: 'Salario', descripcion: 'real' });
    run(u, 'registrar_movimiento', { tipo: 'gasto', monto: 20000, categoria: 'Comida', descripcion: 'real' });
    run(u, 'registrar_deuda', { persona: 'Juan', monto: 50000 });
    run(u, 'fijar_presupuesto', { categoria: 'Comida', limite_mensual: 300000 });
    rec.crear({ usuario: u, texto: 'Pagar luz', vence: '2026-11-20' }, { hoy: HOY });
    recu.crear({ usuario: u, tipo: 'gasto', monto: 30000, categoria: 'Servicios', frecuencia: 'mensual', inicio: HOY }, { hoy: HOY });
    metas.crear({ usuario: u, nombre: 'Viaje', objetivo: 500000 }, { hoy: HOY });
  }
  assert.ok(db.listarMovimientos({ usuario: A }).length >= 2);
});

test('hacer de todo en modo prueba no cambia ni una fila de la base real', async () => {
  const antes = huella();
  const usoAntes = db.usoDelDia(A, HOY).mensajes;
  assert.match(responderPrueba(A, 'on'), /ACTIVADO/);

  await db.conBasePrueba(A, async () => {
    await Promise.resolve();
    run(A, 'registrar_movimiento', { tipo: 'gasto', monto: 99999, categoria: 'Ocio', descripcion: 'prueba' });
    run(A, 'corregir_ultimo', { categoria: 'Salud' });
    run(A, 'registrar_deuda', { persona: 'Ana', monto: 10000 });
    run(A, 'registrar_prestamo', { persona: 'Pedro', monto: 5000 });
    run(A, 'fijar_presupuesto', { categoria: 'Ocio', limite_mensual: 1000 });
    run(A, 'crear_recordatorio', { texto: 'Solo prueba', fecha: '2026-11-12' });
    run(A, 'crear_recurrente', { tipo: 'gasto', monto: 1000, categoria: 'Comida', frecuencia: 'diaria' });
    const meta = metas.crear({ usuario: A, nombre: 'Prueba', objetivo: 1000 }, { hoy: HOY }).id;
    metas.aportar({ usuario: A, id: meta, monto: 500 });
    recu.ejecutarPendientes({ hoy: '2026-12-31' });
    contexto.guardar(A, { pendiente: { origen: 'voz', items: [{ tipo: 'gasto', monto: 7000, categoria: 'Comida', descripcion: 'x', fecha: HOY }], huella: 'h-prueba' } });
    run(A, 'confirmar_pendiente');
    db.sumarUso(A, HOY, { mensajes: 1, ia: 1 });
    run(A, 'ver_diagnostico');
    db.enTransaccion(() => db.borrarDatos(A, 'todo'));
    await Promise.resolve();
    assert.equal(db.listarMovimientos({ usuario: A }).length, 0, 'dentro de la prueba, todo se borró');
  });

  assert.equal(huella(), antes, 'la base real quedó idéntica');
  assert.ok(db.listarMovimientos({ usuario: A }).length >= 2, 'los datos reales siguen ahí');
  assert.equal(db.usoDelDia(A, HOY).mensajes, usoAntes + 1, 'el uso diario sí se cuenta en la base real');
  assert.equal(db.yaProcesado(`comprobante:${A}:h-prueba`), false, 'la huella del comprobante de prueba tampoco quedó en la base real');
});

test('el programador (que corre fuera de la prueba) no ejecuta ni envía nada de la prueba', async () => {
  const antes = huella();
  responderPrueba(A, 'off');
  responderPrueba(A, 'on');
  db.conBasePrueba(A, () => {
    run(A, 'crear_recordatorio', { texto: 'Recordatorio de prueba', fecha: '2026-11-10', hora: '00:00' });
    run(A, 'crear_recurrente', { tipo: 'gasto', monto: 1234, categoria: 'Comida', frecuencia: 'diaria' });
  });
  const enviados = [];
  _reiniciar();
  await ciclo({ ahora: new Date('2026-11-10T20:00:00Z'), enviar: async (u, t) => { enviados.push([u, t]); } });
  assert.ok(!enviados.some(([, t]) => /de prueba/.test(t)), 'no se envían recordatorios de la prueba');
  assert.equal(db.listarMovimientos({ usuario: A }).filter((m) => m.monto === 1234).length, 0);
  // Lo real de B sí avanzó (recurrente y recordatorio reales), pero no lo de A en prueba
  assert.ok(db.listarMovimientos({ usuario: B }).some((m) => m.categoria === 'Servicios'));
  assert.notEqual(huella(), antes, 'el programador sí actúa sobre lo real (B)');
  responderPrueba(A, 'off');
});

test('al salir de la prueba se descarta todo y reactivar empieza vacío; /prueba off sobre lo real no borra nada', () => {
  responderPrueba(A, 'on');
  db.conBasePrueba(A, () => run(A, 'registrar_movimiento', { tipo: 'gasto', monto: 1111, categoria: 'Comida', descripcion: 'x' }));
  const antes = huella();
  assert.match(responderPrueba(A, 'off'), /nunca se modificaron/);
  assert.equal(huella(), antes);
  responderPrueba(A, 'on');
  db.conBasePrueba(A, () => assert.equal(db.listarMovimientos({ usuario: A }).length, 0));
  responderPrueba(A, 'off');
  assert.match(responderPrueba(A, 'off'), /Ya estabas en modo normal/);
  assert.ok(db.listarMovimientos({ usuario: A }).length >= 2);
});

test('mensajes simultáneos de una persona en prueba y otra normal nunca se cruzan', async () => {
  responderPrueba(A, 'on');
  const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
  const antesB = db.listarMovimientos({ usuario: B }).length;
  await Promise.all([
    db.conBasePrueba(A, async () => { for (let i = 0; i < 5; i++) { run(A, 'registrar_movimiento', { tipo: 'gasto', monto: 100 + i, categoria: 'Comida', descripcion: 'p' }); await pausa(2); } }),
    db.conBasePrueba(B, async () => { for (let i = 0; i < 5; i++) { run(B, 'registrar_movimiento', { tipo: 'gasto', monto: 200 + i, categoria: 'Comida', descripcion: 'r' }); await pausa(3); } }),
  ]);
  assert.equal(db.listarMovimientos({ usuario: B }).length, antesB + 5, 'lo de B quedó en la base real');
  assert.equal(db.listarMovimientos({ usuario: A }).filter((m) => m.monto >= 100 && m.monto < 110).length, 0, 'lo de A (prueba) no está en la real');
  db.conBasePrueba(A, () => assert.equal(db.listarMovimientos({ usuario: A }).length, 5));
  responderPrueba(A, 'off');
});

test('concurrencia: el mismo mensaje repetido y muchos usuarios a la vez se registran exactamente una vez', async () => {
  const usuarios = Array.from({ length: 20 }, (_, i) => `57300555${String(i).padStart(4, '0')}`);
  usuarios.forEach((u) => db.asegurarUsuario(u));
  await Promise.all(usuarios.flatMap((u) => [1, 2, 3].map(async () => {
    await Promise.resolve();
    db.enTransaccion(() => ejecutar({ nombre: 'registrar_movimiento', datos: { tipo: 'gasto', monto: 5000, categoria: 'Comida', descripcion: 'dup' } }, { usuario: u, hoy: HOY, mensajeId: `${u}:mismo-mensaje`, indice: 0 }));
  })));
  for (const u of usuarios) assert.equal(db.listarMovimientos({ usuario: u }).length, 1, u);
});
