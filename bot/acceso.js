// Acceso a la página web con un código enviado por WhatsApp.
// - El código es de 6 dígitos, vence en 5 minutos, sirve una vez y admite 5 intentos.
// - En la base solo se guarda un HMAC del código y un hash del token de sesión.
// - Las respuestas no revelan si un número tiene cuenta.
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import * as db from './db.js';
import { crearLimitador } from './limites.js';

const CODIGO_VIDA_S = 5 * 60;
const MAX_INTENTOS = 5;
const ESPERA_ENTRE_CODIGOS_S = 60;
const SESION_VIDA_S = 7 * 24 * 60 * 60;

const crearLimites = () => ({
  codigoTelefonoGap: crearLimitador({ max: 1, ventanaMs: ESPERA_ENTRE_CODIGOS_S * 1000 }),
  codigoTelefonoHora: crearLimitador({ max: 5, ventanaMs: 60 * 60 * 1000 }),
  codigoIpHora: crearLimitador({ max: 15, ventanaMs: 60 * 60 * 1000 }),
  verificarTelefono: crearLimitador({ max: 10, ventanaMs: 10 * 60 * 1000 }),
  verificarIpHora: crearLimitador({ max: 30, ventanaMs: 60 * 60 * 1000 }),
});
let limites = crearLimites();
// Solo para pruebas: borra los contadores en memoria
export const reiniciarLimites = () => { limites = crearLimites(); };

export const ahoraS = () => Math.floor(Date.now() / 1000);
export const normalizarTelefono = (valor) => String(valor ?? '').replace(/\D/g, '');
export const telefonoValido = (telefono) => /^\d{8,15}$/.test(telefono);

function secreto() {
  const s = process.env.SECRETO_SESION || process.env.API_TOKEN;
  if (!s) throw new Error('Falta API_TOKEN o SECRETO_SESION para firmar los códigos de acceso.');
  return s;
}

const hashCodigo = (usuarioId, codigo) =>
  createHmac('sha256', secreto()).update(`codigo:${usuarioId}:${codigo}`).digest('hex');
const hashToken = (token) => createHash('sha256').update(token).digest('hex');

function iguales(a, b) {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && timingSafeEqual(x, y);
}

// Pide un código. Responde igual exista o no la cuenta; solo informa formato inválido o demasiadas peticiones.
export async function solicitarCodigo({ telefono, ip = '?', enviar, ahora = ahoraS() }) {
  const tel = normalizarTelefono(telefono);
  if (!telefonoValido(tel)) return { ok: false, motivo: 'formato' };
  if (
    !limites.codigoIpHora.intentar(ip).ok ||
    !limites.codigoTelefonoGap.intentar(tel).ok ||
    !limites.codigoTelefonoHora.intentar(tel).ok
  ) {
    return { ok: false, motivo: 'espera' };
  }

  const usuario = db.usuarioPorTelefono(tel);
  if (!usuario || usuario.estado !== 'activo') return { ok: true };
  if (ahora - db.ultimoCodigoCreado(usuario.id) < ESPERA_ENTRE_CODIGOS_S) return { ok: true };

  const codigo = String(randomInt(0, 1_000_000)).padStart(6, '0');
  db.guardarCodigo({ usuarioId: usuario.id, hash: hashCodigo(usuario.id, codigo), ahora, expira: ahora + CODIGO_VIDA_S });
  try {
    await enviar(usuario.telefono,
      `🔐 Tu código para entrar a FinBot es *${codigo}*.\nVence en 5 minutos. No lo compartas con nadie. Si no lo pediste tú, ignora este mensaje.`);
  } catch {
    console.warn('No se pudo enviar un código de acceso por WhatsApp.');
  }
  return { ok: true };
}

// Comprueba el código y, si es correcto, abre una sesión. Todos los fallos responden igual.
export function verificarCodigo({ telefono, codigo, ip = '?', ahora = ahoraS() }) {
  const fallo = { ok: false };
  const tel = normalizarTelefono(telefono);
  const texto = String(codigo ?? '').trim();
  if (!limites.verificarIpHora.intentar(ip).ok || !limites.verificarTelefono.intentar(tel).ok) return fallo;
  if (!telefonoValido(tel) || !/^\d{6}$/.test(texto)) return fallo;

  const usuario = db.usuarioPorTelefono(tel);
  if (!usuario || usuario.estado !== 'activo') return fallo;
  const fila = db.codigoActivo(usuario.id, ahora);
  if (!fila || fila.intentos >= MAX_INTENTOS) return fallo;

  if (!iguales(fila.hash, hashCodigo(usuario.id, texto))) {
    db.sumarIntentoCodigo(fila.id);
    if (fila.intentos + 1 >= MAX_INTENTOS) db.gastarCodigo(fila.id);
    return fallo;
  }

  db.gastarCodigo(fila.id);
  const token = randomBytes(32).toString('base64url');
  const expira = ahora + SESION_VIDA_S;
  db.crearSesion({ usuarioId: usuario.id, tokenHash: hashToken(token), ahora, expira });
  db.limpiarAcceso(ahora);
  return { ok: true, token, expira };
}

// Devuelve { id, telefono } de la sesión, o null
export function validarSesion(token, ahora = ahoraS()) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  return db.sesionValida(hashToken(token), ahora);
}

export const cerrarSesion = (token) =>
  typeof token === 'string' && token.length >= 20 && token.length <= 100 ? db.revocarSesion(hashToken(token)) : false;
