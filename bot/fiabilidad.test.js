import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const temporal = fs.mkdtempSync(path.join(os.tmpdir(), 'finbot-fiabilidad-'));
process.env.DB_ARCHIVO = path.join(temporal, 'datos.db');
process.env.COLA_SECRETO = 'clave-ficticia-cola-para-pruebas-123456789';
process.env.API_TOKEN = 'token-ficticio-de-pruebas';
const db = await import('./db.js');
const q = await import('./trabajos.js');
const outbox = await import('./outbox.js');
const rec = await import('./recordatorios.js');
const acceso = await import('./acceso.js');
const privacidad = await import('./privacidad-admin.js');
const respaldos = await import('./respaldos.js');
const admin = await import('./db-admin.js');
const cifrado = await import('./respaldo-cifrado.js');
const { ejecutar } = await import('./acciones.js');
const exec = promisify(execFile);
after(() => { db.cerrarBase(); fs.rmSync(temporal, { recursive: true, force: true }); });
const U = '573009991111', B = '573009992222';
db.asegurarUsuario(U); db.asegurarUsuario(B);
let seq = 0;
const agregar = (usuario = U, extra = {}) => q.admitir({ clave: `entrada:prueba:${++seq}`, usuario, tipo: 'entrada', contenido: JSON.stringify({ texto: 'dato personal temporal' }), ...extra });
const limpiar = () => db.base().exec('DELETE FROM trabajos; DELETE FROM alertas_reservadas');

test('admisión persistente, cifrado, duplicados y saturación verificable sin borrar pendientes', async () => {
  limpiar(); const primero = agregar(U, { maximo: 2 }); agregar(B, { maximo: 2 });
  assert.equal(agregar(U, { maximo: 2 }).motivo, 'saturado');
  assert.equal(db.base().prepare('SELECT COUNT(*) AS n FROM trabajos').get().n, 2);
  const fila = db.base().prepare('SELECT * FROM trabajos WHERE id = ?').get(primero.id);
  assert.ok(fila.contenido.startsWith('enc:v1:')); assert.ok(!fila.contenido.includes('dato personal'));
  assert.equal(q.admitir({ clave: fila.clave, usuario: U, tipo: 'entrada', contenido: 'repetido' }).duplicado, true);
  const salida = await exec(process.execPath, ['--input-type=module', '-e', "const d=await import('./db.js'); console.log(JSON.stringify(d.base().prepare('SELECT COUNT(*) AS n FROM trabajos').get().n)); d.cerrarBase();"], { cwd: import.meta.dirname, env: { ...process.env } });
  assert.equal(JSON.parse(salida.stdout.trim()), 2);
});

test('reservas excluyen procesos, preservan FIFO por usuario y recuperan trabajo vencido', async () => {
  limpiar(); const ahora = Date.now();
  agregar(U); agregar(U); agregar(B);
  const a = q.reclamar('entrada', { ahora, leaseMs: 1000 }); assert.equal(a.usuario, U);
  const script = "const d=await import('./db.js'); const q=await import('./trabajos.js'); console.log(JSON.stringify(q.reclamar('entrada')?.usuario));d.cerrarBase();";
  const r = await exec(process.execPath, ['--input-type=module','-e',script], { cwd: import.meta.dirname, env: { ...process.env } });
  assert.equal(JSON.parse(r.stdout.trim()), B);
  assert.equal(q.reclamar('entrada', { ahora }), null);
  const recuperada = q.reclamar('entrada', { ahora: ahora + 1001 }); assert.equal(recuperada.id, a.id);
  assert.equal(q.finalizar(a, { ahora: ahora + 1002 }), false);
  assert.equal(q.finalizar(recuperada, { ahora: ahora + 1002 }), true);
  assert.equal(q.reclamar('entrada', { ahora: ahora + 1002 }).usuario, U);
});

test('reserva perdida impide confirmar operaciones financieras de un trabajador antiguo', () => {
  limpiar(); agregar(); const t = q.reclamar('entrada'); q.cancelar(t.clave);
  assert.throws(() => db.conControlTransaccion(() => { if (!q.vigente(t)) throw new Error('reserva perdida'); }, () => db.enTransaccion(() => db.agregarMovimiento({ usuario: U, tipo: 'gasto', monto: 1, categoria: 'Otros', fecha: '2026-11-11', mensajeId: 'antiguo' }))), /reserva perdida/);
  assert.equal(db.base().prepare("SELECT COUNT(*) AS n FROM movimientos WHERE mensaje_id='antiguo'").get().n, 0);
});

