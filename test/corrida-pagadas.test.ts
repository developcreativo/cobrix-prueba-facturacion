/**
 * Ciclo completo de ENUNCIADO.md §5: importar → cobrar en la caja del ISP → actualizar pagadas.
 *
 * SEGURIDAD: `/__sim/pagar` y `/__sim/anular` ESCRIBEN en la base del administrador. Aquí se
 * llaman siempre contra `sandbox.raiz`, que es un servidor en puerto efímero con una base
 * temporal propia (`test/apoyo/sandbox.ts`). Nunca contra 127.0.0.1:4310, donde vive la instancia
 * del usuario sobre `data/billing-api.sqlite`, que está versionado y es material del cliente.
 * `montar()` lo comprueba en cada prueba.
 *
 * Cada prueba levanta su propio sandbox: la caja muta la base del ISP y dos pruebas no pueden
 * compartirla sin pisarse.
 */

import assert from 'node:assert/strict'
import { describe, it, type TestContext } from 'node:test'

import { crearCliente } from '../src/cobrix/api/cliente.ts'
import { abrirAlmacen, comoEntero, type Almacen } from '../src/cobrix/almacen/base.ts'
import { guardarProveedor } from '../src/cobrix/almacen/configuracion.ts'
import { leerCorrida, listarCorridas } from '../src/cobrix/almacen/corridas.ts'
import { insertarFactura, totalesDeCartera } from '../src/cobrix/almacen/facturas.ts'
import { correrImportacion, ProveedorSinCredenciales } from '../src/cobrix/corridas/importacion.ts'
import { correrActualizacionDePagadas } from '../src/cobrix/corridas/pagadas.ts'
import { PROVEEDOR_POR_DEFECTO } from '../src/cobrix/dominio/configuracion.ts'
import { levantarSandbox, PASSWORD, USUARIO, type Sandbox } from './apoyo/sandbox.ts'

process.env.SANDBOX_TODAY = '2026-10-13'

const SIN_ESPERA = { opcionesCliente: { dormir: async () => {}, esperas: [0, 0, 0] } }
const HOY = '2026-10-13'

interface Montaje {
	readonly sandbox: Sandbox
	readonly almacen: Almacen
}

/**
 * Sandbox propio y Cobrix vacío. El cierre se registra en el contexto de la prueba: si una
 * aserción falla, el servidor igual se apaga. Si no, un fallo dejaría el puerto abierto y el
 * proceso de pruebas no terminaría nunca.
 */
async function montar(t: TestContext, password: string | null = PASSWORD): Promise<Montaje> {
	const sandbox = await levantarSandbox()
	// Red de seguridad: la caja solo se toca en una base temporal, nunca en la del repositorio.
	assert.ok(!sandbox.raiz.includes(':4310'), 'el sandbox tiene que estar en un puerto efímero propio')
	const almacen = abrirAlmacen({ ruta: ':memory:' })
	guardarProveedor(almacen, { ...PROVEEDOR_POR_DEFECTO, apiUrl: sandbox.apiUrl, usuario: USUARIO, password })
	t.after(async () => {
		almacen.cerrar()
		await sandbox.cerrar()
	})
	return { sandbox, almacen }
}

/** La caja del ISP: cobra toda la deuda o `monto` si se le pasa. */
async function pagar(sandbox: Sandbox, cuerpo: Record<string, unknown>): Promise<{ idFactura: number; numFactura: string }> {
	const respuesta = await fetch(`${sandbox.raiz}/__sim/pagar`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(cuerpo),
	})
	assert.equal(respuesta.status, 200, `la caja rechazó ${JSON.stringify(cuerpo)}`)
	const datos = await respuesta.json() as Record<string, unknown>
	return { idFactura: comoEntero(datos.id_factura), numFactura: String(datos.num_factura) }
}

async function anular(sandbox: Sandbox, idFactura: number): Promise<void> {
	const respuesta = await fetch(`${sandbox.raiz}/__sim/anular`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ id_factura: idFactura }),
	})
	assert.equal(respuesta.status, 200, `la caja no pudo anular ${idFactura}`)
}

