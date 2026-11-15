# Estabilización de FinBot (rama independiente)

Cambios orientados a confiabilidad. No se cambió el esquema de datos ni se
desplegó en producción.

1. **IA**: se recuperó el control de enfriamiento 429 antes de cada reintento
   para evitar llamadas durante un bloqueo activado por otra solicitud.
   `PROVEEDOR_IA` permite seleccionar Gemini o Claude y los modelos
   heredados nunca se cruzan entre proveedores.
2. **Permisos**: `umask 077`, SQLite y WAL/SHM `0600`, autenticación
   WhatsApp `0700/0600`, respaldos privados y herramientas offline
   protegidas en Linux. No se tocan directorios padres ajenos.
3. **Programador**: seguimiento en memoria del último ciclo, último éxito y
   etapas fallidas; `/diagnostico` muestra solo estado y nombre de las etapas.
4. **Pruebas**: regresiones para el cooldown concurrente, configuración de
   proveedor, permisos y fallos del programador. CI verifica bot, web, build,
   navegador, dependencias y detección básica de secretos.

## Verificación de despliegue que requiere acceso real

- Usar una copia de SQLite y credenciales de WhatsApp de prueba, nunca la base
  financiera real para validar migraciones o nuevas versiones.
- Examinar permisos de la ruta instalada. En Fedora, los archivos del bot deben
  pertenecer al usuario dedicado; comprobar `stat -c '%a %n'` sobre DB/WAL,
  `auth/` y la carpeta de respaldos, sin imprimir el contenido de las claves.
- Asegurar una sola instancia de Baileys. Reiniciar mientras hay trabajos de
  prueba y confirmar que saldos y mensajes no se duplican.
- Probar Gemini y Claude por separado con sus claves de prueba, cuotas 429 y
  fallback sin IA; usar `/diagnostico` para ver el estado del programador.
- Comprobar Vercel + túnel HTTPS en una preview separada, cookies Secure, OTP,
  CSRF, CRUD y revocación.
- Restaurar una copia cifrada a una ruta nueva y ejecutar `node estado.js`
  sobre esa copia; no sobrescribir `finanzas.db`.
- Configurar protección obligatoria de `main` en GitHub (requiere Admin).
- Solicitar revisión independiente, CI verde y aprobación antes del merge.

Los respaldos locales automáticos siguen siendo SQLite verificadas *sin
cifrar*. Se debe usar `respaldo-cifrado.js` y una gestión segura de la frase
para copias externas; esto no se automatiza sin diseño de custodia de claves.
