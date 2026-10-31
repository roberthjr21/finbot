import { DatabaseSync } from 'node:sqlite';
import { normalizar } from './categorias.js';

// Un solo archivo (finanzas.db). Los montos se guardan como pesos enteros.
const db = new DatabaseSync(process.env.DB_ARCHIVO ?? 'finanzas.db');

db.exec(`
  PRAGMA busy_timeout = 5000;
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS movimientos (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario     TEXT    NOT NULL,
    tipo        TEXT    NOT NULL CHECK (tipo IN ('gasto', 'ingreso')),
    monto       INTEGER NOT NULL CHECK (monto > 0),
    categoria   TEXT    NOT NULL,
    descripcion TEXT    NOT NULL DEFAULT '',
    fecha       TEXT    NOT NULL,
    creado      TEXT    NOT NULL DEFAULT (datetime('now')),
    mensaje_id  TEXT    UNIQUE
  );
  CREATE INDEX IF NOT EXISTS idx_mov_usuario_fecha ON movimientos (usuario, fecha);

  CREATE TABLE IF NOT EXISTS presupuestos (
    usuario   TEXT    NOT NULL,
    categoria TEXT    NOT NULL,
    limite    INTEGER NOT NULL CHECK (limite > 0),
    PRIMARY KEY (usuario, categoria)
  );

  CREATE TABLE IF NOT EXISTS procesados (
    id     TEXT PRIMARY KEY,
    creado TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS deudas (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario       TEXT    NOT NULL,
    persona       TEXT    NOT NULL,
    clave         TEXT    NOT NULL,
    tipo          TEXT    NOT NULL CHECK (tipo IN ('debo', 'abono')),
    monto         INTEGER NOT NULL CHECK (monto > 0),
    descripcion   TEXT    NOT NULL DEFAULT '',
    fecha         TEXT    NOT NULL,
    movimiento_id INTEGER,
    mov_previo    INTEGER NOT NULL DEFAULT 0,
    creado        TEXT    NOT NULL DEFAULT (datetime('now')),
    mensaje_id    TEXT    UNIQUE
  );
  CREATE INDEX IF NOT EXISTS idx_deudas_usuario ON deudas (usuario, clave);
`);

// --- Mensajes ya atendidos (para no registrar dos veces lo mismo) ---
export function yaProcesado(id) {
  return Boolean(db.prepare('SELECT 1 FROM procesados WHERE id = ?').get(id));
}
export function configuracionSQLite() {
  return {
    journal_mode: db.prepare('PRAGMA journal_mode').get().journal_mode,
    busy_timeout: db.prepare('PRAGMA busy_timeout').get().timeout,
  };
}
export function marcarProcesado(id) {
  db.prepare('INSERT OR IGNORE INTO procesados (id) VALUES (?)').run(id);
}
// Las acciones de un mensaje y su marca de idempotencia se confirman juntas.
// Así, un fallo no deja un lote financiero aplicado a medias.
export function enTransaccion(tarea) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const resultado = tarea();
    db.exec('COMMIT');
    return resultado;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}
export function cerrarBase() { db.close(); }

// --- Movimientos ---
// Devuelve el id nuevo, o null si ese mensaje ya estaba registrado
export function agregarMovimiento({ usuario, tipo, monto, categoria, descripcion, fecha, mensajeId }) {
  const r = db
    .prepare(
      `INSERT INTO movimientos (usuario, tipo, monto, categoria, descripcion, fecha, mensaje_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (mensaje_id) DO NOTHING`
    )
    .run(usuario, tipo, monto, categoria, descripcion ?? '', fecha, mensajeId ?? null);
  return r.changes === 0 ? null : Number(r.lastInsertRowid);
}

