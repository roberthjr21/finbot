# Bot financiero por WhatsApp

Le escribes por WhatsApp en lenguaje normal ("compré aceite por 20 mil") y el bot lo
registra en una base de datos SQLite. También te hace resúmenes, controla presupuestos
y expone una API de solo lectura para que tu página web muestre los datos.

```
Tu WhatsApp ──► bot.js (Baileys) ──► ia.js (Claude interpreta)  ──► acciones.js ──► finanzas.db
                     │                                                                  ▲
                     └── comandos.js (/gasto, /resumen... sin IA)                        │
                                                                   api.js (para tu página)┘
```

## Requisitos
- **Node.js 22.5 o superior** (`node --version`). Usa el SQLite que ya trae Node, sin compilar nada.
- **Un número de WhatsApp para el bot** (idealmente uno secundario; Baileys no es oficial y puede
  provocar bloqueos). Tú le escribes desde tu número personal.
- **Una clave de la API de Anthropic** (console.anthropic.com) si quieres escribir en texto libre.
  Es independiente de tu suscripción a Claude y se paga por uso. Sin clave, el bot funciona solo
  con comandos.

## Instalación
```bash
cd ~/bot-financiero
npm ci
cp .env.example .env
nano .env        # pon tu número, tu clave y un API_TOKEN largo
```

`.env.example` documenta la configuración. `MONTO_MAXIMO` define el máximo COP por movimiento y
presupuesto (predeterminado: 100000000); `MODELO_GEMINI` y `MODELO_ANTHROPIC` permiten elegir
modelos distintos. `MODELO_IA` sigue aceptándose por compatibilidad. También existen
`DEBUG`, `MODO_AUTOCHAT`, `ESPERA_RECONEXION_MS`, `API_HOST`, `API_PUERTO`, `ORIGEN_PERMITIDO`,
`DB_ARCHIVO`, `GEMINI_URL` y `ANTHROPIC_URL`.

Si Gemini falla (saturado, modelo retirado o sin responder), el bot reintenta una vez y después
prueba `MODELO_RESPALDO` (por defecto `gemini-flash-lite-latest`; déjalo vacío para desactivarlo).
`TIEMPO_IA_MS` (15000) y `ESPERA_REINTENTO_MS` (1500) ajustan la espera por intento y entre
intentos. Si la IA no responde, las preguntas comunes ("cuánta plata tengo", "cuánto gasté hoy",
"cómo van mis gastos") se resuelven igual, sin IA.

## Primera ejecución (para vincular WhatsApp)
```bash
npm test         # opcional: comprueba que todo está bien (no usa WhatsApp ni internet)
npm start
```
Escanea el QR con el número del bot (WhatsApp → Dispositivos vinculados). Cuando salga
`✅ Bot financiero conectado`, escríbele desde tu número personal. Cierra con `Ctrl + C`.

## Dejarlo en segundo plano (systemd de usuario)
```bash
mkdir -p ~/.config/systemd/user
cat > ~/.config/systemd/user/bot-financiero.service <<'EOF'
[Unit]
Description=Bot financiero de WhatsApp

[Service]
WorkingDirectory=%h/bot-financiero
ExecStart=/usr/bin/node --env-file=%h/bot-financiero/.env %h/bot-financiero/bot.js
Restart=always
RestartSec=10
RestartPreventExitStatus=2

[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
systemctl --user enable --now bot-financiero.service
journalctl --user -u bot-financiero.service -f
```
Ojo: **no ejecutes `npm start` mientras el servicio esté encendido** (dos copias con la misma
sesión se echan una a otra). Usa `systemctl --user stop bot-financiero.service` antes.

Al recibir `SIGINT` o `SIGTERM`, el bot cierra WhatsApp, la API y SQLite para completar el
checkpoint de WAL. systemd puede seguir usando `Restart=always`; tras un cierre solicitado el
servicio se detendrá de forma normal. Si Baileys informa una sesión cerrada o reemplazada, el
proceso termina con código 2; `RestartPreventExitStatus=2` evita un ciclo de reinicios.

