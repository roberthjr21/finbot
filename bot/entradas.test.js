import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const temporal=fs.mkdtempSync(path.join(os.tmpdir(),'finbot-entradas-'));
process.env.DB_ARCHIVO=path.join(temporal,'fixture.db');
process.env.COLA_SECRETO='solo-pruebas-modo-capturado-no-es-real-12345';
const db=await import('./db.js'),q=await import('./trabajos.js'),e=await import('./entradas.js'),ctx=await import('./contexto.js');
const { ejecutar }=await import('./acciones.js');
const exec=promisify(execFile);
after(()=>{db.cerrarBase();fs.rmSync(temporal,{recursive:true,force:true});});
const A='573001001001',B='573001001002';db.asegurarUsuario(A);db.asegurarUsuario(B);
let seq=0;
const admitir=(texto,usuario=A,extra={})=>e.admitirEntrada({usuario,mensajeId:`m${++seq}`,texto,contenido:JSON.stringify({texto}),...extra});
const movimientos=usuario=>db.listarMovimientos({usuario});
async function paso(procesar=()=>assert.fail('un control no ejecuta acciones financieras')) {
  const t=q.reclamar('entrada');assert.ok(t);
  await db.conControlTransaccion(()=>{if(!q.vigente(t))throw new Error('lease');},()=>e.procesarEntrada(t,procesar));
  q.finalizar(t);return t;
}
const gasto=t=>db.enTransaccion(()=>ejecutar({nombre:'registrar_movimiento',datos:{tipo:'gasto',monto:2500,categoria:'Comida'}},{usuario:t.usuario,hoy:'2026-11-14',mensajeId:t.clave,indice:0}));
const limpiar=()=>{for(const u of [A,B])db.desactivarPrueba(u);db.base().exec('DELETE FROM trabajos;DELETE FROM entrada_modos;DELETE FROM contexto');};
const reiniciar=()=>exec(process.execPath,['--input-type=module','-e',"const d=await import('./db.js');const e=await import('./entradas.js');e.recuperarEntradas();d.cerrarBase();"],{cwd:import.meta.dirname,env:{...process.env}});

test('captura on/gasto/off/real al admitir y respeta FIFO',async()=>{
  limpiar();admitir('/prueba on');admitir('/gasto 2500 comida');admitir('/prueba off');admitir('/gasto 2500 comida');
  const filas=db.base().prepare('SELECT modo_operacion,sesion_prueba FROM trabajos ORDER BY id').all();
  assert.deepEqual(filas.map(t=>t.modo_operacion),['prueba','prueba','real','real']);assert.equal(filas[0].sesion_prueba,filas[1].sesion_prueba);
  const antes=movimientos(A).length;await paso();await paso(gasto);assert.equal(movimientos(A).length,antes);
  db.conBasePrueba(A,()=>assert.equal(movimientos(A).length,1));await paso();await paso(gasto);assert.equal(movimientos(A).length,antes+1);
});
test('reinicio antes de procesar gasto en prueba cancela sin volver al modo real',async()=>{
  limpiar();admitir('/prueba on');await paso();admitir('/gasto 2500 comida');const antes=JSON.stringify(movimientos(A));
  await reiniciar();assert.equal(JSON.stringify(movimientos(A)),antes);
  assert.equal(db.base().prepare('SELECT estado FROM trabajos WHERE clave=?').get(`entrada:${A}:m${seq}`).estado,'cancelado');
  assert.equal(db.base().prepare('SELECT modo FROM entrada_modos WHERE usuario=?').get(A).modo,'prueba');
});
test('desactivar con entradas pendientes no permite que caigan en la base real',async()=>{
  limpiar();admitir('/prueba on');await paso();admitir('/gasto 2500 comida');db.desactivarPrueba(A);
  const antes=JSON.stringify(movimientos(A)),t=await paso(gasto);
  assert.equal(db.base().prepare('SELECT estado FROM trabajos WHERE id=?').get(t.id).estado,'cancelado');assert.equal(JSON.stringify(movimientos(A)),antes);
});
test('dos usuarios conservan bases independientes',async()=>{
  limpiar();admitir('/prueba on',A);await paso();admitir('/gasto 2500 comida',A);admitir('/gasto 2500 comida',B);
  const a=movimientos(A).length,b=movimientos(B).length;await paso(gasto);await paso(gasto);
  assert.equal(movimientos(A).length,a);assert.equal(movimientos(B).length,b+1);
});
for(const origen of ['imagen','voz'])test(`reinicio con confirmación ${origen} nunca la ejecuta en real`,async()=>{
  limpiar();admitir('/prueba on');await paso();db.conBasePrueba(A,()=>ctx.guardar(A,{pendiente:{origen,items:[{tipo:'gasto',monto:1000,categoria:'Comida'}]}}));
  admitir('sí');const antes=JSON.stringify(movimientos(A));await reiniciar();assert.equal(q.reclamar('entrada'),null);assert.equal(JSON.stringify(movimientos(A)),antes);
});
test('entradas heredadas sin modo se cancelan y su cuerpo se elimina',async()=>{
  limpiar();const r=q.admitir({clave:'entrada:heredada',usuario:A,tipo:'entrada',contenido:'contenido anterior'});
  const t=q.reclamar('entrada');await e.procesarEntrada(t,()=>assert.fail('heredada no ejecutable'));
  const f=db.base().prepare('SELECT * FROM trabajos WHERE id=?').get(r.id);assert.equal(f.estado,'cancelado');assert.equal(f.contenido,null);
});
test('admisión saturada o repetida no altera el modo proyectado',()=>{
  limpiar();admitir('/prueba on');const id=seq,previo=db.base().prepare('SELECT * FROM entrada_modos WHERE usuario=?').get(A);
  assert.equal(admitir('/prueba off',A,{maximo:1}).ok,false);
  assert.equal(e.admitirEntrada({usuario:A,mensajeId:`m${id}`,texto:'/prueba off',contenido:'duplicado'}).duplicado,true);
  assert.deepEqual(db.base().prepare('SELECT * FROM entrada_modos WHERE usuario=?').get(A),previo);
});
test('cambiar los metadatos de modo invalida la carga cifrada',()=>{
  limpiar();admitir('/prueba on');const t=q.reclamar('entrada');assert.throws(()=>q.leerContenido(t.contenido,{...t,modo_operacion:'real'}),/descifrar/);
});
