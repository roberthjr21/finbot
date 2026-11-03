import * as db from './db.js';

// ---------------------------------------------------------------------------
// Cálculos financieros: ÚNICO lugar donde se definen las cifras.
//
// Reglas (cada concepto va por separado):
//  • Saldo en mano (caja): TODO lo registrado. Prestar o abonar una deuda saca plata; cobrar un préstamo la mete.
//  • Ingresos / Gastos "operativos": solo el movimiento normal de plata. NO incluyen:
//      - Préstamos que hiciste (Prestado) ni lo que te devolvieron (Cobrado)
//      - Abonos a tus deudas (Pagos de deudas)
//  • Lo que debo y lo que me deben son listas distintas y nunca se mezclan.
// ---------------------------------------------------------------------------

export const CATEGORIA_DEUDAS = 'Deudas';
export const CATEGORIA_PRESTAMOS = 'Préstamos';
export const DESDE_SIEMPRE = '0001-01-01';

// Saldo en mano: ingresos − gastos de todos los movimientos (incluye préstamos y abonos).
export function caja(usuario, hasta) {
  const { ingresos, gastos, balance } = db.resumen(usuario, DESDE_SIEMPRE, hasta);
  return { ingresos, gastos, balance };
}

// Resumen de un periodo SIN préstamos ni pagos de deudas; esos van en campos aparte.
export function operativo(usuario, desde, hasta) {
  const todo = db.resumen(usuario, desde, hasta);
  const prestamos = db.resumen(usuario, desde, hasta, CATEGORIA_PRESTAMOS);
  const deudas = db.resumen(usuario, desde, hasta, CATEGORIA_DEUDAS);
  // Ingresos en categoría Deudas (si los hubiera) se dejan como ingreso normal: solo se aparta el gasto.
  const ingresos = todo.ingresos - prestamos.ingresos;
  const gastos = todo.gastos - prestamos.gastos - deudas.gastos;
  return {
    ingresos,
    gastos,
    balance: ingresos - gastos,
    porCategoria: todo.porCategoria.filter((c) => c.categoria !== CATEGORIA_PRESTAMOS && c.categoria !== CATEGORIA_DEUDAS),
    prestado: prestamos.gastos,
    cobrado: prestamos.ingresos,
    pagosDeuda: deudas.gastos,
  };
}

// Porcentaje gastado de un límite. Sin límite válido da 0 (nunca NaN ni Infinity).
export function porcentajePresupuesto(gastado, limite) {
  const l = Number(limite);
  return Number.isFinite(l) && l > 0 ? Math.round((gastado / l) * 100) : 0;
}

// Lo que debo (por persona, solo saldos > 0). Nunca incluye lo que me deben.
export function deudas(usuario) {
  const todas = db.resumenDeudas(usuario);
  const personas = todas.filter((p) => p.saldo > 0);
  return { todas, personas, total: personas.reduce((s, p) => s + p.saldo, 0) };
}

// Lo que me deben (por persona, solo saldos > 0).
export function prestamos(usuario) {
  const todas = db.resumenPrestamos(usuario);
  const personas = todas.filter((p) => p.saldo > 0);
  return { todas, personas, total: personas.reduce((s, p) => s + p.saldo, 0) };
}
