import { ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { PildoraResultado } from '@/components/pildora'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { periodo as formatoPeriodo, usd } from '@/lib/formato'
import { CLASES_TEXTO_TONO, VEREDICTO, describir } from '@/lib/resultados'
import { cn } from '@/lib/utils'
import type { LineaCorrida, PasoTraza, TipoCorrida } from '@/tipos/panel'

/**
 * Explicador de decisiones (SPEC §5.2).
 *
 * Cada cuota de la corrida se despliega y muestra **las reglas que se evaluaron, en orden**,
 * con su veredicto: `✓` cumple, `✗` descarta, `·` no se evaluó. El símbolo y la palabra van
 * siempre juntos, así que la traza se lee igual sin color.
 */

function Paso({ paso, conclusion }: { paso: PasoTraza; conclusion: string | null }) {
	const veredicto = VEREDICTO[paso.veredicto]
	return (
		<li className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-2 gap-y-0.5 py-1 md:grid-cols-[1.25rem_13rem_minmax(0,1fr)]">
			<span className={cn('tabular text-center leading-6 font-semibold', CLASES_TEXTO_TONO[veredicto.tono])} aria-hidden="true">
				{veredicto.simbolo}
			</span>
			<span className="font-medium">
				<span className="sr-only">{veredicto.etiqueta}: </span>
				{paso.regla}
			</span>
			<span className="col-start-2 text-muted-foreground md:col-start-3">
				{paso.detalle}
				{conclusion && paso.veredicto === 'descarta' && (
					<strong className={cn('ml-1.5 font-semibold whitespace-nowrap', CLASES_TEXTO_TONO[veredicto.tono])}>→ {conclusion}</strong>
				)}
			</span>
		</li>
	)
}

const CONCLUSION: Record<TipoCorrida, string> = {
	importacion: 'NO SE IMPORTA',
	pagadas: 'SIGUE ABIERTA',
}

/**
 * Cuántas cuotas resume la fila, dicho en palabras.
 *
 * Una fila normal es una cuota y no hace falta anunciarlo. Cuando el backend descarta un
 * contrato entero manda **una fila sin `deuda_id` que vale por varias cuotas**, y cuando el
 * administrador responde «deuda_id 0» la fila no vale por ninguna: eso sí se dice, porque si no
 * el detalle parece contradecir a los contadores.
 */
function alcanceDeLaFila(linea: LineaCorrida): string | null {
	if (linea.cuotas === 1) return null
	return linea.cuotas === 0 ? 'no es una cuota' : `${linea.cuotas} cuotas`
}

export function FilaDecision({ linea, tipo, simulacion }: { linea: LineaCorrida; tipo: TipoCorrida; simulacion: boolean }) {
	const [abierta, setAbierta] = useState(false)
	const descripcion = describir(linea.resultado)
	const conclusion = descripcion.tono === 'ok' ? null : CONCLUSION[tipo]
	const alcance = alcanceDeLaFila(linea)

	return (
		<Collapsible open={abierta} onOpenChange={setAbierta} asChild>
			<li className="border-b border-border last:border-0">
				<CollapsibleTrigger
					className={cn(
						'grid w-full grid-cols-[1.25rem_minmax(0,1fr)] items-start gap-x-2 gap-y-1 px-3 py-2.5 text-left transition-colors hover:bg-muted/60',
						'md:grid-cols-[1.25rem_10rem_minmax(0,1fr)_6rem_auto_6.5rem] md:items-center',
						abierta && 'bg-muted/60',
					)}
				>
					<ChevronRight className={cn('mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform md:mt-0', abierta && 'rotate-90')} aria-hidden="true" />
					<span className="font-mono text-[0.8rem] text-muted-foreground">
						{linea.contrato_id} · {linea.deuda_id ?? (alcance ?? '—')}
					</span>
					<span className="col-start-2 min-w-0 truncate font-medium md:col-start-3">{linea.cliente_nombre}</span>
					<span className="col-start-2 text-sm text-muted-foreground md:col-start-4">
						{linea.periodo === null && alcance ? <span className="italic">todo el contrato</span> : formatoPeriodo(linea.periodo)}
					</span>
					<span className="col-start-2 md:col-start-5 md:justify-self-start">
						<PildoraResultado resultado={linea.resultado} simulacion={simulacion} />
					</span>
					<span className="tabular col-start-2 text-sm md:col-start-6 md:text-right">{usd(linea.monto_centavos)}</span>
				</CollapsibleTrigger>

				<CollapsibleContent>
					<div className="grid gap-2 border-t border-border/60 bg-muted/30 px-3 py-3 md:pl-9">
						<p className="text-sm">
							{linea.deuda_id === null ? (
								<>
									<span className="text-muted-foreground">Contrato </span>
									<span className="font-mono text-[0.8rem]">{linea.contrato_id}</span>
									<span className="text-muted-foreground">
										{' '}· {linea.cuotas === 0 ? 'sin cuotas pendientes' : `${linea.cuotas} cuotas afectadas`} ·{' '}
									</span>
								</>
							) : (
								<>
									<span className="text-muted-foreground">Cuota </span>
									<span className="font-mono text-[0.8rem]">{linea.deuda_id}</span>
									<span className="text-muted-foreground"> · </span>
								</>
							)}
							{linea.cliente_nombre}
							<span className="text-muted-foreground">
								{linea.periodo === null ? '' : ` · ${formatoPeriodo(linea.periodo)}`} · deuda{' '}
							</span>
							<span className="tabular">{usd(linea.monto_centavos)}</span>
						</p>
						<ol className="grid text-sm">
							{linea.traza.map((paso, indice) => (
								<Paso key={`${paso.regla}-${indice}`} paso={paso} conclusion={conclusion} />
							))}
						</ol>
						<p className="flex flex-wrap items-center gap-2 text-sm">
							<span className="text-muted-foreground">Resultado:</span>
							<PildoraResultado resultado={linea.resultado} simulacion={simulacion} />
							<span className="text-muted-foreground">{linea.motivo}</span>
						</p>
						{linea.factura_numero && linea.cliente_id && (
							<p className="text-sm">
								<Link to={`/clientes/${linea.cliente_id}`} className="font-medium text-primary underline-offset-4 hover:underline">
									Ver {linea.factura_numero} en el expediente de {linea.cliente_nombre}
								</Link>
							</p>
						)}
					</div>
				</CollapsibleContent>
			</li>
		</Collapsible>
	)
}
