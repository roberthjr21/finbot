# FinBot Finance (web)

El panel consulta los datos guardados por el bot de WhatsApp. El flujo es:

`WhatsApp → bot → SQLite → API de solo lectura del bot → servidor Next.js → navegador`

La web no escribe en la base de datos ni crea claves API en el navegador. El token se usa únicamente en el servidor Next.js.

## Configuración

1. Copia `.env.example` a `.env.local` para desarrollo.
2. Define `BOT_API_URL` y `BOT_API_TOKEN` en el entorno privado del servidor web.
3. Instala dependencias con `pnpm install --frozen-lockfile` y ejecuta `pnpm dev`.

`BOT_API_URL` debe apuntar a la API del bot. En la misma computadora puede ser `http://127.0.0.1:3001`. Para una web alojada fuera de esa computadora se requiere una URL HTTPS privada que alcance el bot, o alojar bot y API en un servidor siempre encendido. No uses `NEXT_PUBLIC_` en estas variables ni compartas el token en el navegador o en el chat.

El API existente entrega el resumen mensual, movimientos paginados y presupuestos. La interfaz muestra esas tres funciones y los estados de configuración, conexión y datos vacíos. La conexión es de solo lectura y sirve al usuario predeterminado configurado en el bot.

## Comprobaciones

- `pnpm typecheck`
- `pnpm build`
