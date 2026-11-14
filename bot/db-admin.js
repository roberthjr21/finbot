#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

export function validarBase(archivo) {
  const db = new DatabaseSync(archivo, { readOnly: true });
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    const integridad = db.prepare('PRAGMA integrity_check').all();
    if (integridad.length !== 1 || integridad[0]?.integrity_check !== 'ok') {
      throw new Error(`La base no pasó integrity_check: ${integridad.map((fila) => fila.integrity_check).join('; ') || 'sin resultado'}.`);
    }
    const esquema = {
      movimientos: {
        columnas: { id: 'INTEGER', usuario: 'TEXT', tipo: 'TEXT', monto: 'INTEGER', categoria: 'TEXT', descripcion: 'TEXT', fecha: 'TEXT', creado: 'TEXT', mensaje_id: 'TEXT' },
        pk: { id: 1 },
        nullable: ['mensaje_id'],
        restricciones: ["CHECK (tipo IN ('gasto', 'ingreso'))", 'CHECK (monto > 0)', 'UNIQUE'],
      },
      presupuestos: {
        columnas: { usuario: 'TEXT', categoria: 'TEXT', limite: 'INTEGER' },
        pk: { usuario: 1, categoria: 2 },
        restricciones: ['CHECK (limite > 0)'],
      },
      procesados: { columnas: { id: 'TEXT', creado: 'TEXT' }, pk: { id: 1 }, restricciones: [] },
    };
    for (const [tabla, definicion] of Object.entries(esquema)) {
      const filas = db.prepare(`PRAGMA table_info(${tabla})`).all();
      if (filas.length === 0) throw new Error(`Falta la tabla requerida: ${tabla}.`);
      const existentes = new Map(filas.map((r) => [r.name, r]));
      for (const [columna, tipo] of Object.entries(definicion.columnas)) {
        const fila = existentes.get(columna);
        if (!fila || fila.type.toUpperCase() !== tipo) {
          throw new Error(`Esquema incompatible en ${tabla}.${columna}; se esperaba ${tipo}.`);
        }
        if ((definicion.pk[columna] ?? 0) !== (fila.pk || 0)) {
          throw new Error(`Esquema incompatible: clave primaria incorrecta en ${tabla}.${columna}.`);
        }
        if (!definicion.pk[columna] && !definicion.nullable?.includes(columna) && fila.notnull !== 1) {
          throw new Error(`La columna ${tabla}.${columna} debe ser NOT NULL.`);
        }
      }
      const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(tabla)?.sql ?? '';
      const normalizado = sql.toUpperCase().replace(/[\"`\[\]]/g, '').replace(/\s+/g, '');
      for (const restriccion of definicion.restricciones) {
        if (!normalizado.includes(restriccion.toUpperCase().replace(/\s+/g, ''))) {
          throw new Error(`Falta la restricción esperada en ${tabla}: ${restriccion}.`);
        }
      }
    }
    const indices = db.prepare('PRAGMA index_list(movimientos)').all();
    const indiceFechas = indices.find((indice) => indice.name === 'idx_mov_usuario_fecha');
    const columnasFecha = indiceFechas
      ? db.prepare(`PRAGMA index_info('${indiceFechas.name.replaceAll("'", "''")}')`).all().map((columna) => columna.name)
      : [];
    if (columnasFecha.join(',') !== 'usuario,fecha') {
      throw new Error('Falta el índice requerido idx_mov_usuario_fecha.');
    }
    const unicoMensaje = indices.find((indice) => indice.unique && db.prepare(`PRAGMA index_info('${indice.name.replaceAll("'", "''")}')`).all().some((columna) => columna.name === 'mensaje_id'));
    if (!unicoMensaje) throw new Error('Falta la unicidad requerida de movimientos.mensaje_id.');
  } finally {
    db.close();
  }
}

export function sumaArchivo(archivo) {
  const h = createHash('sha256');
  const fd = fs.openSync(archivo, 'r');
  const buffer = Buffer.alloc(1024 * 1024);
  try { let n; while ((n = fs.readSync(fd, buffer, 0, buffer.length, null))) h.update(buffer.subarray(0,n)); }
  finally { fs.closeSync(fd); }
  return h.digest('hex');
}
export function verificarRespaldo(archivo) {
  validarBase(archivo);
  const suma = sumaArchivo(archivo);
  if (fs.existsSync(`${archivo}.sha256`) && fs.readFileSync(`${archivo}.sha256`, 'utf8').trim() !== suma) throw new Error('El respaldo no coincide con su checksum SHA-256');
  return suma;
}
export function comprobarEspacio(origen, destino, { reservaBytes = 64 * 1024 * 1024, statfs = fs.statfsSync } = {}) {
  let carpeta = path.dirname(path.resolve(destino));
  while (!fs.existsSync(carpeta)) carpeta = path.dirname(carpeta);
  const disco = statfs(carpeta, { bigint: true });
  const libre = BigInt(disco.bavail) * BigInt(disco.bsize);
  const bytesWal = fs.existsSync(`${origen}-wal`) ? fs.statSync(`${origen}-wal`).size : 0;
  const necesarios = (BigInt(fs.statSync(origen).size) + BigInt(bytesWal)) * 3n + BigInt(reservaBytes);
  if (libre < necesarios) throw new Error('Espacio insuficiente para crear y verificar la copia sin poner en riesgo la base');
  return { libre: String(libre), necesarios: String(necesarios) };
}

export function crearRespaldo(origen, destino) {
  const src = path.resolve(origen);
  const dst = path.resolve(destino);
  if (src === dst) throw new Error('El origen y el destino deben ser distintos.');
  if (fs.existsSync(dst)) throw new Error('El archivo de destino ya existe; no se sobrescribió.');
  comprobarEspacio(src, dst);
  fs.mkdirSync(path.dirname(dst), { recursive: true, mode: 0o700 });
  validarBase(src);
  const temporal = path.join(path.dirname(dst), `.${path.basename(dst)}.backup-${randomUUID()}.db`);
  try {
    const db = new DatabaseSync(src);
    try {
      db.exec('PRAGMA busy_timeout = 5000');
      // VACUUM INTO captura un snapshot consistente, incluyendo páginas aún
      // presentes en WAL; no depende de que un checkpoint termine primero.
      const literal = temporal.replaceAll("'", "''");
      db.exec(`VACUUM INTO '${literal}'`);
      fs.chmodSync(temporal, 0o600);
    } finally {
      db.close();
    }
    validarBase(temporal);
    // link es atómico y falla si alguien creó el destino durante el respaldo.
    fs.linkSync(temporal, dst);
    fs.writeFileSync(`${dst}.sha256`, sumaArchivo(dst) + '\n', { flag: 'wx', mode: 0o600 });
  } finally {
    fs.rmSync(temporal, { force: true });
  }
  return dst;
}

export function restaurarRespaldo(origen, destino) {
  const src = path.resolve(origen);
  const dst = path.resolve(destino);
  if (src === dst) throw new Error('El origen y el destino deben ser distintos.');
  if (fs.existsSync(dst)) throw new Error('El destino ya existe; restaura a una ruta nueva para evitar sobrescribir datos.');
  if (fs.existsSync(`${src}-wal`) || fs.existsSync(`${src}-shm`)) {
    throw new Error('El origen tiene archivos WAL/SHM; crea primero un respaldo independiente con el comando backup.');
  }
  if (fs.existsSync(`${dst}-wal`) || fs.existsSync(`${dst}-shm`)) {
    throw new Error('El destino tiene archivos WAL/SHM huérfanos; elige otra ruta.');
  }
  verificarRespaldo(src);
  comprobarEspacio(src, dst);
  fs.mkdirSync(path.dirname(dst), { recursive: true, mode: 0o700 });
  const temporal = path.join(path.dirname(dst), `.${path.basename(dst)}.restore-${randomUUID()}.db`);
  try {
    fs.copyFileSync(src, temporal, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(temporal, 0o600);
    validarBase(temporal);
    fs.linkSync(temporal, dst);
  } finally {
    fs.rmSync(temporal, { force: true });
  }
  return dst;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [operacion, origen, destino] = process.argv.slice(2);
  if (!['backup', 'restore'].includes(operacion) || !origen || !destino) {
    console.error('Uso: node db-admin.js backup <finanzas.db> <respaldo.db>\n     node db-admin.js restore <respaldo.db> <nueva-finanzas.db>');
    process.exitCode = 2;
  } else {
    try {
      const resultado = operacion === 'backup'
        ? crearRespaldo(origen, destino)
        : restaurarRespaldo(origen, destino);
      console.log(`Operación ${operacion} completada: ${resultado}`);
    } catch (error) {
      console.error(`No se completó ${operacion}: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