function filas(almacen: Almacen, sql: string, ...parametros: Array<string | number>): Array<Record<string, unknown>> {
	return almacen.db.prepare(sql).all(...parametros) as Array<Record<string, unknown>>
}

const cuantas = (almacen: Almacen, tabla: string, filtro = '1=1'): number =>
	comoEntero(filas(almacen, `SELECT COUNT(*) AS n FROM ${tabla} WHERE ${filtro}`)[0]?.n)

const todasLasFacturas = (almacen: Almacen): Array<Record<string, unknown>> =>
	filas(almacen, 'SELECT * FROM factura ORDER BY id')

function lineasDe(almacen: Almacen, corridaId: number) {
	const detalle = leerCorrida(almacen, corridaId)
	assert.ok(detalle, 'la corrida tiene que estar en el historial')
	const porResultado = new Map<string, Array<Record<string, unknown>>>()
	for (const linea of detalle.lineas) {
		const lista = porResultado.get(linea.resultado) ?? []
		lista.push({ facturaId: linea.facturaId, deudaId: linea.deudaId, periodo: linea.periodo, contratoId: linea.contratoId })
		porResultado.set(linea.resultado, lista)
	}
	return { detalle, porResultado, de: (resultado: string) => porResultado.get(resultado) ?? [] }
}

/** Los cinco cobros de la tabla de ENUNCIADO.md §5, en la caja del sandbox. */
async function cobrarLosCincoCasos(sandbox: Sandbox): Promise<void> {
	await pagar(sandbox, { id_contrato: 900101 })
	await pagar(sandbox, { id_contrato: 900103, monto: 25 })
	await pagar(sandbox, { id_contrato: 900104 })
	await pagar(sandbox, { id_contrato: 900114, monto: 70 })
	const deElena = await pagar(sandbox, { id_contrato: 900113 })
	await anular(sandbox, deElena.idFactura)
}

