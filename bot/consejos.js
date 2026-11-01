import * as db from './db.js';
import { pesos, rangoMes } from './fechas.js';

// Guías educativas de finanzas personales + avisos suaves ("¿quieres ahorrar una parte?").
// Son información general: no recomiendan productos concretos ni prometen resultados.

export const TEMAS_GUIA = ['ahorro', 'inversion', 'deudas'];

const AVISO = 'ℹ️ Es información general, no asesoría financiera.';

// Desde qué ingreso se ofrece apartar una parte, y desde qué saldo se menciona invertir
const numeroEnv = (nombre, porDefecto) => {
  const valor = Number(process.env[nombre]);
  return Number.isFinite(valor) && valor > 0 ? valor : porDefecto;
};
const INGRESO_MINIMO = () => numeroEnv('CONSEJO_INGRESO_MINIMO', 50000);
const SALDO_PARA_INVERTIR = () => numeroEnv('CONSEJO_INVERSION_DESDE', 1000000);

function gastosDelMes(usuario, hoy) {
  const { desde } = rangoMes(hoy.slice(0, 7));
  return db.resumen(usuario, desde, hoy);
}

function guiaAhorro(usuario, hoy) {
  const mes = gastosDelMes(usuario, hoy);
  const lineas = [
    '💰 *Guía para ahorrar*',
    '',
    'Una regla sencilla es la 50/30/20: de lo que ganas, 50% para necesidades (arriendo, comida, transporte), 30% para gustos y 20% para ahorrar.',
  ];
  if (mes.ingresos > 0) {
    lineas.push('', `📊 Este mes has registrado ingresos por ${pesos(mes.ingresos)}. Con esa regla, apartarías unos ${pesos(Math.round(mes.ingresos * 0.2))}.`);
  }
  const mayor = mes.porCategoria.find((c) => c.categoria !== 'Ahorro' && c.categoria !== 'Deudas');
  if (mayor && mes.gastos > 0) {
    const parte = Math.round((mayor.total / mes.gastos) * 100);
    lineas.push(`Tu mayor gasto este mes es ${mayor.categoria} (${pesos(mayor.total)}, el ${parte}% de lo que has gastado). Recortar un 10% ahí liberaría ${pesos(Math.round(mayor.total * 0.1))}.`);
  }
  lineas.push(
    '',
    '1. Págate primero: aparta el ahorro apenas recibas plata, no con lo que sobre.',
    '2. Empieza pequeño: aunque sean $20.000 por semana, la constancia pesa más que el monto.',
    '3. Arma un fondo de emergencia de 3 a 6 meses de gastos antes de pensar en invertir.',
    '4. Ponle nombre a tu meta (viaje, estudio, moto) y un monto.',
    '',
    'Con el bot: anota lo que apartas, por ejemplo "aparté 50 mil para ahorro", y ponte límites con "ponme un presupuesto de 200 mil en ocio".',
    '',
    '¿Te gustaría aprender a invertir? Escribe /invertir.',
    AVISO,
  );
  return lineas.join('\n');
}

function guiaInversion(usuario, hoy) {
  const debes = db.totalDeudas(usuario);
  const mes = gastosDelMes(usuario, hoy);
  const lineas = [
    '📈 *Guía para empezar a invertir*',
    '',
    'Antes de invertir, revisa tres cosas:',
    '1. Que no tengas deudas caras (tarjeta, préstamos de pago diario o "gota a gota"): pagar una deuda con interés alto suele rendir más que casi cualquier inversión.',
    '2. Que tengas un fondo de emergencia de 3 a 6 meses de gastos.',
    '3. Que la plata que inviertas no la necesites pronto.',
  ];
  if (debes > 0) lineas.push('', `📝 Hoy tienes deudas anotadas por ${pesos(debes)}: conviene atenderlas primero (/deudas las muestra).`);
  if (mes.gastos > 0) lineas.push('', `Como referencia, con lo que gastas este mes (${pesos(mes.gastos)}), un fondo de emergencia de 3 meses serían unos ${pesos(mes.gastos * 3)}. Si llevas pocos días registrando, tus gastos reales pueden ser mayores.`);
  lineas.push(
    '',
    'Ideas para conocer (no son recomendaciones):',
    '• Cuenta de ahorros o CDT: riesgo bajo y rentabilidad conocida; en el CDT la plata queda inmovilizada hasta el vencimiento.',
    '• Fondos de inversión colectiva: te juntas con otros inversionistas y los administra una entidad vigilada.',
    '• Acciones y ETF: pueden subir o perder valor; tienen sentido a largo plazo (años).',
    '• Ahorro voluntario para pensión o AFC: pueden tener beneficios tributarios, pero el dinero queda restringido; revisa las condiciones.',
    '',
    'Principios básicos: más rentabilidad casi siempre significa más riesgo; no pongas todo en un solo lugar; invierte solo con entidades vigiladas por la Superintendencia Financiera; desconfía de "ganancias garantizadas".',
    'Empieza con montos que puedas perder sin que te afecte, y consulta con un asesor certificado antes de decidir.',
    AVISO,
  );
  return lineas.join('\n');
}

