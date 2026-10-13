/**
 * API JSON del panel (docs/SPEC.md §3.8): cada endpoint con un caso válido y uno inválido.
 *
 * Lo que más importa aquí no son los 200: son el `409` del cerrojo, la contraseña que no sale en
 * ninguna respuesta, el formato único de error y el SSE que entrega eventos y cierra. El contrato
 * que se verifica es `web/src/tipos/panel.ts`, en snake_case y con los instantes con desfase.
 */

import assert from 'node:assert/strict'
import { describe, it, type TestContext } from 'node:test'

import { abrirAlmacen, type Almacen } from '../src/cobrix/almacen/base.ts'
import { guardarEmpresa, guardarProveedor } from '../src/cobrix/almacen/configuracion.ts'
import { abrirCorrida, cerrarCorrida } from '../src/cobrix/almacen/corridas.ts'
import { crearServidorPanel, type ServidorPanel } from '../src/cobrix/http/servidor.ts'
import { PROVEEDOR_POR_DEFECTO } from '../src/cobrix/dominio/configuracion.ts'
import { levantarSandbox, PASSWORD, USUARIO, type Sandbox } from './apoyo/sandbox.ts'

process.env.SANDBOX_TODAY = '2026-10-13'

const SIN_ESPERA = { dormir: async () => {}, esperas: [0, 0, 0] }
const INSTANTE_CON_DESFASE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-04:00$/

interface Montaje {
	readonly sandbox: Sandbox
	readonly almacen: Almacen
	readonly panel: ServidorPanel
	readonly base: string
}

async function montar(t: TestContext, opciones: { password?: string | null; empresa?: boolean } = {}): Promise<Montaje> {
	const sandbox = await levantarSandbox()
	assert.ok(!sandbox.raiz.includes(':4310'), 'el sandbox tiene que estar en un puerto efímero propio')
	const almacen = abrirAlmacen({ ruta: ':memory:' })
	if (opciones.empresa !== false) {
		guardarEmpresa(almacen, { nombre: 'Cobrix', rif: 'J-40000000-0', emailCobranza: 'cobranza@cobrix.test' })
	}
	guardarProveedor(almacen, {
		...PROVEEDOR_POR_DEFECTO,
		apiUrl: sandbox.apiUrl,
		usuario: USUARIO,
		password: opciones.password === undefined ? PASSWORD : opciones.password,
	})
	const panel = crearServidorPanel({ almacen, opcionesCliente: SIN_ESPERA })
	const base = `http://127.0.0.1:${await panel.escuchar(0)}`
	t.after(async () => {
		await panel.cerrar()
		almacen.cerrar()
		await sandbox.cerrar()
	})
	return { sandbox, almacen, panel, base }
}

type Json = Record<string, unknown>

async function pedir(base: string, ruta: string, init?: RequestInit): Promise<{ status: number; cuerpo: Json }> {
	const respuesta = await fetch(`${base}${ruta}`, init)
	const texto = await respuesta.text()
	return { status: respuesta.status, cuerpo: texto === '' ? {} : JSON.parse(texto) as Json }
}

const enviar = (cuerpo: unknown, metodo = 'POST'): RequestInit => ({
	method: metodo,
	headers: { 'content-type': 'application/json' },
	body: JSON.stringify(cuerpo),
})

/** Importa de verdad, esperando a que la corrida termine. */
async function importar(base: string): Promise<number> {
	const creada = await pedir(base, '/api/corridas', enviar({ tipo: 'importacion', simulacion: false }))
	assert.equal(creada.status, 201)
	const id = creada.cuerpo.id as number
	await esperarCierre(base, id)
	return id
}

async function esperarCierre(base: string, id: number): Promise<Json> {
	for (let intento = 0; intento < 200; intento++) {
		const { cuerpo } = await pedir(base, `/api/corridas/${id}`)
		if (cuerpo.estado !== 'en_curso') return cuerpo
		await new Promise(listo => setTimeout(listo, 25))
	}
	throw new Error(`la corrida ${id} no cerró`)
}

