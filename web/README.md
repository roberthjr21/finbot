# FinBot Finance (web)

Panel privado para consultar la API del bot de WhatsApp y crear, editar y eliminar movimientos propios. Es una sola web para todos: cada persona entra con su propio número de WhatsApp y ve únicamente sus datos (saldo, resumen mensual, movimientos, presupuestos y deudas). Las deudas y préstamos se administran mediante WhatsApp.

## Variables de entorno

Configura en el entorno privado del servidor Next.js:

- `BOT_API_URL`: URL base alcanzable del API del bot.
- `BOT_API_TOKEN`: token que el servidor envía como `Authorization: Bearer …`.

Copia `.env.example` a `.env.local` para desarrollo y completa los valores localmente. No uses prefijos `NEXT_PUBLIC_` para secretos ni incluyas valores reales en el repositorio.

## Desarrollo y compilación

Con pnpm 12.3.4:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Verificaciones locales:

```sh
pnpm typecheck
pnpm lint
pnpm build
```

## Conexión segura con el bot

El navegador solo recibe el HTML renderizado por Next.js. El servidor Next.js hace las consultas HTTPS al API con el token; `BOT_API_URL` y `BOT_API_TOKEN` son variables privadas y nunca deben publicarse en el cliente.

### Despliegue en Vercel

- **Root Directory:** `web` · **Framework:** Next.js · **Install:** `pnpm install` · **Build:** `pnpm build` (Vercel los detecta solos; la versión de pnpm sale de `packageManager`).
- **Variables privadas** (Production y Preview; no marques ninguna como pública):
  - `BOT_API_URL`: URL **HTTPS** que llegue al bot, sin barra final ni parámetros. `http://` solo se acepta para localhost.
  - `BOT_API_TOKEN`: exactamente la `API_TOKEN` del `.env` del bot.
- Configura `WEB_ORIGEN` con el origen HTTPS exacto del dominio usado; para previews configura su origen propio. Si falta, Vercel usa `VERCEL_URL`. Fuera de Vercel, producción rechaza escrituras sin `WEB_ORIGEN`. `DASHBOARD_USER` y `DASHBOARD_PASSWORD` ya no existen: el acceso es por código de WhatsApp.
- **El bot no se despliega en Vercel** (necesita proceso siempre activo, sesión de WhatsApp y SQLite en disco). Debe estar en un equipo o servidor encendido y exponerse por HTTPS: un túnel (p. ej. Cloudflare Tunnel hacia `http://127.0.0.1:3001`) o un servidor propio con proxy HTTPS. Mientras ese equipo esté apagado, la web mostrará «sin conexión con el bot».
- Quien conozca la URL pública del bot puede intentar llegar a su API; la protege `API_TOKEN`. Usa un token largo y aleatorio (32+ caracteres) y no publiques la URL.

## Inicio de sesión (código por WhatsApp)

1. La persona escribe una vez al WhatsApp del bot: así se crea su cuenta (empieza con saldo $0).
2. En la web escribe su número (con indicativo, por ejemplo `573001234567`). El bot le envía un código de 6 dígitos a ese mismo WhatsApp.
3. Escribe el código en la web y entra. El código dura 5 minutos, sirve una sola vez y permite 5 intentos.

Cómo se protege:
- El navegador nunca recibe `BOT_API_TOKEN` ni el token de sesión: este vive en la cookie `finbot_sesion` (HttpOnly, SameSite=Lax y Secure en producción).
- El servidor de Next.js solo reenvía esa cookie al bot; **el bot decide de quién son los datos a partir de la sesión**. La web nunca envía un número ni un id de usuario para elegir la cuenta.
- `proxy.ts` solo manda a `/login` a quien no tiene cookie; la sesión se valida de verdad en el bot en cada consulta, así que una cookie inventada no muestra nada.
- Las rutas `POST /api/auth/*` aceptan solo peticiones hechas desde esta misma web (comprobación de `Origin`).
- Si el número no tiene cuenta, la web responde igual que si la tuviera (no revela qué números existen).
- La sesión dura 7 días. «Cerrar sesión» revoca la sesión en el bot y borra la cookie solo tras confirmarlo. Si falla se reintenta una vez; ante un nuevo fallo devuelve 503, registra el estado sin token y conserva la cookie para reintentar.

## Preview antes de producción

Despliega primero una preview con sus propias variables privadas. Configura en esa preview una URL de API de pruebas accesible por HTTPS y un token válido del entorno de pruebas; valida el estado de salud, resumen, movimientos, categorías, presupuestos, paginación y estados de error/vacío. No pongas datos financieros en URLs de preview. Promueve a producción solo después de confirmar la conectividad desde el entorno desplegado. El repositorio mantiene `@vercel/analytics`; registra métricas de visita y no recibe datos financieros como parámetros de URL.

## Proxies, IP y CSRF

En Vercel (`VERCEL=1`) se usa exclusivamente su `X-Forwarded-For`, sobrescrito por la plataforma. No se mezclan IP de otras cabeceras. Un valor inválido o lista produce `?` y comparte un límite conservador. En desarrollo local también se usa `?` porque `Request` no expone la IP del socket; falsificar cabeceras no permite cambiar de contador.

Para alojar **la web** detrás de Cloudflare Tunnel, configura un gateway interno que sobrescriba `X-Finbot-Proxy` con `PROXY_SECRETO` y bloquee el acceso directo al origen. Solo con `PROXY_IP=cloudflare` y ese secreto correcto se acepta `CF-Connecting-IP`. No basta activar una variable ni añadir una cabecera desde el navegador. Si solo el bot usa Cloudflare Tunnel y la web está en Vercel, no necesitas este modo. Sigue siendo obligatorio el Bearer entre web y bot.

Las rutas POST comparan `Origin` con `WEB_ORIGEN` completo, no con un `X-Forwarded-Host` aportado por el cliente. Rechazan orígenes cruzados, JSON no objeto y cuerpos de más de 8 KiB, incluso sin Content-Length. Los formularios usan `application/x-www-form-urlencoded`. Se limitan las esperas de lectura a 5 segundos y las peticiones al bot a 8 segundos; no se siguen redirecciones con credenciales.

## Verificación

Ejecuta `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build` y `pnpm test:integration`. La última prueba inicia Next.js compilado y la API real sobre SQLite temporal, simula OTP mediante IPC y comprueba sesiones, CRUD, datos ajenos, idempotencia, CSRF y caída del bot. No utiliza WhatsApp ni una base real. No es una prueba visual de navegador; comprueba el contrato HTTP de ambas aplicaciones.

`pnpm audit` incluye desarrollo y puede devolver código 1 por el aviso moderado de minimatch documentado en `../docs/AUDITORIA.md`. `pnpm audit --prod` verifica el árbol de ejecución por separado. La CLI shadcn se retiró del árbol; su CSS se conserva con licencia MIT en `styles/`.

El gráfico de seis meses usa una petición a `/api/resumenes` en lugar de seis a `/api/resumen`. El dashboard pasa de 13 a 8 consultas HTTP al bot (38,5 % menos) sin compartir caché financiera entre usuarios. Los gráficos siguen siendo SVG renderizado en servidor.

Si las escrituras devuelven 403, comprueba `WEB_ORIGEN`, esquema y puerto. Si el bot devuelve 401, revisa primero que ambos tokens coincidan; una sesión vencida conduce a login. Un cierre de sesión con 503 requiere reintentar cuando el bot vuelva. Nunca interpretes la eliminación local de una cookie como prueba de revocación remota.
