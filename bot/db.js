import { DatabaseSync } from 'node:sqlite';
import { AsyncLocalStorage } from 'node:async_hooks';
import { normalizar } from './categorias.js';
import { migrar } from './migraciones.js';

// Un solo archivo (finanzas.db). Los montos se guardan como pesos enteros.
const archivoDB = process.env.DB_ARCHIVO ?? 'finanzas.db';
const dbReal = new DatabaseSync(archivoDB);
const baseTemporal = new AsyncLocalStorage();
// Las consultas de un mensaje de prueba van a su propia base SQLite en memoria.
// La web, el programador y los demás usuarios siempre ven la base real.
const db = new Proxy(dbReal, {
  get(target, propiedad) {
    const destino = baseTemporal.getStore() ?? target;
    const valor = Reflect.get(destino, propiedad, destino);
    return typeof valor === 'function' ? valor.bind(destino) : valor;
  },
});
const pruebas = new Map();

function crearBasePrueba() {
  const temporal = new DatabaseSync(':memory:');
  try {
    const objetos = dbReal.prepare(
      "SELECT type, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'view' THEN 1 WHEN 'index' THEN 2 WHEN 'trigger' THEN 3 ELSE 4 END, rowid"
    ).all();
    for (const objeto of objetos) temporal.exec(objeto.sql);
    return temporal;
  } catch (error) {
    temporal.close();
    throw error;
  }
}

export function activarPrueba(usuario) {
  if (!pruebas.has(usuario)) pruebas.set(usuario, crearBasePrueba());
  return true;
}
export function pruebaActiva(usuario) { return pruebas.has(usuario); }
export function desactivarPrueba(usuario) {
  const temporal = pruebas.get(usuario);
  if (!temporal) return false;
  pruebas.delete(usuario);
  temporal.close();
  return true;
}
export function conBasePrueba(usuario, tarea) {
  const temporal = pruebas.get(usuario);
  return temporal ? baseTemporal.run(temporal, tarea) : tarea();
}

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

// Migraciones versionadas (tablas nuevas, siempre aditivas y con copia verificada antes)
// Se ejecuta al final, después de completar todas las tablas del esquema base.

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
// Los mensajes de WhatsApp ya corren dentro de una transacción. Una edición interna
// requiere un SAVEPOINT, no un segundo BEGIN IMMEDIATE; el BEGIN externo se conserva
// para reservar el escritor con anticipación y mantener la seguridad de concurrencia.
let siguienteSavepoint = 0;
export function enTransaccion(tarea) {
  const anidada = db.isTransaction;
  const nombre = anidada ? `finbot_anidada_${++siguienteSavepoint}` : null;
  db.exec(anidada ? `SAVEPOINT ${nombre}` : 'BEGIN IMMEDIATE');
  try {
    const resultado = tarea();
    if (resultado && typeof resultado.then === 'function') throw new Error('Una transacción SQLite debe ser síncrona');
    db.exec(anidada ? `RELEASE SAVEPOINT ${nombre}` : 'COMMIT');
    return resultado;
  } catch (error) {
    if (anidada) {
      try { db.exec(`ROLLBACK TO SAVEPOINT ${nombre}`); } catch {}
      try { db.exec(`RELEASE SAVEPOINT ${nombre}`); } catch {}
    } else {
      try { db.exec('ROLLBACK'); } catch {}
    }
    throw error;
  }
}
export function cerrarBase() {
  for (const usuario of [...pruebas.keys()]) desactivarPrueba(usuario);
  dbReal.close();
}

