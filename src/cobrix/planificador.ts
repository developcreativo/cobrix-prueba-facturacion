/**
 * Corrida automática diaria (ENUNCIADO.md §3.1).
 *
 * Planificador en el propio proceso del panel, que ya es de larga vida: no se asume cron del
 * sistema ni un contenedor aparte. Cada minuto compara la hora civil de America/Caracas con la
 * hora configurada y, cuando toca, encadena **importar y después actualizar pagadas**, reales y
 * con `disparo: 'automatica'`.
 *
 * Cuatro reglas que vienen del enunciado y de la experiencia de operar esto:
 *  1. **No se repite el mismo día.** Se recuerda el último día ejecutado; si el proceso estuvo
 *     caído a la hora, no se dispara al arrancar: se habrá perdido ese día y se dice.
 *  2. **No se fuerza nada.** Si a su hora hay una corrida en curso, se registra que se omitió y
 *     por qué; el cerrojo es de quien lo tomó primero.
 *  3. **Pagadas corre aunque importar falle**, porque son independientes: lo que el ISP ya cobró
 *     no deja de estar cobrado porque la lista de contratos no se pudiera leer.
 *  4. **El reloj se inyecta.** Así la prueba no espera un minuto real.
 */

import { today } from '../shared/dates.ts'
import type { Almacen } from './almacen/base.ts'
import { leerConfiguracion } from './almacen/configuracion.ts'
import { corridaRealEnCurso } from './almacen/corridas.ts'
import { correrImportacion } from './corridas/importacion.ts'
import { correrActualizacionDePagadas } from './corridas/pagadas.ts'
import type { AlProgresar } from './corridas/progreso.ts'

const ZONA = 'America/Caracas'
const CADA_MINUTO_MS = 60_000

export type MotivoOmision = 'corrida_en_curso' | 'sin_credenciales' | 'error'

export interface EjecucionAutomatica {
	readonly dia: string
	readonly hora: string
	readonly importacion: number | null
	readonly pagadas: number | null
	readonly omitida: MotivoOmision | null
	readonly detalle: string
}

export interface OpcionesPlanificador {
	readonly almacen: Almacen
	/** `HH:MM` actual en America/Caracas. Inyectable para que la prueba no espere un minuto. */
	readonly reloj?: () => { dia: string; hora: string }
	readonly alProgresar?: AlProgresar
	/** Se llama al terminar cada intento, con lo que pasó. */
	readonly alEjecutar?: (ejecucion: EjecucionAutomatica) => void
	/** Dónde deja el rastro de cada intento; por defecto, la consola del servidor. */
	readonly registrar?: (mensaje: string) => void
	readonly intervaloMs?: number
}

export interface Planificador {
	/** Empieza a mirar el reloj. Idempotente. */
	arrancar(): void
	detener(): void
	/** Un tic: comprueba si toca y, si toca, ejecuta. Devuelve qué hizo, o `null` si no tocaba. */
	tic(): Promise<EjecucionAutomatica | null>
	/** El último intento, para el Resumen y para las pruebas. */
	ultima(): EjecucionAutomatica | null
	readonly corriendo: boolean
}

export function crearPlanificador(opciones: OpcionesPlanificador): Planificador {
	const { almacen } = opciones
	const reloj = opciones.reloj ?? relojDeCaracas
	const intervalo = opciones.intervaloMs ?? CADA_MINUTO_MS

	let temporizador: ReturnType<typeof setInterval> | null = null
	let ultimoDiaEjecutado: string | null = null
	let ultima: EjecucionAutomatica | null = null
	let ocupado = false

	async function tic(): Promise<EjecucionAutomatica | null> {
		if (ocupado) return null
		const { proveedor, passwordDefinida } = leerConfiguracion(almacen)
		if (!proveedor.autoActiva || proveedor.autoHora === null) return null

		const { dia, hora } = reloj()
		// A la hora en punto o después, una sola vez al día: un tic perdido no se arrastra.
		if (hora < proveedor.autoHora || ultimoDiaEjecutado === dia) return null

		ocupado = true
		ultimoDiaEjecutado = dia
		try {
			const enCurso = corridaRealEnCurso(almacen)
			if (enCurso !== null) return registrar({
				dia, hora, importacion: null, pagadas: null, omitida: 'corrida_en_curso',
				detalle: `Se omitió: la corrida ${enCurso.id} estaba en curso a las ${hora}.`,
			})
			if (!passwordDefinida) return registrar({
				dia, hora, importacion: null, pagadas: null, omitida: 'sin_credenciales',
				detalle: 'Se omitió: el proveedor no tiene contraseña guardada.',
			})

			const comun = { disparo: 'automatica' as const, alProgresar: opciones.alProgresar }
			// Importar primero y pagadas después: así lo que se acaba de importar ya se revisa.
			const importacion = await correrImportacion(almacen, comun)
			const pagadas = await correrActualizacionDePagadas(almacen, comun)
			return registrar({
				dia,
				hora,
				importacion: importacion.corridaId,
				pagadas: pagadas.corridaId,
				omitida: null,
				detalle: `Importación: ${importacion.resumen} · Pagadas: ${pagadas.resumen}`,
			})
		} catch (error: unknown) {
			return registrar({
				dia, hora, importacion: null, pagadas: null, omitida: 'error',
				detalle: `La corrida automática falló: ${error instanceof Error ? error.message : String(error)}`,
			})
		} finally {
			ocupado = false
		}
	}

	const anotar = opciones.registrar ?? ((mensaje: string) => console.log(mensaje))

	function registrar(ejecucion: EjecucionAutomatica): EjecucionAutomatica {
		ultima = ejecucion
		anotar(`[automatica] ${ejecucion.dia} ${ejecucion.hora} · ${ejecucion.detalle}`)
		opciones.alEjecutar?.(ejecucion)
		return ejecucion
	}

	return {
		arrancar() {
			if (temporizador !== null) return
			temporizador = setInterval(() => {
				void tic()
			}, intervalo)
			// El planificador no puede mantener vivo el proceso por sí solo.
			temporizador.unref?.()
		},
		detener() {
			if (temporizador === null) return
			clearInterval(temporizador)
			temporizador = null
		},
		tic,
		ultima: () => ultima,
		get corriendo() {
			return temporizador !== null
		},
	}
}

/** Día y hora civiles de Caracas. El día respeta `SANDBOX_TODAY`, como todo el resto. */
export function relojDeCaracas(): { dia: string; hora: string } {
	const formato = new Intl.DateTimeFormat('en-GB', {
		timeZone: ZONA, hour: '2-digit', minute: '2-digit', hour12: false,
	})
	return { dia: today(), hora: formato.format(new Date()) }
}
