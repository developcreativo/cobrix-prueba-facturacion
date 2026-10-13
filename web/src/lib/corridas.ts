import type { CorridaResumen, TipoCorrida } from '@/tipos/panel'

/** Cómo se nombra cada tipo de corrida en el panel. */
export const NOMBRE_CORRIDA: Record<TipoCorrida, string> = {
	importacion: 'Importación',
	pagadas: 'Actualización de pagadas',
}

export const tituloCorrida = (corrida: CorridaResumen): string => `${NOMBRE_CORRIDA[corrida.tipo]} #${corrida.id}`