// Conexión compartida para los módulos de la fase 2 (recordatorios, metas, etc.)
export const base = () => db;

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
      `SELECT id, tipo, monto, categoria, descripcion, fecha,
              CASE
                WHEN EXISTS (SELECT 1 FROM prestamos p WHERE p.usuario = movimientos.usuario AND p.movimiento_id = movimientos.id AND p.tipo = 'presto') THEN 'prestamo'
                WHEN EXISTS (SELECT 1 FROM prestamos p WHERE p.usuario = movimientos.usuario AND p.movimiento_id = movimientos.id AND p.tipo = 'pago') THEN 'cobro'
                WHEN EXISTS (SELECT 1 FROM deudas d WHERE d.usuario = movimientos.usuario AND d.movimiento_id = movimientos.id AND d.tipo <> 'debo') THEN 'abono_deuda'
                ELSE NULL
              END AS origen
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
  return enTransaccion(() => borrarMovimientoAtomico(usuario, id));
}

function borrarMovimientoAtomico(usuario, id) {
  if (prestamoProtegido(usuario, id)) return null;
  const fila = db.prepare(
    `SELECT id, tipo, monto, categoria, descripcion, fecha
       FROM movimientos WHERE usuario = ? AND id = ?
         AND creado >= datetime('now', '-1 day')`,
  ).get(usuario, id);
  if (!fila) return null;
  const resultado = db.prepare('DELETE FROM movimientos WHERE usuario = ? AND id = ?').run(usuario, id);
  // Si ese movimiento era el gasto de un abono, el abono también se deshace
  if (resultado.changes) {
    db.prepare('DELETE FROM deudas WHERE usuario = ? AND movimiento_id = ?').run(usuario, id);
    db.prepare('DELETE FROM prestamos WHERE usuario = ? AND movimiento_id = ?').run(usuario, id);
  }
  return resultado.changes ? fila : null;
}

// --- Escritura desde la web: siempre acotada al usuario de la sesión ---
export function obtenerMovimiento(usuario, id) {
  return db.prepare(
    `SELECT id, tipo, monto, categoria, descripcion, fecha,
            EXISTS (SELECT 1 FROM prestamos p WHERE p.usuario = movimientos.usuario AND p.movimiento_id = movimientos.id)
         OR EXISTS (SELECT 1 FROM deudas d WHERE d.usuario = movimientos.usuario AND d.movimiento_id = movimientos.id AND d.tipo <> 'debo') AS ligado
       FROM movimientos WHERE usuario = ? AND id = ?`,
  ).get(usuario, id) ?? null;
}

export function registrarAuditoria({ usuario, accion, entidad, entidadId = null, origen = 'bot', detalle = null }) {
  db.prepare('INSERT INTO auditoria (usuario, accion, entidad, entidad_id, origen, detalle) VALUES (?, ?, ?, ?, ?, ?)')
    .run(usuario, accion, entidad, entidadId, origen, detalle ? JSON.stringify(detalle).slice(0, 2000) : null);
}

export function listarAuditoria(usuario, limite = 50) {
  return db.prepare('SELECT id, accion, entidad, entidad_id, origen, detalle, creada_en FROM auditoria WHERE usuario = ? ORDER BY id DESC LIMIT ?')
    .all(usuario, Math.min(Math.max(Number(limite) || 50, 1), 200));
}

// Actualiza solo los campos recibidos. Devuelve {antes, despues}, o null si no existe o es de otra cuenta.
export function editarMovimiento(usuario, id, cambios, origen = 'web') {
  return enTransaccion(() => {
    const antes = obtenerMovimiento(usuario, id);
    if (!antes || antes.ligado) return null;
    const campos = ['tipo', 'monto', 'categoria', 'descripcion', 'fecha'].filter((c) => cambios[c] !== undefined);
    if (!campos.length) return null;
    db.prepare(`UPDATE movimientos SET ${campos.map((c) => `${c} = ?`).join(', ')} WHERE usuario = ? AND id = ?`)
      .run(...campos.map((c) => cambios[c]), usuario, id);
    const despues = obtenerMovimiento(usuario, id);
    registrarAuditoria({ usuario, accion: 'editar', entidad: 'movimiento', entidadId: id, origen, detalle: { antes: { ...antes, ligado: undefined }, despues: { ...despues, ligado: undefined } } });
    return { antes, despues };
  });
}

// Borra un movimiento propio sin límite de tiempo (el /deshacer del chat solo alcanza las últimas 24 h).
export function eliminarMovimiento(usuario, id, origen = 'web') {
  return enTransaccion(() => {
    const fila = obtenerMovimiento(usuario, id);
    if (!fila || fila.ligado) return null;
    db.prepare('DELETE FROM movimientos WHERE usuario = ? AND id = ?').run(usuario, id);
    registrarAuditoria({ usuario, accion: 'eliminar', entidad: 'movimiento', entidadId: id, origen, detalle: { ...fila, ligado: undefined } });
    return fila;
  });
}

// Totales de ingresos y gastos, y gastos por categoría, entre dos fechas
// (Para cifras sin préstamos ni pagos de deudas usar finanzas.operativo)
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
export function guardarCodigo(datos) {
  return enTransaccion(() => guardarCodigoAtomico(datos));
}

function guardarCodigoAtomico({ usuarioId, hash, ahora, expira }) {
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

// --- Borrado masivo (a petición de la persona, con confirmación previa en acciones.js) ---
export const ALCANCES_BORRADO = ['todo', 'movimientos', 'ingresos', 'gastos', 'deudas', 'prestamos', 'presupuestos'];

const tocaMovimientos = (alcance) => ['todo', 'movimientos', 'ingresos', 'gastos'].includes(alcance);
const filtroTipo = (alcance) => (alcance === 'ingresos' ? "AND tipo = 'ingreso'" : alcance === 'gastos' ? "AND tipo = 'gasto'" : '');

// Cuántas filas de esta persona se borrarían. Los abonos de deuda ligados a un gasto borrado
// también se van (si no, quedaría un abono sin el gasto que lo respalda).
export function contarBorrado(usuario, alcance) {
  if (!ALCANCES_BORRADO.includes(alcance)) throw new Error('Alcance de borrado no válido');
  const cuenta = (sql, ...parametros) => Number(db.prepare(sql).get(...parametros).n);
  const filtro = filtroTipo(alcance);
  // filas de una tabla de libreta ligadas a los movimientos que se van a borrar
  const ligadas = (tabla) => cuenta(
    `SELECT COUNT(*) AS n FROM ${tabla} WHERE usuario = ? AND movimiento_id IN (SELECT id FROM movimientos WHERE usuario = ? ${filtro})`, usuario, usuario);
  return {
    movimientos: tocaMovimientos(alcance)
      ? cuenta(`SELECT COUNT(*) AS n FROM movimientos WHERE usuario = ? ${filtro}`, usuario)
      : 0,
    deudas: ['todo', 'deudas'].includes(alcance)
      ? cuenta('SELECT COUNT(*) AS n FROM deudas WHERE usuario = ?', usuario)
      : tocaMovimientos(alcance) && alcance !== 'ingresos' ? ligadas('deudas') : 0,
    prestamos: ['todo', 'prestamos'].includes(alcance)
      ? cuenta('SELECT COUNT(*) AS n FROM prestamos WHERE usuario = ?', usuario)
      : tocaMovimientos(alcance) ? ligadas('prestamos') : 0,
    presupuestos: ['todo', 'presupuestos'].includes(alcance)
      ? cuenta('SELECT COUNT(*) AS n FROM presupuestos WHERE usuario = ?', usuario)
      : 0,
    // /borrar todo debe advertir también sobre los datos de fase 2
    // incluso cuando el usuario aún no tiene movimientos financieros.
    recordatorios: alcance === 'todo' ? cuenta('SELECT COUNT(*) AS n FROM recordatorios WHERE usuario = ?', usuario) : 0,
    recurrentes: alcance === 'todo' ? cuenta('SELECT COUNT(*) AS n FROM recurrentes WHERE usuario = ?', usuario) : 0,
    metas: alcance === 'todo' ? cuenta('SELECT COUNT(*) AS n FROM metas WHERE usuario = ?', usuario) : 0,
    alertas: alcance === 'todo'
      ? cuenta('SELECT COUNT(*) AS n FROM alertas_config WHERE usuario = ?', usuario)
        + cuenta('SELECT COUNT(*) AS n FROM alertas_enviadas WHERE usuario = ?', usuario)
      : 0,
    contexto: alcance === 'todo' ? cuenta('SELECT COUNT(*) AS n FROM contexto WHERE usuario = ?', usuario) : 0,
  };
}

// Borra de verdad. Solo toca filas de este usuario. Debe llamarse dentro de una transacción.
export function borrarDatos(usuario, alcance) {
  return enTransaccion(() => borrarDatosAtomico(usuario, alcance));
}

function borrarDatosAtomico(usuario, alcance) {
  // Borrar solo gastos podría dejar cobros sin el préstamo que los respalda.
  if (alcance === 'gastos' && db.prepare("SELECT 1 FROM prestamos WHERE usuario = ? AND tipo = 'pago' LIMIT 1").get(usuario)) {
    const error = new Error('No se pueden borrar los gastos mientras haya cobros de préstamos. Revisa los préstamos o elige borrar todos los movimientos.');
    error.code = 'INTEGRIDAD_FINANCIERA';
    throw error;
  }
  const cantidades = contarBorrado(usuario, alcance);
  const filtro = filtroTipo(alcance);
  const ligadas = (tabla) => db.prepare(
    `DELETE FROM ${tabla} WHERE usuario = ? AND movimiento_id IN (SELECT id FROM movimientos WHERE usuario = ? ${filtro})`).run(usuario, usuario);
  if (tocaMovimientos(alcance) && alcance !== 'todo') {
    if (alcance !== 'ingresos') ligadas('deudas');
    ligadas('prestamos');
  }
  if (['todo', 'deudas'].includes(alcance)) db.prepare('DELETE FROM deudas WHERE usuario = ?').run(usuario);
  if (['todo', 'prestamos'].includes(alcance)) db.prepare('DELETE FROM prestamos WHERE usuario = ?').run(usuario);
  if (tocaMovimientos(alcance)) db.prepare(`DELETE FROM movimientos WHERE usuario = ? ${filtro}`).run(usuario);
  if (['todo', 'presupuestos'].includes(alcance)) db.prepare('DELETE FROM presupuestos WHERE usuario = ?').run(usuario);
  if (alcance === 'todo') borrarDatosFase2(usuario);
  return cantidades;
}

// "Borrar todo" también limpia lo de la fase 2 (recordatorios, recurrentes, metas, alertas y contexto) de esa persona
function borrarDatosFase2(usuario) {
  db.prepare('DELETE FROM recurrentes_ejecuciones WHERE recurrente_id IN (SELECT id FROM recurrentes WHERE usuario = ?)').run(usuario);
  db.prepare('DELETE FROM metas_aportes WHERE usuario = ?').run(usuario);
  for (const tabla of ['recordatorios', 'recurrentes', 'metas', 'alertas_config', 'alertas_enviadas', 'contexto']) {
    db.prepare(`DELETE FROM ${tabla} WHERE usuario = ?`).run(usuario);
  }
}

// --- Preferencias por persona (por ejemplo, si quiere recibir consejos) ---
db.exec(`
  CREATE TABLE IF NOT EXISTS preferencias (
    usuario TEXT NOT NULL,
    clave   TEXT NOT NULL,
    valor   TEXT NOT NULL,
    PRIMARY KEY (usuario, clave)
  );
