import { readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
let fallo = false
for (const archivo of readdirSync('bot').filter(n => n.endsWith('.js'))) {
  const r = spawnSync(process.execPath, ['--check', `bot/${archivo}`], { encoding: 'utf8' })
  if (r.status !== 0) { process.stderr.write(r.stderr); fallo = true }
}
if (fallo) process.exitCode = 1
else console.log('Sintaxis del bot verificada sin ejecutar servicios ni abrir bases.')
