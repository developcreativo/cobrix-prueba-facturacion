/**
 * Identificación del titular: la clave con la que Cobrix reconoce a un cliente.
 *
 * Reglas de ENUNCIADO.md §4: letra de tipo opcional (V, E, J, G, P) y de 6 a 12 dígitos, sin
 * separadores ni ceros a la izquierda. `V-12345678` → `V12345678`; `09000123` → `9000123`.
 * J y G son personas jurídicas; el resto, naturales. Lo que no encaje no se importa: no se adivina.
 */

export type TipoDocumento = 'V' | 'E' | 'J' | 'G' | 'P'
export type Persona = 'natural' | 'juridica'

export const TIPOS_DOCUMENTO: readonly TipoDocumento[] = ['V', 'E', 'J', 'G', 'P']

export interface Identificacion {
	/** Clave del cliente en Cobrix: `V12345678`, `J401234567`, `9000123`. */
	readonly id: string
	readonly tipo: TipoDocumento | null
	readonly numero: string
	readonly persona: Persona
}

const FORMA = /^([VEJGP])?(\d{6,12})$/

export function esTipoDocumento(valor: unknown): valor is TipoDocumento {
	return typeof valor === 'string' && (TIPOS_DOCUMENTO as readonly string[]).includes(valor)
}

/** `null` cuando la identificación no es utilizable: el contrato queda fuera de la importación. */
export function normalizarIdentificacion(bruta: unknown): Identificacion | null {
	if (typeof bruta !== 'string') return null
	const partes = FORMA.exec(bruta.replaceAll(/[^A-Za-z0-9]/g, '').toUpperCase())
	if (!partes) return null
	const tipo = (partes[1] ?? null) as TipoDocumento | null
	// Los ceros a la izquierda se descartan solo después de validar el largo del documento.
	const numero = partes[2]!.replace(/^0+/, '')
	if (numero === '') return null
	return {
		id: `${tipo ?? ''}${numero}`,
		tipo,
		numero,
		persona: tipo === 'J' || tipo === 'G' ? 'juridica' : 'natural',
	}
}

/** Prepara un término de búsqueda: `v-12.345.678` y `12345678` encuentran a `V12345678`. */
export function clavesDeBusqueda(identificacion: Identificacion): readonly string[] {
	return [identificacion.id, identificacion.numero]
}
