// Clasificación pura de mensajes multimedia normalizados por Baileys.
// No se debe usar ptt para decidir si un audio es válido: algunos clientes lo envían
// como false incluso si el usuario grabó el mensaje con el micrófono.
export const TIPOS_MEDIA = new Set([
  'audioMessage',
  'imageMessage',
  'videoMessage',
  'documentMessage',
  'stickerMessage',
]);

export function rutaMultimedia(contenido) {
  if (!contenido || typeof contenido !== 'object') return null;
  if (contenido.audioMessage) return 'audio';
  if (contenido.imageMessage) return 'imagen';
  return null;
}

export function tipoDeContenido(contenido) {
  if (!contenido || typeof contenido !== 'object') return 'vacío';
  if (contenido.audioMessage) return 'audioMessage';
  if (contenido.imageMessage) return 'imageMessage';
  return Object.keys(contenido).find((tipo) => TIPOS_MEDIA.has(tipo))
    ?? Object.keys(contenido)[0]
    ?? 'vacío';
}
