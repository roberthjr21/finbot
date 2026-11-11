// Solo inicia SQLite temporal y API HTTP; nunca vincula WhatsApp ni carga .env.
const db = await import('../../bot/db.js');
const { crearServidorApi } = await import('../../bot/api.js');
for (const tel of ['573000001111', '573000002222']) db.asegurarUsuario(tel);
const servidor = crearServidorApi({ enviar: async (telefono, texto) => process.send({ tipo: 'codigo', telefono, codigo: texto.match(/\*(\d{6})\*/)[1] }) });
servidor.listen(0, '127.0.0.1', () => process.send({ tipo: 'listo', puerto: servidor.address().port }));
process.on('message', (m) => {
  if (m === 'desconectar') servidor.close(() => process.send({ tipo: 'desconectado' }));
});
process.on('SIGTERM', () => { servidor.closeAllConnections(); servidor.close(); db.cerrarBase(); process.exit(0); });
