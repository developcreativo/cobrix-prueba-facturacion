import { FileText, UserPlus, Wallet } from 'lucide-react'
import type { ComponentType } from 'react'
import { useParams } from 'react-router-dom'

import { BloqueError, EstadoVacio } from '@/components/estados'
import { PildoraContrato, PildoraFactura } from '@/components/pildora'
import { Codigo, Dato, EncabezadoPagina, ListaDeDatos, RejillaDatos, Seccion, SkeletonTabla, SkeletonTarjetas, TarjetaDato } from '@/components/piezas'
import { TablaDatos, type Columna } from '@/components/tabla-datos'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ERROR_EJEMPLO, FECHA_SANDBOX, expedientePorId } from '@/datos/ejemplo'
import { antiguedad, entero, fecha, fechaHora, periodo as formatoPeriodo, usd } from '@/lib/formato'
import { useVista } from '@/lib/vista'
import type { ContratoExpediente, EventoExpediente, FacturaExpediente, TipoEvento } from '@/tipos/panel'

const COLUMNAS_CONTRATO: readonly Columna<ContratoExpediente>[] = [
	{ clave: 'id', cabecera: 'Contrato', celda: contrato => <span className="font-mono text-[0.8rem]">{contrato.id}</span>, soloTabla: true },
	{ clave: 'estado', cabecera: 'Estado', celda: contrato => <PildoraContrato estado={contrato.estado} /> },
	{
		clave: 'plan',
		cabecera: 'Plan',
		celda: contrato => (
			<span className="grid">
				<span>{contrato.plan}</span>
				<span className="text-xs text-muted-foreground">
					{usd(contrato.precio_centavos)} al mes
				</span>
			</span>
		),
	},
	{ clave: 'sucursal', cabecera: 'Sucursal', celda: contrato => contrato.sucursal },
	{
		clave: 'direccion',
		cabecera: 'Dirección',
		envuelve: true,
		celda: contrato => <span className="text-muted-foreground">{contrato.direccion ?? '—'}</span>,
	},
]

const COLUMNAS_FACTURA: readonly Columna<FacturaExpediente>[] = [
	{ clave: 'numero', cabecera: 'Factura', celda: factura => <span className="font-mono text-[0.8rem]">{factura.numero}</span>, soloTabla: true },
	{
		clave: 'cuota',
		cabecera: 'Cuota en el administrador',
		celda: factura => (
			<span className="grid">
				<span className="font-mono text-[0.8rem]">{factura.deuda_id}</span>
				<Codigo>contrato {factura.contrato_id}</Codigo>
			</span>
		),
	},
	{ clave: 'periodo', cabecera: 'Periodo', celda: factura => formatoPeriodo(factura.periodo) },
	{
		clave: 'descripcion',
		cabecera: 'Descripción',
		envuelve: true,
		celda: factura => <span className="text-muted-foreground">{factura.descripcion}</span>,
	},
	{ clave: 'vence', cabecera: 'Vence', celda: factura => fecha(factura.vence_el) },
	{ clave: 'corte', cabecera: 'Corte', celda: factura => fecha(factura.corta_el) },
	{ clave: 'total', cabecera: 'Total', celda: factura => usd(factura.total_centavos), numerica: true },
	{
		clave: 'saldo',
		cabecera: 'Saldo',
		numerica: true,
		celda: factura => <span className={factura.saldo_centavos > 0 ? 'font-medium' : 'text-muted-foreground'}>{usd(factura.saldo_centavos)}</span>,
	},
	{
		clave: 'estado',
		cabecera: 'Estado',
		celda: factura => (
			<span className="grid gap-1 justify-items-start">
				<PildoraFactura estado={factura.estado} />
				{factura.estado === 'pagada' ? (
					<span className="text-xs text-muted-foreground">
						{fecha(factura.pagada_el)}
						{factura.isp_factura_num && ` · ${factura.isp_factura_num}`}
					</span>
				) : (
					<span className="text-xs text-muted-foreground">{antiguedad(factura.vence_el, FECHA_SANDBOX)}</span>
				)}
			</span>
		),
	},
]

const ICONO_EVENTO: Record<TipoEvento, ComponentType<{ className?: string }>> = {
	cliente_creado: UserPlus,
	factura_importada: FileText,
	factura_pagada: Wallet,
}

function Historial({ eventos }: { eventos: readonly EventoExpediente[] }) {
	return (
		<ol className="grid">
			{eventos.map(evento => {
				const Icono = ICONO_EVENTO[evento.tipo]
				return (
					<li key={evento.id} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 border-b border-border px-3 py-2.5 last:border-0 md:px-4">
						<span className="mt-0.5 grid size-7 place-items-center rounded-full bg-muted text-muted-foreground" aria-hidden="true">
							<Icono className="size-3.5" />
						</span>
						<div className="grid gap-0.5">
							<span className="flex flex-wrap items-baseline gap-x-2 text-sm">
								<strong className="font-medium">{evento.titulo}</strong>
								{evento.factura_numero && <Codigo>{evento.factura_numero}</Codigo>}
							</span>
							<span className="text-sm text-muted-foreground">{evento.detalle}</span>
							<time className="text-xs text-muted-foreground" dateTime={evento.ocurrido_en}>
								{fechaHora(evento.ocurrido_en)}
							</time>
						</div>
					</li>
				)
			})}
		</ol>
	)
}

