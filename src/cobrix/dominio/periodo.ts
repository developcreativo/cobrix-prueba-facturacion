/**
 * Periodo, vencimiento y corte de una cuota, leídos de `detalle_deuda`.
 *
 * El administrador etiqueta cada cuota como «PLAN - 2026 Agosto» (ENUNCIADO.md §4): de ahí
 * salen el periodo `2026-08` y el vencimiento `2026-08-01`; el corte es el vencimiento más
 * los días de gracia configurados. Si la etiqueta no se puede leer, la cuota no se importa.
 */

import { addCivilDays, periodLabel } from '../../shared/dates.ts'

/** `2026 AGOSTO` → 8. Se deriva de `periodLabel` para que los nombres no puedan divergir. */
const MES_POR_NOMBRE = new Map<string, number>(
	Array.from({ length: 12 }, (_, i) => {
		const etiqueta = periodLabel(`2000-${String(i + 1).padStart(2, '0')}`)
		return [sinAcentos(etiqueta.split(' ')[1]!), i + 1]
	}),
)

const ETIQUETA = /(\d{4})\s+([A-ZÑ]+)\s*$/

export interface Vencimiento {
	/** `2026-08` */
	readonly periodo: string
	/** Primer día del periodo: `2026-08-01`. */
	readonly venceEl: string
	/** Vencimiento + días de gracia. */
	readonly cortaEl: string
}

function sinAcentos(texto: string): string {
	return texto.normalize('NFD').replaceAll(/\p{Diacritic}/gu, '').toUpperCase()
}

/** `"PLAN15MB25 - 2026 Agosto"` → `2026-08`. `null` si la etiqueta no dice un periodo. */
export function periodoDeEtiqueta(etiqueta: unknown): string | null {
	if (typeof etiqueta !== 'string') return null
	const partes = ETIQUETA.exec(sinAcentos(etiqueta))
	if (!partes) return null
	const mes = MES_POR_NOMBRE.get(partes[2]!)
	return mes === undefined ? null : `${partes[1]}-${String(mes).padStart(2, '0')}`
}

/**
 * Lee `detalle_deuda` completo. Exige al menos una etiqueta legible y que todas digan el mismo
 * periodo: dos periodos distintos en la misma cuota es una respuesta que se contradice.
 */
export function interpretarDetalleDeuda(detalle: unknown, diasGracia: number): Vencimiento | null {
	if (!Array.isArray(detalle) || detalle.length === 0) return null
	const periodos = new Set<string>()
	for (const etiqueta of detalle) {
		const periodo = periodoDeEtiqueta(etiqueta)
		if (periodo === null) return null
		periodos.add(periodo)
	}
	if (periodos.size !== 1) return null
	const periodo = [...periodos][0]!
	const venceEl = `${periodo}-01`
	return { periodo, venceEl, cortaEl: addCivilDays(venceEl, diasGracia) }
}
