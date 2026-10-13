import { useSearchParams } from 'react-router-dom'

/**
 * Interruptor de estados de pantalla, mientras no hay API.
 *
 * Cada pantalla que después traerá datos tiene cuatro estados: con datos, cargando, con error
 * y vacía. Con datos de ejemplo solo se vería el primero, así que se pueden forzar los otros
 * desde la URL — `?estado=cargando`, `?estado=error`, `?estado=vacio` — para revisarlos y
 * probarlos. Cuando la API esté conectada, este módulo se reemplaza por el estado real de la
 * consulta (`isPending` / `error` / lista vacía) y las pantallas no cambian.
 */

export type Vista = 'datos' | 'cargando' | 'error' | 'vacio'

const VISTAS: readonly string[] = ['datos', 'cargando', 'error', 'vacio']

export function useVista(): Vista {
	const [parametros] = useSearchParams()
	const valor = parametros.get('estado') ?? 'datos'
	return (VISTAS.includes(valor) ? valor : 'datos') as Vista
}
