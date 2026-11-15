# Preview de Vercel y propuesta de protección

## Preview aislada, sin despliegue automático

No se desplegó una preview ni se expuso la API durante esta etapa. El build, las pruebas de origen/cookies y los ensayos de navegador son locales. No demuestran conectividad del equipo del bot desde Vercel, certificados o reglas del túnel.

1. Usar un bot y una base de **pruebas**, números permitidos y credenciales independientes. No reutilizar `auth/` ni bases reales. Instalar primero el bot actualizado (migración v6); verificar copia previa, `node estado.js` y registros.
2. Configurar servicio con Node 22 actualizado, `NODE_ENV=production`, `REGISTRO_ABIERTO=0`, `NUMEROS_PERMITIDOS` de pruebas, `API_HOST=127.0.0.1`, `API_PUERTO=3001`, `API_TOKEN` y `SECRETO_SESION` fuertes e independientes. Configurar `COLA_SECRETO` de 32+ caracteres; si se omite se usa la clave de sesión.
3. Preparar HTTPS/túnel y control de acceso sin publicar la API directa. Comprobar que el origen no sea accesible por una ruta que evite el gateway. Esta auditoría no habilita puertos ni instala un túnel.
4. En Vercel usar raíz `web`, instalar con `pnpm install --frozen-lockfile` y compilar con `pnpm build`. Playwright solo es dependencia de desarrollo para pruebas, no se lanza durante el build ni en el servidor web.
5. Variables privadas, distintas para cada entorno:

   | Variable | Preview |
   |---|---|
   | `BOT_API_URL` | URL HTTPS alcanzable del bot de pruebas. Loopback en Vercel no apunta al computador del bot. |
   | `BOT_API_TOKEN` | Mismo token del bot de pruebas; mínimo 32 caracteres. Sin prefijo NEXT_PUBLIC_. |
   | `WEB_ORIGEN` | Origen HTTPS exacto de la preview o dominio personalizado, sin ruta, credenciales, query ni fragmento. |

6. Si se omite WEB_ORIGEN en Vercel, la web usa `https://${VERCEL_URL}`. Ese origen puede diferir del dominio personalizado o alias de rama: para ellos configurar explícitamente WEB_ORIGEN. No se aceptan comodines `*.vercel.app`, listas suministradas por cabeceras ni X-Forwarded-Host como autorización.
7. La IP en Vercel deriva solo de su X-Forwarded-For validado. Si falta, se usa `?`. Las cuotas de IP desconocida son agregadas y más amplias (120 solicitudes de código/hora, 240 verificaciones/hora por defecto), junto con los límites de teléfono que no se reducen. No se inventa una IP desde una cookie o teléfono.
8. Si la **web** usa alojamiento propio detrás de Cloudflare Tunnel, configurar gateway que sobrescriba X-Finbot-Proxy con PROXY_SECRETO, modo PROXY_IP=cloudflare y acceso directo bloqueado. El túnel que solo publica el bot no requiere ese modo en la web de Vercel.
9. Las cookies son HttpOnly, SameSite=Lax, Secure en producción y limitadas al host. Verificar en la preview real que el navegador las recibe bajo HTTPS, que el origen exacto permite POST y que otra preview/dominio no pueda efectuar escrituras.
10. Ejecutar los casos de acceso, OTP, reemplazo y revocación, navegación protegida, CRUD, datos ajenos y desconexión. Probar que el bot apagado informa falta de conexión y no afirma una revocación inexistente. Validar audio/imagen, reconexión, avisos y cola con WhatsApp real de pruebas.

Las pruebas E2E locales usan HTTP loopback con una cookie exclusiva de la fixture; las propiedades Secure se comprueban por HTTP en la integración, pero el certificado, navegador y gateway de producción todavía requieren la preview HTTPS real.

## Rotación

- API: transición breve con API_TOKEN_ANTERIOR fuerte e independiente, cambio de BOT_API_TOKEN, comprobación y retiro de la anterior. No conservar una clave comprometida para facilitar despliegues.
- Cola: preferir clave propia COLA_SECRETO. Durante una rotación controlada se acepta COLA_SECRETO_ANTERIOR para descifrar trabajos pendientes. Retirarla al drenar la cola y evaluar copias antiguas. Perder esa clave puede impedir recuperar cuerpos; los importes ya confirmados no dependen de ella.
- Reemplazo de sesión: el bot crea la nueva y revoca la anterior en una sola transacción. Actualizar primero el bot para que no exista una ventana con la web nueva y un backend que ignore tokenAnterior.
- Analítica: solo se monta automáticamente en Vercel. Su beforeSend quita queries, fragmentos e IDs numéricos de movimientos. No enviar datos financieros como eventos personalizados.

## Propuesta de protección de main — no aplicada

El archivo `.github/propuestas/proteccion-main.json` contiene una propuesta revisable; ningún workflow la aplica. Requiere aprobación explícita del propietario antes de cambiar reglas del repositorio.

Propone PR obligatorio, una revisión, invalidar revisiones desactualizadas, conversaciones resueltas, rama actualizada y tres checks correctos:

- Secretos y artefactos privados.
- Bot (pruebas).
- Web (typecheck, lint y build).

Aplica también a administradores, bloquea force-push y eliminación de main. Revisar los nombres exactos de checks en el PR, políticas de recuperación, colaboradores que puedan revisar y posibles reglas existentes antes de aprobar. No habilita merge automático ni despliegues.

Referencia de configuración: [GitHub: protección de ramas](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches).
