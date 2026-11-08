import Link from 'next/link'

type Valores = { id?: number; tipo: 'gasto' | 'ingreso'; monto?: number; categoria?: string; fecha: string; descripcion?: string }

// Formulario sin JavaScript de cliente: envía a una ruta del servidor, que valida y habla con el bot.
export function FormularioMovimiento({
  accion,
  categorias,
  valores,
  clave,
  hoy,
  etiquetaBoton,
}: Readonly<{ accion: string; categorias: string[]; valores: Valores; clave?: string; hoy: string; etiquetaBoton: string }>) {
  return (
    <form className="form-card panel" method="post" action={accion}>
      {clave && <input type="hidden" name="clave" value={clave} />}
      {valores.id !== undefined && <input type="hidden" name="id" value={valores.id} />}
      <div className="field-row">
        <label className="field">
          <span>Tipo</span>
          <select name="tipo" defaultValue={valores.tipo} required>
            <option value="gasto">Gasto</option>
            <option value="ingreso">Ingreso</option>
          </select>
        </label>
        <label className="field">
          <span>Monto (pesos)</span>
          <input name="monto" type="text" inputMode="numeric" autoComplete="off" placeholder="25000" defaultValue={valores.monto ?? ''} required maxLength={15} />
        </label>
      </div>
      <div className="field-row">
        <label className="field">
          <span>Categoría</span>
          <select name="categoria" defaultValue={valores.categoria ?? ''} required>
            <option value="" disabled>Elige una categoría</option>
            {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Fecha</span>
          <input name="fecha" type="date" defaultValue={valores.fecha} max={hoy} min="2000-01-01" required />
        </label>
      </div>
      <label className="field">
        <span>Descripción (opcional)</span>
        <input name="descripcion" type="text" maxLength={120} defaultValue={valores.descripcion ?? ''} placeholder="Almuerzo, arriendo, venta…" />
      </label>
      <div className="form-actions">
        <button className="primary-button" type="submit">{etiquetaBoton}</button>
        <Link className="link-button" href="/movimientos">Cancelar</Link>
      </div>
    </form>
  )
}

export function Aviso({ aviso, error }: Readonly<{ aviso?: string; error?: string }>) {
  const textos: Record<string, string> = {
    creado: '✅ Movimiento guardado.',
    duplicado: 'ℹ️ Ese movimiento ya estaba guardado; no se duplicó.',
    editado: '✅ Cambios guardados.',
    eliminado: '🗑️ Movimiento borrado.',
  }
  if (error) return <p className="alert alert-error" role="alert">No se guardó: {error.slice(0, 160)}</p>
  if (aviso && textos[aviso]) return <p className="alert alert-ok" role="status">{textos[aviso]}</p>
  return null
}
