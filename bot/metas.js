import * as db from './db.js';
import { normalizar } from './categorias.js';
import { fechaBogota, pesos, valida } from './fechas.js';
import { montoValido } from './montos.js';

// Metas de ahorro. Los aportes se guardan solo aquí (no crean movimientos): así el ahorro
// nunca se cuenta dos veces. Aporte positivo = aporte; negativo = retiro.

export const FRECUENCIAS_META = ['semanal', 'quincenal', 'mensual'];
const nombreLimpio = (n) => String(n ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();

export function crear({ usuario, nombre, objetivo, aporte = null, frecuencia = null, fechaLimite = null }, { hoy = fechaBogota() } = {}) {
  const n = nombreLimpio(nombre);
  if (n.length < 2 || n.length > 60) return { ok: false, error: 'El nombre de la meta debe tener entre 2 y 60 caracteres.' };
  if (!montoValido(objetivo)) return { ok: false, error: 'El objetivo no es un monto válido.' };
  if (aporte !== null && !montoValido(aporte)) return { ok: false, error: 'El aporte no es un monto válido.' };
  if ((aporte === null) !== (frecuencia === null)) return { ok: false, error: 'Indica el aporte y su frecuencia (semanal, quincenal o mensual).' };
  if (frecuencia !== null && !FRECUENCIAS_META.includes(frecuencia)) return { ok: false, error: 'La frecuencia debe ser semanal, quincenal o mensual.' };
  if (fechaLimite !== null && (!valida(fechaLimite) || fechaLimite <= hoy)) return { ok: false, error: 'La fecha límite debe ser futura.' };
  const existe = db.base().prepare("SELECT 1 FROM metas WHERE usuario = ? AND estado = 'activa' AND lower(nombre) = lower(?)").get(usuario, n);
  if (existe) return { ok: false, error: `Ya tienes una meta activa llamada ${n}.` };
  const r = db.base()
    .prepare('INSERT INTO metas (usuario, nombre, objetivo, aporte, frecuencia, fecha_limite) VALUES (?, ?, ?, ?, ?, ?)')
    .run(usuario, n, objetivo, aporte, frecuencia, fechaLimite);
  return { ok: true, id: Number(r.lastInsertRowid) };
}

function conProgreso(m) {
  const ahorrado = Number(db.base().prepare('SELECT COALESCE(SUM(monto), 0) AS s FROM metas_aportes WHERE meta_id = ?').get(m.id).s);
  const faltante = Math.max(m.objetivo - ahorrado, 0);
  return {
    id: m.id, nombre: m.nombre, objetivo: m.objetivo, aporte: m.aporte, frecuencia: m.frecuencia,
    fechaLimite: m.fecha_limite, estado: m.estado, creado: m.creado,
    ahorrado, faltante, porcentaje: Math.min(Math.floor((ahorrado / m.objetivo) * 100), 100),
    // Cuántos aportes periódicos faltan para completarla, si hay un aporte planeado
    aportesRestantes: m.aporte ? Math.ceil(faltante / m.aporte) : null,
  };
}

export const obtener = (usuario, id) => {
  const m = db.base().prepare("SELECT * FROM metas WHERE usuario = ? AND id = ? AND estado <> 'cancelada'").get(usuario, id);
  return m ? conProgreso(m) : null;
};

export const listar = (usuario) =>
  db.base().prepare("SELECT * FROM metas WHERE usuario = ? AND estado <> 'cancelada' ORDER BY estado, id").all(usuario).map(conProgreso);

// Busca por número ("3", "#3") o por parte del nombre. Si dos coinciden, pide precisar.
export function buscar(usuario, texto) {
  const t = String(texto ?? '').trim();
  const num = t.match(/^#?(\d{1,9})$/);
  const todas = listar(usuario);
  if (num) { const m = todas.find((x) => x.id === Number(num[1])); return m ? { meta: m } : {}; }
  const clave = normalizar(t);
  if (!clave) return {};
  const exacta = todas.filter((m) => normalizar(m.nombre) === clave);
  if (exacta.length === 1) return { meta: exacta[0] };
  const parecidas = todas.filter((m) => normalizar(m.nombre).includes(clave));
  if (parecidas.length === 1) return { meta: parecidas[0] };
  return parecidas.length > 1 ? { ambigua: parecidas.map((m) => m.nombre) } : {};
}

// signo +1 aporta, -1 retira. Devuelve la meta actualizada, o un error legible.
export function mover({ usuario, id, monto, signo, fecha = fechaBogota(), mensajeId = null }) {
  if (!montoValido(monto)) return { ok: false, error: 'El monto no es válido.' };
  const antes = obtener(usuario, id);
  if (!antes) return { ok: false, error: 'No encontré esa meta.' };
  if (antes.estado === 'cancelada') return { ok: false, error: 'Esa meta está cancelada.' };
  if (signo < 0 && monto > antes.ahorrado) return { ok: false, error: `Solo tienes ${pesos(antes.ahorrado)} ahorrados en esta meta.` };
  const r = db.base()
    .prepare('INSERT INTO metas_aportes (meta_id, usuario, monto, fecha, mensaje_id) VALUES (?, ?, ?, ?, ?) ON CONFLICT (mensaje_id) DO NOTHING')
    .run(id, usuario, signo * monto, fecha, mensajeId);
  if (r.changes === 0) return { ok: true, duplicado: true, meta: antes };
  const despues = conProgreso(db.base().prepare('SELECT * FROM metas WHERE id = ?').get(id));
  const estado = despues.ahorrado >= despues.objetivo ? 'cumplida' : 'activa';
  if (estado !== despues.estado) db.base().prepare('UPDATE metas SET estado = ? WHERE id = ?').run(estado, id);
  return { ok: true, meta: { ...despues, estado }, cumplida: estado === 'cumplida' && antes.estado !== 'cumplida' };
}

export const aportar = (datos) => mover({ ...datos, signo: 1 });
export const retirar = (datos) => mover({ ...datos, signo: -1 });

export const cancelar = (usuario, id) =>
  db.base().prepare("UPDATE metas SET estado = 'cancelada' WHERE usuario = ? AND id = ? AND estado <> 'cancelada'").run(usuario, id).changes > 0;

export function editar(usuario, id, { nombre, objetivo, aporte, frecuencia, fechaLimite }, { hoy = fechaBogota() } = {}) {
  const m = obtener(usuario, id);
  if (!m) return { ok: false, error: 'No encontré esa meta.' };
  const nuevo = {
    nombre: nombre === undefined ? m.nombre : nombreLimpio(nombre),
    objetivo: objetivo ?? m.objetivo,
    aporte: aporte === undefined ? m.aporte : aporte,
    frecuencia: frecuencia === undefined ? m.frecuencia : frecuencia,
    fechaLimite: fechaLimite === undefined ? m.fechaLimite : fechaLimite,
  };
  if (nuevo.nombre.length < 2 || nuevo.nombre.length > 60) return { ok: false, error: 'El nombre de la meta debe tener entre 2 y 60 caracteres.' };
  if (!montoValido(nuevo.objetivo)) return { ok: false, error: 'El objetivo no es un monto válido.' };
  if (nuevo.aporte !== null && !montoValido(nuevo.aporte)) return { ok: false, error: 'El aporte no es un monto válido.' };
  if ((nuevo.aporte === null) !== (nuevo.frecuencia === null)) return { ok: false, error: 'Indica el aporte y su frecuencia.' };
  if (nuevo.frecuencia !== null && !FRECUENCIAS_META.includes(nuevo.frecuencia)) return { ok: false, error: 'Frecuencia no válida.' };
  if (nuevo.fechaLimite !== null && (!valida(nuevo.fechaLimite) || nuevo.fechaLimite <= hoy)) return { ok: false, error: 'La fecha límite debe ser futura.' };
  db.base()
    .prepare('UPDATE metas SET nombre = ?, objetivo = ?, aporte = ?, frecuencia = ?, fecha_limite = ?, estado = ? WHERE usuario = ? AND id = ?')
    .run(nuevo.nombre, nuevo.objetivo, nuevo.aporte, nuevo.frecuencia, nuevo.fechaLimite, m.ahorrado >= nuevo.objetivo ? 'cumplida' : 'activa', usuario, id);
  return { ok: true };
}

const barra = (p) => `${'█'.repeat(Math.round(p / 10))}${'░'.repeat(10 - Math.round(p / 10))}`;

export function textoMeta(m) {
  const plan = m.aporte ? ` · plan ${pesos(m.aporte)} ${m.frecuencia}` : '';
  const limite = m.fechaLimite ? ` · para el ${m.fechaLimite}` : '';
  const fin = m.estado === 'cumplida' ? ' ✅ cumplida' : '';
  return `#${m.id} ${m.nombre}: ${barra(m.porcentaje)} ${m.porcentaje}% (${pesos(m.ahorrado)} de ${pesos(m.objetivo)})${plan}${limite}${fin}`;
}
