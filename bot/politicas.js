const destructivas = new Set(['deshacer_ultimo', 'confirmar_deshacer', 'borrar_datos', 'confirmar_borrado']);

// Confirmar o cancelar un borrado solo lo puede hacer la persona escribiendo el comando:
// si la IA devolviera alguna de estas acciones, se descarta para que nunca confirme por su cuenta.
const SOLO_COMANDO = new Set(['confirmar_deshacer', 'cancelar_deshacer', 'confirmar_borrado', 'cancelar_borrado']);
export const sinConfirmaciones = (acciones) =>
  Array.isArray(acciones) ? acciones.filter((a) => !SOLO_COMANDO.has(a?.nombre)) : [];

export function acotarAcciones(acciones, maximo = 5) {
  if (!Array.isArray(acciones)) return [];
  const resultado = [];
  let yaHayDestructiva = false;
  for (const accion of acciones.slice(0, maximo)) {
    if (destructivas.has(accion?.nombre)) {
      if (yaHayDestructiva) continue;
      yaHayDestructiva = true;
    }
    resultado.push(accion);
  }
  return resultado;
}
