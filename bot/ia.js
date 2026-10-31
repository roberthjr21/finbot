import { CATEGORIAS } from './categorias.js';
import { montoMaximo } from './montos.js';

// Proveedor de IA: Gemini si hay GEMINI_API_KEY; si no, Claude si hay ANTHROPIC_API_KEY.
// MODELO_GEMINI / MODELO_ANTHROPIC eligen cada proveedor; MODELO_IA queda como compatibilidad.
// MODELO_RESPALDO es el modelo de Gemini que se prueba si el principal falla.
function proveedor() {
  if (process.env.GEMINI_API_KEY) return 'gemini';
  if (process.env.ANTHROPIC_API_KEY) return 'claude';
  return null;
}
export const hayIA = () => proveedor() !== null;
export const nombreProveedor = () => proveedor();

const MODELO_GEMINI_POR_DEFECTO = 'gemini-3.5-flash';
const MODELO_RESPALDO_POR_DEFECTO = 'gemini-flash-lite-latest';

// Herramientas en un formato neutro; abajo se convierten al formato de cada proveedor
const HERRAMIENTAS = [
  {
    nombre: 'registrar_movimiento',
    descripcion:
      'Registra UN gasto o ingreso. Si la persona cuenta varios, llama a esta herramienta una vez por cada uno.',
    propiedades: {
      tipo: { type: 'string', enum: ['gasto', 'ingreso'] },
      monto: { type: 'integer', minimum: 1, description: 'Monto en pesos colombianos, entero.' },
      categoria: { type: 'string', enum: CATEGORIAS },
      descripcion: { type: 'string', description: 'Descripción muy corta (2 a 5 palabras).' },
      fecha: { type: 'string', description: 'AAAA-MM-DD. Solo si la persona indicó una fecha distinta de hoy.' },
    },
    requeridas: ['tipo', 'monto', 'categoria', 'descripcion'],
  },
  {
    nombre: 'consultar_resumen',
    descripcion: 'Muestra ingresos, gastos y balance de un periodo.',
    propiedades: {
      periodo: { type: 'string', enum: ['hoy', 'semana', 'mes', 'mes_pasado', 'anio'] },
      categoria: { type: 'string', enum: CATEGORIAS, description: 'Opcional: limitar a una categoría.' },
    },
    requeridas: ['periodo'],
  },
  {
    nombre: 'consultar_saldo',
    descripcion:
      'Muestra el saldo total: todo lo que la persona ha registrado desde que empezó (ingresos menos gastos), sin límite de mes. ' +
      'Úsala cuando pregunte cuánta plata tiene, cuánto le queda o cuál es su saldo.',
  },
  {
    nombre: 'ultimos_movimientos',
    descripcion: 'Lista los últimos movimientos registrados.',
    propiedades: { cantidad: { type: 'integer', description: 'Cuántos mostrar (1 a 20).' } },
  },
  {
    nombre: 'deshacer_ultimo',
    descripcion: 'Solicita confirmación para borrar el último movimiento reciente. No se borra hasta que la persona confirme con /deshacer confirmar.',
  },
  {
    nombre: 'fijar_presupuesto',
    descripcion: 'Fija un límite mensual de gasto para una categoría.',
    propiedades: {
      categoria: { type: 'string', enum: CATEGORIAS },
      limite_mensual: { type: 'integer', minimum: 1, description: 'Límite mensual entero en COP.' },
    },
    requeridas: ['categoria', 'limite_mensual'],
  },
  {
    nombre: 'ver_presupuestos',
    descripcion: 'Muestra los presupuestos mensuales y cuánto se ha gastado de cada uno.',
  },
  {
    nombre: 'analizar_gastos',
    descripcion:
      'Analiza cómo van los gastos de la persona este mes frente al mes pasado y en qué categorías se está pasando. ' +
      'Úsala cuando pregunte cómo van sus gastos en general, en qué está fallando, si gasta mucho o pida consejos sobre SUS propios gastos.',
  },
];

const esquema = (h) => ({
  type: 'object',
  properties: h.propiedades && Object.fromEntries(Object.entries(h.propiedades).map(([nombre, propiedad]) => [
    nombre,
    ['monto', 'limite_mensual'].includes(nombre)
      ? { ...propiedad, maximum: montoMaximo() }
      : propiedad,
  ])),
  ...(h.requeridas ? { required: h.requeridas } : {}),
});

