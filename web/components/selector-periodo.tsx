import { mesesRecientes, nombreMes } from '@/lib/bot-api'

export function periodoSeleccionado(solicitado?: string) {
  const meses = mesesRecientes(12).reverse()
  const mes = solicitado && meses.includes(solicitado) ? solicitado : meses[0]
  const [ano, numero] = mes.split('-').map(Number)
  const ultimoDia = new Date(Date.UTC(ano, numero, 0)).getUTCDate()
  return { mes, meses, rango: { desde: `${mes}-01`, hasta: `${mes}-${ultimoDia}` } }
}

export function SelectorPeriodo({ mes, meses }: { mes: string; meses: string[] }) {
  return (
    <form method="get" className="finbot-periodo">
      <label>
        <span className="sr-only">Periodo de consulta</span>
        <select name="mes" defaultValue={mes}>
          {meses.map((valor) => <option key={valor} value={valor}>{nombreMes(valor, 'largo')} de {valor.slice(0, 4)}</option>)}
        </select>
      </label>
      <button className="link-button" type="submit">Ver mes</button>
    </form>
  )
}