describe('ciclo completo: importar, cobrar en la caja y actualizar pagadas', () => {
	it('deja 8 facturas pagadas y 34 abiertas por USD 955,00', async t => {
		const { sandbox, almacen } = await montar(t)
		await correrImportacion(almacen, SIN_ESPERA)
		await cobrarLosCincoCasos(sandbox)

		const corrida = await correrActualizacionDePagadas(almacen, SIN_ESPERA)

		assert.equal(corrida.estado, 'completada')
		assert.equal(corrida.error, null)
		assert.equal(corrida.contadores.facturasPagadas, 8)
		assert.equal(corrida.contadores.montoCobrado, 28_000, 'USD 280,00 = 70 + 20 + 120 + 70')
		assert.deepEqual(totalesDeCartera(almacen), {
			clientes: 20, contratos: 21, abiertas: 34, pagadas: 8, porCobrar: 95_500, cobrado: 28_000,
		})

		// Caso a caso, como la tabla del enunciado.
		const pagadasDe = (contratoId: number): string[] =>
			filas(almacen, `SELECT periodo FROM factura WHERE contrato_id = ? AND estado = 'pagada' ORDER BY periodo`, contratoId)
				.map(fila => String(fila.periodo))
		assert.deepEqual(pagadasDe(900101), ['2026-08', '2026-09', '2026-10'], 'ANA PEREZ: sus 3, incluida la del abono previo')
		assert.deepEqual(pagadasDe(900103), ['2026-07'], 'LUIS GOMEZ cortado: solo la más vieja')
		assert.deepEqual(pagadasDe(900104), ['2026-09', '2026-10'], 'COMERCIAL EL FARO: sus 2')
		assert.deepEqual(pagadasDe(900114), ['2026-03', '2026-04'], 'MIGUEL ANGEL SOTO: las 2 más viejas')
		assert.deepEqual(pagadasDe(900113), [], 'ELENA RUIZ: el cobro fue anulado, nada cambia')
		assert.equal(cuantas(almacen, 'factura', `contrato_id = 900113 AND estado = 'abierta'`), 2)

		const { de } = lineasDe(almacen, corrida.corridaId)
		assert.equal(de('marcada_pagada').length, 8)
		assert.equal(de('abono_parcial').length, 1, 'la siguiente cuota de LUIS GOMEZ quedó a medias')
		assert.deepEqual(de('abono_parcial')[0]?.periodo, '2026-08')
		assert.equal(de('sin_cambio').length, 33)
		assert.equal(cuantas(almacen, 'evento', `tipo = 'factura_pagada'`), 8)
	})

	it('la fecha de pago es la del cobro del ISP, no la de hoy, y queda el número de su factura', async t => {
		const { sandbox, almacen } = await montar(t)
		await correrImportacion(almacen, SIN_ESPERA)
		const cobro = await pagar(sandbox, { id_contrato: 900104 })

		await correrActualizacionDePagadas(almacen, SIN_ESPERA)

		const pagadas = filas(almacen,
			`SELECT pagada_el, isp_factura_id, isp_factura_num FROM factura WHERE contrato_id = 900104 AND estado = 'pagada'`)
		assert.equal(pagadas.length, 2)
		for (const fila of pagadas) {
			assert.equal(fila.pagada_el, HOY, 'la caja emitió su factura hoy: esa es la fecha del cobro')
			assert.equal(comoEntero(fila.isp_factura_id), cobro.idFactura)
			assert.equal(fila.isp_factura_num, cobro.numFactura)
		}
		const evento = filas(almacen, `SELECT detalle FROM evento WHERE tipo = 'factura_pagada' LIMIT 1`)[0]
		assert.match(String(evento?.detalle), new RegExp(`factura ${cobro.numFactura} del ${HOY}`))
	})

	it('repetir la actualización no cambia nada: 8 ya pagadas y cero escrituras', async t => {
		const { sandbox, almacen } = await montar(t)
		await correrImportacion(almacen, SIN_ESPERA)
		await cobrarLosCincoCasos(sandbox)
		await correrActualizacionDePagadas(almacen, SIN_ESPERA)
		const antes = todasLasFacturas(almacen)
		const eventos = cuantas(almacen, 'evento')

		const segunda = await correrActualizacionDePagadas(almacen, SIN_ESPERA)

		assert.equal(segunda.estado, 'completada')
		assert.equal(segunda.contadores.facturasPagadas, 0)
		assert.equal(segunda.contadores.montoCobrado, 0)
		assert.equal(segunda.contadores.facturas.ya_pagada, 8)
		assert.equal(segunda.contadores.facturasRevisadas, 42)
		assert.deepEqual(todasLasFacturas(almacen), antes, 'ninguna fila de factura cambió')
		assert.equal(cuantas(almacen, 'evento'), eventos, 'ningún evento nuevo')
	})

	it('simular la actualización dice que marcaría 8 y no escribe nada', async t => {
		const { sandbox, almacen } = await montar(t)
		await correrImportacion(almacen, SIN_ESPERA)
		await cobrarLosCincoCasos(sandbox)
		const antes = todasLasFacturas(almacen)
		const eventos = cuantas(almacen, 'evento')

		const simulada = await correrActualizacionDePagadas(almacen, { ...SIN_ESPERA, simulacion: true })

		assert.equal(simulada.simulacion, true)
		assert.equal(simulada.contadores.facturasPagadas, 8, 'dice lo que marcaría')
		assert.equal(simulada.contadores.montoCobrado, 28_000)
		assert.deepEqual(todasLasFacturas(almacen), antes, 'pero no toca una sola factura')
		assert.equal(cuantas(almacen, 'evento'), eventos)
		assert.equal(cuantas(almacen, 'factura', `estado = 'pagada'`), 0)

		const { detalle, de } = lineasDe(almacen, simulada.corridaId)
		assert.equal(detalle.simulacion, true)
		assert.equal(de('marcada_pagada').length, 8, 'el historial registra la simulación con su detalle')
	})

	it('los contadores cuadran: una línea por factura revisada', async t => {
		const { sandbox, almacen } = await montar(t)
		await correrImportacion(almacen, SIN_ESPERA)
		await cobrarLosCincoCasos(sandbox)

		const corrida = await correrActualizacionDePagadas(almacen, SIN_ESPERA)
		const contadores = corrida.contadores
		const { detalle } = lineasDe(almacen, corrida.corridaId)

		assert.equal(contadores.contratos, 21, 'los 21 contratos con facturas abiertas')
		assert.equal(contadores.facturasRevisadas, 42)
		assert.equal(detalle.lineas.length, 42, 'una línea por factura, ni una más')
		const suma = Object.values(contadores.facturas).reduce((total, valor) => total + valor, 0)
		assert.equal(suma, contadores.facturasRevisadas)
		assert.deepEqual(contadores.lineas, contadores.facturas, 'en esta corrida hay una línea por factura')
		assert.equal(contadores.facturas.marcada_pagada, contadores.facturasPagadas)
		assert.ok(detalle.lineas.every(linea => linea.traza.length > 0), 'toda línea explica su veredicto')
		assert.match(corrida.resumen, /8 facturas pagadas por USD 280,00/)
	})
})

