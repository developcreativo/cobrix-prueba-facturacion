/**
 * Configuración: los valores por defecto son los que reproducen los criterios de aceptación,
 * así que están bajo prueba como cualquier otra regla.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
	PROVEEDOR_POR_DEFECTO, validarEmpresa, validarProveedor, type Proveedor,
} from '../src/cobrix/dominio/configuracion.ts'

const proveedor = (cambios: Partial<Proveedor> = {}): Proveedor => ({ ...PROVEEDOR_POR_DEFECTO, ...cambios })

describe('valores por defecto del proveedor', () => {
	it('son los que dan 42 cuotas y USD 1.235,00 con la base entregada', () => {
		assert.deepEqual(PROVEEDOR_POR_DEFECTO.estadosImportables, ['ACTIVO', 'CORTADO'])
		assert.equal(PROVEEDOR_POR_DEFECTO.ventanaMeses, null, 'una ventana por defecto perdería cuotas de MIGUEL ANGEL SOTO')
		assert.equal(PROVEEDOR_POR_DEFECTO.maxCuotasRecientes, null)
		assert.equal(PROVEEDOR_POR_DEFECTO.diasGracia, 0)
		assert.equal(PROVEEDOR_POR_DEFECTO.topeFacturas, null)
		assert.equal(PROVEEDOR_POR_DEFECTO.topeMonto, null)
		assert.deepEqual(PROVEEDOR_POR_DEFECTO.excluirTiposDocumento, [],
			'excluir J dejaría fuera a COMERCIAL EL FARO, C.A.')
	})

	it('la configuración por defecto es válida', () => {
		assert.deepEqual(validarProveedor(PROVEEDOR_POR_DEFECTO), [])
	})
})

describe('validarProveedor', () => {
	const invalidos: ReadonlyArray<readonly [string, Partial<Proveedor>]> = [
		['URL sin esquema', { apiUrl: '127.0.0.1:4310' }],
		['usuario vacío', { usuario: '  ' }],
		['sin estados importables', { estadosImportables: [] }],
		['estado inventado', { estadosImportables: ['ACTIVO', 'SUSPENDIDO'] }],
		['ventana no permitida', { ventanaMeses: 4 }],
		['máximo de recientes en 0', { maxCuotasRecientes: 0 }],
		['máximo de recientes sobre 60', { maxCuotasRecientes: 61 }],
		['días de gracia negativos', { diasGracia: -1 }],
		['días de gracia sobre 60', { diasGracia: 61 }],
		['tope de facturas en 0', { topeFacturas: 0 }],
		['excluir todos los tipos', { excluirTiposDocumento: ['V', 'E', 'J', 'G', 'P'] }],
		['automática sin hora', { autoActiva: true, autoHora: null }],
		['automática con hora imposible', { autoActiva: true, autoHora: '24:00' }],
	]

	for (const [caso, cambios] of invalidos) {
		it(`rechaza ${caso}`, () => {
			assert.ok(validarProveedor(proveedor(cambios)).length > 0, caso)
		})
	}

	it('acepta las ventanas y topes permitidos', () => {
		for (const ventana of [3, 6, 9, 12, null]) {
			assert.deepEqual(validarProveedor(proveedor({ ventanaMeses: ventana })), [])
		}
		assert.deepEqual(validarProveedor(proveedor({ topeFacturas: 10, topeMonto: 50_000 })), [])
		assert.deepEqual(validarProveedor(proveedor({ autoActiva: true, autoHora: '03:30' })), [])
	})
})

describe('validarEmpresa', () => {
	it('exige nombre y RIF, y valida el correo cuando viene', () => {
		assert.equal(validarEmpresa({ nombre: '', rif: '', emailCobranza: '' }).length, 2)
		assert.deepEqual(validarEmpresa({ nombre: 'Cobrix', rif: 'J-12345678-9', emailCobranza: '' }), [])
		assert.equal(validarEmpresa({ nombre: 'Cobrix', rif: 'J-1', emailCobranza: 'no-es-correo' }).length, 1)
	})
})
