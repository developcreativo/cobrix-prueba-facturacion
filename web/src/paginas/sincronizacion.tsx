import { Download, RefreshCcw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { ConsolaCorrida, DialogoConfirmarCorrida, useEjecucionCorrida } from '@/components/corrida-en-vivo'
import { BloqueError, EstadoVacio } from '@/components/estados'
import { EncabezadoPagina, Seccion, SkeletonTabla } from '@/components/piezas'
import { TablaCorridas } from '@/components/tabla-corridas'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ErrorDeApi, borrarDatos, useRecurso } from '@/datos/api'
import { usePanel } from '@/datos/panel'
import { entero, usd } from '@/lib/formato'
import type { Configuracion, DatosBorrados, ErrorPanel, ListaCorridas, Resumen } from '@/tipos/panel'

/** Sincronización (§3.2–3.4): las dos acciones, su simulación y el historial de corridas. */
export function PaginaSincronizacion() {
	const historial = useRecurso<ListaCorridas>('/api/corridas?limite=50')
	const resumen = useRecurso<Resumen>('/api/resumen')
	const configuracion = useRecurso<Configuracion>('/api/configuracion')
	const panel = usePanel()

	const corrida = useEjecucionCorrida(() => {
		historial.recargar(true)
		resumen.recargar(true)
		panel.recargar()
	})

	const [borrando, setBorrando] = useState(false)
	const [borrado, setBorrado] = useState<DatosBorrados | null>(null)
	const [errorBorrado, setErrorBorrado] = useState<ErrorPanel | null>(null)
	const [enCurso, setEnCurso] = useState(false)

	const corridas = historial.dato?.corridas ?? []
	const totales = resumen.dato?.totales ?? null

	const confirmarBorrado = (): void => {
		setEnCurso(true)
		setErrorBorrado(null)
		borrarDatos()
			.then(resultado => {
				setBorrado(resultado)
				setBorrando(false)
				historial.recargar(true)
				resumen.recargar(true)
				panel.recargar()
			})
			.catch((fallo: unknown) => setErrorBorrado(fallo instanceof ErrorDeApi ? fallo.detalle : null))
			.finally(() => setEnCurso(false))
	}

	return (
		<>
			<EncabezadoPagina
				titulo="Sincronización"
				descripcion="La importación lee cada contrato del administrador y crea una factura abierta por cuota pendiente. La actualización de pagadas consulta el libro de cuotas y marca pagadas las que el ISP ya cobró."
			/>

			<div className="grid gap-5">
				{corrida.error && (
					<BloqueError
						error={corrida.error}
						titulo="No se pudo lanzar la corrida"
						accion={
							// El cerrojo lo publica `GET /api/salud`: si hay una corrida viva, se enlaza.
							corrida.error.codigo === 'corrida_en_curso' && panel.salud?.corrida_en_curso != null ? (
								<Button asChild size="sm" variant="outline">
									<Link to={`/corridas/${panel.salud.corrida_en_curso.id}`}>Ver la corrida en curso</Link>
								</Button>
							) : undefined
						}
					/>
				)}
				{errorBorrado && <BloqueError error={errorBorrado} titulo="No se borraron los datos" />}
				{borrado && (
					<p className="rounded-lg border border-ok-line bg-ok-soft/50 px-4 py-2.5 text-sm" aria-live="polite">
						Cobrix quedó vacío: se borraron {entero(borrado.borrados.clientes)} clientes, {entero(borrado.borrados.contratos)} contratos,{' '}
						{entero(borrado.borrados.facturas)} facturas, {entero(borrado.borrados.corridas)} corridas y {entero(borrado.borrados.eventos)} eventos.
					</p>
				)}
				{corrida.ejecucion && <ConsolaCorrida ejecucion={corrida.ejecucion} alCerrar={corrida.cerrar} />}

				<div className="grid gap-4 lg:grid-cols-2">
					<Card>
						<CardHeader>
							<CardTitle>Importar cuotas</CardTitle>
							<CardDescription>
								Recorre todos los contratos del administrador y aplica los estados importables, la ventana, el límite de recientes y los
								topes de la configuración. No duplica lo que ya está importado.
							</CardDescription>
						</CardHeader>
						<CardContent className="flex flex-wrap gap-2">
							<Button
								variant="outline"
								disabled={corrida.lanzando}
								onClick={() => corrida.solicitar({ tipo: 'importacion', simulacion: true })}
							>
								Simular importación
							</Button>
							<Button disabled={corrida.lanzando} onClick={() => corrida.solicitar({ tipo: 'importacion', simulacion: false })}>
								<Download aria-hidden="true" />
								Importar
							</Button>
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>Actualizar facturas pagadas</CardTitle>
							<CardDescription>
								Para cada factura abierta lee el libro de cuotas del administrador. Solo se marca pagada una cuota con saldo 0, con algo
								cobrado y con filas coherentes. Los abonos parciales se informan, no se aplican.
							</CardDescription>
						</CardHeader>
						<CardContent className="flex flex-wrap gap-2">
							<Button variant="outline" disabled={corrida.lanzando} onClick={() => corrida.solicitar({ tipo: 'pagadas', simulacion: true })}>
								Simular actualización
							</Button>
							<Button disabled={corrida.lanzando} onClick={() => corrida.solicitar({ tipo: 'pagadas', simulacion: false })}>
								<RefreshCcw aria-hidden="true" />
								Actualizar pagadas
							</Button>
						</CardContent>
					</Card>
				</div>

				{historial.error ? (
					<BloqueError error={historial.error} alReintentar={() => historial.recargar()} />
				) : historial.dato === null ? (
					<Card className="p-4">
						<SkeletonTabla filas={6} />
					</Card>
				) : (
					<Seccion
						titulo="Corridas"
						descripcion={
							corridas.length > 0
								? `${entero(historial.dato.total)} ${historial.dato.total === 1 ? 'corrida registrada' : 'corridas registradas'}, de la más reciente a la más vieja.`
								: undefined
						}
						accion={
							<Button variant="destructive" size="sm" onClick={() => setBorrando(true)}>
								<Trash2 aria-hidden="true" />
								Borrar datos importados
							</Button>
						}
					>
						{corridas.length === 0 ? (
							<EstadoVacio
								titulo="Todavía no has corrido ninguna sincronización"
								descripcion="Empieza por «Simular importación» para ver qué traería del administrador sin escribir nada. Cuando el resultado te cuadre, usa «Importar»."
							/>
						) : (
							<TablaCorridas corridas={corridas} />
						)}
					</Seccion>
				)}
			</div>

			<DialogoConfirmarCorrida
				peticion={corrida.pendiente}
				proveedor={configuracion.dato?.proveedor ?? null}
				alConfirmar={corrida.confirmar}
				alCancelar={corrida.cancelar}
			/>

			<Dialog open={borrando} onOpenChange={setBorrando}>
				<DialogContent className="max-w-lg">
					<DialogHeader>
						<DialogTitle>¿Borrar todo lo importado en Cobrix?</DialogTitle>
						<DialogDescription>Esto no se puede deshacer.</DialogDescription>
					</DialogHeader>
					<div className="grid gap-3 text-sm">
						<p>Se borrarán de Cobrix:</p>
						<ul className="grid list-disc gap-1.5 pl-5">
							{totales === null ? (
								<li>los clientes y contratos espejados, las facturas, el historial de corridas y los eventos.</li>
							) : (
								<>
									<li>
										los <strong>{entero(totales.clientes)} clientes</strong> y sus {entero(totales.contratos)} contratos espejados;
									</li>
									<li>
										las <strong>{entero(totales.facturas_abiertas)} facturas abiertas</strong> por {usd(totales.por_cobrar_centavos)} y las{' '}
										{entero(totales.facturas_pagadas)} pagadas;
									</li>
									<li>el historial de corridas y los eventos de cada expediente.</li>
								</>
							)}
						</ul>
						<p className="text-muted-foreground">
							No se toca nada en el administrador de facturas del ISP: sus contratos, cuotas y cobros quedan como están.
						</p>
					</div>
					<DialogFooter>
						<DialogClose asChild>
							<Button variant="outline">Cancelar</Button>
						</DialogClose>
						<Button variant="destructive" onClick={confirmarBorrado} disabled={enCurso} autoFocus>
							{enCurso ? 'Borrando…' : 'Sí, borrar todo'}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	)
}
