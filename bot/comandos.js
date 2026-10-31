import { buscarCategoria, normalizar, CATEGORIAS } from './categorias.js';
import { parseMonto } from './montos.js';

export const AYUDA = [
  '🤖 *Tu ayudante financiero*',
  '',
  'Escríbeme normal, por ejemplo:',
  '• "compré aceite por 20 mil"',
  '• "me pagaron 1,5 millones"',
  '• "cuánto gasté esta semana"',
  '• "ponme un presupuesto de 300 mil en comida"',
  '• "cómo van mis gastos" o "en qué estoy fallando"',
  '• "cuánta plata tengo" o "cuánto me queda"',
  '• "le debo 50 mil a Juan" · "voy a abonar 20 mil a Juan" · "cuánto le debo a Juan"',
  '',
  'O usa comandos (funcionan aunque la IA falle):',
  '/gasto 20000 comida almuerzo',
  '/ingreso 1500000 salario quincena',
  '/resumen [hoy|semana|mes|mes_pasado|anio]',
  '/ultimos [cantidad]',
  '/deshacer',
  '/presupuesto comida 300000',
  '/presupuestos',
  '/analisis',
  '/saldo',
  '/debo 50000 Juan   /abono 20000 Juan   /deudas [persona]',
].join('\n');

const PERIODOS = {
  hoy: 'hoy',
  semana: 'semana',
  mes: 'mes',
  mes_pasado: 'mes_pasado',
  anio: 'anio',
  ano: 'anio',
};