## Qué entiende
Texto libre (necesita la clave de IA):
- "compré aceite por 20 mil" · "me pagaron 1,5 millones" · "ayer gasté 8 lucas en bus"
- "cuánto gasté esta semana" · "qué gasté en comida este mes"
- "ponme un presupuesto de 300 mil en comida" · "me equivoqué, borra lo último"
- "cuánta plata tengo" · "cuánto me queda" → responde solo lo que tienes (ingresos − gastos de todo lo
  registrado, sin límite de mes). "de dónde sale" o `/saldo detalle` muestra las cuentas, el mes y lo que debes.
  Si sale negativo, lo avisa: suele faltar anotar como ingreso la plata que tenías antes de empezar.
- "cómo van mis gastos" · "en qué estoy fallando" (compara este mes con el mismo tramo del mes pasado,
  revisa tus presupuestos y te da observaciones concretas)
- "¿cómo empiezo a ahorrar?" (respuestas generales, no es asesoría financiera)
- Solo responde de finanzas personales; otros temas los rechaza con amabilidad.

Comandos (funcionan siempre, también sin IA):
```
/gasto 20000 comida almuerzo        /ingreso 1500000 salario quincena
/resumen [hoy|semana|mes|mes_pasado|anio]
/ultimos [cantidad]    /deshacer
/presupuesto comida 300000          /presupuestos
/analisis                           /saldo
/debo 50000 Juan   /abono 20000 Juan   /deudas [persona]
/borrar ingresos | gastos | deudas | presupuestos | todo
/guia   (guía paso a paso con ejemplos para personas nuevas)
```
Categorías (editables en `categorias.js`): Comida, Transporte, Servicios, Estudio, Salud, Ocio,
Hogar, Mascotas, Ropa, Deudas, Ahorro, Salario, Ventas, Otros.

Deudas (libreta de lo que debes):
- "debo 11 mil a Juan" · "le debo 50 mil a María por el almuerzo" → anota la deuda. **No cambia tu saldo**:
  la plata aún no salió.
- "voy a abonar 5 mil a Juan" · "le pagué 20 mil a María" · "ya le pagué todo a Pedro" → resta de la deuda
  y registra el pago como gasto en la categoría Deudas (ahí sí baja tu saldo). Responde
  "Sigues debiéndole $X" o "✅ Ya pagaste toda la deuda". No deja abonar más de lo que debes.
- "cuánto le debo a Juan" · "cuánto debo en total" · "a quién le debo" → muestra lo que queda por pagar.
- Los nombres no distinguen mayúsculas ni tildes ("juan" es "Juan Pérez"); si hay dos Juan, te pide precisar.
- `/saldo` muestra aparte cuánto debes en total. `/deshacer` también borra la última deuda anotada
  (o el último abono, que devuelve la deuda a como estaba).
- Comandos sin IA: `/debo 50000 Juan` · `/abono 20000 Juan` · `/abono todo Juan` · `/deudas [persona]`.
- Se guardan en la tabla `deudas` de `finanzas.db`; las bases anteriores se actualizan solas al arrancar.

## Varias personas (multiusuario)

Cualquier persona puede escribir al mismo número del bot. **La primera vez que alguien escribe desde un chat individual se le crea una cuenta propia**, con saldo $0 (sin ningún movimiento inventado) y un mensaje de bienvenida. Si ya tiene cuenta, se usa esa. Cada cuenta tiene un id interno estable (para las sesiones web) y su número de WhatsApp normalizado (único), que es la clave de sus datos; movimientos, presupuestos, deudas, análisis y saldo se calculan siempre solo con los datos de esa cuenta.

- La cuenta sale **siempre del remitente real del mensaje** (nunca del texto que escriba). Grupos, estados, canales (newsletters) y mensajes propios del bot no crean cuentas.
- Si WhatsApp entrega solo un identificador LID y no se puede resolver el número de teléfono, el mensaje se ignora (no se crea cuenta).
- Privacidad estricta: no existe panel global ni acceso del propietario a los movimientos de otros. Ojo: es una separación de la aplicación; quien tenga acceso al archivo `finanzas.db` del equipo puede leerlo.

Variables nuevas (todas opcionales):

