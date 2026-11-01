import * as db from './db.js';
import { CATEGORIAS } from './categorias.js';
import { pesos, rangoMes, rangoPeriodo, valida } from './fechas.js';
import { montoValido } from './montos.js';
import { TEMAS_GUIA, configurarConsejos, consejoProactivo, guiaFinanciera } from './consejos.js';

const confirmacionesBorrado = new Map();
const CONFIRMACION_MS = 2 * 60 * 1000;
// Borrados masivos pendientes de confirmar (uno por persona). Solo se confirman con el comando /borrar confirmar.
const borradosPendientes = new Map();

const NOMBRE_ALCANCE = {
  todo: 'TODOS tus datos (movimientos, deudas y presupuestos)',
  movimientos: 'todos tus movimientos (ingresos y gastos)',
  ingresos: 'todos tus ingresos',
  gastos: 'todos tus gastos',
  deudas: 'toda tu libreta de deudas',
  presupuestos: 'todos tus presupuestos',
};

function resumenBorrado(c) {
  const partes = [];
  if (c.movimientos) partes.push(`${c.movimientos} movimiento${c.movimientos === 1 ? '' : 's'}`);
  if (c.deudas) partes.push(`${c.deudas} registro${c.deudas === 1 ? '' : 's'} de deudas`);
  if (c.presupuestos) partes.push(`${c.presupuestos} presupuesto${c.presupuestos === 1 ? '' : 's'}`);
  return partes.join(', ');
}

// Aviso cuando un gasto se acerca o pasa el presupuesto mensual de su categoría
function alertaPresupuesto(usuario, categoria, fecha) {
  const limite = db.presupuestoDe(usuario, categoria);
  if (!limite) return '';
  const { desde, hasta } = rangoMes(fecha.slice(0, 7));
  const gastado = db.gastoEnCategoria(usuario, categoria, desde, hasta);
  const porcentaje = Math.round((gastado / limite) * 100);
  if (gastado > limite) {
    return `\n🚨 Te pasaste del presupuesto de ${categoria}: ${pesos(gastado)} de ${pesos(limite)}.`;
  }
  if (porcentaje >= 80) {
    return `\n⚠️ Llevas el ${porcentaje}% del presupuesto de ${categoria} (${pesos(gastado)} de ${pesos(limite)}).`;
  }
  return '';
}

function linea(m) {
  const signo = m.tipo === 'gasto' ? '💸' : '💰';
  const desc = m.descripcion ? ` · ${m.descripcion}` : '';
  return `${signo} ${m.fecha} · ${pesos(m.monto)} · ${m.categoria}${desc}`;
}

const nombrePersona = (valor) => (typeof valor === 'string' ? valor.trim().replace(/\s+/g, ' ').slice(0, 60) : '');

// Encuentra a quién se refiere el usuario entre las personas con deudas.
// "juan" encuentra "Juan Pérez"; si dos personas encajan, pide precisar.
function buscarPersona(usuario, texto) {
  const clave = db.clavePersona(texto);
  const todas = db.resumenDeudas(usuario);
  const exacta = todas.find((p) => p.clave === clave);
  if (exacta) return { persona: exacta };
  const palabras = clave.split(' ').filter(Boolean);
  const parecidas = todas.filter((p) => {
    const suyas = p.clave.split(' ');
    return palabras.every((w) => suyas.includes(w)) || suyas.every((w) => palabras.includes(w));
  });
  if (parecidas.length === 1) return { persona: parecidas[0] };
  if (parecidas.length > 1) return { ambigua: parecidas.map((p) => p.persona) };
  return {};
}

// Texto de cómo va la deuda con una persona
function estadoDeuda(p) {
  return p.saldo > 0 ? `Sigues debiéndole ${pesos(p.saldo)} a ${p.persona}.` : `✅ Ya pagaste toda la deuda con ${p.persona}.`;
}

function lineaDeuda(d) {
  return d.tipo === 'debo'
    ? `📝 ${d.fecha} · debías +${pesos(d.monto)}${d.descripcion ? ` (${d.descripcion})` : ''}`
    : `💸 ${d.fecha} · abonaste −${pesos(d.monto)}`;
}

