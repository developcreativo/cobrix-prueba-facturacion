/**
 * Cliente HTTP del administrador: contra la API simulada para el comportamiento real y contra
 * un stub para los fallos que la API no provoca a pedido (401, 500, tiempos de espera).
 */

import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { crearCliente, ErrorApi, mensajeDeApi, vencimientoDelToken } from '../src/cobrix/api/cliente.ts'
import { levantarSandbox, levantarStub, PASSWORD, USUARIO, type Sandbox } from './apoyo/sandbox.ts'

process.env.SANDBOX_TODAY = '2026-10-13'

const SIN_ESPERA = { dormir: async () => {}, esperas: [0, 0, 0] }

describe('cliente contra la API simulada', () => {
	let sandbox: Sandbox

	before(async () => {
		sandbox = await levantarSandbox()
	})
	after(async () => {
		await sandbox.cerrar()
	})

	const cliente = () => crearCliente({ apiUrl: sandbox.apiUrl, usuario: USUARIO, password: PASSWORD }, SIN_ESPERA)

	it('probar conexión dice cuántos contratos hay', async () => {
		assert.deepEqual(await cliente().probarConexion(), { usuario: 'cobrix', contratos: 27 })
	})

	it('trae los 27 contratos: no envía `estado`, que devolvería solo los 22 activos', async () => {
		const ids = await cliente().idsDeContratos()
		assert.equal(ids.length, 27)
		assert.equal(ids[0], 900101)
	})

	it('lee las cuotas pendientes de un contrato, vengan en el orden que vengan', async () => {
		const lectura = await cliente().cuotasDeContrato(900101)
		assert.ok(lectura.ok)
		const cuotas = [...lectura.datos].sort((a, b) => a.deudaId.localeCompare(b.deudaId))
		assert.deepEqual(cuotas.map(c => c.deudaId), ['7000008', '7000009', '7000010'])
		assert.equal(cuotas.reduce((total, c) => total + c.deuda, 0), 7000)
		assert.equal(cuotas[0]!.estado, 'ACTIVO')
		assert.equal(cuotas[0]!.precioServicio, 2500)
	})

	it('un contrato sin deuda responde la fila «deuda_id 0» (LAURA MENDEZ, contrato 900109)', async () => {
		const lectura = await cliente().cuotasDeContrato(900109)
		assert.ok(lectura.ok)
		assert.deepEqual(lectura.datos.map(fila => fila.deudaId), ['0'])
	})

	it('el libro se pide siempre con fechas: la ventana del mes en curso incluye su último día', async () => {
		const lectura = await cliente().libroDeCuotas(900101, '2026-03-01', '2026-10-31')
		assert.ok(lectura.ok)
		const parcial = lectura.datos.find(fila => fila.cuotaId === 7000008)
		assert.ok(parcial, 'la cuota con abono parcial tiene que estar en el libro')
		assert.equal(parcial.saldo, 2000)
		assert.equal(parcial.valorPago, 500)
		assert.ok(parcial.facturaIspId > 0)
		assert.ok(lectura.datos.some(fila => fila.cuotaId === 7000010), 'la cuota del mes en curso aparece con la ventana hasta fin de mes')
		assert.ok(!lectura.datos.some(fila => fila.cuotaId === 7000001), 'la cuota fantasma de 2025-08 queda fuera de la ventana')
	})

	it('con una ventana amplia aparece la cuota fantasma, que no existe en el contrato', async () => {
		const libro = await cliente().libroDeCuotas(900101, '2025-01-01', '2026-10-31')
		const contrato = await cliente().cuotasDeContrato(900101)
		assert.ok(libro.ok && contrato.ok)
		const fantasma = libro.datos.find(fila => fila.cuotaId === 7000001)
		assert.ok(fantasma, 'el libro lista la cuota de 2025-08')
		assert.equal(fantasma.periodo, '2025-08')
		assert.ok(!contrato.datos.some(fila => fila.deudaId === '7000001'), 'el contrato no la reporta pendiente')
	})

	it('reutiliza el token: un login para muchas peticiones', async () => {
		const api = cliente()
		await api.idsDeContratos()
		await api.cuotasDeContrato(900101)
		await api.libroDeCuotas(900101, '2026-03-01', '2026-10-31')
		assert.equal(api.metricas().logins, 1)
		assert.equal(api.metricas().peticiones, 4)
	})

	it('credenciales malas: error con el mensaje de la API y una sugerencia accionable', async () => {
		const api = crearCliente({ apiUrl: sandbox.apiUrl, usuario: USUARIO, password: 'incorrecta' }, SIN_ESPERA)
		const error = await api.idsDeContratos().then(() => null, (razon: unknown) => razon)
		assert.ok(error instanceof ErrorApi)
		assert.equal(error.codigo, 'credenciales')
		assert.match(error.message, /Contraseña Incorrecta/)
		assert.match(error.sugerencia, /Configuración/)
	})

	it('un contrato que no existe es un error de la API, no una lista vacía', async () => {
		const error = await cliente().cuotasDeContrato(999999).then(() => null, (razon: unknown) => razon)
		assert.ok(error instanceof ErrorApi)
		assert.equal(error.status, 400)
		assert.match(error.message, /No se pudo recuperar la informacion/)
	})
})

