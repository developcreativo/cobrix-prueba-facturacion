/**
 * Facturas de Cobrix: una por cuota pendiente del administrador (ENUNCIADO.md §4).
 *
 * `UNIQUE (proveedor_id, deuda_id)` es la idempotencia estructural: aunque la clasificación
 * fallara, la base no aceptaría la misma cuota dos veces. `deudasImportadas` es la cara barata
 * de esa misma regla: con ella la corrida marca `ya_importada` sin intentar escribir.
 *
 * Como en `clientes.ts`, aquí no se abre ninguna transacción: la corrida real envuelve todo.
 */

import type { Centavos } from '../dominio/dinero.ts'
import type { FacturaAbierta } from '../dominio/pagos.ts'
import { comoEntero, comoTexto, type Almacen } from './base.ts'
import { DatosInvalidos, INSTANTE } from './clientes.ts'

const PERIODO = /^\d{4}-\d{2}$/
const FECHA = /^\d{4}-\d{2}-\d{2}$/

export const PROVEEDOR_UNICO = 1

export interface NuevaFactura {
	readonly deudaId: string
	readonly clienteId: string
	readonly contratoId: number
	readonly periodo: string
	readonly venceEl: string
	readonly cortaEl: string
	/** Centavos enteros y mayor que cero: una factura de 0 no es cobrable. */
	readonly total: Centavos
	readonly corridaCreacion: number
	readonly proveedorId?: number
}

/** Choque con `UNIQUE (proveedor_id, deuda_id)`: la corrida se detiene antes que duplicar. */
export class FacturaDuplicada extends Error {
	readonly deudaId: string

	constructor(deudaId: string) {
		super(`La cuota ${deudaId} ya tiene factura en Cobrix: no se duplica.`)
		this.name = 'FacturaDuplicada'
		this.deudaId = deudaId
	}
}

/** Crea la factura abierta y devuelve su número de Cobrix. */
export function insertarFactura(almacen: Almacen, factura: NuevaFactura, momento: string): number {
	const problemas: string[] = []
	if (factura.deudaId.trim() === '' || factura.deudaId === '0') {
		problemas.push(`«${factura.deudaId}» no es un deuda_id de una cuota real.`)
	}
	if (!Number.isInteger(factura.contratoId) || factura.contratoId <= 0) {
		problemas.push(`El contrato «${String(factura.contratoId)}» no tiene un id utilizable.`)
	}
	if (!PERIODO.test(factura.periodo)) problemas.push(`El periodo «${factura.periodo}» no tiene la forma AAAA-MM.`)
	if (!FECHA.test(factura.venceEl)) problemas.push(`El vencimiento «${factura.venceEl}» no tiene la forma AAAA-MM-DD.`)
	if (!FECHA.test(factura.cortaEl)) problemas.push(`La fecha de corte «${factura.cortaEl}» no tiene la forma AAAA-MM-DD.`)
	if (!Number.isInteger(factura.total) || factura.total <= 0) {
		problemas.push(`El total de la cuota ${factura.deudaId} debe ser un entero de centavos mayor que cero.`)
	}
	if (!Number.isInteger(factura.corridaCreacion) || factura.corridaCreacion <= 0) {
		problemas.push('Una factura siempre nace dentro de una corrida: falta su identificador.')
	}
	if (!INSTANTE.test(momento)) problemas.push(`«${momento}» no es un instante AAAA-MM-DDTHH:MM:SS.`)
	if (problemas.length > 0) throw new DatosInvalidos(problemas)

	try {
		const resultado = almacen.db.prepare(`
			INSERT INTO factura (proveedor_id, deuda_id, cliente_id, contrato_id, periodo, vence_el, corta_el,
				total, saldo, estado, corrida_creacion, creada_en)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'abierta', ?, ?)`).run(
			factura.proveedorId ?? PROVEEDOR_UNICO, factura.deudaId, factura.clienteId, factura.contratoId,
			factura.periodo, factura.venceEl, factura.cortaEl, factura.total, factura.total,
			factura.corridaCreacion, momento,
		)
		return comoEntero(resultado.lastInsertRowid)
	} catch (error: unknown) {
		const mensaje = error instanceof Error ? error.message : String(error)
		if (mensaje.includes('UNIQUE')) throw new FacturaDuplicada(factura.deudaId)
		throw error
	}
}

/** Los `deuda_id` que Cobrix ya tiene: se lee una vez por corrida y alimenta `yaImportadas`. */
export function deudasImportadas(almacen: Almacen, proveedorId = PROVEEDOR_UNICO): ReadonlySet<string> {
	const filas = almacen.db.prepare('SELECT deuda_id FROM factura WHERE proveedor_id = ?')
		.all(proveedorId) as Array<Record<string, unknown>>
	return new Set(filas.map(fila => String(fila.deuda_id)))
}

/**
 * Las facturas que la corrida de pagadas tiene que revisar contra el libro del administrador,
 * en orden estable (contrato, periodo, cuota) para que la corrida sea reproducible.
 */
