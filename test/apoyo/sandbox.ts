/**
 * Levanta la API simulada del administrador en un puerto libre con una base temporal propia,
 * para que las pruebas de integración no toquen `data/billing-api.sqlite`.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { SANDBOX_API_USER, seedBillingApi } from '../../src/billing-api/seed.ts'
import { createBillingApiServer, type BillingApiServer } from '../../src/billing-api/server.ts'

export const USUARIO = SANDBOX_API_USER.user_name
export const PASSWORD = SANDBOX_API_USER.password

export interface Sandbox {
	/** `http://127.0.0.1:<puerto>/api/v1` */
	readonly apiUrl: string
	readonly raiz: string
	cerrar(): Promise<void>
}

export async function levantarSandbox(): Promise<Sandbox> {
	const carpeta = mkdtempSync(join(tmpdir(), 'cobrix-prueba-'))
	const ruta = join(carpeta, 'billing-api.sqlite')
	seedBillingApi(ruta)
	const api: BillingApiServer = createBillingApiServer(ruta)
	const puerto = await api.listen(0)
	const raiz = `http://127.0.0.1:${puerto}`
	return {
		apiUrl: `${raiz}/api/v1`,
		raiz,
		async cerrar() {
			await api.close()
			rmSync(carpeta, { recursive: true, force: true })
		},
	}
}

/** Servidor mínimo para provocar fallos que el administrador real no provoca a pedido. */
export interface RespuestaStub {
	readonly status: number
	readonly cuerpo?: unknown
}

export async function levantarStub(
	manejar: (url: URL, metodo: string) => RespuestaStub,
): Promise<{ apiUrl: string; urls: string[]; cerrar: () => Promise<void> }> {
	const { createServer } = await import('node:http')
	const urls: string[] = []
	const servidor = createServer((peticion, respuesta) => {
		const url = new URL(peticion.url ?? '/', 'http://stub.local')
		urls.push(`${peticion.method} ${url.pathname}${url.search}`)
		const { status, cuerpo } = manejar(url, peticion.method ?? 'GET')
		const payload = JSON.stringify(cuerpo ?? {})
		respuesta.writeHead(status, { 'content-type': 'application/json' })
		respuesta.end(payload)
	})
	const puerto = await new Promise<number>(listo => {
		servidor.listen(0, '127.0.0.1', () => {
			const direccion = servidor.address()
			listo(typeof direccion === 'object' && direccion !== null ? direccion.port : 0)
		})
	})
	return {
		apiUrl: `http://127.0.0.1:${puerto}/api/v1`,
		urls,
		cerrar: () => new Promise<void>(listo => servidor.close(() => listo())),
	}
}
