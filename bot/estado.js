#!/usr/bin/env node
// Diagnóstico de solo lectura; no carga .env, WhatsApp ni migra la base.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function estadoArchivo(archivo) {
  if (!fs.existsSync(archivo)) throw new Error('La base debe existir');
  const b = new DatabaseSync(archivo, { readOnly: true });
  try {
    const integridad = b.prepare('PRAGMA integrity_check').all();
    if (integridad.length !== 1 || integridad[0].integrity_check !== 'ok') throw new Error('La base no pasó la verificación de integridad');
    const version = b.prepare('SELECT MAX(version) AS version FROM schema_migraciones').get().version;
    const trabajos = version >= 6 ? b.prepare('SELECT tipo, estado, COUNT(*) AS cantidad, MIN(creado) AS mas_antiguo FROM trabajos GROUP BY tipo, estado').all() : [];
    const disco = fs.statfsSync(path.dirname(path.resolve(archivo)), { bigint: true });
    return { integridad: 'ok', version, trabajos, espacioLibreBytes: String(disco.bavail * disco.bsize) };
  } finally { b.close(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { if (!process.argv[2]) throw new Error('Uso: node estado.js <base existente>'); console.log(JSON.stringify(estadoArchivo(process.argv[2]), null, 2)); }
  catch (e) { console.error(e.message); process.exitCode = 1; }
}