export function facturasAbiertas(almacen: Almacen, proveedorId = PROVEEDOR_UNICO): readonly FacturaAbierta[] {
	return facturasPorEstado(almacen, 'abierta', proveedorId)
}

/** Las que Cobrix ya tenía pagadas: la corrida las explica como `ya_pagada` sin preguntar nada. */
export function facturasPagadas(almacen: Almacen, proveedorId = PROVEEDOR_UNICO): readonly FacturaAbierta[] {
	return facturasPorEstado(almacen, 'pagada', proveedorId)
}

function facturasPorEstado(almacen: Almacen, estado: 'abierta' | 'pagada', proveedorId: number): readonly FacturaAbierta[] {
	const filas = almacen.db.prepare(`
		SELECT id, deuda_id, contrato_id, periodo, total, saldo FROM factura
		WHERE proveedor_id = ? AND estado = ?
		ORDER BY contrato_id, periodo, deuda_id`).all(proveedorId, estado) as Array<Record<string, unknown>>
	return filas.map(fila => ({
		facturaId: comoEntero(fila.id),
		deudaId: comoTexto(fila.deuda_id),
		contratoId: comoEntero(fila.contrato_id),
		periodo: comoTexto(fila.periodo),
		total: comoEntero(fila.total),
		saldo: comoEntero(fila.saldo),
	}))
}

export interface CobroDeFactura {
	/** La fecha en que el ISP cobró, no la de hoy: sale de la factura del administrador. */
	readonly pagadaEl: string
	readonly ispFacturaId: number
	readonly ispFacturaNum: string
	readonly corridaPago: number
}

/**
 * Marca la factura pagada y le deja el rastro de quién la cobró. Solo actúa sobre una factura
 * ABIERTA: si otra corrida se adelantó, devuelve `false` y no la toca dos veces. El saldo pasa a
 * 0 porque ya no hay nada que cobrar.
 */
export function marcarPagada(almacen: Almacen, facturaId: number, cobro: CobroDeFactura): boolean {
	const problemas: string[] = []
	if (!Number.isInteger(facturaId) || facturaId <= 0) problemas.push(`«${String(facturaId)}» no es un número de factura de Cobrix.`)
	if (!FECHA.test(cobro.pagadaEl)) problemas.push(`La fecha de pago «${cobro.pagadaEl}» no tiene la forma AAAA-MM-DD.`)
	if (!Number.isInteger(cobro.ispFacturaId) || cobro.ispFacturaId <= 0) {
		problemas.push('Una factura pagada necesita la factura del administrador que la cobró.')
	}
	if (cobro.ispFacturaNum.trim() === '') problemas.push('Falta el número de la factura del administrador que cobró.')
	if (!Number.isInteger(cobro.corridaPago) || cobro.corridaPago <= 0) {
		problemas.push('Una factura se marca pagada dentro de una corrida: falta su identificador.')
	}
	if (problemas.length > 0) throw new DatosInvalidos(problemas)

	const resultado = almacen.db.prepare(`
		UPDATE factura SET estado = 'pagada', saldo = 0, pagada_el = ?, isp_factura_id = ?, isp_factura_num = ?, corrida_pago = ?
		WHERE id = ? AND estado = 'abierta'`).run(
		cobro.pagadaEl, cobro.ispFacturaId, cobro.ispFacturaNum, cobro.corridaPago, facturaId,
	)
	return comoEntero(resultado.changes) > 0
}

export interface TotalesCartera {
	readonly clientes: number
	readonly contratos: number
	readonly abiertas: number
	readonly pagadas: number
	/** Lo que queda por cobrar, en centavos. */
	readonly porCobrar: Centavos
	readonly cobrado: Centavos
}

/** Una sola consulta para el Resumen del panel: así no puede discrepar de la tabla de clientes. */
export function totalesDeCartera(almacen: Almacen): TotalesCartera {
	const fila = almacen.db.prepare(`
		SELECT
			(SELECT COUNT(*) FROM cliente) AS clientes,
			(SELECT COUNT(*) FROM contrato) AS contratos,
			COUNT(CASE WHEN estado = 'abierta' THEN 1 END) AS abiertas,
			COUNT(CASE WHEN estado = 'pagada' THEN 1 END) AS pagadas,
			COALESCE(SUM(CASE WHEN estado = 'abierta' THEN saldo END), 0) AS por_cobrar,
			COALESCE(SUM(CASE WHEN estado = 'pagada' THEN total END), 0) AS cobrado
		FROM factura`).get() as Record<string, unknown>
	return {
		clientes: comoEntero(fila.clientes),
		contratos: comoEntero(fila.contratos),
		abiertas: comoEntero(fila.abiertas),
		pagadas: comoEntero(fila.pagadas),
		porCobrar: comoEntero(fila.por_cobrar),
		cobrado: comoEntero(fila.cobrado),
	}
}