describe('resumen y salud', () => {
	it('el resumen trae totales, proveedor, automático y el reloj del sandbox', async t => {
		const { base } = await montar(t)
		await importar(base)

		const { status, cuerpo } = await pedir(base, '/api/resumen')

		assert.equal(status, 200)
		assert.deepEqual(cuerpo.totales, {
			clientes: 20,
			contratos: 21,
			contratos_leidos_ultima_corrida: 27,
			facturas_abiertas: 42,
			facturas_pagadas: 0,
			por_cobrar_centavos: 123_500,
		})
		assert.deepEqual(cuerpo.sandbox, { hoy: '2026-10-13', periodo_actual: '2026-10' })
		const automatico = cuerpo.automatico as Json
		assert.equal(automatico.activa, false)
		assert.equal(automatico.zona, 'America/Caracas')
		assert.equal(automatico.proxima_ejecucion, null, 'apagado: no hay próxima ejecución')
		assert.equal((cuerpo.ultimas_corridas as Json[]).length, 1)
		const corrida = (cuerpo.ultimas_corridas as Json[])[0]!
		assert.match(String(corrida.inicio), INSTANTE_CON_DESFASE)
		assert.ok(typeof corrida.duracion_ms === 'number' && corrida.duracion_ms >= 0)
		assert.equal((cuerpo.empresa as Json).moneda, 'USD')
	})

	it('la salud dice la versión, la fecha del sandbox y el estado de la base', async t => {
		const { base } = await montar(t)

		const { status, cuerpo } = await pedir(base, '/api/salud')

		assert.equal(status, 200)
		assert.equal(cuerpo.version, '1.0.0')
		assert.deepEqual(cuerpo.base, { ok: true, clientes: 0, facturas: 0, corridas: 0 })
		assert.deepEqual(cuerpo.proveedor, {
			api_url: (cuerpo.proveedor as Json).api_url,
			usuario: 'cobrix',
			password_definida: true,
		})
		assert.equal(cuerpo.corrida_en_curso, null)
	})

	it('una ruta que no existe responde el formato único de error', async t => {
		const { base } = await montar(t)

		const { status, cuerpo } = await pedir(base, '/api/lo-que-sea')

		assert.equal(status, 404)
		const error = cuerpo.error as Json
		assert.deepEqual(Object.keys(error).sort(), ['codigo', 'endpoint', 'mensaje', 'status', 'sugerencia'])
		assert.equal(error.codigo, 'no_encontrado')
	})
})

