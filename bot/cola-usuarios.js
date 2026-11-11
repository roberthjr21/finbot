import { entero } from './limites.js';

// Cola de mensajes por persona.
//  • Los mensajes de UNA misma persona se procesan uno tras otro, en el orden en que llegaron
//    (así "gasté 5 mil" y luego "/deshacer" nunca se cruzan, y la idempotencia se conserva).
//  • Personas distintas se procesan a la vez: una IA lenta de una persona no frena a las demás.
//  • Un tope global (COLA_CONCURRENCIA, 6 por defecto) evita saturar la IA y la base de datos.
//  • Un tope por persona (COLA_MAX_PENDIENTES, 15) evita que alguien llene la memoria.

export function crearColas({
  concurrencia = entero('COLA_CONCURRENCIA', 6),
  maxPendientes = entero('COLA_MAX_PENDIENTES', 15),
  alError = (error) => console.error('Error en la cola:', error),
} = {}) {
  const cadenas = new Map(); // clave -> última promesa de la cadena
  const pendientes = new Map(); // clave -> cuántas tareas hay esperando o corriendo
  let corriendo = 0;
  const esperando = [];

  const adquirir = () => new Promise((resolver) => {
    if (corriendo < concurrencia) { corriendo++; resolver(); } else esperando.push(resolver);
  });
  const liberar = () => {
    const siguiente = esperando.shift();
    if (siguiente) siguiente(); else corriendo--;
  };

  // Devuelve la promesa de la tarea, o null si esa persona ya tiene demasiadas en espera.
  function encolar(clave, tarea) {
    const n = pendientes.get(clave) ?? 0;
    if (n >= maxPendientes) return null;
    pendientes.set(clave, n + 1);
    const anterior = cadenas.get(clave) ?? Promise.resolve();
    const actual = anterior.then(async () => {
      await adquirir();
      try { await tarea(); } catch (error) { alError(error); } finally { liberar(); }
    }).finally(() => {
      const quedan = (pendientes.get(clave) ?? 1) - 1;
      if (quedan <= 0) { pendientes.delete(clave); if (cadenas.get(clave) === actual) cadenas.delete(clave); } else pendientes.set(clave, quedan);
    });
    cadenas.set(clave, actual);
    return actual;
  }

  return {
    encolar,
    pendientesDe: (clave) => pendientes.get(clave) ?? 0,
    activas: () => cadenas.size,
    // Para apagar con calma: espera a que todas terminen
    async esperarTodo() { while (cadenas.size) await Promise.allSettled([...cadenas.values()]); },
  };
}
