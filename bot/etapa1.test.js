// Etapa 1: confirmaciones con vencimiento, no interrumpir otras conversaciones, comprobantes y duplicados
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const temporal = fs.mkdtempSync(path.join(os.tmpdir(), 'finbot-etapa1-'));
process.env.DB_ARCHIVO = path.join(temporal, 'finanzas.db');
for (const v of ['GEMINI_API_KEY', 'ANTHROPIC_API_KEY']) delete process.env[v];

const db = await import('./db.js');
const { ejecutar } = await import('./acciones.js');
const contexto = await import('./contexto.js');
const media = await import('./media.js');

after(() => { db.cerrarBase(); fs.rmSync(temporal, { recursive: true, force: true }); });

const HOY = '2026-11-10';
const U = '573003330001';
let n = 0;
const run = (usuario, nombre, datos = {}) => ejecutar({ nombre, datos }, { usuario, hoy: HOY, mensajeId: `e1-${++n}`, indice: 0 });

test('una confirmación pendiente vence a los 10 minutos aunque el resto del contexto siga vigente', () => {
  const t0 = 2_000_000_000_000;
  contexto.guardar(U, { ultimo: { id: 3 }, pendiente: { origen: 'voz', items: [] } }, t0);
  assert.ok(contexto.obtener(U, t0 + 9 * 60_000).pendiente, 'a los 9 min sigue');
  const c = contexto.obtener(U, t0 + 11 * 60_000);
  assert.equal(c.pendiente, undefined, 'a los 11 min ya no existe');
  assert.deepEqual(c.ultimo, { id: 3 }, 'el último movimiento sí sigue (30 min)');
  contexto.guardar(U, { recarga: { monto: 5000 } }, t0 + 12 * 60_000);
  assert.equal(contexto.obtener(U, t0 + 25 * 60_000).recarga, undefined, 'la recarga también vence');
  contexto.borrar(U);
});

test('un "sí" tardío no registra nada viejo', () => {
  const t0 = Date.now() - 20 * 60_000; // hace 20 minutos
  contexto.guardar(U, { pendiente: { origen: 'voz', items: [{ tipo: 'gasto', monto: 9000, categoria: 'Comida', descripcion: 'x', fecha: HOY }] } }, t0);
  const antes = db.listarMovimientos({ usuario: U }).length;
  assert.match(run(U, 'confirmar_pendiente'), /No tengo nada pendiente/);
  assert.equal(db.listarMovimientos({ usuario: U }).length, antes);
});

test('pareceOtroTema distingue preguntas y órdenes nuevas de respuestas a lo pendiente', () => {
  for (const t of ['¿cuánto gasté hoy?', 'cuánta plata tengo', 'qué gasté en comida', 'gasté 5 mil en bus', 'compré aceite por 20 mil', 'resumen del mes', 'quién me debe', 'recuérdame pagar la luz', 'dime mi saldo']) {
    assert.equal(contexto.pareceOtroTema(t), true, t);
  }
  for (const t of ['sí', 'no', 'ayuda para la universidad', 'me enviaron dinero', 'otra cuenta mía', 'fue un regalo', 'para la matrícula']) {
    assert.equal(contexto.pareceOtroTema(t), false, t);
  }
});

const recarga = { monto: 75000, fecha: '2026-11-09', origen: 'Bancolombia', destino: 'Nequi', etapa: 'origen', huella: 'abc' };

test('recarga a medias: una pregunta o un gasto nuevo NO se interpretan como respuesta (siguen al flujo normal)', () => {
  for (const etapa of ['origen', 'concepto', 'confirmar']) {
    const p = { ...recarga, etapa, categoria: 'Estudio', descripcion: 'universidad' };
    for (const t of ['cuánta plata tengo', '¿cuánto gasté esta semana?', 'gasté 5 mil en bus', 'quién me debe', 'resumen del mes']) {
      assert.equal(media.continuarRecarga(p, t), null, `${etapa}: ${t}`);
    }
  }
});

test('recarga a medias: respuestas largas y ajenas no se interrumpen, pero las cortas sin sentido sí se re-preguntan', () => {
  const concepto = { ...recarga, etapa: 'concepto' };
  assert.equal(media.continuarRecarga(concepto, 'mañana me toca ir al médico temprano porque tengo cita desde las siete'), null);
  assert.match(media.continuarRecarga(concepto, 'hola').texto, /Para qué recibiste/);
  const confirmar = { ...recarga, etapa: 'confirmar', categoria: 'Estudio', descripcion: 'universidad' };
  assert.equal(media.continuarRecarga(confirmar, 'la verdad no sé qué hacer con esto todavía'), null);
  assert.match(media.continuarRecarga(confirmar, 'mmm').texto, /Confirmas/);
});

