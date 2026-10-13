/**
 * Corrida de importación contra la API simulada en proceso: los criterios de aceptación de
 * ENUNCIADO.md §5 (42 cuotas, 20 clientes, USD 1.235,00) y los invariantes de docs/SPEC.md §3.4
 * y §3.6 — la simulación no escribe, la corrida real es atómica y la segunda corrida no duplica.
 *
 * La fecha se fija ANTES de sembrar: el seed usa `currentPeriod()` y con otra fecha los números
 * de la prueba cambian.
 */

import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { abrirAlmacen, comoEntero, type Almacen } from '../src/cobrix/almacen/base.ts'
import {
	DatosInvalidos, guardarCliente, guardarContrato,
} from '../src/cobrix/almacen/clientes.ts'
import { guardarProveedor } from '../src/cobrix/almacen/configuracion.ts'
import {
	abrirCorrida, cerrarCorrida, CorridaEnCurso, corridaRealEnCurso, leerCorrida, listarCorridas,
} from '../src/cobrix/almacen/corridas.ts'
import {
	deudasImportadas, FacturaDuplicada, insertarFactura, totalesDeCartera,
} from '../src/cobrix/almacen/facturas.ts'
import { mapConLimite } from '../src/cobrix/apoyo/limite.ts'
import { correrImportacion, ProveedorSinCredenciales } from '../src/cobrix/corridas/importacion.ts'
import { PROVEEDOR_POR_DEFECTO } from '../src/cobrix/dominio/configuracion.ts'
import {
	clasificarContrato, type DatosCliente, type DatosContrato,
} from '../src/cobrix/dominio/importacion.ts'
import { ilegible, legible, type FilaContrato } from '../src/cobrix/dominio/tipos.ts'
import { cuotasDe, filaContrato } from './apoyo/datos.ts'
import { levantarSandbox, PASSWORD, USUARIO, type Sandbox } from './apoyo/sandbox.ts'

process.env.SANDBOX_TODAY = '2026-10-13'

/** Reintentos sin espera: ninguna prueba debe tardar por los backoff del cliente. */
const SIN_ESPERA = { opcionesCliente: { dormir: async () => {}, esperas: [0, 0, 0] } }

const TABLAS_DE_DOMINIO = ['cliente', 'contrato', 'factura', 'evento'] as const

function filas(almacen: Almacen, tabla: string): Array<Record<string, unknown>> {
	return almacen.db.prepare(`SELECT * FROM ${tabla} ORDER BY id`).all() as Array<Record<string, unknown>>
}

function cuantas(almacen: Almacen, tabla: string): number {
	const fila = almacen.db.prepare(`SELECT COUNT(*) AS total FROM ${tabla}`).get() as Record<string, unknown>
	return comoEntero(fila.total)
}

const conteoDeDominio = (almacen: Almacen): Record<string, number> =>
	Object.fromEntries(TABLAS_DE_DOMINIO.map(tabla => [tabla, cuantas(almacen, tabla)]))

/** Líneas de la corrida agrupadas: cuotas por resultado y número de líneas por resultado. */
function lineasDe(almacen: Almacen, corridaId: number) {
	const detalle = leerCorrida(almacen, corridaId)
	assert.ok(detalle, 'la corrida tiene que estar en el historial')
	const cuotas: Record<string, number> = {}
	const cuantasLineas: Record<string, number> = {}
	for (const linea of detalle.lineas) {
		cuotas[linea.resultado] = (cuotas[linea.resultado] ?? 0) + linea.cuotas
		cuantasLineas[linea.resultado] = (cuantasLineas[linea.resultado] ?? 0) + 1
	}
	return { detalle, cuotas, cuantasLineas }
}

