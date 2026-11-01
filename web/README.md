# FinBot Finance (web)

Panel de solo lectura para consultar la API del bot de WhatsApp. Es una sola web para todos: cada persona entra con su propio número de WhatsApp y ve únicamente sus datos (saldo, resumen mensual, movimientos, presupuestos y deudas). No registra ni borra datos.

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

La arquitectura de red para despliegue aún debe decidirse. En Vercel configura una URL HTTPS privada que pueda alcanzar el servidor del bot mediante un túnel privado, o ejecuta el bot en un servidor siempre encendido y accesible por HTTPS. Una dirección loopback como `127.0.0.1` solo apunta al mismo equipo del proceso web y no sirve para llegar desde Vercel al equipo donde se ejecuta el bot.

## Inicio de sesión (código por WhatsApp)

1. La persona escribe una vez al WhatsApp del bot: así se crea su cuenta (empieza con saldo $0).
2. En la web escribe su número (con indicativo, por ejemplo `573001234567`). El bot le envía un código de 6 dígitos a ese mismo WhatsApp.
3. Escribe el código en la web y entra. El código dura 5 minutos, sirve una sola vez y permite 5 intentos.

Cómo se protege:
- El navegador nunca recibe `BOT_API_TOKEN` ni el token de sesión: este vive en la cookie `finbot_sesion` (HttpOnly, SameSite=Lax y Secure bajo HTTPS).
- El servidor de Next.js solo reenvía esa cookie al bot; **el bot decide de quién son los datos a partir de la sesión**. La web nunca envía un número ni un id de usuario para elegir la cuenta.
- `proxy.ts` solo manda a `/login` a quien no tiene cookie; la sesión se valida de verdad en el bot en cada consulta, así que una cookie inventada no muestra nada.
- Las rutas `POST /api/auth/*` aceptan solo peticiones hechas desde esta misma web (comprobación de `Origin`).
- Si el número no tiene cuenta, la web responde igual que si la tuviera (no revela qué números existen).
- La sesión dura 7 días. «Cerrar sesión» revoca la sesión en el bot y borra la cookie.

## Preview antes de producción

Despliega primero una preview con sus propias variables privadas. Configura en esa preview una URL de API de pruebas accesible por HTTPS y un token válido del entorno de pruebas; valida el estado de salud, resumen, movimientos, categorías, presupuestos, paginación y estados de error/vacío. No pongas datos financieros en URLs de preview. Promueve a producción solo después de confirmar la conectividad desde el entorno desplegado. El repositorio mantiene `@vercel/analytics`; registra métricas de visita y no recibe datos financieros como parámetros de URL.
