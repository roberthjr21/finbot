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
