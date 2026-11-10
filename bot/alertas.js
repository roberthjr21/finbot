import * as db from './db.js';
import * as finanzas from './finanzas.js';
import * as metas from './metas.js';
import * as recordatorios from './recordatorios.js';
import { fechaBogota, pesos, rangoMes, sumarDias } from './fechas.js';

// Alertas inteligentes. Todo se calcula con código (nunca con IA) y cada alerta tiene una
// clave estable: una clave ya enviada no se repite, ni siquiera después de reiniciar el bot.

export const TIPOS = ['presupuestos', 'picos', 'pagos', 'deudas', 'metas', 'cierre'];
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

const DEFECTOS = { presupuestos: 1, picos: 1, pagos: 1, deudas: 1, metas: 1, cierre: 1, silencio_desde: '22:00', silencio_hasta: '07:00', max_diarias: 5 };

export function configuracion(usuario) {
  const f = db.base().prepare('SELECT * FROM alertas_config WHERE usuario = ?').get(usuario) ?? {};
  const c = { ...DEFECTOS, ...f };
  return { ...c, ...Object.fromEntries(TIPOS.map((t) => [t, Boolean(c[t])])) };
}

export function configurar(usuario, cambios) {
  const v = {};
  for (const t of TIPOS) if (cambios[t] !== undefined) v[t] = cambios[t] ? 1 : 0;
  for (const k of ['silencio_desde', 'silencio_hasta']) {
    if (cambios[k] !== undefined) {
      if (!HORA.test(cambios[k])) return { ok: false, error: 'La hora debe ser HH:MM (24 h).' };
      v[k] = cambios[k];
    }
  }
  if (cambios.max_diarias !== undefined) {
    if (!Number.isInteger(cambios.max_diarias) || cambios.max_diarias < 1 || cambios.max_diarias > 20) return { ok: false, error: 'El máximo diario debe estar entre 1 y 20.' };
    v.max_diarias = cambios.max_diarias;
  }
  if (Object.keys(v).length === 0) return { ok: false, error: 'No hay nada que cambiar.' };
  const c = { ...DEFECTOS, ...(db.base().prepare('SELECT * FROM alertas_config WHERE usuario = ?').get(usuario) ?? {}), ...v };
  db.base()
    .prepare(`INSERT INTO alertas_config (usuario, presupuestos, picos, pagos, deudas, metas, cierre, silencio_desde, silencio_hasta, max_diarias)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT (usuario) DO UPDATE SET presupuestos = excluded.presupuestos, picos = excluded.picos, pagos = excluded.pagos,
                deudas = excluded.deudas, metas = excluded.metas, cierre = excluded.cierre, silencio_desde = excluded.silencio_desde,
                silencio_hasta = excluded.silencio_hasta, max_diarias = excluded.max_diarias`)
    .run(usuario, c.presupuestos, c.picos, c.pagos, c.deudas, c.metas, c.cierre, c.silencio_desde, c.silencio_hasta, c.max_diarias);
  return { ok: true };
}

// ¿La hora (HH:MM) cae en el horario de silencio? Admite rangos que cruzan la medianoche (22:00–07:00).
export function enSilencio(cfg, hora) {
  const { silencio_desde: d, silencio_hasta: h } = cfg;
  if (d === h) return false;
  return d < h ? hora >= d && hora < h : hora >= d || hora < h;
}

// ---- Cálculo de cada familia de alertas ----
function presupuestos(usuario, hoy) {
  const mes = hoy.slice(0, 7);
  const { desde, hasta } = rangoMes(mes);
  const salida = [];
  for (const p of db.presupuestos(usuario)) {
    const gastado = db.gastoEnCategoria(usuario, p.categoria, desde, hasta);
    const pct = finanzas.porcentajePresupuesto(gastado, p.limite);
    const umbral = [100, 90, 80].find((u) => pct >= u);
    if (!umbral) continue;
    const texto = umbral === 100
      ? `🚨 Pasaste el presupuesto de ${p.categoria}: ${pesos(gastado)} de ${pesos(p.limite)}.`
      : `⚠️ Llevas el ${pct}% del presupuesto de ${p.categoria} (${pesos(gastado)} de ${pesos(p.limite)}).`;
    salida.push({ clave: `pres:${p.categoria}:${mes}:${umbral}`, tipo: 'presupuestos', texto });
  }
  return salida;
}

