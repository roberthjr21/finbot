// Harness de UI local aislada. No usar como servidor real ni publicar este puerto.
import { fork, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
const carpeta=mkdtempSync(path.join(tmpdir(),'finbot-ui-'))
const token='token-ficticio-exclusivo-ui-local-123456'
const bot=fork(new URL('./bot-fixture.mjs',import.meta.url),{env:{...process.env,FINBOT_VISTA_LOCAL:'1',NODE_ENV:'production',DB_ARCHIVO:path.join(carpeta,'test.db'),API_TOKEN:token,SECRETO_SESION:'secreto-ficticio-ui-independiente-123456'},stdio:['ignore','ignore','pipe','ipc']})
const [m]=await once(bot,'message');const api=`http://127.0.0.1:${m.puerto}`
const reserva=createServer();reserva.listen(0,'127.0.0.1');await once(reserva,'listening');const puerto=reserva.address().port;await new Promise(r=>reserva.close(r))
const base=`http://127.0.0.1:${puerto}`
const web=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(puerto)],{cwd:path.resolve(import.meta.dirname,'..'),env:{...process.env,NODE_ENV:'production',VERCEL:'0',BOT_API_URL:api,BOT_API_TOKEN:token,WEB_ORIGEN:base},stdio:['ignore','ignore','pipe']})
console.log(JSON.stringify({base,soloPruebas:true}))
let cerrando=false
async function cerrar(){if(cerrando)return;cerrando=true;for(const p of [web,bot]){if(p.exitCode===null){p.kill('SIGTERM');await once(p,'exit')}}rmSync(carpeta,{recursive:true,force:true});process.exit(0)}
process.once('SIGTERM',cerrar);process.once('SIGINT',cerrar)
