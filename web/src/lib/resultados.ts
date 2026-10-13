/**
 * Etiquetas y tonos de la taxonomía de resultados.
 *
 * **Espejo exacto de `src/cobrix/dominio/resultados.ts`**: las etiquetas y los tonos se copian
 * de ahí, que es la fuente de verdad. Si el dominio agrega un resultado, se agrega aquí y el
 * compilador señala el `Record` incompleto. El panel no inventa etiquetas.
 */

import type { EstadoContrato, EstadoCorrida, EstadoFactura, Resultado, ResultadoImportacion, ResultadoPago, Tono, Veredicto } from '@/tipos/panel'

interface Descripcion {
	readonly etiqueta: string
	readonly tono: Tono
	/** Si cuenta como exclusión en los contadores de la corrida. */
	readonly excluye: boolean
	/** Cómo se llama el resultado cuando la corrida es una simulación. */
	readonly etiquetaSimulada?: string
}

export const IMPORTACION: Record<ResultadoImportacion, Descripcion> = {
	importada: { etiqueta: 'Importada', tono: 'ok', excluye: false, etiquetaSimulada: 'Se importaría' },
	ya_importada: { etiqueta: 'Ya importada', tono: 'mute', excluye: false },
	sin_deuda: { etiqueta: 'Sin deuda', tono: 'mute', excluye: false },
	saldo_residual: { etiqueta: 'Saldo residual', tono: 'mute', excluye: true },
	excluida_estado: { etiqueta: 'Excluida por estado', tono: 'info', excluye: true },
	estado_desconocido: { etiqueta: 'Estado desconocido', tono: 'bad', excluye: true },
	identificacion_invalida: { etiqueta: 'Identificación inválida', tono: 'bad', excluye: true },
	tipo_documento_excluido: { etiqueta: 'Tipo de documento excluido', tono: 'info', excluye: true },
	moneda_incoherente: { etiqueta: 'Moneda incoherente', tono: 'bad', excluye: true },
	periodo_invalido: { etiqueta: 'Periodo ilegible', tono: 'bad', excluye: true },
	fuera_de_ventana: { etiqueta: 'Fuera de la ventana', tono: 'mute', excluye: true },
	limite_recientes: { etiqueta: 'Fuera del máximo de recientes', tono: 'mute', excluye: true },
	tope_facturas: { etiqueta: 'Frenada por tope de facturas', tono: 'warn', excluye: true },
	tope_monto: { etiqueta: 'Frenada por tope de monto', tono: 'warn', excluye: true },
	respuesta_contradictoria: { etiqueta: 'Respuesta contradictoria', tono: 'bad', excluye: true },
}

export const PAGOS: Record<ResultadoPago, Descripcion> = {
	marcada_pagada: { etiqueta: 'Marcada pagada', tono: 'ok', excluye: false, etiquetaSimulada: 'Se marcaría pagada' },
	ya_pagada: { etiqueta: 'Ya pagada', tono: 'mute', excluye: false },
	abono_parcial: { etiqueta: 'Abono parcial', tono: 'warn', excluye: false },
	sin_cambio: { etiqueta: 'Sigue abierta', tono: 'info', excluye: false },
	saldo_aumentado: { etiqueta: 'Saldo aumentado en el ISP', tono: 'warn', excluye: false },
	exonerada: { etiqueta: 'Exonerada', tono: 'info', excluye: false },
	abierta_sin_cobro: { etiqueta: 'Abierta, sin cobro aún', tono: 'info', excluye: false },
	sin_evidencia: { etiqueta: 'Sin evidencia', tono: 'bad', excluye: false },
	inconsistente: { etiqueta: 'Libro inconsistente', tono: 'bad', excluye: false },
}

export function describir(resultado: Resultado): Descripcion {
	return resultado in IMPORTACION
		? (IMPORTACION[resultado as ResultadoImportacion] as Descripcion)
		: (PAGOS[resultado as ResultadoPago] as Descripcion)
}

/** La etiqueta que se muestra: en simulación, «Se importaría» en vez de «Importada». */
export function etiquetaResultado(resultado: Resultado, simulacion = false): string {
	const descripcion = describir(resultado)
	return simulacion && descripcion.etiquetaSimulada ? descripcion.etiquetaSimulada : descripcion.etiqueta
}

export const tonoResultado = (resultado: Resultado): Tono => describir(resultado).tono

// ---------------------------------------------------------------- otros estados con tono

export const TONO_CONTRATO: Record<EstadoContrato, Tono> = {
	ACTIVO: 'ok',
	CORTADO: 'bad',
	CORTESIA: 'info',
	RETIRADO: 'mute',
	RECHAZADO: 'mute',
	ANULADO: 'mute',
}

export const TONO_FACTURA: Record<EstadoFactura, Tono> = {
	abierta: 'warn',
	pagada: 'ok',
}

export const ETIQUETA_FACTURA: Record<EstadoFactura, string> = {
	abierta: 'Abierta',
	pagada: 'Pagada',
}

export const TONO_CORRIDA: Record<EstadoCorrida, Tono> = {
	en_curso: 'info',
	completada: 'ok',
	fallida: 'bad',
}

export const ETIQUETA_CORRIDA: Record<EstadoCorrida, string> = {
	en_curso: 'En curso',
	completada: 'Completada',
	fallida: 'Falló',
}

// ---------------------------------------------------------------- veredictos de la traza

export const VEREDICTO: Record<Veredicto, { readonly simbolo: string; readonly etiqueta: string; readonly tono: Tono }> = {
	ok: { simbolo: '✓', etiqueta: 'Cumple', tono: 'ok' },
	descarta: { simbolo: '✗', etiqueta: 'Descarta', tono: 'bad' },
	omitida: { simbolo: '·', etiqueta: 'No se evalúa', tono: 'mute' },
}

// ---------------------------------------------------------------- tono → clases del tema

/** Clases para una píldora (fondo suave + texto + borde) de cada tono. */
export const CLASES_TONO: Record<Tono, string> = {
	ok: 'bg-ok-soft text-ok border-ok-line',
	warn: 'bg-warn-soft text-warn border-warn-line',
	bad: 'bg-bad-soft text-bad border-bad-line',
	info: 'bg-info-soft text-info border-info-line',
	mute: 'bg-mute-soft text-mute border-mute-line',
}

/** Solo el color de texto de cada tono. */
export const CLASES_TEXTO_TONO: Record<Tono, string> = {
	ok: 'text-ok',
	warn: 'text-warn',
	bad: 'text-bad',
	info: 'text-info',
	mute: 'text-mute',
}

/** Barra lateral de color, para marcar una fila o un bloque. */
export const CLASES_BORDE_TONO: Record<Tono, string> = {
	ok: 'border-ok-line',
	warn: 'border-warn-line',
	bad: 'border-bad-line',
	info: 'border-info-line',
	mute: 'border-mute-line',
}
