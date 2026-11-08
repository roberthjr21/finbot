// Migraciones versionadas y respaldos periódicos
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const temporal = fs.mkdtempSync(path.join(os.tmpdir(), 'finbot-migr-'));
process.env.DB_ARCHIVO = path.join(temporal, 'principal.db');
delete process.env.RESPALDO_DIR;
const db = await import('./db.js');
const { migrar, MIGRACIONES, versionActual } = await import('./migraciones.js');
const { respaldarAhora, listarRespaldos, carpetaRespaldos } = await import('./respaldos.js');
const { crearRespaldo } = await import('./db-admin.js');

after(() => {
  db.cerrarBase();
  fs.rmSync(temporal, { recursive: true, force: true });
});

const U = '573001110001';

test('una base nueva queda en la última versión y la tabla de auditoría existe', () => {
  const abierta = new DatabaseSync(process.env.DB_ARCHIVO, { readOnly: true });
  try {
    assert.equal(abierta.prepare('SELECT MAX(version) AS v FROM schema_migraciones').get().v, MIGRACIONES.at(-1).version);
    assert.ok(abierta.prepare("SELECT 1 FROM sqlite_master WHERE name = 'auditoria'").get());
  } finally {
    abierta.close();
  }
});

test('migrar es repetible: la segunda vez no hace nada ni toca los datos', () => {
  db.agregarMovimiento({ usuario: U, tipo: 'ingreso', monto: 1000, categoria: 'Salario', descripcion: 'x', fecha: '2026-11-01', mensajeId: 'm-1' });
  const abierta = new DatabaseSync(process.env.DB_ARCHIVO);
  try {
    assert.deepEqual(migrar(abierta, process.env.DB_ARCHIVO), []);
    assert.equal(abierta.prepare('SELECT COUNT(*) AS n FROM movimientos').get().n, 1);
  } finally {
    abierta.close();
  }
});

test('una migración nueva con datos existentes crea antes una copia verificada y conserva todo', () => {
  const archivo = path.join(temporal, 'vieja.db');
  crearRespaldo(process.env.DB_ARCHIVO, archivo); // base ya migrada hasta v2, con un movimiento
  const abierta = new DatabaseSync(archivo);
  try {
    abierta.exec('PRAGMA journal_mode = DELETE');
    const extra = [...MIGRACIONES, { version: 99, nombre: 'prueba', sql: 'CREATE TABLE IF NOT EXISTS prueba_migracion (id INTEGER PRIMARY KEY);' }];
    assert.deepEqual(migrar(abierta, archivo, extra), [99]);
    assert.ok(abierta.prepare("SELECT 1 FROM sqlite_master WHERE name = 'prueba_migracion'").get());
    assert.equal(abierta.prepare('SELECT COUNT(*) AS n FROM movimientos').get().n, 1);
  } finally {
    abierta.close();
  }
  const copias = fs.readdirSync(temporal).filter((f) => f.startsWith('vieja.db.antes-v99-'));
  assert.equal(copias.length, 1);
  const copia = new DatabaseSync(path.join(temporal, copias[0]), { readOnly: true });
  try {
    assert.equal(copia.prepare('SELECT COUNT(*) AS n FROM movimientos').get().n, 1);
    assert.equal(copia.prepare("SELECT 1 FROM sqlite_master WHERE name = 'prueba_migracion'").get(), undefined); // la copia es de ANTES
  } finally {
    copia.close();
  }
});

test('si una migración falla, se revierte completa y la base queda igual', () => {
  const archivo = path.join(temporal, 'falla.db');
  crearRespaldo(process.env.DB_ARCHIVO, archivo);
  const abierta = new DatabaseSync(archivo);
  try {
    const antes = versionActual(abierta);
    const mala = [...MIGRACIONES, { version: 98, nombre: 'mala', sql: 'CREATE TABLE a (id INTEGER); INSERT INTO tabla_que_no_existe VALUES (1);' }];
    assert.throws(() => migrar(abierta, archivo, mala), /Falló la migración v98/);
    assert.equal(versionActual(abierta), antes);
    assert.equal(abierta.prepare("SELECT 1 FROM sqlite_master WHERE name = 'a'").get(), undefined);
  } finally {
    abierta.close();
  }
});

test('respaldos: se crean verificados, no se sobrescriben y se conservan solo las últimas N', () => {
  const carpeta = carpetaRespaldos(process.env.DB_ARCHIVO);
  const base = new Date('2026-11-10T10:00:00Z');
  const hechos = [0, 1, 2, 3].map((i) => respaldarAhora(process.env.DB_ARCHIVO, { ahora: new Date(base.getTime() + i * 1000), conservar: 2 }));
  assert.equal(hechos.length, 4);
  const quedan = listarRespaldos(carpeta);
  assert.equal(quedan.length, 2);
  assert.deepEqual(quedan, quedan.toSorted());
  const copia = new DatabaseSync(path.join(carpeta, quedan.at(-1)), { readOnly: true });
  try {
    assert.equal(copia.prepare('SELECT COUNT(*) AS n FROM movimientos').get().n, 1);
    assert.equal(copia.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  } finally {
    copia.close();
  }
  // El mismo instante no crea otra copia ni falla
  assert.equal(respaldarAhora(process.env.DB_ARCHIVO, { ahora: new Date(base.getTime() + 3000), conservar: 2 }), hechos[3]);
  // La base original sigue intacta
  assert.ok(fs.existsSync(process.env.DB_ARCHIVO));
});

test('db-admin sigue negándose a sobrescribir', () => {
  const destino = path.join(temporal, 'ya-existe.db');
  fs.writeFileSync(destino, 'x');
  assert.throws(() => crearRespaldo(process.env.DB_ARCHIVO, destino), /ya existe/);
});