test('reintentos con backoff, límite y eliminación del cuerpo al agotarse', () => {
  limpiar(); const ahora = Date.now(); agregar(U, { ahora });
  let tiempo = ahora;
  for (let i = 1; i <= 5; i++) {
    const t = q.reclamar('entrada', { ahora: tiempo }); assert.equal(t.intentos, i);
    q.fallar(t, { ahora: tiempo }); assert.equal(q.reclamar('entrada', { ahora: tiempo }), null);
    tiempo += 100000;
  }
  const fila = db.base().prepare('SELECT * FROM trabajos').get();
  assert.equal(fila.estado, 'agotado'); assert.equal(fila.contenido, null);
});

test('estrés: 1000 mensajes, concurrencia acotada, orden individual y ninguna cuenta bloquea a otra', async () => {
  limpiar(); const total = 1000, usuarios = 10;
  for (let i=0;i<total;i++) agregar(`usuario-${i % usuarios}`, { contenido: JSON.stringify({ indice: Math.floor(i / usuarios) }) });
  const vistos = new Map(); let activos = 0, maximo = 0;
  let liberar; const lento = new Promise(r => { liberar = r; }); let otros = 0;
  const trabajador = q.crearTrabajador({ tipo: 'entrada', intervaloMs: 5, concurrencia: 4, procesar: async t => {
    activos++; maximo = Math.max(maximo, activos);
    try {
      const { indice } = JSON.parse(q.leerContenido(t.contenido, t));
      if (t.usuario === 'usuario-0' && indice === 0) await lento;
      else otros++;
      const lista = vistos.get(t.usuario) ?? [];
      assert.equal(indice, lista.length); lista.push(indice); vistos.set(t.usuario, lista);
    } finally { activos--; }
  } });
  trabajador.despertar();
  try {
    for (let i=0;otros<20 && i<200;i++) await new Promise(r => setTimeout(r, 5));
    assert.ok(otros >= 20, 'otras cuentas avanzan mientras la primera espera'); liberar();
    for (let i=0;i<1000;i++) {
      if (db.base().prepare("SELECT COUNT(*) AS n FROM trabajos WHERE estado='hecho'").get().n === total) break;
      await new Promise(r => setTimeout(r, 5));
    }
    assert.equal(db.base().prepare("SELECT COUNT(*) AS n FROM trabajos WHERE estado='hecho'").get().n, total);
    assert.ok(maximo <= 4); assert.equal(vistos.size, usuarios);
    assert.equal(db.base().prepare('SELECT COUNT(*) AS n FROM trabajos WHERE contenido IS NOT NULL').get().n, 0);
  } finally { liberar(); await trabajador.detener(); }
});

test('caída tras COMMIT: reentrega no duplica movimiento y la respuesta ya está en outbox', () => {
  limpiar(); agregar(); const ahora = Date.now(), t = q.reclamar('entrada', { ahora, leaseMs: 1000 });
  const procesar = () => db.enTransaccion(() => {
    if (db.yaProcesado('mensaje-durable')) return;
    db.agregarMovimiento({ usuario: U, tipo: 'gasto', monto: 100, categoria: 'Otros', fecha: '2026-11-11', mensajeId: 'mensaje-durable' });
    outbox.encolar({ clave: 'respuesta:durable', usuario: U, texto: 'Guardado' });
    db.marcarProcesado('mensaje-durable');
  });
  procesar(); // Simula caída antes de finalizar el trabajo, pero después de COMMIT.
  const r = q.reclamar('entrada', { ahora: ahora + 1001 }); assert.equal(r.id, t.id); procesar(); q.finalizar(r, { ahora: ahora + 1002 });
  assert.equal(db.base().prepare("SELECT COUNT(*) AS n FROM movimientos WHERE mensaje_id='mensaje-durable'").get().n, 1);
  assert.equal(db.base().prepare("SELECT COUNT(*) AS n FROM trabajos WHERE clave='respuesta:durable'").get().n, 1);
});

