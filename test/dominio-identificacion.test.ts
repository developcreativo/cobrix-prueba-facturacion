/** Normalización de la identificación del titular (ENUNCIADO.md §4, «Clientes»). */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { normalizarIdentificacion } from '../src/cobrix/dominio/identificacion.ts'

describe('normalizarIdentificacion', () => {
	const validas: ReadonlyArray<readonly [string, string, string | null, 'natural' | 'juridica']> = [
		['V-12345678', 'V12345678', 'V', 'natural'],
		['v12345678', 'V12345678', 'V', 'natural'],
		['V 12.345.678', 'V12345678', 'V', 'natural'],
		['09000123', '9000123', null, 'natural'],
		['000900012', '900012', null, 'natural'],
		['E-81234567', 'E81234567', 'E', 'natural'],
		['J-40123456-7', 'J401234567', 'J', 'juridica'],
		['G-20009999-1', 'G200099991', 'G', 'juridica'],
		['P-123456', 'P123456', 'P', 'natural'],
	]

	for (const [bruta, esperado, tipo, persona] of validas) {
		it(`«${bruta}» → ${esperado} (${persona})`, () => {
			const identificacion = normalizarIdentificacion(bruta)
			assert.ok(identificacion, `${bruta} debería normalizar`)
			assert.equal(identificacion.id, esperado)
			assert.equal(identificacion.tipo, tipo)
			assert.equal(identificacion.persona, persona)
		})
	}

	it('J y G son las únicas personas jurídicas', () => {
		for (const tipo of ['V', 'E', 'P']) {
			assert.equal(normalizarIdentificacion(`${tipo}-12345678`)?.persona, 'natural')
		}
		for (const tipo of ['J', 'G']) {
			assert.equal(normalizarIdentificacion(`${tipo}-12345678`)?.persona, 'juridica')
		}
	})

	const invalidas = [
		['vacía', ''],
		['solo letra', 'V'],
		['menos de 6 dígitos', 'V-12345'],
		['más de 12 dígitos', 'V-1234567890123'],
		['letra de tipo desconocida', 'X-12345678'],
		['con letras intercaladas', 'V-1234A678'],
		['solo ceros', '0000000'],
		['dos letras', 'VV-12345678'],
		['nula', null],
		['numérica', 12345678],
	] as const

	for (const [caso, valor] of invalidas) {
		it(`rechaza ${caso}: el contrato no se importa`, () => {
			assert.equal(normalizarIdentificacion(valor), null)
		})
	}

	it('agrupa dos contratos del mismo titular bajo la misma clave', () => {
		// LUIS GOMEZ: contratos 900102 (ACTIVO) y 900103 (CORTADO).
		assert.equal(normalizarIdentificacion('V-9876543')?.id, normalizarIdentificacion('v9876543')?.id)
	})
})
