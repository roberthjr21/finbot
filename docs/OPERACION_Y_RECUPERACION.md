# Operación, mensajes y recuperación

## Cola y outbox

Los mensajes ya autenticados se guardan en SQLite antes de procesarlos. Cada cuenta tiene orden FIFO de admisión, una sola tarea de entrada activa y acceso a cuatro trabajadores globales por defecto (`COLA_CONCURRENCIA`, entre 1 y 16). Una espera de IA de una cuenta no detiene el procesamiento asíncrono de las demás. Las transacciones SQLite de escritura siguen siendo breves y síncronas.

El límite es de 5.000 pendientes por tipo y 500 por cuenta; cada carga puede ocupar como máximo 256 KiB antes de cifrar. Al no poder admitir un mensaje se intenta un aviso directo de saturación, se registra el fallo y **no se marca como procesado**. No existe memoria ni disco ilimitados. Si ese aviso tampoco llega, hace falta diagnóstico del operador y reenvío por el usuario: WhatsApp/Baileys no garantiza reentrega u orden de transporte. El FIFO garantizado es el de admisión autenticada, no una reconstrucción de mensajes nunca entregados.

Las reservas duran dos minutos y se renuevan cada treinta segundos. Tras una caída se recuperan las vencidas. La reserva se verifica al abrir una transacción financiera; una instancia antigua no puede confirmar cambios después de perderla. La marca del mensaje, el lote financiero y su respuesta principal se escriben juntos. Reintentar después de un COMMIT no duplica movimientos.

Reintentos de entrada: hasta cinco, con pausa exponencial; al agotarse o caducar se intenta una notificación para que el usuario revise `/ultimos` antes de reenviar. Los cuerpos se limpian y el estado `agotado` permanece diagnosticable. Un error semántico/validación que ya recibió respuesta no se reinterpreta automáticamente con IA. Las notas de voz y fotos conservan validación y confirmación.

Las respuestas, recordatorios, alertas y avisos recurrentes usan la outbox SQLite. El aviso recurrente se reserva en la misma transacción que su movimiento. Los recordatorios llevan revisión: editar o cancelar durante un envío no marca la versión nueva como enviada. Las alertas reservan sus claves y respetan silencio, configuración vigente y cupo diario también al reintentar. Si un grupo excede el cupo, su resto queda pendiente.

El envío usa un ID estable y hasta veinte intentos, con pausa exponencial máxima de una hora. Una desconexión conocida, silencio o falta de cupo aplazan sin consumir intentos. Un timeout o caída después de que WhatsApp aceptó el mensaje y antes de confirmar SQLite puede producir un aviso repetido. **No se promete entrega exactamente una vez.** Los movimientos financieros y recurrentes se protegen con transacciones y claves únicas, independientemente del resultado del aviso.

Una sola instancia debe mantener la sesión de WhatsApp. Las pruebas con varios procesos validan contadores/reservas SQLite, no soportan dos sesiones Baileys simultáneas sobre el mismo directorio `auth/`.

## Diagnóstico

```sh
node estado.js /ruta/finanzas.db
```

Es una lectura de integridad, versión, cantidades por tipo/estado y espacio libre. No migra la base, no abre WhatsApp ni imprime cuentas o cuerpos. Vigilar crecimiento de pendientes, edad del más antiguo, agotados, errores de reserva, espacio libre y errores de respaldo. Configurar alertas externas del sistema por esos resultados; este cambio no instala un servicio de monitorización.

Antes de reiniciar, dejar que SIGTERM cierre trabajos activos. Lo pendiente queda en disco. Un modo `/prueba` mantiene las finanzas ficticias en memoria; el transporte y sus cuotas/colas son reales, por lo que siguen necesitando disco privado. No usar mensajes de usuarios reales para probar cambios de código.

## Respaldos locales

- `node db-admin.js backup origen.db copia-nueva.db`: snapshot consistente con WAL, esquema/integridad y SHA-256 en `copia-nueva.db.sha256`.
- `node db-admin.js restore copia.db restaurada-nueva.db`: verifica checksum si existe, integridad/esquema y rechaza sobrescritura, WAL/SHM de origen o archivos huérfanos del destino.
- Las copias heredadas sin checksum siguen siendo legibles si pasan las comprobaciones; no se afirma detectar alteraciones válidas de contenido sin un checksum previo.
- Se comprueba espacio de destino antes de copiar: tamaño de base y WAL, margen de trabajo de tres veces y reserva de 64 MiB. La estimación es conservadora, no reserva bloques: otra aplicación podría consumir disco concurrentemente. Ante fallo no se rotan copias existentes.
- Una copia existente no se considera válida sin verificar. Al arrancar también se verifica la última copia antes de confiar en su edad.
- Los nombres incorporan familia derivada de la ruta de base. Una rotación autorizada no borra copias de otra base en una carpeta compartida.
- Rotación desactivada por defecto. Activar `RESPALDO_ROTAR=1` solo con autorización del administrador, después de revisar `RESPALDO_CONSERVAR`. No elimina copias manuales, anteriores sin familia ni pre-migración.

## Copia externa cifrada: preparación local

Crear primero una copia local verificada. El helper `respaldo-cifrado.js` usa AES-256-GCM y una clave derivada mediante scrypt con salt aleatoria. Recibe la frase por stdin (16–4096 caracteres), nunca como argumento ni variable del repositorio. Usar un gestor de contraseñas o entrada segura del operador; no escribir una frase real en el historial de la shell.

