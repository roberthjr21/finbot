import fs from 'node:fs';
import path from 'node:path';
import { crearRespaldo, verificarRespaldo } from './db-admin.js';
import { createHash } from 'node:crypto';

// Respaldos periódicos de la base. Cada copia se crea con VACUUM INTO y se verifica
// (integridad y tablas) antes de quedar en su lugar. Se conservan las últimas N.
const numero = (nombre, porDefecto) => {
  const v = Number(process.env[nombre]);
  return Number.isFinite(v) && v >= 0 ? v : porDefecto;
};

export const configuracionRespaldos = () => ({
  cadaHoras: numero('RESPALDO_CADA_HORAS', 24), // 0 = desactivado
  conservar: Math.max(1, Math.floor(numero('RESPALDO_CONSERVAR', 7))),
});

const PATRON = /^respaldo-(?:[a-f0-9]{12}-)?\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z\.db$/;

export function carpetaRespaldos(archivoDB) {
  return process.env.RESPALDO_DIR ?? path.join(path.dirname(path.resolve(archivoDB)), 'respaldos');
}

const prefijo = (archivo) => `respaldo-${createHash('sha256').update(path.resolve(archivo)).digest('hex').slice(0,12)}-`;

export function listarRespaldos(carpeta, archivo) {
  if (!fs.existsSync(carpeta)) return [];
  return fs.readdirSync(carpeta).filter((f) => PATRON.test(f) && (!archivo || f.startsWith(prefijo(archivo)))).sort();
}

// Crea una copia verificada y borra solo las copias propias más antiguas. Nunca toca la base original.
export function respaldarAhora(archivoDB, { ahora = new Date(), conservar = configuracionRespaldos().conservar, confirmarRotacion = process.env.RESPALDO_ROTAR === '1' } = {}) {
  if (archivoDB === ':memory:') return null;
  const carpeta = carpetaRespaldos(archivoDB);
  const nombre = `${prefijo(archivoDB)}${ahora.toISOString().slice(0, 19).replace(/:/g, '-')}Z.db`;
  const destino = path.join(carpeta, nombre);
  if (fs.existsSync(destino)) { verificarRespaldo(destino); return destino; }
  crearRespaldo(archivoDB, destino);
  fs.writeFileSync(`${destino}.auto.json`, JSON.stringify({ version: 1, familia: prefijo(archivoDB), archivo: nombre }), { flag: 'wx', mode: 0o600 });
  const todas = listarRespaldos(carpeta, archivoDB);
  if (confirmarRotacion) {
    const propias = todas.filter(f => {
      try { const m = JSON.parse(fs.readFileSync(path.join(carpeta,f) + '.auto.json','utf8')); return m.version === 1 && m.familia === prefijo(archivoDB) && m.archivo === f; } catch { return false; }
    });
    for (const vieja of propias.slice(0, Math.max(0, propias.length - conservar))) {
      fs.rmSync(path.join(carpeta, vieja), { force: true });
      fs.rmSync(path.join(carpeta, vieja) + '.sha256', { force: true });
      fs.rmSync(path.join(carpeta, vieja) + '.auto.json', { force: true });
    }
  }
  return destino;
}

// Se llama al arrancar: hace un respaldo si el último es más viejo que el intervalo y programa los siguientes.
export function programarRespaldos(archivoDB, { registro = console } = {}) {
  const { cadaHoras } = configuracionRespaldos();
  if (cadaHoras === 0 || archivoDB === ':memory:') return () => {};
  const intervalo = cadaHoras * 3600_000;
  const hacer = () => {
    try {
      const destino = respaldarAhora(archivoDB);
      if (destino) registro.log(`💾 Respaldo verificado: ${path.basename(destino)}`);
    } catch (error) {
      registro.error(`⚠ No se pudo crear el respaldo: ${error.message}`);
    }
  };
  const carpeta = carpetaRespaldos(archivoDB);
  const ultimo = listarRespaldos(carpeta, archivoDB).at(-1);
  let edad = Infinity;
  if (ultimo) {
    try { verificarRespaldo(path.join(carpeta, ultimo)); edad = Date.now() - fs.statSync(path.join(carpeta, ultimo)).mtimeMs; }
    catch { registro.error('El último respaldo no pasó la verificación; se intentará crear una copia nueva sin sobrescribirlo.'); }
  }
  if (edad >= intervalo) hacer();
  const temporizador = setInterval(hacer, Math.min(intervalo, 2 ** 31 - 1));
  temporizador.unref();
  return () => clearInterval(temporizador);
}
