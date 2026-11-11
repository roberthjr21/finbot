import test from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_ARCHIVO = ':memory:';
const { validarRecibo } = await import('./media.js');
const hoy = '2026-11-09';
const base = { es_recibo: true, comercio: 'Nequi', total: 75000, fecha: hoy, categoria: 'Servicios' };
test('recarga Bancolombia nunca se registra como gasto', () => {
  const r = validarRecibo({ ...base, tipo_operacion: 'recarga' }, hoy);
  assert.equal(r.ok, false);
  assert.match(r.error, /No la registré como gasto/);
});
test('transferencia propia no se registra como gasto', () => {
  assert.equal(validarRecibo({ ...base, tipo_operacion: 'transferencia_propia' }, hoy).ok, false);
});
test('envío Nequi sale como gasto pendiente de confirmación, sin Servicios', () => {
  const r = validarRecibo({ ...base, tipo_operacion: 'envio', total: 5000 }, hoy);
  assert.equal(r.ok, true);
  assert.equal(r.item.tipo, 'gasto');
  assert.equal(r.item.monto, 5000);
  assert.equal(r.item.categoria, 'Otros');
});
test('ingreso o operación desconocida requiere aclaración', () => {
  for (const tipo_operacion of ['ingreso', 'desconocida']) {
    assert.equal(validarRecibo({ ...base, tipo_operacion }, hoy).ok, false);
  }
});