// ---------------------------------------------------
// Peticiones a la IA: tiempo de espera por intento, reintentos con pausa
// y, en Gemini, un modelo de respaldo.
// ---------------------------------------------------

// Lee un número de una variable de entorno; si falta o no es válido usa el valor por defecto
function numeroEnv(nombre, porDefecto) {
  const texto = process.env[nombre];
  if (texto === undefined || texto.trim() === '') return porDefecto;
  const valor = Number(texto);
  return Number.isFinite(valor) && valor >= 0 ? valor : porDefecto;
}

const tiempoIntento = () => numeroEnv('TIEMPO_IA_MS', 15_000) || 15_000;
const pausa = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const esTemporal = (estado) => estado === 429 || estado >= 500;

// Hace la petición con hasta `intentos` intentos. Solo reintenta los errores temporales
// (429, 5xx, tiempo agotado o fallo de red), esperando un poco más cada vez.
// Devuelve la última respuesta, o lanza el último error si nunca hubo respuesta.
async function solicitarConReintento(url, opciones, { intentos = 2 } = {}) {
  for (let intento = 1; ; intento++) {
    let res;
    try {
      res = await fetch(url, { ...opciones, signal: AbortSignal.timeout(tiempoIntento()) });
    } catch (e) {
      const error = ['TimeoutError', 'AbortError'].includes(e?.name) ? new Error('La IA no respondió a tiempo') : e;
      if (intento >= intentos) throw error;
      await pausa(numeroEnv('ESPERA_REINTENTO_MS', 1500) * intento);
      continue;
    }
    if (!esTemporal(res.status) || intento >= intentos) return res;
    await res.body?.cancel().catch(() => {});
    await pausa(numeroEnv('ESPERA_REINTENTO_MS', 1500) * intento);
  }
}

async function leerError(res) {
  const detalle = await res.text().catch(() => '');
  return new Error(`API ${res.status}: ${detalle.slice(0, 200)}`);
}

// Modelos de Gemini en orden de preferencia: el principal y, después, el de respaldo.
// Si MODELO_RESPALDO está vacío, no se usa respaldo.
function modelosGemini() {
  const principal = process.env.MODELO_GEMINI ?? process.env.MODELO_IA ?? MODELO_GEMINI_POR_DEFECTO;
  const respaldo = process.env.MODELO_RESPALDO ?? MODELO_RESPALDO_POR_DEFECTO;
  return [...new Set([principal, respaldo].filter(Boolean))];
}

// Envía el cuerpo a Gemini y devuelve la respuesta ya leída (JSON).
// Prueba el modelo principal (2 intentos) y, si falla por saturación, tiempo o porque el
// modelo ya no existe, prueba el de respaldo (1 intento). Los errores de clave o de
// petición (400, 401, 403) se devuelven enseguida: otro modelo no los arregla.
async function pedirAGemini(cuerpo) {
  const fija = process.env.GEMINI_URL; // una sola dirección fija (pruebas o proxy): sin modelo de respaldo
  const modelos = fija ? [null] : modelosGemini();
  let ultimoError;

  for (const [posicion, modelo] of modelos.entries()) {
    const url = fija
      ?? `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent`;
    const siguiente = modelos[posicion + 1];
    const avisar = (motivo) => {
      if (siguiente) console.warn(`⚠️ ${modelo} falló (${String(motivo).slice(0, 120)}); pruebo ${siguiente}.`);
    };

    let res;
    try {
      res = await solicitarConReintento(
        url,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
          body: JSON.stringify(cuerpo),
        },
        { intentos: posicion === 0 ? 2 : 1 },
      );
    } catch (error) {
      ultimoError = error;
      avisar(error.message);
      continue;
    }

    if (res.ok) return res.json();

    ultimoError = await leerError(res);
    if (res.status !== 404 && !esTemporal(res.status)) throw ultimoError;
    avisar(ultimoError.message);
  }
  throw ultimoError;
}

// Formato de Claude
const herramientasClaude = () =>
  HERRAMIENTAS.map((h) => ({
    name: h.nombre,
    description: h.descripcion,
    input_schema: h.propiedades ? esquema(h) : { type: 'object', properties: {} },
  }));