describe('configuración', () => {
	it('se lee sin la contraseña y se guarda validada', async t => {
		const { base } = await montar(t)

		const leida = await pedir(base, '/api/configuracion')
		assert.equal(leida.status, 200)
		const proveedor = (leida.cuerpo.proveedor as Json)
		assert.equal(proveedor.password_definida, true)
		assert.equal(proveedor.password, undefined, 'la contraseña no viaja al panel')
		assert.ok(!JSON.stringify(leida.cuerpo).includes(PASSWORD), 'ni en claro ni escondida en otro campo')

		const guardada = await pedir(base, '/api/configuracion', enviar({
			empresa: { nombre: 'Cobrix C.A.', rif: 'J-40000000-0', email_cobranza: 'pagos@cobrix.test' },
			proveedor: { ...proveedor, dias_gracia: 5, ventana_meses: 6, tope_monto_centavos: 50_000 },
		}, 'PUT'))

		assert.equal(guardada.status, 200)
		assert.equal((guardada.cuerpo.empresa as Json).nombre, 'Cobrix C.A.')
		assert.equal((guardada.cuerpo.proveedor as Json).dias_gracia, 5)
		assert.equal((guardada.cuerpo.proveedor as Json).ventana_meses, 6)
		assert.equal((guardada.cuerpo.proveedor as Json).tope_monto_centavos, 50_000)
		assert.equal((guardada.cuerpo.proveedor as Json).password_definida, true, 'guardar sin contraseña no la borra')
	})

	it('rechaza una configuración inválida con el motivo, y no guarda nada', async t => {
		const { base } = await montar(t)

		const mala = await pedir(base, '/api/configuracion', enviar({
			empresa: { nombre: '', rif: '', email_cobranza: 'esto-no-es-un-correo' },
			proveedor: { api_url: 'ftp://nope', usuario: '', dias_gracia: 999, estados_importables: [] },
		}, 'PUT'))

		assert.equal(mala.status, 400)
		assert.equal((mala.cuerpo.error as Json).codigo, 'configuracion_invalida')
		assert.match(String((mala.cuerpo.error as Json).mensaje), /obligatorio/)
		const despues = await pedir(base, '/api/configuracion')
		assert.equal((despues.cuerpo.empresa as Json).nombre, 'Cobrix', 'la empresa no cambió')
		assert.equal((despues.cuerpo.proveedor as Json).dias_gracia, 0)
	})

	it('probar conexión dice cuántos contratos hay', async t => {
		const { base } = await montar(t)

		const { status, cuerpo } = await pedir(base, '/api/configuracion/probar-conexion', enviar({}))

		assert.equal(status, 200)
		assert.equal(cuerpo.ok, true)
		assert.equal(cuerpo.contratos, 27)
		assert.match(String(cuerpo.mensaje), /27 contratos/)
		assert.ok(typeof cuerpo.latencia_ms === 'number')
	})

	it('con credenciales malas responde ok:false con el error de la API, no una excepción', async t => {
		const { base } = await montar(t, { password: 'mala' })

		const { status, cuerpo } = await pedir(base, '/api/configuracion/probar-conexion', enviar({}))

		assert.equal(status, 200, 'la pregunta se contestó: no conecta')
		assert.equal(cuerpo.ok, false)
		const error = cuerpo.error as Json
		assert.equal(error.codigo, 'credenciales')
		assert.equal(error.status, 400)
		assert.match(String(error.sugerencia), /Configuración/)
	})

	it('sin contraseña guardada lo dice sin llamar al administrador', async t => {
		const { base } = await montar(t, { password: null })

		const { cuerpo } = await pedir(base, '/api/configuracion/probar-conexion', enviar({}))

		assert.equal(cuerpo.ok, false)
		assert.match(String(cuerpo.mensaje), /contraseña/)
		assert.equal((cuerpo.error as Json).codigo, 'credenciales')
	})
})