describe('corrida de importación', () => {
	let sandbox: Sandbox

	before(async () => {
		sandbox = await levantarSandbox()
	})
	after(async () => {
		await sandbox.cerrar()
	})

	/** Cobrix vacío con la configuración por defecto apuntando al sandbox. */
	function nuevoAlmacen(password: string | null = PASSWORD): Almacen {
		const almacen = abrirAlmacen({ ruta: ':memory:' })
		guardarProveedor(almacen, {
			...PROVEEDOR_POR_DEFECTO,
			apiUrl: sandbox.apiUrl,
			usuario: USUARIO,
			password,
		})
		return almacen
	}

	it('simular importación dice qué se importaría y no escribe NADA de dominio', async () => {
		const almacen = nuevoAlmacen()
		const antes = conteoDeDominio(almacen)

		const corrida = await correrImportacion(almacen, { ...SIN_ESPERA, simulacion: true })

		assert.equal(corrida.estado, 'completada')
		assert.equal(corrida.simulacion, true)
		assert.equal(corrida.contadores.facturasNuevas, 42, '42 cuotas se importarían')
		assert.equal(corrida.contadores.montoNuevo, 123_500)
		assert.equal(corrida.contadores.clientesNuevos, 20)
		assert.deepEqual(conteoDeDominio(almacen), antes, 'una simulación no escribe cliente, contrato, factura ni evento')
		assert.deepEqual(antes, { cliente: 0, contrato: 0, factura: 0, evento: 0 })

		// El historial sí registra la simulación, con sus líneas y sin facturas.
		const { detalle, cuotas } = lineasDe(almacen, corrida.corridaId)
		assert.equal(detalle.simulacion, true)
		assert.equal(cuotas.importada, 42)
		assert.ok(detalle.lineas.filter(linea => linea.resultado === 'importada').every(linea => linea.facturaId === null))
		assert.equal(listarCorridas(almacen).length, 1)
		almacen.cerrar()
	})

	it('importar crea 20 clientes y 42 facturas abiertas por USD 1.235,00', async () => {
		const almacen = nuevoAlmacen()
		const corrida = await correrImportacion(almacen, SIN_ESPERA)

		assert.equal(corrida.estado, 'completada')
		assert.equal(corrida.error, null)
		assert.deepEqual(totalesDeCartera(almacen), {
			clientes: 20,
			contratos: 21,
			abiertas: 42,
			pagadas: 0,
			porCobrar: 123_500,
			cobrado: 0,
		})
		assert.equal(corrida.contadores.facturasNuevas, 42)
		assert.equal(corrida.contadores.clientesNuevos, 20)
		assert.equal(corrida.contadores.montoNuevo, 123_500)

		// Toda factura nace abierta, con su saldo completo y trazada a la corrida que la creó.
		const facturas = filas(almacen, 'factura')
		assert.ok(facturas.every(f => f.estado === 'abierta' && f.saldo === f.total))
		assert.ok(facturas.every(f => comoEntero(f.corrida_creacion) === corrida.corridaId))
		assert.equal(cuantas(almacen, 'evento'), 62, '20 clientes creados + 42 facturas importadas')
		almacen.cerrar()
	})

	it('la misma corrida explica las exclusiones: 9 por estado, 1 contrato por moneda, 1 residual', async () => {
		const almacen = nuevoAlmacen()
		const corrida = await correrImportacion(almacen, SIN_ESPERA)
		const { cuotas, cuantasLineas } = lineasDe(almacen, corrida.corridaId)

		assert.equal(cuotas.excluida_estado, 9, '9 cuotas de contratos no importables')
		assert.equal(cuantasLineas.moneda_incoherente, 1, 'un solo contrato por moneda incoherente')
		assert.equal(cuotas.saldo_residual, 1, 'una cuota de menos de un centavo')
		assert.equal(cuantasLineas.sin_deuda, 1, 'LAURA MENDEZ responde con la fila deuda_id "0"')
		assert.equal(cuotas.estado_desconocido, undefined)
		assert.equal(cuotas.identificacion_invalida, undefined)
		assert.equal(cuotas.respuesta_contradictoria, undefined)
		almacen.cerrar()
	})

	it('cada línea guarda su traza: el explicador de decisiones no pierde el por qué', async () => {
		const almacen = nuevoAlmacen()
		const corrida = await correrImportacion(almacen, SIN_ESPERA)
		const { detalle } = lineasDe(almacen, corrida.corridaId)

		assert.ok(detalle.lineas.every(linea => linea.traza.length > 0))
		const residual = detalle.lineas.find(linea => linea.resultado === 'saldo_residual')
		assert.ok(residual)
		assert.deepEqual(residual.traza.map(paso => paso.veredicto), ['ok', 'ok', 'descarta', 'omitida'])
		assert.equal(residual.traza.at(-1)?.regla, 'coherencia de moneda')

		const importada = detalle.lineas.find(linea => linea.resultado === 'importada')
		assert.ok(importada)
		assert.equal(importada.traza.at(-1)?.regla, 'creación de la factura')
		assert.match(importada.traza.at(-1)?.detalle ?? '', /^factura \d+ de Cobrix por USD /)
		almacen.cerrar()
	})

	it('importar otra vez no trae nada nuevo ni modifica una sola fila de factura', async () => {
		const almacen = nuevoAlmacen()
		await correrImportacion(almacen, SIN_ESPERA)
		const facturasAntes = filas(almacen, 'factura')
		const clientesAntes = filas(almacen, 'cliente')

		const segunda = await correrImportacion(almacen, SIN_ESPERA)

		assert.equal(segunda.estado, 'completada')
		assert.equal(segunda.contadores.facturasNuevas, 0)
		assert.equal(segunda.contadores.clientesNuevos, 0)
		assert.equal(segunda.contadores.montoNuevo, 0)
		const { cuotas } = lineasDe(almacen, segunda.corridaId)
		assert.equal(cuotas.ya_importada, 42)
		assert.equal(cuotas.importada, undefined)
		assert.deepEqual(filas(almacen, 'factura'), facturasAntes, 'ninguna fila de factura cambió')
		assert.equal(cuantas(almacen, 'cliente'), clientesAntes.length)
		assert.equal(cuantas(almacen, 'evento'), 62, 'la segunda corrida no agrega eventos')
		almacen.cerrar()
	})

	it('refresca titular y contrato cuando el contrato trae una cuota nueva, sin tocar su alta', async () => {
		const almacen = nuevoAlmacen()
		await correrImportacion(almacen, SIN_ESPERA)

		// Una cuota de ANA PEREZ vuelve a estar por importar y sus datos quedaron viejos.
		almacen.db.prepare(`DELETE FROM factura WHERE contrato_id = 900101 AND periodo = '2026-10'`).run()
		almacen.db.prepare(`
			UPDATE cliente SET nombre = 'NOMBRE VIEJO', email = NULL, telefono = NULL, visto_en = '2020-01-01T00:00:00'
			WHERE id = 'V12345678'`).run()
		almacen.db.prepare(`UPDATE contrato SET estado = 'CORTADO', plan = 'PLAN VIEJO', precio = 1 WHERE id = 900101`).run()
		const antes = filas(almacen, 'cliente').find(fila => fila.id === 'V12345678')

		const corrida = await correrImportacion(almacen, SIN_ESPERA)
		assert.equal(corrida.contadores.facturasNuevas, 1)
		assert.equal(corrida.contadores.clientesNuevos, 0, 'el titular ya existía')

		const despues = filas(almacen, 'cliente').find(fila => fila.id === 'V12345678')
		assert.ok(antes && despues)
		assert.equal(despues.nombre, 'ANA PEREZ', 'el nombre se refresca desde el ISP')
		assert.ok(despues.email !== null)
		assert.equal(despues.creado_en, antes.creado_en, '`creado_en` es la memoria del alta')
		assert.equal(despues.origen, antes.origen)
		assert.notEqual(despues.visto_en, antes.visto_en)

		const contrato = filas(almacen, 'contrato').find(fila => comoEntero(fila.id) === 900101)
		assert.equal(contrato?.estado, 'ACTIVO', 'el estado del contrato se refresca')
		assert.equal(contrato?.plan, 'PLAN15MB25')
		assert.equal(comoEntero(contrato?.precio), 2500)
		assert.equal(cuantas(almacen, 'cliente'), 20, 'refrescar no crea un cliente nuevo')
		almacen.cerrar()
	})

	it('un contrato sin cuotas nuevas igual se pone al día: estado, plan, precio y sucursal', async () => {
		const almacen = nuevoAlmacen()
		await correrImportacion(almacen, SIN_ESPERA)
		const antesCliente = filas(almacen, 'cliente').find(fila => fila.id === 'V12345678')
		// Como si en el ISP el contrato hubiera pasado a CORTADO y Cobrix tuviera datos viejos.
		almacen.db.prepare(`
			UPDATE contrato SET estado = 'CORTADO', plan = 'PLAN VIEJO', precio = 1, sucursal = 'VIEJA', visto_en = '2020-01-01T00:00:00'
			WHERE id = 900101`).run()

		const segunda = await correrImportacion(almacen, SIN_ESPERA)

		assert.equal(segunda.contadores.facturasNuevas, 0, 'poner al día no importa nada')
		assert.equal(segunda.contadores.clientesNuevos, 0)
		assert.equal(segunda.contadores.clientesRefrescados, 20)
		assert.equal(segunda.contadores.contratosRefrescados, 21)

		const contrato = filas(almacen, 'contrato').find(fila => comoEntero(fila.id) === 900101)
		assert.equal(contrato?.estado, 'ACTIVO', 'el estado vuelve a ser el del ISP')
		assert.equal(contrato?.plan, 'PLAN15MB25')
		assert.equal(comoEntero(contrato?.precio), 2500)
		assert.equal(contrato?.sucursal, 'VALENCIA')
		assert.notEqual(contrato?.visto_en, '2020-01-01T00:00:00')
		assert.equal(contrato?.cliente_id, 'V12345678', 'refrescar no reasigna el titular')

		const despuesCliente = filas(almacen, 'cliente').find(fila => fila.id === 'V12345678')
		assert.equal(despuesCliente?.creado_en, antesCliente?.creado_en, 'refrescar no toca el alta')
		assert.deepEqual(conteoDeDominio(almacen), { cliente: 20, contrato: 21, factura: 42, evento: 62 },
			'poner al día no crea ni borra ninguna fila')
		almacen.cerrar()
	})

	it('pone al día correo y teléfono del titular aunque no deba ninguna cuota nueva', async () => {
		const almacen = nuevoAlmacen()
		await correrImportacion(almacen, SIN_ESPERA)
		const antes = filas(almacen, 'cliente').find(fila => fila.id === 'V9876543')
		almacen.db.prepare(`
			UPDATE cliente SET nombre = 'NOMBRE VIEJO', email = 'viejo@example.com', telefono = '00000000000'
			WHERE id = 'V9876543'`).run()

		await correrImportacion(almacen, SIN_ESPERA)

		const despues = filas(almacen, 'cliente').find(fila => fila.id === 'V9876543')
		assert.ok(antes && despues)
		assert.equal(despues.nombre, 'LUIS GOMEZ')
		assert.equal(despues.email, antes.email, 'el correo vuelve al del ISP')
		assert.equal(despues.telefono, antes.telefono)
		assert.equal(despues.creado_en, antes.creado_en)
		assert.equal(despues.origen, antes.origen)
		assert.equal(cuantas(almacen, 'cliente'), 20)
		almacen.cerrar()
	})

	it('refrescar NUNCA inserta: LAURA MENDEZ (ACTIVO y sin deuda) sigue sin ser cliente', async () => {
		const almacen = nuevoAlmacen()
		await correrImportacion(almacen, SIN_ESPERA)
		await correrImportacion(almacen, SIN_ESPERA)

		const nombres = filas(almacen, 'cliente').map(fila => String(fila.nombre))
		assert.ok(!nombres.includes('LAURA MENDEZ'),
			'su contrato no debe nada: poner al día no puede convertirla en cliente')
		assert.equal(filas(almacen, 'contrato').filter(fila => comoEntero(fila.id) === 900109).length, 0)
		assert.deepEqual(totalesDeCartera(almacen), {
			clientes: 20, contratos: 21, abiertas: 42, pagadas: 0, porCobrar: 123_500, cobrado: 0,
		})
		almacen.cerrar()
	})

	it('la simulación tampoco refresca: dice qué pondría al día y no toca una fila', async () => {
		const almacen = nuevoAlmacen()
		await correrImportacion(almacen, SIN_ESPERA)
		almacen.db.prepare(`UPDATE contrato SET estado = 'DATO VIEJO' WHERE id = 900101`).run()
		const antes = { clientes: filas(almacen, 'cliente'), contratos: filas(almacen, 'contrato') }

		const simulada = await correrImportacion(almacen, { ...SIN_ESPERA, simulacion: true })

		assert.equal(simulada.contadores.clientesRefrescados, 20, 'informa lo que pondría al día')
		assert.equal(simulada.contadores.contratosRefrescados, 21)
		assert.deepEqual(filas(almacen, 'contrato'), antes.contratos, 'pero no escribe: el dato viejo sigue ahí')
		assert.deepEqual(filas(almacen, 'cliente'), antes.clientes)
		almacen.cerrar()
	})

	it('un titular con dos contratos es un solo cliente (LUIS GOMEZ)', async () => {
		const almacen = nuevoAlmacen()
		await correrImportacion(almacen, SIN_ESPERA)

		const cliente = filas(almacen, 'cliente').filter(fila => fila.id === 'V9876543')
		assert.equal(cliente.length, 1)
		assert.equal(cliente[0]!.nombre, 'LUIS GOMEZ')
		const contratos = filas(almacen, 'contrato').filter(fila => fila.cliente_id === 'V9876543')
		assert.deepEqual(contratos.map(fila => [comoEntero(fila.id), fila.estado]), [[900102, 'ACTIVO'], [900103, 'CORTADO']])
		almacen.cerrar()
	})

	it('normaliza la identificación del titular (ELENA RUIZ y COMERCIAL EL FARO)', async () => {
		const almacen = nuevoAlmacen()
		await correrImportacion(almacen, SIN_ESPERA)
		const clientes = filas(almacen, 'cliente')

		const elena = clientes.find(fila => fila.nombre === 'ELENA RUIZ')
		assert.ok(elena, 'ELENA RUIZ tiene que existir')
		assert.equal(elena.id, '9000123', '09000123 pierde la letra ausente y los ceros a la izquierda')
		assert.equal(elena.persona, 'natural')

		const faro = clientes.find(fila => fila.id === 'J401234567')
		assert.ok(faro, 'COMERCIAL EL FARO tiene que existir con su RIF normalizado')
		assert.equal(faro.persona, 'juridica')
		assert.equal(faro.tipo_documento, 'J')
		almacen.cerrar()
	})

	it('los titulares excluidos no entran como clientes', async () => {
		const almacen = nuevoAlmacen()
		await correrImportacion(almacen, SIN_ESPERA)
		const nombres = filas(almacen, 'cliente').map(fila => String(fila.nombre))

		for (const ausente of ['CARLOS ROJAS', 'ROSA DIAZ', 'PEDRO LEON', 'ANDRES VARGAS', 'LAURA MENDEZ', 'JORGE CASTILLO']) {
			assert.ok(!nombres.includes(ausente), `${ausente} no debe existir como cliente`)
		}
		assert.equal(nombres.length, 20)
		almacen.cerrar()
	})

	it('los contadores cuadran con las líneas y con las facturas creadas', async () => {
		const almacen = nuevoAlmacen()
		const corrida = await correrImportacion(almacen, SIN_ESPERA)
		const { cuotas, cuantasLineas } = lineasDe(almacen, corrida.corridaId)
		const contadores = corrida.contadores

		assert.equal(contadores.contratos, 27, 'se recorren todos los contratos, no solo los activos')
		assert.deepEqual(contadores.cuotas, cuotas, 'los contadores guardados son los de las líneas')
		assert.deepEqual(contadores.lineas, cuantasLineas)
		const sumaDeCuotas = Object.values(contadores.cuotas).reduce((total, valor) => total + valor, 0)
		assert.equal(sumaDeCuotas, contadores.cuotasVistas, 'cada cuota vista tiene exactamente una línea')
		assert.equal(contadores.cuotasVistas, 54)
		assert.equal(contadores.cuotas.importada, cuantas(almacen, 'factura'))
		assert.equal(contadores.cuotasExcluidas, 12, '9 por estado + 2 del contrato en VES + 1 residual')
		assert.match(corrida.resumen, /42 facturas nuevas por USD 1\.235,00/)
		almacen.cerrar()
	})

	it('con credenciales malas la corrida queda fallida, con el error y sin escribir nada', async () => {
		const almacen = nuevoAlmacen('contraseña-equivocada')
		const antes = conteoDeDominio(almacen)

		const corrida = await correrImportacion(almacen, SIN_ESPERA)

		assert.equal(corrida.estado, 'fallida')
		assert.ok(corrida.error)
		assert.equal(corrida.error.codigo, 'credenciales')
		assert.equal(corrida.error.endpoint, 'usuario/login')
		assert.equal(corrida.error.status, 400, 'esta API rechaza la contraseña con un 400')
		assert.match(corrida.error.mensaje, /Contrase/)
		assert.deepEqual(conteoDeDominio(almacen), antes, 'un fallo de la API no deja escrituras de dominio')

		const guardada = leerCorrida(almacen, corrida.corridaId)
		assert.equal(guardada?.estado, 'fallida')
		assert.equal(guardada?.error?.codigo, 'credenciales')
		assert.ok((guardada?.error?.sugerencia ?? '').length > 0, 'el error dice cómo seguir')
		assert.equal(guardada?.lineas.length, 0)
		assert.equal(corridaRealEnCurso(almacen), null, 'una corrida fallida libera el cerrojo')
		almacen.cerrar()
	})

	it('sin contraseña guardada la corrida no arranca y no se registra', async () => {
		const almacen = nuevoAlmacen(null)

		await assert.rejects(() => correrImportacion(almacen, SIN_ESPERA), (error: unknown) => {
			assert.ok(error instanceof ProveedorSinCredenciales)
			assert.match(error.message, /contraseña/)
			assert.match(error.sugerencia, /Configuración/)
			return true
		})
		assert.equal(listarCorridas(almacen).length, 0, 'no hay nada que historiar: no arrancó')
		assert.deepEqual(conteoDeDominio(almacen), { cliente: 0, contrato: 0, factura: 0, evento: 0 })
		almacen.cerrar()
	})

	it('si la escritura falla a mitad, la corrida revierte entera y queda fallida', async () => {
		const almacen = nuevoAlmacen()
		// El administrador reporta la misma cuota en dos contratos: la segunda factura choca con
		// `UNIQUE (proveedor_id, deuda_id)` cuando ya se escribieron clientes, contratos y facturas.
		const fetchQueDuplica: typeof globalThis.fetch = async (entrada, init) => {
			const respuesta = await globalThis.fetch(entrada, init)
			const url = String(entrada)
			if (!url.includes('contrato/individual') || !url.includes('id_contrato=900113')) return respuesta
			const cuerpo = await respuesta.json() as Array<Record<string, unknown>>
			const alterado = cuerpo.map((fila, indice) => (indice === 0 ? { ...fila, deuda_id: '7000008' } : fila))
			return new Response(JSON.stringify(alterado), { status: 200, headers: { 'content-type': 'application/json' } })
		}

		const corrida = await correrImportacion(almacen, {
			opcionesCliente: { dormir: async () => {}, esperas: [0, 0, 0], fetch: fetchQueDuplica },
		})

		assert.equal(corrida.estado, 'fallida')
		assert.equal(corrida.error?.codigo, 'interno')
		assert.match(corrida.error?.mensaje ?? '', /ya tiene factura en Cobrix/)
		assert.deepEqual(conteoDeDominio(almacen), { cliente: 0, contrato: 0, factura: 0, evento: 0 },
			'o queda todo o no queda nada: ni el cliente que sí se había escrito')

		const { detalle, cuotas } = lineasDe(almacen, corrida.corridaId)
		assert.equal(detalle.estado, 'fallida')
		assert.ok(detalle.lineas.length > 0, 'las cuotas ya clasificadas quedan en el historial')
		assert.equal(cuotas.importada, undefined, 'una corrida fallida no dice que importó nada')
		assert.equal(corridaRealEnCurso(almacen), null)
		almacen.cerrar()
	})

	it('una API que responde 500 agota los reintentos y deja la corrida fallida', async () => {
		const almacen = nuevoAlmacen()
		let peticiones = 0
		const fetchRoto: typeof globalThis.fetch = async (entrada, init) => {
			peticiones++
			const url = String(entrada)
			if (url.includes('usuario/login')) return await globalThis.fetch(entrada, init)
			return new Response(JSON.stringify({ detail: 'el administrador se cayó' }), {
				status: 503,
				headers: { 'content-type': 'application/json' },
			})
		}

		const corrida = await correrImportacion(almacen, {
			opcionesCliente: { dormir: async () => {}, esperas: [0, 0, 0], fetch: fetchRoto },
		})

		assert.equal(corrida.estado, 'fallida')
		assert.equal(corrida.error?.codigo, 'http')
		assert.equal(corrida.error?.status, 503)
		assert.equal(corrida.error?.endpoint, 'isp/lista_ids_contratos')
		assert.ok(peticiones >= 4, 'login + 3 intentos antes de rendirse')
		assert.deepEqual(conteoDeDominio(almacen), { cliente: 0, contrato: 0, factura: 0, evento: 0 })
		almacen.cerrar()
	})
})

