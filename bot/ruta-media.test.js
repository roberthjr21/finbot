import test from 'node:test';
import assert from 'node:assert/strict';
import { rutaMultimedia, tipoDeContenido, TIPOS_MEDIA } from './ruta-media.js';

test('audio: se reconoce con ptt true, false o ausente', () => {
  for (const ptt of [true, false, undefined]) {
    const contenido = { audioMessage: { mimetype: 'audio/ogg', ...(ptt === undefined ? {} : { ptt }) } };
    assert.equal(rutaMultimedia(contenido), 'audio');
    assert.equal(tipoDeContenido(contenido), 'audioMessage');
    assert.ok(TIPOS_MEDIA.has(tipoDeContenido(contenido)));
  }
});

test('audio: se reconoce incluso si no es la primera clave del objeto', () => {
  const contenido = { messageContextInfo: { deviceListMetadataVersion: 2 }, audioMessage: { ptt: false } };
  assert.equal(rutaMultimedia(contenido), 'audio');
  assert.equal(tipoDeContenido(contenido), 'audioMessage');
});

test('imagen: se reconoce aunque tenga metadatos adicionales', () => {
  const contenido = { messageContextInfo: {}, imageMessage: { mimetype: 'image/jpeg' } };
  assert.equal(rutaMultimedia(contenido), 'imagen');
  assert.equal(tipoDeContenido(contenido), 'imageMessage');
});

test('archivos no compatibles: se clasifican sin confundirlos con notas de voz', () => {
  assert.equal(rutaMultimedia({ documentMessage: {} }), null);
  assert.equal(tipoDeContenido({ documentMessage: {} }), 'documentMessage');
  assert.ok(TIPOS_MEDIA.has(tipoDeContenido({ documentMessage: {} })));
  assert.equal(rutaMultimedia(null), null);
  assert.equal(tipoDeContenido(null), 'vacío');
});
