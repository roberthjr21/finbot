import * as db from './db.js';
import { entero } from './limites.js';
import { fechaBogota } from './fechas.js';
import { hayIA, nombreProveedor, estadoEnfriamiento } from './ia.js';
import { hayMedia } from './media.js';
import * as contexto from './contexto.js';
import { estadoProgramador } from './programador.js';
import { carpetaRespaldos, listarRespaldos } from './respaldos.js';

// /diagnostico: estado del bot para la propia persona. Nunca incluye claves, rutas, números ni
// datos de otras cuentas: solo si cada pieza funciona y cuánto ha usado hoy esta persona.
export function textoDiagnostico(usuario, ahora = new Date()) {
  const linea = (ok, texto) => `${ok ? '✅' : '⚠️'} ${texto}`;
  const hoy = fechaBogota(ahora);
  const real = db.enBaseReal(() => ({
    uso: db.usoDelDia(usuario, hoy),
    esquema: db.base().prepare('SELECT MAX(version) AS v FROM schema_migraciones').get().v,
  }));
  const espera = estadoEnfriamiento();
  const prog = estadoProgramador();
  const respaldos = (() => {
    try { return listarRespaldos(carpetaRespaldos(process.env.DB_ARCHIVO ?? 'finanzas.db')); } catch { return []; }
  })();
  const c = contexto.obtener(usuario);
  const pendiente = c.pendiente ? `confirmación pendiente (${c.pendiente.origen ?? 'movimientos'})` : c.recarga ? 'recarga por aclarar' : 'nada pendiente';
  return [
    '🩺 *Diagnóstico de FinBot*',
    linea(hayIA(), hayIA() ? `IA: ${nombreProveedor()}${espera > 0 ? ` (en espera ~${Math.ceil(espera / 1000)} s por límite de cuota)` : ' disponible'}` : 'IA: sin configurar (solo comandos)'),
    linea(espera === 0, espera === 0 ? 'Cuota de la IA: sin bloqueo' : 'Cuota de la IA: bloqueada temporalmente'),
    linea(hayMedia(), `Notas de voz y fotos de recibos: ${hayMedia() ? 'activas' : 'apagadas'}`),
    linea(true, `Tu uso de hoy: ${real.uso.mensajes}/${entero('MAX_MENSAJES_DIA', 300)} mensajes · ${real.uso.ia}/${entero('MAX_IA_DIA', 150)} con IA`),
    linea(true, `Modo: ${db.pruebaActiva(usuario) ? '🧪 PRUEBA (datos temporales)' : 'normal (finanzas reales)'}`),
    linea(true, `Base de datos: esquema v${real.esquema}`),
    linea(respaldos.length > 0, respaldos.length ? `Respaldos: ${respaldos.length} guardados (último: ${respaldos.at(-1).slice(10, 20)})` : 'Respaldos: aún no hay copias'),
    linea(Boolean(prog.ultimoCiclo), prog.ultimoCiclo ? 'Recordatorios y alertas: programador activo' : 'Recordatorios y alertas: el programador aún no ha corrido'),
    linea(true, `Contexto: ${pendiente}`),
  ].join('\n');
}
