# Integración segura del PR #31 con las correcciones de FinBot

Esta integración parte del PR #34 (que incluye las correcciones de los PR #30, #32 y #33).
El PR #31 original tiene conflictos y no debe aplicarse mediante sobrescritura de sus archivos antiguos.

## Funciones recuperadas
- `/diagnostico` y `/estado`: resumen limitado a la cuenta del remitente, con uso diario,
  mensajes pendientes, capacidad de IA, multimedia y estado de pruebas. No imprime claves,
  números telefónicos ni datos de otras cuentas. No afirma comprobar conectividad externa.
- Expiración de las confirmaciones y recargas pendientes a los diez minutos, sin modificar el
  contrato público de `contexto.obtener` ni eliminar correcciones recientes del historial.
- Errores de proveedor clasificados y mensajes legibles sin respuesta de error cruda; cuota 429
  con espera respetando segundos o fecha HTTP `Retry-After`, con máximo de quince minutos.
- Metadatos adicionales de comprobantes para explicar transferencias y recargas sin crear
  bloqueos por coincidencias dudosas de fecha, monto o referencia.
- Pruebas de diagnóstico por cuenta, expiración, respuestas de IA, tiempos de cuota y contexto.

## Funciones originales que NO deben volver a incorporarse
- `cola-usuarios.js` del PR #31: cola en memoria sin recuperación después de reiniciar;
  se mantiene exclusivamente la cola persistente `trabajos.js` del código actual.
- Bloqueo automático de comprobantes por huellas ambiguas: dos pagos válidos podrían tener
  igual importe y hora; se mantiene la advertencia de `posibleDuplicado`, con confirmación.
- Marcadores escritos antes de confirmar una transacción financiera: se mantiene la
  atomicidad actual y no se vuelve a `marcarProcesado` de forma anticipada.
- Sustitución de archivos completos de seguridad, inicio, contexto o pruebas por la versión
  antigua del PR #31.

## Orden de integración recomendado
1. Revisar y fusionar el PR #34 una vez aprobados sus controles y pruebas.
2. Confirmar que el PR #31 actualizado pasa CI y no tiene comentarios bloqueantes.
3. Fusionar el PR #31 posteriormente, sin restaurar el árbol de código histórico.
4. Probar con base temporal y WhatsApp de prueba antes del despliegue real.

Este documento no autoriza modificaciones de bases de datos reales ni despliegues. Las
pruebas de CI no sustituyen una prueba operativa con WhatsApp, Gemini/Claude y Vercel.
