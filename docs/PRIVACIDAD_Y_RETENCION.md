# Privacidad, retención y eliminación

Esta es una política técnica explícita. No añade una obligación legal de conservar información ni sustituye la política que comunique el administrador a los titulares. No se ejecutó ninguna eliminación sobre datos reales durante la auditoría.

## Tres operaciones diferentes

- `/deshacer` y `/borrar ...`: corrigen o eliminan **registros activos**, con confirmación. La auditoría mantiene cifras e historial de cambios, la cuenta y las sesiones siguen existiendo. `/borrar todo` cancela también notificaciones pendientes; no elimina auditorías, la cuenta ni los respaldos. El aviso previo y `/privacidad` lo explican.
- Eliminación definitiva de cuenta: herramienta **offline** `privacidad-admin.js`, con autorización del titular verificada por el administrador, confirmación de un solo uso, vencimiento a diez minutos y comprobación de que el contenido no cambió. El acceso al equipo y la autorización humana son controles necesarios: el CLI no verifica por sí solo la identidad del titular.
- Respaldos y archivos externos: se revisan aparte. Ningún comando de cuenta elimina automáticamente una copia de seguridad o mensajes almacenados en WhatsApp.

## Qué se retiene y hasta cuándo

| Datos | Retención y eliminación |
|---|---|
| Movimientos, deudas, préstamos, metas y presupuestos | Hasta el borrado confirmado por su titular. Ningún mantenimiento borra importes automáticamente. |
| Auditorías históricas del PR #30 | Se conservan sin reescribir ni depurar automáticamente; pueden contener nombres y descripciones. Se eliminan para una cuenta únicamente con su eliminación definitiva confirmada. |
| Auditorías nuevas | Conservan identificación de cuenta y cifras, tipo, categoría, fecha y antes/después; omiten nombres, descripciones libres, teléfono repetido en el detalle e IDs de mensajes. Se retienen hasta la eliminación confirmada de cuenta. No hay una purga financiera automática por antigüedad. |
| Entrada de WhatsApp aceptada | Cuerpo cifrado en producción hasta completarse o hasta 72 h. Se borra el cuerpo al terminar, agotar cinco intentos o caducar. La caducidad se aplica mientras el proceso está activo y al reanudarlo; un proceso apagado no puede limpiar disco. |
| Outbox de respuestas/avisos | Cuerpo cifrado hasta enviarse, cancelarse, agotar veinte intentos o caducar a los siete días. Una desconexión conocida o espera por silencio/cupo no consume intentos. |
| Trabajos terminales | Se eliminan en lotes de hasta 500 por mantenimiento al superar 30 días desde su fecha de caducidad. No se eliminan trabajos pendientes ni procesando mediante esta retención. Antes de borrar se reconcilian las reservas de alertas. |
| Huellas de trabajos eliminados | SHA-256 de la clave y de la cuenta, sin cuerpo, teléfono en claro, fechas ni estado. Se conservan hasta la eliminación autorizada de cuenta para impedir replays incluso tras reiniciar. Son seudónimos, no anonimización: el registro mínimo crece con las claves únicas; borrarlo por antigüedad perdería la garantía de idempotencia. Inserción de huella y eliminación del trabajo son una transacción. |
| Mensajes procesados | Se conservan para impedir replays, sin el cuerpo. Pueden seguir vinculados al teléfono y se eliminan junto a la cuenta. |
| Solicitud administrativa de eliminación | Confirmación válida diez minutos; los metadatos vencidos se eliminan en el siguiente ciclo del programador o al eliminar la cuenta. |
| Preferencias y uso diario | Se conservan por cuenta hasta su eliminación confirmada. No se confunden con auditoría financiera. |
| Contexto de conversación | Vence a los 30 minutos por defecto. Se purga en el siguiente ciclo activo; no se guardan imágenes ni audio descargados en disco. |
| OTP y sesiones | Código válido cinco minutos y sesión siete días. Se almacenan hashes, no códigos/tokens en claro. El programador limpia códigos vencidos hace más de un día y sesiones vencidas hace más de un día o revocadas. Mientras el bot está apagado, las filas permanecen, pero no recuperan validez. |
| Límites de acceso | Ventanas de hasta una hora; las filas vencidas se purgan por lotes en intentos posteriores. No contienen teléfono/IP en claro; no son una prueba de anonimización irreversible. |
| Respaldos automáticos y previos a migración | Sin eliminación automática por defecto. `RESPALDO_ROTAR=1` es una autorización administrativa explícita de rotación para copias de la misma familia; conserva `RESPALDO_CONSERVAR` (7 por defecto). Las copias antiguas sin familia, manuales y previas a migraciones no se rotan mediante esa regla. |
| Logs | Esta aplicación no configura la retención de journald, contenedores, Vercel ni archivos del sistema. El administrador debe definirla, revisar logs heredados y no registrar contenido de mensajes, tokens o datos personales. Los errores nuevos de la cola solo indican tipo, ID e intento. |