export function listarMovimientos({ usuario, desde, hasta, tipo, categoria, limite = 100, offset = 0 }) {
  const condiciones = ['usuario = ?'];
  const params = [usuario];
  if (desde) { condiciones.push('fecha >= ?'); params.push(desde); }
  if (hasta) { condiciones.push('fecha <= ?'); params.push(hasta); }
  if (tipo) { condiciones.push('tipo = ?'); params.push(tipo); }
  if (categoria) { condiciones.push('categoria = ?'); params.push(categoria); }
  params.push(Math.min(Math.max(Number(limite) || 100, 1), 1000));
  return db
    .prepare(
      `SELECT id, tipo, monto, categoria, descripcion, fecha
         FROM movimientos
        WHERE ${condiciones.join(' AND ')}
        ORDER BY fecha DESC, id DESC
        LIMIT ? OFFSET ?`
    )
    .all(...params, Math.max(0, Number(offset) || 0));
}

export function ultimoMovimientoBorrable(usuario) {
  return db.prepare(
    `SELECT id, tipo, monto, categoria, descripcion, fecha
       FROM movimientos
      WHERE usuario = ? AND creado >= datetime('now', '-1 day')
      ORDER BY id DESC LIMIT 1`,
  ).get(usuario) ?? null;
}

export function borrarMovimiento(usuario, id) {
  const fila = db.prepare(
    `SELECT id, tipo, monto, categoria, descripcion, fecha
       FROM movimientos WHERE usuario = ? AND id = ?
         AND creado >= datetime('now', '-1 day')`,
  ).get(usuario, id);
  if (!fila) return null;
  const resultado = db.prepare('DELETE FROM movimientos WHERE usuario = ? AND id = ?').run(usuario, id);
  // Si ese movimiento era el gasto de un abono, el abono también se deshace
  if (resultado.changes) db.prepare('DELETE FROM deudas WHERE usuario = ? AND movimiento_id = ?').run(usuario, id);
  return resultado.changes ? fila : null;
}

// Totales de ingresos y gastos, y gastos por categoría, entre dos fechas
export function resumen(usuario, desde, hasta, categoria = null) {
  const filtro = categoria ? 'AND categoria = ?' : '';
  const params = categoria ? [usuario, desde, hasta, categoria] : [usuario, desde, hasta];

  const totales = db
    .prepare(
      `SELECT tipo, COALESCE(SUM(monto), 0) AS total
         FROM movimientos
        WHERE usuario = ? AND fecha BETWEEN ? AND ? ${filtro}
        GROUP BY tipo`
    )
    .all(...params);
  const porCategoria = db
    .prepare(
      `SELECT categoria, SUM(monto) AS total
         FROM movimientos
        WHERE usuario = ? AND tipo = 'gasto' AND fecha BETWEEN ? AND ? ${filtro}
        GROUP BY categoria
        ORDER BY total DESC`
    )
    .all(...params);

  const ingresos = totales.find((t) => t.tipo === 'ingreso')?.total ?? 0;
  const gastos = totales.find((t) => t.tipo === 'gasto')?.total ?? 0;
  return {
    ingresos,
    gastos,
    balance: ingresos - gastos,
    porCategoria: porCategoria.map((c) => ({ categoria: c.categoria, total: c.total })),
  };
}

export function gastoEnCategoria(usuario, categoria, desde, hasta) {
  return (
    db
      .prepare(
        `SELECT COALESCE(SUM(monto), 0) AS total FROM movimientos
          WHERE usuario = ? AND tipo = 'gasto' AND categoria = ? AND fecha BETWEEN ? AND ?`
      )
      .get(usuario, categoria, desde, hasta).total
  );
}

// --- Presupuestos mensuales por categoría ---
export function fijarPresupuesto(usuario, categoria, limite) {
  db.prepare(
    `INSERT INTO presupuestos (usuario, categoria, limite) VALUES (?, ?, ?)
     ON CONFLICT (usuario, categoria) DO UPDATE SET limite = excluded.limite`
  ).run(usuario, categoria, limite);
}

export function presupuestoDe(usuario, categoria) {
  return (
    db.prepare('SELECT limite FROM presupuestos WHERE usuario = ? AND categoria = ?').get(usuario, categoria)
      ?.limite ?? null
  );
}

export function presupuestos(usuario) {
  return db
    .prepare('SELECT categoria, limite FROM presupuestos WHERE usuario = ? ORDER BY categoria')
    .all(usuario)
    .map((p) => ({ categoria: p.categoria, limite: p.limite }));
}