describe('corridas', () => {
	it('lanza una corrida, la registra y sirve su detalle con contadores y líneas', async t => {
		const { base } = await montar(t)

		const creada = await pedir(base, '/api/corridas', enviar({ tipo: 'importacion', simulacion: true }))
		assert.equal(creada.status, 201)
		assert.deepEqual(creada.cuerpo, { id: creada.cuerpo.id, tipo: 'importacion', simulacion: true })

		const detalle = await esperarCierre(base, creada.cuerpo.id as number)
		assert.equal(detalle.estado, 'completada')
		assert.equal(detalle.simulacion, true)
		assert.match(String(detalle.resumen), /Simulación/)
		assert.match(String(detalle.inicio), INSTANTE_CON_DESFASE)

		const contadores = detalle.contadores as Json[]
		const destacados = contadores.filter(contador => contador.destacado === true)
		assert.deepEqual(destacados.map(contador => contador.clave),
			['facturasNuevas', 'montoNuevo', 'clientesNuevos', 'cuotasExcluidas'])
		assert.equal(destacados.find(contador => contador.clave === 'montoNuevo')?.tipo, 'dinero')
		assert.equal(contadores.find(contador => contador.clave === 'cuotas.importada')?.valor, 42)

		const lineas = detalle.lineas as Json[]
		assert.equal(lineas.length, 54)
		assert.ok(lineas.every(linea => Array.isArray(linea.traza) && (linea.traza as unknown[]).length > 0))
		assert.deepEqual(detalle.config_snapshot, {
			estados_importables: ['ACTIVO', 'CORTADO'],
			ventana_meses: null,
			max_cuotas_recientes: null,
			dias_gracia: 0,
			tope_facturas: null,
			tope_monto_centavos: null,
			excluir_tipos_documento: [],
		})

		// El acta: una línea de un contrato que no se importa trae el nombre del titular aunque
		// no haya cliente en Cobrix al que enlazar.
		const excluida = lineas.find(linea => linea.resultado === 'excluida_estado')
		assert.ok(excluida)
		assert.equal(typeof excluida.cliente_nombre, 'string')
		assert.equal(excluida.cliente_id, null)
	})

	it('el historial pagina y el detalle filtra por resultado', async t => {
		const { base } = await montar(t)
		const id = await importar(base)

		const historial = await pedir(base, '/api/corridas?limite=1')
		assert.equal(historial.status, 200)
		assert.equal(historial.cuerpo.total, 1)
		assert.equal((historial.cuerpo.corridas as Json[]).length, 1)

		const filtrada = await pedir(base, `/api/corridas/${id}?resultado=importada`)
		const lineas = filtrada.cuerpo.lineas as Json[]
		assert.equal(lineas.length, 42)
		assert.ok(lineas.every(linea => linea.resultado === 'importada'))
		assert.ok(lineas.every(linea => String(linea.factura_numero).startsWith('FAC-')))
	})

	it('rechaza un tipo de corrida que no existe y una corrida sin simulación', async t => {
		const { base } = await montar(t)

		const tipo = await pedir(base, '/api/corridas', enviar({ tipo: 'lo-que-sea', simulacion: false }))
		assert.equal(tipo.status, 400)
		assert.equal((tipo.cuerpo.error as Json).codigo, 'tipo_invalido')

		const sinSimulacion = await pedir(base, '/api/corridas', enviar({ tipo: 'importacion' }))
		assert.equal(sinSimulacion.status, 400)
		assert.equal((sinSimulacion.cuerpo.error as Json).codigo, 'simulacion_invalida')

		const noExiste = await pedir(base, '/api/corridas/9999')
		assert.equal(noExiste.status, 404)
		assert.equal((noExiste.cuerpo.error as Json).codigo, 'corrida_no_encontrada')
	})

	it('con una corrida real en curso, la siguiente responde 409', async t => {
		const { almacen, base } = await montar(t)
		const enCurso = abrirCorrida(almacen, {
			tipo: 'importacion', simulacion: false, disparo: 'manual', configuracion: null,
		})

		const choque = await pedir(base, '/api/corridas', enviar({ tipo: 'pagadas', simulacion: false }))

		assert.equal(choque.status, 409)
		assert.equal((choque.cuerpo.error as Json).codigo, 'corrida_en_curso')
		assert.match(String((choque.cuerpo.error as Json).sugerencia), /Espera/)

		cerrarCorrida(almacen, enCurso.id, { contadores: null, resumen: 'cerrada a mano' })
		const despues = await pedir(base, '/api/corridas', enviar({ tipo: 'importacion', simulacion: true }))
		assert.equal(despues.status, 201, 'liberado el cerrojo, la corrida arranca')
		await esperarCierre(base, despues.cuerpo.id as number)
	})

	it('sin contraseña configurada la corrida no arranca y lo explica', async t => {
		const { base } = await montar(t, { password: null })

		const { status, cuerpo } = await pedir(base, '/api/corridas', enviar({ tipo: 'importacion', simulacion: false }))

		assert.equal(status, 400)
		assert.equal((cuerpo.error as Json).codigo, 'proveedor_sin_credenciales')
		assert.match(String((cuerpo.error as Json).sugerencia), /Configuración/)
	})

	it('el método equivocado responde 405 con la cabecera `allow`', async t => {
		const { base } = await montar(t)

		const respuesta = await fetch(`${base}/api/resumen`, enviar({}, 'POST'))

		assert.equal(respuesta.status, 404, 'POST /api/resumen no es una ruta')
		const configuracion = await fetch(`${base}/api/configuracion`, enviar({}, 'DELETE'))
		assert.equal(configuracion.status, 405)
		assert.equal(configuracion.headers.get('allow'), 'GET, PUT')
	})
})