describe('cliente · token, reintentos y errores', () => {
	const credenciales = (apiUrl: string) => ({ apiUrl, usuario: 'cobrix', password: 'secreta' })
	const login = (expira = '2099-01-01T00:00:00') => ({
		status: 200,
		cuerpo: { usuario: 'cobrix', access_token: `tok-${expira}`, access_token_expires_in: expira },
	})
	const lista = { status: 200, cuerpo: { success: true, data: [900101], pagination: { total: 1 } } }

	it('nunca envía `estado` al listar contratos y siempre manda fechas al libro', async () => {
		const stub = await levantarStub(url => (url.pathname.endsWith('/login') ? login() : lista))
		const api = crearCliente(credenciales(stub.apiUrl), SIN_ESPERA)
		await api.idsDeContratos()
		await api.libroDeCuotas(900101, '2026-03-01', '2026-10-31')
		await stub.cerrar()

		const listado = stub.urls.find(url => url.includes('lista_ids_contratos'))!
		assert.ok(!listado.includes('estado'), listado)
		const libro = stub.urls.find(url => url.includes('pago_informacion'))!
		assert.match(libro, /tipo_busqueda=CUOTA/)
		assert.match(libro, /fecha_inicio=2026-03-01/)
		assert.match(libro, /fecha_fin=2026-10-31/)
	})

	it('un 401 vale un re-login y un reintento', async () => {
		let primeras = 0
		const stub = await levantarStub(url => {
			if (url.pathname.endsWith('/login')) return login()
			return primeras++ === 0 ? { status: 401, cuerpo: { detail: { mensaje: 'Token expirado' } } } : lista
		})
		const api = crearCliente(credenciales(stub.apiUrl), SIN_ESPERA)
		assert.deepEqual(await api.idsDeContratos(), [900101])
		assert.equal(api.metricas().logins, 2)
		await stub.cerrar()
	})

	it('el segundo 401 falla la corrida en vez de insistir', async () => {
		const stub = await levantarStub(url => (url.pathname.endsWith('/login')
			? login()
			: { status: 401, cuerpo: { detail: { mensaje: 'Token invalido' } } }))
		const api = crearCliente(credenciales(stub.apiUrl), SIN_ESPERA)
		const error = await api.idsDeContratos().then(() => null, (razon: unknown) => razon)
		await stub.cerrar()
		assert.ok(error instanceof ErrorApi)
		assert.equal(error.codigo, 'autorizacion')
		assert.equal(api.metricas().logins, 2)
	})

	it('renueva el token antes de que caduque', async () => {
		let ahora = Date.parse('2026-10-13T12:00:00Z')
		const stub = await levantarStub(url => (url.pathname.endsWith('/login')
			? login(new Date(ahora + 60_000).toISOString().slice(0, 19))
			: lista))
		const api = crearCliente(credenciales(stub.apiUrl), { ...SIN_ESPERA, ahora: () => ahora })
		await api.idsDeContratos()
		ahora += 30_000
		await api.idsDeContratos()
		await stub.cerrar()
		assert.equal(api.metricas().logins, 2, 'un token a un minuto de vencer no se reutiliza')
	})

	it('reintenta los 5xx y sigue adelante cuando la API se recupera', async () => {
		let fallos = 0
		const stub = await levantarStub(url => {
			if (url.pathname.endsWith('/login')) return login()
			return fallos++ < 2 ? { status: 500, cuerpo: { detail: 'Internal Server Error' } } : lista
		})
		const api = crearCliente(credenciales(stub.apiUrl), SIN_ESPERA)
		assert.deepEqual(await api.idsDeContratos(), [900101])
		assert.equal(api.metricas().reintentos, 2)
		await stub.cerrar()
	})

	it('un 5xx permanente falla con el estado que devolvió', async () => {
		const stub = await levantarStub(url => (url.pathname.endsWith('/login') ? login() : { status: 503 }))
		const api = crearCliente(credenciales(stub.apiUrl), SIN_ESPERA)
		const error = await api.idsDeContratos().then(() => null, (razon: unknown) => razon)
		await stub.cerrar()
		assert.ok(error instanceof ErrorApi)
		assert.equal(error.codigo, 'http')
		assert.equal(error.status, 503)
	})

	it('traduce el tiempo de espera agotado', async () => {
		const api = crearCliente(credenciales('http://127.0.0.1:1/api/v1'), {
			...SIN_ESPERA,
			fetch: async () => {
				throw Object.assign(new Error('abortada'), { name: 'TimeoutError' })
			},
		})
		const error = await api.idsDeContratos().then(() => null, (razon: unknown) => razon)
		assert.ok(error instanceof ErrorApi)
		assert.equal(error.codigo, 'tiempo_agotado')
	})

	it('traduce la caída de red', async () => {
		const api = crearCliente(credenciales('http://127.0.0.1:1/api/v1'), SIN_ESPERA)
		const error = await api.idsDeContratos().then(() => null, (razon: unknown) => razon)
		assert.ok(error instanceof ErrorApi)
		assert.equal(error.codigo, 'red')
		assert.match(error.sugerencia, /URL/)
	})

	it('una respuesta que no es JSON no se interpreta', async () => {
		const api = crearCliente(credenciales('http://ejemplo.local/api/v1'), {
			...SIN_ESPERA,
			fetch: async () => new Response('<html>502 Bad Gateway</html>', { status: 200 }),
		})
		const error = await api.idsDeContratos().then(() => null, (razon: unknown) => razon)
		assert.ok(error instanceof ErrorApi)
		assert.equal(error.codigo, 'respuesta')
	})

	it('un login sin access_token es un error, no un token vacío', async () => {
		const stub = await levantarStub(() => ({ status: 200, cuerpo: { usuario: 'cobrix' } }))
		const api = crearCliente(credenciales(stub.apiUrl), SIN_ESPERA)
		const error = await api.idsDeContratos().then(() => null, (razon: unknown) => razon)
		await stub.cerrar()
		assert.ok(error instanceof ErrorApi)
		assert.equal(error.codigo, 'respuesta')
	})

	it('una lista que no cuadra con su paginación no se da por completa', async () => {
		const stub = await levantarStub(url => (url.pathname.endsWith('/login')
			? login()
			: { status: 200, cuerpo: { data: [900101], pagination: { total: 27 } } }))
		const api = crearCliente(credenciales(stub.apiUrl), SIN_ESPERA)
		const error = await api.idsDeContratos().then(() => null, (razon: unknown) => razon)
		await stub.cerrar()
		assert.ok(error instanceof ErrorApi)
		assert.equal(error.codigo, 'respuesta')
		assert.match(error.message, /27/)
	})
})

describe('detalles del protocolo', () => {
	it('el vencimiento del token llega en UTC sin zona', () => {
		assert.equal(vencimientoDelToken('2026-10-13T10:00:00', 0), Date.parse('2026-10-13T10:00:00Z'))
		assert.equal(vencimientoDelToken('2026-10-13T10:00:00Z', 0), Date.parse('2026-10-13T10:00:00Z'))
	})

	it('sin vencimiento legible se asumen las dos horas documentadas', () => {
		assert.equal(vencimientoDelToken(undefined, 1_000), 1_000 + 7_200_000)
		assert.equal(vencimientoDelToken('no es fecha', 0), 7_200_000)
	})

	it('los errores de la API llegan en tres formas y todas se leen', () => {
		assert.equal(mensajeDeApi({ detail: { type: 'password', mensaje: 'Contraseña Incorrecta' } }), 'Contraseña Incorrecta')
		assert.equal(mensajeDeApi({ detail: 'Not Found' }), 'Not Found')
		assert.equal(mensajeDeApi([{ source: 'query', field: 'tipo_busqueda', message: 'value is not valid' }]),
			'tipo_busqueda: value is not valid')
		assert.equal(mensajeDeApi(null), null)
	})
})
