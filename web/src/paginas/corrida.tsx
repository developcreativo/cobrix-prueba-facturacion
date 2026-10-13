import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'

import { BloqueError, EstadoVacio } from '@/components/estados'
import { Pildora, PildoraCorrida, PildoraSimulacion } from '@/components/pildora'
import { Codigo, Dato, EncabezadoPagina, ListaDeDatos, RejillaDatos, Seccion, SkeletonTabla, SkeletonTarjetas, TarjetaDato } from '@/components/piezas'
import { FilaDecision } from '@/components/traza-decision'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { corridaPorId } from '@/datos/ejemplo'
import { NOMBRE_CORRIDA } from '@/lib/corridas'
import { duracion, entero, fechaHora, lista, usd } from '@/lib/formato'
import { CLASES_TONO, etiquetaResultado, tonoResultado } from '@/lib/resultados'
import { cn } from '@/lib/utils'
import { useVista } from '@/lib/vista'
import type { Contador, Resultado } from '@/tipos/panel'

/** Un número de la corrida: entero o dinero, según lo que diga el contador. */
const valorContador = (contador: Contador): string => (contador.tipo === 'dinero' ? usd(contador.valor) : entero(contador.valor))

interface FilaDesglose {
	readonly resultado: string
	readonly etiqueta: string
	readonly clave: string
	readonly unidades: number
	readonly filas: number
}

/**
 * Empareja el desglose por resultado: `cuotas.X` (o `facturas.X`) con `lineas.X`.
 * Son dos cifras distintas a propósito y la tabla las muestra juntas, porque una fila puede
 * resumir varias cuotas.
 */
function desglosar(contadores: readonly Contador[]): { readonly unidad: string; readonly filas: readonly FilaDesglose[] } {
	const porResultado = new Map<string, FilaDesglose>()
	let unidad = 'Cuotas'
	for (const contador of contadores) {
		const punto = contador.clave.indexOf('.')
		if (punto < 0) continue
		const prefijo = contador.clave.slice(0, punto)
		const resultado = contador.clave.slice(punto + 1)
		const previo = porResultado.get(resultado) ?? {
			resultado,
			etiqueta: contador.etiqueta,
			clave: contador.clave,
			unidades: 0,
			filas: 0,
		}
		if (prefijo === 'lineas') {
			porResultado.set(resultado, { ...previo, filas: contador.valor })
		} else {
			unidad = prefijo === 'facturas' ? 'Facturas' : 'Cuotas'
			porResultado.set(resultado, { ...previo, unidades: contador.valor, clave: contador.clave })
		}
	}
	return { unidad, filas: [...porResultado.values()].sort((a, b) => b.unidades - a.unidades || b.filas - a.filas) }
}

