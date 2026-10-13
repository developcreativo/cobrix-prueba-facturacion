/**
 * Montos en centavos enteros.
 *
 * El administrador de facturas reporta saldos con hasta seis decimales (0,001317) y precios
 * como texto ("20.000000"). Se redondea una sola vez, en el borde del parseo, y a partir de
 * ahí el dominio y la base solo ven enteros: así ninguna suma de 42 facturas deriva un centavo.
 */

export type Centavos = number

/** `20` → 2000 · `"20.000000"` → 2000 · `0.001317` → 0. `null` si no es un número utilizable. */
export function aCentavos(valor: unknown): Centavos | null {
	if (typeof valor === 'number') return Number.isFinite(valor) ? Math.round(valor * 100) : null
	if (typeof valor !== 'string' || valor.trim() === '') return null
	const numero = Number(valor)
	return Number.isFinite(numero) ? Math.round(numero * 100) : null
}

const FORMATO = new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** `123500` → `USD 1.235,00`. */
export function usd(centavos: Centavos): string {
	return `USD ${FORMATO.format(centavos / 100)}`
}
