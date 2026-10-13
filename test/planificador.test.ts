/**
 * Corrida automática diaria (ENUNCIADO.md §3.1), con reloj inyectado: ninguna prueba espera un
 * minuto real. Lo que se verifica es lo que un operador espera de un automático: que dispare a su
 * hora, que encadene importar y pagadas en ese orden, que no repita el mismo día, que no fuerce
 * una corrida cuando hay otra en curso y que no haga nada si está apagado.
 */

import assert from 'node:assert/strict'
import { describe, it, type TestContext } from 'node:test'

import { abrirAlmacen, type Almacen } from '../src/cobrix/almacen/base.ts'
import { guardarProveedor } from '../src/cobrix/almacen/configuracion.ts'
import { abrirCorrida, leerCorrida, listarCorridas } from '../src/cobrix/almacen/corridas.ts'
import { totalesDeCartera } from '../src/cobrix/almacen/facturas.ts'
import { crearPlanificador } from '../src/cobrix/planificador.ts'
import { PROVEEDOR_POR_DEFECTO } from '../src/cobrix/dominio/configuracion.ts'
import { levantarSandbox, PASSWORD, USUARIO, type Sandbox } from './apoyo/sandbox.ts'

process.env.SANDBOX_TODAY = '2026-10-13'

/** El planificador registra cada intento en la consola; las pruebas no necesitan ese ruido. */
const SILENCIO = (): void => {}

interface Montaje {
	readonly sandbox: Sandbox
	readonly almacen: Almacen
}

async function montar(
	t: TestContext,
	proveedor: { autoActiva?: boolean; autoHora?: string | null; password?: string | null } = {},
): Promise<Montaje> {
	const sandbox = await levantarSandbox()
	const almacen = abrirAlmacen({ ruta: ':memory:' })
	guardarProveedor(almacen, {
		...PROVEEDOR_POR_DEFECTO,
		apiUrl: sandbox.apiUrl,
		usuario: USUARIO,
		password: proveedor.password === undefined ? PASSWORD : proveedor.password,
		autoActiva: proveedor.autoActiva ?? true,
		autoHora: proveedor.autoHora ?? '03:00',
	})
	t.after(async () => {
		almacen.cerrar()
		await sandbox.cerrar()
	})
	return { sandbox, almacen }
}

/** Un reloj que avanza a mano. */
function reloj(dia: string, hora: string) {
	let actual = { dia, hora }
	return {
		leer: () => actual,
		mover(nuevoDia: string, nuevaHora: string) {
			actual = { dia: nuevoDia, hora: nuevaHora }
		},
	}
}

