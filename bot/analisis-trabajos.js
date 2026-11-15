import * as db from './db.js';
import * as trabajos from './trabajos.js';
import * as outbox from './outbox.js';
import { datosAnalisis, responderDatosAnalisis } from './analisis.js';

export function reservarAnalisis({ usuario, mensajeId, jid, hoy, usarIA = true }) {
  const clave = `analisis:${usuario}:${mensajeId}`;
  const respuesta = `respuesta:${usuario}:${mensajeId}:analisis`;
  const modo = db.modoCapturado() ?? { modo_operacion:'real', sesion_prueba:null };
  const prefijo = modo.modo_operacion === 'prueba' ? '🧪 MODO PRUEBA · Datos temporales.\n\n' : '';
  const datos = datosAnalisis(usuario,hoy);
  return db.enTransaccionPersistente(() => {
  const r = trabajos.admitir({ clave, usuario, tipo:'entrada', clase:'analisis',
    modo_operacion:modo.modo_operacion, sesion_prueba:modo.sesion_prueba,
    contenido: JSON.stringify({ datos, hoy, respuesta, jid, prefijo, usarIA }) });
  if (!r.ok) throw new Error('Cola de análisis saturada');
  const id = r.id ?? db.basePersistente().prepare('SELECT id FROM trabajos WHERE clave=?').get(clave)?.id;
  if (id) outbox.encolar({ clave:respuesta, usuario, jid, texto:'📈 Análisis pendiente.', esperando:1, dependencia:id });
  return r;
  });
}

export async function procesarAnalisis(tarea, opciones = {}) {
  const d = JSON.parse(trabajos.leerContenido(tarea.contenido,tarea));
  let fallo = false;
  const texto = await responderDatosAnalisis(d.datos,d.hoy,{ ...opciones, ...(!d.usarIA ? {generar:null} : {}), registrarFallo:()=>{fallo=true;} });
  // El trabajador ejecuta este callback al confirmar su lease, en la misma transacción que 'hecho'.
  return () => {
    if (!trabajos.completarRespuesta(d.respuesta,JSON.stringify({texto:d.prefijo+texto,jid:d.jid}))) throw new Error('Respuesta de análisis no disponible');
    if (fallo) db.basePersistente().prepare("UPDATE trabajos SET error='proveedor_ia_no_disponible' WHERE id=?").run(tarea.id);
  };
}
