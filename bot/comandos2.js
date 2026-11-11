import { buscarCategoria, normalizar } from './categorias.js';
import { parseMonto } from './montos.js';

// Comandos de la fase 2: recordatorios, recurrentes, metas y alertas.
// Devuelven { acciones } o { respuesta }, igual que interpretarComando.

const UNIDAD = /^(mil|lucas|k|millones?|millón|millon)$/iu;
const FRECUENCIA = /^(diaria|diario|semanal|quincenal|mensual)$/;
const HORA = /^([01]?\d|2[0-3]):[0-5]\d$/;
const FECHA_TOKEN = /^(\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}([/-]\d{4})?|\d{1,2}|hoy|manana|mañana)$/iu;

// Toma un monto en la posición i (con su unidad si la trae). Devuelve {monto, usados} o null.
function monto(tokens, i) {
  if (tokens[i] === undefined) return null;
  const conUnidad = UNIDAD.test(tokens[i + 1] ?? '');
  const valor = parseMonto(conUnidad ? `${tokens[i]} ${tokens[i + 1]}` : tokens[i]);
  return valor ? { monto: valor, usados: conUnidad ? 2 : 1 } : null;
}

const numero = (t) => (/^#?\d{1,9}$/.test(t ?? '') ? Number(t.replace('#', '')) : null);

// Último monto del texto (para "/aportar Viaje 50000"). Devuelve {monto, nombre} o null.
function montoAlFinal(tokens) {
  for (const n of [2, 1]) {
    if (tokens.length <= n - 1) continue;
    const inicio = tokens.length - n;
    const m = monto(tokens, inicio);
    if (m && m.usados === n) return { monto: m.monto, nombre: tokens.slice(0, inicio).join(' ') };
  }
  return null;
}

export function interpretarComandoFase2(comando, resto) {
  switch (comando) {
    // /recordar mañana pagar arriendo 800000  ·  /recordar 15 09:00 pagar tarjeta
    case 'recordar':
    case 'recordatorio': {
      if (resto.length < 2) return { respuesta: 'Usa: /recordar mañana pagar arriendo 800000\n(la fecha puede ser hoy, mañana, 15, 15/12 o 2026-12-15; la hora es opcional: /recordar 15 08:00 pagar luz)' };
      const [fecha, ...demas] = resto;
      if (!FECHA_TOKEN.test(fecha)) return { respuesta: 'Empieza con la fecha: hoy, mañana, el día del mes (15), 15/12 o 2026-12-15.' };
      let hora;
      if (HORA.test(demas[0] ?? '')) hora = demas.shift().padStart(5, '0');
      const final = montoAlFinal(demas);
      const texto = (final && final.nombre ? final.nombre : demas.join(' ')).trim();
      if (!texto) return { respuesta: 'Dime qué quieres recordar, por ejemplo: /recordar mañana pagar arriendo 800000' };
      return { acciones: [{ nombre: 'crear_recordatorio', datos: { texto, fecha_texto: fecha, ...(hora ? { hora } : {}), ...(final?.nombre ? { monto: final.monto } : {}) } }] };
    }
    case 'recordatorios':
      return { acciones: [{ nombre: 'ver_recordatorios', datos: {} }] };
    case 'listo':
    case 'hecho': {
      const id = numero(resto[0]);
      return id ? { acciones: [{ nombre: 'completar_recordatorio', datos: { id } }] } : { respuesta: 'Usa: /listo 3 (el número lo ves en /recordatorios)' };
    }
    case 'cancelarrecordatorio': {
      const id = numero(resto[0]);
      return id ? { acciones: [{ nombre: 'cancelar_recordatorio', datos: { id } }] } : { respuesta: 'Usa: /cancelarrecordatorio 3' };
    }
    // /editarrecordatorio 3 mañana 08:00
    case 'editarrecordatorio': {
      const id = numero(resto[0]);
      if (!id || !resto[1] || !FECHA_TOKEN.test(resto[1])) return { respuesta: 'Usa: /editarrecordatorio 3 15/12 08:00' };
      const datos = { id, fecha_texto: resto[1] };
      if (HORA.test(resto[2] ?? '')) datos.hora = resto[2].padStart(5, '0');
      return { acciones: [{ nombre: 'editar_recordatorio', datos }] };
    }

    // /recurrente gasto 30000 servicios mensual [15] Netflix
    case 'recurrente': {
      const uso = { respuesta: 'Usa: /recurrente gasto 30000 servicios mensual Netflix\n(tipo: gasto o ingreso · frecuencia: diaria, semanal, quincenal o mensual · opcional el día de inicio, por ejemplo 15)' };
      const tipo = normalizar(resto[0] ?? '');
      if (!['gasto', 'ingreso'].includes(tipo)) return uso;
      const m = monto(resto, 1);
      if (!m) return uso;
      const categoria = buscarCategoria(resto[1 + m.usados] ?? '');
      const frecuencia = normalizar(resto[2 + m.usados] ?? '').replace('diario', 'diaria');
      if (!categoria || !FRECUENCIA.test(frecuencia)) return uso;
      const cola = resto.slice(3 + m.usados);
      const inicio = cola[0] && FECHA_TOKEN.test(cola[0]) ? cola.shift() : undefined;
      return { acciones: [{ nombre: 'crear_recurrente', datos: { tipo, monto: m.monto, categoria, frecuencia, descripcion: cola.join(' '), ...(inicio ? { inicio_texto: inicio } : {}) } }] };
    }
    case 'recurrentes':
      return { acciones: [{ nombre: 'ver_recurrentes', datos: {} }] };
    case 'pausar':
    case 'reactivar':
    case 'eliminarrecurrente': {
      const id = numero(resto[0]);
      if (!id) return { respuesta: `Usa: /${comando} 2 (el número lo ves en /recurrentes)` };
      const nombre = { pausar: 'pausar_recurrente', reactivar: 'reactivar_recurrente', eliminarrecurrente: 'eliminar_recurrente' }[comando];
      return { acciones: [{ nombre, datos: { id } }] };
    }

    // /meta Viaje 3000000  ·  /meta Viaje 3000000 200000 mensual  ·  agrega "para 2027-06-30"
    case 'meta': {
      const uso = { respuesta: 'Usa: /meta Viaje 3000000\nCon plan de aportes: /meta Viaje 3000000 200000 mensual\nCon fecha: /meta Viaje 3000000 para 2027-06-30' };
      let tokens = [...resto];
      let fecha;
      const p = tokens.findIndex((t) => normalizar(t) === 'para');
      if (p >= 0) { fecha = tokens[p + 1]; tokens = tokens.slice(0, p); }
      const i = tokens.findIndex((_, k) => monto(tokens, k));
      if (i < 1) return uso;
      const obj = monto(tokens, i);
      const datos = { nombre: tokens.slice(0, i).join(' '), objetivo: obj.monto };
      const resto2 = tokens.slice(i + obj.usados);
      if (resto2.length) {
        const ap = monto(resto2, 0);
        const fr = normalizar(resto2[ap?.usados ?? 99] ?? '');
        if (!ap || !/^(semanal|quincenal|mensual)$/.test(fr)) return uso;
        datos.aporte = ap.monto;
        datos.frecuencia = fr;
      }
      if (fecha) datos.fecha_limite_texto = fecha;
      return { acciones: [{ nombre: 'crear_meta', datos }] };
    }
    case 'metas':
      return { acciones: [{ nombre: 'ver_metas', datos: {} }] };
    case 'aportar':
    case 'retirarmeta': {
      const f = montoAlFinal(resto);
      if (!f || !f.nombre) return { respuesta: comando === 'aportar' ? 'Usa: /aportar Viaje 50000' : 'Usa: /retirarmeta Viaje 50000' };
      return { acciones: [{ nombre: comando === 'aportar' ? 'aportar_meta' : 'retirar_meta', datos: { meta: f.nombre, monto: f.monto } }] };
    }
    case 'cancelarmeta':
      return resto.length ? { acciones: [{ nombre: 'cancelar_meta', datos: { meta: resto.join(' ') } }] } : { respuesta: 'Usa: /cancelarmeta Viaje' };

    // /alertas  ·  /alertas presupuestos no  ·  /alertas silencio 23:00 06:00  ·  /alertas maximo 3
    case 'alertas': {
      if (resto.length === 0) return { acciones: [{ nombre: 'ver_alertas', datos: {} }] };
      const clave = normalizar(resto[0]);
      const tipos = { presupuestos: 'presupuestos', picos: 'picos', pagos: 'pagos', deudas: 'deudas', metas: 'metas', cierre: 'cierre' };
      if (tipos[clave]) {
        const v = normalizar(resto[1] ?? '');
        if (!['si', 'no'].includes(v)) return { respuesta: `Usa: /alertas ${clave} si  o  /alertas ${clave} no` };
        return { acciones: [{ nombre: 'configurar_alertas', datos: { [tipos[clave]]: v === 'si' } }] };
      }
      if (clave === 'silencio' && HORA.test(resto[1] ?? '') && HORA.test(resto[2] ?? '')) {
        return { acciones: [{ nombre: 'configurar_alertas', datos: { silencio_desde: resto[1].padStart(5, '0'), silencio_hasta: resto[2].padStart(5, '0') } }] };
      }
      if (['maximo', 'max'].includes(clave) && numero(resto[1])) return { acciones: [{ nombre: 'configurar_alertas', datos: { max_diarias: numero(resto[1]) } }] };
      return { respuesta: 'Usa: /alertas  ·  /alertas presupuestos no  ·  /alertas silencio 23:00 06:00  ·  /alertas maximo 3' };
    }

    case 'diagnostico':
    case 'estado':
      return { acciones: [{ nombre: 'ver_diagnostico', datos: {} }] };

    // Confirmar o cancelar lo que está pendiente (voz, foto de recibo)
    case 'si':
    case 'confirmar':
      return { acciones: [{ nombre: 'confirmar_pendiente', datos: {} }] };
    case 'no':
      return { acciones: [{ nombre: 'cancelar_pendiente', datos: {} }] };

    default:
      return null;
  }
}
