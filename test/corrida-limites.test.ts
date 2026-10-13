/**
 * Los límites de la configuración (ENUNCIADO.md §3.1), a nivel de CORRIDA COMPLETA.
 *
 * `test/dominio-importacion.test.ts` ya prueba cada regla como función pura y
 * `test/corrida-importacion.test.ts` corre siempre con la configuración por defecto. Lo que
 * falta —y es lo que protege estos parámetros mientras se escriben las corridas que vienen— es
 * que cada límite se cumpla de punta a punta: API simulada, clasificación, topes y base.
 *
 * Los números están verificados contra la base entregada con `SANDBOX_TODAY=2026-10-13`. Dos de
 * las comprobaciones no son contables y son las que de verdad fijan la regla:
 *   - con `maxCuotasRecientes`, lo conservado es MÁS RECIENTE que lo frenado, contrato a contrato;
 *   - con `topeMonto`, la corrida SE DETIENE en vez de rellenar el hueco con cuotas más baratas
 *     (la decisión deliberada que documenta `aplicarTopes`).
 */

import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { abrirAlmacen, comoEntero, type Almacen } from '../src/cobrix/almacen/base.ts'
import { guardarProveedor } from '../src/cobrix/almacen/configuracion.ts'
import { correrImportacion } from '../src/cobrix/corridas/importacion.ts'
import { PROVEEDOR_POR_DEFECTO, type Proveedor } from '../src/cobrix/dominio/configuracion.ts'
import { levantarSandbox, PASSWORD, USUARIO, type Sandbox } from './apoyo/sandbox.ts'

process.env.SANDBOX_TODAY = '2026-10-13'

const SIN_ESPERA = { opcionesCliente: { dormir: async () => {}, esperas: [0, 0, 0] } }

type Parametro = string | number | null

function filas(almacen: Almacen, sql: string, ...parametros: Parametro[]): Array<Record<string, unknown>> {
	return almacen.db.prepare(sql).all(...parametros) as Array<Record<string, unknown>>
}

const textos = (lista: Array<Record<string, unknown>>, columna: string): string[] =>
	lista.map(fila => String(fila[columna]))

const sumaDe = (cuotas: Readonly<Record<string, number>>): number =>
	Object.values(cuotas).reduce((total, valor) => total + valor, 0)