describe('cerrojo de corridas', () => {
	let sandbox: Sandbox

	before(async () => {
		sandbox = await levantarSandbox()
	})
	after(async () => {
		await sandbox.cerrar()
	})

	function nuevoAlmacen(): Almacen {
		const almacen = abrirAlmacen({ ruta: ':memory:' })
		guardarProveedor(almacen, { ...PROVEEDOR_POR_DEFECTO, apiUrl: sandbox.apiUrl, usuario: USUARIO, password: PASSWORD })
		return almacen
	}

	const apertura = { tipo: 'importacion', disparo: 'manual', configuracion: null } as const

	it('con una corrida real en curso no arranca otra, ni real ni simulada', async () => {
		const almacen = nuevoAlmacen()
		const enCurso = abrirCorrida(almacen, { ...apertura, simulacion: false })
		assert.deepEqual(corridaRealEnCurso(almacen)?.id, enCurso.id)

		await assert.rejects(() => correrImportacion(almacen, SIN_ESPERA), CorridaEnCurso)
		await assert.rejects(() => correrImportacion(almacen, { ...SIN_ESPERA, simulacion: true }), CorridaEnCurso)
		assert.equal(cuantas(almacen, 'factura'), 0)

		cerrarCorrida(almacen, enCurso.id, { contadores: null, resumen: 'cerrada a mano' })
		assert.equal(corridaRealEnCurso(almacen), null)
		const corrida = await correrImportacion(almacen, SIN_ESPERA)
		assert.equal(corrida.estado, 'completada')
		almacen.cerrar()
	})

	it('una simulación no toma el cerrojo: la corrida real puede arrancar igual', async () => {
		const almacen = nuevoAlmacen()
		const simulada = abrirCorrida(almacen, { ...apertura, simulacion: true })
		assert.equal(corridaRealEnCurso(almacen), null, 'una simulación no bloquea')

		const corrida = await correrImportacion(almacen, SIN_ESPERA)
		assert.equal(corrida.estado, 'completada')
		assert.notEqual(corrida.corridaId, simulada.id)
		almacen.cerrar()
	})

	it('un cerrojo huérfano no bloquea para siempre', async () => {
		const almacen = nuevoAlmacen()
		const abandonada = abrirCorrida(almacen, { ...apertura, simulacion: false })
		// Como si el proceso hubiera muerto: la corrida ya no está en curso pero el cerrojo quedó.
		almacen.db.prepare(`UPDATE corrida SET estado = 'fallida' WHERE id = ?`).run(abandonada.id)
		assert.equal(corridaRealEnCurso(almacen), null)

		const corrida = await correrImportacion(almacen, SIN_ESPERA)
		assert.equal(corrida.estado, 'completada')
		almacen.cerrar()
	})
})

