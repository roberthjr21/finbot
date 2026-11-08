import fs from 'node:fs';
import path from 'node:path';
import { crearRespaldo } from './db-admin.js';

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

const PATRON = /^respaldo-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z\.db$/;

export function carpetaRespaldos(archivoDB) {
  return process.env.RESPALDO_DIR ?? path.join(path.dirname(path.resolve(archivoDB)), 'respaldos');
}

export function listarRespaldos(carpeta) {
  if (!fs.existsSync(carpeta)) return [];
  return fs.readdirSync(carpeta).filter((f) => PATRON.test(f)).sort();
}

// Crea una copia verificada y borra solo las copias propias más antiguas. Nunca toca la base original.
export function respaldarAhora(archivoDB, { ahora = new Date(), conservar = configuracionRespaldos().conservar } = {}) {
  if (archivoDB === ':memory:') return null;
  const carpeta = carpetaRespaldos(archivoDB);
  const nombre = `respaldo-${ahora.toISOString().slice(0, 19).replace(/:/g, '-')}Z.db`;
  const destino = path.join(carpeta, nombre);
  if (fs.existsSync(destino)) return destino; // ya se hizo en este segundo
  crearRespaldo(archivoDB, destino);
  const todas = listarRespaldos(carpeta);
  for (const vieja of todas.slice(0, Math.max(0, todas.length - conservar))) fs.rmSync(path.join(carpeta, vieja), { force: true });
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
  const ultimo = listarRespaldos(carpeta).at(-1);
  const edad = ultimo ? Date.now() - fs.statSync(path.join(carpeta, ultimo)).mtimeMs : Infinity;
  if (edad >= intervalo) hacer();
  const temporizador = setInterval(hacer, Math.min(intervalo, 2 ** 31 - 1));
  temporizador.unref();
  return () => clearInterval(temporizador);
}
