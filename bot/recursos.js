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

// Libera el trabajo si el transporte no responde. No puede retirar un mensaje ya enviado.
export async function enviarConTiempo(enviar, tiempoMs = 6000) {
  let timer;
  try {
    return await Promise.race([Promise.resolve().then(enviar), new Promise((_,reject) => { timer=setTimeout(()=>reject(new Error('Tiempo de envío agotado')),tiempoMs); })]);
  } finally { clearTimeout(timer); }
}