test('recarga: el flujo normal sigue funcionando y el cierre entrega la huella del comprobante', () => {
  const a = media.continuarRecarga(recarga, 'me enviaron dinero');
  assert.equal(a.pendiente.etapa, 'concepto');
  assert.equal(a.pendiente.monto, 75000);
  assert.equal(a.pendiente.fecha, '2026-11-09', 'recuerda la fecha');
  assert.equal(a.pendiente.origen, 'Bancolombia', 'recuerda el origen');
  const b = media.continuarRecarga(a.pendiente, 'ayuda para la universidad');
  assert.equal(b.pendiente.categoria, 'Estudio');
  const c = media.continuarRecarga(b.pendiente, 'sí');
  assert.equal(c.fin, true);
  assert.equal(c.huella, 'abc');
  assert.deepEqual([c.accion.datos.tipo, c.accion.datos.monto, c.accion.datos.fecha, c.accion.datos.categoria], ['ingreso', 75000, '2026-11-09', 'Estudio']);
  const propia = media.continuarRecarga(recarga, 'es de mi otra cuenta');
  assert.equal(propia.fin, true);
  assert.equal(propia.huella, 'abc');
  assert.match(propia.texto, /No registré un gasto ni un ingreso/);
  assert.match(media.continuarRecarga(recarga, 'fue un préstamo de un amigo').texto, /\/debo 75000/);
});

test('contexto de la recarga guarda monto, fecha, hora, origen, destino y referencia', () => {
  const c = media.contextoRecarga({ es_recibo: true, tipo_operacion: 'recarga', total: 50000, fecha: '2026-11-08', hora: '14:35', cuenta_origen: 'Bancolombia', cuenta_destino: 'Nequi', referencia: 'M1234567' }, HOY);
  assert.deepEqual({ ...c, huella: typeof c.huella }, { monto: 50000, fecha: '2026-11-08', etapa: 'origen', origen: 'Bancolombia', destino: 'Nequi', hora: '14:35', referencia: 'M1234567', huella: 'string' });
  assert.match(media.textoInicioRecarga(c), /desde Bancolombia hacia Nequi \(ref\. M1234567\)/);
  assert.equal(media.contextoRecarga({ es_recibo: true, tipo_operacion: 'compra', total: 5000 }, HOY), null, 'una compra no abre contexto de recarga');
});

test('huella: dos capturas del mismo comprobante coinciden; pagos distintos no', () => {
  const a = { total: 45300, referencia: 'M-123 456', tipo_operacion: 'compra', fecha: '2026-11-09' };
  const b = { total: 45300, referencia: 'm123456', tipo_operacion: 'compra', fecha: '2026-11-09', hora: '10:00' };
  assert.equal(media.huellaComprobante(a), media.huellaComprobante(b), 'misma referencia, otra captura');
  assert.notEqual(media.huellaComprobante(a), media.huellaComprobante({ ...a, referencia: 'M999999' }));
  assert.notEqual(media.huellaComprobante(a), media.huellaComprobante({ ...a, total: 45400 }));
  const sinRef = { total: 12000, fecha: '2026-11-09', hora: '09:15', tipo_operacion: 'envio' };
  assert.equal(media.huellaComprobante(sinRef), media.huellaComprobante({ ...sinRef }));
  assert.notEqual(media.huellaComprobante(sinRef), media.huellaComprobante({ ...sinRef, hora: '09:16' }));
  assert.equal(media.huellaComprobante({ total: 12000, fecha: '2026-11-09' }), null, 'sin referencia ni hora no se arriesga a confundir pagos');
  assert.equal(media.huellaComprobante({ total: 0, referencia: 'ABCD1234' }), null);
});

test('confirmar: el mismo comprobante (otra captura) no se registra dos veces y otra cuenta no se ve afectada', () => {
  const item = { tipo: 'gasto', monto: 45300, categoria: 'Comida', descripcion: 'Éxito', fecha: HOY };
  contexto.guardar(U, { pendiente: { origen: 'imagen', items: [item], hash: 'h1', huella: 'hh1' } });
  assert.match(run(U, 'confirmar_pendiente'), /\$45\.300/);
  contexto.guardar(U, { pendiente: { origen: 'imagen', items: [item], hash: 'h2', huella: 'hh1' } });
  assert.match(run(U, 'confirmar_pendiente'), /otra captura del mismo pago/);
  assert.equal(db.listarMovimientos({ usuario: U }).filter((m) => m.monto === 45300).length, 1);
  const V = '573003330002';
  contexto.guardar(V, { pendiente: { origen: 'imagen', items: [item], hash: 'h3', huella: 'hh1' } });
  assert.match(run(V, 'confirmar_pendiente'), /\$45\.300/, 'la huella es por persona');
});
