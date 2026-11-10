import * as db from './db.js';
import * as recordatorios from './recordatorios.js';
import * as recurrentes from './recurrentes.js';
import * as metas from './metas.js';
import * as alertas from './alertas.js';
import * as contexto from './contexto.js';
import { editarMovimiento, obtenerMovimiento } from './db.js';
import { fechaDeTexto, pesos, valida } from './fechas.js';
import { validarMovimiento } from './movimientos.js';

// Acciones de la fase 2. Devuelve undefined si la acción no es de este módulo.
// "ejecutarBase" es la función de acciones.js (para reutilizar el registro de movimientos).
const nombreMeta = (d) => String(d.meta ?? d.nombre ?? '').slice(0, 80);
const idDe = (d) => (Number.isSafeInteger(d.id) && d.id > 0 ? d.id : null);
const aviso = (r) => `⚠️ ${r.error}`;

function resolverFecha(datos, hoy, campoISO = 'fecha', campoTexto = 'fecha_texto') {
  if (datos[campoISO] !== undefined) return valida(datos[campoISO]) ? datos[campoISO] : null;
  return datos[campoTexto] !== undefined ? fechaDeTexto(datos[campoTexto], hoy) : null;
}

function buscarMeta(usuario, datos) {
  const r = metas.buscar(usuario, nombreMeta(datos));
  if (r.ambigua) return { error: `⚠️ ¿A cuál meta te refieres: ${r.ambigua.join(' o ')}?` };
  if (!r.meta) return { error: '⚠️ No encontré esa meta. Mira tus metas con /metas.' };
  return { meta: r.meta };
}

