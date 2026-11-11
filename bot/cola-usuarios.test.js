import test from 'node:test';
import assert from 'node:assert/strict';
import { crearColas } from './cola-usuarios.js';

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

test('cola: los mensajes de una misma persona se procesan en orden aunque el primero sea lento', async () => {
  const colas = crearColas({ alError: () => {} });
  const orden = [];
  colas.encolar('A', async () => { await pausa(40); orden.push('A1'); });
  colas.encolar('A', async () => { orden.push('A2'); });
  colas.encolar('A', async () => { await pausa(5); orden.push('A3'); });
  await colas.esperarTodo();
  assert.deepEqual(orden, ['A1', 'A2', 'A3']);
});

test('cola: una persona lenta no bloquea a las demás', async () => {
  const colas = crearColas({ alError: () => {} });
  const orden = [];
  colas.encolar('lenta', async () => { await pausa(80); orden.push('lenta'); });
  colas.encolar('rapida', async () => { orden.push('rapida'); });
  await colas.esperarTodo();
  assert.deepEqual(orden, ['rapida', 'lenta']);
});

test('cola: un error en una tarea no detiene las siguientes ni las de otras personas', async () => {
  const errores = [];
  const colas = crearColas({ alError: (e) => errores.push(e.message) });
  const orden = [];
  colas.encolar('A', async () => { throw new Error('falló'); });
  colas.encolar('A', async () => { orden.push('A2'); });
  colas.encolar('B', async () => { orden.push('B1'); });
  await colas.esperarTodo();
  assert.deepEqual(errores, ['falló']);
  assert.deepEqual(orden.sort(), ['A2', 'B1']);
});

test('cola: respeta el tope global de concurrencia', async () => {
  const colas = crearColas({ concurrencia: 2, alError: () => {} });
  let activas = 0;
  let maximo = 0;
  for (const u of ['a', 'b', 'c', 'd', 'e']) {
    colas.encolar(u, async () => { activas++; maximo = Math.max(maximo, activas); await pausa(15); activas--; });
  }
  await colas.esperarTodo();
  assert.equal(maximo, 2);
});

test('cola: el tope por persona rechaza el exceso sin afectar a otras personas y se libera al terminar', async () => {
  const colas = crearColas({ maxPendientes: 2, alError: () => {} });
  const hechos = [];
  assert.ok(colas.encolar('A', async () => { await pausa(20); hechos.push(1); }));
  assert.ok(colas.encolar('A', async () => { hechos.push(2); }));
  assert.equal(colas.encolar('A', async () => { hechos.push(3); }), null, 'el tercero se rechaza');
  assert.ok(colas.encolar('B', async () => { hechos.push('b'); }));
  assert.equal(colas.pendientesDe('A'), 2);
  await colas.esperarTodo();
  assert.deepEqual(hechos.filter((x) => x !== 'b'), [1, 2]);
  assert.equal(colas.activas(), 0);
  assert.equal(colas.pendientesDe('A'), 0);
  assert.ok(colas.encolar('A', async () => { hechos.push(4); }), 'vuelve a aceptar mensajes');
  await colas.esperarTodo();
});
