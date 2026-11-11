# Auditoría técnica de FinBot — 2026-11-11

Base inspeccionada: `9f38458`. Rama: `fix/security-hardening-audit-20261111` (la rama solicitada ya existía). No se modificó main, no se inició WhatsApp y no se desplegó ningún servicio público. Se preservaron los cambios locales previos de `.gitignore`, `web/next-env.d.ts`, `bot/pnpm-workspace.yaml`, `iniciar.sh`, `web/tsconfig.tsbuildinfo` y `x`; quedan fuera de los commits de esta auditoría.

## A. Errores comprobados

| Archivo | Gravedad | Problema y evidencia | Corrección y regresión |
|---|---|---|---|
| `web/lib/auth-servidor.ts` | Alta | Fuera de Vercel se aceptaba CF-Connecting-IP/XFF de cualquier cliente; las variantes falsificadas cambiaban la clave del límite. | Infraestructura explícita, gateway autenticado para Cloudflare y clave conservadora por defecto; `web/seguridad.test.mjs`. |
| `web/lib/auth-servidor.ts` | Alta | CSRF comparaba Origin con X-Forwarded-Host y no el esquema completo; confianza en metadatos no autenticados. | Origen configurado exacto; pruebas de host falso, HTTP/HTTPS, puerto y Sec-Fetch-Site. |
| `bot/limites.js`, `bot/acceso.js` | Alta | Contadores sensibles eran Map; recrear proceso borraba límites. Verificar código y crear sesión no reservaba el escritor desde la lectura. | `limites-sqlite.js`, migración v4, transacción integral de verificación; dos procesos comparten el límite y solo uno usa el OTP. |
| `web/app/api/auth/salir/route.ts` | Alta | Se eliminaba la cookie aunque postBot devolviera estado 0/500; el token remoto seguía válido. | Confirmación explícita, reintento idempotente y 503 conservando cookie si falla; integración con bot desconectado. |
| `bot/bot.js` | Alta | Ausencia o errata en REGISTRO_ABIERTO abría el acceso público. | Solo valor exacto 1 habilita acceso; prueba de valores ausentes, inválidos y explícitos. |
| `bot/acciones.js` | Alta | `abonar_deuda` con monto ausente pagaba todo por defecto, incluso si la IA omitía el monto. | Requiere monto válido o `todo=true`; prueba de saldo antes/después. |
| `bot/db.js` | Alta | Las protecciones de movimientos ligados estaban fuera de editar/eliminar; llamadas directas podían desalinear las libretas. Borrar gastos dejaba cobros sin préstamos. | Guardas dentro de la transacción; bloqueo del borrado parcial peligroso; regresión de préstamos con cobros. |
| `bot/acciones.js`, `bot/db.js` | Alta | La atomicidad dependía del llamador para acciones financieras de varias tablas. | Cada acción reserva una transacción, admite SAVEPOINT y revierte ante un fallo simulado entre movimiento y préstamo. |
| `bot/bot.js`, `bot/media.js` | Alta | Una transcripción podía entrar al parser de comandos; acciones de voz distintas de registrar movimientos escapaban a la confirmación. | Voz excluida de comandos y confirmaciones destructivas; solo registros validados pendientes y consultas permitidas. |
| `bot/media-*.test.js` | Alta | Tres archivos importaban media/db sin configurar DB_ARCHIVO y abrían la base predeterminada. Ejecución paralela reprodujo conflicto de migraciones v4. | Bases en memoria antes del import dinámico. Migraciones reconsultan la versión dentro del bloqueo. No se borró ni reinició la base predeterminada. |
| `bot/db.js`, `bot/migraciones.js` | Media | Eliminaciones de WhatsApp/borrados masivos no conservaban snapshots de cada fila financiera. | Migración v5: triggers transaccionales de eliminación de movimientos, deudas y préstamos; auditoría de acciones y recurrentes. |
| `bot/ia.js`, `bot/bot.js` | Media | Descargas completas en memoria, respuestas IA sin límite real y cola sin cota. Los errores del proveedor podían copiar texto remoto al log. | Stream limitado, 15 s y tamaño real; 512 KiB por respuesta IA, cola 200 y errores sin cuerpos remotos. |
| `web/app/api/` | Media | JSON null/arrays podía causar errores; lectura ilimitada de cuerpos en memoria, cookies mal codificadas podían lanzar excepción. | Lectura real máxima 8 KiB/5 s, objetos JSON, formularios acotados y parser seguro de cookie; pruebas unitarias e integración. |
| `web/package.json`, lock | Crítica | Next 16.4.0 afectado por GHSA-2464-fhr4-w9xw y GHSA-673q-mjm6-r5xr; árbol CLI shadcn añadía proxy-addr crítico. Audit inicial: 3 críticos, 37 altos, 42 moderados y 9 bajos. | Next/plugin 16.4.5, PostCSS 8.5.23 y actualizaciones transitivas compatibles. CLI retirada conservando CSS y licencia MIT. Audit final: solo 1 moderado de desarrollo. |
| `README.md`, README de bot/web | Baja | Puerto 50000 en ejemplo pese a predeterminado 3001; web descrita como solo lectura pese a disponer de CRUD. | Documentación y ejemplos corregidos. |