export function ejecutarFase2(accion, ctx, ejecutarBase) {
  const { usuario, hoy, mensajeId, indice } = ctx;
  const datos = accion.datos ?? {};
  const clave = `${mensajeId}:${indice}`;

  switch (accion.nombre) {
    // ---- Recordatorios ----
    case 'crear_recordatorio': {
      const vence = resolverFecha(datos, hoy);
      if (!vence) return '⚠️ No entendí la fecha del recordatorio. Usa hoy, mañana, el día del mes (15), 15/12 o 2026-12-15.';
      const r = recordatorios.crear({ usuario, texto: datos.texto, monto: datos.monto, vence, hora: datos.hora, mensajeId: clave }, { hoy });
      if (!r.ok) return aviso(r);
      if (r.duplicado) return null;
      return `⏰ Listo, te lo recuerdo el ${vence} a las ${datos.hora ?? '09:00'}: ${String(datos.texto).trim()}${datos.monto ? ` (${pesos(datos.monto)})` : ''}\n(#${r.id} · /recordatorios para verlos)`;
    }
    case 'ver_recordatorios': {
      const lista = recordatorios.listar(usuario);
      return lista.length === 0
        ? 'No tienes recordatorios pendientes. Crea uno: /recordar mañana pagar arriendo 800000'
        : ['⏰ *Tus recordatorios*', ...lista.map((r) => `• ${recordatorios.textoRecordatorio(r)}${r.estado === 'enviado' ? ' (ya te avisé)' : ''}`), '', 'Marcar hecho: /listo N · Quitar: /cancelarrecordatorio N'].join('\n');
    }
    case 'completar_recordatorio': {
      const id = idDe(datos);
      return id && recordatorios.completar(usuario, id) ? `✅ Recordatorio #${id} completado.` : '⚠️ No encontré ese recordatorio pendiente. Mira /recordatorios.';
    }
    case 'cancelar_recordatorio': {
      const id = idDe(datos);
      if (!id || !recordatorios.cancelar(usuario, id)) return '⚠️ No encontré ese recordatorio pendiente. Mira /recordatorios.';
      db.registrarAuditoria({ usuario, accion: 'cancelar', entidad: 'recordatorio', entidadId: id, origen: 'bot' });
      return `🗑️ Recordatorio #${id} cancelado.`;
    }
    case 'editar_recordatorio': {
      const id = idDe(datos);
      if (!id) return '⚠️ Dime el número del recordatorio (míralo en /recordatorios).';
      const cambios = {};
      if (datos.fecha_texto !== undefined || datos.fecha !== undefined) {
        const f = resolverFecha(datos, hoy);
        if (!f) return '⚠️ No entendí la fecha.';
        cambios.vence = f;
      }
      for (const k of ['hora', 'monto', 'texto']) if (datos[k] !== undefined) cambios[k] = datos[k];
      const r = recordatorios.editar(usuario, id, cambios, { hoy });
      return r.ok ? `✏️ Recordatorio #${id} actualizado.` : aviso(r);
    }

    // ---- Recurrentes ----
    case 'crear_recurrente': {
      const inicio = datos.inicio_texto !== undefined || datos.inicio !== undefined ? resolverFecha(datos, hoy, 'inicio', 'inicio_texto') : hoy;
      if (!inicio) return '⚠️ No entendí la fecha de inicio.';
      const r = recurrentes.crear({ usuario, tipo: datos.tipo, monto: datos.monto, categoria: datos.categoria, descripcion: datos.descripcion, frecuencia: datos.frecuencia, inicio, mensajeId: clave }, { hoy });
      if (!r.ok) return aviso(r);
      if (r.duplicado) return null;
      const rec = recurrentes.obtener(usuario, r.id);
      return `🔁 Programado: ${recurrentes.textoRecurrente(rec)}\nSe registra solo en cada fecha (no antes). Verlos: /recurrentes · Pausar: /pausar ${r.id}`;
    }
    case 'ver_recurrentes': {
      const lista = recurrentes.listar(usuario);
      return lista.length === 0
        ? 'No tienes movimientos recurrentes. Crea uno: /recurrente gasto 30000 servicios mensual Netflix'
        : ['🔁 *Tus movimientos recurrentes*', ...lista.map((r) => `• ${recurrentes.textoRecurrente(r)}`), '', '/pausar N · /reactivar N · /eliminarrecurrente N'].join('\n');
    }
    case 'pausar_recurrente': {
      const id = idDe(datos);
      return id && recurrentes.pausar(usuario, id) ? `⏸ Recurrente #${id} en pausa: no se registrará hasta que lo reactives.` : '⚠️ No encontré ese recurrente activo.';
    }
    case 'reactivar_recurrente': {
      const id = idDe(datos);
      if (!id || !recurrentes.reactivar(usuario, id, { hoy })) return '⚠️ No encontré ese recurrente en pausa.';
      return `▶️ Recurrente #${id} reactivado. Próxima fecha: ${recurrentes.obtener(usuario, id).proxima} (lo de la pausa no se registra).`;
    }
    case 'eliminar_recurrente': {
      const id = idDe(datos);
      if (!id || !recurrentes.eliminar(usuario, id)) return '⚠️ No encontré ese recurrente.';
      db.registrarAuditoria({ usuario, accion: 'eliminar', entidad: 'recurrente', entidadId: id, origen: 'bot' });
      return `🗑️ Recurrente #${id} eliminado. Lo que ya se registró se conserva.`;
    }
    case 'editar_recurrente': {
      const id = idDe(datos);
      if (!id) return '⚠️ Dime el número del recurrente.';
      const { id: _omitido, ...cambios } = datos;
      const r = recurrentes.editar(usuario, id, cambios, { hoy });
      return r.ok ? `✏️ Recurrente #${id} actualizado.` : aviso(r);
    }

    // ---- Metas de ahorro ----
    case 'crear_meta': {
      const limite = datos.fecha_limite !== undefined || datos.fecha_limite_texto !== undefined ? resolverFecha(datos, hoy, 'fecha_limite', 'fecha_limite_texto') : null;
      if ((datos.fecha_limite !== undefined || datos.fecha_limite_texto !== undefined) && !limite) return '⚠️ No entendí la fecha límite de la meta.';
      const r = metas.crear({ usuario, nombre: datos.nombre, objetivo: datos.objetivo, aporte: datos.aporte ?? null, frecuencia: datos.frecuencia ?? null, fechaLimite: limite }, { hoy });
      if (!r.ok) return aviso(r);
      return `🎯 Meta creada: ${metas.textoMeta(metas.obtener(usuario, r.id))}\nAporta con: /aportar ${String(datos.nombre).trim()} 50000`;
    }
    case 'ver_metas': {
      const lista = metas.listar(usuario);
      return lista.length === 0
        ? 'No tienes metas de ahorro. Crea una: /meta Viaje 3000000'
        : ['🎯 *Tus metas de ahorro*', ...lista.map((m) => `• ${metas.textoMeta(m)}`), '', 'Los aportes a metas no cambian tu saldo ni tus gastos: son un seguimiento aparte.'].join('\n');
    }
    case 'aportar_meta':
    case 'retirar_meta': {
      const b = buscarMeta(usuario, datos);
      if (b.error) return b.error;
      const mover = accion.nombre === 'aportar_meta' ? metas.aportar : metas.retirar;
      const r = mover({ usuario, id: b.meta.id, monto: datos.monto, fecha: hoy, mensajeId: clave });
      if (!r.ok) return aviso(r);
      if (r.duplicado) return null;
      const verbo = accion.nombre === 'aportar_meta' ? `➕ Aporte de ${pesos(datos.monto)}` : `➖ Retiro de ${pesos(datos.monto)}`;
      return `${verbo}\n${metas.textoMeta(r.meta)}${r.cumplida ? '\n🎉 ¡Cumpliste tu meta!' : ''}`;
    }
    case 'cancelar_meta': {
      const b = buscarMeta(usuario, datos);
      if (b.error) return b.error;
      metas.cancelar(usuario, b.meta.id);
      db.registrarAuditoria({ usuario, accion: 'cancelar', entidad: 'meta', entidadId: b.meta.id, origen: 'bot' });
      return `🗑️ Meta "${b.meta.nombre}" cancelada.`;
    }

    // ---- Alertas ----
    case 'ver_alertas':
      return alertas.textoConfiguracion(usuario);
    case 'configurar_alertas': {
      const r = alertas.configurar(usuario, datos);
      return r.ok ? `✅ Listo.\n\n${alertas.textoConfiguracion(usuario)}` : aviso(r);
    }

    // ---- Contexto: confirmaciones y correcciones ----
    case 'confirmar_pendiente': {
      const c = contexto.obtener(usuario);
      if (!c.pendiente) return 'No tengo nada pendiente de confirmar.';
      contexto.guardar(usuario, { pendiente: null });
      if (c.pendiente.hash) {
        const marca = `media:${usuario}:${c.pendiente.hash}`;
        if (db.yaProcesado(marca)) return '⚠️ Esa imagen ya la registraste antes; no la dupliqué.';
        db.marcarProcesado(marca);
      }
      const textos = (c.pendiente.items ?? []).map((item, i) => ejecutarBase({ nombre: 'registrar_movimiento', datos: item }, { ...ctx, indice: indice * 100 + i })).filter(Boolean);
      return textos.join('\n');
    }
    case 'cancelar_pendiente': {
      const c = contexto.obtener(usuario);
      if (!c.pendiente) return 'No tengo nada pendiente de confirmar.';
      contexto.guardar(usuario, { pendiente: null });
      return 'Listo, no registré nada.';
    }
    case 'corregir_ultimo': {
      const c = contexto.obtener(usuario);
      if (!c.ultimo) return '⚠️ No tengo un movimiento reciente para corregir.';
      const antes = obtenerMovimiento(usuario, c.ultimo.id);
      if (!antes) return '⚠️ Ese movimiento ya no existe.';
      if (antes.ligado) return '⚠️ Ese movimiento pertenece a una deuda o préstamo; corrígelo desde esa libreta.';
      const v = validarMovimiento(datos, { parcial: true, hoy });
      if (!v.ok) return aviso(v);
      const r = editarMovimiento(usuario, c.ultimo.id, v.valor, 'bot');
      return `✏️ Corregido: ${r.despues.tipo === 'gasto' ? '💸' : '💰'} ${pesos(r.despues.monto)} en ${r.despues.categoria}${r.despues.descripcion ? ` (${r.despues.descripcion})` : ''}.`;
    }

    default:
      return undefined;
  }
}
