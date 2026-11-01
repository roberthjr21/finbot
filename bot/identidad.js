// Identidad del remitente de un mensaje de WhatsApp.
// Un chat individual termina en @s.whatsapp.net (teléfono) o @lid (identificador oculto).
// Grupos (@g.us), estados y listas de difusión (@broadcast) y canales (@newsletter) no cuentan.

export const esChatIndividual = (jid) => {
  const id = String(jid ?? '');
  return id.endsWith('@s.whatsapp.net') || id.endsWith('@lid');
};

// Extrae el identificador sin el sufijo de WhatsApp.
export const soloNumero = (jid) =>
  String(jid ?? '')
    .split('@')[0]
    .split(':')[0];

// Un número de teléfono internacional válido (E.164: de 8 a 15 dígitos)
export const numeroValido = (numero) => /^\d{8,15}$/.test(numero);

// Devuelve el número de teléfono real del remitente de un chat individual, o null.
// Nunca usa un LID como si fuera un teléfono: solo acepta teléfonos explícitos
// o LID que WhatsApp pueda traducir a su teléfono.
export async function identificarRemitente(sock, msg, { depurar = false } = {}) {
  const candidatos = [
    msg.key.remoteJid,
    msg.key.remoteJidAlt,
    msg.key.participant,
    msg.key.participantAlt,
  ].filter(Boolean);

  // Los newsletters no son contactos personales.
  if (
    candidatos.some((jid) =>
      String(jid).endsWith('@newsletter')
    )
  ) {
    return null;
  }

  // 1. Comprobar números telefónicos explícitos.
  for (const jid of candidatos) {
    const id = String(jid);

    if (!id.endsWith('@s.whatsapp.net')) continue;

    const numero = soloNumero(id);

    if (numeroValido(numero)) {
      return numero;
    }
  }

  // 2. Resolver identificadores LID cuando sea posible.
  const mapping = sock.signalRepository?.lidMapping;

  if (typeof mapping?.getPNForLID !== 'function') {
    if (depurar) {
      console.log(
        '[debug] Baileys no expone getPNForLID en esta sesión.'
      );
    }

    return null;
  }

  for (const jid of candidatos) {
    const id = String(jid);

    if (!id.endsWith('@lid')) continue;

    // Algunas versiones pueden esperar el identificador
    // completo y otras el identificador sin el sufijo.
    const posiblesLid = [id, soloNumero(id)];

    for (const lid of posiblesLid) {
      try {
        const pn = await mapping.getPNForLID(lid);

        if (!pn) continue;

        const numero = soloNumero(pn);

        if (numeroValido(numero)) {
          if (depurar) console.log('[debug] Identidad resuelta mediante LID.');

          return numero;
        }
      } catch (error) {
        if (depurar) {
          console.warn('No se pudo resolver una identidad LID autorizada.');
        }
      }
    }
  }

  return null;
}

