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
- Cerrar sesión revoca la sesión en el bot y elimina la cookie únicamente cuando se confirma la revocación. Si el bot está caído, se informa el error y se permite reintentar.
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

## Migraciones y respaldos

- La base usa **migraciones versionadas** (`bot/migraciones.js`, tabla `schema_migraciones`). Solo se agregan cambios aditivos. Si hay una migración pendiente y la base tiene datos, antes se guarda una **copia verificada** (`finanzas.db.antes-vN-<fecha>.db`); si la copia falla, el bot no migra.
- El bot hace **respaldos automáticos** al arrancar y cada `RESPALDO_CADA_HORAS` horas (por defecto 24), en `respaldos/` junto a la base. Se conservan los últimos `RESPALDO_CONSERVAR` (7). Cada copia se verifica antes de guardarse.
- **Respaldo manual:** `node db-admin.js backup finanzas.db respaldos/manual.db`
- **Restaurar** (con el bot detenido; nunca sobrescribe): `node db-admin.js restore respaldos/<copia>.db finanzas-restaurada.db`, revisa que todo esté bien y luego reemplaza `finanzas.db` por ese archivo.

## Recordatorios, recurrentes, metas y alertas (FinBot 2.0, fase 2)

Todo vive en la misma base SQLite (migración v3) y cada persona solo ve lo suyo. El *programador* (`bot/programador.js`) corre dentro del bot cada minuto:

| Función | Comandos de WhatsApp | Notas |
|---|---|---|
| Recordatorios | `/recordar mañana pagar arriendo 800000`, `/recordatorios`, `/listo N`, `/cancelarrecordatorio N`, `/editarrecordatorio N 15/12 08:00` | Si el bot estuvo apagado, lo vencido se envía al volver (una sola vez). |
| Recurrentes | `/recurrente gasto 30000 servicios mensual Netflix`, `/recurrentes`, `/pausar N`, `/reactivar N`, `/eliminarrecurrente N` | *Programado* ≠ *ejecutado*: crear uno no registra nada; cada fecha se registra una sola vez (clave única), aunque el bot se reinicie. Al reactivar no se recupera lo de la pausa. |
| Metas de ahorro | `/meta Viaje 3000000 200000 mensual`, `/metas`, `/aportar Viaje 50000`, `/retirarmeta Viaje 50000` | Los aportes no crean movimientos: el ahorro no se cuenta dos veces. |
| Alertas | `/alertas`, `/alertas presupuestos no`, `/alertas silencio 23:00 06:00`, `/alertas maximo 3` | Presupuesto 80/90/100 %, picos y gastos inusuales, pagos próximos, deudas/préstamos de más de 30 días, metas y cierre de mes. Una alerta no se repite, se agrupan en un mensaje y respetan el horario de silencio. Se calculan con código, no con IA. |
| Contexto | "mejor ponlo en transporte", "era de 30 mil", `sí` / `no` | Guarda solo el último movimiento y confirmaciones pendientes (no el texto), por persona, y vence a los 30 minutos (`CONTEXTO_MINUTOS`). |
| Notas de voz | Mandar un audio | Se transcribe con Gemini, se muestra lo entendido y **solo se guarda si respondes sí**. |
| Fotos de recibos | Mandar la foto | Gemini extrae comercio, fecha, total y categoría; el código los valida; pides confirmar. La misma imagen no se registra dos veces y se avisa si ya hay un gasto igual ese día. |

Voz e imágenes requieren `GEMINI_API_KEY` (el mismo de la IA) y se apagan con `MEDIA_ACTIVA=0`. No se guardan audios, imágenes ni transcripciones. Variables nuevas en `bot/.env.example`.

## Cómo se calculan las cifras

Todo está en `bot/finanzas.js` (una sola fuente para el bot, el análisis, los consejos y la API):

- **Saldo en mano**: todo lo registrado (prestar o abonar una deuda saca plata; cobrar un préstamo la mete).
- **Ingresos y Gastos del periodo**: solo movimiento normal. No incluyen préstamos que hiciste, lo que te devolvieron, ni abonos a tus deudas.
- **Aparte**: `Prestado`, `Cobrado` y `Pagos de deudas` (la API los expone como `prestado`, `cobrado`, `pagosDeuda`).
- **Lo que debo** y **lo que me deben** son listas distintas y nunca se suman entre sí.

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
BOT_API_URL=http://127.0.0.1:3001
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

## Endurecimiento y validación

El registro está **cerrado por defecto**: configura `NUMEROS_PERMITIDOS`. Solo `REGISTRO_ABIERTO=1` habilita acceso público explícito. En producción define `NODE_ENV=production`, `API_TOKEN` y `SECRETO_SESION` independientes, aleatorios y de al menos 32 caracteres. En la web configura `WEB_ORIGEN=https://tu-dominio` además de las variables del bot; las cookies de producción son Secure.

Los límites de códigos, verificaciones y escrituras viven en SQLite (migración v4), sobreviven a reinicios y reservan contadores dentro de transacciones. La migración v5 conserva snapshots de eliminaciones financieras en auditoría. No elimines estas tablas para desbloquear intentos: espera su vencimiento.

Consulta el [informe de auditoría](docs/AUDITORIA.md) para evidencia, limitaciones y preparación de producción. Las pruebas se ejecutan con bases temporales; no requieren vincular WhatsApp ni cargar credenciales reales.

```sh
cd bot
npm ci
npm test
npm audit
cd ../web
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm test:integration
pnpm audit
```

La integración arranca dos servidores locales y requiere permiso para escuchar en loopback. No ejecuta el bot de WhatsApp ni despliega aplicaciones. El aviso moderado de minimatch en herramientas de desarrollo se registra en el informe; no se ocultan los resultados de audit.