describe('escrituras del almacén, una por una', () => {
	const MOMENTO = '2026-10-13T09:00:00'
	const CLIENTE: DatosCliente = {
		id: 'V12345678', tipoDocumento: 'V', numero: '12345678', nombre: 'ANA PEREZ',
		persona: 'natural', email: 'ana@example.com', telefono: '04121000000',
	}
	const CONTRATO: DatosContrato = {
		id: 900101, codigo: '0900101', estado: 'ACTIVO', plan: 'PLAN15MB25',
		precio: 2500, sucursal: 'VALENCIA', moneda: 'USD',
	}

	function conCorrida(): { almacen: Almacen; corridaId: number } {
		const almacen = abrirAlmacen({ ruta: ':memory:' })
		const corrida = abrirCorrida(almacen, { tipo: 'importacion', simulacion: false, disparo: 'manual', configuracion: null })
		return { almacen, corridaId: corrida.id }
	}

	it('la segunda alta del mismo titular es un refresco, no un cliente nuevo', () => {
		const { almacen } = conCorrida()
		assert.deepEqual(guardarCliente(almacen, CLIENTE, MOMENTO, 'ISP'), { creado: true })
		assert.deepEqual(
			guardarCliente(almacen, { ...CLIENTE, nombre: 'ANA M. PEREZ', telefono: '04140000000' }, '2026-10-14T09:00:00', 'OTRO'),
			{ creado: false },
		)

		const fila = filas(almacen, 'cliente')[0]!
		assert.equal(cuantas(almacen, 'cliente'), 1)
		assert.equal(fila.nombre, 'ANA M. PEREZ')
		assert.equal(fila.telefono, '04140000000')
		assert.equal(fila.creado_en, MOMENTO)
		assert.equal(fila.origen, 'ISP', 'el origen es el del alta: no lo reescribe una corrida posterior')
		assert.equal(fila.visto_en, '2026-10-14T09:00:00')
		almacen.cerrar()
	})

	it('rechaza datos que no se pueden guardar, con un mensaje que dice qué está mal', () => {
		const { almacen, corridaId } = conCorrida()

		assert.throws(() => guardarCliente(almacen, { ...CLIENTE, id: 'V-12.345.678' }, MOMENTO, 'ISP'), (error: unknown) => {
			assert.ok(error instanceof DatosInvalidos)
			assert.match(error.message, /no está normalizada/)
			return true
		})
		assert.throws(() => guardarCliente(almacen, CLIENTE, 'ayer', 'ISP'), DatosInvalidos)
		assert.throws(() => guardarCliente(almacen, { ...CLIENTE, nombre: '  ' }, MOMENTO, 'ISP'), DatosInvalidos)
		assert.equal(cuantas(almacen, 'cliente'), 0, 'nada se guarda a medias')

		guardarCliente(almacen, CLIENTE, MOMENTO, 'ISP')
		assert.throws(() => guardarContrato(almacen, { ...CONTRATO, id: 0 }, CLIENTE.id, MOMENTO), DatosInvalidos)
		guardarContrato(almacen, CONTRATO, CLIENTE.id, MOMENTO)

		const valida = {
			deudaId: '7000008', clienteId: CLIENTE.id, contratoId: CONTRATO.id, periodo: '2026-08',
			venceEl: '2026-08-01', cortaEl: '2026-08-01', total: 2500, corridaCreacion: corridaId,
		}
		assert.throws(() => insertarFactura(almacen, { ...valida, total: 0 }, MOMENTO), (error: unknown) => {
			assert.ok(error instanceof DatosInvalidos)
			assert.match(error.message, /mayor que cero/)
			return true
		})
		assert.throws(() => insertarFactura(almacen, { ...valida, periodo: 'agosto' }, MOMENTO), DatosInvalidos)
		assert.throws(() => insertarFactura(almacen, { ...valida, deudaId: '0' }, MOMENTO), DatosInvalidos)
		assert.equal(cuantas(almacen, 'factura'), 0)

		const facturaId = insertarFactura(almacen, valida, MOMENTO)
		assert.ok(facturaId > 0)
		assert.deepEqual([...deudasImportadas(almacen)], ['7000008'])
		assert.throws(() => insertarFactura(almacen, valida, MOMENTO), FacturaDuplicada,
			'UNIQUE (proveedor_id, deuda_id): la idempotencia también está en el esquema')
		almacen.cerrar()
	})
})

