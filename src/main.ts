/**
 * Levanta todo el entorno en un proceso:
 *   - la API del administrador de facturas sobre data/billing-api.sqlite  (BILLING_API_PORT, 4310)
 *   - el panel de Cobrix: API JSON en /api + el panel compilado de web/dist  (PORT, 4300)
 *   - la corrida automática diaria, si está activada en Configuración
 *
 * La base entregada se generó para el 2026-10-13. Esa fecha se fija por defecto para que valgan
 * los números de los criterios de aceptación de docs/ENUNCIADO.md; `SANDBOX_TODAY` la cambia.
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

process.env.SANDBOX_TODAY ??= '2026-10-13'

const { DEFAULT_BILLING_API_DB, seedBillingApi } = await import('./billing-api/seed.ts')
const { createBillingApiServer } = await import('./billing-api/server.ts')
const { abrirAlmacen } = await import('./cobrix/almacen/base.ts')
const { crearServidorPanel, COMANDOS_DEL_PANEL } = await import('./cobrix/http/servidor.ts')
const { crearPlanificador } = await import('./cobrix/planificador.ts')
const { leerConfiguracion } = await import('./cobrix/almacen/configuracion.ts')

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const billingApiDb = process.env.BILLING_API_DB ?? DEFAULT_BILLING_API_DB
const appPort = Number(process.env.PORT ?? 4300)
const billingApiPort = Number(process.env.BILLING_API_PORT ?? 4310)
const host = process.env.HOST ?? '127.0.0.1'

if (!existsSync(billingApiDb)) seedBillingApi(billingApiDb)

const billingApi = createBillingApiServer(billingApiDb)
await billingApi.listen(billingApiPort, host)
const simulatorUrl = `http://${host}:${billingApiPort}`

/**
 * El panel se sirve compilado y `web/dist` no se versiona, así que la primera vez hay que
 * construirlo. Se intenta aquí para que `npm install && npm start` baste; si no se puede (sin
 * red, por ejemplo), no se falla: se dice el comando exacto y la API sigue en pie.
 * `COBRIX_SIN_BUILD=1` lo salta.
 */
function construirPanelSiFalta(raizPanel: string): void {
	if (existsSync(resolve(raizPanel, 'index.html')) || process.env.COBRIX_SIN_BUILD === '1') return
	const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
	const pasos: Array<readonly string[]> = existsSync(resolve(root, 'web/node_modules'))
		? [['--prefix', 'web', 'run', 'build']]
		: [['--prefix', 'web', 'install', '--no-audit', '--no-fund'], ['--prefix', 'web', 'run', 'build']]
	console.log('Compilando el panel por primera vez (una sola vez)…')
	for (const paso of pasos) {
		const hecho = spawnSync(npm, [...paso], { cwd: root, stdio: 'inherit' })
		if (hecho.status !== 0) return
	}
}

const raizPanel = resolve(root, 'web/dist')
construirPanelSiFalta(raizPanel)

const almacen = abrirAlmacen({ ruta: process.env.COBRIX_DB })
const panel = crearServidorPanel({
	almacen,
	raizPanel,
	rutaEnunciado: resolve(root, 'docs/ENUNCIADO.md'),
})
await panel.escuchar(appPort, host)

// El planificador mira el reloj cada minuto; si el automático está apagado, no hace nada.
const planificador = crearPlanificador({ almacen, alProgresar: evento => panel.api.bus.publicar(evento) })
planificador.arrancar()

const configuracion = leerConfiguracion(almacen)
console.log(`Panel de Cobrix:          http://${host}:${appPort}`)
console.log(`API del panel:            http://${host}:${appPort}/api/salud`)
console.log(`API del administrador:    ${simulatorUrl}/api/v1`)
console.log(`Swagger:                  ${simulatorUrl}/docs`)
console.log(`Fecha de la prueba:       ${process.env.SANDBOX_TODAY}`)
console.log(`Corrida automática:       ${configuracion.proveedor.autoActiva
	? `activa a las ${configuracion.proveedor.autoHora ?? '—'} (America/Caracas)`
	: 'apagada (se activa en Configuración)'}`)
if (!panel.panelCompilado) {
	console.log('')
	console.log('El panel no está compilado todavía. Para verlo en el navegador:')
	console.log(`  ${COMANDOS_DEL_PANEL}`)
	console.log('Mientras tanto, la API del panel ya responde en /api.')
}

let cerrando = false
const shutdown = (): void => {
	if (cerrando) return
	cerrando = true
	planificador.detener()
	void panel.cerrar()
		.then(() => billingApi.close())
		.then(() => {
			almacen.cerrar()
			process.exit(0)
		})
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
