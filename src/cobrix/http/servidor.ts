/**
 * El servidor del panel: la API JSON bajo `/api`, el panel compilado y el enunciado.
 *
 * Sustituye al esqueleto entregado (`src/web/`), como autoriza ENUNCIADO.md §3.7. El panel es una
 * aplicación de una sola página con enrutador propio, así que cualquier ruta que no sea un
 * archivo ni `/api` devuelve `index.html` y el enrutador del navegador decide: sin eso, recargar
 * en `/clientes/V12345678` daría 404.
 *
 * Si el panel no está compilado NO se falla en silencio ni se sirve una página en blanco: se
 * responde con el comando exacto que falta. Un evaluador que hace `npm install && npm start`
 * tiene que entender en un segundo qué le falta.
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { extname, join, normalize, resolve } from 'node:path'

import type { OpcionesCliente } from '../api/cliente.ts'
import type { Almacen } from '../almacen/base.ts'
import { crearApi, type Api } from './api.ts'

export interface OpcionesServidor {
	readonly almacen: Almacen
	/** Carpeta del panel compilado (`web/dist`). */
	readonly raizPanel?: string
	/** `docs/ENUNCIADO.md`, que se sigue sirviendo en `/enunciado`. */
	readonly rutaEnunciado?: string
	readonly opcionesCliente?: OpcionesCliente
}

export interface ServidorPanel {
	readonly api: Api
	readonly servidor: Server
	/** `false` si falta `web/dist`: el panel no está compilado. */
	readonly panelCompilado: boolean
	escuchar(puerto: number, host?: string): Promise<number>
	cerrar(): Promise<void>
}

const TIPOS: Record<string, string> = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.webp': 'image/webp',
	'.ico': 'image/x-icon',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
	'.map': 'application/json; charset=utf-8',
	'.txt': 'text/plain; charset=utf-8',
	'.webmanifest': 'application/manifest+json',
}

export const COMANDOS_DEL_PANEL = 'npm --prefix web install && npm --prefix web run build'

export function crearServidorPanel(opciones: OpcionesServidor): ServidorPanel {
	const api = crearApi({ almacen: opciones.almacen, opcionesCliente: opciones.opcionesCliente })
	const raiz = opciones.raizPanel === undefined ? null : resolve(opciones.raizPanel)
	const indice = raiz === null ? null : join(raiz, 'index.html')
	const panelCompilado = indice !== null && existsSync(indice)

	const servidor = createServer((peticion, respuesta) => {
		atender(peticion, respuesta).catch((error: unknown) => {
			console.error('[panel]', error)
			if (!respuesta.headersSent) texto(respuesta, 500, 'Algo falló en el servidor del panel.')
		})
	})

	async function atender(peticion: IncomingMessage, respuesta: ServerResponse): Promise<void> {
		if (await api.manejar(peticion, respuesta)) return

		const url = new URL(peticion.url ?? '/', 'http://panel.local')
		const ruta = url.pathname
		if (peticion.method !== 'GET' && peticion.method !== 'HEAD') return texto(respuesta, 405, 'Método no permitido.')

		// El enunciado, que ya estaba en el esqueleto y sigue siendo útil.
		if (ruta === '/enunciado' || ruta === '/enunciado/') {
			const contenido = opciones.rutaEnunciado !== undefined && existsSync(opciones.rutaEnunciado)
				? readFileSync(opciones.rutaEnunciado, 'utf8')
				: 'No se encontró docs/ENUNCIADO.md.'
			return texto(respuesta, 200, contenido)
		}

		if (raiz === null || indice === null || !panelCompilado) return sinPanel(respuesta)

		const archivo = archivoSeguro(raiz, ruta)
		if (archivo !== null) return enviarArchivo(respuesta, archivo)

		// Ruta del enrutador del panel: la decide el navegador, no el servidor.
		if (extname(ruta) === '') return enviarArchivo(respuesta, indice, 'no-store')
		return texto(respuesta, 404, 'No encontrado.')
	}

	function sinPanel(respuesta: ServerResponse): void {
		const cuerpo = [
			'El panel todavía no está compilado.',
			'',
			`Ejecuta:  ${COMANDOS_DEL_PANEL}`,
			'',
			'La API ya está funcionando: prueba GET /api/salud.',
		].join('\n')
		respuesta.writeHead(503, {
			'content-type': 'text/plain; charset=utf-8',
			'content-length': Buffer.byteLength(cuerpo),
			'retry-after': '30',
		})
		respuesta.end(cuerpo)
	}

	return {
		api,
		servidor,
		panelCompilado,
		escuchar: (puerto, host = '127.0.0.1') => new Promise<number>(listo => {
			servidor.listen(puerto, host, () => {
				const direccion = servidor.address()
				listo(typeof direccion === 'object' && direccion !== null ? direccion.port : puerto)
			})
		}),
		cerrar: () => new Promise<void>(listo => {
			api.cerrar()
			servidor.close(() => listo())
		}),
	}
}

/** Resuelve la ruta dentro de la carpeta del panel; `null` si no es un archivo de ahí dentro. */
function archivoSeguro(raiz: string, ruta: string): string | null {
	const limpia = normalize(decodeURIComponent(ruta)).replace(/^(\.\.[/\\])+/, '')
	const candidato = resolve(join(raiz, limpia))
	if (candidato !== raiz && !candidato.startsWith(raiz + '/')) return null
	if (!existsSync(candidato) || !statSync(candidato).isFile()) return null
	return candidato
}

function enviarArchivo(respuesta: ServerResponse, archivo: string, cache?: string): void {
	const contenido = readFileSync(archivo)
	const esIndice = archivo.endsWith('index.html')
	respuesta.writeHead(200, {
		'content-type': TIPOS[extname(archivo).toLowerCase()] ?? 'application/octet-stream',
		'content-length': contenido.length,
		// Vite pone un hash en el nombre de cada recurso; el índice nunca se cachea.
		'cache-control': cache ?? (esIndice ? 'no-store' : 'public, max-age=31536000, immutable'),
	})
	respuesta.end(contenido)
}

function texto(respuesta: ServerResponse, status: number, cuerpo: string): void {
	respuesta.writeHead(status, {
		'content-type': 'text/plain; charset=utf-8',
		'content-length': Buffer.byteLength(cuerpo),
	})
	respuesta.end(cuerpo)
}