// --- Deudas ---
// Cada fila es una deuda ('debo') o un abono ('abono') con una persona. Lo que se le debe a
// alguien es la suma de sus deudas menos la suma de sus abonos. Una deuda NO cambia el saldo en
// pesos; un abono sí, porque su gasto se registra en movimientos (movimiento_id une ambas filas).

// "Juan  Pérez" -> "juan perez": así "juan" y "Juan" son la misma persona
export const clavePersona = (persona) => normalizar(persona).replace(/\s+/g, ' ');

// Devuelve el id nuevo, o null si ese mensaje ya estaba registrado.
// mov_previo guarda el último movimiento que existía al anotarla, para saber cuál es más reciente.
export function agregarDeuda({ usuario, persona, tipo, monto, descripcion, fecha, movimientoId, mensajeId }) {
  const r = db
    .prepare(
      `INSERT INTO deudas (usuario, persona, clave, tipo, monto, descripcion, fecha, movimiento_id, mov_previo, mensaje_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(id), 0) FROM movimientos), ?)
       ON CONFLICT (mensaje_id) DO NOTHING`
    )
    .run(usuario, persona, clavePersona(persona), tipo, monto, descripcion ?? '', fecha, movimientoId ?? null, mensajeId ?? null);
  return r.changes === 0 ? null : Number(r.lastInsertRowid);
}

// Todas las personas con las que hay (o hubo) deudas, con lo que se les debe hoy. Mayor deuda primero.
export function resumenDeudas(usuario) {
  return db
    .prepare(
      `SELECT d.clave AS clave,
              (SELECT p.persona FROM deudas p WHERE p.usuario = d.usuario AND p.clave = d.clave ORDER BY p.id LIMIT 1) AS persona,
              SUM(CASE d.tipo WHEN 'debo' THEN d.monto ELSE -d.monto END) AS saldo
         FROM deudas d
        WHERE d.usuario = ?
        GROUP BY d.clave
        ORDER BY saldo DESC, persona`
    )
    .all(usuario)
    .map((f) => ({ clave: f.clave, persona: f.persona, saldo: Number(f.saldo) }));
}

export function totalDeudas(usuario) {
  return resumenDeudas(usuario).reduce((suma, p) => suma + Math.max(p.saldo, 0), 0);
}

export function historialDeuda(usuario, clave, limite = 5) {
  return db
    .prepare('SELECT tipo, monto, descripcion, fecha FROM deudas WHERE usuario = ? AND clave = ? ORDER BY id DESC LIMIT ?')
    .all(usuario, clave, limite);
}

// La última deuda anotada en el último día (para /deshacer). Los abonos no se deshacen aquí:
// se deshacen borrando su gasto.
export function ultimaDeudaBorrable(usuario) {
  return db
    .prepare(
      `SELECT id, persona, monto, fecha, mov_previo
         FROM deudas
        WHERE usuario = ? AND tipo = 'debo' AND creado >= datetime('now', '-1 day')
        ORDER BY id DESC LIMIT 1`
    )
    .get(usuario) ?? null;
}

// Borra una deuda reciente. Devuelve la fila borrada, null si no existe o ya no se puede,
// o { bloqueada: true } si ya tiene abonos (borrarla dejaría una deuda negativa).
export function borrarDeuda(usuario, id) {
  const fila = db
    .prepare(
      `SELECT id, persona, clave, monto, fecha FROM deudas
        WHERE usuario = ? AND id = ? AND tipo = 'debo' AND creado >= datetime('now', '-1 day')`
    )
    .get(usuario, id);
  if (!fila) return null;
  const { saldo } = db
    .prepare(
      `SELECT COALESCE(SUM(CASE tipo WHEN 'debo' THEN monto ELSE -monto END), 0) AS saldo
         FROM deudas WHERE usuario = ? AND clave = ?`
    )
    .get(usuario, fila.clave);
  if (Number(saldo) - fila.monto < 0) return { bloqueada: true };
  db.prepare('DELETE FROM deudas WHERE usuario = ? AND id = ?').run(usuario, id);
  return fila;
}