describe('la ventana del libro y las peticiones que hace la corrida', () => {
	it('pide cada libro con fechas explícitas, hasta el último día del periodo actual', async t => {
		const { sandbox, almacen } = await montar(t)
		await correrImportacion(almacen, SIN_ESPERA)

		const urls: string[] = []
		const espia: typeof globalThis.fetch = async (entrada, init) => {
			urls.push(String(entrada))
			return await globalThis.fetch(entrada, init)
		}
		await correrActualizacionDePagadas(almacen, { opcionesCliente: { ...SIN_ESPERA.opcionesCliente, fetch: espia } })

		const libros = urls.filter(url => url.includes('pago_informacion'))
		assert.equal(urls.filter(url => url.includes('usuario/login')).length, 1, 'un solo login')
		assert.equal(libros.length, 21, 'un libro por contrato con facturas abiertas')
		assert.equal(urls.filter(url => url.includes('contrato/individual')).length, 0,
			'con la ventana correcta ninguna cuota falta del libro: no hay que desempatar')
		assert.equal(urls.length, 22)

		for (const url of libros) {
			const parametros = new URL(url).searchParams
			assert.equal(parametros.get('tipo_busqueda'), 'CUOTA')
			assert.equal(parametros.get('fecha_fin'), '2026-10-31',
				'último día del periodo actual: las cuotas sin cobro llevan fecha sintética a fin de mes')
			assert.match(parametros.get('fecha_inicio') ?? '', /^\d{4}-\d{2}-01$/)
		}
		const deSoto = libros.find(url => url.includes('id_contrato=900114'))
		assert.equal(new URL(deSoto ?? '').searchParams.get('fecha_inicio'), '2026-03-01',
			'el primer día del periodo más viejo que SOTO tiene abierto')
		const deAna = libros.find(url => url.includes('id_contrato=900101'))
		assert.equal(new URL(deAna ?? '').searchParams.get('fecha_inicio'), '2026-08-01')
	})

	it('sin facturas abiertas la corrida no toca la API', async t => {
		const { almacen } = await montar(t)
		let peticiones = 0
		const contador: typeof globalThis.fetch = async (entrada, init) => {
			peticiones++
			return await globalThis.fetch(entrada, init)
		}

		const corrida = await correrActualizacionDePagadas(almacen, { opcionesCliente: { fetch: contador } })

		assert.equal(corrida.estado, 'completada')
		assert.equal(corrida.contadores.facturasRevisadas, 0)
		assert.equal(corrida.contadores.contratos, 0)
		assert.equal(peticiones, 0, 'ni siquiera inicia sesión')
		assert.equal(corrida.resumen, 'No hay facturas en Cobrix: nada que revisar.')
		assert.equal(listarCorridas(almacen, { tipo: 'pagadas' }).length, 1, 'y aun así queda en el historial')
	})
})

