// Redacción de registros (logs): nunca deben quedar claves, tokens, material criptográfico ni
// números de cuenta o tarjeta, ni siquiera dentro del texto de un error de una API.

const REGLAS = [
  [/AIza[0-9A-Za-z_-]{20,}/g, '[clave oculta]'], // claves de Google/Gemini
  [/sk-ant-[0-9A-Za-z_-]{10,}/g, '[clave oculta]'], // claves de Anthropic
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 [oculto]'],
  [/((?:api[_-]?key|token|secret|password|clave)["']?\s*[:=]\s*["']?)[^\s"',;&]{4,}/gi, '$1[oculto]'],
  [/-----BEGIN [A-Z ]*(?:PRIVATE KEY|KEY)-----[\s\S]*?(?:-----END [A-Z ]*-----|$)/g, '[material criptográfico oculto]'],
  [/\b[A-Za-z0-9+/_-]{40,}={0,2}/g, '[dato largo oculto]'], // llaves, hashes largos, base64
  [/\b\d(?:[ -]?\d){12,18}\b/g, '[número oculto]'], // tarjetas y cuentas (13 a 19 dígitos)
];

export function redactar(valor) {
  let texto = typeof valor === 'string' ? valor : valor instanceof Error ? `${valor.name}: ${valor.message}` : String(valor);
  for (const [regla, reemplazo] of REGLAS) texto = texto.replace(regla, reemplazo);
  return texto;
}

let instalado = false;
// Hace que console.log/warn/error pasen por redactar(). Se instala una sola vez.
export function instalarRedaccion() {
  if (instalado) return;
  instalado = true;
  for (const nivel of ['log', 'warn', 'error']) {
    const original = console[nivel].bind(console);
    console[nivel] = (...argumentos) => original(...argumentos.map((a) => (
      typeof a === 'string' ? redactar(a) : a instanceof Error ? redactar(a.stack ?? a) : a
    )));
  }
}