test('outbox recupera fallos y confirma recordatorio con ID estable; un cancelado no se envía', async () => {
  limpiar(); const ahora = new Date();
  const id = rec.crear({ usuario: U, texto: 'Aviso privado', vence: '2026-11-11' }, { hoy: '2026-11-11' }).id;
  const evento = { tipo: 'recordatorio', id, vence: '2026-11-11', hora: '09:00' };
  outbox.encolar({ clave: 'recordatorio:prueba', usuario: U, texto: 'Aviso', evento, ahora: ahora.getTime() });
  const ids=[];
  await outbox.despachar({ ahora, enviar: async (_,__,o) => { ids.push(o.messageId); throw new Error('desconexión'); } });
  assert.equal(rec.obtener(U,id).estado,'pendiente');
  await outbox.despachar({ ahora: new Date(ahora.getTime()+5000), enviar: async (_,__,o) => { ids.push(o.messageId); } });
  assert.equal(ids.length,2); assert.equal(ids[0],ids[1]); assert.equal(rec.obtener(U,id).estado,'enviado');
  const cancelado = rec.crear({ usuario: U, texto: 'No enviar', vence: '2026-11-11' }, { hoy: '2026-11-11' }).id;
  outbox.encolar({ clave: 'cancelado:prueba', usuario: U, texto: 'No enviar', evento: { ...evento, id: cancelado } });
  rec.cancelar(U,cancelado);
  await outbox.despachar({ ahora: new Date(ahora.getTime()+10000), enviar: async()=>assert.fail('no debe enviarse') });
});

test('borrado ordinario conserva auditoría minimizada; eliminación definitiva exige autorización y no altera otra cuenta', () => {
  limpiar();
  const telefono = '573009993333'; db.asegurarUsuario(telefono);
  const movimiento = db.agregarMovimiento({ usuario: telefono, tipo: 'gasto', monto: 500, categoria: 'Otros', descripcion: 'PERSONAL-SECRETO', fecha: '2026-11-11' });
  db.registrarAuditoria({ usuario: telefono, accion: 'crear', entidad: 'movimiento', entidadId: movimiento, detalle: { monto: 500, descripcion: 'PERSONAL-SECRETO', persona: 'Nombre privado' } });
  assert.ok(!db.listarAuditoria(telefono)[0].detalle.includes('PERSONAL'));
  ejecutar({ nombre:'borrar_datos', datos:{alcance:'todo'} },{ usuario:telefono,hoy:'2026-11-11',mensajeId:'borrado',indice:0 });
  ejecutar({ nombre:'confirmar_borrado', datos:{} },{ usuario:telefono,hoy:'2026-11-11',mensajeId:'confirmado',indice:0 });
  assert.ok(db.listarAuditoria(telefono).length); assert.ok(db.usuarioPorTelefono(telefono));
  const otraCuenta = JSON.stringify(db.listarMovimientos({ usuario: B }));
  const plan = privacidad.prepararEliminacion(db.base(), telefono);
  assert.throws(()=>privacidad.eliminarCuenta(db.base(),{usuario:telefono,confirmacion:plan.confirmacion}), /autorización/);
  assert.throws(()=>privacidad.eliminarCuenta(db.base(),{usuario:B,confirmacion:plan.confirmacion,botDetenido:true,autorizacionTitular:true}), /Confirmación/);
  const r = privacidad.eliminarCuenta(db.base(), { usuario:telefono,confirmacion:plan.confirmacion,botDetenido:true,autorizacionTitular:true });
  assert.ok(r.eliminacionLogica); assert.equal(r.verificacion,'ok'); assert.equal(db.usuarioPorTelefono(telefono),null); assert.equal(db.listarAuditoria(telefono).length,0);
  assert.equal(JSON.stringify(db.listarMovimientos({usuario:B})),otraCuenta); assert.ok(db.usuarioPorTelefono(B));
});