describe('lo que NUNCA se marca pagado', () => {
	it('una cuota exonerada no es un pago: saldo 0 sin nada cobrado', async t => {
		const { sandbox, almacen } = await montar(t)
		await correrImportacion(almacen, SIN_ESPERA)

		// La cuota exonerada de VALENTINA PAZ (contrato 900115) nunca se importa, porque el
		// administrador la publica con deuda 0. Se recrea el caso real: estaba importada y abierta
		// cuando el ISP la exoneró.
		const api = crearCliente({ apiUrl: sandbox.apiUrl, usuario: USUARIO, password: PASSWORD }, SIN_ESPERA.opcionesCliente)
		const libro = await api.libroDeCuotas(900115, '2026-01-01', '2026-10-31')
		assert.ok(libro.ok)
		const exonerada = libro.datos.find(fila => fila.saldo === 0 && fila.descuento < 0)
		assert.ok(exonerada, 'VALENTINA PAZ tiene una cuota exonerada en el libro')
		assert.equal(exonerada.valorPago, 0, 'saldo 0 y nada pagado: una exoneración')
		const facturaId = insertarFactura(almacen, {
			deudaId: String(exonerada.cuotaId),
			clienteId: 'V24111222',
			contratoId: 900115,
			periodo: exonerada.periodo,
			venceEl: `${exonerada.periodo}-01`,
			cortaEl: `${exonerada.periodo}-01`,
			total: exonerada.tarifa,
			corridaCreacion: 1,
		}, '2026-10-13T08:00:00')

		const corrida = await correrActualizacionDePagadas(almacen, SIN_ESPERA)

		const { de } = lineasDe(almacen, corrida.corridaId)
		assert.deepEqual(de('exonerada').map(linea => linea.facturaId), [facturaId])
		assert.equal(de('marcada_pagada').length, 0)
		const fila = filas(almacen, 'SELECT estado, pagada_el FROM factura WHERE id = ?', facturaId)[0]
		assert.equal(fila?.estado, 'abierta', 'una exoneración no paga la factura')
		assert.equal(fila?.pagada_el, null)
	})

	it('la cuota fantasma del libro se ignora sin dejar rastro', async t => {
		const { sandbox, almacen } = await montar(t)
		await correrImportacion(almacen, SIN_ESPERA)
		await pagar(sandbox, { id_contrato: 900101 })

		const corrida = await correrActualizacionDePagadas(almacen, SIN_ESPERA)

		const { detalle } = lineasDe(almacen, corrida.corridaId)
		assert.ok(!detalle.lineas.some(linea => linea.deudaId === '7000001'),
			'la cuota 2025-08 solo existe en el libro: no es una factura de Cobrix')
		assert.equal(cuantas(almacen, 'factura', `deuda_id = '7000001'`), 0)
		assert.equal(detalle.lineas.filter(linea => linea.contratoId === 900101).length, 3,
			'ANA PEREZ tiene 3 facturas y produce 3 líneas')
	})

	it('si la cuota no está en el libro pero el contrato la sigue debiendo: abierta sin cobro', async t => {
		const { almacen } = await montar(t)
		await correrImportacion(almacen, SIN_ESPERA)
		const sinLaCuotaDelMes = recortarLibro(['7000010'])

		const corrida = await correrActualizacionDePagadas(almacen, {
			opcionesCliente: { ...SIN_ESPERA.opcionesCliente, fetch: sinLaCuotaDelMes.fetch },
		})

		const { de } = lineasDe(almacen, corrida.corridaId)
		assert.equal(de('abierta_sin_cobro').length, 1)
		assert.equal(de('abierta_sin_cobro')[0]?.deudaId, '7000010')
		assert.equal(de('sin_evidencia').length, 0, 'el contrato la reporta pendiente: jamás sin evidencia')
		assert.equal(sinLaCuotaDelMes.contratosPedidos().length, 1,
			'el contrato se consulta una sola vez, no una por factura')
		assert.equal(cuantas(almacen, 'factura', `deuda_id = '7000010' AND estado = 'abierta'`), 1)
	})

	it('si no está en el libro ni pendiente en el contrato: sin evidencia, y no se toca', async t => {
		const { almacen } = await montar(t)
		await correrImportacion(almacen, SIN_ESPERA)
		const desaparecida = recortarLibro(['7000010'], ['7000010'])

		const corrida = await correrActualizacionDePagadas(almacen, {
			opcionesCliente: { ...SIN_ESPERA.opcionesCliente, fetch: desaparecida.fetch },
		})

		const { de } = lineasDe(almacen, corrida.corridaId)
		assert.equal(de('sin_evidencia').length, 1)
		assert.equal(de('sin_evidencia')[0]?.deudaId, '7000010')
		assert.equal(de('marcada_pagada').length, 0)
		assert.equal(cuantas(almacen, 'factura', `estado = 'pagada'`), 0, 'sin evidencia nunca se marca pagada')
	})

	it('un libro que se contradice consigo mismo deja la factura intacta', async t => {
		const { sandbox, almacen } = await montar(t)
		await correrImportacion(almacen, SIN_ESPERA)
		await pagar(sandbox, { id_contrato: 900101 })
		// La cuota 7000008 tiene dos filas (el abono viejo y el cobro de hoy): se altera una.
		const contradictorio: typeof globalThis.fetch = async (entrada, init) => {
			const respuesta = await globalThis.fetch(entrada, init)
			const url = String(entrada)
			if (!url.includes('pago_informacion') || !url.includes('id_contrato=900101')) return respuesta
			const cuerpo = await respuesta.json() as { data: Array<Record<string, unknown>> }
			let tocada = false
			const data = cuerpo.data.map(fila => {
				const detalle = fila.detalle_pago as Record<string, unknown>
				if (tocada || comoEntero(detalle.id_cuota) !== 7000008) return fila
				tocada = true
				return { ...fila, detalle_pago: { ...detalle, saldo_cuota: 7 } }
			})
			assert.ok(tocada, 'la cuota 7000008 tiene que estar en el libro para poder contradecirla')
			return new Response(JSON.stringify({ ...cuerpo, data }), {
				status: 200, headers: { 'content-type': 'application/json' },
			})
		}

		const corrida = await correrActualizacionDePagadas(almacen, {
			opcionesCliente: { ...SIN_ESPERA.opcionesCliente, fetch: contradictorio },
		})

		const { de } = lineasDe(almacen, corrida.corridaId)
		assert.equal(de('inconsistente').length, 1)
		assert.equal(de('inconsistente')[0]?.deudaId, '7000008')
		assert.equal(cuantas(almacen, 'factura', `deuda_id = '7000008' AND estado = 'abierta'`), 1)
		assert.equal(de('marcada_pagada').length, 2, 'las otras dos cuotas de ANA PEREZ sí se cobraron')
	})

	it('un libro ilegible no es «no pagada» ni «sin evidencia»: las facturas quedan intactas', async t => {
		const { almacen } = await montar(t)
		await correrImportacion(almacen, SIN_ESPERA)
		// El libro de un contrato responde por otro: `api/lectura.ts` lo rechaza entero.
		const ajeno: typeof globalThis.fetch = async (entrada, init) => {
			const respuesta = await globalThis.fetch(entrada, init)
			const url = String(entrada)
			if (!url.includes('pago_informacion') || !url.includes('id_contrato=900101')) return respuesta
			const cuerpo = await respuesta.json() as { data: Array<Record<string, unknown>> }
			const data = cuerpo.data.map(fila => ({ ...fila, id_contrato: 900999, detalle_pago: { ...(fila.detalle_pago as Record<string, unknown>), id_contrato: 900999 } }))
			return new Response(JSON.stringify({ ...cuerpo, data }), {
				status: 200, headers: { 'content-type': 'application/json' },
			})
		}

		const corrida = await correrActualizacionDePagadas(almacen, {
			opcionesCliente: { ...SIN_ESPERA.opcionesCliente, fetch: ajeno },
		})

		assert.equal(corrida.estado, 'completada', 'el resto de los contratos se revisa igual')
		const { de } = lineasDe(almacen, corrida.corridaId)
		assert.equal(de('inconsistente').length, 3, 'las 3 facturas de ANA PEREZ, sin concluir nada')
		assert.ok(de('inconsistente').every(linea => linea.contratoId === 900101))
		assert.equal(de('sin_evidencia').length, 0, 'no se confunde «no pude leer» con «no existe»')
		assert.equal(cuantas(almacen, 'factura', `estado = 'pagada'`), 0)
		const motivo = leerCorrida(almacen, corrida.corridaId)?.lineas.find(linea => linea.resultado === 'inconsistente')?.motivo
		assert.match(String(motivo), /no se pudo leer/)
	})

	it('si el ISP anula un cobro viejo, la cuota debe más que Cobrix y sigue abierta', async t => {
		const { sandbox, almacen } = await montar(t)
		await correrImportacion(almacen, SIN_ESPERA)
		// 8800007 es el abono de USD 5,00 que ANA PEREZ tenía cuando se importó (saldo 20).
		await anular(sandbox, 8_800_007)

		const corrida = await correrActualizacionDePagadas(almacen, SIN_ESPERA)

		const { de } = lineasDe(almacen, corrida.corridaId)
		assert.equal(de('saldo_aumentado').length, 1)
		assert.equal(de('saldo_aumentado')[0]?.deudaId, '7000008')
		const fila = filas(almacen, `SELECT estado, saldo FROM factura WHERE deuda_id = '7000008'`)[0]
		assert.equal(fila?.estado, 'abierta')
		assert.equal(comoEntero(fila?.saldo), 2_000, 'Cobrix no reescribe el saldo: solo informa')
	})
})

