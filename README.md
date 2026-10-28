# FinBot

Ayudante financiero personal: registras gastos e ingresos por WhatsApp y los consultas en un panel web.

```
 Tu WhatsApp ──► bot/ (Node + SQLite) ──► API de solo lectura (127.0.0.1:3001)
                                                    ▲
                                  web/ (Next.js, servidor) ──► tu navegador
```

| Carpeta | Qué es | Documentación |
|---|---|---|
| [`bot/`](bot/README.md) | Bot de WhatsApp, base de datos SQLite y API | Node 22.5+, `npm` |
| [`web/`](web/README.md) | Panel web de solo lectura | Next.js, `pnpm` |

Cada carpeta es independiente: tiene su propio `package.json`, sus dependencias y su `.env`.
Se instalan y ejecutan por separado.

## Cómo se conectan

La web nunca habla con WhatsApp ni con la base de datos: solo pide datos a la API del bot,
desde el **servidor** de Next.js (el navegador no ve el token).

Estas variables tienen que coincidir:

| En `bot/.env` | En `web/.env.local` | Nota |
|---|---|---|
| `API_TOKEN` | `BOT_API_TOKEN` | Mismo valor largo y secreto |
| `API_HOST` + `API_PUERTO` (por defecto `127.0.0.1:3001`) | `BOT_API_URL` | Por ejemplo `http://127.0.0.1:3001` |

`DASHBOARD_USER` y `DASHBOARD_PASSWORD` (en `web/.env.local`) protegen el panel con usuario y clave.

## Puesta en marcha rápida

```bash
# 1. Bot (en una terminal)
cd bot
npm ci
cp .env.example .env     # completa NUMEROS_PERMITIDOS, API_TOKEN y, si quieres IA, una clave
npm start                # escanea el QR la primera vez

# 2. Web (en otra terminal)
cd web
pnpm install --frozen-lockfile
cp .env.example .env.local   # BOT_API_URL, BOT_API_TOKEN, DASHBOARD_USER, DASHBOARD_PASSWORD
pnpm dev
```

## Dónde ejecutarlo

El bot debe estar siempre encendido (mantiene la sesión de WhatsApp), así que lo más simple es
ejecutar **bot y web en la misma máquina**, con la API del bot solo en `127.0.0.1`. Para publicar
la web en Vercel haría falta una URL HTTPS privada (por ejemplo un túnel) que llegue al bot; una
dirección `127.0.0.1` no sirve desde fuera de esa máquina.

## Seguridad

No subas a GitHub: `.env`, `.env.local`, `bot/auth/`, ni archivos `*.db` (ya están en `.gitignore`).
