#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID, scryptSync, createCipheriv, createDecipheriv } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { verificarRespaldo, validarBase, comprobarEspacio } from './db-admin.js';

const MAGIC = Buffer.from('FINBOT01');
function validar(origen, destino, frase) {
  if (typeof frase !== 'string' || frase.length < 16 || frase.length > 4096) throw new Error('La frase de cifrado debe tener entre 16 y 4096 caracteres');
  if (path.resolve(origen) === path.resolve(destino) || fs.existsSync(destino)) throw new Error('El destino debe ser nuevo y distinto del origen');
  if (!fs.existsSync(origen)) throw new Error('No existe el origen');
  comprobarEspacio(origen, destino);
  fs.mkdirSync(path.dirname(path.resolve(destino)), { recursive: true, mode: 0o700 });
}
export async function cifrarRespaldo(origen, destino, frase) {
  validar(origen, destino, frase);
  const suma = verificarRespaldo(origen);
  const temporal = `${destino}.${randomUUID()}.tmp`;
  try {
    const salt = randomBytes(16), iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', scryptSync(frase, salt, 32), iv);
    cipher.setAAD(MAGIC);
    fs.writeFileSync(temporal, Buffer.concat([MAGIC, salt, iv]), { flag: 'wx', mode: 0o600 });
    await pipeline(fs.createReadStream(origen), cipher, fs.createWriteStream(temporal, { flags: 'a', mode: 0o600 }));
    fs.appendFileSync(temporal, cipher.getAuthTag());
    if (verificarRespaldo(origen) !== suma) throw new Error('La copia cambió durante el cifrado');
    fs.linkSync(temporal, destino);
    return destino;
  } finally { fs.rmSync(temporal, { force: true }); }
}
export async function descifrarRespaldo(origen, destino, frase) {
  validar(origen, destino, frase);
  const temporal = `${destino}.${randomUUID()}.tmp`;
  try {
    const fd = fs.openSync(origen, 'r');
    const cabecera = Buffer.alloc(36), tag = Buffer.alloc(16);
    const tamano = fs.fstatSync(fd).size;
    try {
      if (tamano < 52) throw new Error('Archivo cifrado truncado');
      fs.readSync(fd, cabecera, 0, 36, 0); fs.readSync(fd, tag, 0, 16, tamano - 16);
    } finally { fs.closeSync(fd); }
    if (!cabecera.subarray(0,8).equals(MAGIC)) throw new Error('Formato de respaldo cifrado no reconocido');
    const decipher = createDecipheriv('aes-256-gcm', scryptSync(frase, cabecera.subarray(8,24), 32), cabecera.subarray(24,36));
    decipher.setAAD(MAGIC); decipher.setAuthTag(tag);
    await pipeline(fs.createReadStream(origen, { start: 36, end: tamano - 17 }), decipher, fs.createWriteStream(temporal, { flags: 'wx', mode: 0o600 }));
    validarBase(temporal);
    fs.linkSync(temporal, destino);
    return destino;
  } finally { fs.rmSync(temporal, { force: true }); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [accion, origen, destino] = process.argv.slice(2);
  try {
    if (!['cifrar','descifrar'].includes(accion) || !origen || !destino) throw new Error('Uso: node respaldo-cifrado.js cifrar|descifrar <origen> <destino nuevo>; frase por stdin');
    const partes = []; let n = 0;
    for await (const p of process.stdin) { n += p.length; if (n > 8192) throw new Error('Entrada demasiado grande'); partes.push(p); }
    const frase = Buffer.concat(partes).toString('utf8').replace(/\r?\n$/, '');
    await (accion === 'cifrar' ? cifrarRespaldo : descifrarRespaldo)(origen, destino, frase);
    console.log('Copia local verificada. No se transfirió a servicios externos.');
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
