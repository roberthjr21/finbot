import test from 'node:test';
import assert from 'node:assert/strict';
import {contextoRecarga,continuarRecarga} from './media.js';
const p=contextoRecarga({es_recibo:true,tipo_operacion:'recarga',total:75000,fecha:'2026-11-09',comercio:'Bancolombia'},'2026-11-09');
test('retiene monto de recarga y pregunta concepto',()=>{const r=continuarRecarga(p,'Me pasaron esa plata a mi cuenta');assert.match(r.texto,/75.000/);assert.equal(r.pendiente.etapa,'concepto');});
test('confirma ingreso solo después del concepto',()=>{const a=continuarRecarga(p,'me pasaron esa plata');const b=continuarRecarga(a.pendiente,'una venta');assert.equal(b.pendiente.etapa,'confirmar');assert.equal(continuarRecarga(b.pendiente,'no').accion,undefined);const c=continuarRecarga(b.pendiente,'sí');assert.equal(c.accion.datos.monto,75000);assert.equal(c.accion.datos.categoria,'Ventas');});
test('transferencia propia no se registra',()=>{const r=continuarRecarga(p,'era de mi otra cuenta');assert.equal(r.fin,true);assert.equal(r.accion,undefined);});
test('préstamo no se registra como ingreso',()=>{const r=continuarRecarga(p,'me pasaron un prestamo');assert.equal(r.accion,undefined);});
