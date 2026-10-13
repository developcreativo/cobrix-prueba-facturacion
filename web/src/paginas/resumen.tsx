import { Download, PackageOpen, RefreshCcw } from 'lucide-react'
import { Link } from 'react-router-dom'

import { ConsolaCorrida, DialogoConfirmarCorrida, useEjecucionCorrida } from '@/components/corrida-en-vivo'
import { BloqueError, EstadoVacio } from '@/components/estados'
import { Pildora } from '@/components/pildora'
import { Dato, EncabezadoPagina, ListaDeDatos, RejillaDatos, Seccion, SkeletonTabla, SkeletonTarjetas, TarjetaDato } from '@/components/piezas'
import { TablaCorridas } from '@/components/tabla-corridas'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useRecurso } from '@/datos/api'
import { usePanel } from '@/datos/panel'
import { entero, fecha, lista, periodo, usd } from '@/lib/formato'
import type { Resumen } from '@/tipos/panel'

/** Pantalla de inicio (§3.8): totales, proveedor, corrida automática y últimas corridas. */
export function PaginaResumen() {
	const recurso = useRecurso<Resumen>('/api/resumen')
	const panel = usePanel()
	const corrida = useEjecucionCorrida(() => {
		recurso.recargar(true)
		panel.recargar()
	})
	const resumen = recurso.dato

	const acciones = (
		<>
			<Button onClick={() => corrida.solicitar({ tipo: 'importacion', simulacion: false })} disabled={corrida.lanzando}>
				<Download aria-hidden="true" />
				Importar cuotas
			</Button>
			<Button variant="outline" onClick={() => corrida.solicitar({ tipo: 'pagadas', simulacion: false })} disabled={corrida.lanzando}>
				<RefreshCcw aria-hidden="true" />
				Actualizar pagadas
			</Button>
		</>
	)

	const vacio = resumen !== null && resumen.totales.clientes === 0 && resumen.ultimas_corridas.length === 0

	return (
		<>
			<EncabezadoPagina
				titulo="Resumen"
				descripcion="Estado de la integración entre Cobrix y el administrador de facturas del ISP: qué hay importado, con qué proveedor y qué hizo la última sincronización."
				acciones={acciones}
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
				{corrida.ejecucion && <ConsolaCorrida ejecucion={corrida.ejecucion} alCerrar={corrida.cerrar} />}

				{recurso.error ? (
					<BloqueError error={recurso.error} alReintentar={() => recurso.recargar()} />
				) : resumen === null ? (
					<>
						<SkeletonTarjetas cantidad={5} />
						<Card className="p-4">
							<SkeletonTabla />
						</Card>
					</>
				) : (
					<>
						<RejillaDatos className="lg:grid-cols-5">
							<TarjetaDato etiqueta="Clientes importados" valor={entero(resumen.totales.clientes)} />
							<TarjetaDato
								etiqueta="Contratos espejados"
								valor={entero(resumen.totales.contratos)}
								pie={
									resumen.totales.contratos_leidos_ultima_corrida === null
										? undefined
										: `de ${entero(resumen.totales.contratos_leidos_ultima_corrida)} leídos en la última corrida`
								}
							/>
							<TarjetaDato etiqueta="Facturas abiertas" valor={entero(resumen.totales.facturas_abiertas)} />
							<TarjetaDato etiqueta="Facturas pagadas" valor={entero(resumen.totales.facturas_pagadas)} />
							<TarjetaDato etiqueta="Por cobrar" valor={usd(resumen.totales.por_cobrar_centavos)} acento />
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
										<Dato etiqueta="Proveedor">{resumen.proveedor.nombre}</Dato>
										<Dato etiqueta="URL de la API" mono>
											{resumen.proveedor.api_url}
										</Dato>
										{resumen.proveedor.docs_url && (
											<Dato etiqueta="Documentación">
												<a
													href={resumen.proveedor.docs_url}
													target="_blank"
													rel="noreferrer"
													className="text-primary underline-offset-4 hover:underline"
												>
													Swagger del administrador
												</a>
											</Dato>
										)}
										<Dato etiqueta="Usuario">{resumen.proveedor.usuario}</Dato>
										<Dato etiqueta="Contraseña">
											{resumen.proveedor.password_definida ? (
												<Pildora tono="ok">Guardada</Pildora>
											) : (
												<Pildora tono="warn">Sin definir</Pildora>
											)}
										</Dato>
										<Dato etiqueta="Estados que se importan">{lista([...resumen.proveedor.estados_importables])}</Dato>
										<Dato etiqueta="Ventana">
											{resumen.proveedor.ventana_meses === null ? 'Sin ventana' : `${resumen.proveedor.ventana_meses} meses`} ·{' '}
											{resumen.proveedor.max_cuotas_recientes === null
												? 'sin límite de recientes'
												: `máx. ${resumen.proveedor.max_cuotas_recientes} recientes`}
										</Dato>
										<Dato etiqueta="Topes por corrida">
											{resumen.proveedor.tope_facturas === null && resumen.proveedor.tope_monto_centavos === null
												? 'Sin topes'
												: `${resumen.proveedor.tope_facturas ?? '—'} facturas · ${usd(resumen.proveedor.tope_monto_centavos)}`}
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
											{resumen.automatico.activa ? <Pildora tono="ok">Encendida</Pildora> : <Pildora tono="mute">Apagada</Pildora>}
										</Dato>
										<Dato etiqueta="Hora">
											{resumen.automatico.hora ?? '—'} ({resumen.automatico.zona})
										</Dato>
										{resumen.automatico.proxima_ejecucion !== null && (
											<Dato etiqueta="Próxima">{fecha(resumen.automatico.proxima_ejecucion)}</Dato>
										)}
										<Dato etiqueta="Qué hace">Importa las cuotas y después actualiza las facturas pagadas, en ese orden.</Dato>
										<Dato etiqueta="Fecha del sandbox">
											{fecha(resumen.sandbox.hoy)} · mes actual {periodo(resumen.sandbox.periodo_actual)}
										</Dato>
									</ListaDeDatos>
									<div className="flex flex-wrap gap-2">
										<Button
											variant="outline"
											size="sm"
											disabled={corrida.lanzando}
											onClick={() => corrida.solicitar({ tipo: 'importacion', simulacion: true })}
										>
											Simular importación
										</Button>
										<Button
											variant="outline"
											size="sm"
											disabled={corrida.lanzando}
											onClick={() => corrida.solicitar({ tipo: 'pagadas', simulacion: true })}
										>
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
							{resumen.ultimas_corridas.length === 0 ? (
								<EstadoVacio
									titulo="Aún no hay corridas"
									descripcion="Cuando importes cuotas o actualices las pagadas, cada corrida quedará aquí con su resultado y su detalle cuota por cuota."
									accion={{ a: '/sincronizacion', etiqueta: 'Ir a Sincronización' }}
								/>
							) : (
								<TablaCorridas corridas={resumen.ultimas_corridas} />
							)}
						</Seccion>
					</>
				)}
			</div>

			<DialogoConfirmarCorrida
				peticion={corrida.pendiente}
				proveedor={resumen?.proveedor ?? null}
				alConfirmar={corrida.confirmar}
				alCancelar={corrida.cancelar}
			/>
		</>
	)
}
