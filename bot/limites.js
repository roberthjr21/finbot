// Límites simples contra abuso. Todo en memoria: se reinicia al reiniciar el bot.

export const entero = (nombre, porDefecto) => {
  const valor = Number(process.env[nombre]);
  return Number.isInteger(valor) && valor > 0 ? valor : porDefecto;
};

// Ventana deslizante: como máximo "max" intentos por clave en "ventanaMs".
export function crearLimitador({ max, ventanaMs }) {
  const registros = new Map();
  return {
    intentar(clave, ahora = Date.now()) {
      const desde = ahora - ventanaMs;
      const recientes = (registros.get(clave) ?? []).filter((t) => t > desde);
      if (recientes.length >= max) {
        registros.set(clave, recientes);
        return { ok: false, reintentoMs: recientes[0] + ventanaMs - ahora };
      }
      recientes.push(ahora);
      registros.set(clave, recientes);
      if (registros.size > 5000) {
        for (const [k, v] of registros) if (!v.some((t) => t > desde)) registros.delete(k);
      }
      return { ok: true, reintentoMs: 0 };
    },
  };
}
