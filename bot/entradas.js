import { randomUUID } from 'node:crypto';
import * as db from './db.js';
import * as trabajos from './trabajos.js';
import * as outbox from './outbox.js';
import { interpretarPrueba, responderPrueba } from './modo-prueba.js';

const arranque = randomUUID();
const perteneceAlProceso = sesion => typeof sesion === 'string' && sesion.startsWith(`${arranque}:`);
const nuevaSesion = () => `${arranque}:${randomUUID()}`;

// El estado proyectado cambia junto con la admisión, nunca si la cola rechaza el mensaje.
export function admitirEntrada({ usuario, mensajeId, texto = '', contenido, ...opciones }) {
  return db.enTransaccionPersistente(() => {
    const b = db.basePersistente();
    const control = interpretarPrueba(texto);
    let { modo = 'real', sesion = null } = b.prepare('SELECT modo, sesion FROM entrada_modos WHERE usuario=?').get(usuario) ?? {};
    if (['on','activar'].includes(control)) {
      if (modo !== 'prueba' || !perteneceAlProceso(sesion)) sesion = nuevaSesion();
      modo = 'prueba';
    } else if (['off','desactivar'].includes(control)) { modo = 'real'; sesion = null; }
    const r = trabajos.admitir({ ...opciones, clave: `entrada:${usuario}:${mensajeId}`, usuario, tipo: 'entrada', contenido,
      modo_operacion: modo, sesion_prueba: sesion, control_modo: control });
    if (r.ok && !r.duplicado) b.prepare('INSERT INTO entrada_modos VALUES (?,?,?) ON CONFLICT(usuario) DO UPDATE SET modo=excluded.modo, sesion=excluded.sesion').run(usuario,modo,sesion);
    return r;
  });
}

export function cancelarEntrada(tarea, motivo) {
  return db.enTransaccionPersistente(() => {
    if (tarea.clase !== 'analisis') outbox.encolar({ clave: `entrada-cancelada:${tarea.clave}`, usuario: tarea.usuario,
      texto: '🧪 Descarté un mensaje pendiente porque no puedo recuperar su modo o sus datos de prueba. No ejecuté su recuperación. Revisa /ultimos antes de reenviarlo. Usa /prueba on para iniciar pruebas nuevas o /prueba off para volver al modo normal.' });
    db.basePersistente().prepare('UPDATE trabajos SET avisado=1 WHERE id=?').run(tarea.id);
    trabajos.cancelar(tarea.clave, motivo);
  });
}

export function recuperarEntradas() {
  const filas = db.basePersistente().prepare("SELECT id,clave,usuario,modo_operacion,sesion_prueba,clase FROM trabajos WHERE tipo='entrada' AND ((estado IN ('pendiente','procesando') AND (modo_operacion IS NULL OR modo_operacion='prueba')) OR (estado='cancelado' AND error='modo_heredado_desconocido' AND avisado=0)) LIMIT 500").all();
  for (const t of filas) if (!t.modo_operacion || !perteneceAlProceso(t.sesion_prueba)) cancelarEntrada(t, t.modo_operacion ? 'sesion_prueba_perdida' : 'modo_heredado_desconocido');
}

// El callback de texto/media solo puede usar la base capturada; nunca la selecciona al reintentar.
export async function procesarEntrada(tarea, procesar) {
  const prueba = tarea.modo_operacion === 'prueba';
  if (!['real','prueba'].includes(tarea.modo_operacion) || (prueba && !perteneceAlProceso(tarea.sesion_prueba))) return cancelarEntrada(tarea,'modo_o_sesion_no_recuperable');
  trabajos.leerContenido(tarea.contenido, tarea); // autentica también los metadatos de control
  if (tarea.control_modo) {
    // Los comandos de control corren en persistente: cerrar una base temporal no cierra una transacción abierta.
    return db.enTransaccionPersistente(() => {
      if (db.yaProcesado(tarea.clave)) return;
      const texto = responderPrueba(tarea.usuario, tarea.control_modo, { sesion: tarea.sesion_prueba });
      outbox.encolar({ clave: `respuesta-control:${tarea.clave}`, usuario: tarea.usuario, texto });
      db.marcarProcesado(tarea.clave);
    });
  }
  if (prueba && db.sesionPrueba(tarea.usuario) !== tarea.sesion_prueba) return cancelarEntrada(tarea,'sesion_prueba_descartada');
  return db.conModoCapturado(tarea.usuario,tarea,() => procesar(tarea));
}
