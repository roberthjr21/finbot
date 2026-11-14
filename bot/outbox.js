import { createHash } from 'node:crypto';
import * as db from './db.js';
import * as trabajos from './trabajos.js';
import * as recordatorios from './recordatorios.js';
import * as alertas from './alertas.js';
import { fechaBogota } from './fechas.js';

export function encolar({ clave, usuario, texto, jid, evento, ahora = Date.now() }) {
  if (typeof texto !== 'string' || !texto || texto.length > 16000) throw new Error('Notificación inválida');
  const r = trabajos.admitir({ clave, usuario, tipo: 'salida', contenido: JSON.stringify({ texto, jid, evento }), ahora, vidaMs: 7 * 86400_000 });
  if (!r.ok) throw new Error('Outbox saturada');
  return r;
}

export async function entregar(tarea, enviar, ahora = new Date()) {
  const datos = JSON.parse(trabajos.leerContenido(tarea.contenido, tarea));
  const evento = datos.evento;
  const usuario = db.usuarioPorTelefono(tarea.usuario);
  // Las respuestas a remitentes ya autorizados siempre tienen cuenta persistente.
  if (!usuario || usuario.estado !== 'activo') return;
  if (evento?.tipo === 'recordatorio') {
    const r = recordatorios.obtener(tarea.usuario, evento.id);
    if (!r || r.estado !== 'pendiente' || r.vence !== evento.vence || r.hora !== evento.hora || (evento.revision !== undefined && r.revision !== evento.revision)) return;
  }
  if (evento?.tipo === 'alerta' && alertas.enSilencio(alertas.configuracion(tarea.usuario), recordatorios.horaBogota(ahora))) {
    const e = new Error('Horario de silencio'); e.posponerMs = 3600_000; throw e;
  }
  let avisosEnviados = evento?.avisos;
  let avisosRestantes = [];
  if (evento?.tipo === 'alerta' && evento.avisos) {
    const cfg = alertas.configuracion(tarea.usuario);
    const avisos = evento.avisos.filter(a => cfg[a.tipo] && !db.base().prepare('SELECT 1 FROM alertas_enviadas WHERE usuario = ? AND clave = ?').get(tarea.usuario,a.clave));
    if (!avisos.length) return;
    const enviadosHoy = db.base().prepare('SELECT COUNT(*) AS n FROM alertas_enviadas WHERE usuario = ? AND dia = ?').get(tarea.usuario,fechaBogota(ahora)).n;
    const cupo = Math.max(0, cfg.max_diarias - enviadosHoy);
    if (!cupo) { const e = new Error('Cupo diario'); e.posponerMs = 3600_000; throw e; }
    avisosEnviados = avisos.slice(0,cupo); avisosRestantes = avisos.slice(cupo);
    datos.texto = avisosEnviados.map(a => a.texto).join('\n');
  }
  // ID estable ayuda a correlacionar reintentos. No es una garantía de entrega única.
  const messageId = createHash('sha256').update(tarea.clave).digest('hex').slice(0, 32).toUpperCase();
  let timer;
  try {
    await Promise.race([
      enviar(tarea.usuario, datos.texto, { jid: datos.jid, messageId }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Tiempo de envío agotado')), 20000); }),
    ]);
  } finally { clearTimeout(timer); }
  return () => {
    if (evento?.tipo === 'recordatorio') {
      const actual = recordatorios.obtener(tarea.usuario, evento.id);
      if (actual?.estado === 'pendiente' && actual.vence === evento.vence && actual.hora === evento.hora && (evento.revision === undefined || actual.revision === evento.revision)) recordatorios.marcarEnviado(evento.id, ahora);
    }
    if (evento?.tipo === 'alerta') {
      alertas.registrarEnviadas(tarea.usuario, avisosEnviados?.map(a => a.clave) ?? evento.claves, fechaBogota(ahora));
      if (avisosRestantes.length) {
        const clave = `${tarea.clave}:resto:${avisosRestantes.map(a=>a.clave).join('|')}`;
        const r = encolar({ clave, usuario: tarea.usuario, texto: avisosRestantes.map(a=>a.texto).join('\n'), evento: { tipo: 'alerta', claves: avisosRestantes.map(a=>a.clave), avisos: avisosRestantes }, ahora: ahora.getTime() });
        const id = r.id ?? db.base().prepare('SELECT id FROM trabajos WHERE clave = ?').get(clave).id;
        for (const a of avisosRestantes) db.base().prepare('UPDATE alertas_reservadas SET trabajo_id = ? WHERE usuario = ? AND clave = ?').run(id,tarea.usuario,a.clave);
      }
    }
  };
}

// Despacho acotado útil para el programador y las pruebas con reloj simulado.
export async function despachar({ enviar, ahora = new Date(), maximo = 100 }) {
  let enviados = 0;
  for (let i = 0; i < maximo; i++) {
    const tarea = trabajos.reclamar('salida', { ahora: ahora.getTime() });
    if (!tarea) break;
    try {
      const confirmar = await entregar(tarea, enviar, ahora);
      if (trabajos.finalizar(tarea, { ahora: ahora.getTime(), confirmar })) enviados++;
    } catch (error) {
      trabajos.fallar(tarea, { ahora: ahora.getTime(), posponerMs: error?.posponerMs });
    }
  }
  return enviados;
}
