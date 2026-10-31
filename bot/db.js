import { DatabaseSync } from 'node:sqlite';
import { normalizar } from './categorias.js';

// Un solo archivo (finanzas.db). Los montos se guardan como pesos enteros.
const archivoDB = process.env.DB_ARCHIVO ?? 'finanzas.db';
const db = new DatabaseSync(archivoDB);

const existeTabla = (nombre) =>
  Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(nombre));

// Antes de migrar una base con datos a multiusuario, guarda una copia verificada.
// Si la copia falla, el bot no arranca: es mejor eso que migrar sin respaldo.
function respaldoAntesDeMigrar() {
  if (existeTabla('usuarios') || archivoDB === ':memory:') return;
  const tablas = ['movimientos', 'presupuestos', 'deudas'].filter(existeTabla);
  const cuenta = (copia, t) => copia.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
  if (!tablas.some((t) => db.prepare(`SELECT 1 FROM ${t} LIMIT 1`).get())) return;

  const destino = `${archivoDB}.antes-multiusuario-${new Date().toISOString().replace(/[:.]/g, '-')}.db`;
  db.exec(`VACUUM INTO '${destino.replaceAll("'", "''")}'`);
  const copia = new DatabaseSync(destino, { readOnly: true });
  try {
    if (copia.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('la copia no pasó la verificación');
    for (const t of tablas) {
      if (cuenta(copia, t) !== cuenta(db, t)) throw new Error(`la copia de ${t} no coincide`);
    }
  } finally {
    copia.close();
  }
  console.log('💾 Copia de seguridad previa a la migración multiusuario creada junto a la base de datos.');
}
respaldoAntesDeMigrar();

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

  -- Cuentas. "id" es el identificador interno estable (lo usan las sesiones web);
  -- "telefono" es el número de WhatsApp normalizado y es la clave "usuario" de los datos.
  CREATE TABLE IF NOT EXISTS usuarios (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    telefono TEXT    NOT NULL UNIQUE,
    estado   TEXT    NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'bloqueado')),
    creado   TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  -- Códigos de acceso web: solo se guarda un HMAC, nunca el código.
  CREATE TABLE IF NOT EXISTS codigos_login (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL REFERENCES usuarios (id),
    hash       TEXT    NOT NULL,
    creado     INTEGER NOT NULL,
    expira     INTEGER NOT NULL,
    intentos   INTEGER NOT NULL DEFAULT 0,
    usado      INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_codigos_usuario ON codigos_login (usuario_id, creado);

  -- Sesiones web: solo se guarda el hash del token; se pueden revocar.
  CREATE TABLE IF NOT EXISTS sesiones_web (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL REFERENCES usuarios (id),
    token_hash TEXT    NOT NULL UNIQUE,
    creado     INTEGER NOT NULL,
    expira     INTEGER NOT NULL,
    ultimo_uso INTEGER NOT NULL,
    revocada   INTEGER NOT NULL DEFAULT 0
  );

  -- Mensajes e IA usados por cada persona cada día (límites contra abuso)
  CREATE TABLE IF NOT EXISTS uso_diario (
    usuario  TEXT    NOT NULL,
    dia      TEXT    NOT NULL,
    mensajes INTEGER NOT NULL DEFAULT 0,
    ia       INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (usuario, dia)
  );
`);

// Migración: cada número que ya tenga datos pasa a ser una cuenta. Se toma de las propias
// filas (su columna "usuario"), sin asignar ni mover datos de nadie. Se repite sin efecto.
db.exec(`
  INSERT OR IGNORE INTO usuarios (telefono)
  SELECT usuario FROM movimientos
  UNION SELECT usuario FROM presupuestos
  UNION SELECT usuario FROM deudas;
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

// --- Cuentas ---
// Crea la cuenta del número si no existe (sin movimientos: su saldo parte en $0).
// Devuelve { id, telefono, estado, nuevo }.
export function asegurarUsuario(telefono) {
  const r = db.prepare('INSERT OR IGNORE INTO usuarios (telefono) VALUES (?)').run(telefono);
  const fila = db.prepare('SELECT id, telefono, estado FROM usuarios WHERE telefono = ?').get(telefono);
  return { ...fila, nuevo: r.changes > 0 };
}

export const usuarioPorTelefono = (telefono) =>
  db.prepare('SELECT id, telefono, estado FROM usuarios WHERE telefono = ?').get(telefono) ?? null;

export const usuarioPorId = (id) =>
  db.prepare('SELECT id, telefono, estado FROM usuarios WHERE id = ?').get(id) ?? null;

export function cambiarEstadoUsuario(telefono, estado) {
  const r = db.prepare('UPDATE usuarios SET estado = ? WHERE telefono = ?').run(estado, telefono);
  if (estado === 'bloqueado' && r.changes) {
    db.prepare(
      'UPDATE sesiones_web SET revocada = 1 WHERE usuario_id = (SELECT id FROM usuarios WHERE telefono = ?)'
    ).run(telefono);
  }
  return r.changes > 0;
}

// Un mensaje ya atendido, ya sea con la clave nueva (usuario:id) o con la antigua (solo id)
export function yaProcesadoDe(usuario, id) {
  return yaProcesado(`${usuario}:${id}`) || yaProcesado(id);
}

// --- Uso diario (límites) ---
export function sumarUso(usuario, dia, { mensajes = 0, ia = 0 } = {}) {
  db.prepare(
    `INSERT INTO uso_diario (usuario, dia, mensajes, ia) VALUES (?, ?, ?, ?)
     ON CONFLICT (usuario, dia) DO UPDATE SET mensajes = mensajes + excluded.mensajes, ia = ia + excluded.ia`
  ).run(usuario, dia, mensajes, ia);
  return usoDelDia(usuario, dia);
}

export function usoDelDia(usuario, dia) {
  const fila = db.prepare('SELECT mensajes, ia FROM uso_diario WHERE usuario = ? AND dia = ?').get(usuario, dia);
  return { mensajes: fila?.mensajes ?? 0, ia: fila?.ia ?? 0 };
}

// --- Acceso web: códigos y sesiones (ahora = segundos desde 1970) ---
export function guardarCodigo({ usuarioId, hash, ahora, expira }) {
  // Un código nuevo invalida los anteriores
  db.prepare('UPDATE codigos_login SET usado = 1 WHERE usuario_id = ? AND usado = 0').run(usuarioId);
  db.prepare('INSERT INTO codigos_login (usuario_id, hash, creado, expira) VALUES (?, ?, ?, ?)').run(usuarioId, hash, ahora, expira);
}

export const contarCodigos = (usuarioId, desde) =>
  db.prepare('SELECT COUNT(*) AS n FROM codigos_login WHERE usuario_id = ? AND creado >= ?').get(usuarioId, desde).n;

export const ultimoCodigoCreado = (usuarioId) =>
  db.prepare('SELECT MAX(creado) AS t FROM codigos_login WHERE usuario_id = ?').get(usuarioId).t ?? 0;

export const codigoActivo = (usuarioId, ahora) =>
  db.prepare(
    'SELECT id, hash, intentos FROM codigos_login WHERE usuario_id = ? AND usado = 0 AND expira > ? ORDER BY id DESC LIMIT 1'
  ).get(usuarioId, ahora) ?? null;

export const sumarIntentoCodigo = (id) =>
  db.prepare('UPDATE codigos_login SET intentos = intentos + 1 WHERE id = ?').run(id);

export const gastarCodigo = (id) =>
  db.prepare('UPDATE codigos_login SET usado = 1 WHERE id = ?').run(id);

export function crearSesion({ usuarioId, tokenHash, ahora, expira }) {
  db.prepare('INSERT INTO sesiones_web (usuario_id, token_hash, creado, expira, ultimo_uso) VALUES (?, ?, ?, ?, ?)')
    .run(usuarioId, tokenHash, ahora, expira, ahora);
}

// Devuelve la cuenta dueña de la sesión, o null si no existe, venció, se revocó o la cuenta está bloqueada
export function sesionValida(tokenHash, ahora) {
  return db.prepare(
    `SELECT u.id AS id, u.telefono AS telefono, s.expira AS expira
       FROM sesiones_web s JOIN usuarios u ON u.id = s.usuario_id
      WHERE s.token_hash = ? AND s.revocada = 0 AND s.expira > ? AND u.estado = 'activo'`
  ).get(tokenHash, ahora) ?? null;
}

export const revocarSesion = (tokenHash) =>
  db.prepare('UPDATE sesiones_web SET revocada = 1 WHERE token_hash = ?').run(tokenHash).changes > 0;

export function limpiarAcceso(ahora) {
  db.prepare('DELETE FROM codigos_login WHERE expira < ?').run(ahora - 86400);
  db.prepare('DELETE FROM sesiones_web WHERE expira < ? OR revocada = 1').run(ahora - 86400);
}
