# Revisión de la segunda etapa — 14 de noviembre de 2026

Rama: `fix/finbot-audit-phase-2`. Se conservaron los cambios previos de la etapa; el PR incorpora ese trabajo y estas correcciones. No se ejecutaron el bot de WhatsApp, migraciones, borrados ni mantenimiento contra la base financiera real. No se hizo merge ni despliegue.

## Correcciones prioritarias

1. **Alertas reservadas:** la reconciliación elimina reservas huérfanas o asociadas a trabajos hechos, agotados o cancelados. Se ejecuta antes de calcular pendientes y durante el mantenimiento del trabajador/programador. El programador purga vencidos antes de calcular y asigna una clave nueva a cada nueva reserva; reutilizar la clave de un trabajo terminal impedía reencolar aunque se liberara su reserva. Las marcas de alertas ya enviadas siguen evitando duplicados. Regresión: caducidad, agotamiento explícito, agotamiento al recuperar un lease y cancelación; en cada caso se vuelve a reservar la misma alerta con otro trabajo.
2. **Audio e imagen:** `respuesta-media.js` guarda contexto estructurado, marca y outbox dentro de la misma transacción en la base normal. Todas las respuestas terminales de audio y las confirmaciones/rechazos de imagen usan esta operación. En modo prueba, el cuerpo durable se persiste antes de confirmar la transacción temporal, por lo que una marca temporal no puede adelantarse a la outbox. Los errores de persistencia llegan al trabajador para reintento. Las pruebas terminan un subproceso con código 73 desde un trigger, justo después de la marca y antes de insertar la respuesta: al reabrir, no hay marca ni contexto parcialmente confirmado; la reentrega produce una sola respuesta y conserva el contexto. También se comprueba la reentrega tras commit antes de terminar la entrada.
3. **Retención:** migración aditiva v7, con el mecanismo existente de respaldo previo a migración. Se eliminan hasta 500 trabajos terminales por mantenimiento cuando han transcurrido 30 días desde su caducidad. Se conservan activos y recientes. Antes de eliminar, se guardan huellas SHA-256 de clave/cuenta en una transacción; tras reiniciar, la admisión sigue rechazando replays. No se conservan cuerpo, teléfono en claro, estado ni fechas en ese registro mínimo. Las huellas son seudónimos y crecen con las claves únicas: conservar idempotencia indefinida exige ese registro. La eliminación autorizada de cuenta contempla también sus huellas. No se afirma borrado físico de páginas SQLite, WAL, snapshots o respaldos.

## Configuración y arranque

- `bot/pnpm-workspace.yaml`: se sustituyeron los textos provisionales por booleanos explícitos. Se permiten los scripts declarados de Baileys (comprueba versión de Node) y protobufjs (aviso de compatibilidad). CI y producción siguen usando `npm ci`; no se cambiaron dependencias ni lockfile del bot.
- `iniciar.sh` lanza `pnpm dev`, está documentado como exclusivo de desarrollo y rechaza `NODE_ENV=production`. La comprobación devuelve código 1 antes de arrancar servicios. No se utiliza como paso de despliegue en el CI inspeccionado. Esto no verifica configuraciones externas de servidores.

## Validación

Los tests usan SQLite temporal o en memoria y credenciales ficticias. La regresión de retención compara antes/después los movimientos, caja, balance operativo, deudas y préstamos. Las suites financieras existentes comprueban además importes, pagos parciales, transferencias, idempotencia y aislamiento de cuentas.

| Comprobación | Resultado |
|---|---|
| Bot: `npm test` | 192 pruebas aprobadas |
| Frontend: `pnpm test` | 11 pruebas aprobadas |
| TypeScript: `pnpm typecheck` | Aprobado |
| ESLint: `pnpm lint` | Aprobado |
| Sintaxis: `node scripts/verificar-bot.mjs` | Aprobado |
| Escáner de secretos y sus tests | Aprobado; 3 tests Python |
| Guarda de `iniciar.sh` | Rechaza producción, sin iniciar servicios |
| Compilación | `pnpm build --webpack` aprobado; Turbopack interrumpido por falta de progreso |
| Integración HTTP | `pnpm test:integration`: 1 escenario aprobado (OTP, aislamiento, CRUD, revocación y caída de API) |
| Chromium | `pnpm test:e2e`: 1 escenario aprobado (móvil/escritorio, foco, teclado, doble envío y CRUD) |

El primer intento de integración se lanzó antes de completar el build y falló esperando el arranque. El build predeterminado con Turbopack dejó de mostrar progreso durante varios minutos; se detuvo únicamente ese proceso de verificación y se probó la compilación con webpack, sin cambiar la configuración del proyecto. La integración y Chromium se repitieron sobre el build webpack terminado y aprobaron. El build predeterminado queda por confirmar en CI; no se presenta como aprobado localmente.

No se incluyeron bases, checksums locales, capturas de Playwright, `tsconfig.tsbuildinfo` ni archivos ajenos como `x`. La validación financiera es sobre fixtures; no se atribuyen a estas pruebas cambios ni verificación contable independiente de cuentas reales. WhatsApp, IA externa e infraestructura de producción requieren su validación operativa separada.