describe('progreso en vivo (SSE)', () => {
	it('entrega eventos de una corrida y cierra el stream al terminar', async t => {
		const { base } = await montar(t)

		const creada = await pedir(base, '/api/corridas', enviar({ tipo: 'importacion', simulacion: false }))
		const id = creada.cuerpo.id as number
		const respuesta = await fetch(`${base}/api/corridas/${id}/stream`)

		assert.equal(respuesta.status, 200)
		assert.match(respuesta.headers.get('content-type') ?? '', /text\/event-stream/)
		const eventos = await leerEventos(respuesta)

		assert.ok(eventos.length >= 2, `se esperaban varios eventos, llegaron ${eventos.length}`)
		assert.ok(eventos.every(evento => evento.corrida_id === id))
		const ultimo = eventos.at(-1)!
		assert.equal(ultimo.cerrada, true, 'el último evento cierra la corrida')
		assert.equal(ultimo.fase, 'Corrida cerrada')
		assert.equal(ultimo.contadores.importada, 42)
		assert.ok(eventos.some(evento => evento.ultimas.length > 0), 'las decisiones viajan en vivo')
		assert.ok(eventos.some(evento => evento.total === 27), 'el total son los contratos del administrador')
	})

	it('quien se conecta tarde recibe el cierre y nada más', async t => {
		const { base } = await montar(t)
		const id = await importar(base)

		const respuesta = await fetch(`${base}/api/corridas/${id}/stream`)
		const eventos = await leerEventos(respuesta)

		assert.equal(eventos.length, 1)
		assert.equal(eventos[0]!.cerrada, true)
		assert.equal(eventos[0]!.corrida_id, id)
	})

	it('el stream de una corrida que no existe cierra en vez de colgarse', async t => {
		const { base } = await montar(t)

		const eventos = await leerEventos(await fetch(`${base}/api/corridas/4242/stream`))

		assert.equal(eventos.length, 1)
		assert.equal(eventos[0]!.cerrada, true)
		assert.equal(eventos[0]!.fase, 'Corrida desconocida')
	})
})

/** Un evento del stream, con la forma de `ProgresoCorrida` de `web/src/tipos/panel.ts`. */
interface EventoSSE {
	readonly corrida_id: number
	readonly fase: string
	readonly procesados: number
	readonly total: number
	readonly contadores: Record<string, number>
	readonly ultimas: readonly Json[]
	readonly cerrada: boolean
}

/** Lee un stream SSE hasta que el servidor lo cierra. */
async function leerEventos(respuesta: Response): Promise<readonly EventoSSE[]> {
	const texto = await respuesta.text()
	return texto
		.split('\n\n')
		.map(bloque => bloque.replace(/^data: /, '').trim())
		.filter(bloque => bloque !== '')
		.map(bloque => JSON.parse(bloque) as EventoSSE)
}