// Formato de Gemini (las funciones sin parámetros no llevan "parameters")
const herramientasGemini = () => [
  {
    functionDeclarations: HERRAMIENTAS.map((h) => ({
      name: h.nombre,
      description: h.descripcion,
      ...(h.propiedades ? { parameters: esquema(h) } : {}),
    })),
  },
];

function instrucciones(hoy) {
  return `Eres un asistente de finanzas personales que habla con una sola persona por WhatsApp, en Colombia. La moneda es el peso colombiano (COP). Hoy es ${hoy}.

Reglas:
- Cuando la persona cuente un gasto o un ingreso, usa registrar_movimiento (una llamada por cada movimiento).
- Convierte siempre los montos a pesos enteros: "20 mil" = 20000, "20 lucas" = 20000, "1,5 millones" = 1500000.
- La moneda usa el formato colombiano: punto para miles y coma para decimales. No inventes ni adivines montos con separadores ambiguos.
- Si dice "ayer", "el lunes", etc., calcula la fecha a partir de hoy. Si no dice fecha, no la envíes.
- Si falta el monto o no se entiende qué pasó, NO registres nada: haz una pregunta corta.
- Deudas: si dice que DEBE algo o que tiene que pagarlo (por ejemplo "debo 50 mil de un reloj") y no dice que ya lo pagó, NO registres un gasto: pregunta en una frase si ya lo pagó. Si dice que ya lo pagó ("pagué", "ya pagué", "abono"), regístralo como gasto en la categoría Deudas.
- Si habla en futuro ("voy a gastar 3700 en pasaje"), regístralo igual como gasto de hoy y agrega una frase corta diciendo que lo anotaste como gasto de hoy y que, si todavía no lo paga, puede borrar el último con /deshacer.
- Usa la categoría Mascotas para gastos de gatos, perros u otras mascotas (comida, veterinario). Usa Otros solo si ninguna categoría encaja.
- Para saber cuánto gastó o ganó en un periodo usa consultar_resumen. Para saber cuánta plata tiene, cuánto le queda o cuál es su saldo, usa consultar_saldo. Para ver lo último, ultimos_movimientos; para iniciar un borrado pide confirmación con deshacer_ultimo; para límites mensuales, fijar_presupuesto o ver_presupuestos.
- Si pregunta cómo van sus gastos, en qué está fallando, si gasta mucho o quiere consejos sobre sus propios gastos, usa analizar_gastos: no respondas con consejos genéricos sin mirar sus datos.
- Para otras preguntas de dinero (ahorro, deudas, cómo organizarse), responde en texto, breve y práctico. Das información general, no eres asesor financiero: no recomiendes inversiones concretas ni prometas resultados.
- Si la persona pregunta algo que no tiene que ver con sus finanzas personales (programación, tareas, cultura general, etc.), no lo respondas: di en una frase corta y amable que solo puedes ayudar con sus gastos, ingresos, presupuestos y finanzas, y da un ejemplo de lo que sí puedes hacer.
- Responde siempre en español, corto y amable. No inventes datos que la persona no haya dicho.`;
}

async function conGemini(texto, hoy) {
  const respuesta = await pedirAGemini({
    systemInstruction: { parts: [{ text: instrucciones(hoy) }] },
    contents: [{ role: 'user', parts: [{ text: texto }] }],
    tools: herramientasGemini(),
    toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
    generationConfig: { temperature: 0.2, maxOutputTokens: 2048 },
  });

  const partes = respuesta.candidates?.[0]?.content?.parts ?? [];
  if (partes.length === 0 && respuesta.promptFeedback?.blockReason) {
    throw new Error(`Gemini bloqueó el mensaje: ${respuesta.promptFeedback.blockReason}`);
  }
  return {
    acciones: partes
      .filter((p) => p.functionCall)
      .map((p) => ({ nombre: p.functionCall.name, datos: p.functionCall.args ?? {} })),
    texto: partes
      .filter((p) => typeof p.text === 'string' && !p.thought)
      .map((p) => p.text)
      .join('\n')
      .trim(),
  };
}