function picos(usuario, hoy) {
  const salida = [];
  const previos = finanzas.operativo(usuario, sumarDias(hoy, -30), sumarDias(hoy, -1));
  const promedio = previos.gastos / 30;
  const hoyOp = finanzas.operativo(usuario, hoy, hoy);
  if (promedio > 0 && hoyOp.gastos >= 50_000 && hoyOp.gastos >= promedio * 3) {
    salida.push({ clave: `pico:${hoy}`, tipo: 'picos', texto: `📈 Hoy llevas ${pesos(hoyOp.gastos)} en gastos, más del triple de tu promedio diario (${pesos(Math.round(promedio))}).` });
  }
  // Gasto individual muy por encima de lo habitual en su categoría (mínimo 5 gastos previos para comparar)
  const grandes = db.base().prepare(
    `SELECT m.id, m.monto, m.categoria FROM movimientos m
      WHERE m.usuario = ? AND m.tipo = 'gasto' AND m.fecha = ? AND m.categoria NOT IN ('Préstamos', 'Deudas')`,
  ).all(usuario, hoy);
  for (const g of grandes) {
    const h = db.base().prepare(
      `SELECT COUNT(*) AS n, AVG(monto) AS prom FROM movimientos
        WHERE usuario = ? AND tipo = 'gasto' AND categoria = ? AND fecha >= ? AND fecha < ?`,
    ).get(usuario, g.categoria, sumarDias(hoy, -90), hoy);
    if (h.n >= 5 && g.monto >= 20_000 && g.monto >= h.prom * 4) {
      salida.push({ clave: `inusual:${g.id}`, tipo: 'picos', texto: `🔎 Gasto inusual en ${g.categoria}: ${pesos(g.monto)} (lo normal ronda ${pesos(Math.round(h.prom))}). Si no fuiste tú, revísalo con /ultimos.` });
    }
  }
  return salida;
}

function pagos(usuario, hoy) {
  return recordatorios.proximos(usuario, hoy, 2)
    .filter((r) => r.vence > hoy) // lo de hoy ya lo avisa el propio recordatorio
    .map((r) => ({ clave: `pago:${r.id}:${r.vence}`, tipo: 'pagos', texto: `📅 Se acerca (${r.vence}): ${r.texto}${r.monto ? ` · ${pesos(r.monto)}` : ''}` }));
}

function deudas(usuario, hoy) {
  const mes = hoy.slice(0, 7);
  const limite = sumarDias(hoy, -30);
  const salida = [];
  const antiguas = (tabla, tipoInicial) => db.base().prepare(
    `SELECT clave, MIN(fecha) AS desde FROM ${tabla} WHERE usuario = ? AND tipo = ? GROUP BY clave`,
  ).all(usuario, tipoInicial);
  const debo = finanzas.deudas(usuario).personas;
  for (const a of antiguas('deudas', 'debo')) {
    const p = debo.find((x) => x.clave === a.clave);
    if (p && a.desde <= limite) salida.push({ clave: `deuda:${a.clave}:${mes}`, tipo: 'deudas', texto: `💳 Sigues debiendo ${pesos(p.saldo)} a ${p.persona} desde hace más de 30 días.` });
  }
  const medeben = finanzas.prestamos(usuario).personas;
  for (const a of antiguas('prestamos', 'presto')) {
    const p = medeben.find((x) => x.clave === a.clave);
    if (p && a.desde <= limite) salida.push({ clave: `prestamo:${a.clave}:${mes}`, tipo: 'deudas', texto: `🤝 ${p.persona} te debe ${pesos(p.saldo)} desde hace más de 30 días. Puedes recordárselo.` });
  }
  return salida;
}

function metasAlertas(usuario, hoy) {
  const mes = hoy.slice(0, 7);
  const salida = [];
  for (const m of metas.listar(usuario)) {
    const hito = [100, 75, 50, 25].find((h) => m.porcentaje >= h);
    if (hito) {
      salida.push({ clave: `meta:${m.id}:${hito}`, tipo: 'metas', texto: hito === 100 ? `🎉 ¡Meta cumplida! ${m.nombre}: ${pesos(m.ahorrado)}.` : `🎯 Tu meta ${m.nombre} va en ${m.porcentaje}% (${pesos(m.ahorrado)} de ${pesos(m.objetivo)}).` });
    }
    if (m.estado === 'activa' && m.fechaLimite) {
      const inicio = m.creado.slice(0, 10);
      const total = (Date.parse(m.fechaLimite) - Date.parse(inicio)) / 86_400_000;
      const pasado = (Date.parse(hoy) - Date.parse(inicio)) / 86_400_000;
      if (total > 0 && pasado > 0 && pasado < total) {
        const esperado = Math.floor((pasado / total) * 100);
        if (m.porcentaje + 15 <= esperado) {
          salida.push({ clave: `metaatraso:${m.id}:${mes}`, tipo: 'metas', texto: `⏳ Tu meta ${m.nombre} va atrasada: ${m.porcentaje}% y ya pasó el ${esperado}% del tiempo (faltan ${pesos(m.faltante)}).` });
        }
      }
    }
  }
  return salida;
}

