# FinBot Finance (web)

Panel de solo lectura para consultar la API existente del bot de WhatsApp. La web solo muestra resumen mensual, movimientos, categorías y presupuestos; no registra ni borra datos.

## Variables de entorno

Configura en el entorno privado del servidor Next.js:

- `BOT_API_URL`: URL base alcanzable del API del bot.
- `BOT_API_TOKEN`: token que el servidor envía como `Authorization: Bearer …`.
- `DASHBOARD_USER` y `DASHBOARD_PASSWORD`: credenciales Basic Auth que protegen el panel.

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

El panel está protegido con Basic Auth mediante `DASHBOARD_USER` y `DASHBOARD_PASSWORD`; configura ambos en el entorno del servidor y usa HTTPS en cualquier despliegue. El usuario no puede contener `:`. Cada consulta al bot verifica también la autenticación del panel.

## Preview antes de producción

Despliega primero una preview con sus propias variables privadas. Configura en esa preview una URL de API de pruebas accesible por HTTPS y un token válido del entorno de pruebas; valida el estado de salud, resumen, movimientos, categorías, presupuestos, paginación y estados de error/vacío. No pongas datos financieros en URLs de preview. Promueve a producción solo después de confirmar la conectividad desde el entorno desplegado. El repositorio mantiene `@vercel/analytics`; registra métricas de visita y no recibe datos financieros como parámetros de URL.
