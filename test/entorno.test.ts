/**
 * Comprueba el entorno de la prueba: la API del administrador responde como está documentada,
 * todas sus rutas existen y el panel de Cobrix se sirve con su API.
 *
 * ACTUALIZADO al construir el panel. Las dos primeras pruebas son las entregadas y no cambian: la
 * API simulada sigue siendo el material del cliente. La tercera afirmaba que cada pantalla decía
 * «Por implementar», que era cierto del esqueleto de `src/web/` y dejó de serlo cuando el panel
 * pasó a ser la aplicación de `web/` servida desde `src/cobrix/http/servidor.ts` (ENUNCIADO.md
 * §3.7 autoriza reemplazarlo). Lo que se verifica ahora es lo mismo en espíritu —el panel se
 * sirve, el enunciado sigue en `/enunciado` y la caja del ISP no es una pantalla del panel— más
 * dos cosas que el esqueleto no tenía: el enrutador del navegador y la API JSON.
 */

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'

import { SANDBOX_API_USER, seedBillingApi } from '../src/billing-api/seed.ts'
import { createBillingApiServer, type BillingApiServer } from '../src/billing-api/server.ts'
import { abrirAlmacen, type Almacen } from '../src/cobrix/almacen/base.ts'
import { crearServidorPanel, type ServidorPanel } from '../src/cobrix/http/servidor.ts'

process.env.SANDBOX_TODAY = '2026-10-13'

describe('entorno de la prueba', () => {
	let dir: string
	let api: BillingApiServer
	let base: string
	let almacen: Almacen
	let panel: ServidorPanel
	let panelBase: string

	before(async () => {
		dir = mkdtempSync(join(tmpdir(), 'prueba-facturacion-'))
		seedBillingApi(join(dir, 'billing-api.sqlite'))
		api = createBillingApiServer(join(dir, 'billing-api.sqlite'))
		base = `http://127.0.0.1:${await api.listen(0)}`
		almacen = abrirAlmacen({ ruta: ':memory:' })
		panel = crearServidorPanel({
			almacen,
			raizPanel: new URL('../web/dist', import.meta.url).pathname,
			rutaEnunciado: new URL('../docs/ENUNCIADO.md', import.meta.url).pathname,
		})
		panelBase = `http://127.0.0.1:${await panel.escuchar(0)}`
	})

	after(async () => {
		await panel.cerrar()
		almacen.cerrar()
		await api.close()
		rmSync(dir, { recursive: true, force: true })
	})

	it('login, lista de contratos y cuotas de un contrato', async () => {
		const login = await (await fetch(`${base}/api/v1/usuario/login`, { method: 'POST', body: JSON.stringify({ user_name: SANDBOX_API_USER.user_name, password: SANDBOX_API_USER.password }) })).json() as Record<string, string>
		const auth = { authorization: `Bearer ${login.access_token}` }
		const ids = await (await fetch(`${base}/api/v1/isp/lista_ids_contratos`, { headers: auth })).json() as { data: number[] }
		assert.equal(ids.data.length, 27)
		const rows = await (await fetch(`${base}/api/v1/isp/contrato/individual?id_contrato=900101`, { headers: auth })).json() as Array<Record<string, unknown>>
		assert.ok(rows.length > 0)
		assert.equal(rows[0]!.contrato_id, 900101)
	})

	it('cada ruta documentada en Swagger existe', async () => {
		const spec = await (await fetch(`${base}/openapi.json`)).json() as { paths: Record<string, Record<string, unknown>> }
		for (const [path, methods] of Object.entries(spec.paths)) {
			for (const method of Object.keys(methods)) {
				if (path === '/__sim/reiniciar') continue
				const response = await fetch(`${base}${path}`, { method: method.toUpperCase(), ...(method === 'post' ? { body: '{}' } : {}) })
				assert.ok(![404, 405].includes(response.status), `${method} ${path}`)
			}
		}
	})

	it('el panel se sirve con su API y el enunciado, sin pantalla de simulador', async () => {
		assert.equal(panel.panelCompilado, true, 'web/dist tiene que estar compilado: npm --prefix web run build')

		// La raíz y cualquier ruta del enrutador sirven el mismo index.html: recargar en
		// /clientes/V12345678 no puede dar 404.
		const raiz = await fetch(`${panelBase}/`)
		assert.equal(raiz.status, 200)
		assert.match(raiz.headers.get('content-type') ?? '', /text\/html/)
		const html = await raiz.text()
		assert.match(html, /<div id="root">/)
		assert.match(html, /Cobrix/)
		for (const ruta of ['/clientes', '/clientes/V12345678', '/sincronizacion', '/configuracion']) {
			const respuesta = await fetch(`${panelBase}${ruta}`)
			assert.equal(respuesta.status, 200, ruta)
			assert.equal(await respuesta.text(), html, `${ruta} sirve el panel, no una página distinta`)
		}

		// Los recursos compilados se sirven con su tipo.
		const icono = await fetch(`${panelBase}/favicon.svg`)
		assert.equal(icono.status, 200)
		assert.match(icono.headers.get('content-type') ?? '', /image\/svg/)

		// La API JSON del panel responde: eso es lo nuevo respecto del esqueleto.
		const salud = await (await fetch(`${panelBase}/api/salud`)).json() as Record<string, unknown>
		assert.deepEqual(salud.sandbox, { hoy: '2026-10-13', periodo_actual: '2026-10' })

		// La caja del ISP (`/__sim/*`) no es parte del panel ni se proxea desde él.
		assert.doesNotMatch(html, /Simulador del administrador/)
		assert.equal((await fetch(`${panelBase}/api/__sim/pagar`, { method: 'POST', body: '{}' })).status, 404)
		assert.equal((await fetch(`${panelBase}/api/simulador`)).status, 404)

		assert.match(await (await fetch(`${panelBase}/enunciado`)).text(), /Criterios de aceptación/)
	})
})
