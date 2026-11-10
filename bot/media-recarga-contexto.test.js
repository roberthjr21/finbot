import test from 'node:test';
import assert from 'node:assert/strict';
import {contextoRecarga,continuarRecarga,textoInicioRecarga} from './media.js';
const p=contextoRecarga({es_recibo:true,tipo_operacion:'recarga',total:75000,fecha:'2026-11-09',comercio:'Bancolombia'},'2026-11-09');
test('retiene monto de recarga y pregunta concepto',()=>{const r=continuarRecarga(p,'Me pasaron esa plata a mi cuenta');assert.match(r.texto,/75.000/);assert.equal(r.pendiente.etapa,'concepto');});
test('confirma ingreso solo después del concepto',()=>{const a=continuarRecarga(p,'me pasaron esa plata');const b=continuarRecarga(a.pendiente,'una venta');assert.equal(b.pendiente.etapa,'confirmar');assert.equal(continuarRecarga(b.pendiente,'no').accion,undefined);const c=continuarRecarga(b.pendiente,'sí');assert.equal(c.accion.datos.monto,75000);assert.equal(c.accion.datos.categoria,'Ventas');});
test('transferencia propia no se registra',()=>{const r=continuarRecarga(p,'era de mi otra cuenta');assert.equal(r.fin,true);assert.equal(r.accion,undefined);});
test('préstamo no se registra como ingreso',()=>{const r=continuarRecarga(p,'me pasaron un prestamo');assert.equal(r.accion,undefined);});

test('universidad se clasifica como ingreso en Estudio con concepto conservado',()=>{const primero=continuarRecarga(p,'Sí fue dinero recibido de otra persona');assert.equal(primero.pendiente.etapa,'concepto');const segundo=continuarRecarga(primero.pendiente,'Ingreso para la universidad');assert.equal(segundo.pendiente.categoria,'Estudio');assert.match(segundo.texto,/75.000/);const tercero=continuarRecarga(segundo.pendiente,'sí');assert.equal(tercero.accion.datos.monto,75000);assert.equal(tercero.accion.datos.categoria,'Estudio');assert.equal(tercero.accion.datos.descripcion,'Ingreso para la universidad');});
test('una respuesta sin concepto reconocible no registra ni avanza a confirmar',()=>{const primero=continuarRecarga(p,'me enviaron dinero');const segundo=continuarRecarga(primero.pendiente,'hola');assert.equal(segundo.pendiente,undefined);assert.equal(segundo.accion,undefined);});

test('el aviso de recarga incluye monto y pregunta por origen',()=>{const mensaje=textoInicioRecarga(p);assert.match(mensaje,/75.000/);assert.match(mensaje,/otra cuenta tuya/);});
