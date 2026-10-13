/**
 * Cliente HTTP del administrador de facturas del ISP.
 *
 * Se encarga del transporte y nada más: token, reintentos, tiempos de espera y traducción de
 * los errores de la API a algo que el panel pueda explicar. La interpretación de los datos vive
 * en `lectura.ts`; las reglas, en `dominio/`.
 *
 * Decisiones que vienen de las rarezas documentadas (docs/API.md):
 *  - El token dura 2 h y no hay refresh: se guarda con su vencimiento y se renueva antes de
 *    que caduque. Un 401 dispara UN re-login y un reintento; el segundo 401 falla la corrida.
 *  - El login en vuelo se COMPARTE: si cuatro peticiones concurrentes arrancan sin token, hacen
 *    un solo login y esperan el mismo, en vez de iniciar sesión cuatro veces.
 *  - `lista_ids_contratos` devuelve solo los activos si se envía `estado` con cualquier valor:
 *    este cliente nunca envía ese parámetro.
 *  - `pago_informacion` sin fechas responde una ventana fija: siempre se envían explícitas.
 *  - `usuario/me` responde 500 por diseño: no se usa.
 */

import { leerCuotasDeContrato, leerIdsDeContratos, leerLibroDeCuotas } from './lectura.ts'
import type { FilaContrato, FilaLibro, Lectura } from '../dominio/tipos.ts'

export interface CredencialesProveedor {
	/** Por ejemplo `http://127.0.0.1:4310/api/v1`. */
	readonly apiUrl: string
	readonly usuario: string
	readonly password: string
}

export type CodigoError = 'credenciales' | 'autorizacion' | 'red' | 'tiempo_agotado' | 'http' | 'respuesta'

const SUGERENCIAS: Record<CodigoError, string> = {
	credenciales: 'Revisa el usuario y la contraseña en Configuración → Proveedor.',
	autorizacion: 'El token fue rechazado dos veces seguidas. Vuelve a probar la conexión.',
	red: 'No se pudo contactar al administrador. Revisa que la URL sea alcanzable desde este equipo.',
	tiempo_agotado: 'El administrador no respondió a tiempo. Reintenta; si persiste, avisa al ISP.',
	http: 'El administrador respondió con un error. El detalle de la corrida tiene la respuesta completa.',
	respuesta: 'El administrador respondió algo que no esperábamos. Nada se importó a medias.',
}

export class ErrorApi extends Error {
	readonly codigo: CodigoError
	readonly endpoint: string
	readonly status: number | null
	readonly sugerencia: string

	constructor(codigo: CodigoError, endpoint: string, mensaje: string, status: number | null = null) {
		super(mensaje)
		this.name = 'ErrorApi'
		this.codigo = codigo
		this.endpoint = endpoint
		this.status = status
		this.sugerencia = SUGERENCIAS[codigo]
	}
}

export interface OpcionesCliente {
	readonly fetch?: typeof globalThis.fetch
	readonly timeoutMs?: number
	/** Intentos totales ante fallo de red o 5xx. */
	readonly intentos?: number
	readonly esperas?: readonly number[]
	readonly dormir?: (ms: number) => Promise<void>
	readonly ahora?: () => number
}

export interface Metricas {
	readonly logins: number
	readonly peticiones: number
	readonly reintentos: number
}

export interface ClienteAdministrador {
	probarConexion(): Promise<{ readonly usuario: string; readonly contratos: number }>
	idsDeContratos(): Promise<readonly number[]>
	cuotasDeContrato(idContrato: number): Promise<Lectura<readonly FilaContrato[]>>
	libroDeCuotas(idContrato: number, desde: string, hasta: string): Promise<Lectura<readonly FilaLibro[]>>
	metricas(): Metricas
}

const MARGEN_TOKEN_MS = 5 * 60_000
const ESPERAS_POR_DEFECTO: readonly number[] = [250, 1_000, 3_000]