async function conClaude(texto, hoy) {
  const url = process.env.ANTHROPIC_URL ?? 'https://api.anthropic.com/v1/messages';
  const res = await solicitarConReintento(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: process.env.MODELO_ANTHROPIC ?? process.env.MODELO_IA ?? 'claude-haiku-5-5',
      max_tokens: 600,
      system: instrucciones(hoy),
      tools: herramientasClaude(),
      messages: [{ role: 'user', content: texto }],
    }),
  });
  if (!res.ok) throw await leerError(res);

  const bloques = (await res.json()).content ?? [];
  return {
    acciones: bloques
      .filter((b) => b.type === 'tool_use')
      .map((b) => ({ nombre: b.name, datos: b.input ?? {} })),
    texto: bloques
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim(),
  };
}

// Envía el mensaje a la IA y devuelve { acciones, texto }
export async function interpretar(texto, hoy) {
  switch (proveedor()) {
    case 'gemini':
      return conGemini(texto, hoy);
    case 'claude':
      return conClaude(texto, hoy);
    default:
      throw new Error('No hay ninguna clave de IA configurada (GEMINI_API_KEY o ANTHROPIC_API_KEY).');
  }
}

// ---------------------------------------------------
// Análisis de gastos
// La IA NO calcula nada: recibe cifras ya calculadas por el código
// (sin descripciones escritas por la persona) y solo las interpreta.
// ---------------------------------------------------

function instruccionesAnalisis(hoy) {
  return `Eres un asistente de finanzas personales que habla por WhatsApp con una sola persona, en Colombia. La moneda es el peso colombiano (COP). Hoy es ${hoy}.

Recibirás un JSON con los datos reales de la persona: este mes hasta hoy y el mismo tramo del mes pasado.

Reglas:
- Usa SOLO los números del JSON. No inventes cifras ni hagas otros cálculos: los porcentajes ya vienen calculados. Si variacion_pct es null, esa categoría no tuvo gasto el mes pasado en ese tramo.
- Máximo 120 palabras, en español, tono cercano y sin regaños.
- Estructura: 1) una frase sobre cómo va el mes; 2) hasta 3 puntos concretos sobre en qué se está pasando o qué subió más, con su valor, y menciona los presupuestos cerca del límite o pasados (compáralos con avance_del_mes_pct); 3) una sugerencia pequeña y práctica.
- Si algo va bien (gastos a la baja, presupuestos bajo control), dilo.
- Formato de WhatsApp: puedes usar *negritas* y viñetas con •, sin títulos largos ni tablas. Escribe los montos como $20.000.
- Das información general, no eres asesor financiero: no recomiendes inversiones concretas ni prometas resultados.
- Si hay pocos datos, dilo con honestidad en vez de sacar conclusiones fuertes.`;
}

async function analisisConGemini(datos, hoy) {
  const respuesta = await pedirAGemini({
    systemInstruction: { parts: [{ text: instruccionesAnalisis(hoy) }] },
    contents: [{ role: 'user', parts: [{ text: JSON.stringify(datos) }] }],
    generationConfig: { temperature: 0.3, maxOutputTokens: 2048 },
  });

  const partes = respuesta.candidates?.[0]?.content?.parts ?? [];
  return partes
    .filter((p) => typeof p.text === 'string' && !p.thought)
    .map((p) => p.text)
    .join('\n')
    .trim();
}

async function analisisConClaude(datos, hoy) {
  const url = process.env.ANTHROPIC_URL ?? 'https://api.anthropic.com/v1/messages';
  const res = await solicitarConReintento(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: process.env.MODELO_ANTHROPIC ?? process.env.MODELO_IA ?? 'claude-haiku-5-5',
      max_tokens: 700,
      system: instruccionesAnalisis(hoy),
      messages: [{ role: 'user', content: JSON.stringify(datos) }],
    }),
  });
  if (!res.ok) throw await leerError(res);

  return ((await res.json()).content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

// Pide a la IA que interprete los datos calculados y devuelve el texto del análisis
export async function analizarConIA(datos, hoy) {
  let texto;
  switch (proveedor()) {
    case 'gemini':
      texto = await analisisConGemini(datos, hoy);
      break;
    case 'claude':
      texto = await analisisConClaude(datos, hoy);
      break;
    default:
      throw new Error('No hay ninguna clave de IA configurada (GEMINI_API_KEY o ANTHROPIC_API_KEY).');
  }
  if (!texto) throw new Error('La IA no devolvió el análisis.');
  return texto;
}
