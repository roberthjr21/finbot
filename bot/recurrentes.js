import * as db from './db.js';
import { fechaBogota, pesos, sumarDias, valida } from './fechas.js';
import { validarMovimiento } from './movimientos.js';

// Ingresos y gastos que se repiten. Dos conceptos distintos:
//   • programado = recurrentes.proxima (lo que viene)
//   • ejecutado  = fila en recurrentes_ejecuciones + su movimiento (lo que ya se registró)
// La clave (recurrente, fecha) es única y el movimiento lleva mensaje_id "rec:ID:FECHA",
// así que reinicios, reintentos o dos instancias nunca duplican un movimiento.

export const FRECUENCIAS = ['diaria', 'semanal', 'quincenal', 'mensual'];
const MAX_POR_CICLO = 62; // tope de fechas atrasadas por recurrente en cada ciclo

const diasDelMes = (a, m) => new Date(Date.UTC(a, m, 0)).getUTCDate();

// Siguiente fecha después de "fecha". En mensual conserva el día elegido (31 -> último día de meses cortos).
export function siguienteFecha(fecha, frecuencia, diaMes) {
  switch (frecuencia) {
    case 'diaria': return sumarDias(fecha, 1);
    case 'semanal': return sumarDias(fecha, 7);
    case 'quincenal': return sumarDias(fecha, 15);
    case 'mensual': {
      const [a, m] = fecha.split('-').map(Number);
      const anio = m === 12 ? a + 1 : a;
      const mes = m === 12 ? 1 : m + 1;
      const dia = Math.min(diaMes ?? Number(fecha.slice(8)), diasDelMes(anio, mes));
      return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
    }
    default: throw new RangeError('Frecuencia no válida');
  }
}

// Primera fecha >= desde que cae en el calendario de la recurrencia que empezó en "inicio"
function primeraDesde(inicio, frecuencia, diaMes, desde) {
  let f = inicio;
  for (let i = 0; f < desde && i < 5000; i++) f = siguienteFecha(f, frecuencia, diaMes);
  return f;
}

const CAMPOS = 'id, tipo, monto, categoria, descripcion, frecuencia, dia_mes, proxima, estado';

export function crear({ usuario, tipo, monto, categoria, descripcion, frecuencia, inicio, mensajeId = null }, { hoy = fechaBogota() } = {}) {
  if (!FRECUENCIAS.includes(frecuencia)) return { ok: false, error: 'La frecuencia debe ser diaria, semanal, quincenal o mensual.' };
  const fecha = inicio ?? hoy;
  if (!valida(fecha) || fecha < hoy) return { ok: false, error: 'La fecha de inicio no es válida o ya pasó.' };
  const v = validarMovimiento({ tipo, monto, categoria, descripcion, fecha: hoy }, { hoy });
  if (!v.ok) return v;
  const r = db.base()
    .prepare('INSERT INTO recurrentes (usuario, tipo, monto, categoria, descripcion, frecuencia, dia_mes, proxima, mensaje_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (mensaje_id) DO NOTHING')
    .run(usuario, v.valor.tipo, v.valor.monto, v.valor.categoria, v.valor.descripcion, frecuencia, Number(fecha.slice(8)), fecha, mensajeId);
  if (r.changes === 0) return { ok: true, duplicado: true };
  return { ok: true, id: Number(r.lastInsertRowid) };
}

export const obtener = (usuario, id) =>
  db.base().prepare(`SELECT ${CAMPOS} FROM recurrentes WHERE usuario = ? AND id = ? AND estado <> 'eliminado'`).get(usuario, id) ?? null;

export const listar = (usuario) =>
  db.base().prepare(`SELECT ${CAMPOS} FROM recurrentes WHERE usuario = ? AND estado <> 'eliminado' ORDER BY proxima, id`).all(usuario);

