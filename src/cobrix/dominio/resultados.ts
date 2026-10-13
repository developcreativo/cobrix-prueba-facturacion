/**
 * Taxonomía de resultados: el vocabulario con el que una corrida explica cada cuota.
 *
 * Cada cuota de cada corrida termina en exactamente uno de estos resultados, con su motivo
 * legible y la traza de las reglas que se evaluaron para llegar ahí (ENUNCIADO.md §3.4).
 * Agregar un caso nuevo obliga a declararlo aquí, con etiqueta y tono: nada cae en un «otros».
 */

export type Tono = 'ok' | 'warn' | 'bad' | 'info' | 'mute'

export type ResultadoImportacion =
	| 'importada'                  // se creó la factura abierta
	| 'ya_importada'               // la cuota ya existe en Cobrix: idempotencia
	| 'sin_deuda'                  // fila con deuda_id "0": no es una cuota
	| 'saldo_residual'             // saldo de menos de un centavo
	| 'excluida_estado'            // el estado del contrato no está entre los importables
	| 'estado_desconocido'         // estado que no reconocemos: no se adivina
	| 'identificacion_invalida'    // el titular no tiene una identificación utilizable
	| 'tipo_documento_excluido'    // excluido por configuración (V, E, J, G, P)
	| 'moneda_incoherente'         // reporta USD con montos imposibles frente al plan
	| 'periodo_invalido'           // detalle_deuda no dice un periodo legible
	| 'fuera_de_ventana'           // más vieja que la ventana de importación
	| 'limite_recientes'           // excede el máximo de cuotas recientes por contrato
	| 'tope_facturas'              // frenada por el tope de facturas nuevas de la corrida
	| 'tope_monto'                 // frenada por el tope de monto nuevo de la corrida
	| 'respuesta_contradictoria'   // la API se contradice: el contrato entero queda fuera

export type ResultadoPago =
	| 'marcada_pagada'             // saldo 0 y algo cobrado en el libro
	| 'ya_pagada'                  // Cobrix ya la tenía pagada
	| 'abono_parcial'              // el ISP cobró una parte: sigue abierta
	| 'sin_cambio'                 // el libro coincide con Cobrix y nadie pagó
	| 'saldo_aumentado'            // el ISP anuló un cobro: debe más que en Cobrix
	| 'exonerada'                  // saldo 0 sin nada pagado: no es un pago
	| 'abierta_sin_cobro'          // no está en el libro pero el contrato la sigue debiendo
	| 'sin_evidencia'              // no aparece en ninguna parte: jamás se marca pagada
	| 'inconsistente'              // el libro se contradice consigo mismo

export type Resultado = ResultadoImportacion | ResultadoPago

interface Descripcion {
	readonly etiqueta: string
	readonly tono: Tono
	/** Si cuenta como exclusión en los contadores de la corrida. */
	readonly excluye: boolean
}

export const IMPORTACION: Record<ResultadoImportacion, Descripcion> = {
	importada: { etiqueta: 'Importada', tono: 'ok', excluye: false },
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
	marcada_pagada: { etiqueta: 'Marcada pagada', tono: 'ok', excluye: false },
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
		? IMPORTACION[resultado as ResultadoImportacion]
		: PAGOS[resultado as ResultadoPago]
}

// ---------------------------------------------------------------- traza de reglas

/**
 * Traza: por qué una cuota terminó donde terminó. Se produce en el mismo lugar donde se
 * decide, así que no puede desincronizarse de la regla, y el panel la muestra tal cual.
 */
export type Veredicto = 'ok' | 'descarta' | 'omitida'

export interface PasoTraza {
	readonly regla: string
	readonly veredicto: Veredicto
	readonly detalle: string
}

export const pasoOk = (regla: string, detalle: string): PasoTraza => ({ regla, veredicto: 'ok', detalle })
export const pasoDescarta = (regla: string, detalle: string): PasoTraza => ({ regla, veredicto: 'descarta', detalle })
export const pasoOmitida = (regla: string, detalle: string): PasoTraza => ({ regla, veredicto: 'omitida', detalle })
