/**
 * Reglas de importación (ENUNCIADO.md §4). Incluye el orden de evaluación, que no es libre:
 * ver el caso «saldo residual antes que coherencia de moneda».
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
	aplicarTopes, clasificarContrato,
	type Candidata, type ConfiguracionImportacion, type LineaImportacion,
} from '../src/cobrix/dominio/importacion.ts'
import { ilegible, legible, type FilaContrato } from '../src/cobrix/dominio/tipos.ts'
import { cuotasDe, filaContrato } from './apoyo/datos.ts'

const REGLAS: ConfiguracionImportacion = {
	estadosImportables: ['ACTIVO', 'CORTADO'],
	ventanaMeses: null,
	maxCuotasRecientes: null,
	diasGracia: 0,
	topeFacturas: null,
	topeMonto: null,
	excluirTiposDocumento: [],
}

function clasificar(
	filas: readonly FilaContrato[],
	cambios: Partial<ConfiguracionImportacion> = {},
	yaImportadas: ReadonlySet<string> = new Set(),
) {
	return clasificarContrato(filas[0]?.contratoId ?? 0, legible(filas), {
		periodoActual: '2026-10',
		configuracion: { ...REGLAS, ...cambios },
		yaImportadas,
	})
}

const resultados = (lineas: readonly LineaImportacion[]): readonly string[] => lineas.map(linea => linea.resultado)

describe('importación · camino feliz', () => {
	it('cada cuota pendiente es una factura por su saldo, con periodo, vencimiento y corte', () => {
		const { lineas, candidatas } = clasificar(cuotasDe(['2026-08', '2026-09', '2026-10']))
		assert.deepEqual(lineas, [])
		assert.equal(candidatas.length, 3)
		assert.deepEqual(candidatas.map(c => c.periodo), ['2026-08', '2026-09', '2026-10'])
		assert.deepEqual(candidatas.map(c => c.monto), [2500, 2500, 2500])
		assert.equal(candidatas[0]!.venceEl, '2026-08-01')
		assert.equal(candidatas[0]!.cortaEl, '2026-08-01')
		assert.equal(candidatas[0]!.cliente.id, 'V12345678')
		assert.equal(candidatas[0]!.cliente.persona, 'natural')
		assert.equal(candidatas[0]!.contrato.id, 900101)
	})

	it('los días de gracia mueven el corte, no el vencimiento', () => {
		const { candidatas } = clasificar(cuotasDe(['2026-08']), { diasGracia: 10 })
		assert.equal(candidatas[0]!.venceEl, '2026-08-01')
		assert.equal(candidatas[0]!.cortaEl, '2026-08-11')
	})

	it('el contrato CORTADO también se importa por defecto', () => {
		const { candidatas } = clasificar(cuotasDe(['2026-09'], { estado: 'CORTADO' }))
		assert.equal(candidatas.length, 1)
	})
})

describe('importación · el orden de las reglas', () => {
	it('descarta el saldo residual ANTES de juzgar la moneda (caso SOFIA TORRES)', () => {
		// 0,001317 llega como `deuda: 0`. Si la moneda se evaluara primero, mediría 0 % del
		// plan y arrastraría al contrato entero: se perderían sus cuotas legítimas.
		const filas = [
			filaContrato({ deudaId: '7000041', deuda: 0, detalleDeuda: ['PLAN15MB25 - 2026 Septiembre'] }),
			filaContrato({ deudaId: '7000042', deuda: 2500, detalleDeuda: ['PLAN15MB25 - 2026 Octubre'] }),
		]
		const { lineas, candidatas } = clasificar(filas)

		assert.deepEqual(resultados(lineas), ['saldo_residual'])
		assert.equal(candidatas.length, 1, 'la cuota de octubre sí se importa')
		assert.equal(candidatas[0]!.periodo, '2026-10')
	})

	it('la traza deja constancia de que la moneda no se evaluó para la cuota residual', () => {
		const { lineas } = clasificar([filaContrato({ deuda: 0 })])
		const paso = lineas[0]!.traza.find(item => item.regla === 'coherencia de moneda')
		assert.equal(paso?.veredicto, 'omitida')
	})

	it('un contrato cuyas únicas cuotas son residuales no se juzga por moneda', () => {
		const { lineas, candidatas } = clasificar([filaContrato({ deuda: 0 })])
		assert.deepEqual(resultados(lineas), ['saldo_residual'])
		assert.deepEqual(candidatas, [])
	})
})

describe('importación · exclusiones', () => {
	it('la fila deuda_id "0" es «sin deuda», no una cuota (caso LAURA MENDEZ)', () => {
		const { lineas, candidatas } = clasificar([filaContrato({ deudaId: '0', deuda: 0, detalleDeuda: [] })])
		assert.deepEqual(resultados(lineas), ['sin_deuda'])
		assert.deepEqual(candidatas, [])
	})

	it('un estado no importable deja fuera una línea por cuota', () => {
		const { lineas, candidatas } = clasificar(cuotasDe(['2026-08', '2026-09', '2026-10'], { estado: 'CORTESIA' }))
		assert.deepEqual(resultados(lineas), ['excluida_estado', 'excluida_estado', 'excluida_estado'])
		assert.deepEqual(candidatas, [])
		assert.match(lineas[0]!.motivo, /CORTESIA/)
		assert.equal(lineas[0]!.periodo, '2026-08', 'el periodo se informa aunque la cuota no se importe')
	})

	it('un estado desconocido deja el contrato fuera: no se adivina', () => {
		const { lineas } = clasificar(cuotasDe(['2026-09'], { estado: 'SUSPENDIDO' }))
		assert.deepEqual(resultados(lineas), ['estado_desconocido'])
		assert.match(lineas[0]!.motivo, /no reconocido/)
	})

	it('una identificación inútil deja el contrato fuera', () => {
		const { lineas } = clasificar(cuotasDe(['2026-09'], { identificacionBruta: 'SIN-CEDULA' }))
		assert.deepEqual(resultados(lineas), ['identificacion_invalida'])
	})

	it('excluir por tipo de documento saca al titular completo', () => {
		const juridica = cuotasDe(['2026-09', '2026-10'], { identificacionBruta: 'J-40123456-7' })
		assert.equal(clasificar(juridica).candidatas.length, 2)
		const { lineas, candidatas } = clasificar(juridica, { excluirTiposDocumento: ['J'] })
		assert.deepEqual(resultados(lineas), ['tipo_documento_excluido'])
		assert.deepEqual(candidatas, [])
		assert.equal(lineas[0]!.cuotas, 2, 'la línea resume las dos cuotas que quedaron fuera')
	})

	it('moneda incoherente: reporta USD con cuotas imposibles frente al plan (caso JORGE CASTILLO)', () => {
		const { lineas, candidatas } = clasificar([
			filaContrato({ deuda: 5, precioServicio: 2000, detalleDeuda: ['PLAN3MB20 - 2026 Septiembre'] }),
		])
		assert.deepEqual(resultados(lineas), ['moneda_incoherente'])
		assert.deepEqual(candidatas, [])
		assert.match(lineas[0]!.motivo, /menos del 1 %/)
	})

	it('moneda incoherente: el contrato declara otra moneda', () => {
		const { lineas } = clasificar(cuotasDe(['2026-09'], { monedaSigla: 'VES', deuda: 180_000 }))
		assert.deepEqual(resultados(lineas), ['moneda_incoherente'])
	})

	it('una cuota justo en el 1 % del plan todavía se importa', () => {
		const { candidatas } = clasificar([filaContrato({ deuda: 25, precioServicio: 2500 })])
		assert.equal(candidatas.length, 1)
	})

	it('un periodo ilegible deja fuera solo esa cuota', () => {
		const filas = [
			filaContrato({ deudaId: '7000008', detalleDeuda: ['PLAN15MB25 - SIN PERIODO'] }),
			filaContrato({ deudaId: '7000009', detalleDeuda: ['PLAN15MB25 - 2026 Octubre'] }),
		]
		const { lineas, candidatas } = clasificar(filas)
		assert.deepEqual(resultados(lineas), ['periodo_invalido'])
		assert.equal(candidatas.length, 1)
	})

	it('una respuesta que se contradice deja el contrato fuera', () => {
		const clasificacion = clasificarContrato(900101, ilegible('cuota_duplicada', 'deuda_id duplicado'), {
			periodoActual: '2026-10', configuracion: REGLAS, yaImportadas: new Set(),
		})
		assert.deepEqual(resultados(clasificacion.lineas), ['respuesta_contradictoria'])
		assert.deepEqual(clasificacion.candidatas, [])
	})
})

describe('importación · ventana, recientes e idempotencia', () => {
	const ocho = ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']

	it('la ventana de 3 meses conserva el mes actual y los tres anteriores', () => {
		const { lineas, candidatas } = clasificar(cuotasDe(ocho), { ventanaMeses: 3 })
		assert.deepEqual(candidatas.map(c => c.periodo), ['2026-07', '2026-08', '2026-09', '2026-10'])
		assert.deepEqual(new Set(resultados(lineas)), new Set(['fuera_de_ventana']))
		assert.equal(lineas.length, 4)
	})

	it('sin ventana se importan las ocho cuotas (caso MIGUEL ANGEL SOTO)', () => {
		assert.equal(clasificar(cuotasDe(ocho)).candidatas.length, 8)
	})

	it('el máximo de recientes conserva las más nuevas', () => {
		const { lineas, candidatas } = clasificar(cuotasDe(ocho), { maxCuotasRecientes: 3 })
		assert.deepEqual(candidatas.map(c => c.periodo), ['2026-08', '2026-09', '2026-10'])
		assert.equal(lineas.length, 5)
		assert.deepEqual(new Set(resultados(lineas)), new Set(['limite_recientes']))
	})

	it('correr dos veces no duplica: lo ya importado se informa y no vuelve a ser candidato', () => {
		const filas = cuotasDe(['2026-08', '2026-09'])
		const primera = clasificar(filas)
		const yaImportadas = new Set(primera.candidatas.map(c => c.deudaId))

		const segunda = clasificar(filas, {}, yaImportadas)
		assert.deepEqual(segunda.candidatas, [])
		assert.deepEqual(resultados(segunda.lineas), ['ya_importada', 'ya_importada'])
	})

	it('lo ya importado no se reevalúa contra la ventana: la factura existe', () => {
		const { lineas } = clasificar(cuotasDe(['2026-03']), { ventanaMeses: 3 }, new Set(['7000008']))
		assert.deepEqual(resultados(lineas), ['ya_importada'])
		assert.equal(lineas[0]!.traza.at(-1)?.veredicto, 'omitida')
	})

	it('el conjunto de recientes no cambia por lo que ya se importó', () => {
		const filas = cuotasDe(['2026-08', '2026-09', '2026-10'])
		const { lineas, candidatas } = clasificar(filas, { maxCuotasRecientes: 2 }, new Set(['7000010']))
		// 7000010 es la de octubre: ocupa su lugar entre las dos más recientes.
		assert.deepEqual(resultados(lineas), ['limite_recientes', 'ya_importada'])
		assert.deepEqual(candidatas.map(c => c.periodo), ['2026-09'])
	})
})

describe('importación · topes por corrida', () => {
	const candidatasDe = (periodos: readonly string[]): readonly Candidata[] => clasificar(cuotasDe(periodos)).candidatas

	it('el tope de facturas frena el excedente y no lo importa', () => {
		const { aImportar, frenadas } = aplicarTopes(candidatasDe(['2026-08', '2026-09', '2026-10']),
			{ ...REGLAS, topeFacturas: 2 })
		assert.deepEqual(aImportar.map(c => c.periodo), ['2026-08', '2026-09'])
		assert.deepEqual(resultados(frenadas), ['tope_facturas'])
		assert.match(frenadas[0]!.motivo, /no se importa/)
	})

	it('el tope de monto frena por monto acumulado', () => {
		const { aImportar, frenadas } = aplicarTopes(candidatasDe(['2026-08', '2026-09', '2026-10']),
			{ ...REGLAS, topeMonto: 6000 })
		assert.equal(aImportar.length, 2)
		assert.equal(aImportar.reduce((total, c) => total + c.monto, 0), 5000)
		assert.deepEqual(resultados(frenadas), ['tope_monto'])
	})

	it('el recorte es determinista: la cuota más vieja entra primero, venga en el orden que venga', () => {
		const candidatas = candidatasDe(['2026-08', '2026-09', '2026-10'])
		const revueltas = [candidatas[2]!, candidatas[0]!, candidatas[1]!]
		const primera = aplicarTopes(candidatas, { ...REGLAS, topeFacturas: 2 })
		const segunda = aplicarTopes(revueltas, { ...REGLAS, topeFacturas: 2 })
		assert.deepEqual(primera.aImportar.map(c => c.deudaId), segunda.aImportar.map(c => c.deudaId))
		assert.deepEqual(primera.frenadas.map(f => f.deudaId), segunda.frenadas.map(f => f.deudaId))
	})

	it('al llegar al tope la corrida se detiene: no rellena con cuotas más baratas', () => {
		// Una mochila codiciosa importaría la de octubre (2.500 cabría en el tope) y se saltaría
		// la de septiembre: el operador no podría explicar por qué se trajo la nueva y no la vieja.
		const { candidatas } = clasificar([
			filaContrato({ deudaId: '7000001', deuda: 2500, detalleDeuda: ['PLAN15MB25 - 2026 Agosto'] }),
			filaContrato({ deudaId: '7000002', deuda: 6000, detalleDeuda: ['PLAN15MB25 - 2026 Septiembre'] }),
			filaContrato({ deudaId: '7000003', deuda: 2500, detalleDeuda: ['PLAN15MB25 - 2026 Octubre'] }),
		])
		const { aImportar, frenadas } = aplicarTopes(candidatas, { ...REGLAS, topeMonto: 6000 })

		assert.deepEqual(aImportar.map(c => c.deudaId), ['7000001'])
		assert.deepEqual(frenadas.map(f => f.deudaId), ['7000002', '7000003'])
		assert.deepEqual(resultados(frenadas), ['tope_monto', 'tope_monto'])
	})

	it('sin topes no se frena nada', () => {
		const { aImportar, frenadas } = aplicarTopes(candidatasDe(['2026-08', '2026-09']), REGLAS)
		assert.equal(aImportar.length, 2)
		assert.deepEqual(frenadas, [])
	})
})
