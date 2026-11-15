// Diagnóstico de cuenta: nunca muestra claves, datos financieros privados ni otras cuentas.
import * as db from './db.js';
import { fechaBogota } from './fechas.js';
import { entero } from './limites.js';
import { hayIA, nombreProveedor } from './ia.js';
import { hayMedia } from './media.js';
import * as contexto from './contexto.js';
import { estadoProgramador } from './programador.js';

export function textoDiagnostico(usuario, ahora = new Date()) {
  const real = db.basePersistente();
  const hoy = fechaBogota(ahora);
  const uso = real.prepare('SELECT mensajes, ia FROM uso_diario WHERE usuario = ? AND dia = ?').get(usuario, hoy) ?? { mensajes: 0, ia: 0 };
  const cola = real.prepare("SELECT tipo, COUNT(*) cantidad FROM trabajos WHERE usuario = ? AND estado IN ('pendiente','procesando') GROUP BY tipo").all(usuario);
  const entradas = cola.find(c => c.tipo === 'entrada')?.cantidad ?? 0;
  const salidas = cola.find(c => c.tipo === 'salida')?.cantidad ?? 0;
  const proyectado = real.prepare('SELECT modo FROM entrada_modos WHERE usuario = ?').get(usuario)?.modo ?? 'real';
  const modo = db.pruebaActiva(usuario) ? '🧪 prueba activa'
    : proyectado === 'prueba' ? '🧪 prueba pendiente de reactivar' : 'normal';
  const pendiente = contexto.obtener(usuario);
  const programador = estadoProgramador(ahora.getTime());
  const formato = (n) => Number(n).toLocaleString('es-CO');
  return [
    '🩺 *Diagnóstico de tu FinBot*',
    `IA: ${hayIA() ? nombreProveedor() : 'sin configurar (comandos disponibles)'}`,
    `Audio y fotos: ${hayMedia() ? 'configurados' : 'no disponibles'}`,
    `Tu modo: ${modo}`,
    `Mensajes de hoy: ${formato(uso.mensajes)}/${formato(entero('MAX_MENSAJES_DIA', 300))}`,
    `Solicitudes de IA hoy: ${formato(uso.ia)}/${formato(entero('MAX_IA_DIA', 150))}`,
    `Tus trabajos pendientes: ${formato(entradas)} de entrada, ${formato(salidas)} de salida`,
    `Confirmación pendiente: ${pendiente.pendiente || pendiente.recarga ? 'sí' : 'no'}`,
    `Programador: ${programador.estado}${programador.etapasFallidas.length ? ' (fallos: ' + programador.etapasFallidas.join(', ') + ')' : ''}`,
    'Este diagnóstico no comprueba la entrega en WhatsApp ni la disponibilidad del proveedor de IA.',
  ].join('\n');
}