describe('límites de la configuración, de punta a punta', () => {
	let sandbox: Sandbox

	before(async () => {
		sandbox = await levantarSandbox()
	})
	after(async () => {
		await sandbox.cerrar()
	})

	/** Cobrix vacío con la configuración por defecto más el límite que se está probando. */
	function almacenCon(cambios: Partial<Proveedor> = {}): Almacen {
		const almacen = abrirAlmacen({ ruta: ':memory:' })
		guardarProveedor(almacen, {
			...PROVEEDOR_POR_DEFECTO,
			apiUrl: sandbox.apiUrl,
			usuario: USUARIO,
			password: PASSWORD,
			...cambios,
		})
		return almacen
	}

	it('ventana de 3 meses: MIGUEL ANGEL SOTO pierde sus 4 cuotas más viejas', async () => {
		const almacen = almacenCon({ ventanaMeses: 3 })
		const corrida = await correrImportacion(almacen, SIN_ESPERA)
		const contadores = corrida.contadores

		assert.equal(contadores.facturasNuevas, 38, '42 menos las 4 que quedan fuera de la ventana')
		assert.equal(contadores.montoNuevo, 109_500, '123500 menos 4 cuotas de USD 35,00')
		assert.equal(contadores.cuotas.fuera_de_ventana, 4, 'solo SOTO tiene cuotas más viejas que la ventana')
		assert.equal(sumaDe(contadores.cuotas), contadores.cuotasVistas, 'cada cuota vista sigue teniendo su línea')

		const fuera = filas(almacen,
			`SELECT periodo FROM corrida_linea WHERE contrato_id = 900114 AND resultado = 'fuera_de_ventana' ORDER BY periodo`)
		assert.deepEqual(textos(fuera, 'periodo'), ['2026-03', '2026-04', '2026-05', '2026-06'])
		const dentro = filas(almacen, 'SELECT periodo FROM factura WHERE contrato_id = 900114 ORDER BY periodo')
		assert.deepEqual(textos(dentro, 'periodo'), ['2026-07', '2026-08', '2026-09', '2026-10'])
		almacen.cerrar()
	})

	it('máximo de 2 recientes por contrato: se conservan las más nuevas, no las primeras que llegan', async () => {
		const almacen = almacenCon({ maxCuotasRecientes: 2 })
		const corrida = await correrImportacion(almacen, SIN_ESPERA)
		const contadores = corrida.contadores

		assert.equal(contadores.facturasNuevas, 30)
		assert.equal(contadores.cuotas.limite_recientes, 12, '42 menos las 30 que caben')
		assert.equal(sumaDe(contadores.cuotas), contadores.cuotasVistas)

		const excedidos = filas(almacen,
			'SELECT contrato_id, COUNT(*) AS n FROM factura GROUP BY contrato_id HAVING n > 2')
		assert.deepEqual(excedidos, [], 'ningún contrato supera el máximo')

		// Lo que un conteo no prueba: por cada contrato, lo importado es más reciente que lo frenado.
		const contratos = filas(almacen, 'SELECT DISTINCT contrato_id FROM factura ORDER BY contrato_id')
		let comparados = 0
		for (const fila of contratos) {
			const contratoId = comoEntero(fila.contrato_id)
			const conservadas = textos(filas(almacen, 'SELECT periodo FROM factura WHERE contrato_id = ?', contratoId), 'periodo')
			const frenadas = textos(filas(almacen,
				`SELECT periodo FROM corrida_linea WHERE contrato_id = ? AND resultado = 'limite_recientes'`, contratoId), 'periodo')
			if (frenadas.length === 0) continue
			comparados++
			const masViejaConservada = conservadas.reduce((a, b) => (a < b ? a : b))
			const masNuevaFrenada = frenadas.reduce((a, b) => (a > b ? a : b))
			assert.ok(masViejaConservada > masNuevaFrenada,
				`contrato ${contratoId}: conservó ${masViejaConservada} y frenó ${masNuevaFrenada}`)
		}
		assert.ok(comparados > 0, 'la comprobación no sirve si ningún contrato frenó cuotas')
		almacen.cerrar()
	})

	it('excluir el tipo J deja fuera a COMERCIAL EL FARO y solo a él', async () => {
		const almacen = almacenCon({ excluirTiposDocumento: ['J'] })
		const corrida = await correrImportacion(almacen, SIN_ESPERA)
		const contadores = corrida.contadores

		assert.equal(contadores.facturasNuevas, 40, '42 menos las 2 cuotas del titular jurídico')
		assert.equal(contadores.clientesNuevos, 19)
		assert.equal(sumaDe(contadores.cuotas), contadores.cuotasVistas)

		const juridicos = filas(almacen, `SELECT id FROM cliente WHERE id LIKE 'J%' OR persona = 'juridica'`)
		assert.deepEqual(juridicos, [], 'ningún cliente jurídico entra')
		assert.equal(comoEntero(filas(almacen, 'SELECT COUNT(*) AS n FROM cliente')[0]?.n), 19)

		const lineas = filas(almacen,
			`SELECT contrato_id, cuotas, motivo FROM corrida_linea WHERE resultado = 'tipo_documento_excluido'`)
		assert.equal(lineas.length, 1, 'una línea para el contrato completo')
		assert.equal(comoEntero(lineas[0]?.cuotas), 2)
		assert.equal(contadores.cuotas.tipo_documento_excluido, 2)
		assert.match(String(lineas[0]?.motivo), /Tipo de documento J excluido/)
		almacen.cerrar()
	})

	it('tope de 10 facturas: es por corrida, no por contrato, y el recorte es determinista', async () => {
		const primera = almacenCon({ topeFacturas: 10 })
		const corrida = await correrImportacion(primera, SIN_ESPERA)
		const contadores = corrida.contadores

		assert.equal(contadores.facturasNuevas, 10)
		assert.equal(comoEntero(filas(primera, 'SELECT COUNT(*) AS n FROM factura')[0]?.n), 10)
		assert.equal(contadores.cuotas.tope_facturas, 32, '42 menos las 10 que caben')
		assert.equal(sumaDe(contadores.cuotas), contadores.cuotasVistas)

		const contratos = comoEntero(filas(primera, 'SELECT COUNT(DISTINCT contrato_id) AS n FROM factura')[0]?.n)
		assert.equal(contratos, 4, 'las 10 se reparten entre 4 contratos: el tope es de la corrida')

		const unas = textos(filas(primera, 'SELECT deuda_id FROM factura ORDER BY deuda_id'), 'deuda_id')
		primera.cerrar()

		const segunda = almacenCon({ topeFacturas: 10 })
		await correrImportacion(segunda, SIN_ESPERA)
		const otras = textos(filas(segunda, 'SELECT deuda_id FROM factura ORDER BY deuda_id'), 'deuda_id')
		assert.deepEqual(otras, unas, 'la misma base frena exactamente las mismas cuotas')
		segunda.cerrar()
	})

	it('tope de monto: la corrida se detiene en el tope, no rellena el hueco con cuotas más baratas', async () => {
		const TOPE = 30_000
		const almacen = almacenCon({ topeMonto: TOPE })
		const corrida = await correrImportacion(almacen, SIN_ESPERA)
		const contadores = corrida.contadores

		assert.equal(contadores.montoNuevo, 27_000)
		assert.equal(contadores.facturasNuevas, 9)
		assert.ok(contadores.montoNuevo <= TOPE)
		assert.equal(sumaDe(contadores.cuotas), contadores.cuotasVistas)
		assert.ok((contadores.cuotas.tope_monto ?? 0) > 0)

		// La prueba de que paró en vez de rellenar: quedan frenadas cuotas que cabían en el hueco.
		const hueco = TOPE - contadores.montoNuevo
		assert.equal(hueco, 3_000)
		const cabrian = filas(almacen,
			`SELECT deuda_id, monto FROM corrida_linea WHERE resultado = 'tope_monto' AND monto <= ?`, hueco)
		assert.equal(cabrian.length, 21, 'se frenaron 21 cuotas que habrían cabido: la corrida se detuvo')
		almacen.cerrar()
	})

	it('días de gracia: mueven la fecha de corte y jamás el vencimiento', async () => {
		const sinGracia = almacenCon()
		await correrImportacion(sinGracia, SIN_ESPERA)
		const base = filas(sinGracia, 'SELECT deuda_id, vence_el, corta_el FROM factura ORDER BY deuda_id')
		assert.equal(base.length, 42)
		assert.ok(base.every(fila => fila.corta_el === fila.vence_el), 'sin gracia, el corte es el vencimiento')
		sinGracia.cerrar()

		const conGracia = almacenCon({ diasGracia: 5 })
		await correrImportacion(conGracia, SIN_ESPERA)
		const gracia = filas(conGracia, 'SELECT deuda_id, vence_el, corta_el FROM factura ORDER BY deuda_id')

		assert.equal(gracia.length, 42)
		assert.deepEqual(textos(gracia, 'vence_el'), textos(base, 'vence_el'), 'la gracia no mueve el vencimiento')
		const dias = (desde: string, hasta: string): number =>
			(Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000
		const mal = gracia.filter(fila => dias(String(fila.vence_el), String(fila.corta_el)) !== 5)
		assert.deepEqual(mal, [], 'las 42 cortan exactamente cinco días después de vencer')
		conGracia.cerrar()
	})

	it('concurrencia 1 da el mismo resultado que 4, hasta el orden de las líneas', async () => {
		const COLUMNAS_FACTURA = 'deuda_id, cliente_id, contrato_id, periodo, vence_el, corta_el, total, saldo, estado'
		const COLUMNAS_LINEA = 'contrato_id, deuda_id, periodo, monto, cuotas, resultado, motivo'
		const sinFechas = (cliente: Record<string, unknown>): Record<string, unknown> =>
			({ ...cliente, creado_en: null, visto_en: null })

		const unaPorVez = almacenCon()
		const serie = await correrImportacion(unaPorVez, { ...SIN_ESPERA, concurrencia: 1 })
		const facturasSerie = filas(unaPorVez, `SELECT ${COLUMNAS_FACTURA} FROM factura ORDER BY deuda_id`)
		const lineasSerie = filas(unaPorVez, `SELECT ${COLUMNAS_LINEA} FROM corrida_linea ORDER BY id`)
		const clientesSerie = filas(unaPorVez, 'SELECT * FROM cliente ORDER BY id').map(sinFechas)
		unaPorVez.cerrar()

		const enParalelo = almacenCon()
		const paralelo = await correrImportacion(enParalelo, SIN_ESPERA)
		const facturasParalelo = filas(enParalelo, `SELECT ${COLUMNAS_FACTURA} FROM factura ORDER BY deuda_id`)
		const lineasParalelo = filas(enParalelo, `SELECT ${COLUMNAS_LINEA} FROM corrida_linea ORDER BY id`)
		const clientesParalelo = filas(enParalelo, 'SELECT * FROM cliente ORDER BY id').map(sinFechas)
		enParalelo.cerrar()

		assert.deepEqual(serie.contadores, paralelo.contadores)
		assert.deepEqual(facturasSerie, facturasParalelo)
		assert.deepEqual(lineasSerie, lineasParalelo, 'las 54 líneas, en el mismo orden')
		assert.equal(lineasSerie.length, 54)
		assert.deepEqual(clientesSerie, clientesParalelo)
	})
})
