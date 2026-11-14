import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
const root = createRequire(import.meta.url)
const estree = createRequire(createRequire(root.resolve('typescript-eslint')).resolve('@typescript-eslint/typescript-estree'))
const { minimatch } = estree('minimatch')
test('minimatch corregido conserva el contrato utilizado por typescript-estree', () => {
  assert.equal(estree('minimatch/package.json').version, '11.0.1')
  const casos = JSON.parse(readFileSync(new URL('./tests/minimatch-casos.json', import.meta.url)))
  for (const { file, pattern, esperado } of casos) assert.equal(minimatch(file, pattern, { dot: true }), esperado, `${file} / ${pattern}`)
})
