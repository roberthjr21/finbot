import pathlib
import subprocess
import tempfile
import unittest

SCANNER = pathlib.Path(__file__).with_name('verificar-secretos.py').resolve()

class ScannerTests(unittest.TestCase):
    def comprobar(self, nombre, contenido):
        with tempfile.TemporaryDirectory(prefix='finbot-scanner-') as carpeta:
            subprocess.run(['git','init','-q',carpeta],check=True)
            archivo=pathlib.Path(carpeta,nombre); archivo.parent.mkdir(parents=True,exist_ok=True); archivo.write_text(contenido)
            subprocess.run(['git','add','--',nombre],cwd=carpeta,check=True)
            return subprocess.run(['python3',str(SCANNER)],cwd=carpeta,capture_output=True,text=True)
    def test_clave_ficticia_detectada_sin_publicar_valor(self):
        clave='sk-ant-'+'x'*40
        resultado=self.comprobar('ejemplo.txt',clave)
        self.assertNotEqual(resultado.returncode,0)
        self.assertNotIn(clave,resultado.stdout)
    def test_credenciales_privadas_rechazadas(self):
        self.assertNotEqual(self.comprobar('bot/auth/creds.json','{}').returncode,0)
    def test_ejemplo_sin_credencial_valido(self):
        self.assertEqual(self.comprobar('bot/.env.example','API_TOKEN=\n').returncode,0)

if __name__ == '__main__': unittest.main()