```text
node respaldo-cifrado.js cifrar copia.db copia.db.enc
node respaldo-cifrado.js descifrar copia.db.enc restaurada-nueva.db
```

Ambos esperan la frase por stdin. No imprimirla, pasarla por argumentos ni guardarla en `.env.example`. En una terminal, la entrada estándar ordinaria puede mostrar lo tecleado: usar un canal de entrada seguro que suprima eco. Los destinos siempre son nuevos; un tag inválido, clave incorrecta, archivo truncado o base corrupta impiden publicar una restauración parcial. El helper **no transfiere archivos** a ningún proveedor.

Propuesta externa: dos destinos cifrados independientes, acceso mínimo, clave guardada separada de las copias y ensayos periódicos de recuperación. Definir RPO según intervalo real (por defecto 24 h), RTO según un ensayo en el servidor destino, custodia de clave y retención compatible con solicitudes de eliminación. No hay evidencia de RPO/RTO de producción ni se ha autorizado una transferencia externa.

## Restauración ensayada, antes de abrir servicio

1. Detener bot y accesos de escritura; conservar la base original.
2. Recuperar/descifrar una copia hacia una ruta privada nueva, verificar integridad, checksum y permisos 0600.
3. Revisar eliminaciones y revocaciones posteriores a esa copia. Un backup puede contener sesiones antiguas y cuerpos de cola aún cifrados con una clave anterior.
4. Configurar `DB_ARCHIVO` hacia la copia recuperada y las claves correctas, sin cambiar el archivo original. Las migraciones nuevas crearán copia previa verificada cuando corresponda.
5. Comprobar cuentas, balances, deudas/préstamos, auditoría, recurrentes, estados de cola y notificaciones. Revisar posibles avisos repetidos en la ventana de entrega externa.
6. Validar con un entorno aislado y obtener aprobación antes de exponerlo. No borrar WAL/SHM de una base activa.

## Entradas y modo de prueba (fase 3)

La migración v8 cancela las entradas heredadas cuyo modo no se puede demostrar; no ejecuta su contenido. Cada entrada nueva captura `modo_operacion`, `sesion_prueba` y el comando de control dentro de la transacción de admisión. AES-GCM autentica también estos metadatos. La proyección por cuenta solo cambia si el mensaje fue admitido y no era duplicado. Así `/prueba on`, un gasto y `/prueba off` mantienen el orden de admisión incluso antes de que un trabajador los atienda.

Una sesión temporal pertenece a un único arranque de FinBot. Tras reiniciar, las entradas de prueba del arranque anterior se cancelan, se elimina su cuerpo y se reserva un aviso durable. La proyección sigue en prueba hasta recibir `/prueba on` (sesión nueva) o `/prueba off`; nunca vuelve a real por ausencia de memoria. Si desaparece la base temporal durante una ejecución, se falla o cancela, sin recurrir a la base real. Una confirmación de audio o recibo de prueba no puede recuperar contexto financiero real. Los mensajes normales capturados como reales seleccionan explícitamente la base persistente.

## Análisis recuperables (fase 3)

La migración v9 permite trabajos de entrada con clase `analisis` y respuestas reservadas (`esperando=1`, `dependencia`). El mensaje confirma sus acciones financieras, la instantánea numérica del análisis y la reserva de respuesta en una transacción. La llamada al proveedor se hace fuera del bloqueo SQLite. El trabajo solo pasa a `hecho` junto con el resultado en la fila de outbox ya reservada; no se crea otra respuesta al reintentar.

Una caída antes del commit revierte las operaciones financieras; una caída durante el análisis o antes de guardar el resultado repite únicamente la lectura de la instantánea y la generación de texto. Después del commit del resultado solo queda enviar la outbox. Los errores de Gemini/Claude producen el análisis local y el diagnóstico `proveedor_ia_no_disponible`; no se registra el cuerpo del error del proveedor. Si el trabajo caduca, se cancela o agota reintentos, el mantenimiento libera la respuesta reservada con un fallo verificable. Las instantáneas son cuerpos cifrados sujetos a la retención de la cola, no un historial nuevo de descripciones financieras.

## Orden de las respuestas de WhatsApp (fase 3)

Las salidas conversacionales (`carril=conversacion`) respetan FIFO por cuenta, incluso si la primera está en backoff o esperando un análisis. Un trabajo posterior no puede reclamar el transporte hasta que el anterior termine, caduque, se cancele o agote su política. Las cuentas diferentes conservan la concurrencia configurada (4 por defecto, máximo 16); para cada cuenta hay como máximo un envío en procesamiento. La cola tiene límites persistentes globales y por cuenta.

Recordatorios, alertas, recurrentes y avisos de saturación son notificaciones independientes: pueden saltar una conversación en espera y no bloquean sus respuestas por horarios de silencio o cupos. Las salidas heredadas se consideran conservadoramente conversacionales. Los OTP del acceso web siguen siendo un canal inmediato independiente de la conversación. No se utilizan envíos directos para el aviso de saturación de entrada.

Este orden es el de los intentos de envío locales y sus confirmaciones. WhatsApp no ofrece entrega externa exactamente una vez: una caída después de aceptar el envío y antes de confirmar SQLite puede repetirlo; un timeout no permite retirar un mensaje en tránsito, y WhatsApp o el dispositivo pueden mostrar mensajes tarde. Cada fila mantiene un `messageId` estable en los reintentos. No se promete FIFO absoluto en el dispositivo ni se cambian las garantías de idempotencia de las operaciones financieras.
