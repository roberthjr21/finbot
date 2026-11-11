import { FormularioEnvio } from '@/components/formulario-envio'
import Link from 'next/link'
import { DashboardShell, EstadoConexion } from '@/components/dashboard-shell'
import { Aviso, FormularioMovimiento } from '@/components/formulario-movimiento'
import { hoyBogota, obtenerCategorias, obtenerMovimiento, obtenerSalud } from '@/lib/bot-api'

const RESERVADAS = ['Préstamos', 'Deudas']

export default async function EditarMovimientoPage({
  params,
  searchParams,
}: Readonly<{ params: Promise<{ id: string }>; searchParams: Promise<{ e?: string }> }>) {
  const [{ id }, { e }] = await Promise.all([params, searchParams])
  const numero = /^\d{1,12}$/.test(id) ? Number(id) : 0
  const [movimiento, categorias, salud] = await Promise.all([obtenerMovimiento(numero), obtenerCategorias(), obtenerSalud()])
  const hoy = hoyBogota()

  return (
    <DashboardShell pagina="Movimientos" salud={salud} consultado={new Date().toISOString()}>
      <div className="page-heading"><div><p className="eyebrow">EDITAR</p><h1>Movimiento</h1></div></div>
      <Aviso error={e} />
      {!movimiento.ok && (
        <section className="panel"><h2>No encontramos ese movimiento</h2><p className="subheading">Puede que ya se haya borrado. <Link href="/movimientos">Volver a movimientos</Link></p></section>
      )}
      {movimiento.ok && movimiento.datos.ligado && (
        <section className="panel"><h2>Este movimiento pertenece a un préstamo o a una deuda</h2><p className="subheading">Se administra desde <Link href="/prestamos">Préstamos</Link> o <Link href="/deudas">Deudas</Link>, o desde WhatsApp, para que los totales no se desordenen.</p></section>
      )}
      {movimiento.ok && !movimiento.datos.ligado && (
        <>
          {!categorias.ok
            ? <EstadoConexion motivo={categorias.motivo} seccion="Categorías" />
            : <FormularioMovimiento
                accion="/api/movimientos/editar"
                categorias={categorias.datos.filter((c) => !RESERVADAS.includes(c))}
                valores={movimiento.datos}
                hoy={hoy}
                etiquetaBoton="Guardar cambios"
              />}
          <FormularioEnvio className="form-card panel danger-zone" action="/api/movimientos/eliminar">
            <input type="hidden" name="id" value={movimiento.datos.id} />
            <h2>Borrar movimiento</h2>
            <p className="subheading">Esto cambia tu saldo y no se puede deshacer desde la web.</p>
            <label className="check"><input type="checkbox" name="confirmar" value="si" required /> Sí, quiero borrar este movimiento</label>
            <div className="form-actions"><button className="btn-danger" type="submit">Borrar</button></div>
          </FormularioEnvio>
        </>
      )}
    </DashboardShell>
  )
}