test('eliminación rechaza un plan vencido o modificado y no borra un respaldo previo', () => {
  const telefono = '573009994444'; db.asegurarUsuario(telefono);
  let plan = privacidad.prepararEliminacion(db.base(),telefono);
  assert.throws(()=>privacidad.eliminarCuenta(db.base(),{usuario:telefono,confirmacion:plan.confirmacion,botDetenido:true,autorizacionTitular:true,ahora:plan.expira}),/vencida/);
  plan = privacidad.prepararEliminacion(db.base(),telefono);
  db.agregarMovimiento({usuario:telefono,tipo:'ingreso',monto:200,categoria:'Otros',fecha:'2026-11-11'});
  assert.throws(()=>privacidad.eliminarCuenta(db.base(),{usuario:telefono,confirmacion:plan.confirmacion,botDetenido:true,autorizacionTitular:true}),/cambiaron/);
  const copia = path.join(temporal,'antes-de-eliminar.db'); admin.crearRespaldo(process.env.DB_ARCHIVO,copia);
  plan = privacidad.prepararEliminacion(db.base(),telefono);
  privacidad.eliminarCuenta(db.base(),{usuario:telefono,confirmacion:plan.confirmacion,botDetenido:true,autorizacionTitular:true});
  assert.ok(fs.existsSync(copia)); const b=new DatabaseSync(copia,{readOnly:true});
  try { assert.ok(b.prepare('SELECT 1 FROM usuarios WHERE telefono=?').get(telefono)); } finally { b.close(); }
});

test('sin IP real se admiten más de quince personas manteniendo límites por teléfono y cupo agregado', async () => {
  acceso.reiniciarLimites();
  for (let i=0;i<30;i++) assert.equal((await acceso.solicitarCodigo({telefono:`57300888${String(i).padStart(4,'0')}`,ip:'?',enviar:async()=>{}})).ok,true);
  for (let i=0;i<15;i++) await acceso.solicitarCodigo({telefono:`57300777${String(i).padStart(4,'0')}`,ip:'8.8.8.8',enviar:async()=>{}});
  assert.equal((await acceso.solicitarCodigo({telefono:'573006661111',ip:'8.8.8.8',enviar:async()=>{}})).motivo,'espera');
  assert.equal((await acceso.solicitarCodigo({telefono:'573008880000',ip:'?',enviar:async()=>{}})).motivo,'espera');
});

test('reemplazo de sesión revoca la anterior dentro de la misma transacción que el OTP', async () => {
  const telefono='573009995555';db.asegurarUsuario(telefono);let codigo;let reloj=acceso.ahoraS()+10000;
  const abrir=async tokenAnterior=>{
    acceso.reiniciarLimites();reloj+=1000;
    await acceso.solicitarCodigo({telefono,ahora:reloj,enviar:async(_,t)=>{codigo=t.match(/\*(\d{6})\*/)[1];}});
    return acceso.verificarCodigo({telefono,codigo,ahora:reloj,tokenAnterior}).token;
  };
  const anterior=await abrir();assert.ok(acceso.validarSesion(anterior));const nueva=await abrir(anterior);
  assert.equal(acceso.validarSesion(anterior),null);assert.equal(acceso.validarSesion(nueva).telefono,telefono);
});

test('respaldos: checksum, corrupción, espacio insuficiente y rotación solo autorizada', () => {
  const antes = respaldos.respaldarAhora(process.env.DB_ARCHIVO,{ahora:new Date('2026-11-11T01:00:00Z'),conservar:1});
  const despues = respaldos.respaldarAhora(process.env.DB_ARCHIVO,{ahora:new Date('2026-11-11T02:00:00Z'),conservar:1});
  assert.ok(fs.existsSync(antes));assert.ok(fs.existsSync(despues));assert.ok(fs.existsSync(`${despues}.sha256`));
  assert.throws(()=>admin.comprobarEspacio(process.env.DB_ARCHIVO,path.join(temporal,'espacio.db'),{statfs:()=>({bavail:1n,bsize:1n})}),/Espacio insuficiente/);
  fs.writeFileSync(`${despues}.sha256`,'0'.repeat(64));
  assert.throws(()=>admin.restaurarRespaldo(despues,path.join(temporal,'rechazado.db')),/checksum/);
  assert.throws(()=>respaldos.respaldarAhora(process.env.DB_ARCHIVO,{ahora:new Date('2026-11-11T02:00:00Z')}),/checksum/);
  fs.writeFileSync(`${despues}.sha256`,admin.sumaArchivo(despues));
  respaldos.respaldarAhora(process.env.DB_ARCHIVO,{ahora:new Date('2026-11-11T03:00:00Z'),conservar:1,confirmarRotacion:true});
  assert.equal(fs.existsSync(antes),false);assert.equal(fs.existsSync(despues),false);
  const corrupta=path.join(temporal,'corrupta.db');fs.writeFileSync(corrupta,'corrupto');
  assert.throws(()=>admin.restaurarRespaldo(corrupta,path.join(temporal,'no-restaurar.db')));
});

