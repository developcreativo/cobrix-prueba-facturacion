/**
 * Reglas de pago (ENUNCIADO.md §4, «Pagos»). La factura solo se marca pagada con saldo 0, algo
 * cobrado y una factura del ISP que lo respalde; todo lo demás sigue abierta.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { evaluarPago, veredictoSinLibro, type FacturaAbierta } from '../src/cobrix/dominio/pagos.ts'
import type { FilaLibro } from '../src/cobrix/dominio/tipos.ts'
import { filaLibro } from './apoyo/datos.ts'

const factura = (cambios: Partial<FacturaAbierta> = {}): FacturaAbierta => ({
	facturaId: 1,
	deudaId: '7000008',
	contratoId: 900101,
	periodo: '2026-08',
	total: 2500,
	saldo: 2500,
	...cambios,
})

function veredictoDe(abierta: FacturaAbierta, filas: readonly FilaLibro[]) {
	const evaluacion = evaluarPago(abierta, filas)
	assert.equal(evaluacion.tipo, 'veredicto', 'se esperaba un veredicto, no una consulta al contrato')
	return evaluacion.tipo === 'veredicto' ? evaluacion.veredicto : null!
}

describe('pagos · se marca pagada', () => {
	it('saldo 0 y algo cobrado, con la factura del ISP que lo pagó', () => {
		const veredicto = veredictoDe(factura(), [
			filaLibro({ saldo: 0, valorPago: 2500, facturaIspId: 8800118, facturaIspNum: '008800118', fechaEmision: '2026-10-13' }),
		])
		assert.equal(veredicto.resultado, 'marcada_pagada')
		assert.deepEqual(veredicto.cobro, { facturaIspId: 8800118, facturaIspNum: '008800118', fecha: '2026-10-13' })
	})

	it('con varias facturas enlazadas, la fecha de pago es la más reciente (caso ANA PEREZ)', () => {
		// Primero un abono de 5 y después el resto: dos filas de la misma cuota, ya en saldo 0.
		const veredicto = veredictoDe(factura({ saldo: 2000 }), [
			filaLibro({ saldo: 0, valorPago: 2500, facturaIspId: 8800007, facturaIspNum: '008800007', fechaEmision: '2026-08-06' }),
			filaLibro({ saldo: 0, valorPago: 2500, facturaIspId: 8800118, facturaIspNum: '008800118', fechaEmision: '2026-10-13' }),
		])
		assert.equal(veredicto.resultado, 'marcada_pagada')
		assert.equal(veredicto.cobro?.facturaIspNum, '008800118')
	})
})

describe('pagos · sigue abierta', () => {
	it('abono parcial: el ISP cobró una parte (caso LUIS GOMEZ, contrato cortado)', () => {
		const veredicto = veredictoDe(factura({ total: 2000, saldo: 2000 }), [
			filaLibro({ tarifa: 2000, saldo: 1500, valorPago: 500, facturaIspId: 8800119, fechaEmision: '2026-10-13' }),
		])
		assert.equal(veredicto.resultado, 'abono_parcial')
		assert.match(veredicto.motivo, /USD 5,00/)
		assert.match(veredicto.motivo, /sigue abierta/)
	})

	it('cuota exonerada: saldo 0 sin nada pagado no es un pago (caso VALENTINA PAZ)', () => {
		const veredicto = veredictoDe(factura(), [filaLibro({ saldo: 0, valorPago: 0, descuento: -2500 })])
		assert.equal(veredicto.resultado, 'exonerada')
	})

	it('sin movimiento: el libro dice lo mismo que Cobrix', () => {
		assert.equal(veredictoDe(factura(), [filaLibro()]).resultado, 'sin_cambio')
	})

	it('cobro anulado: la cuota vuelve a deber y nada cambia (caso ELENA RUIZ)', () => {
		// `/__sim/anular` devuelve el saldo y deja la factura enlazada con valor_pago en 0.
		const veredicto = veredictoDe(factura(), [
			filaLibro({ saldo: 2500, valorPago: 0, facturaIspId: 8800120, fechaEmision: '2026-10-13' }),
		])
		assert.equal(veredicto.resultado, 'sin_cambio')
	})

	it('si el ISP anuló más de lo que Cobrix tenía abierto, se informa y no se toca', () => {
		const veredicto = veredictoDe(factura({ saldo: 1500 }), [filaLibro({ saldo: 2500, valorPago: 0 })])
		assert.equal(veredicto.resultado, 'saldo_aumentado')
	})
})

describe('pagos · nada se adivina', () => {
	it('filas de la misma cuota que no coinciden: libro inconsistente', () => {
		const veredicto = veredictoDe(factura(), [
			filaLibro({ saldo: 0, valorPago: 2500, facturaIspId: 8800007 }),
			filaLibro({ saldo: 2500, valorPago: 0, facturaIspId: 8800008 }),
		])
		assert.equal(veredicto.resultado, 'inconsistente')
	})

	it('saldo 0 y pagado sin ninguna factura del ISP: no se marca pagada', () => {
		const veredicto = veredictoDe(factura(), [filaLibro({ saldo: 0, valorPago: 2500, facturaIspId: 0 })])
		assert.equal(veredicto.resultado, 'inconsistente')
	})

	it('la cuota que no está en el libro obliga a consultar el contrato', () => {
		const evaluacion = evaluarPago(factura(), [])
		assert.equal(evaluacion.tipo, 'consultar_contrato')
	})

	it('si el contrato la sigue debiendo, está abierta sin cobro (cuota del mes en curso)', () => {
		const evaluacion = evaluarPago(factura({ periodo: '2026-10' }), [])
		assert.equal(evaluacion.tipo, 'consultar_contrato')
		const veredicto = veredictoSinLibro(factura({ periodo: '2026-10' }), true,
			evaluacion.tipo === 'consultar_contrato' ? evaluacion.traza : [])
		assert.equal(veredicto.resultado, 'abierta_sin_cobro')
	})

	it('si no aparece en ninguna parte, queda sin evidencia y JAMÁS pagada', () => {
		const veredicto = veredictoSinLibro(factura(), false, [])
		assert.equal(veredicto.resultado, 'sin_evidencia')
		assert.match(veredicto.motivo, /sin evidencia/)
	})
})

describe('pagos · traza', () => {
	it('cada veredicto explica las reglas que evaluó', () => {
		const veredicto = veredictoDe(factura(), [filaLibro({ saldo: 0, valorPago: 2500, facturaIspId: 8800118 })])
		assert.deepEqual(veredicto.traza.map(paso => paso.regla), [
			'factura abierta en Cobrix', 'coincidencia entre filas', 'evidencia de pago',
		])
		assert.ok(veredicto.traza.every(paso => paso.detalle !== ''))
	})
})
