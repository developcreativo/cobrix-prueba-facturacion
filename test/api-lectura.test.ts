/**
 * Lectura estricta de las respuestas de la API (docs/API.md §3). Lo que no se entiende se
 * rechaza con motivo: ninguna respuesta rara se interpreta a medias.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { leerCuotasDeContrato, leerIdsDeContratos, leerLibroDeCuotas } from '../src/cobrix/api/lectura.ts'

type Objeto = Record<string, unknown>

/** Fila de `contrato/individual` tal como la devuelve la API, con sus nombres y tipos. */
const cruda = (cambios: Objeto = {}): Objeto => ({
	contrato_id: 900101,
	codigo: '0900101',
	identificacion_contrato: 'V-12345678',
	nombre_contrato: 'ANA PEREZ',
	estado: 'ACTIVO',
	email: 'ANA.PEREZ@EXAMPLE.COM',
	telefono: '04121000000',
	nombre_plan: 'PLAN15MB25',
	nombre_sucursal: 'VALENCIA',
	moneda: 'DOLAR',
	moneda_sigla: 'USD',
	precio_servicio: '25.000000',
	deuda: 20,
	deuda_id: '7000008',
	detalle_deuda: ['PLAN15MB25 - 2026 Agosto'],
	...cambios,
})

const envoltorio = (data: unknown[], success = true): Objeto => ({
	success,
	message: 'ok',
	pagination: { page: 1, per_page: data.length, total: data.length, total_pages: 1 },
	errors: [],
	data,
})

const filaLibroCruda = (cambios: Objeto = {}, detalle: Objeto = {}): Objeto => ({
	id_factura: 8800007,
	num_factura: '008800007',
	fecha_emision: '2026-08-06',
	id_contrato: 900101,
	fact_cod_contr: '900101',
	detalle_pago: {
		id_contrato: 900101,
		id_cliente: 900001,
		id_cuota: 7000008,
		periodo_cuota: '2026-08',
		tarifa: 25,
		valor_pago: 5,
		saldo_cuota: 20,
		descuento: 0,
		...detalle,
	},
	...cambios,
})

describe('leerIdsDeContratos', () => {
	it('lee la lista del envoltorio', () => {
		const lectura = leerIdsDeContratos(envoltorio([900101, 900102]))
		assert.ok(lectura.ok)
		assert.deepEqual(lectura.datos, [900101, 900102])
	})

	it('rechaza una respuesta sin `data`', () => {
		const lectura = leerIdsDeContratos({ success: true })
		assert.equal(lectura.ok, false)
		assert.equal(lectura.ok === false && lectura.motivo, 'no_es_lista')
	})

	it('rechaza ids que no son enteros', () => {
		assert.equal(leerIdsDeContratos(envoltorio(['900101'])).ok, false)
	})

	it('no asume que la paginación esté completa', () => {
		const payload = { ...envoltorio([900101]), pagination: { page: 1, per_page: 1, total: 27, total_pages: 27 } }
		const lectura = leerIdsDeContratos(payload)
		assert.equal(lectura.ok === false && lectura.motivo, 'paginacion_incompleta')
	})

	it('rechaza ids repetidos', () => {
		assert.equal(leerIdsDeContratos(envoltorio([900101, 900101])).ok, false)
	})
})

