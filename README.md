# FinBot

Asistente financiero personal por WhatsApp con un panel web privado. Permite registrar y consultar movimientos, presupuestos, deudas y préstamos, manteniendo los datos separados por usuario.

## Estructura del proyecto

```text
finbot/
├── bot/    # Bot de WhatsApp, lógica financiera, SQLite y API
└── web/    # Panel web Next.js
```

| Carpeta | Función | Requisitos |
|---|---|---|
| [`bot/`](bot/README.md) | Bot de WhatsApp, base de datos y API | Node.js 22.5 o superior, npm |
| [`web/`](web/README.md) | Panel web de consulta | Node.js y pnpm |

Cada aplicación tiene sus propias dependencias y configuración. Consulta también los README de cada carpeta para conocer sus detalles.

## Cómo funciona el acceso al panel

FinBot utiliza inicio de sesión individual mediante un código enviado por WhatsApp. No se configura un usuario y contraseña compartidos para todo el panel.

1. La persona escribe al número de WhatsApp del bot para crear o activar su cuenta, según la configuración de registro.
2. En el panel web introduce su número de WhatsApp con indicativo internacional, sin el signo `+` ni espacios. Ejemplo: `573001234567`.
3. El bot envía un código de verificación de 6 dígitos a ese número.
4. La persona introduce el código en la web para iniciar sesión.

**Características de seguridad del acceso:**
- El código vence a los 5 minutos, se puede utilizar una sola vez y admite hasta 5 intentos.
- La sesión web dura 7 días.
- La sesión se guarda en una cookie protegida; el navegador no recibe el token privado de la API.
- Cerrar sesión revoca la sesión en el bot y elimina la cookie.
- Si el número no tiene una cuenta, la respuesta no revela si ese número está registrado.

La configuración de registro abierto o restringido se controla desde el bot. Revisa `REGISTRO_ABIERTO`, `NUMEROS_PERMITIDOS` y `NUMEROS_BLOQUEADOS` en `bot/.env.example`.

## Cómo se conectan el bot y la web

La web no accede directamente a WhatsApp ni a SQLite. El servidor de Next.js consulta la API del bot y envía las credenciales privadas desde el servidor.

| Archivo | Variable | Propósito |
|---|---|---|
| `bot/.env` | `API_TOKEN` | Clave secreta que protege la API |
| `web/.env.local` | `BOT_API_TOKEN` | Debe tener el mismo valor que `API_TOKEN` |
| `bot/.env` | `API_HOST` y `API_PUERTO` | Dirección y puerto donde escucha la API |
| `web/.env.local` | `BOT_API_URL` | URL base para que Next.js alcance la API |

En una instalación local, la API utiliza por defecto `http://127.0.0.1:3001`. La URL debe ser alcanzable desde el servidor de Next.js; `127.0.0.1` solo funciona cuando ambos procesos pueden comunicarse en el mismo equipo.

**Importante:** `API_TOKEN` y `BOT_API_TOKEN` deben coincidir. No publiques estos valores ni los incluyas en variables `NEXT_PUBLIC_*`.

## Instalación y ejecución local

Necesitas Node.js 22.5 o superior y pnpm para la aplicación web.

### 1. Configurar y arrancar el bot

Desde la raíz del repositorio:

```bash
cd bot
npm ci
cp .env.example .env
```

Edita `bot/.env` y configura, como mínimo:

- `NUMEROS_PERMITIDOS`: número del propietario con indicativo internacional, sin `+` ni espacios.
- `API_TOKEN`: una clave larga, aleatoria y secreta.
- `API_HOST` y `API_PUERTO`: dirección y puerto de la API, si necesitas cambiar los valores predeterminados.

Después, inicia el bot:

```bash
npm start
```

La primera vez, sigue las instrucciones para vincular WhatsApp mediante el código QR. Mantén el bot en ejecución para que pueda recibir mensajes y enviar códigos de acceso.

### 2. Configurar y arrancar la web

Abre otra terminal, vuelve a la raíz del repositorio y ejecuta:

```bash
cd web
pnpm install --frozen-lockfile
cp .env.example .env.local
```

Edita `web/.env.local` y define:

```dotenv
BOT_API_URL=http://127.0.0.1:50000
BOT_API_TOKEN=el_mismo_valor_de_API_TOKEN
```

Inicia el servidor de desarrollo:

```bash
pnpm dev
```

Abre [http://localhost:3000](http://localhost:3000).

Para comprobar el proyecto antes de desplegarlo:

```bash
pnpm typecheck
pnpm lint
pnpm build
```

## Despliegue

El bot necesita permanecer activo y conectado a WhatsApp. La web puede ejecutarse en la misma máquina o desplegarse por separado, pero el servidor de Next.js debe poder alcanzar la API del bot mediante una conexión segura.

Si despliegas la web en Vercel, configura `BOT_API_URL` y `BOT_API_TOKEN` como variables privadas del entorno. La URL de la API debe ser una dirección HTTPS alcanzable desde Vercel, por ejemplo mediante una arquitectura de túnel privado correctamente protegida. Una dirección `127.0.0.1` configurada en Vercel apunta al propio entorno de Vercel, no al ordenador donde está instalado el bot.

Antes de pasar a producción, prueba la conexión desde un entorno de preview con una API de pruebas y credenciales independientes. Consulta [`web/README.md`](web/README.md) para las recomendaciones específicas del panel.

## Seguridad y datos

- No subas archivos `.env` ni `.env.local`.
- No publiques `API_TOKEN`, `BOT_API_TOKEN`, `SECRETO_SESION` ni claves de proveedores de IA.
- No subas la carpeta `bot/auth/` ni archivos de base de datos `*.db`.
- No expongas la API del bot directamente a Internet sin una arquitectura de acceso seguro.
- No uses prefijos `NEXT_PUBLIC_` para secretos.
- Cada usuario debe consultar únicamente su propia información mediante su sesión.

## Documentación adicional

- [Documentación del bot](bot/README.md)
- [Documentación de la aplicación web](web/README.md)