export function crearCliente(credenciales: CredencialesProveedor, opciones: OpcionesCliente = {}): ClienteAdministrador {
	const hacerFetch = opciones.fetch ?? globalThis.fetch
	const timeoutMs = opciones.timeoutMs ?? 10_000
	const esperas = opciones.esperas ?? ESPERAS_POR_DEFECTO
	const intentos = opciones.intentos ?? esperas.length + 1
	const dormir = opciones.dormir ?? ((ms: number) => new Promise<void>(listo => setTimeout(listo, ms)))
	const ahora = opciones.ahora ?? (() => Date.now())
	const base = credenciales.apiUrl.replace(/\/+$/, '')

	let token: { valor: string; expiraEn: number } | null = null
	let loginEnVuelo: Promise<string> | null = null
	let usuario = credenciales.usuario
	let logins = 0
	let peticiones = 0
	let reintentos = 0

	const ruta = (camino: string, query?: Record<string, string>): string => {
		const url = new URL(`${base}/${camino}`)
		for (const [clave, valor] of Object.entries(query ?? {})) url.searchParams.set(clave, valor)
		return url.toString()
	}

	async function pedir(url: string, init: RequestInit, endpoint: string): Promise<Response> {
		peticiones++
		try {
			return await hacerFetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
		} catch (error: unknown) {
			const nombre = error instanceof Error ? error.name : ''
			if (nombre === 'TimeoutError' || nombre === 'AbortError') {
				throw new ErrorApi('tiempo_agotado', endpoint, `sin respuesta en ${timeoutMs} ms`)
			}
			throw new ErrorApi('red', endpoint, error instanceof Error ? error.message : String(error))
		}
	}

	/** Reintenta solo lo que vale la pena reintentar: red, tiempo agotado y 5xx. */
	async function conReintentos(url: string, init: RequestInit, endpoint: string): Promise<Response> {
		let ultimo: ErrorApi | null = null
		for (let intento = 0; intento < intentos; intento++) {
			if (intento > 0) {
				reintentos++
				await dormir(esperas[Math.min(intento - 1, esperas.length - 1)] ?? 0)
			}
			try {
				const respuesta = await pedir(url, init, endpoint)
				if (respuesta.status < 500) return respuesta
				ultimo = new ErrorApi('http', endpoint, `respondió ${respuesta.status}`, respuesta.status)
			} catch (error: unknown) {
				if (!(error instanceof ErrorApi) || (error.codigo !== 'red' && error.codigo !== 'tiempo_agotado')) throw error
				ultimo = error
			}
		}
		throw ultimo ?? new ErrorApi('red', endpoint, 'sin respuesta')
	}

	async function cuerpo(respuesta: Response, endpoint: string): Promise<unknown> {
		const texto = await respuesta.text()
		let payload: unknown = undefined
		try {
			payload = texto === '' ? null : JSON.parse(texto)
		} catch {
			throw new ErrorApi('respuesta', endpoint, `la respuesta no es JSON: ${recortar(texto)}`, respuesta.status)
		}
		if (!respuesta.ok) {
			throw new ErrorApi('http', endpoint, mensajeDeApi(payload) ?? `respondió ${respuesta.status}`, respuesta.status)
		}
		return payload
	}

	/**
	 * El token, iniciando sesión si hace falta. Varias llamadas concurrentes sin token comparten
	 * el mismo login: la corrida de pagadas arranca con cuatro obreros a la vez y haría cuatro.
	 */
	async function obtenerToken(): Promise<string> {
		if (token !== null && token.expiraEn - MARGEN_TOKEN_MS > ahora()) return token.valor
		loginEnVuelo ??= iniciarSesion().finally(() => {
			loginEnVuelo = null
		})
		return await loginEnVuelo
	}

	async function iniciarSesion(): Promise<string> {
		const endpoint = 'usuario/login'
		const respuesta = await conReintentos(ruta(endpoint), {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ user_name: credenciales.usuario, password: credenciales.password }),
		}, endpoint)
		logins++
		if (respuesta.status === 400 || respuesta.status === 401 || respuesta.status === 403) {
			const payload: unknown = await respuesta.json().catch(() => null)
			throw new ErrorApi('credenciales', endpoint, mensajeDeApi(payload) ?? 'credenciales rechazadas', respuesta.status)
		}
		const payload = await cuerpo(respuesta, endpoint)
		const datos = payload as Record<string, unknown> | null
		const valor = typeof datos?.access_token === 'string' ? datos.access_token : null
		if (valor === null || valor === '') {
			throw new ErrorApi('respuesta', endpoint, 'el login no devolvió access_token')
		}
		if (typeof datos?.usuario === 'string') usuario = datos.usuario
		token = { valor, expiraEn: vencimientoDelToken(datos?.access_token_expires_in, ahora()) }
		return valor
	}

	/** Una petición autenticada. Un 401 vale un re-login y un reintento; el segundo, no. */
	async function autorizada(endpoint: string, query?: Record<string, string>): Promise<unknown> {
		const url = ruta(endpoint, query)
		for (let intentoAuth = 0; ; intentoAuth++) {
			const valor = await obtenerToken()
			const respuesta = await conReintentos(url, { headers: { authorization: `Bearer ${valor}` } }, endpoint)
			if (respuesta.status === 401 && intentoAuth === 0) {
				token = null
				continue
			}
			if (respuesta.status === 401) {
				const payload: unknown = await respuesta.json().catch(() => null)
				throw new ErrorApi('autorizacion', endpoint, mensajeDeApi(payload) ?? 'token rechazado', 401)
			}
			return await cuerpo(respuesta, endpoint)
		}
	}

	async function idsDeContratos(): Promise<readonly number[]> {
		// Sin `estado`: con cualquier valor la API devolvería solo los activos (docs/API.md §3.2).
		const payload = await autorizada('isp/lista_ids_contratos')
		const lectura = leerIdsDeContratos(payload)
		if (!lectura.ok) throw new ErrorApi('respuesta', 'isp/lista_ids_contratos', lectura.detalle)
		return lectura.datos
	}

	return {
		idsDeContratos,

		async probarConexion() {
			await obtenerToken()
			const contratos = await idsDeContratos()
			return { usuario, contratos: contratos.length }
		},

		async cuotasDeContrato(idContrato) {
			const payload = await autorizada('isp/contrato/individual', { id_contrato: String(idContrato) })
			return leerCuotasDeContrato(payload, idContrato)
		},

		async libroDeCuotas(idContrato, desde, hasta) {
			const payload = await autorizada('isp/pago_informacion', {
				id_contrato: String(idContrato),
				tipo_busqueda: 'CUOTA',
				fecha_inicio: desde,
				fecha_fin: hasta,
			})
			return leerLibroDeCuotas(payload, idContrato)
		},

		metricas() {
			return { logins, peticiones, reintentos }
		},
	}
}