// Devuelve { acciones } o { respuesta } para un comando, o null si no es un comando conocido
export function interpretarComando(texto) {
  const [cabeza, ...resto] = texto.trim().split(/\s+/);
  const comando = normalizar(cabeza).replace(/^\//, '');

  switch (comando) {
    case 'ayuda':
    case 'help':
      return { respuesta: AYUDA };

    case 'gasto':
    case 'ingreso': {
      const cantidad = resto[0] && /^(mil|lucas|k|millones?|millón|millon)$/iu.test(resto[1] ?? '')
        ? `${resto[0]} ${resto[1]}`
        : resto[0];
      const desplazamiento = cantidad === `${resto[0]} ${resto[1]}` ? 2 : 1;
      const monto = parseMonto(cantidad);
      if (!monto) return { respuesta: `Usa: /${comando} 20000 comida almuerzo` };
      const categoria = buscarCategoria(resto[desplazamiento] ?? '');
      const descripcion = (categoria ? resto.slice(desplazamiento + 1) : resto.slice(desplazamiento)).join(' ');
      return {
        acciones: [
          {
            nombre: 'registrar_movimiento',
            datos: { tipo: comando, monto, categoria: categoria ?? 'Otros', descripcion },
          },
        ],
      };
    }

    case 'resumen': {
      const periodo = PERIODOS[normalizar(resto[0] ?? 'mes')];
      if (!periodo) return { respuesta: 'Usa: /resumen hoy | semana | mes | mes_pasado | anio' };
      return { acciones: [{ nombre: 'consultar_resumen', datos: { periodo } }] };
    }

    case 'ultimos':
      return { acciones: [{ nombre: 'ultimos_movimientos', datos: { cantidad: Number(resto[0]) || 5 } }] };

    case 'deshacer':
      if (normalizar(resto[0] ?? '') === 'confirmar') {
        return { acciones: [{ nombre: 'confirmar_deshacer', datos: {} }] };
      }
      if (normalizar(resto[0] ?? '') === 'cancelar') {
        return { acciones: [{ nombre: 'cancelar_deshacer', datos: {} }] };
      }
      return { acciones: [{ nombre: 'deshacer_ultimo', datos: {} }] };

    case 'presupuesto': {
      const categoria = buscarCategoria(resto[0] ?? '');
      const segundo = resto[1] && /^(mil|lucas|k|millones?|millón|millon)$/iu.test(resto[2] ?? '')
        ? `${resto[1]} ${resto[2]}`
        : resto[1];
      const limite = parseMonto(segundo);
      if (!categoria || !limite) return { respuesta: 'Usa: /presupuesto comida 300000' };
      return { acciones: [{ nombre: 'fijar_presupuesto', datos: { categoria, limite_mensual: limite } }] };
    }

    case 'presupuestos':
      return { acciones: [{ nombre: 'ver_presupuestos', datos: {} }] };

    case 'analisis':
    case 'analizar':
      return { acciones: [{ nombre: 'analizar_gastos', datos: {} }] };

    case 'saldo':
      return { acciones: [{ nombre: 'consultar_saldo', datos: {} }] };

    // /debo 50000 Juan   ·   /abono 20000 Juan   ·   /abono todo Juan
    case 'debo':
    case 'abono': {
      const todo = comando === 'abono' && normalizar(resto[0] ?? '') === 'todo';
      const conUnidad = !todo && resto[0] && /^(mil|lucas|k|millones?|millón|millon)$/iu.test(resto[1] ?? '');
      const monto = todo ? undefined : parseMonto(conUnidad ? `${resto[0]} ${resto[1]}` : resto[0]);
      const persona = resto.slice(todo ? 1 : conUnidad ? 2 : 1).join(' ');
      if ((!todo && !monto) || !persona) {
        return { respuesta: comando === 'debo' ? 'Usa: /debo 50000 Juan' : 'Usa: /abono 20000 Juan (o /abono todo Juan)' };
      }
      return comando === 'debo'
        ? { acciones: [{ nombre: 'registrar_deuda', datos: { persona, monto } }] }
        : { acciones: [{ nombre: 'abonar_deuda', datos: todo ? { persona, todo: true } : { persona, monto } }] };
    }

    // /deudas   ·   /deudas Juan
    case 'deudas':
    case 'deuda':
      return { acciones: [{ nombre: 'consultar_deudas', datos: resto.length ? { persona: resto.join(' ') } : {} }] };

    default:
      return null;
  }
}

// Atajos para las preguntas más comunes, para cuando la IA no responde o no está configurada.
// Solo reconoce frases cortas y claras; devuelve { acciones } o null si no la reconoce.
const PERIODOS_ATAJO = [
  [/\bhoy\b/, 'hoy'],
  [/\bsemana\b/, 'semana'],
  [/\bmes pasado\b/, 'mes_pasado'],
  [/\b(ano|anio)\b/, 'anio'],
];

export function atajoSinIA(texto) {
  const t = normalizar(texto).replace(/[¿?¡!.,;:]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t || t.length > 80) return null; // los mensajes largos son mejor para la IA
  const accion = (nombre, datos = {}) => ({ acciones: [{ nombre, datos }] });

  // "cuánta plata tengo", "cuánto me queda", "mi saldo"
  if (
    /^(mi )?saldo$/.test(t) ||
    /^cual es mi saldo$/.test(t) ||
    /^(cuanta plata|cuanto dinero|cuanto)( .+)? (tengo|me queda|me sobra)$/.test(t)
  ) {
    return accion('consultar_saldo');
  }

  // "cuánto gasté esta semana", "cuánto gasté en comida"
  if (/^cuanto (he |llevo )?(gaste|gastado|gasto)\b/.test(t)) {
    const datos = { periodo: PERIODOS_ATAJO.find(([re]) => re.test(t))?.[1] ?? 'mes' };
    const categoria = CATEGORIAS.find((c) => t.includes(normalizar(c)));
    if (categoria) datos.categoria = categoria;
    return accion('consultar_resumen', datos);
  }

  // "cómo van mis gastos", "en qué estoy fallando"
  if (/^(como (van|voy|andan|estan) (mis )?(gastos|finanzas)|en que (estoy fallando|me estoy pasando))( .*)?$/.test(t)) {
    return accion('analizar_gastos');
  }

  // "cuánto debo", "mis deudas", "cuánto le debo a Juan", "a quién le debo"
  if (/^(cuanto debo( en total)?|mis deudas|a quien le debo|cuanto debo a todos)$/.test(t)) return accion('consultar_deudas');
  const deudaDe = t.match(/^cuanto (?:le )?debo a ([a-z ]{1,40})$/);
  if (deudaDe) return accion('consultar_deudas', { persona: deudaDe[1].trim() });

  if (/^(mis )?(ultimos|ultimas) (movimientos|gastos)$/.test(t)) return accion('ultimos_movimientos', { cantidad: 5 });
  if (/^(mis )?presupuestos$|^como van mis presupuestos$/.test(t)) return accion('ver_presupuestos');

  return null;
}
