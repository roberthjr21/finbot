import test from 'node:test';
import assert from 'node:assert/strict';
import { validarRecibo } from './media.js';
const hoy = '2026-11-09';
test('comprobante de recarga Nequi legible no es gasto', () => {
 const r = validarRecibo({es_recibo:true,comercio:'Bancolombia',total:75000,fecha:hoy,categoria:'Ahorro',tipo_operacion:'recarga'},hoy);
 assert.equal(r.ok,false); assert.match(r.error,/No la registré como gasto/);
});
test('envío Nequi legible requiere confirmación como gasto',()=>{
 const r=validarRecibo({es_recibo:true,comercio:'Nequi',total:5000,fecha:hoy,categoria:'Servicios',tipo_operacion:'envio'},hoy);
 assert.equal(r.ok,true);assert.equal(r.item.tipo,'gasto');assert.equal(r.item.categoria,'Otros');
});
test('imagen sin comprobante tiene error específico',()=>{
 const r=validarRecibo({es_recibo:false},hoy);assert.equal(r.ok,false);assert.match(r.error,/comprobante financiero/);
});
