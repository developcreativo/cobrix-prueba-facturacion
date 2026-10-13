/**
 * Reparto del progreso de las corridas a los clientes conectados por SSE (docs/SPEC.md §5.3).
 *
 * Guarda el ÚLTIMO evento de cada corrida, no todo el historial: lo que un panel que llega tarde
 * necesita es el estado actual, no revivir la corrida paso a paso. Con eso, un cliente que se
 * conecta a mitad recibe de inmediato «18 de 27» y sigue desde ahí; si la corrida ya cerró,
 * recibe el evento de cierre y el stream termina.
 *
 * Los eventos cerrados se olvidan a los pocos minutos: esto es memoria de un proceso, no un
 * registro. El registro es la tabla `corrida`.
 */

import type { ProgresoCorrida } from '../corridas/progreso.ts'

type Escucha = (evento: ProgresoCorrida) => void

const RETENCION_MS = 5 * 60_000

export interface BusDeProgreso {
	publicar(evento: ProgresoCorrida): void
	/** Devuelve cómo darse de baja. */
	suscribir(corridaId: number, escucha: Escucha): () => void
	/** El último estado conocido, para quien llega tarde. */
	ultimo(corridaId: number): ProgresoCorrida | null
	cerrar(): void
}

export function crearBusDeProgreso(): BusDeProgreso {
	const ultimos = new Map<number, { evento: ProgresoCorrida; olvidarEn: number }>()
	const escuchas = new Map<number, Set<Escucha>>()

	const limpiar = (): void => {
		const ahora = Date.now()
		for (const [id, guardado] of ultimos) {
			if (guardado.olvidarEn <= ahora && (escuchas.get(id)?.size ?? 0) === 0) ultimos.delete(id)
		}
	}

	return {
		publicar(evento) {
			limpiar()
			ultimos.set(evento.corridaId, {
				evento,
				olvidarEn: Date.now() + (evento.cerrada ? RETENCION_MS : RETENCION_MS * 2),
			})
			for (const escucha of escuchas.get(evento.corridaId) ?? []) escucha(evento)
		},

		suscribir(corridaId, escucha) {
			const conjunto = escuchas.get(corridaId) ?? new Set<Escucha>()
			conjunto.add(escucha)
			escuchas.set(corridaId, conjunto)
			return () => {
				conjunto.delete(escucha)
				if (conjunto.size === 0) escuchas.delete(corridaId)
			}
		},

		ultimo(corridaId) {
			return ultimos.get(corridaId)?.evento ?? null
		},

		cerrar() {
			ultimos.clear()
			escuchas.clear()
		},
	}
}