// Ejecuta una acción y devuelve el texto a responder (o null si no hay nada que decir)
export function ejecutar(accion, { usuario, hoy, mensajeId, indice, efectos }) {
  const datos = accion.datos ?? {};
  const diferir = (efecto) => efectos ? efectos.push(efecto) : efecto();

  switch (accion.nombre) {
    case 'registrar_movimiento': {
      const monto = datos.monto;
      if (!['gasto', 'ingreso'].includes(datos.tipo) || !montoValido(monto) || !CATEGORIAS.includes(datos.categoria) || (datos.descripcion !== undefined && typeof datos.descripcion !== 'string')) {
        return '⚠️ No entendí bien ese movimiento. Dime el monto y de qué fue.';
      }
      const categoria = datos.categoria;
      const descripcion = String(datos.descripcion ?? '').slice(0, 120);
      // Sin fecha, o con una fecha futura o inválida: se usa la del mensaje
      const fecha = valida(datos.fecha) && datos.fecha <= hoy ? datos.fecha : hoy;

      const id = db.agregarMovimiento({
        usuario,
        tipo: datos.tipo,
        monto,
        categoria,
        descripcion,
        fecha,
        mensajeId: `${mensajeId}:${indice}`,
      });
      if (id === null) return null; // ya estaba registrado

      const etiqueta = datos.tipo === 'gasto' ? '💸 Gasto' : '💰 Ingreso';
      let texto = `${etiqueta} registrado: ${pesos(monto)} en ${categoria}`;
      if (descripcion) texto += ` (${descripcion})`;
      if (fecha !== hoy) texto += ` · ${fecha}`;
      if (datos.tipo === 'gasto') texto += alertaPresupuesto(usuario, categoria, fecha);
      if (datos.tipo === 'ingreso') texto += consejoProactivo(usuario, hoy, { tipo: 'ingreso', monto });
      return texto;
    }

    case 'consultar_resumen': {
      const rango = rangoPeriodo(datos.periodo ?? 'mes', hoy);
      const categoria = CATEGORIAS.includes(datos.categoria) ? datos.categoria : null;
      const r = db.resumen(usuario, rango.desde, rango.hasta, categoria);
      if (r.ingresos === 0 && r.gastos === 0) {
        return `📊 No tienes movimientos ${rango.titulo === 'hoy' ? 'hoy' : `en ${rango.titulo}`}${categoria ? ` en ${categoria}` : ''}.`;
      }
      const lineas = [
        `📊 Resumen de ${rango.titulo}${categoria ? ` · ${categoria}` : ''}`,
        `💰 Ingresos: ${pesos(r.ingresos)}`,
        `💸 Gastos: ${pesos(r.gastos)}`,
        `🧮 Balance: ${pesos(r.balance)}`,
      ];
      if (r.porCategoria.length > 0 && !categoria) {
        lineas.push('', 'En qué se fue la plata:');
        for (const c of r.porCategoria.slice(0, 5)) lineas.push(`• ${c.categoria}: ${pesos(c.total)}`);
      }
      return lineas.join('\n');
    }

    case 'ultimos_movimientos': {
      const cantidad = Math.min(Math.max(Number(datos.cantidad) || 5, 1), 20);
      const filas = db.listarMovimientos({ usuario, limite: cantidad });
      if (filas.length === 0) return 'Todavía no tienes movimientos registrados.';
      return ['🧾 Tus últimos movimientos:', ...filas.map(linea)].join('\n');
    }

    case 'deshacer_ultimo': {
      const mov = db.ultimoMovimientoBorrable(usuario);
      const deuda = db.ultimaDeudaBorrable(usuario);
      if (!mov && !deuda) return 'No hay movimientos recientes para deshacer.';
      // La deuda es más reciente si se anotó cuando ese movimiento ya existía
      const eligeDeuda = deuda && (!mov || deuda.mov_previo >= mov.id);
      if (eligeDeuda) {
        diferir(() => confirmacionesBorrado.set(usuario, { tipo: 'deuda', id: deuda.id, vence: Date.now() + CONFIRMACION_MS }));
        return `⚠️ ¿Confirmas borrar esta deuda?\n📝 ${deuda.fecha} · debes ${pesos(deuda.monto)} a ${deuda.persona}\nResponde /deshacer confirmar. Para cancelar: /deshacer cancelar.`;
      }
      diferir(() => confirmacionesBorrado.set(usuario, { tipo: 'movimiento', id: mov.id, vence: Date.now() + CONFIRMACION_MS }));
      return `⚠️ ¿Confirmas borrar este movimiento?\n${linea(mov)}\nResponde /deshacer confirmar. Para cancelar: /deshacer cancelar.`;
    }

    case 'confirmar_deshacer': {
      const pendiente = confirmacionesBorrado.get(usuario);
      diferir(() => confirmacionesBorrado.delete(usuario));
      if (!pendiente || pendiente.vence < Date.now()) return 'No hay un borrado pendiente. Escribe /deshacer para iniciar uno.';
      if (pendiente.tipo === 'deuda') {
        const fila = db.borrarDeuda(usuario, pendiente.id);
        if (fila?.bloqueada) return 'Esa deuda ya tiene abonos, así que no la borré. Si te equivocaste en un abono, usa /deshacer para borrar el abono primero.';
        return fila ? `↩️ Borré la deuda confirmada:\n📝 ${fila.fecha} · ${pesos(fila.monto)} a ${fila.persona}` : 'La deuda cambió o ya no está disponible; no borré nada.';
      }
      const fila = db.borrarMovimiento(usuario, pendiente.id);
      return fila ? `↩️ Borré el movimiento confirmado:\n${linea(fila)}` : 'El movimiento cambió o ya no está disponible; no borré nada.';
    }

    case 'cancelar_deshacer': {
      const existia = confirmacionesBorrado.has(usuario);
      diferir(() => confirmacionesBorrado.delete(usuario));
      return existia ? 'Listo, cancelé el borrado.' : 'No hay un borrado pendiente.';
    }

    case 'fijar_presupuesto': {
      const limite = datos.limite_mensual;
      if (!CATEGORIAS.includes(datos.categoria) || !montoValido(limite)) {
        return '⚠️ Dime la categoría y el monto del presupuesto, por ejemplo: presupuesto de 300 mil en comida.';
      }
      db.fijarPresupuesto(usuario, datos.categoria, limite);
      return `🎯 Listo: presupuesto mensual de ${datos.categoria} en ${pesos(limite)}.`;
    }

    case 'ver_presupuestos': {
      const lista = db.presupuestos(usuario);
      if (lista.length === 0) return 'Aún no tienes presupuestos. Prueba: "presupuesto de 300 mil en comida".';
      const { desde, hasta } = rangoMes(hoy.slice(0, 7));
      const lineas = ['🎯 Presupuestos de este mes:'];
      for (const p of lista) {
        const gastado = db.gastoEnCategoria(usuario, p.categoria, desde, hasta);
        lineas.push(`• ${p.categoria}: ${pesos(gastado)} de ${pesos(p.limite)} (${Math.round((gastado / p.limite) * 100)}%)`);
      }
      return lineas.join('\n');
    }

    // Guías de ahorro, inversión y deudas (información general) y el interruptor de consejos
    case 'mostrar_guia_financiera': {
      if (!TEMAS_GUIA.includes(datos.tema)) return guiaFinanciera(usuario, hoy, null);
      return guiaFinanciera(usuario, hoy, datos.tema);
    }

    case 'configurar_consejos':
      return configurarConsejos(usuario, typeof datos.activo === 'boolean' ? datos.activo : undefined);

    // "/borrar todos mis ingresos": primero pide confirmación; no borra nada todavía.
    case 'borrar_datos': {
      const alcance = datos.alcance;
      if (!db.ALCANCES_BORRADO.includes(alcance)) {
        return '⚠️ Dime qué borrar: /borrar ingresos, /borrar gastos, /borrar deudas, /borrar presupuestos o /borrar todo.';
      }
      const cantidades = db.contarBorrado(usuario, alcance);
      if (!resumenBorrado(cantidades)) return `No tienes nada que borrar en ${NOMBRE_ALCANCE[alcance]}.`;
      diferir(() => borradosPendientes.set(usuario, { alcance, vence: Date.now() + CONFIRMACION_MS }));
      return [
        `⚠️ Vas a borrar PARA SIEMPRE ${NOMBRE_ALCANCE[alcance]}:`,
        resumenBorrado(cantidades),
        '',
        'Esto no se puede deshacer. Para confirmar escribe /borrar confirmar (tienes 2 minutos). Para cancelar: /borrar cancelar.',
      ].join('\n');
    }

    case 'confirmar_borrado': {
      const pendiente = borradosPendientes.get(usuario);
      diferir(() => borradosPendientes.delete(usuario));
      if (!pendiente || pendiente.vence < Date.now()) return 'No hay un borrado pendiente. Escribe por ejemplo /borrar ingresos para iniciar uno.';
      const borrado = db.borrarDatos(usuario, pendiente.alcance);
      const total = db.resumen(usuario, '0001-01-01', hoy);
      return `🗑️ Listo, borré ${NOMBRE_ALCANCE[pendiente.alcance]} (${resumenBorrado(borrado)}).\n💼 Ahora tienes ${pesos(total.balance)}.`;
    }

    case 'cancelar_borrado': {
      const existia = borradosPendientes.has(usuario);
      diferir(() => borradosPendientes.delete(usuario));
      return existia ? 'Listo, no borré nada.' : 'No hay un borrado pendiente.';
    }

    // Saldo total: todo lo registrado desde el principio, sin límite de mes
    case 'consultar_saldo': {
      const total = db.resumen(usuario, '0001-01-01', hoy);
      const debes = db.totalDeudas(usuario);
      if (total.ingresos === 0 && total.gastos === 0 && debes === 0) return 'Todavía no tienes movimientos registrados.';
      // Respuesta corta por defecto: solo lo que la persona tiene. Las cuentas van aparte (/saldo detalle).
      if (datos.detalle !== true) {
        if (total.balance >= 0) return `💼 Tienes ${pesos(total.balance)}.${consejoProactivo(usuario, hoy, { tipo: 'saldo', balance: total.balance })}`;
        return [
          `💼 Tu saldo registrado es ${pesos(total.balance)}.`,
          'Sale negativo porque lo que anotaste como gastos supera lo que anotaste como ingresos. Si tenías plata antes de empezar, anótala como ingreso. Para ver las cuentas escribe /saldo detalle.',
        ].join('\n');
      }
      const { desde } = rangoMes(hoy.slice(0, 7));
      const mes = db.resumen(usuario, desde, hoy);
      const lineas = [
        `💼 Tu saldo: ${pesos(total.balance)}`,
        `(ingresos ${pesos(total.ingresos)} − gastos ${pesos(total.gastos)}, desde que empezaste a registrar)`,
        `📅 Este mes: ${pesos(mes.balance)}`,
      ];
      if (debes > 0) lineas.push(`📝 Debes en total: ${pesos(debes)} (no está restado del saldo)`);
      lineas.push('', 'Ojo: solo cuenta lo que has registrado. Si tenías plata antes de empezar, anótala como ingreso.');
      return lineas.join('\n');
    }

    // "Debo 11 mil a Juan": anota la deuda. No toca el saldo: la plata aún no salió.
    case 'registrar_deuda': {
      const persona = nombrePersona(datos.persona);
      const clave = db.clavePersona(persona);
      if (!clave || !montoValido(datos.monto) || (datos.descripcion !== undefined && typeof datos.descripcion !== 'string')) {
        return '⚠️ Dime a quién le debes y cuánto, por ejemplo: "le debo 50 mil a Juan".';
      }
      const descripcion = String(datos.descripcion ?? '').slice(0, 120);
      // Si ya existe alguien parecido ("juan" / "Juan Pérez"), se suma a esa persona
      const previa = buscarPersona(usuario, persona);
      if (previa.ambigua) return `⚠️ ¿A cuál te refieres: ${previa.ambigua.join(' o ')}? Dime el nombre completo.`;
      const nombre = previa.persona?.persona ?? persona;
      const id = db.agregarDeuda({
        usuario, persona: nombre, tipo: 'debo', monto: datos.monto, descripcion, fecha: hoy,
        mensajeId: `${mensajeId}:${indice}:d`,
      });
      if (id === null) return null; // ya estaba registrado
      const estado = db.resumenDeudas(usuario).find((p) => p.clave === db.clavePersona(nombre));
      return `📝 Anotado: le debes ${pesos(datos.monto)} a ${nombre}${descripcion ? ` (${descripcion})` : ''}.\nEn total le debes ${pesos(estado.saldo)} a ${nombre}.`;
    }

    // "Voy a abonar 5 mil a Juan": resta de la deuda y registra el pago como gasto en Deudas
    case 'abonar_deuda': {
      const persona = nombrePersona(datos.persona);
      if (!db.clavePersona(persona)) return '⚠️ Dime a quién le abonas y cuánto, por ejemplo: "abono 20 mil a Juan".';
      const encontrada = buscarPersona(usuario, persona);
      if (encontrada.ambigua) return `⚠️ ¿A cuál te refieres: ${encontrada.ambigua.join(' o ')}? Dime el nombre completo.`;
      if (!encontrada.persona) return `No tengo ninguna deuda anotada con ${persona}. Si le debes algo, dime por ejemplo: "le debo 50 mil a ${persona}".`;
      const p = encontrada.persona;
      if (p.saldo <= 0) return estadoDeuda(p);

      // Sin monto (o "todo"), se paga lo que quede
      const monto = datos.todo === true || datos.monto === undefined ? p.saldo : datos.monto;
      if (!montoValido(monto)) return '⚠️ No entendí cuánto abonas. Dime el monto, por ejemplo: "abono 20 mil a Juan".';
      if (monto > p.saldo) return `⚠️ Solo le debes ${pesos(p.saldo)} a ${p.persona}; no puedes abonar ${pesos(monto)}. Dime un monto de hasta ${pesos(p.saldo)}.`;

      const movimientoId = db.agregarMovimiento({
        usuario, tipo: 'gasto', monto, categoria: 'Deudas', descripcion: `Abono a ${p.persona}`.slice(0, 120),
        fecha: hoy, mensajeId: `${mensajeId}:${indice}`,
      });
      if (movimientoId === null) return null; // ya estaba registrado
      db.agregarDeuda({
        usuario, persona: p.persona, tipo: 'abono', monto, descripcion: '', fecha: hoy,
        movimientoId, mensajeId: `${mensajeId}:${indice}:d`,
      });
      const quedan = p.saldo - monto;
      const encabezado = `💸 Abono registrado: ${pesos(monto)} a ${p.persona}.`;
      return `${encabezado}\n${quedan > 0 ? `Sigues debiéndole ${pesos(quedan)}.` : '✅ ¡Ya pagaste toda la deuda!'}${alertaPresupuesto(usuario, 'Deudas', hoy)}`;
    }

    case 'consultar_deudas': {
      const persona = nombrePersona(datos.persona);
      if (persona) {
        const encontrada = buscarPersona(usuario, persona);
        if (encontrada.ambigua) return `⚠️ ¿A cuál te refieres: ${encontrada.ambigua.join(' o ')}?`;
        if (!encontrada.persona) return `No tengo ninguna deuda anotada con ${persona}.`;
        const p = encontrada.persona;
        const historial = db.historialDeuda(usuario, p.clave, 5);
        return [estadoDeuda(p), '', 'Últimos movimientos de esta deuda:', ...historial.map(lineaDeuda)].join('\n');
      }
      const pendientes = db.resumenDeudas(usuario).filter((p) => p.saldo > 0);
      if (pendientes.length === 0) {
        return db.resumenDeudas(usuario).length > 0 ? '✅ No le debes nada a nadie.' : 'No tienes deudas anotadas. Prueba: "le debo 50 mil a Juan".';
      }
      const total = pendientes.reduce((suma, p) => suma + p.saldo, 0);
      return ['📝 Lo que debes:', ...pendientes.map((p) => `• ${p.persona}: ${pesos(p.saldo)}`), '', `Total: ${pesos(total)}`].join('\n');
    }

    // El análisis llama a la IA (asíncrono), así que no puede correr dentro de la
    // transacción: bot.js lo atiende justo después, con responderAnalisis().
    case 'analizar_gastos':
      return null;

    default:
      return '⚠️ No supe qué hacer con eso.';
  }
}
