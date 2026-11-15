import { createHash } from 'node:crypto';
import { base, enTransaccion } from './db.js';

// Ventana deslizante compartida entre procesos. No guarda teléfonos ni IP en claro.
export function crearLimitadorPersistente({ ambito, max, ventanaMs }) {
  if (!ambito || !Number.isSafeInteger(max) || max < 1 || !Number.isSafeInteger(ventanaMs) || ventanaMs < 1) {
    throw new Error('Configuración de límite no válida');
  }
  return {
    intentar(clave, ahora = Date.now()) {
      const hash = createHash('sha256').update(String(clave)).digest('hex');
      return enTransaccion(() => {
        const db = base();
        // Purga acotada incluso si una petición es rechazada; índice por vencimiento.
        db.prepare('DELETE FROM limites_intentos WHERE id IN (SELECT id FROM limites_intentos WHERE expira <= ? LIMIT 1000)').run(ahora);
        const fila = db.prepare('SELECT COUNT(*) AS n, MIN(instante) AS primero FROM limites_intentos WHERE ambito = ? AND clave = ? AND instante > ?')
          .get(ambito, hash, ahora - ventanaMs);
        if (fila.n >= max) return { ok: false, reintentoMs: fila.primero + ventanaMs - ahora };
        db.prepare('INSERT INTO limites_intentos (ambito, clave, instante, expira) VALUES (?, ?, ?, ?)')
          .run(ambito, hash, ahora, ahora + ventanaMs);
        return { ok: true, reintentoMs: 0 };
      });
    },
  };
}
