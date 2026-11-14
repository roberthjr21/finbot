import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const temporal=fs.mkdtempSync(path.join(os.tmpdir(),'finbot-analisis-cola-'));
process.env.DB_ARCHIVO=path.join(temporal,'fixture.db');
process.env.COLA_SECRETO='cifrado-analisis-solo-pruebas-ficticias-12345';
const db=await import('./db.js'),q=await import('./trabajos.js'),o=await import('./outbox.js');
const {reservarAnalisis,procesarAnalisis}=await import('./analisis-trabajos.js');
const fin=await import('./finanzas.js');
const exec=promisify(execFile),U='573008001001';db.asegurarUsuario(U);
const fotoFinanciera=()=>JSON.stringify({movimientos:db.listarMovimientos({usuario:U}),saldo:fin.caja(U,'2026-11-30'),deudas:fin.deudas(U),prestamos:fin.prestamos(U)});
after(()=>{db.cerrarBase();fs.rmSync(temporal,{recursive:true,force:true});});
const preparar=mensajeId=>db.enTransaccion(()=>{
  if(db.yaProcesado(`${U}:${mensajeId}`))return;
  db.agregarMovimiento({usuario:U,tipo:'gasto',monto:100,categoria:'Otros',fecha:'2026-11-14',mensajeId:`${U}:${mensajeId}`});
  reservarAnalisis({usuario:U,mensajeId,hoy:'2026-11-14',usarIA:true});db.marcarProcesado(`${U}:${mensajeId}`);
});
const limpiar=()=>db.base().exec('DELETE FROM trabajos');
const salida=()=>db.base().prepare("SELECT * FROM trabajos WHERE tipo='salida'").get();

test('caída antes del commit revierte finanzas, marca, análisis y respuesta reservada',()=>{
  limpiar();const antes=fotoFinanciera();
  db.base().exec("CREATE TRIGGER fallo_reserva BEFORE INSERT ON trabajos WHEN NEW.tipo='salida' BEGIN SELECT RAISE(ABORT,'fallo outbox'); END;");
  try{assert.throws(()=>preparar('antes'),/fallo outbox/);}finally{db.base().exec('DROP TRIGGER fallo_reserva');}
  assert.equal(fotoFinanciera(),antes);assert.equal(db.yaProcesado(`${U}:antes`),false);assert.equal(db.base().prepare('SELECT COUNT(*) n FROM trabajos').get().n,0);
});

for(const fase of ['antes','durante','despues'])test(`reinicio ${fase} del análisis recupera una respuesta sin repetir el movimiento`,async()=>{
  limpiar();const mensajeId=`reinicio-${fase}`;preparar(mensajeId);const antes=fotoFinanciera();
  const script=`const q=await import('./trabajos.js');const a=await import('./analisis-trabajos.js');const t=q.reclamar('entrada',{leaseMs:1});
    ${fase==='antes' ? 'process.exit(73);' : `const confirmar=await a.procesarAnalisis(t,{generar:async()=>{${fase==='durante' ? 'process.exit(73);' : "return 'Resultado perdido antes de confirmar';"}}});process.exit(73);`}`;
  await assert.rejects(exec(process.execPath,['--input-type=module','-e',script],{cwd:import.meta.dirname,env:{...process.env}}),e=>e.code===73);
  preparar(mensajeId);assert.equal(fotoFinanciera(),antes);assert.equal(salida().esperando,1);assert.equal(q.reclamar('salida'),null);
  const t=q.reclamar('entrada');assert.equal(t.clase,'analisis');
  const confirmar=await procesarAnalisis(t,{generar:async()=> 'Análisis recuperado'});
  assert.equal(salida().esperando,1);assert.equal(q.finalizar(t,{confirmar}),true);assert.equal(salida().esperando,0);
  const textos=[];await o.despachar({enviar:async(_,texto)=>textos.push(texto)});await o.despachar({enviar:async(_,texto)=>textos.push(texto)});
  assert.deepEqual(textos,['📈 Análisis recuperado']);assert.equal(fotoFinanciera(),antes);
});

test('caída después del commit del resultado conserva outbox e idempotencia',async()=>{
  limpiar();preparar('resultado-confirmado');const antes=fotoFinanciera(),t=q.reclamar('entrada');
  const confirmar=await procesarAnalisis(t,{generar:async()=> 'Confirmado'});q.finalizar(t,{confirmar});
  const r=await exec(process.execPath,['--input-type=module','-e',"const q=await import('./trabajos.js');const d=await import('./db.js');console.log(JSON.stringify(q.reclamar('entrada')));d.cerrarBase();"],{cwd:import.meta.dirname,env:{...process.env}});
  assert.equal(JSON.parse(r.stdout.trim()),null);assert.equal(salida().estado,'pendiente');assert.equal(fotoFinanciera(),antes);
});