/**
 * Un `fetch` que esconde cuotas: del libro siempre y, si se le pide, también de
 * `contrato/individual`. Reproduce lo que el administrador hace de verdad (una cuota que todavía
 * no está en el libro) sin tener que tocar su base.
 */
function recortarLibro(fueraDelLibro: readonly string[], fueraDelContrato: readonly string[] = []) {
	const contratosPedidos: string[] = []
	const fetch: typeof globalThis.fetch = async (entrada, init) => {
		const respuesta = await globalThis.fetch(entrada, init)
		const url = String(entrada)
		if (url.includes('pago_informacion')) {
			const cuerpo = await respuesta.json() as { data: Array<Record<string, unknown>> }
			const data = cuerpo.data.filter(fila => {
				const detalle = fila.detalle_pago as Record<string, unknown>
				return !fueraDelLibro.includes(String(comoEntero(detalle.id_cuota)))
			})
			return new Response(JSON.stringify({ ...cuerpo, data }), {
				status: 200, headers: { 'content-type': 'application/json' },
			})
		}
		if (url.includes('contrato/individual')) {
			contratosPedidos.push(url)
			if (fueraDelContrato.length === 0) return respuesta
			const cuerpo = await respuesta.json() as Array<Record<string, unknown>>
			const data = cuerpo.filter(fila => !fueraDelContrato.includes(String(fila.deuda_id)))
			return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } })
		}
		return respuesta
	}
	return { fetch, contratosPedidos: () => contratosPedidos }
}

