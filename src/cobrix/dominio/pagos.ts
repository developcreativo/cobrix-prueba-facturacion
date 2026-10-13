/**
 * Reglas de pago: cuándo una factura abierta de Cobrix está realmente cobrada por el ISP.
 *
 * ENUNCIADO.md §4: se marca pagada solo si todas las filas de la cuota coinciden entre sí, el
 * saldo es 0 y hay algo pagado. Un saldo menor es abono parcial y la factura sigue abierta; una
 * cuota exonerada no es un pago; una cuota que no aparece en el libro queda sin evidencia y
 * JAMÁS se marca pagada. Funciones puras: entra el libro ya validado, sale un veredicto.
 */

import { usd, type Centavos } from './dinero.ts'
import { pasoDescarta, pasoOk, type PasoTraza, type ResultadoPago } from './resultados.ts'
import type { FilaLibro } from './tipos.ts'

export interface FacturaAbierta {
	readonly facturaId: number
	/** `deuda_id` de la cuota en el administrador. */
	readonly deudaId: string
	readonly contratoId: number
	readonly periodo: string
	readonly total: Centavos
	readonly saldo: Centavos
}

export interface CobroDelIsp {
	readonly facturaIspId: number
	readonly facturaIspNum: string
	readonly fecha: string
}

export interface VeredictoPago {
	readonly resultado: ResultadoPago
	readonly motivo: string
	readonly traza: readonly PasoTraza[]
	/** Solo en `marcada_pagada`: con qué factura del ISP se cobró. */
	readonly cobro?: CobroDelIsp
}

export type EvaluacionPago =
	| { readonly tipo: 'veredicto'; readonly veredicto: VeredictoPago }
	/** La cuota no está en el libro: hay que preguntarle al contrato antes de concluir. */
	| { readonly tipo: 'consultar_contrato'; readonly traza: readonly PasoTraza[] }

/** `filas` son las del libro que hablan de ESTA cuota (una por cada factura del ISP que la tocó). */
export function evaluarPago(factura: FacturaAbierta, filas: readonly FilaLibro[]): EvaluacionPago {
	const traza: PasoTraza[] = [
		pasoOk('factura abierta en Cobrix', `cuota ${factura.deudaId}, periodo ${factura.periodo}, saldo ${usd(factura.saldo)}`),
	]

	if (filas.length === 0) {
		return {
			tipo: 'consultar_contrato',
			traza: [...traza, pasoOk('libro de cuotas', 'la cuota no aparece en el libro: se consulta el contrato')],
		}
	}

	const primera = filas[0]!
	const coinciden = filas.every(fila =>
		fila.saldo === primera.saldo && fila.valorPago === primera.valorPago && fila.tarifa === primera.tarifa)
	if (!coinciden) {
		return decidido(veredicto('inconsistente',
			`El libro devuelve ${filas.length} filas de la cuota ${factura.deudaId} que no coinciden entre sí: no se toca la factura.`,
			[...traza, pasoDescarta('coincidencia entre filas', 'saldo, pagado o tarifa difieren entre las filas de la misma cuota')]))
	}
	traza.push(pasoOk('coincidencia entre filas',
		`${filas.length} fila(s) coinciden: tarifa ${usd(primera.tarifa)}, pagado ${usd(primera.valorPago)}, saldo ${usd(primera.saldo)}`))

	if (primera.saldo === 0) {
		if (primera.valorPago <= 0) {
			return decidido(veredicto('exonerada',
				`Saldo 0 sin nada pagado (descuento ${usd(primera.descuento)}): es una exoneración, no un pago. La factura sigue abierta.`,
				[...traza, pasoDescarta('evidencia de pago', 'saldo 0 pero valor_pago 0: nadie pagó')]))
		}
		const cobro = ultimoCobro(filas)
		if (cobro === null) {
			return decidido(veredicto('inconsistente',
				`La cuota ${factura.deudaId} dice ${usd(primera.valorPago)} pagados pero ninguna factura del ISP la respalda: no se marca pagada.`,
				[...traza, pasoDescarta('factura del ISP que cobró', 'todas las filas vienen con id_factura 0')]))
		}
		return decidido(veredicto('marcada_pagada',
			`El ISP la cobró completa: ${usd(primera.valorPago)} con la factura ${cobro.facturaIspNum} del ${cobro.fecha}.`,
			[...traza, pasoOk('evidencia de pago', `saldo 0 y ${usd(primera.valorPago)} pagados según la factura ${cobro.facturaIspNum}`)],
			cobro))
	}

	if (primera.saldo < factura.saldo) {
		return decidido(veredicto('abono_parcial',
			`Abono parcial: el ISP cobró ${usd(factura.saldo - primera.saldo)} y la cuota todavía debe ${usd(primera.saldo)}. La factura sigue abierta.`,
			[...traza, pasoDescarta('saldo de la cuota',
				`${usd(primera.saldo)} en el ISP contra ${usd(factura.saldo)} en Cobrix: falta por cobrar`)]))
	}

	if (primera.saldo > factura.saldo) {
		return decidido(veredicto('saldo_aumentado',
			`La cuota debe ${usd(primera.saldo)}, más que los ${usd(factura.saldo)} de Cobrix: el ISP anuló un cobro. La factura sigue abierta.`,
			[...traza, pasoDescarta('saldo de la cuota', `${usd(primera.saldo)} > ${usd(factura.saldo)}: el saldo creció en el ISP`)]))
	}

	return decidido(veredicto('sin_cambio',
		`La cuota sigue debiendo ${usd(primera.saldo)}: el ISP no ha cobrado nada.`,
		[...traza, pasoDescarta('saldo de la cuota', `${usd(primera.saldo)} igual que en Cobrix`)]))
}

