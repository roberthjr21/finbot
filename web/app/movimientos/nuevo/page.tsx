import { randomUUID } from 'node:crypto'
import { DashboardShell, EstadoConexion } from '@/components/dashboard-shell'
import { Aviso, FormularioMovimiento } from '@/components/formulario-movimiento'
import { hoyBogota, obtenerCategorias, obtenerSalud } from '@/lib/bot-api'

// Categorías que nacen de sus propios registros (deudas y préstamos), no de este formulario
const RESERVADAS = ['Préstamos', 'Deudas']

export default async function NuevoMovimientoPage({ searchParams }: Readonly<{ searchParams: Promise<{ e?: string }> }>) {
  const { e } = await searchParams
  const [categorias, salud] = await Promise.all([obtenerCategorias(), obtenerSalud()])
  const hoy = hoyBogota()
  return (
    <DashboardShell pagina="Movimientos" salud={salud} consultado={new Date().toISOString()}>
      <div className="page-heading"><div><p className="eyebrow">REGISTRAR</p><h1>Nuevo movimiento</h1><p className="subheading">Se guarda en la misma cuenta que usas en WhatsApp.</p></div></div>
      <Aviso error={e} />
      {!categorias.ok
        ? <EstadoConexion motivo={categorias.motivo} seccion="Categorías" />
        : <FormularioMovimiento
            accion="/api/movimientos/crear"
            categorias={categorias.datos.filter((c) => !RESERVADAS.includes(c))}
            valores={{ tipo: 'gasto', fecha: hoy }}
            clave={randomUUID()}
            hoy={hoy}
            etiquetaBoton="Guardar movimiento"
          />}
    </DashboardShell>
  )
}
