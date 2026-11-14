# Correcciones de la revisión del PR #33

Fecha: 14 de noviembre de 2026. Rama: fix/finbot-reliability-phase-3.
Commit auditado: cc99fc9fb59c33ef230ec9fe33faf112cc8dc606.

GitHub informa que el PR #33 ya estaba fusionado (merge 3c2e289, 08:06:24 UTC).
Esta revisión no ejecutó merge ni despliegue. Los nuevos commits se publican en
la rama solicitada y se presentan en un PR de seguimiento en borrador.

## Evidencia antes y después

Se copiaron las tres regresiones principales a un worktree desechable del commit
original y se ejecutaron con:

    node --test --test-name-pattern='eliminar cuenta borra|fallo después de reservar|500 entradas activas' bot/entradas.test.js bot/analisis-recuperacion.test.js

Las tres fallaron en el original y pasan con las correcciones:

| Caso | Original | Corrección y evidencia |
|---|---|---|
| Privacidad | El plan contaba 0 marcadores en lugar de 2 | El inventario, su huella, DELETE y verificación final incluyen entrada:<telefono>:<mensajeId>. Se procesan /prueba on y /prueba off; se borra la cuenta y quedan 0 marcadores. |
| Cola llena | La primera reserva falla con «Cola de análisis saturada» | 500 entradas crean sus continuaciones sin perder capacidad. Se confirman 500 movimientos por un total de 50.000 pesos ficticios, se entregan 500 respuestas y todos los trabajos terminan hechos con exactamente 1 intento. |
| Rollback temporal | Permanecen 3 trabajos persistentes tras fallar COMMIT | Se reserva éxito y análisis, se provoca una violación de FK diferida al confirmar SQLite temporal y se comprueba que no quedan reservas ni movimientos temporales ni envíos. Reintentar confirma 1 operación y entrega 1 respuesta. |

La prueba de privacidad también introduce un marcador después de preparar el plan:
se rechaza el plan obsoleto. Un trigger reintroduce un marcador durante el borrado:
la verificación final lo detecta y revierte la eliminación completa.

Los mensajes y análisis tienen cupos independientes, cada uno de 500 por cuenta
y 5.000 globales. El máximo combinado de entradas pasa a 1.000 por cuenta y
10.000 globales; las salidas siguen limitadas a 500/5.000. No se suprimen límites.
Otra regresión verifica ambos cupos, rechazo global entre cuentas, FIFO y que dos
trabajos de entrada de la misma cuenta no posean un lease simultáneo.

La coordinación temporal abre la transacción persistente antes de la temporal y
confirma las reservas después del commit temporal. Un SAVEPOINT temporal fallido
revierte sus reservas persistentes aunque el callback exterior capture el error.
Se comprueba que las reservas de la operación exterior sí pueden confirmarse.
No hay transacción distribuida ni durabilidad de los datos temporales: un reinicio
sigue cancelando trabajos cuya sesión de prueba se perdió. En ningún caso se
recuperan operaciones de prueba contra finanzas reales.

## Otros dos comentarios confirmados del PR

- Un análisis omitido por cuenta inactiva puede finalizar sin completar su
  reserva. La recuperación incluye dependencias hechas que siguen esperando y
  entrega un aviso de fallo antes de las respuestas posteriores. La prueba
  bloquea la cuenta, finaliza sin callback, reactiva y comprueba las dos salidas.
- Una reserva ilegible se cancela individualmente y elimina su cuerpo. La prueba
  usa un contenido cifrado inválido y comprueba que la otra reserva y otra cuenta
  siguen enviándose; el siguiente mantenimiento no vuelve a seleccionar la fila.

## Validación final

- Bot: npm test, **227/227**, sin omitidos ni cancelados (antes: 220 pruebas).
- Web: pnpm test, **11/11**; pnpm typecheck, pnpm lint y pnpm build aprobados.
- Integración HTTP: **1/1**; navegador Chromium: **1/1**.
- Python: **3/3** con unittest discover.
- node scripts/verificar-bot.mjs: sintaxis aprobada sin iniciar servicios.
- python3 scripts/verificar-secretos.py: sin patrones de secretos detectados.
- npm audit --audit-level=moderate: **0 vulnerabilidades**.
- pnpm audit --prod --audit-level=moderate y pnpm audit --audit-level=moderate:
  **0 vulnerabilidades conocidas**.
- git diff --check: aprobado.

Todas las pruebas financieras usan DB_ARCHIVO en carpetas temporales y SQLite
en memoria. No se abrió ni modificó una base financiera real, no se inició el bot
de WhatsApp, no se aplicaron migraciones a producción y no se cambiaron archivos
del checkout original. El archivo no versionado web/tsconfig.tsbuildinfo ya
existía en el worktree y no forma parte de los commits.