test('respaldo cifrado local se restaura, detecta clave incorrecta y no deja destino parcial', async () => {
  const copia=path.join(temporal,'para-cifrar.db'),enc=path.join(temporal,'copia.enc'),restaurada=path.join(temporal,'restaurada.db');
  admin.crearRespaldo(process.env.DB_ARCHIVO,copia);
  await cifrado.cifrarRespaldo(copia,enc,'frase-ficticia-exclusiva-de-pruebas');
  await assert.rejects(cifrado.descifrarRespaldo(enc,restaurada,'frase-incorrecta-de-pruebas'));assert.equal(fs.existsSync(restaurada),false);
  await cifrado.descifrarRespaldo(enc,restaurada,'frase-ficticia-exclusiva-de-pruebas');assert.equal(admin.sumaArchivo(copia),admin.sumaArchivo(restaurada));
  await assert.rejects(cifrado.descifrarRespaldo(enc,restaurada,'frase-ficticia-exclusiva-de-pruebas'),/destino/);
});

test('recordatorio editado durante un envío no queda marcado como enviado en la nueva revisión', async () => {
  limpiar(); const ahora = new Date();
  const id = rec.crear({ usuario: U, texto: 'Horario original', vence: '2026-11-11' }, { hoy: '2026-11-11' }).id;
  outbox.encolar({ clave: 'revision:1', usuario: U, texto: 'Horario original', evento: { tipo: 'recordatorio', id, vence: '2026-11-11', hora: '09:00', revision: 1 }, ahora: ahora.getTime() });
  await outbox.despachar({ ahora, enviar: async () => { rec.editar(U,id,{ vence:'2026-11-12' },{ hoy:'2026-11-11' }); } });
  assert.equal(rec.obtener(U,id).estado,'pendiente'); assert.equal(rec.obtener(U,id).revision,2);
});

test('alertas respetan silencio y cupo tras reinicios sin perder el resto del grupo', async () => {
  limpiar(); const usuario='573009996666'; db.asegurarUsuario(usuario);
  const a=await import('./alertas.js');a.configurar(usuario,{max_diarias:1});
  const noche=new Date('2026-11-12T04:00:00Z');
  const avisos=[{tipo:'picos',clave:'pico:uno',texto:'Aviso uno'},{tipo:'picos',clave:'pico:dos',texto:'Aviso dos'}];
  const r=outbox.encolar({clave:'alerta:grupo',usuario,texto:'Dos avisos',evento:{tipo:'alerta',avisos,claves:avisos.map(x=>x.clave)},ahora:noche.getTime()});
  for(const x of avisos)db.base().prepare('INSERT INTO alertas_reservadas(usuario,clave,trabajo_id,dia) VALUES(?,?,?,?)').run(usuario,x.clave,r.id,'2026-11-11');
  let enviados=[];
  await outbox.despachar({ahora:noche,enviar:async(_,texto)=>enviados.push(texto)});assert.equal(enviados.length,0);
  assert.equal(db.base().prepare('SELECT intentos FROM trabajos WHERE id=?').get(r.id).intentos,0);
  await outbox.despachar({ahora:new Date('2026-11-12T14:00:00Z'),enviar:async(_,texto)=>enviados.push(texto)});assert.deepEqual(enviados,['Aviso uno']);
  await outbox.despachar({ahora:new Date('2026-11-13T14:00:00Z'),enviar:async(_,texto)=>enviados.push(texto)});assert.deepEqual(enviados,['Aviso uno','Aviso dos']);
  assert.equal(db.base().prepare('SELECT COUNT(*) AS n FROM alertas_enviadas WHERE usuario=?').get(usuario).n,2);
});

