#!/usr/bin/bash

# Lanzador exclusivo para desarrollo: la web utiliza next dev.
if [[ "${NODE_ENV:-development}" == "production" ]]; then
    echo "iniciar.sh es solo para desarrollo; usa los servicios de producción separados." >&2
    exit 1
fi

cd "$(dirname "$0")" || exit 1

# Cerrar los procesos hijos al detener el servicio
trap 'kill $(jobs -pr) 2>/dev/null; wait' EXIT INT TERM

# Iniciar bot
(
    cd bot || exit 1
    npm start
) &

# Iniciar página web
(
    cd web || exit 1
    pnpm dev
) &

wait
