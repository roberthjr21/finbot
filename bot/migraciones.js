import fs from 'node:fs';
import { crearRespaldo } from './db-admin.js';

// Migraciones versionadas. Reglas:
//  • Solo se AGREGAN al final; una migración ya publicada nunca se edita.
//  • Solo cambios aditivos (tablas, columnas, índices). Nada que borre o reescriba datos.
//  • Cada una corre dentro de una transacción y queda registrada en schema_migraciones.
//  • Si hay migraciones pendientes y la base ya tiene datos, antes se guarda una copia verificada;
//    si la copia falla, no se migra.
// La versión 1 es el esquema que ya existía (tablas creadas con CREATE TABLE IF NOT EXISTS en db.js).
export const MIGRACIONES = [
  { version: 1, nombre: 'esquema base', sql: null },
  {
    version: 2,
    nombre: 'auditoria',
    sql: `
      CREATE TABLE IF NOT EXISTS auditoria (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        usuario    TEXT    NOT NULL,
        accion     TEXT    NOT NULL,
        entidad    TEXT    NOT NULL,
        entidad_id INTEGER,
        origen     TEXT    NOT NULL DEFAULT 'bot' CHECK (origen IN ('bot', 'web', 'sistema')),
        detalle    TEXT,
        creada_en  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      CREATE INDEX IF NOT EXISTS idx_auditoria_usuario ON auditoria (usuario, id DESC);
    `,
  },
  {
    version: 3,
    nombre: 'fase 2: recordatorios, recurrentes, metas, alertas y contexto',
    sql: `
      CREATE TABLE IF NOT EXISTS recordatorios (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        usuario    TEXT    NOT NULL,
        texto      TEXT    NOT NULL,
        monto      INTEGER CHECK (monto IS NULL OR monto > 0),
        vence      TEXT    NOT NULL,
        hora       TEXT    NOT NULL DEFAULT '09:00',
        estado     TEXT    NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'enviado', 'completado', 'cancelado')),
        enviado_en TEXT,
        creado     TEXT    NOT NULL DEFAULT (datetime('now')),
        mensaje_id TEXT    UNIQUE
      );
      CREATE INDEX IF NOT EXISTS idx_recordatorios_usuario ON recordatorios (usuario, estado, vence);
      CREATE INDEX IF NOT EXISTS idx_recordatorios_estado ON recordatorios (estado, vence);

      CREATE TABLE IF NOT EXISTS recurrentes (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        usuario     TEXT    NOT NULL,
        tipo        TEXT    NOT NULL CHECK (tipo IN ('gasto', 'ingreso')),
        monto       INTEGER NOT NULL CHECK (monto > 0),
        categoria   TEXT    NOT NULL,
        descripcion TEXT    NOT NULL DEFAULT '',
        frecuencia  TEXT    NOT NULL CHECK (frecuencia IN ('diaria', 'semanal', 'quincenal', 'mensual')),
        dia_mes     INTEGER CHECK (dia_mes IS NULL OR (dia_mes BETWEEN 1 AND 31)),
        proxima     TEXT    NOT NULL,
        estado      TEXT    NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'pausado', 'eliminado')),
        creado      TEXT    NOT NULL DEFAULT (datetime('now')),
        mensaje_id  TEXT    UNIQUE
      );
      CREATE INDEX IF NOT EXISTS idx_recurrentes_usuario ON recurrentes (usuario, estado);

      -- "Programado" vive en recurrentes.proxima; "ejecutado" vive aquí. La clave primaria impide ejecutar dos veces la misma fecha.
      CREATE TABLE IF NOT EXISTS recurrentes_ejecuciones (
        recurrente_id INTEGER NOT NULL REFERENCES recurrentes (id),
        fecha         TEXT    NOT NULL,
        movimiento_id INTEGER,
        creada        TEXT    NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (recurrente_id, fecha)
      );

      CREATE TABLE IF NOT EXISTS metas (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        usuario      TEXT    NOT NULL,
        nombre       TEXT    NOT NULL,
        objetivo     INTEGER NOT NULL CHECK (objetivo > 0),
        aporte       INTEGER CHECK (aporte IS NULL OR aporte > 0),
        frecuencia   TEXT    CHECK (frecuencia IS NULL OR frecuencia IN ('semanal', 'quincenal', 'mensual')),
        fecha_limite TEXT,
        estado       TEXT    NOT NULL DEFAULT 'activa' CHECK (estado IN ('activa', 'cumplida', 'cancelada')),
        creado       TEXT    NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_metas_usuario ON metas (usuario, estado);

      -- Los aportes a metas viven aquí y NO crean movimientos: así el ahorro no se cuenta dos veces.
      CREATE TABLE IF NOT EXISTS metas_aportes (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        meta_id    INTEGER NOT NULL REFERENCES metas (id),
        usuario    TEXT    NOT NULL,
        monto      INTEGER NOT NULL CHECK (monto <> 0),
        fecha      TEXT    NOT NULL,
        creado     TEXT    NOT NULL DEFAULT (datetime('now')),
        mensaje_id TEXT    UNIQUE
      );
      CREATE INDEX IF NOT EXISTS idx_metas_aportes ON metas_aportes (meta_id);

      CREATE TABLE IF NOT EXISTS alertas_config (
        usuario        TEXT    PRIMARY KEY,
        presupuestos   INTEGER NOT NULL DEFAULT 1,
        picos          INTEGER NOT NULL DEFAULT 1,
        pagos          INTEGER NOT NULL DEFAULT 1,
        deudas         INTEGER NOT NULL DEFAULT 1,
        metas          INTEGER NOT NULL DEFAULT 1,
        cierre         INTEGER NOT NULL DEFAULT 1,
        silencio_desde TEXT    NOT NULL DEFAULT '22:00',
        silencio_hasta TEXT    NOT NULL DEFAULT '07:00',
        max_diarias    INTEGER NOT NULL DEFAULT 5 CHECK (max_diarias BETWEEN 1 AND 20)
      );

      -- Una alerta con la misma clave no se vuelve a enviar (evita repetirla tras reinicios).
      CREATE TABLE IF NOT EXISTS alertas_enviadas (
        usuario TEXT NOT NULL,
        clave   TEXT NOT NULL,
        dia     TEXT NOT NULL,
        creada  TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (usuario, clave)
      );

      -- Contexto de conversación por persona, con vencimiento (milisegundos desde 1970).
      CREATE TABLE IF NOT EXISTS contexto (
        usuario     TEXT    PRIMARY KEY,
        datos       TEXT    NOT NULL,
        actualizado INTEGER NOT NULL
      );
    `,
  },
  {
    version: 4,
    nombre: 'limites persistentes de seguridad',
    sql: `
      CREATE TABLE IF NOT EXISTS limites_intentos (
        id INTEGER PRIMARY KEY,
        ambito TEXT NOT NULL,
        clave TEXT NOT NULL,
        instante INTEGER NOT NULL,
        expira INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_limites_clave ON limites_intentos (ambito, clave, instante);
      CREATE INDEX IF NOT EXISTS idx_limites_expira ON limites_intentos (expira);
    `,
  },
  { version: 5, nombre: 'historial de eliminaciones financieras', sql: `
CREATE TRIGGER IF NOT EXISTS auditoria_borrado_movimientos AFTER DELETE ON movimientos
      BEGIN
        INSERT INTO auditoria (usuario, accion, entidad, entidad_id, origen, detalle)
        VALUES (OLD.usuario, 'eliminar_registro', 'movimiento', OLD.id, 'sistema', json_object('id', OLD.id, 'usuario', OLD.usuario, 'tipo', OLD.tipo, 'monto', OLD.monto, 'fecha', OLD.fecha, 'categoria', OLD.categoria, 'descripcion', OLD.descripcion));
      END;
CREATE TRIGGER IF NOT EXISTS auditoria_borrado_deudas AFTER DELETE ON deudas
      BEGIN
        INSERT INTO auditoria (usuario, accion, entidad, entidad_id, origen, detalle)
        VALUES (OLD.usuario, 'eliminar_registro', 'deuda', OLD.id, 'sistema', json_object('id', OLD.id, 'usuario', OLD.usuario, 'persona', OLD.persona, 'tipo', OLD.tipo, 'monto', OLD.monto, 'fecha', OLD.fecha, 'movimiento_id', OLD.movimiento_id, 'descripcion', OLD.descripcion));
      END;
CREATE TRIGGER IF NOT EXISTS auditoria_borrado_prestamos AFTER DELETE ON prestamos
      BEGIN
        INSERT INTO auditoria (usuario, accion, entidad, entidad_id, origen, detalle)
        VALUES (OLD.usuario, 'eliminar_registro', 'prestamo', OLD.id, 'sistema', json_object('id', OLD.id, 'usuario', OLD.usuario, 'persona', OLD.persona, 'tipo', OLD.tipo, 'monto', OLD.monto, 'fecha', OLD.fecha, 'movimiento_id', OLD.movimiento_id, 'descripcion', OLD.descripcion));
      END;
  ` },
  { version: 6, nombre: 'cola persistente, outbox y privacidad minimizada', sql: `
      CREATE INDEX idx_codigos_expira ON codigos_login(expira);
      CREATE INDEX idx_sesiones_expira ON sesiones_web(expira);
      CREATE INDEX idx_sesiones_revocadas ON sesiones_web(revocada) WHERE revocada = 1;
      ALTER TABLE recordatorios ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
      CREATE TABLE trabajos (
        id INTEGER PRIMARY KEY,
        clave TEXT NOT NULL UNIQUE,
        usuario TEXT NOT NULL,
        tipo TEXT NOT NULL CHECK (tipo IN ('entrada','salida')),
        contenido TEXT,
        estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','procesando','hecho','agotado','cancelado')),
        intentos INTEGER NOT NULL DEFAULT 0,
        disponible INTEGER NOT NULL,
        creado INTEGER NOT NULL,
        expira INTEGER NOT NULL,
        lease_hasta INTEGER NOT NULL DEFAULT 0,
        dueno TEXT,
        ultimo_inicio INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        avisado INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX idx_trabajos_listos ON trabajos(tipo, estado, disponible, id);
      CREATE INDEX idx_trabajos_usuario ON trabajos(usuario, tipo, id);
      CREATE UNIQUE INDEX idx_trabajos_exclusion ON trabajos(usuario, tipo) WHERE estado = 'procesando';
      CREATE TABLE alertas_reservadas (
        usuario TEXT NOT NULL, clave TEXT NOT NULL, trabajo_id INTEGER NOT NULL, dia TEXT NOT NULL,
        PRIMARY KEY (usuario, clave)
      );
      CREATE TABLE privacidad_solicitudes (
        usuario TEXT PRIMARY KEY,
        nonce_hash TEXT NOT NULL,
        huella TEXT NOT NULL,
        expira INTEGER NOT NULL
      );

      DROP TRIGGER IF EXISTS auditoria_borrado_movimientos;
      CREATE TRIGGER auditoria_borrado_movimientos AFTER DELETE ON movimientos
      BEGIN
        INSERT INTO auditoria (usuario, accion, entidad, entidad_id, origen, detalle)
        VALUES (OLD.usuario, 'eliminar_registro', 'movimiento', OLD.id, 'sistema',
          json_object('id', OLD.id, 'tipo', OLD.tipo, 'monto', OLD.monto, 'fecha', OLD.fecha));
      END;

      DROP TRIGGER IF EXISTS auditoria_borrado_deudas;
      CREATE TRIGGER auditoria_borrado_deudas AFTER DELETE ON deudas
      BEGIN
        INSERT INTO auditoria (usuario, accion, entidad, entidad_id, origen, detalle)
        VALUES (OLD.usuario, 'eliminar_registro', 'deuda', OLD.id, 'sistema',
          json_object('id', OLD.id, 'tipo', OLD.tipo, 'monto', OLD.monto, 'fecha', OLD.fecha));
      END;

      DROP TRIGGER IF EXISTS auditoria_borrado_prestamos;
      CREATE TRIGGER auditoria_borrado_prestamos AFTER DELETE ON prestamos
      BEGIN
        INSERT INTO auditoria (usuario, accion, entidad, entidad_id, origen, detalle)
        VALUES (OLD.usuario, 'eliminar_registro', 'prestamo', OLD.id, 'sistema',
          json_object('id', OLD.id, 'tipo', OLD.tipo, 'monto', OLD.monto, 'fecha', OLD.fecha));
      END;

  ` },
  { version: 7, nombre: 'retención de trabajos con deduplicación minimizada', sql: `
    CREATE TABLE trabajos_huellas (huella TEXT PRIMARY KEY, usuario_hash TEXT NOT NULL) WITHOUT ROWID;
    CREATE INDEX idx_trabajos_huellas_usuario ON trabajos_huellas(usuario_hash);
    CREATE INDEX idx_trabajos_retencion ON trabajos(estado, expira);
  ` },
  { version: 8, nombre: 'modo capturado en la admisión de entradas', sql: `
    ALTER TABLE trabajos ADD COLUMN modo_operacion TEXT CHECK (modo_operacion IN ('real','prueba'));
    ALTER TABLE trabajos ADD COLUMN sesion_prueba TEXT;
    ALTER TABLE trabajos ADD COLUMN control_modo TEXT;
    CREATE TABLE entrada_modos (usuario TEXT PRIMARY KEY, modo TEXT NOT NULL CHECK (modo IN ('real','prueba')), sesion TEXT);
    UPDATE trabajos SET estado='cancelado', contenido=NULL, dueno=NULL, lease_hasta=0, error='modo_heredado_desconocido', avisado=0
      WHERE tipo='entrada' AND estado IN ('pendiente','procesando');
  ` },
  { version: 9, nombre: 'análisis recuperables y carriles de salida', sql: `
    ALTER TABLE trabajos ADD COLUMN clase TEXT NOT NULL DEFAULT 'mensaje' CHECK (clase IN ('mensaje','analisis'));
    ALTER TABLE trabajos ADD COLUMN carril TEXT NOT NULL DEFAULT 'conversacion' CHECK (carril IN ('conversacion','notificacion'));
    ALTER TABLE trabajos ADD COLUMN esperando INTEGER NOT NULL DEFAULT 0 CHECK (esperando IN (0,1));
    ALTER TABLE trabajos ADD COLUMN dependencia INTEGER;
    CREATE INDEX idx_trabajos_orden ON trabajos(usuario,tipo,carril,estado,id);
    CREATE INDEX idx_trabajos_dependencia ON trabajos(dependencia) WHERE esperando=1;
  ` },
];

