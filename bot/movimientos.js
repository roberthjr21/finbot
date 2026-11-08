import { buscarCategoria } from './categorias.js';
import { fechaBogota, valida } from './fechas.js';
import { montoValido, montoMaximo } from './montos.js';

// Validación compartida para crear o editar movimientos desde la web (y futuras interfaces).
// Las categorías Préstamos y Deudas están reservadas: nacen de sus propios registros (le presté, abono...),
// así los totales de "lo que debo" y "lo que me deben" nunca se desordenan.
export const CATEGORIAS_RESERVADAS = ['Préstamos', 'Deudas'];
const FECHA_MINIMA = '2000-01-01';

// parcial=true: en una edición solo se validan los campos presentes
export function validarMovimiento(datos, { parcial = false, hoy = fechaBogota() } = {}) {
  const d = datos && typeof datos === 'object' ? datos : {};
  const valor = {};

  if (!parcial || d.tipo !== undefined) {
    if (d.tipo !== 'ingreso' && d.tipo !== 'gasto') return { ok: false, error: 'El tipo debe ser ingreso o gasto.' };
    valor.tipo = d.tipo;
  }
  if (!parcial || d.monto !== undefined) {
    if (!montoValido(d.monto)) return { ok: false, error: `El monto debe ser un número entero de pesos entre 1 y ${montoMaximo().toLocaleString('es-CO')}.` };
    valor.monto = d.monto;
  }
  if (!parcial || d.categoria !== undefined) {
    const categoria = typeof d.categoria === 'string' ? buscarCategoria(d.categoria) : null;
    if (!categoria) return { ok: false, error: 'Esa categoría no existe.' };
    if (CATEGORIAS_RESERVADAS.includes(categoria)) return { ok: false, error: `La categoría ${categoria} se registra desde la sección o el chat de ${categoria === 'Deudas' ? 'deudas' : 'préstamos'}.` };
    valor.categoria = categoria;
  }
  if (!parcial || d.fecha !== undefined) {
    if (typeof d.fecha !== 'string' || !valida(d.fecha) || d.fecha < FECHA_MINIMA) return { ok: false, error: 'La fecha no es válida (usa AAAA-MM-DD).' };
    if (d.fecha > hoy) return { ok: false, error: 'La fecha no puede ser futura: para pagos futuros usa un recordatorio.' };
    valor.fecha = d.fecha;
  }
  if (!parcial || d.descripcion !== undefined) {
    if (d.descripcion !== undefined && typeof d.descripcion !== 'string') return { ok: false, error: 'La descripción debe ser texto.' };
    const texto = (d.descripcion ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (texto.length > 120) return { ok: false, error: 'La descripción admite hasta 120 caracteres.' };
    valor.descripcion = texto;
  }
  if (parcial && Object.keys(valor).length === 0) return { ok: false, error: 'No hay nada que cambiar.' };
  return { ok: true, valor };
}