## B. Correcciones realizadas

Se mantuvieron los comandos escritos, el aislamiento por sesión y los importes COP enteros. No se reescribieron importes ni se intentó reparar automáticamente datos históricos. Los borrados siguen disponibles con confirmación, salvo cuando dejarían cobros sin préstamos que los respalden. `/abono todo` conserva el pago total explícito.

Las migraciones v4 y v5 son aditivas. La copia previa verificada existente se conserva; las migraciones se ejecutan después de crear todas las tablas base, y comprueban versiones bajo el bloqueo. Los snapshots de eliminación quedan en la misma transacción que el borrado, incluso en borrados masivos. Los tests de restauración comparan movimientos, auditoría, sesiones y límites.

En producción la API requiere secretos independientes de al menos 32 caracteres. Se añadió API_TOKEN_ANTERIOR para rotación breve y documentada. Las llamadas web/bot e IA no siguen redirecciones con credenciales. La cuenta de las operaciones sigue derivándose del token de sesión, nunca de un teléfono aportado en el cuerpo o la URL.

Las cookies son siempre Secure en producción. Se añadieron políticas de frame, objetos, base, formularios, permisos y HSTS. El formulario anuncia envíos en curso y bloquea envíos simultáneos; la creación conserva idempotencia de backend. El menú móvil ya permite operar su checkbox con teclado y se respeta la preferencia de movimiento reducido.

## C. Seguridad y límites prácticos

- **IP:** Request de Next no expone el socket. En local o alojamiento propio sin gateway autenticado se utiliza `?`: evita evasión por cabeceras pero comparte cupo entre visitantes. No se inventa una IP real. En Vercel se confía solo en XFF sobrescrito por la plataforma. El modo Cloudflare requiere gateway que sobrescriba X-Finbot-Proxy con secreto privado y bloquee accesos directos. La aplicación no puede validar por sí sola el firewall del operador.
- **Fuerza bruta:** ventanas deslizantes por IP/teléfono, hash de identificadores, transacción BEGIN IMMEDIATE y purga indexada de hasta 1000 vencidos por intento. Los rechazados no añaden filas. Su volumen sigue dependiendo del tráfico legítimo admitido y el disco debe monitorizarse.
- **Revocación:** al caerse el bot no es posible prometer revocación remota. La web conserva la cookie, responde 503, registra estado sin token y permite reintentar. No se añadió un almacén de revocaciones en Vercel ni otro servicio. Una sesión comprometida requiere intervención/revocación en el bot.
- **Secretos:** rotar la clave HMAC invalida códigos pendientes, no los hashes de sesiones. La clave anterior de API debe retirarse tras la transición; no usarla para prolongar acceso de una clave comprometida. El scanner de CI detecta patrones conocidos y archivos privados versionados; no garantiza ausencia de cualquier secreto ni escanea todo el historial Git.
- **IA:** se mantienen validaciones deterministas y autorización por remitente. La IA puede equivocarse semánticamente dentro de operaciones válidas; la confirmación de voz/fotos y la posibilidad de revisión siguen siendo necesarias.
- **Infraestructura:** SQLite requiere almacenamiento persistente local. Mantener una sola instancia de WhatsApp y copias externas cifradas. No se implementó Redis ni se prometió escalado horizontal de WhatsApp.

