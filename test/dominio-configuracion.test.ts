/**
 * Configuración: los valores por defecto son los que reproducen los criterios de aceptación,
 * así que están bajo prueba como cualquier otra regla.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
	PROVEEDOR_POR_DEFECTO, urlDelAdministrador, validarEmpresa, validarProveedor, type Proveedor,
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

	it('la URL del administrador se compone con el puerto donde se levanta, no es una constante', () => {
		// Quien arranca el entorno aislado con BILLING_API_PORT=4330 no debe empezar con el panel
		// apuntando al 4310: «Probar conexión» tardaría cuatro segundos para decir «fetch failed».
		assert.equal(urlDelAdministrador('4330'), 'http://127.0.0.1:4330/api/v1')
		assert.equal(urlDelAdministrador(undefined), 'http://127.0.0.1:4310/api/v1', 'sin variable, el puerto de siempre')
		assert.equal(urlDelAdministrador('nada-de-esto'), 'http://127.0.0.1:4310/api/v1', 'un valor raro no construye una URL inválida')
		assert.equal(urlDelAdministrador(''), 'http://127.0.0.1:4310/api/v1')
		assert.equal(PROVEEDOR_POR_DEFECTO.apiUrl, urlDelAdministrador(), 'el valor por defecto usa la misma composición')
		assert.deepEqual(validarProveedor(proveedor({ apiUrl: urlDelAdministrador('4330') })), [])
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
