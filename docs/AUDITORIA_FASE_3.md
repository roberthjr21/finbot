# Tercera auditoría: integridad y recuperación

Fecha: 14 de noviembre de 2026. Referencia y base de la rama: `c37f3418928f5ab489f17ef1126430fd75542fa5` (`main`, después del PR #32). Rama independiente: `fix/finbot-reliability-phase-3`.

## Alcance y protección del entorno

Se revisó `git status` antes de modificar archivos. Los cambios locales de la segunda etapa, checksums, capturas y otros archivos sin versionar permanecen en el checkout original. El trabajo se hizo en `/home/roberth/Escritorio/finbot-phase3`, mediante un worktree nuevo desde `origin/main` actualizado. No se encontraron archivos AGENTS.md en el proyecto ni en los directorios superiores comprobados; se revisaron los README e instrucciones operativas.

El bot que estaba conectado recibió SIGTERM y se comprobó que su proceso terminara. No se inició otra instancia, no se copiaron credenciales y el worktree de auditoría no contiene `.env` ni bases financieras reales. Los imports de la aplicación en pruebas utilizan `DB_ARCHIVO` temporal o `:memory:`. Las migraciones v8/v9 solo se ejercitaron sobre fixtures; no se ejecutó mantenimiento, restauración ni borrado sobre la base real. No se hizo merge, no se invocó ningún despliegue ni se cambió la configuración de Vercel.

## Problema 1: modo de prueba y persistencia

**Causa:** la entrada solo almacenaba el protobuf de WhatsApp. La elección de base se hacía al procesar, consultando un mapa en memoria que desaparecía al reiniciar. Un gasto o confirmación de prueba podía entonces dirigirse a la base real.

**Solución:** la admisión captura modo, sesión temporal y comando de control en columnas del trabajo. La proyección `entrada_modos` se actualiza dentro de esa misma transacción únicamente si la admisión fue nueva y aceptada. La sesión identifica el arranque y el sandbox de una sola persona. AES-GCM autentica los metadatos de modo junto con la cuenta, tipo y clave del cuerpo. La selección de base por AsyncLocalStorage respeta el modo capturado durante los awaits y rechaza cruzar cuentas o recuperar una base temporal ausente.

`/prueba on`, mensajes y `/prueba off` se atienden según el orden de admisión, sin decidir su modo nuevamente. Los comandos de control confirman su respuesta y marca en persistente; activar/desactivar memoria se puede repetir sin operaciones financieras. La etiqueta de la respuesta usa también el modo capturado.

Tras reiniciar se cancelan las entradas de prueba del arranque anterior y se elimina su cuerpo. La proyección conserva el modo de prueba hasta un `/prueba on` nuevo o `/prueba off`; la pérdida de memoria nunca significa volver a real. La migración v8 cancela conservadoramente **todas** las entradas heredadas activas que carecen de metadatos fiables. El aviso recomienda revisar `/ultimos`: una entrada antigua podría haber confirmado efectos con el software anterior, y esta auditoría no revierte ni reconstruye registros históricos reales.

**Regresiones:** on/gasto/off/gasto antes de atender la cola; subproceso reiniciado con gasto de prueba pendiente; desactivación con trabajo pendiente; dos usuarios en modos distintos; confirmaciones estructuradas de voz/foto tras reinicio; carga cifrada con modo alterado; rechazo por saturación o duplicado sin cambiar la proyección; entrada real con sandbox concurrente; rollback de SAVEPOINT e intento de cruzar cuentas.

## Problema 2: análisis perdidos

**Causa:** el mensaje confirmaba sus acciones y marca antes de llamar al análisis. No existía una solicitud recuperable, y la respuesta se reservaba después de llamar al proveedor.

**Solución:** las acciones financieras, la solicitud con clase `analisis`, una instantánea numérica y un lugar reservado en la outbox se confirman juntos. La instantánea no contiene descripciones libres y usa el cifrado/retención de la cola. El proveedor se llama fuera de las transacciones SQLite. Recuperar un análisis solo utiliza esa instantánea; no interpreta nuevamente el mensaje ni ejecuta movimientos.

El trabajo pasa a `hecho` en la misma transacción que reemplaza el contenido de la respuesta reservada. Si muere el proceso antes de ese commit, el lease permite recuperar la generación. Si muere después, queda enviar la outbox. La misma fila y clave evitan duplicar la respuesta local. Una instantánea temporal perdida se cancela sin consultar finanzas reales y deja un único aviso mediante su respuesta reservada.

Gemini y Claude conservan los límites y timeouts del cliente existente. Ante error, texto vacío o respuesta excesiva se guarda el análisis local; el trabajo conserva `proveedor_ia_no_disponible` como diagnóstico. No se registra el cuerpo del error del proveedor. Un análisis cancelado, vencido, huérfano o agotado libera su respuesta con un fallo explícito, sin bloquear permanentemente la conversación.

**Regresiones:** fallo de outbox antes del commit financiero; terminación real de subprocesos antes, durante y después de generar el análisis; recuperación tras el commit del resultado; error HTTP simulado de cada proveedor; agotamiento y cancelación de sesión temporal. Se comparan movimientos, caja, deudas y préstamos antes/después de la recuperación y se comprueba una sola respuesta local.

## Problema 3: orden de las respuestas

**Causa:** la selección de salida excluía del FIFO a todos los trabajos `salida`; un primer mensaje en backoff dejaba que se reclamara el siguiente.

**Solución:** las salidas conversacionales comprueban predecesores activos de su cuenta, aunque estén esperando backoff o un análisis. Otra cuenta puede avanzar con la concurrencia existente. Caducidad, agotamiento o cancelación liberan el predecesor. Las notificaciones de recordatorios, alertas, recurrentes y saturación tienen un carril independiente. Los OTP web siguen siendo independientes. Se eliminó el envío directo del aviso de saturación de entrada.

Se mantienen los máximos de cola, concurrencia y cuerpo, leases, heartbeat y huellas de retención. El mantenimiento de entradas consulta metadatos sin materializar todos sus cuerpos cifrados. Los avisos de recuperación/agotamiento usan la clave estable del trabajo, no un ID de fila que SQLite pueda reutilizar después de retener toda la cola.

**Regresiones:** primera respuesta falla y la segunda espera; recuperación tras reiniciar; caducidad, agotamiento y cancelación; notificaciones aplazadas; reserva de análisis; saturación y duplicados; seis usuarios concurrentes con FIFO individual; reutilización de IDs después de retención conservando sus huellas.

**Límite externo:** se garantiza el orden local de intentos, no exactamente una entrega ni FIFO absoluto en el dispositivo. Una caída entre aceptación de WhatsApp y commit puede repetir el envío. Un timeout no retira un mensaje en tránsito y puede haber entregas tardías. Cada trabajo mantiene su `messageId` estable. Esto no altera la idempotencia financiera.

## Archivos modificados

| Archivos | Responsabilidad |
|---|---|
| `bot/entradas.js`, `bot/db.js`, `bot/modo-prueba.js` | Captura/proyección del modo, sesiones de sandbox y selección estricta de base |
| `bot/bot.js` | Admisión, despacho, reserva atómica de respuestas y análisis, avisos persistentes |
| `bot/analisis-trabajos.js`, `bot/analisis.js`, `bot/acciones.js` | Solicitudes recuperables e instantáneas; fallback y diagnóstico del proveedor |
| `bot/trabajos.js`, `bot/outbox.js`, `bot/recurrentes.js` | FIFO, reservas/dependencias, carriles y recuperación de salidas |
| `bot/migraciones.js`, `bot/privacidad-admin.js` | Migraciones aditivas v8/v9 y eliminación autorizada de la proyección de modo |
| `bot/entradas.test.js`, `bot/analisis-recuperacion.test.js`, `bot/outbox-orden.test.js` | Regresiones de los tres problemas |
| `bot/fiabilidad.test.js` | Expectativa de diagnóstico de esquema actualizada a v9; no se cambiaron expectativas financieras |
| README y documentación operativa/privacidad | Garantías, recuperación y limitaciones |

No se modificaron componentes, rutas, dependencias ni configuración de despliegue del frontend; tampoco `bot/codec-mensajes.js`. El protobuf de texto, audio e imagen permanece igual; sus metadatos de modo se guardan por separado y se autentican con el cuerpo.

## Evidencia final

Node `v22.23.1`, pnpm `12.3.4`, SQLite de Node. Las pruebas de reinicio terminan subprocesos con código 73 en puntos definidos; los errores de proveedor y transporte son ficticios y no contactan cuentas reales.

| Directorio | Comando | Resultado final |
|---|---|---|
| `bot/` | `npm ci` | Código 0; lockfile conservado |
| `bot/` | `npm test` | **220 aprobadas**, 0 fallidas, 0 omitidas |
| `bot/` | `npm audit --audit-level=moderate` | Código 0; **0 vulnerabilidades** |
| `web/` | `pnpm install --frozen-lockfile` | Código 0; lockfile conservado |
| `web/` | `pnpm test` | **11 aprobadas**, 0 fallidas |
| `web/` | `pnpm typecheck` | Código 0 |
| `web/` | `pnpm lint` | Código 0 |
| `web/` | `pnpm build` | Código 0 con Turbopack; compilación normal, sin fallback webpack |
| `web/` | `pnpm test:integration` | **1 escenario aprobado**: OTP, aislamiento, CRUD, revocación y caída de API |
| `web/` | `pnpm test:e2e` | **1 escenario Chromium aprobado**: móvil/escritorio, foco, teclado, doble envío y CRUD |
| Raíz | `node scripts/verificar-bot.mjs` | Sintaxis aprobada sin iniciar servicios |
| Raíz | `python3 scripts/verificar-secretos.py` | Sin los patrones de secretos comprobados |
| Raíz | `python3 -m unittest discover -s scripts -p 'test_*.py'` | **3 aprobadas** |
| Raíz | `git diff --check` | Sin errores de espacios |

Las nuevas suites de entradas, recuperación de análisis y orden de salida aportan 28 regresiones a las 192 anteriores. La suite completa incluye cálculos financieros, idempotencia, escritura atómica, aislamiento, multimedia, migraciones y retención. Los snapshots de las regresiones verifican que recuperar/cancelar trabajos no cambia los movimientos ni los saldos previamente confirmados en las fixtures. No se afirma una conciliación contable de cuentas reales: no se inspeccionaron ni alteraron para las pruebas.

Incidencias de ejecución: dos invocaciones iniciales usaron un directorio incorrecto y no llegaron a ejecutar pruebas (`Could not find entradas.test.js` y rutas `bot/bot/...`). Se corrigió el directorio de trabajo y se ejecutaron las suites completas. No hubo pruebas fallidas ocultadas ni se redujeron aserciones financieras para aprobar. Los artefactos generados, `tsconfig.tsbuildinfo`, credenciales y bases no se incluyen en el PR.

Las pruebas locales validan compatibilidad de la web/API, no conectividad, certificados, gateway ni entrega real de WhatsApp en producción/Vercel. No se inició una preview remota. Antes de aplicar las migraciones en otro entorno, detener todas las instancias y seguir el respaldo verificado existente; esta auditoría no autoriza ni ejecuta esa aplicación a datos reales. El bot original queda detenido.
