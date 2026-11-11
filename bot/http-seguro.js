// Limita la respuesta real, aunque el proveedor omita Content-Length.
export async function leerJsonAcotado(respuesta, maximo = 512 * 1024) {
  if (Number(respuesta.headers.get('content-length')) > maximo) {
    await respuesta.body?.cancel();
    throw new Error('Respuesta del proveedor demasiado grande');
  }
  const lector = respuesta.body?.getReader();
  if (!lector) throw new Error('Respuesta vacía del proveedor');
  const partes = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await lector.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximo) throw new Error('Respuesta del proveedor demasiado grande');
      partes.push(value);
    }
    return JSON.parse(Buffer.concat(partes).toString('utf8'));
  } catch (error) {
    await lector.cancel().catch(() => {});
    throw error;
  } finally { lector.releaseLock(); }
}
