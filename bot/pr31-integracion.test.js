import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const temporal = fs.mkdtempSync(path.join(os.tmpdir(), 'finbot-integracion31-'));
process.env.DB_ARCHIVO = path.join(temporal, 'prueba.db');
const db = await import('./db.js');
const contexto = await import('./contexto.js');
const { interpretarComando } = await import('./comandos.js');
const { textoDiagnostico } = await import('./diagnostico.js');
const A = '573007001111', B = '573007002222';
db.asegurarUsuario(A); db.asegurarUsuario(B);
after(() => { db.cerrarBase(); fs.rmSync(temporal, { recursive: true, force: true }); });

test('diagnóstico accesible con /diagnostico y /estado sin detalles de otras cuentas', () => {
  assert.equal(interpretarComando('/diagnostico').acciones[0].nombre, 'ver_diagnostico');
  assert.equal(interpretarComando('/estado').acciones[0].nombre, 'ver_diagnostico');
  db.sumarUso(A, '2026-11-14', { mensajes: 2, ia: 1 });
  db.sumarUso(B, '2026-11-14', { mensajes: 19, ia: 10 });
  const salida = textoDiagnostico(A, new Date('2026-11-14T16:00:00Z'));
  assert.match(salida, /Mensajes de hoy: 2/);
  assert.match(salida, /Solicitudes de IA hoy: 1/);
  assert.ok(!salida.includes(A) && !salida.includes(B));
  assert.ok(!salida.includes('19/') && !salida.includes('10/'));
  assert.ok(!salida.includes(process.env.DB_ARCHIVO));
});

test('confirmaciones vencen a los 10 minutos aunque el contexto general siga vigente', () => {
  const t = 2_000_000_000_000;
  contexto.guardar(A, { pendiente: { origen: 'imagen', items: [] } }, t);
  contexto.guardar(A, { ultimo: { id: 12 } }, t + 5 * 60_000);
  assert.ok(contexto.obtener(A, t + 9 * 60_000).pendiente);
  const c = contexto.obtener(A, t + 11 * 60_000);
  assert.equal(c.pendiente, undefined);
  assert.deepEqual(c.ultimo, { id: 12 });
});
