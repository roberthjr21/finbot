// Corta la descarga antes de materializar un archivo completo en memoria.
export async function acumularMedia(stream, maximo, tiempoMs = 15_000) {
  const partes = [];
  let total = 0;
  const temporizador = setTimeout(() => stream.destroy(new Error('Descarga agotó el tiempo permitido')), tiempoMs);
  try {
    for await (const parte of stream) {
      total += parte.length;
      if (total > maximo) throw new Error('Archivo demasiado grande');
      partes.push(parte);
    }
    if (!total) throw new Error('Archivo vacío');
    return Buffer.concat(partes);
  } finally { clearTimeout(temporizador); stream.destroy(); }
}
