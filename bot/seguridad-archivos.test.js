import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { aplicarUmaskPrivada, protegerSQLite, protegerArbolPrivado } from './seguridad-archivos.js';

const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'finbot-privado-'));
after(() => fs.rmSync(carpeta, { recursive: true, force: true }));

test('permiso privado para DB y archivos WAL/SHM ya existentes', { skip: process.platform === 'win32' }, () => {
  const archivo = path.join(carpeta, 'datos.db');
  for (const sufijo of ['', '-wal', '-shm']) fs.writeFileSync(archivo+sufijo, 'demo', { mode:0o644 });
  for (const sufijo of ['', '-wal', '-shm']) fs.chmodSync(archivo+sufijo, 0o644);
  protegerSQLite(archivo);
  for (const sufijo of ['', '-wal', '-shm']) assert.equal(fs.statSync(archivo+sufijo).mode & 0o777, 0o600);
});

test('umask privada para creaciones futuras', { skip: process.platform === 'win32' }, () => {
  const original = process.umask();
  try {
    process.umask(0o022);
    aplicarUmaskPrivada();
    assert.equal(process.umask(), 0o077);
    const archivo = path.join(carpeta, 'nuevo.db');
    fs.writeFileSync(archivo,'prueba');
    assert.equal(fs.statSync(archivo).mode & 0o077, 0);
  } finally { process.umask(original); }
});

test('protege recursivamente auth y rechaza enlaces simbólicos', { skip: process.platform === 'win32' }, () => {
  const auth = path.join(carpeta,'auth');
  fs.mkdirSync(auth, { mode:0o755 });
  fs.chmodSync(auth, 0o755);
  fs.writeFileSync(path.join(auth,'creds.json'),'{"prueba":true}',{mode:0o644});
  fs.chmodSync(path.join(auth,'creds.json'),0o644);
  protegerArbolPrivado(auth);
  assert.equal(fs.statSync(auth).mode & 0o777,0o700);
  assert.equal(fs.statSync(path.join(auth,'creds.json')).mode & 0o777,0o600);
  const enlace = path.join(auth,'indirecto');
  fs.symlinkSync(path.join(carpeta,'fuera'), enlace);
  assert.throws(() => protegerArbolPrivado(auth),/archivo regular/);
});

test('no crea un archivo :memory: ni cambia rutas especiales', () => {
  protegerSQLite(':memory:');
});
