/**
 * Almacén de configuración: valores por defecto, validación al guardar y el trato de la
 * contraseña del proveedor, que entra pero no sale (ENUNCIADO.md §3.1).
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { abrirAlmacen, type Almacen } from '../src/cobrix/almacen/base.ts'
import {
	ConfiguracionInvalida, guardarEmpresa, guardarProveedor, leerConfiguracion, leerCredenciales,
} from '../src/cobrix/almacen/configuracion.ts'
import { PROVEEDOR_POR_DEFECTO } from '../src/cobrix/dominio/configuracion.ts'
import { cifrar, descifrar } from '../src/cobrix/apoyo/secreto.ts'
import { randomBytes } from 'node:crypto'

const nuevoAlmacen = (): Almacen => abrirAlmacen({ ruta: ':memory:' })

describe('configuración recién instalada', () => {
	it('arranca con los valores por defecto y sin contraseña', () => {
		const almacen = nuevoAlmacen()
		const configuracion = leerConfiguracion(almacen)

		assert.deepEqual(configuracion.proveedor, PROVEEDOR_POR_DEFECTO)
		assert.equal(configuracion.passwordDefinida, false)
		assert.equal(configuracion.empresa.nombre, '')
		assert.equal(leerCredenciales(almacen), null, 'sin contraseña no se arranca una corrida a ciegas')
		almacen.cerrar()
	})

	it('abrir dos veces la misma base no reinicia la configuración', () => {
		const almacen = nuevoAlmacen()
		guardarEmpresa(almacen, { nombre: 'Cobrix', rif: 'J-12345678-9', emailCobranza: 'cobranza@cobrix.test' })
		assert.equal(leerConfiguracion(almacen).empresa.nombre, 'Cobrix')
		almacen.cerrar()
	})
})

describe('guardar el proveedor', () => {
	it('guarda la contraseña cifrada y la devuelve solo a la corrida', () => {
		const almacen = nuevoAlmacen()
		guardarProveedor(almacen, { ...PROVEEDOR_POR_DEFECTO, password: 'cobrix-sandbox' })

		assert.equal(leerConfiguracion(almacen).passwordDefinida, true)
		assert.equal(leerCredenciales(almacen)?.password, 'cobrix-sandbox')
		almacen.cerrar()
	})

	it('la contraseña no queda en claro en la base', () => {
		const almacen = nuevoAlmacen()
		guardarProveedor(almacen, { ...PROVEEDOR_POR_DEFECTO, password: 'cobrix-sandbox' })

		const fila = almacen.db.prepare('SELECT password_cifrada FROM proveedor WHERE id = 1').get() as Record<string, unknown>
		const guardada = Buffer.from(fila.password_cifrada as Uint8Array)
		assert.ok(!guardada.toString('utf8').includes('cobrix-sandbox'))
		assert.ok(!guardada.toString('latin1').includes('cobrix-sandbox'))
		almacen.cerrar()
	})

	it('guardar sin contraseña conserva la que ya estaba', () => {
		const almacen = nuevoAlmacen()
		guardarProveedor(almacen, { ...PROVEEDOR_POR_DEFECTO, password: 'cobrix-sandbox' })
		guardarProveedor(almacen, { ...PROVEEDOR_POR_DEFECTO, apiUrl: 'http://127.0.0.1:4310/api/v1', password: '' })

		assert.equal(leerCredenciales(almacen)?.password, 'cobrix-sandbox')
		almacen.cerrar()
	})

	it('normaliza la URL y recorta los espacios', () => {
		const almacen = nuevoAlmacen()
		guardarProveedor(almacen, { ...PROVEEDOR_POR_DEFECTO, apiUrl: 'http://127.0.0.1:4310/api/v1/', usuario: ' cobrix ' })

		const proveedor = leerConfiguracion(almacen).proveedor
		assert.equal(proveedor.apiUrl, 'http://127.0.0.1:4310/api/v1')
		assert.equal(proveedor.usuario, 'cobrix')
		almacen.cerrar()
	})

	it('guarda las opciones de importación tal como se configuraron', () => {
		const almacen = nuevoAlmacen()
		guardarProveedor(almacen, {
			...PROVEEDOR_POR_DEFECTO,
			estadosImportables: ['ACTIVO'],
			ventanaMeses: 6,
			maxCuotasRecientes: 12,
			diasGracia: 5,
			topeFacturas: 50,
			topeMonto: 100_000,
			excluirTiposDocumento: ['J', 'G'],
			autoActiva: true,
			autoHora: '02:30',
		})

		const proveedor = leerConfiguracion(almacen).proveedor
		assert.deepEqual(proveedor.estadosImportables, ['ACTIVO'])
		assert.equal(proveedor.ventanaMeses, 6)
		assert.equal(proveedor.maxCuotasRecientes, 12)
		assert.equal(proveedor.diasGracia, 5)
		assert.equal(proveedor.topeFacturas, 50)
		assert.equal(proveedor.topeMonto, 100_000)
		assert.deepEqual(proveedor.excluirTiposDocumento, ['J', 'G'])
		assert.equal(proveedor.autoActiva, true)
		assert.equal(proveedor.autoHora, '02:30')
		almacen.cerrar()
	})

	it('una configuración inválida no se guarda', () => {
		const almacen = nuevoAlmacen()
		assert.throws(
			() => guardarProveedor(almacen, { ...PROVEEDOR_POR_DEFECTO, diasGracia: 99 }),
			(error: unknown) => error instanceof ConfiguracionInvalida && error.problemas.length === 1,
		)
		assert.equal(leerConfiguracion(almacen).proveedor.diasGracia, 0)
		almacen.cerrar()
	})

	it('una empresa sin nombre ni RIF no se guarda', () => {
		const almacen = nuevoAlmacen()
		assert.throws(() => guardarEmpresa(almacen, { nombre: '', rif: '', emailCobranza: '' }), ConfiguracionInvalida)
		almacen.cerrar()
	})
})

describe('cifrado de la contraseña', () => {
	it('ida y vuelta con la misma clave', () => {
		const clave = randomBytes(32)
		assert.equal(descifrar(cifrar('cobrix-sandbox', clave), clave), 'cobrix-sandbox')
	})

	it('con otra clave no devuelve basura, devuelve null', () => {
		assert.equal(descifrar(cifrar('cobrix-sandbox', randomBytes(32)), randomBytes(32)), null)
	})

	it('un dato manipulado se detecta', () => {
		const clave = randomBytes(32)
		const cifrado = cifrar('cobrix-sandbox', clave)
		const ultimo = cifrado.length - 1
		cifrado[ultimo] = (cifrado[ultimo] ?? 0) ^ 0xff
		assert.equal(descifrar(cifrado, clave), null)
	})

	it('si la clave cambió, la corrida no arranca con una contraseña inventada', () => {
		const almacen = nuevoAlmacen()
		guardarProveedor(almacen, { ...PROVEEDOR_POR_DEFECTO, password: 'cobrix-sandbox' })
		const conOtraClave: Almacen = { ...almacen, clave: randomBytes(32) }
		assert.equal(leerCredenciales(conOtraClave), null)
		almacen.cerrar()
	})
})
