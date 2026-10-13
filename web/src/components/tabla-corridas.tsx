import { PildoraCorrida, PildoraSimulacion } from '@/components/pildora'
import { TablaDatos, type Columna } from '@/components/tabla-datos'
import { tituloCorrida } from '@/lib/corridas'
import { duracion, fechaHora } from '@/lib/formato'
import type { CorridaResumen } from '@/tipos/panel'

/** Historial de corridas, igual en el Resumen y en Sincronización. */

const COLUMNAS: readonly Columna<CorridaResumen>[] = [
	{
		clave: 'tipo',
		cabecera: 'Corrida',
		soloTabla: true,
		celda: corrida => (
			<span className="flex flex-wrap items-center gap-2">
				<span>{tituloCorrida(corrida)}</span>
				{corrida.simulacion && <PildoraSimulacion />}
			</span>
		),
	},
	{
		clave: 'inicio',
		cabecera: 'Inicio',
		celda: corrida => (
			<span className="text-muted-foreground">
				{fechaHora(corrida.inicio)}
				{corrida.duracion_ms !== null && <span className="text-xs"> · {duracion(corrida.duracion_ms)}</span>}
			</span>
		),
	},
	{
		clave: 'disparo',
		cabecera: 'Disparo',
		celda: corrida => <span className="text-muted-foreground">{corrida.disparo === 'automatica' ? 'Automática' : 'Manual'}</span>,
	},
	{ clave: 'estado', cabecera: 'Estado', celda: corrida => <PildoraCorrida estado={corrida.estado} /> },
	{
		clave: 'resumen',
		cabecera: 'Resultado',
		celda: corrida => <span className="text-muted-foreground">{corrida.resumen}</span>,
		envuelve: true,
		className: 'min-w-[22rem]',
	},
]

export function TablaCorridas({ corridas }: { corridas: readonly CorridaResumen[] }) {
	return (
		<TablaDatos
			etiqueta="Historial de corridas de sincronización"
			columnas={COLUMNAS}
			filas={corridas}
			claveFila={corrida => String(corrida.id)}
			enlaceFila={corrida => `/corridas/${corrida.id}`}
			tituloTarjeta={corrida => (
				<span className="flex flex-wrap items-center gap-2">
					{tituloCorrida(corrida)}
					{corrida.simulacion && <PildoraSimulacion />}
				</span>
			)}
		/>
	)
}
