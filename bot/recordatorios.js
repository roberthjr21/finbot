import * as db from './db.js';
import { fechaBogota, pesos, valida } from './fechas.js';
import { montoValido } from './montos.js';

// Recordatorios financieros. Estados: pendiente -> enviado -> completado, o cancelado.
// Si el bot estuvo apagado, lo vencido se envía al volver (una sola vez: queda marcado como enviado).

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const limpiar = (t) => String(t ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();

export const horaBogota = (momento = new Date()) =>
  momento.toLocaleTimeString('en-GB', { timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit', hour12: false });

function validar({ texto, monto, vence, hora }, { parcial = false, hoy = fechaBogota() } = {}) {
  const valor = {};
  if (!parcial || texto !== undefined) {
    const t = limpiar(texto);
    if (t.length < 2 || t.length > 200) return { ok: false, error: 'El recordatorio debe tener entre 2 y 200 caracteres.' };
    valor.texto = t;
  }
  if (!parcial || monto !== undefined) {
    if (monto !== undefined && monto !== null && !montoValido(monto)) return { ok: false, error: 'El monto del recordatorio no es válido.' };
    valor.monto = monto ?? null;
  }
  if (!parcial || vence !== undefined) {
    if (!valida(vence)) return { ok: false, error: 'La fecha no es válida (usa AAAA-MM-DD).' };
    if (vence < hoy) return { ok: false, error: 'La fecha del recordatorio ya pasó.' };
    if (vence > `${Number(hoy.slice(0, 4)) + 5}${hoy.slice(4)}`) return { ok: false, error: 'La fecha está demasiado lejos (máximo 5 años).' };
    valor.vence = vence;
  }
  if (!parcial || hora !== undefined) {
    const h = hora ?? '09:00';
    if (!HORA.test(h)) return { ok: false, error: 'La hora debe ser HH:MM (24 h).' };
    valor.hora = h;
  }
  if (parcial && Object.keys(valor).length === 0) return { ok: false, error: 'No hay nada que cambiar.' };
  return { ok: true, valor };
}

const CAMPOS = 'id, texto, monto, vence, hora, estado, enviado_en';

export function crear({ usuario, texto, monto, vence, hora, mensajeId = null }, opciones) {
  const v = validar({ texto, monto, vence, hora }, opciones);
  if (!v.ok) return v;
  const r = db.base()
    .prepare('INSERT INTO recordatorios (usuario, texto, monto, vence, hora, mensaje_id) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (mensaje_id) DO NOTHING')
    .run(usuario, v.valor.texto, v.valor.monto, v.valor.vence, v.valor.hora, mensajeId);
  if (r.changes === 0) return { ok: true, duplicado: true };
  return { ok: true, id: Number(r.lastInsertRowid) };
}

export const obtener = (usuario, id) =>
  db.base().prepare(`SELECT ${CAMPOS} FROM recordatorios WHERE usuario = ? AND id = ?`).get(usuario, id) ?? null;

// Pendientes y enviados (aún sin completar), del más próximo al más lejano
export const listar = (usuario, { limite = 50 } = {}) =>
  db.base()
    .prepare(`SELECT ${CAMPOS} FROM recordatorios WHERE usuario = ? AND estado IN ('pendiente', 'enviado') ORDER BY vence, hora, id LIMIT ?`)
    .all(usuario, Math.min(Math.max(Number(limite) || 50, 1), 200));

export function editar(usuario, id, cambios, opciones) {
  const actual = obtener(usuario, id);
  if (!actual || !['pendiente', 'enviado'].includes(actual.estado)) return { ok: false, error: 'No encontré ese recordatorio activo.' };
  const v = validar(cambios, { ...opciones, parcial: true });
  if (!v.ok) return v;
  const campos = Object.keys(v.valor);
  // Si cambia la fecha u hora, vuelve a quedar pendiente para avisar de nuevo
  const reabrir = campos.includes('vence') || campos.includes('hora');
  db.base()
    .prepare(`UPDATE recordatorios SET ${campos.map((c) => `${c} = ?`).join(', ')}${reabrir ? ", estado = 'pendiente', enviado_en = NULL" : ''} WHERE usuario = ? AND id = ?`)
    .run(...campos.map((c) => v.valor[c]), usuario, id);
  return { ok: true };
}

const cambiarEstado = (usuario, id, desde, hacia) =>
  db.base()
    .prepare(`UPDATE recordatorios SET estado = ? WHERE usuario = ? AND id = ? AND estado IN (${desde.map(() => '?').join(',')})`)
    .run(hacia, usuario, id, ...desde).changes > 0;

export const cancelar = (usuario, id) => cambiarEstado(usuario, id, ['pendiente', 'enviado'], 'cancelado');
export const completar = (usuario, id) => cambiarEstado(usuario, id, ['pendiente', 'enviado'], 'completado');

// Pendientes cuya fecha y hora ya llegaron (incluye los que se vencieron con el bot apagado)
export function vencidos(ahora = new Date()) {
  const hoy = fechaBogota(ahora);
  const hora = horaBogota(ahora);
  return db.base()
    .prepare(`SELECT usuario, ${CAMPOS} FROM recordatorios WHERE estado = 'pendiente' AND (vence < ? OR (vence = ? AND hora <= ?)) ORDER BY vence, hora, id LIMIT 200`)
    .all(hoy, hoy, hora);
}

// Marca como enviado solo si seguía pendiente: dos ciclos seguidos no envían dos veces
export const marcarEnviado = (id, ahora = new Date()) =>
  db.base().prepare("UPDATE recordatorios SET estado = 'enviado', enviado_en = ? WHERE id = ? AND estado = 'pendiente'").run(ahora.toISOString(), id).changes > 0;

// Pendientes de un usuario que vencen en los próximos "dias" días (para alertas de pagos próximos)
export const proximos = (usuario, hoy, dias) => {
  const limite = new Date(`${hoy}T00:00:00Z`);
  limite.setUTCDate(limite.getUTCDate() + dias);
  return db.base()
    .prepare("SELECT id, texto, monto, vence FROM recordatorios WHERE usuario = ? AND estado = 'pendiente' AND vence >= ? AND vence <= ? ORDER BY vence")
    .all(usuario, hoy, limite.toISOString().slice(0, 10));
};

export function textoRecordatorio(r) {
  const monto = r.monto ? ` · ${pesos(r.monto)}` : '';
  return `#${r.id} ${r.vence} ${r.hora} · ${r.texto}${monto}`;
}

export function textoAviso(r) {
  return `⏰ Recordatorio: ${r.texto}${r.monto ? ` (${pesos(r.monto)})` : ''}\nCuando lo hagas: /listo ${r.id}`;
}
