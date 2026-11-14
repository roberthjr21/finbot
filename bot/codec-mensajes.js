import { proto, normalizeMessageContent } from '@whiskeysockets/baileys';

// Solo lo necesario para procesar: sin pushName, etiquetas ni mensajes citados.
export function codificarMensaje(msg) {
  const contenido = normalizeMessageContent(msg.message);
  const limpio = Object.fromEntries(Object.entries(contenido ?? {}).map(([k,v]) => [k, v && typeof v === 'object' ? { ...v, contextInfo: undefined } : v]));
  return Buffer.from(proto.WebMessageInfo.encode({ key: msg.key, message: limpio, messageTimestamp: msg.messageTimestamp }).finish()).toString('base64');
}
export const decodificarMensaje = texto => proto.WebMessageInfo.decode(Buffer.from(texto, 'base64'));

export const esSaludoInicial = texto => /^(hola|buenas|buenos dias|buenas tardes|buenas noches)[!. ]*$/.test(String(texto).normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().trim());
