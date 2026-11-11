# Endurecer acceso, integridad financiera y panel de FinBot

La web aceptaba cabeceras de IP sin verificar su procedencia, los límites de acceso desaparecían al reiniciar y cerrar sesión podía borrar la cookie sin revocar el token. Este cambio añade límites SQLite compartidos, origen explícito, revocación confirmada y registro cerrado por defecto.

Las acciones financieras se ejecutan en transacciones; se bloquean ediciones de movimientos ligados y borrados parciales que dejarían cobros sin préstamos. Se conserva auditoría de eliminaciones. Las transcripciones no pueden ejecutar comandos destructivos. Se limitan descargas, respuestas IA y cola de mensajes.

El dashboard reduce sus peticiones al bot de 13 a 8. Next.js se actualiza a 16.4.5 y PostCSS a 8.5.23; se retira la CLI shadcn conservando CSS y licencia. CI añade integración HTTP, auditorías y detección básica de secretos.

Validación: 164 pruebas del bot correctas; pruebas web, tipos, lint, compilación e integración Next/API real correctas. Auditorías del bot y runtime web: cero vulnerabilidades conocidas. Audit web completo conserva un aviso moderado de minimatch en desarrollo; no se forzó una actualización mayor.

Antes de operar: configurar NODE_ENV=production, secretos independientes de 32+ caracteres y WEB_ORIGEN; desplegar primero el bot porque la web utiliza /api/resumenes. Validar preview, WhatsApp real, gateway y recuperación externa. No se ha realizado ningún merge ni despliegue de producción.

Informe detallado, evidencias y pendientes: [docs/AUDITORIA.md](AUDITORIA.md).