describe('leerCuotasDeContrato', () => {
	it('convierte montos a centavos y normaliza el correo que llega en mayúsculas', () => {
		const lectura = leerCuotasDeContrato([cruda()], 900101)
		assert.ok(lectura.ok)
		const fila = lectura.datos[0]!
		assert.equal(fila.deuda, 2000)
		assert.equal(fila.precioServicio, 2500)
		assert.equal(fila.email, 'ana.perez@example.com')
		assert.equal(fila.plan, 'PLAN15MB25')
	})

	it('acepta la lista sin envoltorio y sin orden', () => {
		const lectura = leerCuotasDeContrato([
			cruda({ deuda_id: '7000009', detalle_deuda: ['PLAN15MB25 - 2026 Septiembre'] }),
			cruda(),
		], 900101)
		assert.ok(lectura.ok)
		assert.equal(lectura.datos.length, 2)
	})

	it('un contrato sin deuda llega como una sola fila con deuda_id "0"', () => {
		const lectura = leerCuotasDeContrato([cruda({ deuda_id: '0', deuda: 0, detalle_deuda: [] })], 900101)
		assert.ok(lectura.ok)
		assert.equal(lectura.datos[0]!.deudaId, '0')
	})

	it('rechaza un envoltorio donde se esperaba una lista', () => {
		assert.equal(leerCuotasDeContrato(envoltorio([cruda()]), 900101).ok, false)
	})

	it('rechaza filas de otro contrato', () => {
		const lectura = leerCuotasDeContrato([cruda(), cruda({ contrato_id: 900102 })], 900101)
		assert.equal(lectura.ok === false && lectura.motivo, 'contrato_ajeno')
	})

	it('rechaza la misma cuota repetida', () => {
		const lectura = leerCuotasDeContrato([cruda(), cruda()], 900101)
		assert.equal(lectura.ok === false && lectura.motivo, 'cuota_duplicada')
	})

	it('rechaza la mezcla de «sin deuda» con cuotas reales', () => {
		const lectura = leerCuotasDeContrato([cruda({ deuda_id: '0', deuda: 0 }), cruda()], 900101)
		assert.equal(lectura.ok === false && lectura.motivo, 'datos_inconsistentes')
	})

	it('rechaza un contrato que se describe de dos formas', () => {
		const lectura = leerCuotasDeContrato([cruda(), cruda({ deuda_id: '7000009', estado: 'CORTADO' })], 900101)
		assert.equal(lectura.ok === false && lectura.motivo, 'datos_inconsistentes')
	})

	const filasInvalidas: ReadonlyArray<readonly [string, Objeto]> = [
		['sin deuda_id', { deuda_id: undefined }],
		['deuda_id que no es número', { deuda_id: 'abc' }],
		['deuda_id numérico en vez de texto', { deuda_id: 7000008 }],
		['sin estado', { estado: '' }],
		['sin identificación', { identificacion_contrato: undefined }],
		['deuda que no es número', { deuda: 'veinte' }],
		['deuda negativa', { deuda: -5 }],
		['detalle_deuda que no es lista', { detalle_deuda: 'PLAN - 2026 Agosto' }],
		['detalle_deuda con elementos que no son texto', { detalle_deuda: [123] }],
		['sin precio_servicio', { precio_servicio: undefined }],
	]

	for (const [caso, cambios] of filasInvalidas) {
		it(`rechaza una fila ${caso}`, () => {
			const lectura = leerCuotasDeContrato([cruda(cambios)], 900101)
			assert.equal(lectura.ok === false && lectura.motivo, 'fila_invalida', caso)
		})
	}
})

describe('leerLibroDeCuotas', () => {
	it('ignora `success: false`: esta API lo manda incluso con datos', () => {
		const lectura = leerLibroDeCuotas(envoltorio([filaLibroCruda()], false), 900101)
		assert.ok(lectura.ok)
		const fila = lectura.datos[0]!
		assert.equal(fila.cuotaId, 7000008)
		assert.equal(fila.tarifa, 2500)
		assert.equal(fila.valorPago, 500)
		assert.equal(fila.saldo, 2000)
		assert.equal(fila.facturaIspId, 8800007)
	})

	it('una cuota sin cobros llega con id_factura 0', () => {
		const lectura = leerLibroDeCuotas(envoltorio([filaLibroCruda({ id_factura: 0, num_factura: '' })]), 900101)
		assert.ok(lectura.ok)
		assert.equal(lectura.datos[0]!.facturaIspId, 0)
	})

	it('rechaza una respuesta sin `data`', () => {
		assert.equal(leerLibroDeCuotas([filaLibroCruda()], 900101).ok, false)
	})

	it('rechaza filas de otro contrato', () => {
		const lectura = leerLibroDeCuotas(envoltorio([filaLibroCruda({ id_contrato: 900102 }, { id_contrato: 900102 })]), 900101)
		assert.equal(lectura.ok === false && lectura.motivo, 'contrato_ajeno')
	})

	it('rechaza la forma del modo FACTURA, donde el contrato llega en 0', () => {
		const lectura = leerLibroDeCuotas(envoltorio([filaLibroCruda({ id_contrato: 0 })]), 900101)
		assert.equal(lectura.ok === false && lectura.motivo, 'fila_invalida')
	})

	const invalidas: ReadonlyArray<readonly [string, Objeto, Objeto]> = [
		['sin detalle_pago', { detalle_pago: undefined }, {}],
		['sin id_cuota', {}, { id_cuota: undefined }],
		['con periodo ilegible', {}, { periodo_cuota: 'agosto' }],
		['sin saldo_cuota', {}, { saldo_cuota: undefined }],
		['con fecha de emisión inválida', { fecha_emision: '06/08/2026' }, {}],
	]

	for (const [caso, cambios, detalle] of invalidas) {
		it(`rechaza una fila ${caso}`, () => {
			const lectura = leerLibroDeCuotas(envoltorio([filaLibroCruda(cambios, detalle)]), 900101)
			assert.equal(lectura.ok === false && lectura.motivo, 'fila_invalida', caso)
		})
	}
})