`);

export function preferencia(usuario, clave) {
  return db.prepare('SELECT valor FROM preferencias WHERE usuario = ? AND clave = ?').get(usuario, clave)?.valor ?? null;
}

export function fijarPreferencia(usuario, clave, valor) {
  db.prepare(
    'INSERT INTO preferencias (usuario, clave, valor) VALUES (?, ?, ?) ON CONFLICT (usuario, clave) DO UPDATE SET valor = excluded.valor',
  ).run(usuario, clave, String(valor));
}

// --- Préstamos que hace la persona ("me deben") ---
// Cada fila es un préstamo ('presto') o un pago recibido ('pago'), y va ligada a su movimiento:
// prestar saca plata del saldo (gasto en Préstamos) y cobrar la devuelve (ingreso en Préstamos).
// Lo que te debe alguien es la suma de lo prestado menos la suma de lo que te ha pagado.
db.exec(`
  CREATE TABLE IF NOT EXISTS prestamos (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario       TEXT    NOT NULL,
    persona       TEXT    NOT NULL,
    clave         TEXT    NOT NULL,
    tipo          TEXT    NOT NULL CHECK (tipo IN ('presto', 'pago')),
    monto         INTEGER NOT NULL CHECK (monto > 0),
    descripcion   TEXT    NOT NULL DEFAULT '',
    fecha         TEXT    NOT NULL,
    movimiento_id INTEGER,
    creado        TEXT    NOT NULL DEFAULT (datetime('now')),
    mensaje_id    TEXT    UNIQUE
  );
  CREATE INDEX IF NOT EXISTS idx_prestamos_usuario ON prestamos (usuario, clave);
