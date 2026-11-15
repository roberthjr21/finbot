import test, { after } from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_ARCHIVO = ':memory:';
const db = await import('./db.js');
const media = await import('./media.js');
after(() => db.cerrarBase());

test('metadatos de recarga se sanitizan y no se usan para bloquear otro pago', () => {
  const p = media.contextoRecarga({ es_recibo:true, tipo_operacion:'recarga', total:75000,
    fecha:'2026-11-14', hora:'10:20', referencia:'REFERENCIA-1',
    cuenta_origen:'Bancolombia', cuenta_destino:'Nequi' }, '2026-11-14');
  assert.equal(p.origen,'Bancolombia');
  assert.equal(p.destino,'Nequi');
  assert.equal(p.hora,'10:20');
  assert.match(media.textoInicioRecarga(p),/Nequi/);
  assert.match(media.textoInicioRecarga(p),/REFERENCIA-1/);
});

test('consultas y nuevos gastos no se consumen como aclaraciones de recarga', () => {
  const base = { monto:75000, fecha:'2026-11-14', etapa:'concepto' };
  for(const texto of ['¿cuánto tengo?', 'saldo', 'compré aceite por 20000', 'gaste 5 mil', 'resumen del mes']) {
    assert.equal(media.continuarRecarga(base,texto),null,texto);
  }
  const r = media.continuarRecarga(base,'venta de un producto que compré');
  assert.equal(r.pendiente.etapa,'confirmar');
  assert.equal(r.pendiente.categoria,'Ventas');
});