| Variable | Por defecto | Efecto |
|---|---|---|
| `REGISTRO_ABIERTO` | `1` | `1`: cualquier número nuevo recibe cuenta al escribir. `0`: solo existentes y los de `NUMEROS_PERMITIDOS`. |
| `NUMEROS_PERMITIDOS` | (vacío) | Números que siempre pueden usar el bot (el propietario); sus cuentas se crean al arrancar. Ya no es obligatorio. |
| `NUMEROS_BLOQUEADOS` | (vacío) | Números que el bot ignora siempre. |
| `MAX_MENSAJES_MINUTO` | `20` | Mensajes por minuto por persona. |
| `MAX_MENSAJES_DIA` | `300` | Mensajes por día por persona. |
| `MAX_IA_DIA` | `150` | Consultas a la IA por día por persona; al agotarlas siguen funcionando los comandos y atajos. |
| `SECRETO_SESION` | `API_TOKEN` | Clave con la que se guardan los códigos de acceso (HMAC). Cámbiala si quieres separarla del token. |

**Migración.** Al arrancar con una base anterior, el bot primero hace una copia verificada de `finanzas.db` (junto a ella, con nombre `finanzas.db.antes-multiusuario-FECHA.db`) y luego crea la tabla `usuarios` (id interno estable + número de WhatsApp único, que usan las sesiones web) y una cuenta por cada número que ya tenía datos. Las tablas de datos siguen ligadas por ese número de WhatsApp (columna `usuario`), así que tus datos actuales quedan en tu cuenta sin reasignar ni adivinar ningún dueño. Si la copia falla, el bot no arranca.

**Inicio de sesión web.** El API del bot tiene rutas internas `POST /interno/codigo`, `/interno/verificar` y `/interno/salir` (solo con `API_TOKEN`, pensadas para el servidor de la web). El código se envía por la misma sesión de WhatsApp del bot, solo al número de una cuenta existente, y se guarda con hash; caduca en 5 minutos, es de un solo uso, con máximo 5 intentos y límites por número y por IP. Las rutas de datos (`/api/resumen`, `/api/movimientos`, `/api/presupuestos`, `/api/saldo`, `/api/deudas`, `/api/yo`) exigen además la cabecera `X-Sesion` y la cuenta se deriva de esa sesión. Las sesiones duran 7 días y se pueden revocar (cerrar sesión).

## Guía para personas nuevas
`/guia` (también `/empezar`, `/ejemplos`, `/tutorial`) envía una guía corta con frases de ejemplo para registrar gastos e ingresos, consultar el saldo, usar presupuestos y deudas, y corregir errores. Frases cortas como "cómo funciona", "qué puedes hacer", "ayuda" o "no sé qué hacer" también la muestran, sin gastar IA. El mensaje de bienvenida de una cuenta nueva la menciona. El texto está en `GUIA`, en `comandos.js`, por si quieres cambiarlo.

## Borrar datos en bloque
`/borrar todos mis ingresos` (o `/borrar gastos`, `/borrar deudas`, `/borrar presupuestos`, `/borrar movimientos`, `/borrar todo`) y también frases como "borra todos mis ingresos" o "quiero empezar de cero".

Es un borrado real y sin vuelta atrás, así que funciona en dos pasos: primero el bot dice cuánto va a borrar y no toca nada; solo se borra cuando escribes `/borrar confirmar` en los siguientes 2 minutos (`/borrar cancelar` lo anula). **La IA nunca puede confirmar**: la confirmación solo vale si la escribes tú como comando. Solo afecta a tu cuenta, nunca a la de otras personas. Al borrar gastos también se deshacen los abonos de deuda que ellos respaldaban. Haz antes un respaldo si dudas (sección "Respaldo y restauración").

## API para tu página
Solo lectura, con token. Por defecto escucha en `127.0.0.1:3001` y acepta peticiones desde
`http://localhost:3000` (cámbialo con `ORIGEN_PERMITIDO`).

Todas las peticiones llevan la cabecera `Authorization: Bearer TU_API_TOKEN`.

