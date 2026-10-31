
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  normalizeMessageContent,
} from '@whiskeysockets/baileys';

import qrcode from 'qrcode-terminal';
import pino from 'pino';

import * as db from './db.js';
import { fechaBogota } from './fechas.js';
import { hayIA, interpretar, nombreProveedor } from './ia.js';
import { interpretarComando, atajoSinIA } from './comandos.js';
import { ejecutar } from './acciones.js';
import { responderAnalisis } from './analisis.js';
import { iniciarApi } from './api.js';
import { acotarAcciones } from './politicas.js';
import { tieneDecimalConPunto } from './montos.js';
import { crearLimitador, entero } from './limites.js';
import * as acceso from './acceso.js';
import { soloNumero, numeroValido, esChatIndividual, identificarRemitente } from './identidad.js';

// ==========================================
// CONFIGURACIÓN
// ==========================================

// Números autorizados con indicativo de país.
// Ejemplo: 573001234567, sin + ni espacios.
const PERMITIDOS = (process.env.NUMEROS_PERMITIDOS ?? '')
  .split(',')
  .map((n) => n.replace(/\D/g, ''))
  .filter(Boolean);

// Registro abierto (por defecto): cualquier persona que escriba al bot desde un chat individual
// obtiene su propia cuenta. Con REGISTRO_ABIERTO=0 solo usan el bot los NUMEROS_PERMITIDOS.
const REGISTRO_ABIERTO = process.env.REGISTRO_ABIERTO !== '0';
const BLOQUEADOS = (process.env.NUMEROS_BLOQUEADOS ?? '')
  .split(',')
  .map((n) => n.replace(/\D/g, ''))
  .filter(Boolean);

// Límites contra abuso (valores por defecto razonables para uso normal)
const MAX_MENSAJES_MINUTO = entero('MAX_MENSAJES_MINUTO', 20);
const MAX_MENSAJES_DIA = entero('MAX_MENSAJES_DIA', 300);
const MAX_IA_DIA = entero('MAX_IA_DIA', 150);
const limitadorMensajes = crearLimitador({ max: MAX_MENSAJES_MINUTO, ventanaMs: 60 * 1000 });
const avisadosPorExceso = new Set();

const DEBUG = process.env.DEBUG === '1';
const AUTOCHAT = process.env.MODO_AUTOCHAT === '1';

const ESPERA_RECONEXION_MS = Number(
  process.env.ESPERA_RECONEXION_MS ?? 3000
);

const MAX_ANTIGUEDAD_S = 3 * 24 * 60 * 60;

const MARCA = '\u200B';

const TIPOS_MEDIA = new Set([
  'audioMessage',
  'imageMessage',
  'videoMessage',
  'documentMessage',
  'stickerMessage',
]);

const enviadosPorBot = new Set();
let remitentesNoAutorizados = 0;

// ==========================================
// COLA DE MENSAJES
// ==========================================

let cola = Promise.resolve();

function encolar(tarea) {
  cola = cola
    .then(tarea)
    .catch((e) => console.error('Error en la cola:', e));

  return cola;
}

// ==========================================
// UTILIDADES DE MENSAJES
// ==========================================

function contenidoDe(msg) {
  return normalizeMessageContent(msg.message);
}

function textoDe(msg) {
  const m = contenidoDe(msg);

  if (!m) return '';

  return m.conversation ?? m.extendedTextMessage?.text ?? '';
}

function tipoDe(msg) {
  const m = contenidoDe(msg);

  return m ? Object.keys(m)[0] : 'vacío';
}

function segundos(t) {
  if (typeof t === 'number') return t;
  if (t?.toNumber) return t.toNumber();

  return Number(t) || 0;
}

// ==========================================
// MODO CHAT CONTIGO MISMO
// ==========================================

const numerosPropios = (sock) =>
  [sock.user?.id, sock.user?.lid]
    .filter(Boolean)
    .map(soloNumero);

const esChatPropio = (sock, jid) =>
  numerosPropios(sock).includes(soloNumero(jid));

// El número propio del bot (solo con MODO_AUTOCHAT), si es un teléfono válido
const usuarioPropio = (sock) =>
  numerosPropios(sock).find(numeroValido) ?? null;

// ¿Puede este número usar el bot? Bloqueados nunca; con registro cerrado, solo los permitidos.
const admitido = (numero) =>
  !BLOQUEADOS.includes(numero) && (REGISTRO_ABIERTO || PERMITIDOS.includes(numero));