describe('la corrida de pagadas ante un ISP que falla', () => {
	it('con credenciales malas queda fallida y no marca ninguna factura', async t => {
		const { sandbox, almacen } = await montar(t, 'contraseña-equivocada')
		// Se importa con las credenciales buenas y luego se corre pagadas con las malas.
		guardarProveedor(almacen, { ...PROVEEDOR_POR_DEFECTO, apiUrl: sandbox.apiUrl, usuario: USUARIO, password: PASSWORD })
		await correrImportacion(almacen, SIN_ESPERA)
		await pagar(sandbox, { id_contrato: 900101 })
		guardarProveedor(almacen, { ...PROVEEDOR_POR_DEFECTO, apiUrl: sandbox.apiUrl, usuario: USUARIO, password: 'mala' })
		const antes = todasLasFacturas(almacen)

		const corrida = await correrActualizacionDePagadas(almacen, SIN_ESPERA)

		assert.equal(corrida.estado, 'fallida')
		assert.equal(corrida.error?.codigo, 'credenciales')
		assert.equal(corrida.error?.endpoint, 'usuario/login')
		assert.equal(corrida.error?.status, 400)
		assert.deepEqual(todasLasFacturas(almacen), antes, 'un fallo de la API no marca nada')
		assert.equal(leerCorrida(almacen, corrida.corridaId)?.estado, 'fallida')
	})

	it('un 503 persistente deja la corrida fallida, con su endpoint, y nada marcado', async t => {
		const { sandbox, almacen } = await montar(t)
		await correrImportacion(almacen, SIN_ESPERA)
		await pagar(sandbox, { id_contrato: 900101 })
		const antes = todasLasFacturas(almacen)
		const caido: typeof globalThis.fetch = async (entrada, init) => {
			const url = String(entrada)
			if (url.includes('usuario/login')) return await globalThis.fetch(entrada, init)
			return new Response(JSON.stringify({ detail: 'el administrador se cayó' }), {
				status: 503, headers: { 'content-type': 'application/json' },
			})
		}

		const corrida = await correrActualizacionDePagadas(almacen, {
			opcionesCliente: { ...SIN_ESPERA.opcionesCliente, fetch: caido },
		})

		assert.equal(corrida.estado, 'fallida')
		assert.equal(corrida.error?.codigo, 'http')
		assert.equal(corrida.error?.status, 503)
		assert.equal(corrida.error?.endpoint, 'isp/pago_informacion')
		assert.deepEqual(todasLasFacturas(almacen), antes)
		assert.equal(cuantas(almacen, 'evento', `tipo = 'factura_pagada'`), 0)
	})

	it('sin contraseña guardada la corrida no arranca y no se registra', async t => {
		const { almacen } = await montar(t, null)

		await assert.rejects(() => correrActualizacionDePagadas(almacen, SIN_ESPERA), ProveedorSinCredenciales)
		assert.equal(listarCorridas(almacen).length, 0)
	})
})