| Ruta | Qué devuelve |
|---|---|
| `GET /api/salud` | `{ "ok": true }` |
| `GET /api/categorias` | Lista de categorías |
| `GET /api/resumen?mes=2026-10` | `{ mes, desde, hasta, ingresos, gastos, balance, porCategoria: [{categoria, total}] }` |
| `GET /api/movimientos?desde=&hasta=&tipo=&categoria=&limite=&offset=` | `[{ id, tipo, monto, categoria, descripcion, fecha }]` (más recientes primero; `offset` permite paginar) |
| `GET /api/presupuestos?mes=2026-10` | `[{ categoria, limite, gastado, porcentaje }]` |

Ejemplo desde tu página (Next.js, en el servidor para no exponer el token en el navegador):
```js
const res = await fetch('http://127.0.0.1:3001/api/resumen?mes=2026-10', {
  headers: { Authorization: `Bearer ${process.env.API_TOKEN}` },
});
const resumen = await res.json();
```
Los montos son pesos enteros y las fechas vienen como `AAAA-MM-DD` (hora de Bogotá).
`offset` es un entero entre 0 y 1.000.000. `mes` solo aplica a resumen y presupuestos, con años
entre 1000 y 9999.

## Respaldo y restauración de SQLite

No copies `finanzas.db` por separado: mientras SQLite está en modo WAL, parte de los datos puede
estar en `finanzas.db-wal`. Genera respaldos consistentes con `VACUUM INTO`:

```bash
node db-admin.js backup finanzas.db respaldos/finanzas-$(date +%F-%H%M%S).db
```

El comando valida integridad y tablas antes y después; no sobrescribe un destino existente. Para
restaurar, usa una ruta nueva (el comando se niega a sobrescribir):

```bash
node db-admin.js restore respaldos/finanzas-AAAA-MM-DD-HHMMSS.db finanzas-restaurada.db
DB_ARCHIVO=finanzas-restaurada.db npm start
```

La restauración conserva el archivo original. Detén el bot antes de restaurar y comprueba que
`DB_ARCHIVO` apunta a la ruta restaurada. No subas respaldos a GitHub.

## Privacidad y límites
- Los montos usan pesos enteros COP y aceptan punto como separador de miles y coma decimal;
  las fracciones de peso se redondean al entero más cercano y formatos ambiguos como `20.5` se
  rechazan. El máximo predeterminado es $100.000.000 por movimiento o
  presupuesto y se puede cambiar con `MONTO_MAXIMO`.
- `/deshacer` solo muestra el movimiento candidato. Para borrarlo debes enviar `/deshacer confirmar`
  dentro de dos minutos; `/deshacer cancelar` cancela la solicitud. Solo permite movimientos
  creados en las últimas 24 horas.
- **Tus mensajes se envían al proveedor IA configurado** para interpretarlos (solo el texto de
  cada mensaje, no tu historial): Gemini si hay `GEMINI_API_KEY`; de lo contrario Anthropic si
  hay `ANTHROPIC_API_KEY`. Sin esas claves solo funcionan los comandos.
- **El análisis de gastos (`/analisis` o "cómo van mis gastos") sí envía tus cifras** al proveedor
  IA: totales por categoría de este mes y del mismo tramo del mes pasado, presupuestos con lo
  gastado y tus tres mayores gastos (monto y categoría). No envía las descripciones que escribes.
  Las cuentas las hace el bot; la IA solo las interpreta. Si la IA no responde, el bot contesta
  con un análisis básico calculado localmente.
- **Solo responde a los números de `NUMEROS_PERMITIDOS`.** Los remitentes no autorizados se
  ignoran y solo se registra un contador, sin números telefónicos.
- Los datos viven en `finanzas.db` (más `finanzas.db-wal` y `-shm` mientras corre). Para un
  respaldo o restauración, sigue los comandos de la sección anterior. No subas `.env`, `auth/`
  ni `*.db` a GitHub.
- Si el bot estuvo apagado, atiende los mensajes de hasta 3 días que WhatsApp le entregue y los
  registra con la fecha en que los escribiste.
- Es una herramienta de registro y organización. Las respuestas generales no son asesoría
  financiera.
