import { Download, RefreshCcw, Trash2 } from 'lucide-react'
import { useState } from 'react'

import { ConsolaCorrida, DialogoConfirmarCorrida, useEjecucionCorrida } from '@/components/corrida-en-vivo'
import { BloqueError, EstadoVacio } from '@/components/estados'
import { EncabezadoPagina, Seccion, SkeletonTabla } from '@/components/piezas'
import { TablaCorridas } from '@/components/tabla-corridas'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ERROR_EJEMPLO, LISTA_CORRIDAS, RESUMEN } from '@/datos/ejemplo'
import { entero, usd } from '@/lib/formato'
import { useVista } from '@/lib/vista'

/** Sincronización (§3.2–3.4): las dos acciones, su simulación y el historial de corridas. */
export function PaginaSincronizacion() {
	const vista = useVista()
	const corrida = useEjecucionCorrida()
	const [borrando, setBorrando] = useState(false)
	const corridas = vista === 'vacio' ? [] : LISTA_CORRIDAS.corridas

	return (
		<>
			<EncabezadoPagina
				titulo="Sincronización"
				descripcion="La importación lee cada contrato del administrador y crea una factura abierta por cuota pendiente. La actualización de pagadas consulta el libro de cuotas y marca pagadas las que el ISP ya cobró."
			/>

			<div className="grid gap-5">
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
							<Button variant="outline" onClick={() => corrida.solicitar({ tipo: 'importacion', simulacion: true })}>
								Simular importación
							</Button>
							<Button onClick={() => corrida.solicitar({ tipo: 'importacion', simulacion: false })}>
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
							<Button variant="outline" onClick={() => corrida.solicitar({ tipo: 'pagadas', simulacion: true })}>
								Simular actualización
							</Button>
							<Button onClick={() => corrida.solicitar({ tipo: 'pagadas', simulacion: false })}>
								<RefreshCcw aria-hidden="true" />
								Actualizar pagadas
							</Button>
						</CardContent>
					</Card>
				</div>

				{vista === 'error' ? (
					<BloqueError error={ERROR_EJEMPLO} alReintentar={() => window.location.reload()} />
				) : vista === 'cargando' ? (
					<Card className="p-4">
						<SkeletonTabla filas={6} />
					</Card>
				) : (
					<Seccion
						titulo="Corridas"
						descripcion={corridas.length > 0 ? `${entero(corridas.length)} corridas registradas, de la más reciente a la más vieja.` : undefined}
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

			<DialogoConfirmarCorrida peticion={corrida.pendiente} alConfirmar={corrida.confirmar} alCancelar={corrida.cancelar} />

			<Dialog open={borrando} onOpenChange={setBorrando}>
				<DialogContent className="max-w-lg">
					<DialogHeader>
						<DialogTitle>¿Borrar todo lo importado en Cobrix?</DialogTitle>
						<DialogDescription>Esto no se puede deshacer.</DialogDescription>
					</DialogHeader>
					<div className="grid gap-3 text-sm">
						<p>Se borrarán de Cobrix:</p>
						<ul className="grid list-disc gap-1.5 pl-5">
							<li>
								los <strong>{entero(RESUMEN.totales.clientes)} clientes</strong> y sus {entero(RESUMEN.totales.contratos)} contratos espejados;
							</li>
							<li>
								las <strong>{entero(RESUMEN.totales.facturas_abiertas)} facturas abiertas</strong> por {usd(RESUMEN.totales.por_cobrar_centavos)} y
								las {entero(RESUMEN.totales.facturas_pagadas)} pagadas;
							</li>
							<li>el historial de corridas y los eventos de cada expediente.</li>
						</ul>
						<p className="text-muted-foreground">
							No se toca nada en el administrador de facturas del ISP: sus contratos, cuotas y cobros quedan como están.
						</p>
					</div>
					<DialogFooter>
						<DialogClose asChild>
							<Button variant="outline">Cancelar</Button>
						</DialogClose>
						<Button variant="destructive" onClick={() => setBorrando(false)} autoFocus>
							Sí, borrar todo
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	)
}
