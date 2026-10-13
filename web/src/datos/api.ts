import { useCallback, useEffect, useRef, useState } from 'react'

import type {
	Configuracion,
	CorridaLanzada,
	DatosBorrados,
	EntradaConfiguracion,
	EntradaPruebaConexion,
	ErrorPanel,
	ProgresoCorrida,
	PruebaConexion,
	TipoCorrida,
} from '@/tipos/panel'

/**
 * La única puerta a la API del panel (`/api/*`, SPEC §3.8).
 *
 * Ninguna pantalla hace `fetch` por su cuenta y ninguna transforma lo que llega: los tipos de
 * `@/tipos/panel` son exactamente lo que la API sirve.
 *
 * Los errores llegan siempre con la misma forma —`{ error: { codigo, mensaje, sugerencia,
 * endpoint, status } }`— y se propagan **tal cual** hasta el bloque de error. El panel no
 * redacta sugerencias; la única que escribe aquí es la de «no se pudo contactar con el panel»,
 * porque un fallo de transporte nunca llega al servidor y no hay nadie más que pueda contarlo.
 */

export class ErrorDeApi extends Error {
	readonly detalle: ErrorPanel

	constructor(detalle: ErrorPanel) {
		super(detalle.mensaje)
		this.name = 'ErrorDeApi'
		this.detalle = detalle
	}
}

const SIN_CONEXION = (ruta: string): ErrorPanel => ({
	codigo: 'panel_sin_conexion',
	mensaje: 'No se pudo contactar con el panel de Cobrix.',
	sugerencia: 'Comprueba que el servidor esté levantado (`npm start`) y vuelve a intentarlo.',
	endpoint: ruta,
	status: null,
})

const RESPUESTA_ILEGIBLE = (ruta: string, status: number): ErrorPanel => ({
	codigo: 'respuesta_ilegible',
	mensaje: 'El panel respondió algo que no es JSON.',
	sugerencia: 'Revisa la consola del servidor: la respuesta llegó incompleta o con otro formato.',
	endpoint: ruta,
	status,
})

const esErrorDeApi = (valor: unknown): valor is { error: ErrorPanel } =>
	typeof valor === 'object' && valor !== null && 'error' in valor
	&& typeof (valor as { error: unknown }).error === 'object' && (valor as { error: unknown }).error !== null

async function pedir<T>(ruta: string, opciones: RequestInit = {}): Promise<T> {
	let respuesta: Response
	try {
		respuesta = await fetch(ruta, {
			...opciones,
			headers: { accept: 'application/json', ...(opciones.body === undefined ? {} : { 'content-type': 'application/json' }), ...opciones.headers },
		})
	} catch (error: unknown) {
		if (error instanceof DOMException && error.name === 'AbortError') throw error
		throw new ErrorDeApi(SIN_CONEXION(ruta))
	}

	let cuerpo: unknown
	try {
		cuerpo = await respuesta.json()
	} catch {
		throw new ErrorDeApi(RESPUESTA_ILEGIBLE(ruta, respuesta.status))
	}

	if (!respuesta.ok) {
		if (esErrorDeApi(cuerpo)) throw new ErrorDeApi(cuerpo.error)
		throw new ErrorDeApi(RESPUESTA_ILEGIBLE(ruta, respuesta.status))
	}
	return cuerpo as T
}

export const obtener = <T,>(ruta: string, señal?: AbortSignal): Promise<T> => pedir<T>(ruta, { signal: señal })

const enviar = <T,>(metodo: 'POST' | 'PUT', ruta: string, cuerpo: unknown): Promise<T> =>
	pedir<T>(ruta, { method: metodo, body: JSON.stringify(cuerpo) })

// ---------------------------------------------------------------- acciones

export const lanzarCorrida = (tipo: TipoCorrida, simulacion: boolean): Promise<CorridaLanzada> =>
	enviar('POST', '/api/corridas', { tipo, simulacion })

export const guardarConfiguracion = (entrada: EntradaConfiguracion): Promise<Configuracion> =>
	enviar('PUT', '/api/configuracion', entrada)

export const probarConexion = (entrada: EntradaPruebaConexion): Promise<PruebaConexion> =>
	enviar('POST', '/api/configuracion/probar-conexion', entrada)

export const borrarDatos = (): Promise<DatosBorrados> =>
	enviar('POST', '/api/datos/borrar', { confirmar: true })

/**
 * Progreso en vivo por SSE (`GET /api/corridas/:id/stream`).
 *
 * Devuelve la función para cerrar el stream. El servidor manda el último estado conocido al
 * conectar y cierra él mismo cuando la corrida termina.
 */
export function seguirCorrida(
	id: number,
	alProgresar: (progreso: ProgresoCorrida) => void,
	alCortarse: () => void,
): () => void {
	const stream = new EventSource(`/api/corridas/${id}/stream`)
	stream.onmessage = mensaje => {
		try {
			alProgresar(JSON.parse(mensaje.data as string) as ProgresoCorrida)
		} catch {
			// Un evento ilegible no tumba la consola: el detalle de la corrida sigue siendo la verdad.
		}
	}
	stream.onerror = alCortarse
	return () => stream.close()
}

// ---------------------------------------------------------------- lectura

export interface Recurso<T> {
	readonly dato: T | null
	readonly cargando: boolean
	readonly error: ErrorPanel | null
	/** Vuelve a pedir la ruta; `silencioso` no vacía lo que ya se muestra. */
	readonly recargar: (silencioso?: boolean) => void
}

/**
 * Un GET con sus tres estados.
 *
 * Cancela la petición anterior cuando la ruta cambia (la búsqueda de clientes dispara una por
 * pulsación) y no escribe estado después de desmontar.
 */
export function useRecurso<T>(ruta: string): Recurso<T> {
	const [dato, setDato] = useState<T | null>(null)
	const [cargando, setCargando] = useState(true)
	const [error, setError] = useState<ErrorPanel | null>(null)
	const [intento, setIntento] = useState(0)
	const silenciar = useRef(false)

	useEffect(() => {
		const control = new AbortController()
		let vivo = true
		if (!silenciar.current) {
			setCargando(true)
			setError(null)
		}
		silenciar.current = false

		obtener<T>(ruta, control.signal)
			.then(respuesta => {
				if (!vivo) return
				setDato(respuesta)
				setError(null)
			})
			.catch((fallo: unknown) => {
				if (!vivo || (fallo instanceof DOMException && fallo.name === 'AbortError')) return
				setError(fallo instanceof ErrorDeApi ? fallo.detalle : SIN_CONEXION(ruta))
			})
			.finally(() => {
				if (vivo) setCargando(false)
			})

		return () => {
			vivo = false
			control.abort()
		}
	}, [ruta, intento])

	const recargar = useCallback((silencioso = false) => {
		silenciar.current = silencioso
		setIntento(n => n + 1)
	}, [])

	return { dato, cargando, error, recargar }
}

/** Retrasa un valor: la búsqueda no pide una vez por tecla. */
export function useRetardo<T>(valor: T, ms = 250): T {
	const [retrasado, setRetrasado] = useState(valor)
	useEffect(() => {
		const temporizador = window.setTimeout(() => setRetrasado(valor), ms)
		return () => window.clearTimeout(temporizador)
	}, [valor, ms])
	return retrasado
}