Fuentes de plataforma contrastadas: [cabeceras Vercel](https://vercel.com/docs/headers/request-headers), [restaurar IP en Cloudflare](https://developers.cloudflare.com/support/troubleshooting/restoring-visitor-ips/restoring-original-visitor-ips/), [seguridad de datos Next.js](https://nextjs.org/docs/app/guides/data-security).

## D. Rendimiento medible

- Dashboard: 13 → 8 peticiones HTTP al bot (38,5 % menos); histórico de 6 meses: 6 → 1. El endpoint nuevo permite hasta 12 meses distintos y exige sesión. La regresión compara el lote con todos los resúmenes individuales.
- Árbol auditado completo de la web: 484 → 270 dependencias (44,2 % menos). Se conservó el CSS de shadcn con licencia sin instalar su CLI en runtime.
- `/api/deudas` reutiliza un resumen en lugar de calcularlo dos veces.
- Gráficos siguen siendo SVG de servidor; no se añadió librería de gráficos ni caché financiera compartida.
- No se midieron latencia de Vercel, memoria en carga real, Lighthouse ni tamaño comparativo del bundle inicial. No se atribuye una mejora de latencia a la reducción de peticiones sin medirla.

## E. Verificaciones

Entorno: Node.js 22.23.1, pnpm 12.3.4. La suite inicial, antes de corregir, pasó 147 pruebas con permiso para HTTP local.

| Verificación | Resultado final |
|---|---|
| `bot: npm ci` | Correcta |
| `bot: npm test` | 164 pruebas, todas correctas |
| `bot: npm audit` | 0 vulnerabilidades conocidas |
| `web: pnpm install --frozen-lockfile` | Correcta, lock conservado |
| `web: pnpm test` | Correcta, seis casos de seguridad HTTP |
| `web: pnpm typecheck` | Correcta |
| `web: pnpm lint` | Correcta |
| `web: pnpm build` | Correcta, Next.js 16.4.5 |
| `web: pnpm test:integration` | Correcta: OTP, cookies, navegación protegida, CRUD, idempotencia, aislamiento, revocación y desconexión |
| `web: pnpm audit --prod` | 0 vulnerabilidades conocidas |
| `web: pnpm audit` | Código 1 por 1 aviso moderado de minimatch, solo desarrollo |
| Scanner de secretos y `git diff --check` | Correctos |

Fallos identificados durante la ejecución: el sandbox bloqueó DNS, servidores HTTP y el puerto interno de Turbopack (EPERM); se repitieron las verificaciones con el permiso requerido. La integración ajustó su comprobación de redirección: Next puede transmitir un shell con HTTP 200 y redirigir dentro del stream; se comprueba también que la API rechaza con 401 el token revocado. No se desactivaron pruebas para obtener verde.

El aviso pendiente [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) afecta minimatch 10 usado por typescript-eslint. La versión corregida indicada es >=11.0.1, fuera del rango actual. Se deja sin forzar un major transitorio. CI falla ante avisos de producción moderados o superiores, y ante avisos altos del árbol completo; el umbral no equivale a declarar cero hallazgos.

## F. Archivos afectados

La lista exacta figura al final del documento y en los commits. Los archivos previos del usuario citados al inicio se excluyen.

## G. Pendientes y motivos

1. Validar WhatsApp real: reconexión, envío/recepción de códigos, notas de voz y fotos contra los proveedores activos. Las pruebas usan dobles/proveedores locales; no se han usado credenciales reales ni vinculado otra sesión.
2. Verificar despliegue preview Vercel, dominio/certificados, gateway Cloudflare, firewall y secretos del entorno. Requiere infraestructura; no se expuso ni desplegó la API.
3. Actualización compatible de typescript-eslint/minimatch cuando su cadena admita la versión corregida. ESLint 9 también tiene aviso de fin de soporte: migrarlo requiere revisar configuración, no forzar un cambio mayor durante el hardening.
4. Pruebas visuales de navegador, lector de pantalla, móviles reales, perfil de bundle y carga sostenida. La integración añadida verifica HTTP real, no interacción visual ni accesibilidad completa.
5. Recordatorios/alertas: un apagado después de enviar a WhatsApp y antes de persistir la marca puede repetir un aviso. No se promete entrega exactamente una vez de efectos externos. Los movimientos recurrentes sí conservan claves únicas transaccionales. Hacer explícita una política de outbox/entrega requiere más diseño y pruebas con el transporte.
6. No se inspeccionaron ni repararon datos financieros personales de producción. La conservación y corrección se verificaron con fixtures, restauración y regresiones; una auditoría contable de datos existentes requiere una copia autorizada.
7. Respaldos externos cifrados, rotación operativa de secretos, alertas de disco, monitorización y pruebas de recuperación en el servidor destino quedan a cargo de la preparación de infraestructura.

## H. Estado final

| Uso | Evidencia y estado |
|---|---|
| Desarrollo local | Validado mediante pruebas, tipos, lint, build e integración HTTP local. |
| Pruebas con usuarios | Candidato para entorno controlado, con números permitidos y credenciales de pruebas. WhatsApp real aún debe validarse. |
| Despliegue web | Artefacto compila; falta preview real y verificar conectividad/WEB_ORIGEN. No se declara despliegue aprobado. |
| Producción | No aprobado todavía: falta validación operativa del transporte, infraestructura, respaldo externo y carga real. |

### Lista de archivos

- `docs/PR_SECURITY_HARDENING.md`
- `.github/workflows/ci.yml`
- `README.md`
- `bot/.env.example`
- `bot/README.md`
- `bot/acceso.js`
- `bot/acciones.js`
- `bot/api.js`
- `bot/bot.js`
- `bot/db.js`
- `bot/escritura.test.js`
- `bot/http-seguro.js`
- `bot/ia.js`
- `bot/limites-sqlite.js`
- `bot/media-nequi-legible.test.js`
- `bot/media-recarga-contexto.test.js`
- `bot/media-recargas.test.js`
- `bot/media.js`
- `bot/migraciones.js`
- `bot/politicas.js`
- `bot/recurrentes.js`
- `bot/recursos.js`
- `bot/seguridad.test.js`
- `docs/AUDITORIA.md`
- `scripts/verificar-secretos.py`
- `web/.env.example`
- `web/README.md`
- `web/app/api/auth/salir/route.ts`
- `web/app/api/auth/solicitar/route.ts`
- `web/app/api/auth/verificar/route.ts`
- `web/app/api/movimientos/crear/route.ts`
- `web/app/api/movimientos/editar/route.ts`
- `web/app/api/movimientos/eliminar/route.ts`
- `web/app/globals.css`
- `web/app/movimientos/[id]/page.tsx`
- `web/app/page.tsx`
- `web/components/dashboard-shell.tsx`
- `web/components/formulario-envio.tsx`
- `web/components/formulario-movimiento.tsx`
- `web/components/login-form.tsx`
- `web/lib/auth-servidor.ts`
- `web/lib/bot-api.ts`
- `web/lib/escritura.ts`
- `web/lib/seguridad-http.ts`
- `web/lib/sesion.ts`
- `web/package.json`
- `web/pnpm-lock.yaml`
- `web/proxy.ts`
- `web/seguridad.test.mjs`
- `web/styles/shadcn-LICENSE`
- `web/styles/shadcn.css`
- `web/tests/bot-fixture.mjs`
- `web/tests/integracion.test.mjs`