for(const proveedor of ['gemini','claude'])test(`${proveedor}: fallo HTTP tiene respuesta local durable y diagnóstico sin secretos`,async()=>{
  limpiar();preparar(`fallo-${proveedor}`);const antes=fotoFinanciera();
  const anteriorFetch=globalThis.fetch,gemini=process.env.GEMINI_API_KEY,claude=process.env.ANTHROPIC_API_KEY;
  delete process.env.GEMINI_API_KEY;delete process.env.ANTHROPIC_API_KEY;
  process.env[proveedor==='gemini'?'GEMINI_API_KEY':'ANTHROPIC_API_KEY']='credencial-ficticia-de-test';
  globalThis.fetch=async()=>new Response('{}',{status:400});
  try{
    const t=q.reclamar('entrada');const confirmar=await procesarAnalisis(t);q.finalizar(t,{confirmar});
    assert.equal(db.base().prepare('SELECT error FROM trabajos WHERE id=?').get(t.id).error,'proveedor_ia_no_disponible');
    const d=JSON.parse(q.leerContenido(salida().contenido,salida()));assert.match(d.texto,/IA no estuvo disponible/);assert.ok(!d.texto.includes('credencial-ficticia'));
  }finally{globalThis.fetch=anteriorFetch;for(const[k,v]of [['GEMINI_API_KEY',gemini],['ANTHROPIC_API_KEY',claude]]){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
  assert.equal(fotoFinanciera(),antes);
});

test('agotamiento deja fallo verificable en outbox y libera la respuesta reservada',async()=>{
  limpiar();preparar('agotado');const antes=fotoFinanciera(),t=q.reclamar('entrada');q.fallar(t,{maxIntentos:1});
  assert.equal(o.recuperarRespuestas(),1);assert.equal(salida().esperando,0);assert.equal(salida().error,'analisis_no_completado');assert.equal(fotoFinanciera(),antes);
});

test('análisis de prueba perdido deja un solo aviso y nunca consulta finanzas reales',async()=>{
  limpiar();const antes=fotoFinanciera(),entradas=await import('./entradas.js');
  db.activarPrueba(U,'sesion-del-arranque-anterior');
  db.conModoCapturado(U,{modo_operacion:'prueba',sesion_prueba:'sesion-del-arranque-anterior'},()=>reservarAnalisis({usuario:U,mensajeId:'prueba-perdida',hoy:'2026-11-14'}));
  db.desactivarPrueba(U);entradas.recuperarEntradas();o.recuperarRespuestas();
  const filas=db.base().prepare("SELECT * FROM trabajos WHERE tipo='salida'").all();assert.equal(filas.length,1);assert.equal(filas[0].esperando,0);
  assert.equal(db.base().prepare("SELECT estado FROM trabajos WHERE clase='analisis'").get().estado,'cancelado');assert.equal(fotoFinanciera(),antes);
});

test('500 entradas activas reservan análisis sin perder movimientos ni consumir reintentos',async()=>{
  limpiar();const e=await import('./entradas.js');
  const total=()=>db.base().prepare('SELECT COUNT(*) n FROM movimientos WHERE usuario=?').get(U).n;
  const antes=total();
  for(let i=0;i<500;i++)assert.equal(e.admitirEntrada({usuario:U,mensajeId:`llena-${i}`,contenido:'{}'}).ok,true);
  assert.equal(e.admitirEntrada({usuario:U,mensajeId:'exceso',contenido:'{}'}).ok,false);
  for(let i=0;i<500;i++){
    const t=q.reclamar('entrada');assert.ok(t);assert.equal(t.intentos,1);
    await e.procesarEntrada(t,()=>db.enTransaccion(()=>{
      const id=`${U}:llena-${i}`;
      assert.equal(db.yaProcesado(id),false);
      db.agregarMovimiento({usuario:U,tipo:'gasto',monto:100,categoria:'Otros',fecha:'2026-11-14',mensajeId:id});
      reservarAnalisis({usuario:U,mensajeId:`llena-${i}`,hoy:'2026-11-14',usarIA:false});
      db.marcarProcesado(id);
    }));assert.equal(q.finalizar(t),true);
  }
  // El cupo de las continuaciones también permanece limitado a 500.
  assert.throws(()=>reservarAnalisis({usuario:U,mensajeId:'analisis-exceso',hoy:'2026-11-14'}),/saturada/);
  for(let i=0;i<500;i++){
    const t=q.reclamar('entrada');assert.equal(t.clase,'analisis');assert.equal(t.intentos,1);
    q.finalizar(t,{confirmar:await procesarAnalisis(t)});
  }
  const textos=[];await o.despachar({maximo:500,enviar:async(_,texto)=>textos.push(texto)});
  assert.equal(textos.length,500);
  assert.equal(total(),antes+500);
  const guardados=db.base().prepare("SELECT COUNT(*) n, SUM(monto) monto FROM movimientos WHERE usuario=? AND mensaje_id LIKE ?").get(U,`${U}:llena-%`);
  assert.equal(guardados.n,500);assert.equal(guardados.monto,50000);
  assert.equal(db.base().prepare("SELECT COUNT(*) n FROM trabajos WHERE estado!='hecho' OR intentos!=1").get().n,0);
  assert.equal(q.reclamar('entrada'),null);
});

test('cupo global y por cuenta limita cada grupo sin alterar FIFO ni leases',()=>{
  limpiar();
  const admitir=(clave,usuario,clase)=>q.admitir({clave,usuario,tipo:'entrada',clase,contenido:'{}',maximo:2,porUsuario:1});
  const otro='573008001002';db.asegurarUsuario(otro);
  assert.equal(admitir('limite-m1',U,'mensaje').ok,true);
  assert.equal(admitir('limite-m2',U,'mensaje').ok,false);
  assert.equal(admitir('limite-a1',U,'analisis').ok,true);
  assert.equal(admitir('limite-a2',U,'analisis').ok,false);
  assert.equal(admitir('limite-m3',otro,'mensaje').ok,true);
  assert.equal(admitir('limite-a3',otro,'analisis').ok,true);
  for(const clase of ['mensaje','analisis'])assert.equal(admitir(`exceso-${clase}`,'573008001003',clase).ok,false);
  const t=q.reclamar('entrada');assert.equal(t.clave,'limite-m1');
  const paralelo=q.reclamar('entrada');assert.equal(paralelo.usuario,otro);
  assert.equal(q.reclamar('entrada'),null);
  q.finalizar(t);assert.equal(q.reclamar('entrada').clave,'limite-a1');
});
