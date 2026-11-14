#!/usr/bin/env node
// Administración offline. No importa db.js: nunca abre por accidente la base predeterminada.
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { comprobarEspacio } from './db-admin.js';

const TABLAS = ['movimientos','presupuestos','deudas','prestamos','recordatorios','recurrentes','metas_aportes','metas','alertas_config','alertas_enviadas','alertas_reservadas','contexto','preferencias','uso_diario','auditoria','trabajos','entrada_modos'];
const hash = v => createHash('sha256').update(v).digest('hex');
function filas(b, usuario) {
  const resultado = {};
  for (const t of TABLAS) resultado[t] = b.prepare(`SELECT * FROM ${t} WHERE usuario = ? ORDER BY rowid`).all(usuario);
  resultado.trabajos_huellas = b.prepare('SELECT * FROM trabajos_huellas WHERE usuario_hash = ? ORDER BY huella').all(hash(usuario));
  resultado.usuarios = b.prepare('SELECT * FROM usuarios WHERE telefono = ?').all(usuario);
  for (const t of ['sesiones_web','codigos_login']) resultado[t] = b.prepare(`SELECT * FROM ${t} WHERE usuario_id IN (SELECT id FROM usuarios WHERE telefono = ?) ORDER BY id`).all(usuario);
  resultado.procesados = b.prepare("SELECT * FROM procesados WHERE id LIKE ? OR id LIKE ? OR id LIKE ? ORDER BY id").all(`${usuario}:%`, `media:${usuario}:%`, `web:${usuario}:%`);
  resultado.recurrentes_ejecuciones = b.prepare('SELECT * FROM recurrentes_ejecuciones WHERE recurrente_id IN (SELECT id FROM recurrentes WHERE usuario = ?) ORDER BY recurrente_id, fecha').all(usuario);
  return resultado;
}
const huella = (b, usuario) => hash(JSON.stringify(filas(b, usuario)));
export function prepararEliminacion(b, usuario, ahora = Date.now()) {
  if (b.prepare('SELECT MAX(version) AS v FROM schema_migraciones').get().v !== 8) throw new Error('Versión de esquema no auditada para eliminación');
  if (!/^\d{8,15}$/.test(usuario) || !b.prepare('SELECT 1 FROM usuarios WHERE telefono = ?').get(usuario)) throw new Error('Cuenta no encontrada');
  b.exec('BEGIN IMMEDIATE');
  try {
    const nonce = randomBytes(18).toString('hex');
    const datos = filas(b, usuario);
    b.prepare('INSERT INTO privacidad_solicitudes (usuario, nonce_hash, huella, expira) VALUES (?, ?, ?, ?) ON CONFLICT(usuario) DO UPDATE SET nonce_hash=excluded.nonce_hash, huella=excluded.huella, expira=excluded.expira')
      .run(usuario, hash(nonce), hash(JSON.stringify(datos)), ahora + 600000);
    b.exec('COMMIT');
    return { usuario, confirmacion: `ELIMINAR CUENTA ${usuario} ${nonce}`, expira: ahora + 600000, filas: Object.fromEntries(Object.entries(datos).map(([k,v]) => [k,v.length])), aviso: 'No elimina copias de seguridad, archivos externos ni datos en WhatsApp. Requiere bot detenido y autorización del titular.' };
  } catch (e) { b.exec('ROLLBACK'); throw e; }
}
export function eliminarCuenta(b, { usuario, confirmacion, botDetenido = false, autorizacionTitular = false, ahora = Date.now() }) {
  if (!botDetenido || !autorizacionTitular) throw new Error('Se requiere bot detenido y autorización expresa del titular');
  const partes = String(confirmacion).match(/^ELIMINAR CUENTA (\d{8,15}) ([a-f0-9]{36})$/);
  if (!partes || partes[1] !== usuario) throw new Error('Confirmación no válida');
  const archivo = b.prepare('PRAGMA database_list').all().find(r => r.name === 'main')?.file;
  if (archivo) comprobarEspacio(archivo, archivo);
  b.exec('PRAGMA busy_timeout=5000; PRAGMA secure_delete=ON; BEGIN IMMEDIATE');
  try {
    const solicitud = b.prepare('SELECT * FROM privacidad_solicitudes WHERE usuario = ?').get(usuario);
    if (!solicitud || solicitud.expira <= ahora || !timingSafeEqual(Buffer.from(hash(partes[2])), Buffer.from(solicitud.nonce_hash))) throw new Error('Confirmación vencida o no válida');
    if (solicitud.huella !== huella(b, usuario)) throw new Error('Los datos cambiaron: prepara otra solicitud');
    if (b.prepare("SELECT 1 FROM trabajos WHERE usuario = ? AND estado = 'procesando' AND lease_hasta > ?").get(usuario, ahora)) throw new Error('La cuenta aún tiene trabajos activos');
    for (const t of ['sesiones_web','codigos_login']) b.prepare(`DELETE FROM ${t} WHERE usuario_id IN (SELECT id FROM usuarios WHERE telefono = ?)`).run(usuario);
    b.prepare('DELETE FROM recurrentes_ejecuciones WHERE recurrente_id IN (SELECT id FROM recurrentes WHERE usuario = ?)').run(usuario);
    // Triggers crean snapshots al borrar; auditoria se elimina AL FINAL de la transacción.
    for (const t of TABLAS.filter(t => t !== 'auditoria')) b.prepare(`DELETE FROM ${t} WHERE usuario = ?`).run(usuario);
    b.prepare('DELETE FROM trabajos_huellas WHERE usuario_hash = ?').run(hash(usuario));
    b.prepare('DELETE FROM auditoria WHERE usuario = ?').run(usuario);
    b.prepare("DELETE FROM procesados WHERE id LIKE ? OR id LIKE ? OR id LIKE ?").run(`${usuario}:%`, `media:${usuario}:%`, `web:${usuario}:%`);
    b.prepare('DELETE FROM limites_intentos WHERE clave = ?').run(hash(usuario));
    b.prepare('DELETE FROM privacidad_solicitudes WHERE usuario = ?').run(usuario);
    b.prepare('DELETE FROM usuarios WHERE telefono = ?').run(usuario);
    if (Object.values(filas(b, usuario)).some(v => v.length)) throw new Error('La verificación de eliminación falló');
    b.exec('COMMIT');
  } catch (e) { b.exec('ROLLBACK'); throw e; }
  // Una lectura externa puede impedir truncar WAL. Se informa sin fingir borrado físico.
  let compactado = false;
  try { b.exec('VACUUM'); compactado = true; } catch { /* la eliminación lógica ya se confirmó; informar mantenimiento pendiente */ }
  const checkpoint = b.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
  return { eliminacionLogica: true, compactado, walTruncado: checkpoint.busy === 0, verificacion: b.prepare('PRAGMA integrity_check').get().integrity_check, copiasExternas: 'pendientes de revisión y confirmación separada' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [accion, archivo, usuario, ...opciones] = process.argv.slice(2);
  let b;
  try {
    if (!['preparar','eliminar'].includes(accion) || !archivo || !fs.existsSync(archivo)) throw new Error('Uso: node privacidad-admin.js preparar|eliminar <base existente> <teléfono> [--bot-detenido --titular-autoriza --confirmacion=...]');
    b = new DatabaseSync(archivo);
    const resultado = accion === 'preparar' ? prepararEliminacion(b, usuario) : eliminarCuenta(b, { usuario, botDetenido: opciones.includes('--bot-detenido'), autorizacionTitular: opciones.includes('--titular-autoriza'), confirmacion: opciones.find(x => x.startsWith('--confirmacion='))?.slice(15) });
    console.log(JSON.stringify(resultado, null, 2));
  } catch (e) { console.error(e.message); process.exitCode = 1; }
  finally { b?.close(); }
}
