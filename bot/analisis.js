import * as db from './db.js';
import { pesos, rangoMes, sumarDias } from './fechas.js';
import { analizarConIA, hayIA } from './ia.js';

const dos = (n) => String(n).padStart(2, '0');

// Cambio porcentual redondeado; null si no había gasto antes con qué comparar
const variacion = (actual, anterior) =>
  anterior > 0 ? Math.round(((actual - anterior) / anterior) * 100) : null;

const conSigno = (v) => (v === null ? 'sin referencia' : `${v > 0 ? '+' : ''}${v}%`);

// Reúne los datos reales de la persona: este mes (del 1 a hoy) frente al mismo
// tramo del mes pasado, para no comparar un mes a medias con uno completo.
// Todo se calcula aquí; no incluye textos escritos por la persona.
export function datosAnalisis(usuario, hoy) {
  const mes = hoy.slice(0, 7);
  const dia = Number(hoy.slice(8, 10));
  const { desde, hasta: finDeMes } = rangoMes(mes);
  const pasado = rangoMes(sumarDias(desde, -1).slice(0, 7));
  const diaTope = Math.min(dia, Number(pasado.hasta.slice(8, 10)));
  const hastaPasado = `${pasado.desde.slice(0, 7)}-${dos(diaTope)}`;

  const actual = db.resumen(usuario, desde, hoy);
  const previo = db.resumen(usuario, pasado.desde, hastaPasado);

  const totalPrevio = new Map(previo.porCategoria.map((c) => [c.categoria, c.total]));
  const nombres = new Set([...actual.porCategoria.map((c) => c.categoria), ...totalPrevio.keys()]);
  const categorias = [...nombres]
    .map((categoria) => {
      const esteMes = actual.porCategoria.find((c) => c.categoria === categoria)?.total ?? 0;
      const mesPasado = totalPrevio.get(categoria) ?? 0;
      return {
        categoria,
        este_mes: esteMes,
        mes_pasado_mismo_tramo: mesPasado,
        variacion_pct: variacion(esteMes, mesPasado),
      };
    })
    .sort((a, b) => b.este_mes - a.este_mes);

  const presupuestos = db.presupuestos(usuario).map((p) => {
    const gastado = db.gastoEnCategoria(usuario, p.categoria, desde, hoy);
    return {
      categoria: p.categoria,
      limite: p.limite,
      gastado,
      porcentaje: Math.round((gastado / p.limite) * 100),
    };
  });

  const mayoresGastos = db
    .listarMovimientos({ usuario, desde, hasta: hoy, tipo: 'gasto', limite: 1000 })
    .sort((a, b) => b.monto - a.monto)
    .slice(0, 3)
    .map((m) => ({ monto: m.monto, categoria: m.categoria }));

  return {
    hay_datos: actual.gastos > 0 || actual.ingresos > 0 || previo.gastos > 0,
    periodo: {
      desde,
      hasta: hoy,
      dia_del_mes: dia,
      avance_del_mes_pct: Math.round((dia / Number(finDeMes.slice(8, 10))) * 100),
      mes_pasado_desde: pasado.desde,
      mes_pasado_hasta: hastaPasado,
    },
    este_mes: {
      ingresos: actual.ingresos,
      gastos: actual.gastos,
      balance: actual.balance,
      ahorro_pct: actual.ingresos > 0 ? Math.round((actual.balance / actual.ingresos) * 100) : null,
    },
    mes_pasado_mismo_tramo: { ingresos: previo.ingresos, gastos: previo.gastos },
    variacion_gastos_pct: variacion(actual.gastos, previo.gastos),
    categorias,
    presupuestos,
    mayores_gastos: mayoresGastos,
  };
}

// Análisis sin IA, para cuando la IA no responde
export function textoBasico(d) {
  const lineas = [
    `📈 Cómo van tus gastos (${d.periodo.desde} al ${d.periodo.hasta})`,
    `💸 Gastos: ${pesos(d.este_mes.gastos)} · mismo tramo del mes pasado: ${pesos(d.mes_pasado_mismo_tramo.gastos)} (${conSigno(d.variacion_gastos_pct)})`,
    `💰 Ingresos: ${pesos(d.este_mes.ingresos)}`,
  ];

  const crecen = d.categorias
    .filter((c) => c.este_mes > 0 && (c.variacion_pct === null || c.variacion_pct > 0))
    .slice(0, 3);
  if (crecen.length > 0) {
    lineas.push('', 'Lo que más pesa y creció:');
    for (const c of crecen) {
      lineas.push(`• ${c.categoria}: ${pesos(c.este_mes)} (${c.variacion_pct === null ? 'nuevo este mes' : conSigno(c.variacion_pct)})`);
    }
  }

  const alertas = d.presupuestos.filter((p) => p.porcentaje >= 80);
  if (alertas.length > 0) {
    lineas.push('', 'Presupuestos al límite:');
    for (const p of alertas) {
      lineas.push(`• ${p.categoria}: ${p.porcentaje}% (${pesos(p.gastado)} de ${pesos(p.limite)})`);
    }
  }

  if (d.mayores_gastos.length > 0) {
    lineas.push('', `Tus mayores gastos: ${d.mayores_gastos.map((m) => `${pesos(m.monto)} en ${m.categoria}`).join(', ')}`);
  }
  return lineas.join('\n');
}

// Texto a responder cuando la persona pide el análisis. `generar` se puede
// reemplazar en pruebas; por defecto usa la IA configurada, si hay una.
export async function responderAnalisis(usuario, hoy, { generar = hayIA() ? analizarConIA : null } = {}) {
  const datos = datosAnalisis(usuario, hoy);
  if (!datos.hay_datos) {
    return '📈 Todavía no tengo movimientos suficientes para analizar. Registra algunos gastos y vuelve a preguntarme.';
  }
  if (!generar) return textoBasico(datos);

  try {
    return `📈 ${await generar(datos, hoy)}`;
  } catch (e) {
    console.error('No se pudo generar el análisis con IA:', e.message);
    return `${textoBasico(datos)}\n\nℹ️ La IA no estuvo disponible; te muestro solo los números.`;
  }
}
