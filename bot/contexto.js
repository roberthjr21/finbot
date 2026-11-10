import * as db from './db.js';
import { CATEGORIAS, buscarCategoria, normalizar } from './categorias.js';
import { parseMonto } from './montos.js';
import { entero } from './limites.js';

// Contexto de conversación por persona.
//  • Guarda solo datos estructurados (id del último movimiento, una confirmación pendiente),
//    nunca el texto de los mensajes.
//  • Vence solo: pasado CONTEXTO_MINUTOS (30 por defecto) se ignora y se borra.
//  • Cada persona tiene su propia fila; nada se comparte entre cuentas.

const ttlMs = () => entero('CONTEXTO_MINUTOS', 30) * 60_000;

// Una confirmación pendiente (voz, recibo, recarga) vence antes que el resto del contexto:
// CONFIRMACION_MINUTOS (10 por defecto). Así un "sí" suelto de mucho después no registra nada viejo.
const ttlConfirmacionMs = () => entero('CONFIRMACION_MINUTOS', 10) * 60_000;
const CON_VENCIMIENTO = ['pendiente', 'recarga'];

export function obtener(usuario, ahora = Date.now()) {
  const fila = db.base().prepare('SELECT datos, actualizado FROM contexto WHERE usuario = ?').get(usuario);
  if (!fila) return {};
  if (ahora - fila.actualizado > ttlMs()) {
    borrar(usuario);
    return {};
  }
  let datos;
  try { datos = JSON.parse(fila.datos); } catch { return {}; }
  for (const k of CON_VENCIMIENTO) {
    if (datos[k] && ahora - (datos[k].creado ?? 0) > ttlConfirmacionMs()) delete datos[k];
  }
  return datos;
}

// Mezcla los campos nuevos con lo vigente; un campo en null se elimina
export function guardar(usuario, parcial, ahora = Date.now()) {
  const actual = obtener(usuario, ahora);
  const nuevo = { ...actual, ...parcial };
  for (const k of CON_VENCIMIENTO) if (nuevo[k] && typeof nuevo[k] === 'object' && !nuevo[k].creado) nuevo[k] = { ...nuevo[k], creado: ahora };
  for (const k of Object.keys(nuevo)) if (nuevo[k] === null) delete nuevo[k];
  db.base()
    .prepare('INSERT INTO contexto (usuario, datos, actualizado) VALUES (?, ?, ?) ON CONFLICT (usuario) DO UPDATE SET datos = excluded.datos, actualizado = excluded.actualizado')
    .run(usuario, JSON.stringify(nuevo).slice(0, 8000), ahora);
}

export const borrar = (usuario) => db.base().prepare('DELETE FROM contexto WHERE usuario = ?').run(usuario).changes > 0;

// Limpieza general de contextos vencidos (la llama el programador)
export const purgar = (ahora = Date.now()) =>
  db.base().prepare('DELETE FROM contexto WHERE actualizado < ?').run(ahora - ttlMs()).changes;

// ¿El mensaje parece una pregunta o una orden NUEVA (y no la respuesta a lo que está pendiente)?
// Sirve para que una confirmación o una recarga a medias no se "coman" consultas o gastos nuevos.
const INTERROGATIVA = /^(cuanto|cuanta|cuantos|cuantas|que|quien|quienes|como|cual|cuales|donde|cuando|por que|para que|en que|a quien|de quien|hay|tengo|puedes|podrias|me puedes|dime|muestrame|dame|ver|mi saldo|saldo)\b/;
const ORDEN = /\b(gaste|gastaste|compre|pague|abone|preste|debo|recargue|borra|borrar|elimina|eliminar|cambia|ponme|fijar|fija|recuerdame|recordatorio|resumen|ultimos|presupuesto|meta|aportar|analiza)\b/;
export function pareceOtroTema(texto) {
  const t = normalizar(texto).replace(/[¡!]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  return String(texto).includes('?') || INTERROGATIVA.test(t) || ORDEN.test(t);
}

// ---- Confirmaciones ("sí" / "no") ----
const SI = new Set(['si', 'sii', 'dale', 'ok', 'okay', 'listo', 'confirmo', 'confirmar', 'correcto', 'claro', 'yes', 'registralo', 'registrala', 'guardalo']);
const NO = new Set(['no', 'nop', 'cancela', 'cancelar', 'cancelalo', 'descartar', 'descartalo', 'olvidalo']);

export function respuestaDeConfirmacion(texto) {
  const t = normalizar(texto).replace(/[^a-z\s]/g, '').trim();
  if (!t || t.split(/\s+/).length > 3) return null;
  const primera = t.split(/\s+/)[0];
  if (SI.has(t) || SI.has(primera)) return 'si';
  if (NO.has(t) || NO.has(primera)) return 'no';
  return null;
}

// ---- Correcciones del último movimiento ("mejor ponlo en transporte", "era de 30 mil") ----
const CUE = /^(?:no[,.\s]+)?(?:mejor|cambia(?:lo|la)?|pon(?:lo|la)|pasa(?:lo|la)|corrige(?:lo|la)?|era|eran|fue|fueron|la categoria|el monto|en realidad)\b/;
const RESERVADAS = ['Préstamos', 'Deudas'];

export function interpretarCorreccion(texto) {
  const t = normalizar(texto).replace(/[¡!¿?]+|[.,;:](?!\d)/g, ' ').replace(/\s+/g, ' ').trim();
  if (!CUE.test(t) || t.length > 80) return null;
  const cambios = {};

  const palabras = t.split(' ');
  const categoria = palabras.map((w) => buscarCategoria(w)).find((c) => c && !RESERVADAS.includes(c));
  if (categoria) cambios.categoria = categoria;

  // "30 mil", "30.000", "1,5 millones": busca el monto como en el resto del bot
  const m = t.match(/\$?\d[\d.,]*(?:\s*(?:mil|lucas|k|millones?|millon))?/);
  if (m) {
    const monto = parseMonto(m[0].trim());
    if (monto) cambios.monto = monto;
  }
  return Object.keys(cambios).length ? cambios : null;
}

export const CATEGORIAS_CORREGIBLES = CATEGORIAS.filter((c) => !RESERVADAS.includes(c));