test('un fallo al reservar aviso recurrente revierte también el movimiento y la ejecución', async () => {
  limpiar(); const recu=await import('./recurrentes.js');const usuario='573009997777';db.asegurarUsuario(usuario);
  const r=recu.crear({usuario,tipo:'gasto',monto:1000,categoria:'Otros',frecuencia:'mensual',inicio:'2026-11-11'},{hoy:'2026-11-11'});
  db.base().exec(`CREATE TRIGGER fallo_aviso BEFORE INSERT ON trabajos WHEN NEW.usuario='${usuario}' BEGIN SELECT RAISE(ABORT,'outbox fallida'); END;`);
  try {
    assert.throws(()=>recu.ejecutarPendientes({hoy:'2026-11-11'}),/outbox fallida/);
    assert.equal(db.listarMovimientos({usuario}).length,0);
    assert.equal(db.base().prepare('SELECT COUNT(*) AS n FROM recurrentes_ejecuciones WHERE recurrente_id=?').get(r.id).n,0);
    assert.equal(recu.obtener(usuario,r.id).proxima,'2026-11-11');
  } finally { db.base().exec('DROP TRIGGER fallo_aviso'); }
});

test('la caducidad limpia cuerpos aunque el transporte esté desconectado', async () => {
  limpiar();const t=Date.now();agregar(U,{ahora:t-1000,vidaMs:100});
  const w=q.crearTrabajador({tipo:'entrada',habilitado:()=>false,procesar:()=>assert.fail('transporte deshabilitado')});
  try { w.despertar();const fila=db.base().prepare('SELECT estado,contenido FROM trabajos').get();assert.equal(fila.estado,'agotado');assert.equal(fila.contenido,null); }
  finally { await w.detener(); }
});

test('la carga cifrada está ligada a la cuenta, tipo y clave del trabajo', () => {
  limpiar();const r=agregar();const fila=db.base().prepare('SELECT * FROM trabajos WHERE id=?').get(r.id);
  assert.match(q.leerContenido(fila.contenido,fila),/dato personal/);
  assert.throws(()=>q.leerContenido(fila.contenido,{...fila,usuario:B}),/descifrar/);
});

test('codec real de Baileys conserva texto, timestamp y claves multimedia sin duplicar datos de terceros', async () => {
  const {codificarMensaje,decodificarMensaje}=await import('./codec-mensajes.js');
  const original={key:{id:'mensaje-codec',remoteJid:`${U}@s.whatsapp.net`,fromMe:false},pushName:'Nombre privado',messageTimestamp:1794400000,message:{extendedTextMessage:{text:'/gasto 100 otros',contextInfo:{quotedMessage:{conversation:'Texto de otra persona'}}}}};
  const recibido=decodificarMensaje(codificarMensaje(original));
  assert.equal(recibido.message.extendedTextMessage.text,'/gasto 100 otros');
  assert.equal(Number(recibido.messageTimestamp),1794400000);assert.equal(recibido.pushName,null);assert.equal(recibido.message.extendedTextMessage.contextInfo,null);
  const media={...original,message:{audioMessage:{url:'https://example.invalid/audio',mediaKey:Buffer.alloc(32,1),fileSha256:Buffer.alloc(32,2),mimetype:'audio/ogg',seconds:10}}};
  const audio=decodificarMensaje(codificarMensaje(media)).message.audioMessage;
  assert.deepEqual(Buffer.from(audio.mediaKey),Buffer.alloc(32,1));assert.equal(audio.seconds,10);
});

test('diagnóstico de solo lectura informa estados sin exponer cuerpos ni datos de cuentas', async () => {
  const {estadoArchivo}=await import('./estado.js');
  const r=estadoArchivo(process.env.DB_ARCHIVO);assert.equal(r.integridad,'ok');assert.equal(r.version,8);
  assert.ok(Number(r.espacioLibreBytes)>0);
  assert.ok(!JSON.stringify(r).includes(U));assert.ok(!JSON.stringify(r).includes('dato personal'));
  assert.throws(()=>estadoArchivo(path.join(temporal,'no-existe.db')),/debe existir/);
});

test('el alta no descarta el primer audio, recibo o movimiento con montos escritos en palabras', async () => {
  const {esSaludoInicial}=await import('./codec-mensajes.js');
  assert.equal(esSaludoInicial('Hola!'),true);assert.equal(esSaludoInicial('Buenos días'),true);
  for(const texto of ['', '/gasto 100 otros', 'me pagaron cien mil', 'compré arroz'])assert.equal(esSaludoInicial(texto),false);
});