export function editar(usuario, id, cambios, { hoy = fechaBogota() } = {}) {
  const actual = obtener(usuario, id);
  if (!actual) return { ok: false, error: 'No encontré ese movimiento recurrente.' };
  const v = validarMovimiento({ ...actual, fecha: hoy, ...cambios }, { hoy });
  if (!v.ok) return v;
  const frecuencia = cambios.frecuencia ?? actual.frecuencia;
  if (!FRECUENCIAS.includes(frecuencia)) return { ok: false, error: 'La frecuencia no es válida.' };
  db.base()
    .prepare('UPDATE recurrentes SET tipo = ?, monto = ?, categoria = ?, descripcion = ?, frecuencia = ? WHERE usuario = ? AND id = ?')
    .run(v.valor.tipo, v.valor.monto, v.valor.categoria, v.valor.descripcion, frecuencia, usuario, id);
  return { ok: true };
}

export const pausar = (usuario, id) =>
  db.base().prepare("UPDATE recurrentes SET estado = 'pausado' WHERE usuario = ? AND id = ? AND estado = 'activo'").run(usuario, id).changes > 0;

// Al reactivar NO se ponen al día las fechas que pasaron durante la pausa: sigue desde la próxima
export function reactivar(usuario, id, { hoy = fechaBogota() } = {}) {
  const r = obtener(usuario, id);
  if (!r || r.estado !== 'pausado') return false;
  const proxima = primeraDesde(r.proxima, r.frecuencia, r.dia_mes, hoy);
  db.base().prepare("UPDATE recurrentes SET estado = 'activo', proxima = ? WHERE usuario = ? AND id = ?").run(proxima, usuario, id);
  return true;
}

// Se conserva la fila (y los movimientos ya registrados); solo deja de ejecutarse
export const eliminar = (usuario, id) =>
  db.base().prepare("UPDATE recurrentes SET estado = 'eliminado' WHERE usuario = ? AND id = ? AND estado <> 'eliminado'").run(usuario, id).changes > 0;

// Registra los movimientos que ya tocan (también los atrasados por un apagado del bot).
// Devuelve lo ejecutado para avisar al usuario.
export function ejecutarPendientes({ hoy = fechaBogota() } = {}) {
  const hechos = [];
  const activos = db.base().prepare("SELECT usuario, id FROM recurrentes WHERE estado = 'activo' AND proxima <= ? ORDER BY id").all(hoy);
  for (const { usuario, id } of activos) {
    db.enTransaccion(() => {
      const r = db.base().prepare(`SELECT usuario, ${CAMPOS} FROM recurrentes WHERE id = ? AND estado = 'activo'`).get(id);
      if (!r) return;
      let proxima = r.proxima;
      for (let i = 0; proxima <= hoy && i < MAX_POR_CICLO; i++) {
        const ya = db.base().prepare('INSERT OR IGNORE INTO recurrentes_ejecuciones (recurrente_id, fecha) VALUES (?, ?)').run(id, proxima);
        if (ya.changes > 0) {
          const movimientoId = db.agregarMovimiento({
            usuario: r.usuario, tipo: r.tipo, monto: r.monto, categoria: r.categoria,
            descripcion: r.descripcion || `Recurrente #${id}`, fecha: proxima, mensajeId: `rec:${id}:${proxima}`,
          });
          db.base().prepare('UPDATE recurrentes_ejecuciones SET movimiento_id = ? WHERE recurrente_id = ? AND fecha = ?').run(movimientoId, id, proxima);
          db.registrarAuditoria({ usuario: r.usuario, accion: 'ejecutar_recurrente', entidad: 'movimiento', entidadId: movimientoId, origen: 'sistema', detalle: { recurrente: id, fecha: proxima } });
          hechos.push({ usuario: r.usuario, id, fecha: proxima, tipo: r.tipo, monto: r.monto, categoria: r.categoria, descripcion: r.descripcion });
        }
        proxima = siguienteFecha(proxima, r.frecuencia, r.dia_mes);
      }
      db.base().prepare('UPDATE recurrentes SET proxima = ? WHERE id = ?').run(proxima, id);
    });
  }
  return hechos;
}

export function textoRecurrente(r) {
  const signo = r.tipo === 'gasto' ? '💸' : '💰';
  const pausa = r.estado === 'pausado' ? ' (⏸ pausado)' : '';
  return `#${r.id} ${signo} ${pesos(r.monto)} ${r.categoria}${r.descripcion ? ` · ${r.descripcion}` : ''} · ${r.frecuencia} · próxima ${r.proxima}${pausa}`;
}
