import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import ts from 'typescript'

test('el análisis de tipos detecta un importe con tipo incorrecto', () => {
  const carpeta=mkdtempSync(path.join(tmpdir(),'finbot-tipos-'))
  try {
    const archivo=path.join(carpeta,'importe.ts');writeFileSync(archivo,'const importe: number = "incorrecto";\n')
    const p=ts.createProgram([archivo],{noEmit:true,skipLibCheck:true,types:[],strict:true})
    assert.ok(ts.getPreEmitDiagnostics(p).some(d=>d.code===2322))
  } finally { rmSync(carpeta,{recursive:true,force:true}) }
})
test('ESLint rechaza una regresión real de variable sin usar', () => {
  const r=spawnSync(process.execPath,['node_modules/eslint/bin/eslint.js','--stdin','--stdin-filename','app/regresion.ts'],{input:'const importeSinUsar = 1;\n',encoding:'utf8'})
  assert.equal(r.status,1)
  assert.match(r.stdout,/@typescript-eslint\/no-unused-vars/)
})