/** `access_token_expires_in` viene en UTC sin zona («2026-10-13T10:00:00»). */
export function vencimientoDelToken(valor: unknown, referencia: number): number {
	const DOS_HORAS = 7_200_000
	if (typeof valor !== 'string') return referencia + DOS_HORAS
	const conZona = /[Zz]|[+-]\d{2}:?\d{2}$/.test(valor) ? valor : `${valor}Z`
	const instante = Date.parse(conZona)
	return Number.isNaN(instante) ? referencia + DOS_HORAS : instante
}

/** Los errores de esta API llegan en tres formas distintas; todas se traducen a una frase. */
export function mensajeDeApi(payload: unknown): string | null {
	if (payload === null || payload === undefined) return null
	if (Array.isArray(payload)) {
		const partes = payload
			.map(item => (typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : null))
			.map(item => [item?.field, item?.message].filter(parte => typeof parte === 'string').join(': '))
			.filter(parte => parte !== '')
		return partes.length > 0 ? partes.join(' · ') : null
	}
	if (typeof payload !== 'object') return null
	const objeto = payload as Record<string, unknown>
	const detalle = objeto.detail
	if (typeof detalle === 'string') return detalle
	if (typeof detalle === 'object' && detalle !== null) {
		const interno = detalle as Record<string, unknown>
		if (typeof interno.mensaje === 'string') return interno.mensaje
	}
	if (typeof objeto.message === 'string') return objeto.message
	return null
}

const recortar = (texto: string): string => (texto.length > 120 ? `${texto.slice(0, 120)}…` : texto)