/** Detalle de una corrida (§3.4): contadores y una fila por cuota, con su traza desplegable. */
export function PaginaCorrida() {
	const { id } = useParams()
	const vista = useVista()
	const corrida = corridaPorId(Number(id))
	const [filtro, setFiltro] = useState<Resultado | 'todos'>('todos')

	const resultados = useMemo(() => {
		const cuenta = new Map<Resultado, number>()
		for (const linea of corrida?.lineas ?? []) cuenta.set(linea.resultado, (cuenta.get(linea.resultado) ?? 0) + 1)
		return [...cuenta.entries()].sort((a, b) => b[1] - a[1])
	}, [corrida])

	if (!corrida) {
		return (
			<>
				<EncabezadoPagina titulo="Corrida no encontrada" volver={{ a: '/sincronizacion', etiqueta: 'Sincronización' }} />
				<Card>
					<EstadoVacio
						titulo="Esa corrida no existe"
						descripcion="Puede que se haya borrado con los datos importados. Vuelve al historial y elige otra."
						accion={{ a: '/sincronizacion', etiqueta: 'Ver el historial' }}
					/>
				</Card>
			</>
		)
	}

	const destacados = corrida.contadores.filter(contador => contador.destacado)
	const totales = corrida.contadores.filter(contador => !contador.clave.includes('.'))
	const desglose = desglosar(corrida.contadores)
	const lineas = filtro === 'todos' ? corrida.lineas : corrida.lineas.filter(linea => linea.resultado === filtro)
	const montoClasificado = corrida.lineas.reduce((suma, linea) => suma + linea.monto_centavos, 0)
	const cuotasClasificadas = corrida.lineas.reduce((suma, linea) => suma + linea.cuotas, 0)

	return (
		<>
			<EncabezadoPagina
				volver={{ a: '/sincronizacion', etiqueta: 'Sincronización' }}
				titulo={`${NOMBRE_CORRIDA[corrida.tipo]} #${corrida.id}`}
				meta={
					<>
						<span>{fechaHora(corrida.inicio)}</span>
						<span aria-hidden="true">·</span>
						<PildoraCorrida estado={corrida.estado} />
						{corrida.simulacion && <PildoraSimulacion />}
						<span aria-hidden="true">·</span>
						<span>{corrida.disparo === 'automatica' ? 'Corrida automática' : 'Lanzada a mano'}</span>
						{corrida.duracion_ms !== null && (
							<>
								<span aria-hidden="true">·</span>
								<span>{duracion(corrida.duracion_ms)}</span>
							</>
						)}
					</>
				}
			/>

			<div className="grid gap-5">
				{corrida.simulacion && (
					<p className="rounded-lg border border-info-line bg-info-soft/50 px-4 py-2.5 text-sm">
						<strong className="font-medium">Simulación:</strong> esta corrida no escribió nada en Cobrix. Los contadores dicen qué habría pasado.
					</p>
				)}

				{corrida.error && <BloqueError error={corrida.error} titulo="La corrida falló" />}

				{vista === 'cargando' ? (
					<>
						<SkeletonTarjetas cantidad={6} />
						<Card className="p-4">
							<SkeletonTabla filas={8} />
						</Card>
					</>
				) : (
					<>
						<RejillaDatos className="lg:grid-cols-6">
							{destacados.map(contador => (
								<TarjetaDato key={contador.clave} etiqueta={contador.etiqueta} valor={valorContador(contador)} />
							))}
						</RejillaDatos>

						<Seccion
							titulo="Contadores"
							descripcion="Con el nombre que usan por dentro, para poder cruzarlos con los registros de la corrida."
							id="contadores"
						>
							<ul className="grid">
								{totales.map(contador => (
									<li
										key={contador.clave}
										className="flex items-baseline justify-between gap-3 border-b border-border px-3 py-2 text-sm last:border-0 md:px-4"
									>
										<span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
											<span>{contador.etiqueta}</span>
											<Codigo>{contador.clave}</Codigo>
										</span>
										<span className="tabular font-medium">{valorContador(contador)}</span>
									</li>
								))}
							</ul>
						</Seccion>

						{desglose.filas.length > 0 && (
							<Seccion
								titulo="Por resultado"
								descripcion={`«${desglose.unidad}» cuenta ${desglose.unidad === 'Facturas' ? 'facturas de Cobrix' : 'cuotas del administrador'}; «filas» cuenta las líneas del detalle de abajo. No siempre coinciden: cuando se descarta un contrato entero, una sola fila resume varias cuotas.`}
								id="desglose"
							>
								<div className="grid grid-cols-[minmax(0,1fr)_4.5rem_4.5rem] items-baseline gap-x-3 border-b border-border bg-muted/60 px-3 py-2 text-xs font-medium text-muted-foreground md:px-4">
									<span>Resultado</span>
									<span className="text-right">{desglose.unidad}</span>
									<span className="text-right">Filas</span>
								</div>
								<ul className="grid">
									{desglose.filas.map(fila => (
										<li
											key={fila.resultado}
											className="grid grid-cols-[minmax(0,1fr)_4.5rem_4.5rem] items-baseline gap-x-3 border-b border-border px-3 py-2 text-sm last:border-0 md:px-4"
										>
											<span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
												<span>{fila.etiqueta}</span>
												<Codigo>{fila.clave}</Codigo>
											</span>
											<span className="tabular text-right font-medium">{entero(fila.unidades)}</span>
											<span className="tabular text-right text-muted-foreground">{entero(fila.filas)}</span>
										</li>
									))}
								</ul>
							</Seccion>
						)}

						<Seccion
							titulo="Detalle, fila por fila"
							descripcion="Casi siempre una fila es una cuota. Despliega cualquiera para ver las reglas que se evaluaron, en orden, y por qué terminó así."
							id="detalle"
							nota={`${entero(corrida.lineas.length)} filas · ${entero(cuotasClasificadas)} cuotas del administrador · ${usd(montoClasificado)} en juego. Los filtros cuentan filas.`}
							accion={
								<div className="flex flex-wrap items-center gap-1.5">
									<Button
										variant={filtro === 'todos' ? 'secondary' : 'ghost'}
										size="xs"
										aria-pressed={filtro === 'todos'}
										onClick={() => setFiltro('todos')}
									>
										Todas ({entero(corrida.lineas.length)})
									</Button>
									{resultados.map(([resultado, cantidad]) => (
										<Button
											key={resultado}
											variant="ghost"
											size="xs"
											aria-pressed={filtro === resultado}
											onClick={() => setFiltro(resultado)}
											className={cn('border border-transparent', filtro === resultado && CLASES_TONO[tonoResultado(resultado)])}
										>
											{etiquetaResultado(resultado, corrida.simulacion)} ({entero(cantidad)})
										</Button>
									))}
								</div>
							}
						>
							{corrida.lineas.length === 0 ? (
								<EstadoVacio
									titulo="Esta corrida no clasificó ninguna cuota"
									descripcion="Falló antes de leer los contratos, así que no hay decisiones que explicar. Arregla el error de arriba y vuelve a lanzarla."
									accion={{ a: '/sincronizacion', etiqueta: 'Volver a Sincronización' }}
								/>
							) : lineas.length === 0 ? (
								<EstadoVacio titulo="Ninguna fila con ese resultado" descripcion="Quita el filtro para ver todas las cuotas de la corrida." />
							) : (
								<>
									<div
										className="hidden grid-cols-[1.25rem_10rem_minmax(0,1fr)_6rem_auto_6.5rem] items-center gap-x-2 border-b border-border bg-muted/60 px-3 py-2 text-xs font-medium text-muted-foreground md:grid"
										aria-hidden="true"
									>
										<span />
										<span>Contrato · cuota</span>
										<span>Cliente</span>
										<span>Periodo</span>
										<span>Resultado</span>
										<span className="text-right">Monto</span>
									</div>
									<ul>
										{lineas.map(linea => (
											<FilaDecision key={`${linea.id}-${linea.deuda_id}`} linea={linea} tipo={corrida.tipo} simulacion={corrida.simulacion} />
										))}
									</ul>
								</>
							)}
						</Seccion>

						<Seccion titulo="Configuración con la que corrió" descripcion="Una corrida vieja se sigue explicando aunque la configuración cambie después.">
							<div className="p-4">
								<ListaDeDatos>
									<Dato etiqueta="Estados importables">
										<span className="flex flex-wrap gap-1.5">
											{corrida.config_snapshot.estados_importables.map(estado => (
												<Pildora key={estado} tono="info" conIcono={false}>
													{estado}
												</Pildora>
											))}
										</span>
									</Dato>
									<Dato etiqueta="Ventana de importación">
										{corrida.config_snapshot.ventana_meses === null ? 'Sin ventana' : `${corrida.config_snapshot.ventana_meses} meses`}
									</Dato>
									<Dato etiqueta="Máx. cuotas recientes">
										{corrida.config_snapshot.max_cuotas_recientes === null ? 'Todas' : corrida.config_snapshot.max_cuotas_recientes}
									</Dato>
									<Dato etiqueta="Días de gracia">{corrida.config_snapshot.dias_gracia}</Dato>
									<Dato etiqueta="Topes por corrida">
										{corrida.config_snapshot.tope_facturas === null && corrida.config_snapshot.tope_monto_centavos === null
											? 'Sin topes'
											: `${corrida.config_snapshot.tope_facturas ?? '—'} facturas · ${usd(corrida.config_snapshot.tope_monto_centavos)}`}
									</Dato>
									<Dato etiqueta="Tipos de documento excluidos">
										{lista([...corrida.config_snapshot.excluir_tipos_documento], 'ninguno')}
									</Dato>
								</ListaDeDatos>
							</div>
						</Seccion>
					</>
				)}
			</div>
		</>
	)
}