describe('datos frescos del contrato (lo que autoriza a refrescar)', () => {
	const CONTEXTO = {
		periodoActual: '2026-10',
		configuracion: {
			estadosImportables: ['ACTIVO', 'CORTADO'], ventanaMeses: null, maxCuotasRecientes: null,
			diasGracia: 0, topeFacturas: null, topeMonto: null, excluirTiposDocumento: [],
		},
		yaImportadas: new Set<string>(),
	}
	const clasificar = (filas: readonly FilaContrato[], yaImportadas = new Set<string>()) =>
		clasificarContrato(filas[0]?.contratoId ?? 0, legible(filas), { ...CONTEXTO, yaImportadas })

	it('un contrato importable los ofrece, incluso si todas sus cuotas ya estaban importadas', () => {
		const nuevas = clasificar(cuotasDe(['2026-09', '2026-10']))
		assert.ok(nuevas.frescos)
		assert.equal(nuevas.frescos.cliente.id, 'V12345678')
		assert.equal(nuevas.frescos.contrato.estado, 'ACTIVO')
		assert.equal(nuevas.frescos.contrato.precio, 2500)

		const repetidas = clasificar(cuotasDe(['2026-09', '2026-10']), new Set(['7000008', '7000009']))
		assert.equal(repetidas.candidatas.length, 0, 'nada que importar')
		assert.ok(repetidas.frescos, 'y aun así hay datos frescos: es el caso que motivó el campo')
	})

	it('un contrato que cae antes de la etapa cuota a cuota no ofrece nada', () => {
		assert.equal(clasificar(cuotasDe(['2026-09'], { estado: 'RETIRADO' })).frescos, null)
		assert.equal(clasificar(cuotasDe(['2026-09'], { estado: 'LO_QUE_SEA' })).frescos, null)
		assert.equal(clasificar(cuotasDe(['2026-09'], { identificacionBruta: 'ABC' })).frescos, null)
		assert.equal(clasificar(cuotasDe(['2026-09'], { monedaSigla: 'VES' })).frescos, null)
		assert.equal(clasificar(cuotasDe(['2026-09'], { deuda: 5, precioServicio: 2500 })).frescos, null)
		assert.equal(clasificar([filaContrato({ deudaId: '0', deuda: 0 })]).frescos, null,
			'sin cuotas pendientes el flujo no llega a juzgar la moneda: no se refresca lo que no se verificó')
		assert.equal(clasificarContrato(900101, ilegible('cuota_duplicada', 'deuda_id duplicado'), CONTEXTO).frescos, null)
	})
})

describe('recorrido con concurrencia acotada', () => {
	it('conserva el orden de entrada y nunca pasa del límite', async () => {
		const orden = [40, 10, 30, 20, 50, 5, 15]
		let activos = 0
		let maximo = 0

		const salida = await mapConLimite(orden, 3, async (ms, indice) => {
			activos++
			maximo = Math.max(maximo, activos)
			await new Promise(listo => setTimeout(listo, ms))
			activos--
			return `${indice}:${ms}`
		})

		assert.deepEqual(salida, orden.map((ms, indice) => `${indice}:${ms}`))
		assert.equal(maximo, 3)
	})

	it('el primer fallo aborta el recorrido y lo propaga una sola vez', async () => {
		const tocados: number[] = []
		await assert.rejects(
			() => mapConLimite([1, 2, 3, 4, 5, 6], 2, async elemento => {
				tocados.push(elemento)
				if (elemento === 2) throw new Error('el ISP se cayó')
				return elemento
			}),
			/el ISP se cayó/,
		)
		assert.ok(tocados.length < 6, 'no se siguen tomando trabajos después del fallo')
	})

	it('rechaza un límite que no es un entero positivo', async () => {
		await assert.rejects(() => mapConLimite([1], 0, async valor => valor), RangeError)
	})
})
