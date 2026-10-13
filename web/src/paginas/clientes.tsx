import { PackageOpen, SearchX } from 'lucide-react'
import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'

import { BloqueError, EstadoVacio } from '@/components/estados'
import { EncabezadoPagina, Seccion, SkeletonTabla } from '@/components/piezas'
import { TablaDatos, type Columna } from '@/components/tabla-datos'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useRecurso, useRetardo } from '@/datos/api'
import { usePanel } from '@/datos/panel'
import { antiguedad, entero, fecha, usd } from '@/lib/formato'
import type { ClienteFila, ListaClientes } from '@/tipos/panel'

/** La antigüedad se mide contra el reloj del sandbox; si aún no llegó, no se escribe. */
const columnas = (hoy: string | null): readonly Columna<ClienteFila>[] => [
	{ clave: 'nombre', cabecera: 'Cliente', celda: cliente => cliente.nombre, soloTabla: true },
	{ clave: 'documento', cabecera: 'Documento', celda: cliente => <span className="font-mono text-[0.8rem]">{cliente.documento}</span> },
	{ clave: 'tipo', cabecera: 'Tipo', celda: cliente => (cliente.persona === 'juridica' ? 'Jurídica' : 'Natural') },
	{ clave: 'contratos', cabecera: 'Contratos', celda: cliente => entero(cliente.contratos), numerica: true },
	{ clave: 'abiertas', cabecera: 'Abiertas', celda: cliente => entero(cliente.facturas_abiertas), numerica: true },
	{ clave: 'pagadas', cabecera: 'Pagadas', celda: cliente => entero(cliente.facturas_pagadas), numerica: true },
	{
		clave: 'deuda',
		cabecera: 'Deuda',
		numerica: true,
		celda: cliente => <span className={cliente.deuda_centavos > 0 ? 'font-medium' : 'text-muted-foreground'}>{usd(cliente.deuda_centavos)}</span>,
	},
	{
		clave: 'vence',
		cabecera: 'Vence la más antigua',
		celda: cliente =>
			cliente.vence_mas_antigua === null ? (
				<span className="text-muted-foreground">Al día</span>
			) : (
				<span className="grid">
					<span>{fecha(cliente.vence_mas_antigua)}</span>
					{hoy !== null && <span className="text-xs text-muted-foreground">{antiguedad(cliente.vence_mas_antigua, hoy)}</span>}
				</span>
			),
	},
]

/** Tabla de clientes (§3.5): búsqueda por nombre, cédula o RIF. */
export function PaginaClientes() {
	const [parametros, setParametros] = useSearchParams()
	const consulta = parametros.get('q') ?? ''
	const buscada = useRetardo(consulta)
	const { hoy } = usePanel()

	const recurso = useRecurso<ListaClientes>(`/api/clientes?q=${encodeURIComponent(buscada)}`)
	const clientes = recurso.dato?.clientes ?? []
	const columnasDeLaTabla = useMemo(() => columnas(hoy), [hoy])

	const cambiarConsulta = (valor: string): void => {
		const siguientes = new URLSearchParams(parametros)
		if (valor) siguientes.set('q', valor)
		else siguientes.delete('q')
		setParametros(siguientes, { replace: true })
	}

	return (
		<>
			<EncabezadoPagina
				titulo="Clientes"
				descripcion="Un cliente por cédula o RIF: si un titular tiene varios contratos en el administrador, todos quedan en el mismo cliente."
			/>

			<div className="grid gap-5">
				<form role="search" className="flex flex-wrap items-end gap-2" onSubmit={evento => evento.preventDefault()}>
					<div className="grid min-w-0 flex-1 gap-1.5 sm:max-w-sm">
						<Label htmlFor="busqueda-clientes">Buscar por nombre, cédula o RIF</Label>
						<Input
							id="busqueda-clientes"
							type="search"
							value={consulta}
							placeholder="LUIS GOMEZ · V-9876543 · 09000123"
							onChange={evento => cambiarConsulta(evento.target.value)}
						/>
					</div>
					{consulta && (
						<Button type="button" variant="ghost" onClick={() => cambiarConsulta('')}>
							Limpiar
						</Button>
					)}
				</form>

				{recurso.error ? (
					<BloqueError error={recurso.error} alReintentar={() => recurso.recargar()} />
				) : recurso.dato === null ? (
					<Card className="p-4">
						<SkeletonTabla filas={8} />
					</Card>
				) : clientes.length === 0 && buscada === '' ? (
					<Card>
						<EstadoVacio
							icono={PackageOpen}
							titulo="Todavía no has importado nada"
							descripcion="Los clientes se crean solos al importar las cuotas del administrador de facturas: uno por cada identificación de titular."
							accion={{ a: '/sincronizacion', etiqueta: 'Importar cuotas' }}
						/>
					</Card>
				) : clientes.length === 0 ? (
					<Card>
						<EstadoVacio
							icono={SearchX}
							titulo={`Ningún cliente coincide con «${buscada}»`}
							descripcion="Prueba con parte del nombre, o con la cédula con o sin guion: V-9876543, v9876543 y 9876543 encuentran al mismo titular."
						>
							<Button variant="outline" onClick={() => cambiarConsulta('')}>
								Ver todos los clientes
							</Button>
						</EstadoVacio>
					</Card>
				) : (
					<Seccion
						titulo={
							buscada
								? `${entero(recurso.dato.total)} ${recurso.dato.total === 1 ? 'resultado' : 'resultados'}`
								: `${entero(recurso.dato.total)} ${recurso.dato.total === 1 ? 'cliente' : 'clientes'}`
						}
						descripcion="Cada fila abre el expediente del cliente."
					>
						<TablaDatos
							etiqueta="Clientes importados, con su deuda y el vencimiento más antiguo"
							columnas={columnasDeLaTabla}
							filas={clientes}
							claveFila={cliente => cliente.id}
							enlaceFila={cliente => `/clientes/${encodeURIComponent(cliente.id)}`}
							tituloTarjeta={cliente => cliente.nombre}
							subtituloTarjeta={cliente => (cliente.persona === 'juridica' ? 'Persona jurídica' : 'Persona natural')}
						/>
					</Seccion>
				)}
			</div>
		</>
	)
}
