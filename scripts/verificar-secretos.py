"""Detecta secretos conocidos y artefactos privados en archivos versionados sin imprimirlos."""
import pathlib
import re
import subprocess
import sys

archivos = subprocess.check_output(['git', 'ls-files', '-z']).decode().split('\0')
patrones = [rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----', rb'\bsk-ant-[A-Za-z0-9_-]{30,}', rb'\bAIza[A-Za-z0-9_-]{35}\b', rb'\bgh[pousr]_[A-Za-z0-9]{30,}\b']
fallos = []
for nombre in filter(None, archivos):
    ruta = pathlib.Path(nombre)
    if ruta.name in {'.env', '.env.local', '.env.production'} or ruta.suffix in {'.db', '.sqlite', '.sqlite3'} or nombre.startswith('bot/auth/'):
        fallos.append(nombre)
        continue
    if ruta.is_file() and any(re.search(p, ruta.read_bytes()) for p in patrones):
        fallos.append(nombre)
if fallos:
    print('Posibles secretos o datos privados versionados (revisión requerida):')
    print('\n'.join(sorted(set(fallos))))
    sys.exit(1)
print('No se detectaron los patrones de secretos comprobados en los archivos versionados.')