test('una rotación autorizada no elimina copias sin manifiesto automático, aunque coincida el patrón', () => {
  const directorio=respaldos.carpetaRespaldos(process.env.DB_ARCHIVO);
  const propia=respaldos.respaldarAhora(process.env.DB_ARCHIVO,{ahora:new Date('2026-11-14T01:00:00Z')});
  const manual=propia.replace('2026-11-14T01','2020-01-01T01');
  admin.crearRespaldo(process.env.DB_ARCHIVO,manual);
  respaldos.respaldarAhora(process.env.DB_ARCHIVO,{ahora:new Date('2026-11-14T02:00:00Z'),conservar:1,confirmarRotacion:true});
  assert.ok(fs.existsSync(manual));assert.ok(fs.existsSync(directorio));
});

test('un transporte que no responde no retiene indefinidamente el procesamiento', async () => {
  const {enviarConTiempo}=await import('./recursos.js');
  await assert.rejects(enviarConTiempo(()=>new Promise(()=>{}),20),/Tiempo de envío/);
  assert.equal(await enviarConTiempo(async()=>42,20),42);
});

test('reservas terminales se liberan y la misma alerta obtiene un trabajo nuevo', async () => {
  const a = await import('./alertas.js');
  const programador = await import('./programador.js');
  const usuario = '573009998881'; db.asegurarUsuario(usuario);
  a.configurar(usuario, { silencio_desde: '00:00', silencio_hasta: '00:00' });
  db.fijarPresupuesto(usuario, 'Comida', 1000);
  db.agregarMovimiento({ usuario, tipo: 'gasto', monto: 900, categoria: 'Comida', fecha: '2026-11-11' });
  const ahora = new Date('2026-11-11T16:00:00Z');
  for (const causa of ['expira', 'intentos', 'lease', 'cancelado']) {
    limpiar(); programador._reiniciar();
    const p = a.pendientes(usuario, ahora); assert.ok(p);
    const r = outbox.encolar({ clave: `alerta:${usuario}:${p.claves.join('|')}`, usuario, texto: p.texto, ahora: ahora.getTime() - 1000 });
    for (const clave of p.claves) db.base().prepare('INSERT INTO alertas_reservadas VALUES (?,?,?,?)').run(usuario, clave, r.id, '2026-11-11');
    if (causa === 'expira') {
      db.base().prepare('UPDATE trabajos SET expira=? WHERE id=?').run(ahora.getTime()-1,r.id);
      q.purgarVencidos(ahora.getTime());
    } else if (causa === 'cancelado') q.cancelar(db.base().prepare('SELECT clave FROM trabajos WHERE id=?').get(r.id).clave);
    else {
      const t = q.reclamar('salida', { ahora: ahora.getTime()-500, leaseMs: 100 });
      if (causa === 'intentos') q.fallar(t, { ahora: ahora.getTime()-499, maxIntentos: 1 });
      else { db.base().prepare('UPDATE trabajos SET intentos=20 WHERE id=?').run(t.id); q.reclamar('salida', { ahora: ahora.getTime() }); }
    }
    assert.ok(a.pendientes(usuario, ahora), causa);
    await programador.ciclo({ ahora, enviar: async () => { throw new Error('sin transporte'); } });
    const reserva = db.base().prepare('SELECT trabajo_id FROM alertas_reservadas WHERE usuario=?').get(usuario);
    assert.ok(reserva); assert.notEqual(reserva.trabajo_id,r.id);
  }
});