const BIENVENIDA =
  '👋 ¡Hola! Soy FinBot, tu ayudante de finanzas personales.\n' +
  'Acabo de crear tu cuenta: empieza en $0 y solo tú ves tus datos.\n\n' +
  'Cuéntame tus gastos e ingresos como hablas, por ejemplo:\n' +
  '• "gasté 15 mil en almuerzo"\n' +
  '• "me pagaron 1,5 millones"\n' +
  '• "cuánta plata tengo"\n\n' +
  'Escribe /ayuda para ver todo lo que puedo hacer.';

// ==========================================
// CONTROL DE MENSAJES ENVIADOS
// ==========================================

function registrarEnviado(resultado) {
  const id = resultado?.key?.id;

  if (!id) return;

  enviadosPorBot.add(id);

  if (enviadosPorBot.size > 500) {
    enviadosPorBot.delete(
      enviadosPorBot.values().next().value
    );
  }
}

async function enviarTexto(sock, jid, texto, citado) {
  try {
    const resultado = await sock.sendMessage(
      jid,
      { text: MARCA + texto },
      citado ? { quoted: citado } : undefined
    );

    registrarEnviado(resultado);
  } catch (e) {
    console.error(
      'No se pudo enviar la respuesta:',
      e.message
    );
  }
}

// ==========================================
// PROCESAMIENTO FINANCIERO
// ==========================================