El cifrado de la cola usa AES-256-GCM, nonce aleatorio y vinculación autenticada a cuenta/tipo/clave. Configurar `COLA_SECRETO` de 32+ caracteres independientes es preferible; si falta se usa `SECRETO_SESION`. En desarrollo sin secretos puede almacenarse texto en SQLite: usar solo datos ficticios. El cifrado no oculta los metadatos de cuenta ni cifra toda la base financiera.

## Procedimiento de eliminación definitiva

1. Verificar la solicitud expresa del titular y registrar su autorización fuera de los logs técnicos. Revisar que no se trate de corregir un movimiento.
2. Detener el bot, el programador y procesos que usen la base. Identificar la ruta y el número correctos. No hacer automáticamente un nuevo respaldo del titular justo antes de eliminarlo: eso conservaría otra copia.
3. Ejecutar sobre la base existente:

   ```sh
   node privacidad-admin.js preparar /ruta/finanzas.db TELEFONO
   ```

   Se muestran cantidades por tabla y la frase exacta que debe confirmar el administrador. No se eliminan registros financieros. La preparación escribe solo la solicitud temporal.
4. Revisar las cantidades y repetir la frase exacta recibida, entre comillas:

   ```sh
   node privacidad-admin.js eliminar /ruta/finanzas.db TELEFONO --bot-detenido --titular-autoriza --confirmacion="FRASE EXACTA RECIBIDA"
   ```

   El CLI rechaza cuenta equivocada, ausencia de autorización, vencimiento, modificación de datos o trabajos activos. La operación transaccional elimina datos de esa cuenta, sesiones, OTP, preferencias, colas, contexto y auditorías **después** de los triggers de eliminación. No toca filas de otros usuarios.
5. Revisar `eliminacionLogica`, `compactado`, `walTruncado` e `integrity_check`. Se activa `secure_delete`, se intenta `VACUUM` y se trunca WAL. Si no se puede compactar/truncar por otra conexión, la eliminación lógica ya ocurrió: mantener el servicio detenido y completar el mantenimiento antes de afirmar que desaparecieron restos SQLite.
6. Revisar cada copia anterior, snapshot, exportación, archivo de soporte y log. Eliminar una copia completa puede afectar a otros titulares: necesita aprobación administrativa separada. Una alternativa es restaurar a una ruta privada nueva, aplicar la eliminación autorizada, verificar el resto de cuentas y generar una copia/cifrado/checksum nuevos; no modificar la copia antigua silenciosamente.
7. Mantener un registro administrativo restringido de qué copias requieren saneamiento. Antes de restaurar una copia antigua a servicio, volver a aplicar eliminaciones autorizadas y revocaciones posteriores; rotar sesiones/secretos según el incidente. No reabrir servicio con datos de una cuenta que pidió eliminación.
8. Bloquear el número en la configuración si el titular no desea una cuenta nueva; con registro abierto un mensaje nuevo puede crear otra cuenta vacía. El comando no puede borrar datos de conversaciones de otra persona ni de WhatsApp.

`secure_delete` y `VACUUM` reducen restos dentro de SQLite, pero no garantizan borrado forense de SSD, sistemas con snapshots, copias externas o medios compartidos. Los WAL y lectores activos importan. Usar cifrado de disco, directorios privados y políticas de copias es necesario. Referencia: [SQLite PRAGMA secure_delete](https://www.sqlite.org/pragma.html#pragma_secure_delete).

## Metadatos de fiabilidad de fase 3

`entrada_modos` conserva por cuenta la proyección real/prueba y una sesión opaca, hasta la eliminación autorizada de la cuenta. No conserva mensajes ni cifras. La herramienta offline contempla esta tabla y verifica el esquema v9 antes de preparar una eliminación.

Los trabajos de análisis usan la misma retención/cifrado de entradas: instantánea de cifras y categorías sin descripciones libres, hasta completar, cancelar, agotar reintentos o caducar (72 horas por defecto). Su respuesta reservada usa la retención de la outbox (7 días). Los metadatos de modo de los trabajos siguen su retención terminal y posterior minimización en huellas. El reinicio elimina los cuerpos de pruebas no recuperables, no los convierte en operaciones reales ni altera movimientos históricos. El mantenimiento y las migraciones solo se ejercitaron sobre bases de pruebas en esta fase.