function guiaDeudas(usuario) {
  const pendientes = db.resumenDeudas(usuario).filter((p) => p.saldo > 0);
  const lineas = ['📝 *Guía para salir de deudas*', ''];
  if (pendientes.length > 0) {
    lineas.push('Hoy debes:', ...pendientes.map((p) => `• ${p.persona}: ${pesos(p.saldo)}`), `Total: ${pesos(pendientes.reduce((s, p) => s + p.saldo, 0))}`, '');
  }
  lineas.push(
    '1. Anota todas tus deudas en el bot: "le debo 50 mil a Juan".',
    '2. Ordénalas. Método avalancha: primero la de interés más alto (tarjeta, gota a gota). Método bola de nieve: primero la más pequeña, para motivarte al cerrarla rápido.',
    '3. Paga lo mínimo en todas y todo lo extra en una sola.',
    '4. Evita adquirir deudas nuevas mientras tanto.',
    '5. Abona seguido y registra cada abono: "voy a abonar 20 mil a Juan". Verás cuánto te falta con "cuánto le debo a Juan".',
    '',
    'Cuando termines, pasa a ahorrar: escribe /ahorro.',
    AVISO,
  );
  return lineas.join('\n');
}

export function guiaFinanciera(usuario, hoy, tema) {
  switch (tema) {
    case 'ahorro': return guiaAhorro(usuario, hoy);
    case 'inversion': return guiaInversion(usuario, hoy);
    case 'deudas': return guiaDeudas(usuario);
    default: return '⚠️ Puedo darte guías de ahorro (/ahorro), de inversión (/invertir) o de deudas (/guiadeudas).';
  }
}

// --- Avisos suaves ---
// Máximo uno por día y por persona, y cada quien puede apagarlos con /consejos no.
export const consejosActivos = (usuario) => db.preferencia(usuario, 'consejos') !== 'no';

export function configurarConsejos(usuario, activo) {
  if (activo === undefined) {
    return consejosActivos(usuario)
      ? '💡 Los consejos están activados: de vez en cuando te propongo ahorrar o aprender a invertir (máximo uno por día). Para apagarlos escribe /consejos no.'
      : '💡 Los consejos están apagados. Para activarlos escribe /consejos si.';
  }
  db.fijarPreferencia(usuario, 'consejos', activo ? 'si' : 'no');
  return activo
    ? '💡 Listo, activé los consejos (máximo uno por día).'
    : '💡 Listo, no te enviaré más consejos. Las guías siguen disponibles: /ahorro, /invertir.';
}

// contexto: { tipo: 'ingreso', monto } | { tipo: 'saldo', balance }
// Devuelve el texto a añadir a la respuesta, o '' si hoy no toca.
export function consejoProactivo(usuario, hoy, contexto) {
  if (!consejosActivos(usuario) || db.preferencia(usuario, 'consejo_fecha') === hoy) return '';
  let texto = '';
  if (contexto.tipo === 'ingreso' && contexto.monto >= INGRESO_MINIMO()) {
    texto = `💡 ¿Quieres ahorrar una parte? Con la regla del 20%, serían ${pesos(Math.round(contexto.monto * 0.2))}. Escribe /ahorro para una guía corta.`;
  } else if (contexto.tipo === 'saldo' && contexto.balance >= SALDO_PARA_INVERTIR() && db.totalDeudas(usuario) === 0) {
    texto = '💡 Tienes un saldo interesante y ninguna deuda anotada. ¿Te gustaría aprender cómo empezar a invertir una parte? Escribe /invertir.';
  }
  if (!texto) return '';
  db.fijarPreferencia(usuario, 'consejo_fecha', hoy);
  return `\n\n${texto}\n(Para no recibir estos avisos: /consejos no)`;
}

// "quiero ahorrar", "cómo invierto", "cómo salgo de deudas": responde sin gastar IA. Solo frases cortas.
const quitarTildes = (t) => t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
export function temaDeGuia(texto) {
  const t = quitarTildes(String(texto)).replace(/[¿?¡!.,;:]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t || t.length > 60) return null;
  const inicio = '(?:quiero |quisiera |me gustaria |como puedo |como |donde |que |dame |dime )?';
  if (new RegExp(`^${inicio}(?:empezar a |empiezo a |puedo )?(?:ahorrar|ahorro|consejos de ahorro|tips de ahorro)(?: algo| mas| plata| dinero)?$`).test(t)) return 'ahorro';
  if (new RegExp(`^${inicio}(?:empezar a |empiezo a |puedo |debo )?(?:invertir|invierto|inversion|inversiones|consejos de inversion)(?: algo| mi plata| plata| dinero)?$`).test(t)) return 'inversion';
  if (/^(?:quiero |como |como puedo )?(?:salir de deudas|salgo de deudas|pagar mis deudas|pagar deudas|consejos de deudas)$/.test(t)) return 'deudas';
  return null;
}
