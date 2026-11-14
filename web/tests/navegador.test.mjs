import test from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import path from 'node:path'

test('navegador: móvil, foco, teclado, doble envío y CRUD con SQLite temporal', { timeout: 90000 }, async () => {
  const servicio=spawn(process.execPath,['tests/preview-local.mjs'],{cwd:path.resolve(import.meta.dirname,'..'),stdio:['ignore','pipe','pipe']})
  let browser, detalles=''
  servicio.stderr.on('data',d=>{detalles+=d})
  try {
    const base=await new Promise((resolve,reject)=>{
      let salida=''
      servicio.stdout.on('data',d=>{salida+=d;const linea=salida.split('\n')[0];try{resolve(JSON.parse(linea).base)}catch{/* espera la línea completa */}})
      servicio.once('error',reject);servicio.once('exit',code=>reject(new Error(`Harness terminó ${code}: ${detalles}`)))
    })
    let listo=false
    for(let i=0;i<100;i++){
      try{if((await fetch(`${base}/login`)).ok){listo=true;break}}catch{/* arrancando */}
      await new Promise(r=>setTimeout(r,100))
    }
    assert.ok(listo,detalles)
    browser=await chromium.launch()
    const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'})
    const page=await context.newPage();const errores=[];page.on('pageerror',e=>errores.push(e.message))
    await page.goto(`${base}/login`)
    await page.getByRole('heading',{name:'Entra a tus finanzas'}).waitFor()
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false)
    assert.equal(await page.locator('script[src*="/_vercel/insights"]').count(),0)
    let solicitudes=0
    await page.route('**/api/auth/solicitar',async r=>{solicitudes++;await new Promise(x=>setTimeout(x,200));await r.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'})})
    await page.getByLabel('Tu número de WhatsApp').fill('573000001111')
    await page.getByRole('button',{name:'Enviarme el código'}).click()
    assert.equal(await page.getByRole('button',{name:'Enviando…'}).isDisabled(),true)
    await page.locator('form').evaluate(f=>f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})))
    await page.getByLabel('Código de 6 dígitos').waitFor()
    await page.waitForFunction(()=>document.activeElement?.id==='codigo')
    assert.equal(solicitudes,1)
    let verificaciones=0
    await page.route('**/api/auth/verificar',async r=>{verificaciones++;await new Promise(x=>setTimeout(x,200));await r.fulfill({status:401,contentType:'application/json',body:'{"ok":false}'})})
    await page.getByLabel('Código de 6 dígitos').fill('123456')
    await page.getByRole('button',{name:'Entrar',exact:true}).click()
    assert.equal(await page.getByRole('button',{name:'Usar otro número o pedir otro código'}).isDisabled(),true)
    await page.getByRole('status').filter({hasText:'incorrecto'}).waitFor()
    assert.equal(verificaciones,1)
    await page.unrouteAll({behavior:'wait'})
    // Esta sesión existe solo en la fixture; el login real se comprueba en integración HTTP.
    await context.addCookies([{name:'finbot_sesion',value:'t'.repeat(43),url:base,httpOnly:true,sameSite:'Lax',secure:false}])
    await page.goto(`${base}/`)
    await page.getByRole('heading',{name:'Resumen financiero',exact:true}).waitFor()
    await page.keyboard.press('Tab')
    assert.match(await page.evaluate(()=>document.activeElement?.textContent),/Saltar/)
    await page.keyboard.press('Enter')
    assert.equal(await page.evaluate(()=>document.activeElement?.id),'contenido-principal')
    const menu=page.getByRole('checkbox',{name:'Abrir o cerrar el menú de navegación'})
    await menu.focus();await page.keyboard.press('Space');assert.equal(await menu.isChecked(),true);await page.keyboard.press('Space')
    await page.goto(`${base}/movimientos/nuevo`)
    await page.locator('[name=monto]').fill('25000');await page.locator('[name=categoria]').selectOption('Otros')
    await page.locator('[name=fecha]').fill('2026-11-11');await page.locator('[name=descripcion]').fill('Prueba UI aislada')
    let envios=0;page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/api/movimientos/crear'))envios++})
    await page.locator('form.form-card').evaluate(f=>{f.requestSubmit();f.requestSubmit()})
    await page.waitForURL(/aviso=creado/);assert.equal(envios,1)
    await page.getByRole('link',{name:'Prueba UI aislada',exact:true}).click()
    await page.locator('[name=monto]').fill('30000');await page.getByRole('button',{name:'Guardar cambios',exact:true}).click()
    await page.waitForURL(/aviso=editado/)
    await page.getByRole('link',{name:'Prueba UI aislada',exact:true}).click()
    await page.getByRole('checkbox',{name:'Sí, quiero borrar este movimiento'}).check()
    await page.getByRole('button',{name:'Borrar',exact:true}).click();await page.waitForURL(/aviso=eliminado/)
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false)
    await page.setViewportSize({width:1280,height:800})
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false)
    assert.deepEqual(errores,[])
  } finally {
    await browser?.close()
    if(servicio.exitCode===null){servicio.kill('SIGTERM');await once(servicio,'exit')}
  }
})