describe('corrida automática', () => {
	it('a su hora importa y después actualiza pagadas, una sola vez al día', async t => {
		const { almacen } = await montar(t, { autoHora: '03:00' })
		const marcha = reloj('2026-10-13', '02:59')
		const planificador = crearPlanificador({ almacen, reloj: marcha.leer, registrar: SILENCIO })

		assert.equal(await planificador.tic(), null, 'antes de la hora no hace nada')

		marcha.mover('2026-10-13', '03:00')
		const ejecucion = await planificador.tic()

		assert.ok(ejecucion)
		assert.equal(ejecucion.omitida, null)
		assert.ok(ejecucion.importacion !== null && ejecucion.pagadas !== null)
		const importacion = leerCorrida(almacen, ejecucion.importacion)
		const pagadas = leerCorrida(almacen, ejecucion.pagadas)
		assert.equal(importacion?.tipo, 'importacion')
		assert.equal(importacion?.disparo, 'automatica')
		assert.equal(importacion?.simulacion, false)
		assert.equal(importacion?.estado, 'completada')
		assert.equal(pagadas?.tipo, 'pagadas')
		assert.equal(pagadas?.disparo, 'automatica')
		assert.ok(pagadas!.id > importacion!.id, 'primero importar, después pagadas')
		assert.deepEqual(totalesDeCartera(almacen), {
			clientes: 20, contratos: 21, abiertas: 42, pagadas: 0, porCobrar: 123_500, cobrado: 0,
		})

		marcha.mover('2026-10-13', '03:01')
		assert.equal(await planificador.tic(), null, 'el mismo día no se repite')
		assert.equal(listarCorridas(almacen).length, 2)

		marcha.mover('2026-10-14', '03:00')
		const siguiente = await planificador.tic()
		assert.ok(siguiente, 'al día siguiente vuelve a correr')
		assert.equal(siguiente.omitida, null)
		assert.equal(listarCorridas(almacen).length, 4)
	})

	it('apagado no hace nada, pase la hora que pase', async t => {
		const { almacen } = await montar(t, { autoActiva: false })
		const planificador = crearPlanificador({ almacen, reloj: () => ({ dia: '2026-10-13', hora: '23:59' }), registrar: SILENCIO })

		assert.equal(await planificador.tic(), null)
		assert.equal(listarCorridas(almacen).length, 0)
		assert.equal(planificador.ultima(), null)
	})

	it('con una corrida en curso se omite y dice por qué, sin forzar el cerrojo', async t => {
		const { almacen } = await montar(t, { autoHora: '03:00' })
		const enCurso = abrirCorrida(almacen, {
			tipo: 'importacion', simulacion: false, disparo: 'manual', configuracion: null,
		})
		const planificador = crearPlanificador({ almacen, reloj: () => ({ dia: '2026-10-13', hora: '03:00' }), registrar: SILENCIO })

		const ejecucion = await planificador.tic()

		assert.ok(ejecucion)
		assert.equal(ejecucion.omitida, 'corrida_en_curso')
		assert.match(ejecucion.detalle, new RegExp(`corrida ${enCurso.id}`))
		assert.equal(listarCorridas(almacen).length, 1, 'no abrió ninguna corrida nueva')
		assert.equal(totalesDeCartera(almacen).clientes, 0)
	})

	it('sin contraseña guardada se omite con su motivo, no con una excepción', async t => {
		const { almacen } = await montar(t, { password: null, autoHora: '03:00' })
		const planificador = crearPlanificador({ almacen, reloj: () => ({ dia: '2026-10-13', hora: '03:00' }), registrar: SILENCIO })

		const ejecucion = await planificador.tic()

		assert.ok(ejecucion)
		assert.equal(ejecucion.omitida, 'sin_credenciales')
		assert.match(ejecucion.detalle, /contraseña/)
		assert.equal(listarCorridas(almacen).length, 0)
	})

	it('arrancar y detener son idempotentes y no dejan el proceso colgado', async t => {
		const { almacen } = await montar(t, { autoActiva: false })
		const planificador = crearPlanificador({ almacen, intervaloMs: 10, registrar: SILENCIO })

		assert.equal(planificador.corriendo, false)
		planificador.arrancar()
		planificador.arrancar()
		assert.equal(planificador.corriendo, true)
		planificador.detener()
		planificador.detener()
		assert.equal(planificador.corriendo, false)
	})

	it('avisa de cada intento por `alEjecutar`, que es lo que el panel muestra', async t => {
		const { almacen } = await montar(t, { autoHora: '06:00' })
		const avisos: string[] = []
		const planificador = crearPlanificador({
			almacen,
			reloj: () => ({ dia: '2026-10-13', hora: '06:30' }),
			registrar: SILENCIO,
			alEjecutar: ejecucion => avisos.push(`${ejecucion.dia} ${ejecucion.hora} ${ejecucion.omitida ?? 'ok'}`),
		})

		await planificador.tic()

		assert.deepEqual(avisos, ['2026-10-13 06:30 ok'], 'una hora pasada también dispara: el tic pudo perderse')
		assert.equal(planificador.ultima()?.omitida, null)
	})
})