describe('clientes y expediente', () => {
	it('la tabla trae los agregados de §3.5 y encuentra al titular de tres formas', async t => {
		const { base } = await montar(t)
		await importar(base)

		const todos = await pedir(base, '/api/clientes')
		assert.equal(todos.status, 200)
		assert.equal(todos.cuerpo.total, 20)
		assert.equal((todos.cuerpo.clientes as Json[]).length, 20)

		const luis = ((await pedir(base, '/api/clientes?q=gomez')).cuerpo.clientes as Json[])[0]
		assert.deepEqual(luis, {
			id: 'V9876543',
			nombre: 'LUIS GOMEZ',
			documento: 'V-9876543',
			persona: 'natural',
			contratos: 2,
			facturas_abiertas: 5,
			facturas_pagadas: 0,
			deuda_centavos: 11_500,
			vence_mas_antigua: '2026-07-01',
		})
		for (const termino of ['9876543', 'V-9876543', 'v9876543', 'GOMEZ']) {
			const encontrados = (await pedir(base, `/api/clientes?q=${encodeURIComponent(termino)}`)).cuerpo.clientes as Json[]
			assert.deepEqual(encontrados.map(cliente => cliente.id), ['V9876543'], termino)
		}
		const elena = (await pedir(base, '/api/clientes?q=09000123')).cuerpo.clientes as Json[]
		assert.deepEqual(elena.map(cliente => cliente.id), ['9000123'], 'los ceros a la izquierda se normalizan')

		const nadie = await pedir(base, '/api/clientes?q=zzzz')
		assert.equal(nadie.cuerpo.total, 0)
		assert.deepEqual(nadie.cuerpo.clientes, [])
	})

	it('el expediente trae datos, contratos, facturas e historial', async t => {
		const { base } = await montar(t)
		await importar(base)

		const { status, cuerpo } = await pedir(base, '/api/clientes/V12345678')

		assert.equal(status, 200)
		const cliente = cuerpo.cliente as Json
		assert.equal(cliente.nombre, 'ANA PEREZ')
		assert.equal(cliente.documento, 'V-12345678', 'el documento es el del administrador, no la clave')
		assert.match(String(cliente.creado_en), INSTANTE_CON_DESFASE)
		assert.deepEqual(cuerpo.totales, {
			deuda_centavos: 7_000, facturas_abiertas: 3, facturas_pagadas: 0, contratos: 1,
		})
		const contratos = cuerpo.contratos as Json[]
		assert.equal(contratos.length, 1)
		assert.equal(contratos[0]!.estado, 'ACTIVO')
		assert.equal(contratos[0]!.precio_centavos, 2_500)

		const facturas = cuerpo.facturas as Json[]
		assert.equal(facturas.length, 3)
		assert.match(String(facturas[0]!.numero), /^FAC-\d{6}$/)
		assert.match(String(facturas[0]!.descripcion), /PLAN15MB25 - 2026 /)
		assert.equal(facturas[0]!.estado, 'abierta')

		const historial = cuerpo.historial as Json[]
		assert.equal(historial.length, 4, 'el alta del cliente y sus 3 facturas importadas')
		assert.ok(historial.every(evento => typeof evento.titulo === 'string' && evento.titulo !== ''))
		assert.ok(historial.every(evento => INSTANTE_CON_DESFASE.test(String(evento.ocurrido_en))))
	})

	it('el historial se ordena por cuándo ocurrió en Cobrix, no por la fecha del ISP', async t => {
		const { sandbox, base } = await montar(t)
		await importar(base)
		// El ISP cobra hoy: su factura se emite con fecha del día, sin hora.
		await fetch(`${sandbox.raiz}/__sim/pagar`, enviar({ id_contrato: 900101 }))
		const pagadas = await pedir(base, '/api/corridas', enviar({ tipo: 'pagadas', simulacion: false }))
		await esperarCierre(base, pagadas.cuerpo.id as number)

		const { cuerpo } = await pedir(base, '/api/clientes/V12345678')
		const historial = cuerpo.historial as Json[]

		assert.deepEqual(historial.map(evento => evento.tipo), [
			'factura_pagada', 'factura_pagada', 'factura_pagada',
			'factura_importada', 'factura_importada', 'factura_importada',
			'cliente_creado',
		], 'el cobro es lo último que pasó; el alta, lo primero')
		assert.ok(historial.every(evento => INSTANTE_CON_DESFASE.test(String(evento.ocurrido_en))))
		// La fecha del ISP sigue siendo el dato del pago, en la factura.
		const facturas = cuerpo.facturas as Json[]
		assert.ok(facturas.every(factura => factura.pagada_el === '2026-10-13'))
		assert.ok(facturas.every(factura => String(factura.isp_factura_num).length > 0))
	})

	it('«contratos» se llama distinto en cada corrida, porque cuenta cosas distintas', async t => {
		const { sandbox, base } = await montar(t)
		const importacion = await importar(base)
		await fetch(`${sandbox.raiz}/__sim/pagar`, enviar({ id_contrato: 900101 }))
		const creada = await pedir(base, '/api/corridas', enviar({ tipo: 'pagadas', simulacion: false }))
		const pagadas = await esperarCierre(base, creada.cuerpo.id as number)

		const etiquetaDe = (detalle: Json): unknown =>
			(detalle.contadores as Json[]).find(contador => contador.clave === 'contratos')?.etiqueta
		const detalleImportacion = (await pedir(base, `/api/corridas/${importacion}`)).cuerpo

		assert.equal(etiquetaDe(detalleImportacion), 'Contratos leídos en el administrador')
		assert.equal(etiquetaDe(pagadas), 'Contratos con facturas abiertas')
		const valorImportacion = (detalleImportacion.contadores as Json[]).find(c => c.clave === 'contratos')?.valor
		const valorPagadas = (pagadas.contadores as Json[]).find(c => c.clave === 'contratos')?.valor
		assert.equal(valorImportacion, 27, 'la importación recorre todos los contratos del administrador')
		assert.equal(valorPagadas, 21, 'pagadas solo revisa los que tienen facturas abiertas')
	})

	it('un cliente que no existe responde 404 con una sugerencia', async t => {
		const { base } = await montar(t)

		const { status, cuerpo } = await pedir(base, '/api/clientes/V00000000')

		assert.equal(status, 404)
		assert.equal((cuerpo.error as Json).codigo, 'cliente_no_encontrado')
		assert.match(String((cuerpo.error as Json).sugerencia), /tabla de clientes/)
	})
})

