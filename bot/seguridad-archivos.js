// Permisos mínimos de archivos financieros y autenticación en sistemas POSIX.
import fs from 'node:fs';
import path from 'node:path';

export function aplicarUmaskPrivada() {
  if (process.platform !== 'win32') process.umask(0o077);
}

function estadoSinSeguirEnlaces(ruta) {
  return fs.lstatSync(ruta, { throwIfNoEntry: false });
}

export function protegerArchivo(ruta) {
  if (process.platform === 'win32') return;
  const estado = estadoSinSeguirEnlaces(ruta);
  if (!estado) return;
  if (!estado.isFile() || estado.isSymbolicLink()) {
    throw new Error('Ruta de datos privados no es un archivo regular');
  }
  fs.chmodSync(ruta, 0o600);
}

export function protegerSQLite(archivo) {
  if (archivo === ':memory:') return;
  for (const ruta of [archivo, `${archivo}-wal`, `${archivo}-shm`]) protegerArchivo(ruta);
}

export function protegerArbolPrivado(carpeta) {
  const actual = estadoSinSeguirEnlaces(carpeta);
  if (!actual) fs.mkdirSync(carpeta, { recursive: true, mode: 0o700 });
  if (process.platform === 'win32') return;
  const estado = estadoSinSeguirEnlaces(carpeta);
  if (!estado?.isDirectory() || estado.isSymbolicLink()) {
    throw new Error('La carpeta de datos privados no es un directorio regular');
  }
  fs.chmodSync(carpeta, 0o700);
  for (const nombre of fs.readdirSync(carpeta)) {
    const ruta = path.join(carpeta, nombre);
    const hijo = estadoSinSeguirEnlaces(ruta);
    if (hijo?.isDirectory() && !hijo.isSymbolicLink()) protegerArbolPrivado(ruta);
    else protegerArchivo(ruta);
  }
}
