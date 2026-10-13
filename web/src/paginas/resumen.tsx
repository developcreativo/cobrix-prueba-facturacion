import { Download, PackageOpen, RefreshCcw } from 'lucide-react'
import { Link } from 'react-router-dom'

import { ConsolaCorrida, DialogoConfirmarCorrida, useEjecucionCorrida } from '@/components/corrida-en-vivo'
import { BloqueError, EstadoVacio } from '@/components/estados'
import { Pildora } from '@/components/pildora'
import { Dato, EncabezadoPagina, ListaDeDatos, RejillaDatos, Seccion, SkeletonTabla, SkeletonTarjetas, TarjetaDato } from '@/components/piezas'
import { TablaCorridas } from '@/components/tabla-corridas'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ERROR_EJEMPLO, RESUMEN } from '@/datos/ejemplo'
import { entero, fecha, lista, periodo, usd } from '@/lib/formato'
import { useVista } from '@/lib/vista'

/** Pantalla de inicio (§3.8): totales, proveedor, corrida automática y últimas corridas. */
export function PaginaResumen() {
	const vista = useVista()
	const vacio = vista === 'vacio'
	const corrida = useEjecucionCorrida()

	const totales = vacio
		? {
			clientes: 0,
			contratos: 0,
			contratos_leidos_ultima_corrida: null,
			facturas_abiertas: 0,
			facturas_pagadas: 0,
			por_cobrar_centavos: 0,
		}
		: RESUMEN.totales
	const corridas = vacio ? [] : RESUMEN.ultimas_corridas
	const proveedor = RESUMEN.proveedor

	return (
		<>
			<EncabezadoPagina
				titulo="Resumen"
				descripcion="Estado de la integración entre Cobrix y el administrador de facturas del ISP: qué hay importado, con qué proveedor y qué hizo la última sincronización."
				acciones={
					<>
						<Button onClick={() => corrida.solicitar({ tipo: 'importacion', simulacion: false })}>
							<Download aria-hidden="true" />
							Importar cuotas
						</Button>
						<Button variant="outline" onClick={() => corrida.solicitar({ tipo: 'pagadas', simulacion: false })}>
							<RefreshCcw aria-hidden="true" />
							Actualizar pagadas
						</Button>
					</>
				}
			/>

			<div className="grid gap-5">
				{corrida.ejecucion && <ConsolaCorrida ejecucion={corrida.ejecucion} alCerrar={corrida.cerrar} />}

				{vista === 'error' ? (
					<BloqueError error={ERROR_EJEMPLO} alReintentar={() => window.location.reload()} />
				) : vista === 'cargando' ? (
					<>
						<SkeletonTarjetas cantidad={5} />
						<Card className="p-4">
							<SkeletonTabla />
						</Card>
					</>
				) : (
					<>
						<RejillaDatos className="lg:grid-cols-5">
							<TarjetaDato etiqueta="Clientes importados" valor={entero(totales.clientes)} />
							<TarjetaDato
								etiqueta="Contratos espejados"
								valor={entero(totales.contratos)}
								pie={
									totales.contratos_leidos_ultima_corrida === null
										? undefined
										: `de ${entero(totales.contratos_leidos_ultima_corrida)} leídos en la última corrida`
								}
							/>
							<TarjetaDato etiqueta="Facturas abiertas" valor={entero(totales.facturas_abiertas)} />
							<TarjetaDato etiqueta="Facturas pagadas" valor={entero(totales.facturas_pagadas)} />
							<TarjetaDato etiqueta="Por cobrar" valor={usd(totales.por_cobrar_centavos)} acento />
						</RejillaDatos>

						{vacio && (
							<Card>
								<EstadoVacio
									icono={PackageOpen}
									titulo="Todavía no has importado nada"
									descripcion="Cobrix está recién instalado. Importa las cuotas del administrador de facturas para crear los clientes y sus facturas abiertas. Si prefieres mirar antes, usa «Simular importación»: no escribe nada."
									accion={{ a: '/sincronizacion', etiqueta: 'Ir a Sincronización' }}
								/>
							</Card>
						)}

						<div className="grid gap-4 lg:grid-cols-2">
							<Card>
								<CardHeader>
									<CardTitle>Administrador de facturas</CardTitle>
									<CardAction>
										<Button asChild variant="ghost" size="sm">
											<Link to="/configuracion">Editar configuración</Link>
										</Button>
									</CardAction>
								</CardHeader>
								<CardContent>
									<ListaDeDatos>
										<Dato etiqueta="Proveedor">{proveedor.nombre}</Dato>
										<Dato etiqueta="URL de la API" mono>
											{proveedor.api_url}
										</Dato>
										<Dato etiqueta="Usuario">{proveedor.usuario}</Dato>
										<Dato etiqueta="Contraseña">
											{proveedor.password_definida ? (
												<Pildora tono="ok">Guardada</Pildora>
											) : (
												<Pildora tono="warn">Sin definir</Pildora>
											)}
										</Dato>
										<Dato etiqueta="Estados que se importan">{lista([...proveedor.estados_importables])}</Dato>
										<Dato etiqueta="Ventana">
											{proveedor.ventana_meses === null ? 'Sin ventana' : `${proveedor.ventana_meses} meses`} ·{' '}
											{proveedor.max_cuotas_recientes === null ? 'sin límite de recientes' : `máx. ${proveedor.max_cuotas_recientes} recientes`}
										</Dato>
										<Dato etiqueta="Topes por corrida">
											{proveedor.tope_facturas === null && proveedor.tope_monto_centavos === null
												? 'Sin topes'
												: `${proveedor.tope_facturas ?? '—'} facturas · ${usd(proveedor.tope_monto_centavos)}`}
										</Dato>
									</ListaDeDatos>
								</CardContent>
							</Card>

							<Card>
								<CardHeader>
									<CardTitle>Corrida automática</CardTitle>
								</CardHeader>
								<CardContent className="grid gap-3">
									<ListaDeDatos>
										<Dato etiqueta="Estado">
											{RESUMEN.automatico.activa ? (
												<Pildora tono="ok">Encendida</Pildora>
											) : (
												<Pildora tono="mute">Apagada</Pildora>
											)}
										</Dato>
										<Dato etiqueta="Hora">
											{RESUMEN.automatico.hora ?? '—'} ({RESUMEN.automatico.zona})
										</Dato>
										<Dato etiqueta="Qué hace">Importa las cuotas y después actualiza las facturas pagadas, en ese orden.</Dato>
										<Dato etiqueta="Fecha del sandbox">
											{fecha(RESUMEN.sandbox.hoy)} · mes actual {periodo(RESUMEN.sandbox.periodo_actual)}
										</Dato>
									</ListaDeDatos>
									<div className="flex flex-wrap gap-2">
										<Button variant="outline" size="sm" onClick={() => corrida.solicitar({ tipo: 'importacion', simulacion: true })}>
											Simular importación
										</Button>
										<Button variant="outline" size="sm" onClick={() => corrida.solicitar({ tipo: 'pagadas', simulacion: true })}>
											Simular actualización
										</Button>
									</div>
								</CardContent>
							</Card>
						</div>

						<Seccion
							titulo="Últimas corridas"
							accion={
								<Button asChild variant="ghost" size="sm">
									<Link to="/sincronizacion">Ver todas</Link>
								</Button>
							}
						>
							{corridas.length === 0 ? (
								<EstadoVacio
									titulo="Aún no hay corridas"
									descripcion="Cuando importes cuotas o actualices las pagadas, cada corrida quedará aquí con su resultado y su detalle cuota por cuota."
									accion={{ a: '/sincronizacion', etiqueta: 'Ir a Sincronización' }}
								/>
							) : (
								<TablaCorridas corridas={corridas} />
							)}
						</Seccion>
					</>
				)}
			</div>

			<DialogoConfirmarCorrida peticion={corrida.pendiente} alConfirmar={corrida.confirmar} alCancelar={corrida.cancelar} />
		</>
	)
}