/**
 * Cierre del caso «no está en el libro». La cuota del mes en curso puede no aparecer hasta fin
 * de mes (ENUNCIADO.md §4): si el contrato la sigue listando como pendiente, está abierta y
 * sin cobrar; si no aparece en ninguna parte, queda sin evidencia y no se toca.
 */
export function veredictoSinLibro(
	factura: FacturaAbierta,
	sigueEnContrato: boolean,
	traza: readonly PasoTraza[],
): VeredictoPago {
	return sigueEnContrato
		? veredicto('abierta_sin_cobro',
			'El contrato todavía la reporta pendiente: está abierta y el ISP no la ha cobrado.',
			[...traza, pasoOk('contrato/individual', `la cuota ${factura.deudaId} sigue pendiente en el contrato`)])
		: veredicto('sin_evidencia',
			`La cuota ${factura.deudaId} no está en el libro ni pendiente en el contrato: sin evidencia, no se marca pagada.`,
			[...traza, pasoDescarta('contrato/individual', 'la cuota tampoco aparece como pendiente')])
}

const decidido = (veredictoPago: VeredictoPago): EvaluacionPago => ({ tipo: 'veredicto', veredicto: veredictoPago })

/** La factura del ISP más reciente que tocó la cuota: la que fecha el pago. */
function ultimoCobro(filas: readonly FilaLibro[]): CobroDelIsp | null {
	const conFactura = filas.filter(fila => fila.facturaIspId > 0)
	if (conFactura.length === 0) return null
	const elegida = conFactura.reduce((mejor, fila) =>
		fila.fechaEmision > mejor.fechaEmision || (fila.fechaEmision === mejor.fechaEmision && fila.facturaIspId > mejor.facturaIspId)
			? fila
			: mejor)
	return { facturaIspId: elegida.facturaIspId, facturaIspNum: elegida.facturaIspNum, fecha: elegida.fechaEmision }
}

function veredicto(
	resultado: ResultadoPago,
	motivo: string,
	traza: readonly PasoTraza[],
	cobro?: CobroDelIsp,
): VeredictoPago {
	return { resultado, motivo, traza, ...(cobro ? { cobro } : {}) }
}
