import { CheckCircle2, Radio, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { Pildora, PildoraResultado, PildoraSimulacion } from '@/components/pildora'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'
import { ErrorDeApi, lanzarCorrida, obtener, seguirCorrida } from '@/datos/api'
import { entero, lista, usd } from '@/lib/formato'
import { describir, etiquetaResultado } from '@/lib/resultados'
import type { CorridaDetalle, ErrorPanel, LineaCorrida, Proveedor, ProgresoCorrida, Resultado, TipoCorrida } from '@/tipos/panel'

/**
 * Lanzar una corrida: confirmación y consola en vivo (SPEC §5.3).
 *
 * La corrida **real** pide confirmación y dice exactamente qué va a pasar; la **simulación**
 * arranca sin preguntar, porque no escribe nada.
 *
 * El progreso viene de `GET /api/corridas/:id/stream` (SSE), que emite `ProgresoCorrida` a
 * medida que la corrida avanza contrato a contrato.
 */

export interface Peticion {
	readonly tipo: TipoCorrida
	readonly simulacion: boolean
}

const NOMBRE_TIPO: Record<TipoCorrida, string> = {
	importacion: 'Importar cuotas',
	pagadas: 'Actualizar facturas pagadas',
}

export interface Ejecucion {
	readonly peticion: Peticion
	readonly corridaId: number
	readonly progreso: ProgresoCorrida
	/** El detalle, ya cerrado: trae el resumen definitivo que redacta el backend. */
	readonly corrida: CorridaDetalle | null
	/** `true` cuando el stream se cortó y se está consultando el detalle cada pocos segundos. */
	readonly degradado: boolean
}

const MS_SONDEO = 2500

/**
 * Lanzar una corrida y seguirla en vivo.
 *
 * `POST /api/corridas` responde `201 { id }` en cuanto la corrida existe, sin esperar a que
 * termine; con ese id se abre el SSE. Quien se conecta tarde recibe el último estado y el cierre.
 * Si el navegador corta el stream se degrada a consultar el detalle cada pocos segundos, para que
 * la barra no se quede congelada mintiendo.
 */
export function useEjecucionCorrida(alCerrarCorrida?: () => void) {
	const [pendiente, setPendiente] = useState<Peticion | null>(null)
	const [ejecucion, setEjecucion] = useState<Ejecucion | null>(null)
	const [error, setError] = useState<ErrorPanel | null>(null)
	const [lanzando, setLanzando] = useState(false)
	const cerrarStream = useRef<(() => void) | null>(null)
	const sondeo = useRef<number | undefined>(undefined)
	const alCerrar = useRef(alCerrarCorrida)
	useEffect(() => {
		alCerrar.current = alCerrarCorrida
	}, [alCerrarCorrida])

	const soltar = useCallback(() => {
		cerrarStream.current?.()
		cerrarStream.current = null
		window.clearInterval(sondeo.current)
		sondeo.current = undefined
	}, [])

	/** Al cerrarse la corrida: su detalle definitivo y aviso a la pantalla para que se refresque. */
	const cerrarConDetalle = useCallback((id: number) => {
		soltar()
		obtener<CorridaDetalle>(`/api/corridas/${id}`)
			.then(detalle => setEjecucion(actual => (actual === null || actual.corridaId !== id ? actual : { ...actual, corrida: detalle })))
			.catch(() => undefined)
			.finally(() => alCerrar.current?.())
	}, [soltar])

	/** Plan B sin stream: el detalle cada pocos segundos hasta que la corrida deje de estar en curso. */
	const sondear = useCallback((id: number, peticion: Peticion) => {
		soltar()
		setEjecucion(actual => (actual === null ? actual : { ...actual, degradado: true }))
		sondeo.current = window.setInterval(() => {
			obtener<CorridaDetalle>(`/api/corridas/${id}`)
				.then(detalle => {
					if (detalle.estado === 'en_curso') return
					window.clearInterval(sondeo.current)
					sondeo.current = undefined
					setEjecucion({
						peticion,
						corridaId: id,
						corrida: detalle,
						degradado: true,
						progreso: {
							corrida_id: id,
							fase: 'Corrida cerrada',
							procesados: 0,
							total: 0,
							contadores: {},
							ultimas: detalle.lineas.slice(-8).reverse(),
							cerrada: true,
						},
					})
					alCerrar.current?.()
				})
				.catch(() => undefined)
		}, MS_SONDEO)
	}, [soltar])

	const seguir = useCallback((id: number, peticion: Peticion) => {
		soltar()
		setEjecucion({
			peticion,
			corridaId: id,
			corrida: null,
			degradado: false,
			progreso: { corrida_id: id, fase: 'Conectando con el administrador', procesados: 0, total: 0, contadores: {}, ultimas: [], cerrada: false },
		})

		cerrarStream.current = seguirCorrida(
			id,
			progreso => {
				setEjecucion(actual => (actual === null ? actual : { ...actual, progreso, degradado: false }))
				if (progreso.cerrada) cerrarConDetalle(id)
			},
			() => {
				// El corte también salta cuando el servidor cierra el stream al terminar: si la
				// corrida ya estaba cerrada no hay nada que recuperar.
				setEjecucion(actual => {
					if (actual !== null && !actual.progreso.cerrada) sondear(id, peticion)
					return actual
				})
			},
		)
	}, [soltar, cerrarConDetalle, sondear])

	const arrancar = useCallback((peticion: Peticion) => {
		setError(null)
		setLanzando(true)
		lanzarCorrida(peticion.tipo, peticion.simulacion)
			.then(lanzada => seguir(lanzada.id, peticion))
			.catch((fallo: unknown) => {
				setError(fallo instanceof ErrorDeApi ? fallo.detalle : null)
				// Un 409 significa que hay otra corrida viva: conviene releer el estado del panel.
				alCerrar.current?.()
			})
			.finally(() => setLanzando(false))
	}, [seguir])

	useEffect(() => soltar, [soltar])

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
		soltar()
		setEjecucion(null)
		setError(null)
	}, [soltar])

	return { pendiente, ejecucion, error, lanzando, solicitar, confirmar, cancelar, cerrar }
}

