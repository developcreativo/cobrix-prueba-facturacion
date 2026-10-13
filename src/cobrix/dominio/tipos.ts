/**
 * Contratos de datos entre la lectura de la API y las reglas del dominio.
 *
 * Viven aquí, y no en `api/`, para que el dominio no dependa del transporte: `api/parse.ts`
 * produce estas formas y `dominio/` solo consume formas ya validadas. Nada de `unknown`
 * cruza esta frontera.
 */

import type { Centavos } from './dinero.ts'

/** Una fila de `contrato/individual`: el contrato más UNA de sus cuotas pendientes. */
export interface FilaContrato {
	readonly contratoId: number
	readonly codigo: string
	readonly identificacionBruta: string
	readonly nombre: string
	readonly estado: string
	readonly email: string | null
	readonly telefono: string | null
	readonly plan: string
	readonly sucursal: string
	readonly monedaSigla: string
	readonly precioServicio: Centavos
	/** `"0"` significa «sin deuda»: no es una cuota. */
	readonly deudaId: string
	readonly deuda: Centavos
	readonly detalleDeuda: readonly string[]
}

/** Una fila de `pago_informacion` (`tipo_busqueda=CUOTA`): una cuota vista por una factura del ISP. */
export interface FilaLibro {
	readonly contratoId: number
	readonly cuotaId: number
	readonly periodo: string
	readonly tarifa: Centavos
	readonly valorPago: Centavos
	readonly saldo: Centavos
	readonly descuento: Centavos
	/** `0` cuando la cuota no tiene ningún cobro asociado. */
	readonly facturaIspId: number
	readonly facturaIspNum: string
	readonly fechaEmision: string
}

/** Por qué una respuesta no se pudo leer. Todas dejan al contrato fuera: no se adivina. */
export type MotivoIlegible =
	| 'no_es_lista'
	| 'fila_invalida'
	| 'contrato_ajeno'
	| 'datos_inconsistentes'
	| 'cuota_duplicada'
	| 'paginacion_incompleta'

export type Lectura<T> =
	| { readonly ok: true; readonly datos: T }
	| { readonly ok: false; readonly motivo: MotivoIlegible; readonly detalle: string }

export const legible = <T>(datos: T): Lectura<T> => ({ ok: true, datos })
export const ilegible = <T>(motivo: MotivoIlegible, detalle: string): Lectura<T> => ({ ok: false, motivo, detalle })
