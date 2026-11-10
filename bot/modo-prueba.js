import * as db from './db.js';

export function interpretarPrueba(texto) {
  const normal = String(texto ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  const comando = normal.match(/^\/(?:prueba|test)(?:\s+(on|off|estado|activar|desactivar))?$/);
  if (comando) return comando[1] ?? 'estado';
  if (/^(?:activa|activar|enciende|encender) (?:el )?modo de pruebas?$/.test(normal)) return 'on';
  if (/^(?:desactiva|desactivar|apaga|apagar) (?:el )?modo de pruebas?$/.test(normal)) return 'off';
  return null;
}

export function responderPrueba(usuario, opcion) {
  if (['on', 'activar'].includes(opcion)) {
    if (db.pruebaActiva(usuario)) return '🧪 El modo de pruebas ya está activo. Tus datos temporales siguen disponibles.';
    db.activarPrueba(usuario);
    return '🧪 MODO PRUEBA ACTIVADO. Tus próximos movimientos, deudas, metas y presupuestos se guardarán únicamente en memoria y NO aparecerán en la web. Empiezas con datos ficticios vacíos. Usa /prueba off para salir. Al reiniciar FinBot se perderán las pruebas.';
  }
  if (['off', 'desactivar'].includes(opcion)) {
    if (!db.desactivarPrueba(usuario)) return '✅ Ya estabas en modo normal.';
    return '✅ MODO PRUEBA DESACTIVADO. Descarté todos tus datos temporales. Tus finanzas reales nunca se modificaron durante la prueba.';
  }
  return db.pruebaActiva(usuario)
    ? '🧪 MODO PRUEBA ACTIVO. Los datos temporales están aislados de la web y de tus finanzas reales. /prueba off para salir.'
    : '✅ MODO NORMAL. Los movimientos se registran en tus finanzas reales. /prueba on para probar sin afectar tus datos.';
}