// ---------------------------------------------------------------- confirmación

export function DialogoConfirmarCorrida({
	peticion,
	proveedor,
	alConfirmar,
	alCancelar,
}: {
	peticion: Peticion | null
	/** La configuración con la que va a correr; si todavía no llegó, no se enseña. */
	proveedor: Proveedor | null
	alConfirmar: () => void
	alCancelar: () => void
}) {
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
					{proveedor !== null && (
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
					)}
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
	const { progreso, peticion, corrida, corridaId, degradado } = ejecucion
	// Sin total todavía (la corrida aún no preguntó cuántos contratos hay) la barra va indeterminada.
	const porcentaje = progreso.total === 0 ? null : Math.round((progreso.procesados / progreso.total) * 100)
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
				<Progress value={porcentaje ?? undefined} aria-label="Progreso de la corrida" />
				{/* Región viva: el progreso real que llega por SSE (GET /api/corridas/:id/stream). */}
				<p aria-live="polite" className="text-sm text-muted-foreground">
					{progreso.fase}
					{progreso.total === 0 ? '…' : `: ${entero(progreso.procesados)} de ${entero(progreso.total)} contratos (${porcentaje} %).`}
					{degradado && ' Sin progreso en vivo: consultando el detalle cada pocos segundos.'}
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
					<p className="text-sm text-muted-foreground">{corrida?.resumen ?? 'Corrida cerrada.'}</p>
					<Button asChild size="sm" variant="outline">
						<Link to={`/corridas/${corridaId}`}>Ver el detalle completo</Link>
					</Button>
				</div>
			)}
		</Card>
	)
}
