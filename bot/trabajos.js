import { randomUUID, randomBytes, createHash, createCipheriv, createDecipheriv } from 'node:crypto';
import * as db from './db.js';

function claves() {
  const actual = process.env.COLA_SECRETO || process.env.SECRETO_SESION;
  if (process.env.NODE_ENV === 'production' && (!actual || actual.length < 32)) throw new Error('La cola requiere secreto de 32 caracteres en producción');
  return [actual, process.env.COLA_SECRETO_ANTERIOR].filter(Boolean).map(s => createHash('sha256').update(s).digest());
}
const asociar = ({ tipo, usuario, clave, modo_operacion, sesion_prueba, control_modo }) => Buffer.from(
  `${tipo}:${usuario}:${clave}` + (modo_operacion ? JSON.stringify([modo_operacion, sesion_prueba ?? null, control_modo ?? null]) : '')
);
function cifrar(texto, datos) {
  const [clave] = claves();
  if (!clave) return texto; // Desarrollo sin secretos: mismo modelo de disco privado que SQLite.
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', clave, iv);
  c.setAAD(asociar(datos));
  const cifrado = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
  return `enc:v1:${Buffer.concat([iv, c.getAuthTag(), cifrado]).toString('base64')}`;
}
export function leerContenido(texto, datos) {
  if (!texto?.startsWith('enc:v1:')) return texto;
  const bytes = Buffer.from(texto.slice(7), 'base64');
  for (const clave of claves()) {
    try {
      const d = createDecipheriv('aes-256-gcm', clave, bytes.subarray(0,12));
      d.setAAD(asociar(datos));
      d.setAuthTag(bytes.subarray(12,28));
      return Buffer.concat([d.update(bytes.subarray(28)), d.final()]).toString('utf8');
    } catch { /* permite rotación explícita de la clave de cola */ }
  }
  throw new Error('No se pudo descifrar el trabajo');
}

// SQLite es la fuente de verdad; no se guardan closures en memoria.
const base = db.basePersistente;
const huella = clave => createHash('sha256').update(clave).digest('hex');

// Solo las reservas de trabajos vivos bloquean nuevas alertas.
export function reconciliarReservas() {
  return base().prepare("DELETE FROM alertas_reservadas WHERE NOT EXISTS (SELECT 1 FROM trabajos t WHERE t.id = trabajo_id AND t.estado IN ('pendiente','procesando'))").run().changes;
}

