// Pruebas de los cálculos centralizados (finanzas.js): una sola fuente para saldo, resumen, deudas y préstamos.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const temporal = fs.mkdtempSync(path.join(os.tmpdir(), 'finbot-finanzas-'));
process.env.DB_ARCHIVO = path.join(temporal, 'finanzas.db');
process.env.API_TOKEN = 'secreto-de-prueba';
process.env.API_PUERTO = '0';
for (const v of ['GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'SECRETO_SESION']) delete process.env[v];

const db = await import('./db.js');
const finanzas = await import('./finanzas.js');
const { ejecutar } = await import('./acciones.js');
const { crearServidorApi } = await import('./api.js');
const acceso = await import('./acceso.js');

after(() => {
  db.cerrarBase();
  fs.rmSync(temporal, { recursive: true, force: true });
});

const A = '573009990001';
const B = '573009990002';
const HOY = '2026-10-31';
const INICIO = '2026-10-01';
let n = 0;
const run = (usuario, nombre, datos = {}) => ejecutar({ nombre, datos }, { usuario, hoy: HOY, mensajeId: `f-${++n}`, indice: 0 });

// Escenario: sueldo 1.000.000, comida 100.000, debo 300.000 a Juan (no mueve plata),
// abono 50.000 a Juan, presto 200.000 a Pedro, Pedro me devuelve 80.000.
function escenario(u) {
  run(u, 'registrar_movimiento', { tipo: 'ingreso', monto: 1000000, categoria: 'Salario', descripcion: 'sueldo' });
  run(u, 'registrar_movimiento', { tipo: 'gasto', monto: 100000, categoria: 'Comida', descripcion: 'mercado' });
  run(u, 'registrar_deuda', { persona: 'Juan', monto: 300000 });
  run(u, 'abonar_deuda', { persona: 'Juan', monto: 50000 });
  run(u, 'registrar_prestamo', { persona: 'Pedro', monto: 200000 });
  run(u, 'registrar_pago_recibido', { persona: 'Pedro', monto: 80000 });
}

test('escenario completo: cada concepto se calcula por separado', () => {
  escenario(A);

  // Caja: 1.000.000 + 80.000 − 100.000 − 50.000 − 200.000 = 730.000
  const caja = finanzas.caja(A, HOY);
  assert.equal(caja.balance, 730000);

  // Operativo: solo sueldo y comida; préstamos y abonos aparte
  const op = finanzas.operativo(A, INICIO, HOY);
  assert.equal(op.ingresos, 1000000);
  assert.equal(op.gastos, 100000);
  assert.equal(op.balance, 900000);
  assert.equal(op.prestado, 200000);
  assert.equal(op.cobrado, 80000);
  assert.equal(op.pagosDeuda, 50000);
  assert.deepEqual(op.porCategoria.map((c) => c.categoria), ['Comida']);

  // Lo que debo y lo que me deben no se mezclan
  assert.equal(finanzas.deudas(A).total, 250000);
  assert.equal(finanzas.prestamos(A).total, 120000);

  // La identidad contable se cumple: caja = operativo + cobrado − prestado − pagos de deuda
  assert.equal(caja.balance, op.balance + op.cobrado - op.prestado - op.pagosDeuda);
});

test('el resumen del bot muestra Prestado/Cobrado/Pagos de deudas aparte y no en Gastos', () => {
  const texto = run(A, 'consultar_resumen', { periodo: 'mes' });
  assert.match(texto, /Ingresos: \$1\.000\.000/);
  assert.match(texto, /Gastos: \$100\.000/);
  assert.match(texto, /Prestado: \$200\.000/);
  assert.match(texto, /Cobrado de préstamos: \$80\.000/);
  assert.match(texto, /Pagos de deudas: \$50\.000/);
  // Filtrando por categoría se ve tal cual
  assert.match(run(A, 'consultar_resumen', { periodo: 'mes', categoria: 'Deudas' }), /Gastos: \$50\.000/);
});

test('el saldo en mano no cambia respecto a antes: cuenta todo', () => {
  assert.match(run(A, 'consultar_saldo', {}), /Tienes \$730\.000/);
  const detalle = run(A, 'consultar_saldo', { detalle: true });
  assert.match(detalle, /Debes en total: \$250\.000/);
  assert.match(detalle, /Te deben en total: \$120\.000/);
});

test('un gasto antiguo en categoría Deudas (sin registro de deuda) también va a Pagos de deudas', () => {
  const U = '573009990003';
  run(U, 'registrar_movimiento', { tipo: 'ingreso', monto: 100000, categoria: 'Salario' });
  run(U, 'registrar_movimiento', { tipo: 'gasto', monto: 30000, categoria: 'Deudas', descripcion: 'cuota vieja' });
  const op = finanzas.operativo(U, INICIO, HOY);
  assert.equal(op.gastos, 0);
  assert.equal(op.pagosDeuda, 30000);
  assert.equal(finanzas.caja(U, HOY).balance, 70000);
});

test('usuarios aislados: los cálculos de A no tocan a B', () => {
  assert.equal(finanzas.caja(B, HOY).balance, 0);
  assert.equal(finanzas.deudas(B).total, 0);
  assert.equal(finanzas.prestamos(B).total, 0);
  const op = finanzas.operativo(B, INICIO, HOY);
  assert.deepEqual([op.ingresos, op.gastos, op.prestado, op.cobrado, op.pagosDeuda], [0, 0, 0, 0, 0]);
});

test('porcentaje de presupuesto: casos límite', () => {
  assert.equal(finanzas.porcentajePresupuesto(50, 200), 25);
  assert.equal(finanzas.porcentajePresupuesto(300, 200), 150);
  assert.equal(finanzas.porcentajePresupuesto(0, 200), 0);
  assert.equal(finanzas.porcentajePresupuesto(50, 0), 0);
  assert.equal(finanzas.porcentajePresupuesto(50, undefined), 0);
  assert.equal(finanzas.porcentajePresupuesto(50, 'abc'), 0);
});

test('un pago recibido de un préstamo no cuenta como sueldo (ingresos del mes)', () => {
  assert.equal(finanzas.operativo(A, INICIO, HOY).ingresos, 1000000); // los 80.000 cobrados NO suman
});

test('la API devuelve los mismos números que el bot', async () => {
  const servidor = crearServidorApi();
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  // Sesión real de A (código OTP simulado), igual que en la web
  db.asegurarUsuario(A);
  acceso.reiniciarLimites();
  const ahora = acceso.ahoraS() + 100000;
  const enviados = [];
  await acceso.solicitarCodigo({ telefono: A, enviar: async (t, texto) => enviados.push(texto), ahora });
  const codigo = enviados[0].match(/\*(\d{6})\*/)[1];
  const { token } = acceso.verificarCodigo({ telefono: A, codigo, ahora });
  const cab = { Authorization: 'Bearer secreto-de-prueba', 'X-Sesion': token };
  try {
    const get = async (ruta) => (await fetch(base + ruta, { headers: cab })).json();
    const saldo = await get('/api/saldo');
    assert.equal(saldo.balance, 730000);
    const resumen = await get('/api/resumen?mes=2026-10');
    assert.equal(resumen.ingresos, 1000000);
    assert.equal(resumen.gastos, 100000);
    assert.equal(resumen.prestado, 200000);
    assert.equal(resumen.cobrado, 80000);
    assert.equal(resumen.pagosDeuda, 50000);
    const deudas = await get('/api/deudas');
    assert.equal(deudas.total, 250000);
  } finally {
    servidor.closeAllConnections?.();
    servidor.close();
  }
});
