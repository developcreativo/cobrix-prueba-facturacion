/**
 * Progreso en vivo de una corrida (docs/SPEC.md §5.3).
 *
 * Una corrida de 27 contratos deja de ser un spinner: emite al empezar, cada vez que termina un
 * contrato y al cerrar. La unidad de avance es el CONTRATO, no la cuota, porque es lo único que
 * se conoce antes de empezar («Leyendo contratos: 12 de 27»); las decisiones ya tomadas viajan en
 * `ultimas`, de la más reciente a la más vieja.
 *
 * Regla que no se negocia: **si nadie escucha, el progreso no cuesta nada ni cambia nada**. Sin
 * `alProgresar` no se acumula ni un contador, y ninguna rama de la corrida depende de esto.
 */

import type { LineaCorridaEntrada } from '../almacen/corridas.ts'

export interface ProgresoCorrida {
	readonly corridaId: number
	readonly fase: string
	readonly procesados: number
	readonly total: number
	/** Cuántas líneas por resultado van hasta ahora. */
	readonly contadores: Readonly<Record<string, number>>
	/** Últimas decisiones, de la más reciente a la más vieja. */
	readonly ultimas: readonly LineaCorridaEntrada[]
	readonly cerrada: boolean
}

export type AlProgresar = (evento: ProgresoCorrida) => void

const ULTIMAS_VISIBLES = 8

export interface Progreso {
	/** Primer evento, en cuanto la corrida existe: el panel ya tiene algo que mostrar. */
	empezar(): void
	/** Cuántos contratos hay que recorrer, que se sabe después de hablar con el administrador. */
	fijarTotal(total: number, fase?: string): void
	/** Un contrato terminado, con las líneas que produjo. */
	avanzar(lineas: readonly LineaCorridaEntrada[]): void
	/** Último evento, con el conteo definitivo de la corrida. */
	cerrar(contadores: Readonly<Record<string, number>>, fase?: string): void
}

export function crearProgreso(
	corridaId: number,
	fase: string,
	total: number,
	alProgresar?: AlProgresar,
): Progreso {
	if (alProgresar === undefined) {
		const nada = (): void => {}
		return { empezar: nada, fijarTotal: nada, avanzar: nada, cerrar: nada }
	}

	const contadores: Record<string, number> = {}
	let ultimas: LineaCorridaEntrada[] = []
	let procesados = 0
	let faseActual = fase
	let pendientes = total

	const emitir = (cerrada: boolean, finales?: Readonly<Record<string, number>>): void => {
		alProgresar({
			corridaId,
			fase: faseActual,
			procesados,
			total: pendientes,
			contadores: { ...(finales ?? contadores) },
			ultimas: [...ultimas],
			cerrada,
		})
	}

	return {
		empezar: () => emitir(false),
		fijarTotal(nuevoTotal, nuevaFase) {
			pendientes = nuevoTotal
			if (nuevaFase !== undefined) faseActual = nuevaFase
			emitir(false)
		},
		avanzar(lineas) {
			procesados++
			for (const linea of lineas) contadores[linea.resultado] = (contadores[linea.resultado] ?? 0) + 1
			ultimas = [...[...lineas].reverse(), ...ultimas].slice(0, ULTIMAS_VISIBLES)
			emitir(false)
		},
		cerrar(finales, faseFinal = 'Corrida cerrada') {
			procesados = pendientes
			faseActual = faseFinal
			emitir(true, finales)
		},
	}
}