function cierre(usuario, hoy) {
  const { hasta, desde } = rangoMes(hoy.slice(0, 7));
  if (hoy < sumarDias(hasta, -1)) return [];
  const r = finanzas.operativo(usuario, desde, hoy);
  if (r.ingresos === 0 && r.gastos === 0) return [];
  const top = r.porCategoria[0];
  return [{
    clave: `cierre:${hoy.slice(0, 7)}`, tipo: 'cierre',
    texto: `🗓️ Cierre de mes: ingresos ${pesos(r.ingresos)}, gastos ${pesos(r.gastos)}, balance ${pesos(r.balance)}${top ? `. Lo que más pesó: ${top.categoria} (${pesos(top.total)})` : ''}.`,
  }];
}

const CALCULOS = { presupuestos, picos, pagos, deudas, metas: metasAlertas, cierre };

// Todas las alertas aplicables hoy, según lo que la persona tenga activado
export function calcular(usuario, hoy = fechaBogota()) {
  const cfg = configuracion(usuario);
  return TIPOS.filter((t) => cfg[t]).flatMap((t) => CALCULOS[t](usuario, hoy));
}

const yaEnviada = (usuario, clave) => Boolean(db.base().prepare('SELECT 1 FROM alertas_enviadas WHERE usuario = ? AND clave = ?').get(usuario, clave));

// Lo que toca enviar ahora: sin repetidas, fuera del horario de silencio, respetando el máximo diario
// y agrupado en UN solo mensaje. Devuelve {texto, claves} o null.
export function pendientes(usuario, ahora = new Date()) {
  const hoy = fechaBogota(ahora);
  const hora = recordatorios.horaBogota(ahora);
  const cfg = configuracion(usuario);
  if (enSilencio(cfg, hora)) return null;
  const enviadasHoy = db.base().prepare('SELECT COUNT(*) AS n FROM alertas_enviadas WHERE usuario = ? AND dia = ?').get(usuario, hoy).n;
  const cupo = cfg.max_diarias - enviadasHoy;
  if (cupo <= 0) return null;
  const nuevas = calcular(usuario, hoy).filter((a) => !yaEnviada(usuario, a.clave)).slice(0, cupo);
  if (nuevas.length === 0) return null;
  return {
    texto: nuevas.length === 1 ? nuevas[0].texto : `🔔 Tienes ${nuevas.length} avisos:\n${nuevas.map((a) => `• ${a.texto}`).join('\n')}`,
    claves: nuevas.map((a) => a.clave),
  };
}

export function registrarEnviadas(usuario, claves, hoy = fechaBogota()) {
  const ins = db.base().prepare('INSERT OR IGNORE INTO alertas_enviadas (usuario, clave, dia) VALUES (?, ?, ?)');
  for (const c of claves) ins.run(usuario, c, hoy);
}

// Texto de /alertas
export function textoConfiguracion(usuario) {
  const c = configuracion(usuario);
  const est = (v) => (v ? '✅' : '🔕');
  return [
    '🔔 *Tus alertas*',
    `${est(c.presupuestos)} presupuestos (80%, 90%, 100%)`,
    `${est(c.picos)} picos de gasto y gastos inusuales`,
    `${est(c.pagos)} pagos próximos`,
    `${est(c.deudas)} deudas y préstamos atrasados`,
    `${est(c.metas)} metas de ahorro`,
    `${est(c.cierre)} cierre de mes`,
    `🌙 Silencio: ${c.silencio_desde}–${c.silencio_hasta} · máximo ${c.max_diarias} al día`,
    '',
    'Cambiar: /alertas presupuestos no · /alertas silencio 23:00 06:00 · /alertas maximo 3',
  ].join('\n');
}
