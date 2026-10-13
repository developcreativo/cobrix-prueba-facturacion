/** Periodo, vencimiento y corte leídos de `detalle_deuda` (ENUNCIADO.md §4, «Facturas»). */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { interpretarDetalleDeuda, periodoDeEtiqueta } from '../src/cobrix/dominio/periodo.ts'

describe('periodoDeEtiqueta', () => {
	const casos: ReadonlyArray<readonly [string, string | null]> = [
		['PLAN15MB25 - 2026 Agosto', '2026-08'],
		['EMPRESA50MB - 2026 Enero', '2026-01'],
		['PLAN3MB20 - 2025 Diciembre', '2025-12'],
		['PLAN15MB25 - 2026 AGOSTO', '2026-08'],
		['PLAN15MB25 - 2026 agosto', '2026-08'],
		['CUOTA ESPECIAL - 2026 Marzo', '2026-03'],
		['PLAN15MB25 - Agosto 2026', null],
		['PLAN15MB25 - 2026 Agost', null],
		['PLAN15MB25 - 2026 13', null],
		['PLAN15MB25', null],
		['', null],
	]

	for (const [etiqueta, esperado] of casos) {
		it(`«${etiqueta}» → ${esperado ?? 'ilegible'}`, () => {
			assert.equal(periodoDeEtiqueta(etiqueta), esperado)
		})
	}
})

describe('interpretarDetalleDeuda', () => {
	it('el vencimiento es el primer día del periodo y el corte suma los días de gracia', () => {
		assert.deepEqual(interpretarDetalleDeuda(['PLAN15MB25 - 2026 Agosto'], 0),
			{ periodo: '2026-08', venceEl: '2026-08-01', cortaEl: '2026-08-01' })
		assert.deepEqual(interpretarDetalleDeuda(['PLAN15MB25 - 2026 Agosto'], 5),
			{ periodo: '2026-08', venceEl: '2026-08-01', cortaEl: '2026-08-06' })
	})

	it('los días de gracia cruzan el fin de mes sin inventar fechas', () => {
		assert.equal(interpretarDetalleDeuda(['PLAN - 2026 Enero'], 45)?.cortaEl, '2026-02-15')
	})

	it('acepta varias etiquetas si todas dicen el mismo periodo', () => {
		const detalle = ['PLAN15MB25 - 2026 Agosto', 'RECARGO - 2026 Agosto']
		assert.equal(interpretarDetalleDeuda(detalle, 0)?.periodo, '2026-08')
	})

	it('rechaza etiquetas que se contradicen: no se elige una al azar', () => {
		const detalle = ['PLAN15MB25 - 2026 Agosto', 'PLAN15MB25 - 2026 Septiembre']
		assert.equal(interpretarDetalleDeuda(detalle, 0), null)
	})

	it('rechaza el detalle vacío o ilegible', () => {
		assert.equal(interpretarDetalleDeuda([], 0), null)
		assert.equal(interpretarDetalleDeuda(['PLAN15MB25'], 0), null)
		assert.equal(interpretarDetalleDeuda('2026 Agosto', 0), null)
		assert.equal(interpretarDetalleDeuda(null, 0), null)
	})
})