async function atender(sock, jid, msg, usuario, texto) {
  // La clave incluye al usuario: dos personas nunca comparten marca de "ya procesado"
  const id = `${usuario}:${msg.key.id}`;

  try {
    if (db.yaProcesadoDe(usuario, msg.key.id)) return;
  } catch (error) {
    console.error('No se pudo consultar el estado del mensaje:', error.message);
    await enviarTexto(sock, jid, '⚠️ La base de datos no está disponible. No repetí ni registré el movimiento.', msg);
    return;
  }

  // Límite diario por persona (mensajes e IA), para que nadie agote la cuota de todos
  let uso = { mensajes: 0, ia: 0 };
  try {
    uso = db.sumarUso(usuario, fechaBogota(), { mensajes: 1 });
  } catch (error) {
    console.error('No se pudo contar el uso diario:', error.message);
  }
  if (uso.mensajes > MAX_MENSAJES_DIA) {
    if (uso.mensajes === MAX_MENSAJES_DIA + 1) {
      await enviarTexto(sock, jid, '⏳ Llegaste al límite de mensajes de hoy. Mañana puedes seguir usándome.', msg);
    }
    return;
  }
  const iaAgotada = uso.ia >= MAX_IA_DIA;

  const ts = segundos(msg.messageTimestamp);

  const hoy = ts
    ? fechaBogota(new Date(ts * 1000))
    : fechaBogota();

  let acciones = [];
  let iaFallo = false;
  const respuestas = [];

  try {
    const comando = texto.startsWith('/')
      ? interpretarComando(texto)
      : null;

    if (comando?.respuesta) {
      respuestas.push(comando.respuesta);
    } else if (comando) {
      acciones = comando.acciones;
    } else if (texto.startsWith('/')) {
      respuestas.push(
        'No conozco ese comando. Escribe /ayuda para ver los disponibles.'
      );
    } else if (hayIA() && !iaAgotada) {
      db.sumarUso(usuario, fechaBogota(), { ia: 1 });
      const r = await interpretar(texto, hoy);

      acciones = r.acciones;

      if (r.texto) {
        respuestas.push(r.texto);
      }
    } else if (atajoSinIA(texto)) {
      acciones = atajoSinIA(texto).acciones;
    } else if (iaAgotada) {
      respuestas.push(
        '⏳ Llegaste al límite diario de mensajes con IA. Hoy puedes seguir con comandos, por ejemplo:\n' +
        '/gasto 20000 comida almuerzo\n\nEscribe /ayuda para ver más.'
      );
    } else {
      respuestas.push(
        'La IA no está configurada todavía. Mientras tanto usa comandos, por ejemplo:\n' +
        '/gasto 20000 comida almuerzo\n\n' +
        'Escribe /ayuda para ver más.'
      );
    }
  } catch (e) {
    console.error(
      'Error al interpretar el mensaje:',
      e.message
    );

    // Si la IA falló, las preguntas comunes se resuelven con un atajo sin IA.
    const atajo = texto.startsWith('/') ? null : atajoSinIA(texto);
    if (atajo) {
      acciones = atajo.acciones;
      iaFallo = true;
      respuestas.push('ℹ️ La IA no respondió a tiempo, pero esto lo pude resolver sin ella:');
    } else {
      respuestas.push(
        '😕 La IA no respondió ahora mismo. ' +
        'Intenta de nuevo en un momento o usa un comando, por ejemplo:\n' +
        '/gasto 20000 comida almuerzo'
      );
    }
  }

  if (
    !texto.startsWith('/') &&
    tieneDecimalConPunto(texto) &&
    Array.isArray(acciones) &&
    acciones.some((accion) => ['registrar_movimiento', 'fijar_presupuesto'].includes(accion?.nombre))
  ) {
    acciones = [];
    respuestas.push('⚠️ No pude interpretar el punto decimal con seguridad. Usa coma para decimales y punto solo para grupos de miles, por ejemplo 20.500.');
  }

  const acotadas = acotarAcciones(acciones);
  const efectos = [];
  let completado = false;
  try {
    const procesado = db.enTransaccion(() => {
      // Revisa dentro del bloqueo de escritura para cubrir dos instancias del bot.
      if (db.yaProcesadoDe(usuario, msg.key.id)) return false;
      acotadas.forEach((accion, indice) => {
        const r = ejecutar(accion, { usuario, hoy, mensajeId: id, indice, efectos });
        if (r) respuestas.push(r);
      });
      if (acotadas.length < acciones.length) {
        respuestas.push('⚠️ Procesé solo las primeras 5 acciones de este mensaje.');
      }
      db.marcarProcesado(id);
      return true;
    });
    if (!procesado) return;
    efectos.forEach((efecto) => efecto());
    completado = true;
  } catch (error) {
    console.error('No se pudo completar el mensaje de forma atómica:', error.message);
    respuestas.length = 0;
    respuestas.push('⚠️ No pude completar este mensaje; no guardé cambios parciales. Puedes volver a intentarlo.');
  }

  // El análisis de gastos solo lee datos y llama a la IA, así que va fuera de la transacción.
  if (completado && acotadas.some((accion) => accion?.nombre === 'analizar_gastos')) {
    try {
      // Si la IA acaba de fallar, el análisis se calcula directo, sin esperar otra vez a la IA.
      respuestas.push(await responderAnalisis(usuario, hoy, iaFallo ? { generar: null } : undefined));
    } catch (error) {
      console.error('No se pudo analizar los gastos:', error.message);
      respuestas.push('⚠️ No pude analizar tus gastos ahora mismo. Intenta de nuevo en un momento.');
    }
  }

  if (respuestas.length === 0) {
    respuestas.push(
      '🤔 No encontré nada para registrar. ' +
      'Cuéntame un gasto o ingreso, por ejemplo: ' +
      '"compré aceite por 20 mil".'
    );
  }

  await enviarTexto(
    sock,
    jid,
    respuestas.join('\n\n'),
    msg
  );
}

// ==========================================
// MENSAJES SIN TEXTO
// ==========================================

async function responderSinTexto(sock, jid, msg, usuario) {
  const procesado = db.enTransaccion(() => {
    if (db.yaProcesadoDe(usuario, msg.key.id)) return false;
    db.marcarProcesado(`${usuario}:${msg.key.id}`);
    return true;
  });
  if (!procesado) return;

  await enviarTexto(
    sock,
    jid,
    'Por ahora solo entiendo mensajes de texto. ' +
    'Escríbeme el gasto o ingreso, por ejemplo: ' +
    '"compré aceite por 20 mil".',
    msg
  );
}

// ==========================================
// RECONEXIÓN
// ==========================================

let reconectando = false;
let cerrando = false;
let socketActivo = null;
let autorizacionesEnCurso = 0;

function reconectar(motivo) {
  if (reconectando || cerrando) return;

  reconectando = true;

  console.log(
    `${motivo} Reintentando en ${ESPERA_RECONEXION_MS / 1000} s...`
  );

  setTimeout(() => {
    reconectando = false;

    iniciar().catch((e) =>
      console.error('Error al reconectar:', e)
    );
  }, ESPERA_RECONEXION_MS);
}

// ==========================================
// INICIAR WHATSAPP
// ==========================================

