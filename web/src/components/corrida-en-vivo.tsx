import { CheckCircle2, Radio, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { Pildora, PildoraResultado, PildoraSimulacion } from '@/components/pildora'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'
import { CONFIGURACION, corridaPorId } from '@/datos/ejemplo'
import { entero, lista, usd } from '@/lib/formato'
import { describir, etiquetaResultado } from '@/lib/resultados'
import type { CorridaDetalle, LineaCorrida, ProgresoCorrida, Resultado, TipoCorrida } from '@/tipos/panel'

/**
 * Lanzar una corrida: confirmación y consola en vivo (SPEC §5.3).
 *
 * La corrida **real** pide confirmación y dice exactamente qué va a pasar; la **simulación**
 * arranca sin preguntar, porque no escribe nada.
 *
 * La consola de abajo es el hueco del progreso en vivo: hoy se alimenta de los datos de
 * ejemplo con un temporizador; cuando exista `GET /api/corridas/:id/stream` (SSE) solo cambia
 * el origen de los eventos `ProgresoCorrida`, no la pantalla.
 */

export interface Peticion {
	readonly tipo: TipoCorrida
	readonly simulacion: boolean
}

const NOMBRE_TIPO: Record<TipoCorrida, string> = {
	importacion: 'Importar cuotas',
	pagadas: 'Actualizar facturas pagadas',
}

/** Corrida de ejemplo que alimenta la consola según lo que se haya pedido. */
const corridaDeEjemplo = (peticion: Peticion): CorridaDetalle | undefined =>
	corridaPorId(peticion.tipo === 'importacion' ? (peticion.simulacion ? 1 : 2) : 3)

export interface Ejecucion {
	readonly peticion: Peticion
	readonly corrida: CorridaDetalle
	readonly progreso: ProgresoCorrida
}

const PASO_MS = 70
const LINEAS_POR_PASO = 2

export function useEjecucionCorrida() {
	const [pendiente, setPendiente] = useState<Peticion | null>(null)
	const [ejecucion, setEjecucion] = useState<Ejecucion | null>(null)
	const temporizador = useRef<number | undefined>(undefined)

	const arrancar = useCallback((peticion: Peticion) => {
		const corrida = corridaDeEjemplo(peticion)
		if (!corrida) return
		window.clearInterval(temporizador.current)
		let procesados = 0
		const avanzar = (): void => {
			procesados = Math.min(corrida.lineas.length, procesados + LINEAS_POR_PASO)
			const hechas = corrida.lineas.slice(0, procesados)
			const contadores: Record<string, number> = {}
			for (const linea of hechas) contadores[linea.resultado] = (contadores[linea.resultado] ?? 0) + 1
			const cerrada = procesados >= corrida.lineas.length
			setEjecucion({
				peticion,
				corrida,
				progreso: {
					corrida_id: corrida.id,
					fase: cerrada ? 'Corrida cerrada' : peticion.tipo === 'importacion' ? 'Leyendo contratos del administrador' : 'Revisando el libro de cuotas',
					procesados,
					total: corrida.lineas.length,
					contadores,
					ultimas: [...hechas].reverse().slice(0, 8),
					cerrada,
				},
			})
			if (cerrada) window.clearInterval(temporizador.current)
		}
		avanzar()
		temporizador.current = window.setInterval(avanzar, PASO_MS)
	}, [])

	useEffect(() => () => window.clearInterval(temporizador.current), [])

	const solicitar = useCallback(
		(peticion: Peticion) => {
			// La simulación no pide confirmación: no escribe nada.
			if (peticion.simulacion) arrancar(peticion)
			else setPendiente(peticion)
		},
		[arrancar],
	)

	const confirmar = useCallback(() => {
		if (pendiente) arrancar(pendiente)
		setPendiente(null)
	}, [pendiente, arrancar])

	const cancelar = useCallback(() => setPendiente(null), [])

	const cerrar = useCallback(() => {
		window.clearInterval(temporizador.current)
		setEjecucion(null)
	}, [])

	return { pendiente, ejecucion, solicitar, confirmar, cancelar, cerrar }
}

// ---------------------------------------------------------------- confirmación

export function DialogoConfirmarCorrida({
	peticion,
	alConfirmar,
	alCancelar,
}: {
	peticion: Peticion | null
	alConfirmar: () => void
	alCancelar: () => void
}) {
	const proveedor = CONFIGURACION.proveedor
	const esImportacion = peticion?.tipo === 'importacion'
	return (
		<Dialog open={peticion !== null} onOpenChange={abierto => !abierto && alCancelar()}>
			<DialogContent className="max-w-lg">
				<DialogHeader>
					<DialogTitle>{esImportacion ? '¿Importar cuotas ahora?' : '¿Actualizar las facturas pagadas?'}</DialogTitle>
					<DialogDescription>Esta corrida sí escribe en Cobrix. Revisa qué va a pasar antes de seguir.</DialogDescription>
				</DialogHeader>
				<div className="grid gap-3 text-sm">
					<ul className="grid list-disc gap-1.5 pl-5">
						{esImportacion ? (
							<>
								<li>Se leen todos los contratos del administrador de facturas.</li>
								<li>
									Se crea <strong>una factura abierta por cuota pendiente</strong> y, si no existe, su cliente.
								</li>
								<li>Las cuotas ya importadas no se duplican.</li>
							</>
						) : (
							<>
								<li>Se revisa cada factura abierta contra el libro de cuotas del administrador.</li>
								<li>
									Las cuotas saldadas se marcan <strong>pagadas</strong>; los abonos parciales solo se informan.
								</li>
								<li>Una cuota sin evidencia nunca se marca pagada.</li>
							</>
						)}
					</ul>
					<div className="grid gap-1 rounded-lg bg-muted px-3 py-2.5 text-xs text-muted-foreground">
						<span>
							Estados importables: <strong className="text-foreground">{lista([...proveedor.estados_importables])}</strong>
						</span>
						<span>
							Ventana:{' '}
							<strong className="text-foreground">
								{proveedor.ventana_meses === null ? 'sin ventana' : `${proveedor.ventana_meses} meses`}
							</strong>{' '}
							· Topes:{' '}
							<strong className="text-foreground">
								{proveedor.tope_facturas === null && proveedor.tope_monto_centavos === null
									? 'sin topes'
									: `${proveedor.tope_facturas ?? '—'} facturas / ${usd(proveedor.tope_monto_centavos)}`}
							</strong>
						</span>
					</div>
					<p className="text-muted-foreground">
						Si solo quieres ver qué pasaría, cancela y usa <strong className="text-foreground">Simular</strong>: no escribe nada.
					</p>
				</div>
				<DialogFooter>
					<DialogClose asChild>
						<Button variant="outline">Cancelar</Button>
					</DialogClose>
					<Button onClick={alConfirmar} autoFocus>
						{esImportacion ? 'Sí, importar' : 'Sí, actualizar pagadas'}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}

// ---------------------------------------------------------------- consola en vivo

function LineaDecision({ linea, simulacion }: { linea: LineaCorrida; simulacion: boolean }) {
	return (
		<li className="grid gap-1 border-b border-border/60 px-3 py-2 last:border-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-3">
			<span className="min-w-0 text-sm">
				<span className="font-mono text-[0.8rem] text-muted-foreground">
					{/* Una fila sin cuota resume el contrato entero: se dice cuántas cuotas se lleva. */}
					{linea.contrato_id} · {linea.deuda_id ?? (linea.cuotas === 0 ? 'sin cuotas' : `${linea.cuotas} cuotas`)}
				</span>{' '}
				<span className="break-words">{linea.cliente_nombre}</span>
			</span>
			<span className="flex items-center gap-2 sm:justify-end">
				<PildoraResultado resultado={linea.resultado} simulacion={simulacion} />
				<span className="tabular text-sm text-muted-foreground">{usd(linea.monto_centavos)}</span>
			</span>
		</li>
	)
}

export function ConsolaCorrida({ ejecucion, alCerrar }: { ejecucion: Ejecucion; alCerrar: () => void }) {
	const { progreso, peticion, corrida } = ejecucion
	const porcentaje = progreso.total === 0 ? 0 : Math.round((progreso.procesados / progreso.total) * 100)
	const destacados = Object.entries(progreso.contadores).sort((a, b) => b[1] - a[1])

	return (
		<Card className="gap-0 overflow-hidden p-0 ring-1 ring-primary/25">
			<div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/50 px-4 py-3">
				<div className="flex flex-wrap items-center gap-2">
					{progreso.cerrada ? (
						<CheckCircle2 className="size-4 text-ok" aria-hidden="true" />
					) : (
						<Radio className="size-4 animate-pulse text-primary" aria-hidden="true" />
					)}
					<h2 className="font-heading text-sm font-medium">
						{NOMBRE_TIPO[peticion.tipo]} · {progreso.cerrada ? 'corrida cerrada' : 'en curso'}
					</h2>
					{peticion.simulacion && <PildoraSimulacion />}
				</div>
				<Button variant="ghost" size="icon-sm" onClick={alCerrar}>
					<X aria-hidden="true" />
					<span className="sr-only">Cerrar la consola de la corrida</span>
				</Button>
			</div>

			<div className="grid gap-3 px-4 py-3">
				<Progress value={porcentaje} aria-label="Progreso de la corrida" />
				{/* Región viva: aquí entra el progreso real cuando se conecte el SSE. */}
				<p aria-live="polite" className="text-sm text-muted-foreground">
					{progreso.fase}: {entero(progreso.procesados)} de {entero(progreso.total)}{' '}
					{peticion.tipo === 'importacion' ? 'filas clasificadas' : 'facturas revisadas'} ({porcentaje} %).
				</p>
				<ul className="flex flex-wrap gap-1.5">
					{destacados.map(([resultado, valor]) => (
						<li key={resultado}>
							<Pildora tono={describir(resultado as Resultado).tono}>
								{etiquetaResultado(resultado as Resultado, peticion.simulacion)}: <span className="tabular">{entero(valor)}</span>
							</Pildora>
						</li>
					))}
				</ul>
			</div>

			<div className="border-t border-border">
				<h3 className="px-4 py-2 text-xs font-medium text-muted-foreground">Últimas decisiones</h3>
				<ul role="log" className="max-h-64 overflow-y-auto border-t border-border/60">
					{progreso.ultimas.map(linea => (
						<LineaDecision key={`${linea.id}-${linea.deuda_id}`} linea={linea} simulacion={peticion.simulacion} />
					))}
				</ul>
			</div>

			{progreso.cerrada && (
				<div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-muted/40 px-4 py-3">
					<p className="text-sm text-muted-foreground">{corrida.resumen}</p>
					<Button asChild size="sm" variant="outline">
						<Link to={`/corridas/${corrida.id}`}>Ver el detalle completo</Link>
					</Button>
				</div>
			)}
		</Card>
	)
}