`);

// Devuelve el id nuevo, o null si ese mensaje ya estaba registrado.
export function agregarPrestamo({ usuario, persona, tipo, monto, descripcion, fecha, movimientoId, mensajeId }) {
  const r = db
    .prepare(
      `INSERT INTO prestamos (usuario, persona, clave, tipo, monto, descripcion, fecha, movimiento_id, mensaje_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (mensaje_id) DO NOTHING`,
    )
    .run(usuario, persona, clavePersona(persona), tipo, monto, descripcion ?? '', fecha, movimientoId ?? null, mensajeId ?? null);
  return r.changes === 0 ? null : Number(r.lastInsertRowid);
}

// Personas a las que has prestado, con lo que te deben hoy (nunca negativo). Mayor deuda primero.
export function resumenPrestamos(usuario) {
  return db
    .prepare(
      `SELECT d.clave AS clave,
              (SELECT p.persona FROM prestamos p WHERE p.usuario = d.usuario AND p.clave = d.clave ORDER BY p.id LIMIT 1) AS persona,
              SUM(CASE d.tipo WHEN 'presto' THEN d.monto ELSE -d.monto END) AS saldo,
              SUM(CASE d.tipo WHEN 'presto' THEN d.monto ELSE 0 END) AS prestado,
              SUM(CASE d.tipo WHEN 'pago' THEN d.monto ELSE 0 END) AS pagado
         FROM prestamos d
        WHERE d.usuario = ?
        GROUP BY d.clave
        ORDER BY saldo DESC, persona`,
    )
    .all(usuario)
    .map((f) => ({ clave: f.clave, persona: f.persona, saldo: Math.max(Number(f.saldo), 0), prestado: Number(f.prestado), pagado: Number(f.pagado) }));
}

export function historialPrestamo(usuario, clave, limite = 5) {
  return db
    .prepare('SELECT tipo, monto, descripcion, fecha FROM prestamos WHERE usuario = ? AND clave = ? ORDER BY id DESC LIMIT ?')
    .all(usuario, clave, limite);
}

// Si borrar este movimiento dejaría a alguien con más pagos que préstamos, devuelve su nombre
// (no se debe borrar el préstamo original mientras existan pagos que lo respaldan).
export function prestamoProtegido(usuario, movimientoId) {
  const fila = db.prepare("SELECT persona, clave, monto FROM prestamos WHERE usuario = ? AND movimiento_id = ? AND tipo = 'presto'").get(usuario, movimientoId);
  if (!fila) return null;
  const { saldo } = db
    .prepare("SELECT COALESCE(SUM(CASE tipo WHEN 'presto' THEN monto ELSE -monto END), 0) AS saldo FROM prestamos WHERE usuario = ? AND clave = ?")
    .get(usuario, fila.clave);
  return Number(saldo) - fila.monto < 0 ? fila.persona : null;
}

// Todas las tablas base ya existen; las migraciones aditivas pueden referenciarlas.
migrar(db, archivoDB);