async function iniciar() {
  const { state, saveCreds } =
    await useMultiFileAuthState('auth');

  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
  });
  socketActivo = sock;

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on(
    'connection.update',
    ({ connection, lastDisconnect, qr }) => {
      if (qr) {
        console.log(
          'Escanea este QR desde WhatsApp > Dispositivos vinculados:'
        );

        qrcode.generate(qr, { small: true });
      }

      if (connection === 'open') {
        console.log('✅ Bot financiero conectado.');
      }

      if (connection === 'close') {
        const codigo =
          lastDisconnect?.error?.output?.statusCode;

        if (codigo === DisconnectReason.loggedOut) {
          console.log(
            'Sesión cerrada. Borra la carpeta "auth" y vuelve a iniciar el bot.'
          );
          void apagar('sesión cerrada').then(() => {
            process.exitCode = 2;
            process.exit(2);
          });
        } else if (
          codigo === DisconnectReason.connectionReplaced
        ) {
          console.error(
            '⚠️ Otra copia del bot está usando esta misma sesión. ' +
            'Ciérrala con ayuda de: pgrep -af bot.js'
          );

          void apagar('sesión reemplazada').then(() => {
            process.exitCode = 2;
            process.exit(2);
          });
        } else {
          reconectar(
            `Conexión perdida (código ${codigo ?? 'desconocido'}).`
          );
        }
      }
    }
  );

  // ==========================================
  // RECIBIR MENSAJES
  // ==========================================

  sock.ev.on(
    'messages.upsert',
    async ({ messages, type }) => {
      if (cerrando) return;
      if (DEBUG) {
        console.log(
          `[debug] messages.upsert tipo=${type} cantidad=${messages.length}`
        );
      }

      if (type !== 'notify' && type !== 'append') return;

      for (const msg of messages) {
        if (!msg.message) continue;

        const jid = msg.key.remoteJid;

        // Solo chats individuales: se ignoran estados, grupos, listas de difusión y newsletters.
        if (!jid || !esChatIndividual(jid)) continue;

        // Ignorar ecos de mensajes enviados por el bot.
        if (enviadosPorBot.has(msg.key.id)) continue;

        const crudo = textoDe(msg);

        if (crudo.startsWith(MARCA)) continue;

        const texto = crudo.trim();

        let usuario;

        if (msg.key.fromMe) {
          // Solo permite utilizar el chat propio si está activado.
          if (!AUTOCHAT || !esChatPropio(sock, jid)) {
            if (DEBUG) {
              console.log('[debug] Mensaje propio ignorado por configuración.');
            }

            continue;
          }

          usuario = usuarioPropio(sock);

          if (!usuario) {
            console.log('No pude obtener el número propio del bot.');

            continue;
          }
        } else {
          // Verificar autorización antes de procesar el mensaje.
          autorizacionesEnCurso++;
          try {
            usuario = await identificarRemitente(sock, msg, { depurar: DEBUG });
          } finally {
            autorizacionesEnCurso--;
          }

          // El cierre pudo empezar mientras se resolvía el identificador.
          if (cerrando) return;

        }

        // Quién puede usar el bot: bloqueados nunca; con registro cerrado, solo los permitidos.
        if (!usuario || !admitido(usuario)) {
          remitentesNoAutorizados++;
          if (remitentesNoAutorizados === 1 || remitentesNoAutorizados % 10 === 0) {
            console.warn(`Mensajes ignorados (sin teléfono válido o no admitidos): ${remitentesNoAutorizados}.`);
          }

          continue;
        }

        // Cuenta del remitente. Una cuenta nueva solo se crea por un mensaje reciente (no por
        // historial viejo) y empieza sin movimientos, es decir, con saldo $0.
        let cuenta = db.usuarioPorTelefono(usuario);
        let esNueva = false;
        if (!cuenta) {
          const tsMsg = segundos(msg.messageTimestamp);
          const reciente = !tsMsg || Date.now() / 1000 - tsMsg < 600;
          if (type !== 'notify' || !reciente) continue;
          cuenta = db.asegurarUsuario(usuario);
          esNueva = cuenta.nuevo;
        }
        if (cuenta.estado !== 'activo') continue;

        if (esNueva) {
          encolar(() => enviarTexto(sock, jid, BIENVENIDA, msg));
          // Un saludo suelto no se procesa; un mensaje con cifras o un comando, sí
          if (!/\d|^\//.test(texto)) continue;
        }

        if (DEBUG) {
          console.log(`[debug] Mensaje autorizado (tipo ${tipoDe(msg)}).`);
        }

        const ts = segundos(msg.messageTimestamp);

        if (
          type === 'append' &&
          ts &&
          Date.now() / 1000 - ts > MAX_ANTIGUEDAD_S
        ) {
          continue;
        }

        if (!texto) {
          const tipo = tipoDe(msg);

            console.log(`Mensaje sin texto (${tipo}) ignorado.`);

          if (TIPOS_MEDIA.has(tipo)) {
            encolar(() =>
              responderSinTexto(sock, jid, msg, usuario)
            );
          }

          continue;
        }

        // Límite de mensajes por minuto, con un solo aviso por ventana
        const limite = limitadorMensajes.intentar(usuario);
        if (!limite.ok) {
          if (!avisadosPorExceso.has(usuario)) {
            avisadosPorExceso.add(usuario);
            setTimeout(() => avisadosPorExceso.delete(usuario), 60 * 1000).unref();
            encolar(() => enviarTexto(sock, jid, '⏳ Vas muy rápido. Espera un minuto y vuelve a escribirme.', msg));
          }
          continue;
        }

        encolar(() =>
          atender(sock, jid, msg, usuario, texto)
        );
      }
    }
  );
}