for (const ruta of ['audio', 'imagen']) test(`${ruta}: caída entre marca y outbox revierte todo; después del commit reentrega segura`, async () => {
  limpiar();
  const { completarMedia } = await import('./respuesta-media.js');
  const ctx = await import('./contexto.js');
  const mensajeId = `caida-${ruta}`;
  const datos = { usuario: U, jid: `${U}@s.whatsapp.net`, mensajeId, texto: 'Respuesta multimedia', cambios: { pendiente: { origen: ruta, items: [{ monto: 100 }] } } };
  ctx.borrar(U);
  const script = `const db=await import('./db.js'); const {completarMedia}=await import('./respuesta-media.js');
    db.basePersistente().function('simular_caida',()=>process.exit(73));
    db.basePersistente().exec("CREATE TRIGGER caida_media BEFORE INSERT ON trabajos BEGIN SELECT simular_caida(); END;");
    completarMedia(${JSON.stringify(datos)});`;
  try {
    await assert.rejects(exec(process.execPath,['--input-type=module','-e',script],{cwd:import.meta.dirname,env:{...process.env}}), error => error.code === 73);
  } finally { db.basePersistente().exec('DROP TRIGGER IF EXISTS caida_media'); }
  assert.equal(db.yaProcesadoDe(U,mensajeId),false);
  assert.deepEqual(ctx.obtener(U),{});
  assert.equal(completarMedia(datos),true);
  // Caída antes de finalizar el trabajo de entrada: la reentrega no reemplaza contexto ni respuesta.
  assert.equal(completarMedia(datos),false);
  assert.equal(db.basePersistente().prepare('SELECT COUNT(*) AS n FROM trabajos WHERE clave=?').get(`respuesta:${U}:${mensajeId}`).n,1);
  assert.equal(ctx.obtener(U).pendiente.origen,ruta);
  assert.equal(db.yaProcesadoDe(U,mensajeId),true);
});

test('retención elimina terminales antiguos, conserva activos, finanzas e idempotencia tras reinicio', async () => {
  limpiar(); const ahora = Date.now();
  const finanzas = await import('./finanzas.js');
  const snapshot = () => JSON.stringify({ movimientos: db.listarMovimientos({ usuario: U }), caja: finanzas.caja(U,'2026-12-31'), operativo: finanzas.operativo(U,'2026-01-01','2026-12-31'), deudas: finanzas.deudas(U), prestamos: finanzas.prestamos(U) });
  const antes = snapshot();
  for (const estado of ['hecho','agotado','cancelado','pendiente','procesando']) {
    const r=agregar(U,{ ahora: ahora - 40 * 86400_000, vidaMs: 100 });
    db.base().prepare('UPDATE trabajos SET estado=?, contenido=NULL WHERE id=?').run(estado,r.id);
  }
  const claves=db.base().prepare("SELECT clave FROM trabajos WHERE estado IN ('hecho','agotado','cancelado')").all();
  assert.equal(q.retenerTerminales(ahora),3);
  assert.equal(db.base().prepare('SELECT COUNT(*) AS n FROM trabajos').get().n,2);
  assert.equal(q.retenerTerminales(ahora),0);
  for(const {clave} of claves) assert.equal(q.admitir({clave,usuario:U,tipo:'entrada',contenido:'duplicado'}).duplicado,true);
  const script = `const q=await import('./trabajos.js'); const d=await import('./db.js'); console.log(JSON.stringify(q.admitir({clave:${JSON.stringify(claves[0].clave)},usuario:'${U}',tipo:'entrada',contenido:'duplicado'})));d.cerrarBase();`;
  const r=await exec(process.execPath,['--input-type=module','-e',script],{cwd:import.meta.dirname,env:{...process.env}});
  assert.equal(JSON.parse(r.stdout.trim()).duplicado,true);
  assert.equal(snapshot(),antes);
  assert.ok(!JSON.stringify(db.base().prepare('SELECT * FROM trabajos_huellas').all()).includes(U));
});

test('el borrado autorizado elimina también las huellas retenidas de esa cuenta', () => {
  limpiar(); const usuario='573009998882'; db.asegurarUsuario(usuario);
  const r=agregar(usuario,{ahora:Date.now()-40*86400_000,vidaMs:1});
  db.base().prepare("UPDATE trabajos SET estado='hecho', contenido=NULL WHERE id=?").run(r.id);
  q.retenerTerminales();
  const plan=privacidad.prepararEliminacion(db.base(),usuario);
  assert.equal(plan.filas.trabajos_huellas,1);
  privacidad.eliminarCuenta(db.base(),{usuario,confirmacion:plan.confirmacion,botDetenido:true,autorizacionTitular:true});
  // La eliminación del titular libera deliberadamente también su deduplicación.
  assert.equal(q.admitir({clave:`entrada:prueba:${seq}`,usuario,tipo:'entrada',contenido:'nuevo'}).duplicado,undefined);
});
