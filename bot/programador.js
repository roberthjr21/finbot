import * as db from './db.js';
import * as recordatorios from './recordatorios.js';
import * as recurrentes from './recurrentes.js';
import * as alertas from './alertas.js';
import * as contexto from './contexto.js';
import { fechaBogota, pesos } from './fechas.js';
import { entero } from './limites.js';

// Programador: cada minuto (PROGRAMADOR_SEGUNDOS) revisa lo que toca hacer.
//  1) registra los movimientos recurrentes que ya vencieron (también los atrasados por un apagado);
//  2) envía los recordatorios cuya hora llegó (una sola vez cada uno);
//  3) envía alertas agrupadas, sin repetir y fuera del horario de silencio;
//  4) borra contextos de conversación vencidos.
// Todo el estado vive en SQLite, así que un reinicio retoma donde quedó. "enviar" lanza un error si
// WhatsApp no está conectado: en ese caso no se marca nada y se reintenta en el siguiente ciclo.

let corriendo = false;
let ultimaAlerta = 0;

const textoRecurrente = (h) =>
  `🔁 Registré tu ${h.tipo === 'gasto' ? 'gasto' : 'ingreso'} recurrente: ${pesos(h.monto)} en ${h.categoria}${h.descripcion ? ` (${h.descripcion})` : ''} · ${h.fecha}`;

export async function ciclo({ enviar, ahora = new Date() }) {
  if (corriendo) return { omitido: true };
  corriendo = true;
  const resultado = { recurrentes: 0, recordatorios: 0, alertas: 0 };
  try {
    // 1) Recurrentes
    try {
      const hechos = recurrentes.ejecutarPendientes({ hoy: fechaBogota(ahora) });
      resultado.recurrentes = hechos.length;
      const porUsuario = new Map();
      for (const h of hechos) porUsuario.set(h.usuario, [...(porUsuario.get(h.usuario) ?? []), textoRecurrente(h)]);
      for (const [usuario, lineas] of porUsuario) {
        try { await enviar(usuario, lineas.slice(0, 10).join('\n') + (lineas.length > 10 ? `\n… y ${lineas.length - 10} más.` : '')); } catch { /* es solo un aviso; el movimiento ya quedó registrado */ }
      }
    } catch (error) {
      console.error('Programador (recurrentes):', error.message);
    }

    // 2) Recordatorios
    try {
      for (const r of recordatorios.vencidos(ahora)) {
        try {
          await enviar(r.usuario, recordatorios.textoAviso(r));
          if (recordatorios.marcarEnviado(r.id, ahora)) resultado.recordatorios++;
        } catch (error) {
          console.warn(`Recordatorio #${r.id} pendiente de enviar (${error.message}); se reintenta.`);
          break; // sin conexión: no insistir con todos en este ciclo
        }
      }
    } catch (error) {
      console.error('Programador (recordatorios):', error.message);
    }

    // 3) Alertas (cada ALERTAS_CADA_MIN minutos como máximo)
    if (ahora.getTime() - ultimaAlerta >= entero('ALERTAS_CADA_MIN', 15) * 60_000) {
      ultimaAlerta = ahora.getTime();
      try {
        const usuarios = db.base().prepare("SELECT telefono FROM usuarios WHERE estado = 'activo'").all();
        for (const { telefono } of usuarios) {
          const p = alertas.pendientes(telefono, ahora);
          if (!p) continue;
          try {
            await enviar(telefono, p.texto);
            alertas.registrarEnviadas(telefono, p.claves, fechaBogota(ahora));
            resultado.alertas++;
          } catch (error) {
            console.warn(`Alertas de ${telefono.slice(-4)} pendientes (${error.message}); se reintenta.`);
            break;
          }
        }
      } catch (error) {
        console.error('Programador (alertas):', error.message);
      }
    }

    // 4) Privacidad: contextos vencidos
    try { contexto.purgar(ahora.getTime()); } catch (error) { console.error('Programador (contexto):', error.message); }
  } finally {
    corriendo = false;
  }
  return resultado;
}

// Arranca el ciclo periódico. Devuelve una función para detenerlo.
export function iniciarProgramador({ enviar, primeraEsperaMs = 15_000 }) {
  const cada = entero('PROGRAMADOR_SEGUNDOS', 60) * 1000;
  let intervalo;
  const inicio = setTimeout(() => {
    void ciclo({ enviar });
    intervalo = setInterval(() => void ciclo({ enviar }), cada);
    intervalo.unref?.();
  }, primeraEsperaMs);
  inicio.unref?.();
  return () => { clearTimeout(inicio); clearInterval(intervalo); };
}

// Solo para pruebas
export const _reiniciar = () => { corriendo = false; ultimaAlerta = 0; };