const hayDatos = (db) =>
  ['movimientos', 'presupuestos', 'deudas', 'prestamos'].some((t) => {
    try { return Boolean(db.prepare(`SELECT 1 FROM ${t} LIMIT 1`).get()); } catch { return false; }
  });

export function versionActual(db) {
  return db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM schema_migraciones').get().v;
}

// Aplica lo pendiente. Devuelve las versiones aplicadas.
export function migrar(db, archivo, migraciones = MIGRACIONES) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migraciones (
      version     INTEGER PRIMARY KEY,
      nombre      TEXT NOT NULL,
      aplicada_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);
  const actual = versionActual(db);
  const pendientes = migraciones.filter((m) => m.version > actual).sort((a, b) => a.version - b.version);
  if (pendientes.length === 0) return [];

  // La versión 1 solo registra el esquema que ya existe; no necesita copia.
  const conCambios = pendientes.filter((m) => m.sql);
  if (conCambios.length > 0 && actual > 0 && archivo !== ':memory:' && hayDatos(db)) {
    const destino = `${archivo}.antes-v${conCambios[0].version}-${new Date().toISOString().replace(/[:.]/g, '-')}.db`;
    crearRespaldo(archivo, destino); // verifica integridad al crearla; si falla, lanza y no se migra
    console.log(`💾 Copia verificada antes de migrar a v${pendientes.at(-1).version}: ${destino}`);
  }

  const aplicadas = [];
  for (const m of pendientes) {
    db.exec('BEGIN IMMEDIATE');
    try {
      // Otro proceso pudo aplicar esta versión mientras esperábamos el escritor.
      if (db.prepare('SELECT 1 FROM schema_migraciones WHERE version = ?').get(m.version)) {
        db.exec('COMMIT');
        continue;
      }
      if (m.sql) db.exec(m.sql);
      db.prepare('INSERT INTO schema_migraciones (version, nombre) VALUES (?, ?)').run(m.version, m.nombre);
      db.exec('COMMIT');
      aplicadas.push(m.version);
    } catch (error) {
      db.exec('ROLLBACK');
      throw new Error(`Falló la migración v${m.version} (${m.nombre}): ${error.message}`);
    }
  }
  return aplicadas;
}
