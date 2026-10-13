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
import { comoEntero, type Almacen } from './base.ts'
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
