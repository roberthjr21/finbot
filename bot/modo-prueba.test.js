import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'finbot-prueba-'));
process.env.DB_ARCHIVO = path.join(carpeta, 'real.db');
const db = await import('./db.js');
const { ejecutar } = await import('./acciones.js');
const { interpretarPrueba, responderPrueba } = await import('./modo-prueba.js');
after(() => { db.cerrarBase(); fs.rmSync(carpeta, { recursive: true, force: true }); });
const A = '573000000001', B = '573000000002', hoy = '2026-11-09';
let i = 0;
function gasto(usuario, monto) {
  return ejecutar({ nombre: 'registrar_movimiento', datos: { tipo: 'gasto', monto, categoria: 'Comida', descripcion: 'prueba' } },
    { usuario, hoy, mensajeId: 'prueba-' + ++i, indice: 0 });
}
const movimientos = (usuario) => db.base().prepare('SELECT monto FROM movimientos WHERE usuario = ? ORDER BY id').all(usuario).map(x => x.monto);
test('comandos de prueba y lenguaje natural', () => {
  assert.equal(interpretarPrueba('/prueba on'), 'on');
  assert.equal(interpretarPrueba('/prueba off'), 'off');
  assert.equal(interpretarPrueba('/prueba estado'), 'estado');
  assert.equal(interpretarPrueba('activa el modo de prueba'), 'on');
  assert.equal(interpretarPrueba('desactiva el modo de prueba'), 'off');
  assert.equal(interpretarPrueba('/gasto 2000'), null);
});
test('modo de prueba usa SQLite en memoria y no escribe en la base real', async () => {
  gasto(A, 1000);
  assert.deepEqual(movimientos(A), [1000]);
  assert.match(responderPrueba(A, 'on'), /ACTIVADO/);
  assert.equal(db.pruebaActiva(A), true);
  await db.conBasePrueba(A, async () => {
    assert.deepEqual(movimientos(A), [], 'no debe copiar datos reales al entorno temporal');
    gasto(A, 2000);
    await Promise.resolve();
    assert.deepEqual(movimientos(A), [2000], 'conserva los datos temporales entre awaits');
  });
  assert.deepEqual(movimientos(A), [1000], 'la web sigue viendo solo los datos reales');
  db.conBasePrueba(A, () => assert.deepEqual(movimientos(A), [2000]));
  assert.match(responderPrueba(A, 'off'), /DESACTIVADO/);
  assert.deepEqual(movimientos(A), [1000]);
  assert.match(responderPrueba(A, 'on'), /ACTIVADO/);
  db.conBasePrueba(A, () => assert.deepEqual(movimientos(A), []), 'al reactivar se inicia vacío');
  responderPrueba(A, 'off');
});
test('cada usuario tiene su propio sandbox; no altera las finanzas de otros', () => {
  responderPrueba(A, 'on'); responderPrueba(B, 'on');
  db.conBasePrueba(A, () => gasto(A, 3000));
  db.conBasePrueba(B, () => { assert.deepEqual(movimientos(A), []); gasto(B, 4000); });
  db.conBasePrueba(A, () => assert.deepEqual(movimientos(A), [3000]));
  db.conBasePrueba(B, () => assert.deepEqual(movimientos(B), [4000]));
  assert.deepEqual(movimientos(A), [1000]);
  assert.deepEqual(movimientos(B), []);
  responderPrueba(A, 'off'); responderPrueba(B, 'off');
});
