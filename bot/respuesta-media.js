import * as db from './db.js';
import * as outbox from './outbox.js';
import * as contexto from './contexto.js';

export function completarMedia({ usuario, jid, mensajeId, texto, cambios }) {
  return db.enTransaccion(() => {
    if (db.yaProcesadoDe(usuario, mensajeId)) return false;
    if (cambios) contexto.guardar(usuario, cambios);
    db.marcarProcesado(`${usuario}:${mensajeId}`);
    outbox.encolar({ clave: `respuesta:${usuario}:${mensajeId}`, usuario, jid, texto });
    return true;
  });
}
