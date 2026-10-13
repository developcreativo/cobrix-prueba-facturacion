/**
 * Formato único del panel. Ninguna pantalla formatea por su cuenta.
 *
 * Reproduce en React las convenciones del esqueleto entregado (`src/web/layout.ts`):
 * montos `USD 1.235,00` con `es-VE`, fechas `13 oct 2026`, periodos `oct 2026`.
 * Los montos llegan de la API en **centavos enteros**.
 */

const NUMERO = new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const ENTERO = new Intl.NumberFormat('es-VE', { maximumFractionDigits: 0 })

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'] as const

export const SIN_DATO = '—'

/** `123500` → `USD 1.235,00`. */
export function usd(centavos: number | null | undefined): string {
	if (centavos === null || centavos === undefined || Number.isNaN(centavos)) return SIN_DATO
	return `USD ${NUMERO.format(centavos / 100)}`
}

/** `123500` → `1.235,00`, sin la moneda (para columnas que ya la anuncian). */
export function monto(centavos: number | null | undefined): string {
	if (centavos === null || centavos === undefined || Number.isNaN(centavos)) return SIN_DATO
	return NUMERO.format(centavos / 100)
}

/** `27` → `27`, con separador de miles de `es-VE`. */
export function entero(valor: number | null | undefined): string {
	if (valor === null || valor === undefined || Number.isNaN(valor)) return SIN_DATO
	return ENTERO.format(valor)
}

/** `2026-10-13` → `13 oct 2026`. Acepta también `2026-10` → `oct 2026`. */
export function fecha(iso: string | null | undefined): string {
	if (!iso) return SIN_DATO
	const [anio, mes, dia] = iso.slice(0, 10).split('-')
	if (!anio || !mes) return SIN_DATO
	const nombre = MESES[Number(mes) - 1]
	if (!nombre) return SIN_DATO
	return dia ? `${Number(dia)} ${nombre} ${anio}` : `${nombre} ${anio}`
}

/** `2026-10` → `oct 2026`. */
export function periodo(valor: string | null | undefined): string {
	if (!valor) return SIN_DATO
	return fecha(valor.slice(0, 7))
}

/**
 * Instantes.
 *
 * La API los emite con desfase explícito (`2026-10-13T14:03:11-04:00`). Si alguno llegara sin
 * zona —el almacén guarda hora civil de Caracas— se interpreta **como Caracas**, nunca como UTC
 * ni como la hora de la máquina: si no, todo el historial se correría cuatro horas.
 */
const ZONA = 'America/Caracas'
const DESFASE_CARACAS = '-04:00'

function instante(iso: string): Date {
	const tieneZona = /(?:Z|[+-]\d{2}:?\d{2})$/.test(iso)
	return new Date(tieneZona ? iso : `${iso}${DESFASE_CARACAS}`)
}

/** Instante ISO → `13 oct 2026, 3:41 a. m.` en la zona de la empresa. */
export function fechaHora(iso: string | null | undefined): string {
	if (!iso) return SIN_DATO
	const fechaObj = instante(iso)
	if (Number.isNaN(fechaObj.getTime())) return SIN_DATO
	const partes = new Intl.DateTimeFormat('es-VE', {
		timeZone: ZONA,
		day: 'numeric',
		month: 'numeric',
		year: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
	}).formatToParts(fechaObj)
	const buscar = (tipo: Intl.DateTimeFormatPartTypes): string => partes.find(p => p.type === tipo)?.value ?? ''
	const mes = MESES[Number(buscar('month')) - 1] ?? ''
	return `${Number(buscar('day'))} ${mes} ${buscar('year')}, ${buscar('hour')}:${buscar('minute')} ${buscar('dayPeriod')}`.trim()
}

/** Solo la hora: `3:41 a. m.`. */
export function hora(iso: string | null | undefined): string {
	if (!iso) return SIN_DATO
	const fechaObj = instante(iso)
	if (Number.isNaN(fechaObj.getTime())) return SIN_DATO
	return new Intl.DateTimeFormat('es-VE', { timeZone: ZONA, hour: 'numeric', minute: '2-digit' }).format(fechaObj)
}

/** `120` → `0,1 s`; `95000` → `1 min 35 s`. */
export function duracion(ms: number | null | undefined): string {
	if (ms === null || ms === undefined || Number.isNaN(ms)) return SIN_DATO
	if (ms < 1000) return `${ms} ms`
	const segundos = ms / 1000
	if (segundos < 60) return `${segundos.toFixed(1).replace('.', ',')} s`
	const minutos = Math.floor(segundos / 60)
	return `${minutos} min ${Math.round(segundos - minutos * 60)} s`
}

/** `['ACTIVO', 'CORTADO']` → `ACTIVO y CORTADO`. */
export function lista(valores: readonly string[], vacio = 'ninguno'): string {
	if (valores.length === 0) return vacio
	if (valores.length === 1) return valores[0] ?? vacio
	return `${valores.slice(0, -1).join(', ')} y ${valores[valores.length - 1]}`
}

/** Días entre dos fechas ISO (positivo = la segunda es posterior). */
export function diasEntre(desde: string, hasta: string): number {
	const a = Date.parse(`${desde.slice(0, 10)}T00:00:00Z`)
	const b = Date.parse(`${hasta.slice(0, 10)}T00:00:00Z`)
	if (Number.isNaN(a) || Number.isNaN(b)) return 0
	return Math.round((b - a) / 86_400_000)
}

/**
 * Antigüedad de una deuda en palabras, relativa a la fecha del sandbox:
 * `vencida hace 74 días`, `vence hoy`, `vence en 3 días`.
 */
export function antiguedad(vence: string | null | undefined, hoy: string): string {
	if (!vence) return SIN_DATO
	const dias = diasEntre(vence, hoy)
	if (dias === 0) return 'vence hoy'
	if (dias < 0) return `vence en ${Math.abs(dias)} ${Math.abs(dias) === 1 ? 'día' : 'días'}`
	return `vencida hace ${dias} ${dias === 1 ? 'día' : 'días'}`
}
