import { randomUUID } from 'node:crypto';
import * as db from './db.js';
import * as recordatorios from './recordatorios.js';
import * as recurrentes from './recurrentes.js';
import * as alertas from './alertas.js';
import * as contexto from './contexto.js';
import * as outbox from './outbox.js';
import * as trabajos from './trabajos.js';
import { fechaBogota } from './fechas.js';
import { entero } from './limites.js';

let corriendo = false;
let ultimaAlerta = 0;
// Reservar la notificación y su marca de alerta sucede en una sola transacción.
export async function ciclo({ enviar, ahora = new Date() }) {
  if (corriendo) return { omitido: true };
  corriendo = true;
  const resultado = { recurrentes: 0, recordatorios: 0, alertas: 0 };
  try {
    trabajos.purgarVencidos(ahora.getTime());
    trabajos.reconciliarReservas();
    trabajos.retenerTerminales(ahora.getTime());
    try { resultado.recurrentes = recurrentes.ejecutarPendientes({ hoy: fechaBogota(ahora), ahora: ahora.getTime() }).length; }
    catch { console.error('Programador: no se pudieron registrar recurrentes'); }
    try {
      for (const r of recordatorios.vencidos(ahora)) {
        const k = `recordatorio:${r.id}:${r.revision}`;
        outbox.encolar({ clave: k, usuario: r.usuario, texto: recordatorios.textoAviso(r), evento: { tipo: 'recordatorio', id: r.id, vence: r.vence, hora: r.hora, revision: r.revision }, ahora: ahora.getTime() });
      }
    } catch { console.error('Programador: no se pudo reservar un recordatorio'); }
    if (ahora.getTime() - ultimaAlerta >= entero('ALERTAS_CADA_MIN', 15) * 60000) {
      try {
        const usuarios = db.base().prepare("SELECT telefono FROM usuarios WHERE estado = 'activo'").all();
        for (const { telefono } of usuarios) {
          db.enTransaccion(() => {
            const p = alertas.pendientes(telefono, ahora);
            if (!p) return;
            const clave = `alerta:${telefono}:${p.claves.join('|')}:${randomUUID()}`;
            const r = outbox.encolar({ clave, usuario: telefono, texto: p.texto, evento: { tipo: 'alerta', claves: p.claves, avisos: p.avisos }, ahora: ahora.getTime() });
            const id = r.id ?? db.base().prepare('SELECT id FROM trabajos WHERE clave = ?').get(clave).id;
            for (const k of p.claves) db.base().prepare('INSERT OR IGNORE INTO alertas_reservadas (usuario, clave, trabajo_id, dia) VALUES (?, ?, ?, ?)').run(telefono, k, id, fechaBogota(ahora));
          });
        }
        ultimaAlerta = ahora.getTime();
      } catch { console.error('Programador: no se pudieron reservar las alertas'); }
    }
    const antes = db.base().prepare("SELECT COUNT(*) AS n FROM recordatorios WHERE estado = 'enviado'").get().n;
    const alertasAntes = db.base().prepare('SELECT COUNT(*) AS n FROM alertas_enviadas').get().n;
    await outbox.despachar({ enviar, ahora });
    resultado.recordatorios = db.base().prepare("SELECT COUNT(*) AS n FROM recordatorios WHERE estado = 'enviado'").get().n - antes;
    resultado.alertas = db.base().prepare('SELECT COUNT(*) AS n FROM alertas_enviadas').get().n - alertasAntes;
    contexto.purgar(ahora.getTime());
    db.limpiarAcceso(Math.floor(ahora.getTime()/1000));
    db.base().prepare('DELETE FROM privacidad_solicitudes WHERE expira <= ?').run(ahora.getTime());
  } finally { corriendo = false; }
  return resultado;
}
export function iniciarProgramador({ enviar, primeraEsperaMs = 15000 }) {
  let intervalo;
  let activo;
  const ejecutar = () => { activo = ciclo({ enviar }).catch(() => console.error('Fallo del programador')); };
  const inicio = setTimeout(() => { ejecutar(); intervalo = setInterval(ejecutar, entero('PROGRAMADOR_SEGUNDOS', 60) * 1000); intervalo.unref(); }, primeraEsperaMs);
  inicio.unref();
  return async () => { clearTimeout(inicio); clearInterval(intervalo); await activo; };
}
export const _reiniciar = () => { corriendo = false; ultimaAlerta = 0; };
