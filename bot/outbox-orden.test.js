import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const temporal=fs.mkdtempSync(path.join(os.tmpdir(),'finbot-fifo-'));
process.env.DB_ARCHIVO=path.join(temporal,'fixture.db');
const db=await import('./db.js'),q=await import('./trabajos.js'),o=await import('./outbox.js');
const exec=promisify(execFile),A='573006001001',B='573006001002';db.asegurarUsuario(A);db.asegurarUsuario(B);
after(()=>{db.cerrarBase();fs.rmSync(temporal,{recursive:true,force:true});});
const limpiar=()=>db.base().exec('DELETE FROM trabajos');
let seq=0;
const respuesta=(usuario,texto,ahora,extra={})=>o.encolar({clave:`respuesta-fifo:${++seq}`,usuario,texto,ahora,...extra});

test('primera respuesta fallida impide adelantar la segunda, otro usuario avanza',async()=>{
  limpiar();const ahora=Date.now();respuesta(A,'primera',ahora);respuesta(A,'segunda',ahora);respuesta(B,'otra cuenta',ahora);
  const entregas=[],ids=[];
  await o.despachar({ahora:new Date(ahora),enviar:async(u,t,op)=>{ids.push(op.messageId);if(t==='primera')throw new Error('transporte caído');entregas.push([u,t]);}});
  assert.deepEqual(entregas,[[B,'otra cuenta']]);
  await o.despachar({ahora:new Date(ahora+3000),enviar:async(u,t,op)=>{ids.push(op.messageId);entregas.push([u,t]);}});
  assert.deepEqual(entregas,[[B,'otra cuenta'],[A,'primera'],[A,'segunda']]);assert.equal(ids[0],ids[2]);
});

test('reinicio conserva el bloqueo FIFO y el mismo ID del reintento',async()=>{
  limpiar();const ahora=Date.now();respuesta(A,'uno',ahora);respuesta(A,'dos',ahora);const t=q.reclamar('salida',{ahora});q.fallar(t,{ahora});
  const script=`const d=await import('./db.js');const o=await import('./outbox.js');const enviados=[];await o.despachar({ahora:new Date(${ahora}),enviar:async(_,t)=>enviados.push(t)});console.log(JSON.stringify(enviados));d.cerrarBase();`;
  const r=await exec(process.execPath,['--input-type=module','-e',script],{cwd:import.meta.dirname,env:{...process.env}});assert.deepEqual(JSON.parse(r.stdout.trim()),[]);
  const recibidos=[];await o.despachar({ahora:new Date(ahora+3000),enviar:async(_,t)=>recibidos.push(t)});assert.deepEqual(recibidos,['uno','dos']);
});

test('caducidad, agotamiento y cancelación liberan a la respuesta posterior',async()=>{
  for(const causa of ['expira','agotado','cancelado']){
    limpiar();const ahora=Date.now(),r=respuesta(A,'fallida',ahora);respuesta(A,'posterior',ahora);
    if(causa==='expira')db.base().prepare('UPDATE trabajos SET expira=? WHERE id=?').run(ahora-1,r.id);
    else{const t=q.reclamar('salida',{ahora});if(causa==='agotado')q.fallar(t,{ahora,maxIntentos:1});else q.cancelar(t.clave);}
    const recibidos=[];await o.despachar({ahora:new Date(ahora),enviar:async(_,t)=>recibidos.push(t)});assert.deepEqual(recibidos,['posterior'],causa);
  }
});

test('una notificación aplazada no bloquea conversación, ni esta impide avisos independientes',()=>{
  limpiar();const ahora=Date.now();
  const n=respuesta(A,'aviso',ahora,{evento:{tipo:'alerta',claves:[]}});db.base().prepare('UPDATE trabajos SET disponible=? WHERE id=?').run(ahora+100000,n.id);
  respuesta(A,'conversación',ahora);let t=q.reclamar('salida',{ahora});assert.equal(t.carril,'conversacion');q.fallar(t,{ahora});
  respuesta(A,'otra conversación',ahora);respuesta(A,'aviso independiente',ahora,{evento:{tipo:'recurrente'}});
  t=q.reclamar('salida',{ahora});assert.equal(t.carril,'notificacion');q.finalizar(t,{ahora});assert.equal(q.reclamar('salida',{ahora}),null);
});

test('reserva de análisis mantiene su lugar aunque la siguiente respuesta esté lista',()=>{
  limpiar();const ahora=Date.now(),a=q.admitir({clave:'dependencia',usuario:A,tipo:'entrada',contenido:'{}',modo_operacion:'real',clase:'analisis',ahora});
  respuesta(A,'reserva',ahora,{esperando:1,dependencia:a.id});respuesta(A,'posterior',ahora);assert.equal(q.reclamar('salida',{ahora}),null);
  const t=q.reclamar('entrada',{ahora});q.fallar(t,{ahora,maxIntentos:1});o.recuperarRespuestas(ahora);
  const primero=q.reclamar('salida',{ahora});assert.match(JSON.parse(q.leerContenido(primero.contenido,primero)).texto,/No pude completar el análisis/);
  q.finalizar(primero,{ahora});const segundo=q.reclamar('salida',{ahora});assert.equal(JSON.parse(q.leerContenido(segundo.contenido,segundo)).texto,'posterior');
});

test('saturación no borra respuestas ni acepta duplicados como nuevos',()=>{
  limpiar();const ahora=Date.now();
  const admitir=(clave)=>q.admitir({clave,usuario:A,tipo:'salida',contenido:'respuesta',ahora,maximo:2,porUsuario:2});
  admitir('saturada-1');admitir('saturada-2');assert.equal(admitir('saturada-3').ok,false);assert.equal(admitir('saturada-1').duplicado,true);
  const t=q.reclamar('salida',{ahora});q.fallar(t,{ahora});assert.equal(q.reclamar('salida',{ahora}),null);assert.equal(db.base().prepare('SELECT COUNT(*) n FROM trabajos').get().n,2);
});

test('varios usuarios se envían simultáneamente con concurrencia acotada y FIFO local',async()=>{
  limpiar();const ahora=Date.now();for(let u=0;u<6;u++){const usuario=`57300600200${u}`;db.asegurarUsuario(usuario);for(let i=0;i<4;i++)respuesta(usuario,String(i),ahora);}
  const vistos=new Map();let activos=0,max=0;
  const w=q.crearTrabajador({tipo:'salida',concurrencia:3,intervaloMs:10,procesar:t=>o.entregar(t,async(u,texto)=>{
    activos++;max=Math.max(max,activos);try{await new Promise(r=>setTimeout(r,5));const lista=vistos.get(u)??[];assert.equal(Number(texto),lista.length);lista.push(texto);vistos.set(u,lista);}finally{activos--;}
  })});
  try{w.despertar();for(let i=0;i<400;i++){if(db.base().prepare("SELECT COUNT(*) n FROM trabajos WHERE estado='hecho'").get().n===24)break;await new Promise(r=>setTimeout(r,10));}
    assert.equal(db.base().prepare("SELECT COUNT(*) n FROM trabajos WHERE estado='hecho'").get().n,24);assert.equal(vistos.size,6);assert.ok(max>1&&max<=3);
  }finally{await w.detener();}
});