// Conserva 30 días tras la caducidad (que siempre es posterior a la admisión).
// Las huellas seudónimas sin cuerpo ni fechas conservan la deduplicación.
export function retenerTerminales(ahora = Date.now()) {
  return db.enTransaccionPersistente(() => {
    reconciliarReservas();
    const filas = base().prepare("SELECT id, clave, usuario FROM trabajos WHERE estado IN ('hecho','agotado','cancelado') AND expira <= ? LIMIT 500").all(ahora - 30 * 86400_000);
    for (const fila of filas) {
      base().prepare('INSERT OR IGNORE INTO trabajos_huellas VALUES (?, ?)').run(huella(fila.clave), huella(fila.usuario));
      base().prepare('DELETE FROM trabajos WHERE id = ?').run(fila.id);
    }
    return filas.length;
  });
}
export function admitir({ clave, usuario, tipo, contenido, ahora = Date.now(), vidaMs = 72 * 3600_000, maximo = 5000, porUsuario = 500, modo_operacion = null, sesion_prueba = null, control_modo = null }) {
  if (!['entrada','salida'].includes(tipo) || typeof contenido !== 'string' || Buffer.byteLength(contenido) > 256 * 1024) throw new Error('Trabajo inválido o demasiado grande');
  return db.enTransaccionPersistente(() => {
    if (base().prepare('SELECT id FROM trabajos WHERE clave = ?').get(clave) || base().prepare('SELECT 1 FROM trabajos_huellas WHERE huella = ?').get(huella(clave))) return { ok: true, duplicado: true };
    const cantidad = (extra = '', params = []) => base().prepare(`SELECT COUNT(*) AS n FROM trabajos WHERE estado IN ('pendiente','procesando') AND tipo = ? ${extra}`).get(tipo, ...params).n;
    if (cantidad() >= maximo || cantidad('AND usuario = ?', [usuario]) >= porUsuario) return { ok: false, motivo: 'saturado' };
    const r = base().prepare('INSERT INTO trabajos (clave, usuario, tipo, contenido, disponible, creado, expira, modo_operacion, sesion_prueba, control_modo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(clave, usuario, tipo, cifrar(contenido, { tipo, usuario, clave, modo_operacion, sesion_prueba, control_modo }), ahora, ahora, ahora + vidaMs, modo_operacion, sesion_prueba, control_modo);
    return { ok: true, id: Number(r.lastInsertRowid) };
  });
}

export function purgarVencidos(ahora = Date.now()) {
  return base().prepare("UPDATE trabajos SET estado = 'agotado', contenido = NULL, dueno = NULL, lease_hasta = 0, error = 'expirado' WHERE id IN (SELECT id FROM trabajos WHERE expira <= ? AND (estado = 'pendiente' OR (estado = 'procesando' AND lease_hasta <= ?)) LIMIT 500)").run(ahora, ahora).changes;
}

export function reclamar(tipo, { ahora = Date.now(), leaseMs = 120000, dueno = randomUUID(), maxIntentos = tipo === 'salida' ? 20 : 5 } = {}) {
  return db.enTransaccionPersistente(() => {
    const b = base();
    // Expirados/agOTados dejan un estado verificable, pero se elimina su cuerpo personal.
    b.prepare("UPDATE trabajos SET estado = 'agotado', contenido = NULL, dueno = NULL, lease_hasta = 0, error = 'expirado_o_intentos' WHERE tipo = ? AND ((estado = 'pendiente' AND expira <= ?) OR (estado = 'procesando' AND lease_hasta <= ? AND (expira <= ? OR intentos >= ?)))")
      .run(tipo, ahora, ahora, ahora, maxIntentos);
    b.prepare("UPDATE trabajos SET estado = 'pendiente', dueno = NULL, lease_hasta = 0 WHERE tipo = ? AND estado = 'procesando' AND lease_hasta <= ?").run(tipo, ahora);
    const fila = b.prepare(`SELECT t.* FROM trabajos t
      WHERE t.tipo = ? AND t.estado = 'pendiente' AND t.disponible <= ?
        AND (t.tipo = 'salida' OR NOT EXISTS (SELECT 1 FROM trabajos p WHERE p.usuario = t.usuario AND p.tipo = t.tipo AND p.id < t.id AND p.estado IN ('pendiente','procesando')))
        AND NOT EXISTS (SELECT 1 FROM trabajos p WHERE p.usuario = t.usuario AND p.tipo = t.tipo AND p.estado = 'procesando')
      ORDER BY COALESCE((SELECT MAX(p.ultimo_inicio) FROM trabajos p WHERE p.usuario = t.usuario AND p.tipo = t.tipo), 0), t.id LIMIT 1`).get(tipo, ahora);
    if (!fila) return null;
    b.prepare("UPDATE trabajos SET estado = 'procesando', dueno = ?, lease_hasta = ?, intentos = intentos + 1, ultimo_inicio = ? WHERE id = ?")
      .run(dueno, ahora + leaseMs, ahora, fila.id);
    return { ...fila, dueno, intentos: fila.intentos + 1 };
  });
}
export function vigente(tarea, ahora = Date.now()) {
  return Boolean(base().prepare("SELECT 1 FROM trabajos WHERE id = ? AND dueno = ? AND estado = 'procesando' AND lease_hasta > ?").get(tarea.id, tarea.dueno, ahora));
}
export function renovar(tarea, ahora = Date.now(), leaseMs = 120000) {
  return base().prepare("UPDATE trabajos SET lease_hasta = ? WHERE id = ? AND dueno = ? AND estado = 'procesando' AND lease_hasta > ?")
    .run(ahora + leaseMs, tarea.id, tarea.dueno, ahora).changes > 0;
}
export function finalizar(tarea, { ahora = Date.now(), confirmar } = {}) {
  return db.enTransaccionPersistente(() => {
    if (!vigente(tarea, ahora)) return false;
    base().prepare("UPDATE trabajos SET estado = 'hecho', contenido = NULL, dueno = NULL, lease_hasta = 0, error = NULL WHERE id = ? AND dueno = ?").run(tarea.id, tarea.dueno);
    confirmar?.();
    return true;
  });
}
export function fallar(tarea, { ahora = Date.now(), maxIntentos = tarea.tipo === 'salida' ? 20 : 5, posponerMs } = {}) {
  return db.enTransaccionPersistente(() => {
    if (!vigente(tarea, ahora)) return false;
    if (posponerMs) {
      base().prepare("UPDATE trabajos SET estado = 'pendiente', disponible = ?, intentos = intentos - 1, dueno = NULL, lease_hasta = 0 WHERE id = ? AND dueno = ?").run(ahora + posponerMs, tarea.id, tarea.dueno);
      return true;
    }
    const agotado = tarea.intentos >= maxIntentos;
    base().prepare(`UPDATE trabajos SET estado = ?, disponible = ?, contenido = CASE WHEN ? THEN NULL ELSE contenido END, dueno = NULL, lease_hasta = 0, error = 'fallo_transitorio' WHERE id = ? AND dueno = ?`)
      .run(agotado ? 'agotado' : 'pendiente', ahora + Math.min(3600000, 1000 * 2 ** tarea.intentos), agotado ? 1 : 0, tarea.id, tarea.dueno);
    return true;
  });
}
export function cancelar(clave, motivo = null) {
  return base().prepare("UPDATE trabajos SET estado = 'cancelado', contenido = NULL, dueno = NULL, lease_hasta = 0, error = ? WHERE clave = ? AND estado IN ('pendiente','procesando')").run(motivo, clave).changes > 0;
}
export function estadisticas() {
  return base().prepare('SELECT tipo, estado, COUNT(*) AS cantidad FROM trabajos GROUP BY tipo, estado').all();
}

export function crearTrabajador({ tipo, procesar, concurrencia = 4, habilitado = () => true, registro = console, intervaloMs = 1000, mantenimiento = () => {} }) {
  claves(); // Falla al arrancar, no al recibir el primer mensaje en producción.
  if (!Number.isInteger(concurrencia) || concurrencia < 1 || concurrencia > 16) throw new Error('Concurrencia inválida');
  const activos = new Set();
  let detenido = false;
  function despertar() {
    if (detenido) return;
    try { purgarVencidos(); reconciliarReservas(); retenerTerminales(); mantenimiento(); } catch { registro.error('No se pudo mantener la cola'); }
    if (!habilitado()) return;
    while (activos.size < concurrencia) {
      let tarea;
      try { tarea = reclamar(tipo); } catch { registro.error('No se pudo reclamar trabajo persistente'); return; }
      if (!tarea) break;
      const latido = setInterval(() => { try { renovar(tarea); } catch { registro.error('No se pudo renovar un trabajo'); } }, 30000);
      latido.unref();
      const ejecutar = async () => {
        try {
          const confirmar = await db.conControlTransaccion(() => {
            if (!vigente(tarea)) throw new Error('Reserva de trabajo vencida');
          }, () => procesar(tarea));
          finalizar(tarea, { confirmar: typeof confirmar === 'function' ? confirmar : undefined });
        } catch (error) {
          try { fallar(tarea, { posponerMs: error?.posponerMs }); } catch { registro.error('No se pudo registrar el fallo de un trabajo'); }
          registro.warn('Trabajo pendiente de reintento', { tipo, id: tarea.id, intento: tarea.intentos });
        } finally { clearInterval(latido); }
      };
      const promesa = ejecutar().finally(() => { activos.delete(promesa); if (!detenido) queueMicrotask(despertar); });
      activos.add(promesa);
    }
  }
  const intervalo = setInterval(despertar, intervaloMs); intervalo.unref();
  return { despertar, async detener() { detenido = true; clearInterval(intervalo); await Promise.allSettled([...activos]); } };
}