// ==========================================
// VALIDAR CONFIGURACIÓN
// ==========================================

if (REGISTRO_ABIERTO) {
  console.log(
    'Registro abierto: quien escriba al bot desde un chat individual obtiene su propia cuenta.' +
    `${AUTOCHAT ? ' (modo chat contigo mismo activado)' : ''}`
  );
} else if (PERMITIDOS.length === 0) {
  console.warn(
    '⚠️ REGISTRO_ABIERTO=0 y NUMEROS_PERMITIDOS está vacío: nadie podrá usar el bot. ' +
    'Revisa tu archivo .env.'
  );
} else {
  console.log(`Registro cerrado: ${PERMITIDOS.length} número(s) autorizado(s).`);
}

if (PERMITIDOS.includes('573001234567')) {
  console.warn(
    '⚠️ NUMEROS_PERMITIDOS contiene el número de ejemplo ' +
    '573001234567. Cámbialo por tu número real.'
  );
}

if (hayIA()) {
  console.log(
    `IA: ${nombreProveedor()} ` +
    `(modelo: ${process.env.MODELO_GEMINI ?? process.env.MODELO_ANTHROPIC ?? process.env.MODELO_IA ?? 'por defecto'})`
  );
} else {
  console.warn(
    'ℹ️ Sin GEMINI_API_KEY ni ANTHROPIC_API_KEY: ' +
    'solo funcionarán los comandos. Escribe /ayuda.'
  );
}

// ==========================================
// INICIAR SERVICIOS
// ==========================================

// Envía un mensaje a una cuenta registrada con la MISMA sesión de WhatsApp del bot.
// Solo lo usa la API interna para los códigos de acceso a la web.
async function enviarAUsuario(telefono, texto) {
  if (!socketActivo) throw new Error('WhatsApp no está conectado');
  registrarEnviado(await socketActivo.sendMessage(`${telefono}@s.whatsapp.net`, { text: MARCA + texto }));
}

const servidorApi = iniciarApi({ enviar: enviarAUsuario });

async function apagar(signal) {
  if (cerrando) return;
  cerrando = true;
  console.log(`Cierre solicitado (${signal}); guardando y cerrando SQLite.`);
  try { socketActivo?.end(new Error('Cierre solicitado')); } catch {}
  // Eventos que ya estaban resolviendo la identidad pueden encolar trabajo
  // después de que el socket se cierre.
  while (autorizacionesEnCurso > 0) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  // Deja que termine el trabajo ya encolado antes de cerrar la conexión SQLite.
  await cola;
  if (servidorApi?.listening) {
    await new Promise((resolve) => servidorApi.close(resolve));
  }
  try { db.cerrarBase(); } catch (error) {
    console.error('No se pudo cerrar SQLite limpiamente:', error.message);
    process.exitCode = 1;
  }
}

process.once('SIGINT', () => { void apagar('SIGINT'); });
process.once('SIGTERM', () => { void apagar('SIGTERM'); });

iniciar().catch((e) => {
  console.error('No se pudo iniciar el bot:', e);
  void apagar('error al iniciar').then(() => {
    process.exitCode = 1;
    process.exit(1);
  });
});