/** Expediente del cliente (§3.6): datos, contratos, facturas e historial. */
export function PaginaExpediente() {
	const { id } = useParams()
	const vista = useVista()
	const expediente = expedientePorId(id ?? '')

	if (!expediente) {
		return (
			<>
				<EncabezadoPagina titulo="Cliente no encontrado" volver={{ a: '/clientes', etiqueta: 'Clientes' }} />
				<Card>
					<EstadoVacio
						titulo="Ese cliente no existe en Cobrix"
						descripcion="Puede que no se haya importado todavía, o que su identificación se normalice distinto. Búscalo en la tabla de clientes."
						accion={{ a: '/clientes', etiqueta: 'Ver todos los clientes' }}
					/>
				</Card>
			</>
		)
	}

	const { cliente, totales, contratos, facturas, historial } = expediente

	return (
		<>
			<EncabezadoPagina
				volver={{ a: '/clientes', etiqueta: 'Clientes' }}
				titulo={cliente.nombre}
				meta={
					<>
						<span>{cliente.persona === 'juridica' ? 'Persona jurídica' : 'Persona natural'}</span>
						<span aria-hidden="true">·</span>
						<Codigo>{cliente.documento}</Codigo>
					</>
				}
			/>

			<div className="grid gap-5">
				{vista === 'error' ? (
					<BloqueError error={ERROR_EJEMPLO} alReintentar={() => window.location.reload()} />
				) : vista === 'cargando' ? (
					<>
						<SkeletonTarjetas />
						<Card className="p-4">
							<SkeletonTabla filas={6} />
						</Card>
					</>
				) : (
					<>
						<RejillaDatos>
							<TarjetaDato etiqueta="Deuda abierta" valor={usd(totales.deuda_centavos)} acento />
							<TarjetaDato etiqueta="Facturas abiertas" valor={entero(totales.facturas_abiertas)} />
							<TarjetaDato etiqueta="Facturas pagadas" valor={entero(totales.facturas_pagadas)} />
							<TarjetaDato etiqueta="Contratos" valor={entero(totales.contratos)} />
						</RejillaDatos>

						<div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
							<Card>
								<CardHeader>
									<CardTitle>Datos del cliente</CardTitle>
								</CardHeader>
								<CardContent>
									<ListaDeDatos className="sm:grid-cols-[minmax(7rem,auto)_minmax(0,1fr)]">
										<Dato etiqueta="ID en Cobrix" mono>
											{cliente.id}
										</Dato>
										<Dato etiqueta="Documento" mono>
											{cliente.documento}
										</Dato>
										<Dato etiqueta="Correo">{cliente.email ?? '—'}</Dato>
										<Dato etiqueta="Teléfono">{cliente.telefono ?? '—'}</Dato>
										<Dato etiqueta="Origen">{cliente.origen}</Dato>
										<Dato etiqueta="Creado">{fechaHora(cliente.creado_en)}</Dato>
									</ListaDeDatos>
								</CardContent>
							</Card>

							<Seccion titulo="Contratos en el administrador">
								<TablaDatos
									etiqueta="Contratos del cliente en el administrador de facturas"
									columnas={COLUMNAS_CONTRATO}
									filas={contratos}
									claveFila={contrato => String(contrato.id)}
									tituloTarjeta={contrato => <span className="font-mono text-[0.85rem]">Contrato {contrato.id}</span>}
								/>
							</Seccion>
						</div>

						<Seccion
							titulo="Facturas"
							descripcion="Una factura de Cobrix por cada cuota del administrador."
							nota="El vencimiento es el primer día del periodo: el administrador de facturas no da un vencimiento por cuota. El corte le suma los días de gracia configurados."
						>
							{facturas.length === 0 ? (
								<EstadoVacio
									titulo="Este cliente no tiene facturas"
									descripcion="Se crean al importar las cuotas pendientes de sus contratos."
									accion={{ a: '/sincronizacion', etiqueta: 'Importar cuotas' }}
								/>
							) : (
								<TablaDatos
									etiqueta="Facturas del cliente en Cobrix"
									columnas={COLUMNAS_FACTURA}
									filas={facturas}
									claveFila={factura => factura.numero}
									tituloTarjeta={factura => <span className="font-mono text-[0.85rem]">{factura.numero}</span>}
									subtituloTarjeta={factura => factura.descripcion}
								/>
							)}
						</Seccion>

						<Seccion titulo="Historial" descripcion="Qué le ha pasado a este cliente dentro de Cobrix.">
							{historial.length === 0 ? (
								<EstadoVacio titulo="Sin movimientos" descripcion="Aquí quedan la creación del cliente, cada factura importada y cada pago aplicado." />
							) : (
								<Historial eventos={historial} />
							)}
						</Seccion>
					</>
				)}
			</div>
		</>
	)
}