describe('el cliente que paga todo sigue poniéndose al día', () => {
	it('un contrato sin deuda («deuda_id 0») se refresca, y refrescar nunca inserta', async t => {
		const { sandbox, almacen } = await montar(t)
		await correrImportacion(almacen, SIN_ESPERA)
		await pagar(sandbox, { id_contrato: 900101 })
		await correrActualizacionDePagadas(almacen, SIN_ESPERA)
		assert.equal(cuantas(almacen, 'factura', `contrato_id = 900101 AND estado = 'abierta'`), 0,
			'ANA PEREZ ya no debe nada: su contrato responde la fila «deuda_id 0»')

		// Datos viejos en Cobrix y una importación después: el contrato al día tiene que refrescarse.
		almacen.db.prepare(`UPDATE contrato SET estado = 'DATO VIEJO', plan = 'PLAN VIEJO' WHERE id = 900101`).run()
		almacen.db.prepare(`UPDATE cliente SET nombre = 'NOMBRE VIEJO' WHERE id = 'V12345678'`).run()

		const segunda = await correrImportacion(almacen, SIN_ESPERA)

		assert.equal(segunda.contadores.facturasNuevas, 0, 'no hay nada nuevo que importar')
		const contrato = filas(almacen, 'SELECT estado, plan FROM contrato WHERE id = 900101')[0]
		assert.equal(contrato?.estado, 'ACTIVO', 'el contrato al día también se pone al día')
		assert.equal(contrato?.plan, 'PLAN15MB25')
		assert.equal(filas(almacen, `SELECT nombre FROM cliente WHERE id = 'V12345678'`)[0]?.nombre, 'ANA PEREZ')

		// Y el límite intocable: LAURA MENDEZ (ACTIVO, sin deuda jamás) no puede entrar.
		assert.equal(cuantas(almacen, 'cliente', `nombre = 'LAURA MENDEZ'`), 0)
		assert.equal(cuantas(almacen, 'contrato', 'id = 900109'), 0)
		assert.equal(cuantas(almacen, 'cliente'), 20)
	})
})