describe('borrar los datos de Cobrix', () => {
	it('borra todo y devuelve qué borró, pero solo con confirmación', async t => {
		const { base } = await montar(t)
		await importar(base)

		const sinConfirmar = await pedir(base, '/api/datos/borrar', enviar({}))

		assert.equal(sinConfirmar.status, 400)
		assert.equal((sinConfirmar.cuerpo.error as Json).codigo, 'sin_confirmar')
		assert.match(String((sinConfirmar.cuerpo.error as Json).sugerencia), /Confirma/)
		assert.deepEqual((await pedir(base, '/api/salud')).cuerpo.base, { ok: true, clientes: 20, facturas: 42, corridas: 1 },
			'sin confirmar no se borra ni una fila')
	})

	it('con confirmación deja Cobrix vacío', async t => {
		const { base } = await montar(t)
		await importar(base)

		const { status, cuerpo } = await pedir(base, '/api/datos/borrar', enviar({ confirmar: true }))

		assert.equal(status, 200)
		assert.deepEqual(cuerpo.borrados, { clientes: 20, contratos: 21, facturas: 42, corridas: 1, eventos: 62 })
		const salud = await pedir(base, '/api/salud')
		assert.deepEqual(salud.cuerpo.base, { ok: true, clientes: 0, facturas: 0, corridas: 0 })
		assert.equal((await pedir(base, '/api/clientes')).cuerpo.total, 0)
	})

	it('no borra nada con una corrida real en curso', async t => {
		const { almacen, base } = await montar(t)
		await importar(base)
		abrirCorrida(almacen, { tipo: 'pagadas', simulacion: false, disparo: 'manual', configuracion: null })

		const { status, cuerpo } = await pedir(base, '/api/datos/borrar', enviar({ confirmar: true }))

		assert.equal(status, 409)
		assert.equal((cuerpo.error as Json).codigo, 'corrida_en_curso')
		assert.equal((await pedir(base, '/api/clientes')).cuerpo.total, 20, 'los clientes siguen ahí')
	})
})
