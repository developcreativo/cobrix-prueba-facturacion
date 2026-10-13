import { createContext, use, useMemo, type ReactNode } from 'react'

import { useRecurso } from '@/datos/api'
import type { Configuracion, Empresa, Salud } from '@/tipos/panel'

/**
 * Lo que el panel entero necesita saber, pedido una sola vez al arrancar.
 *
 * Son dos lecturas pequeñas que no pertenecen a ninguna pantalla: `GET /api/salud` (el reloj del
 * sandbox, que decide si una factura está vencida, y la corrida que tenga el cerrojo) y
 * `GET /api/configuracion` (el nombre de la empresa del pie). Mientras no hayan llegado, lo que
 * dependa de ellas simplemente no se muestra: no hay valores por defecto inventados.
 */

interface ContextoPanel {
	readonly salud: Salud | null
	readonly empresa: Empresa | null
	/** Fecha del sandbox (`YYYY-MM-DD`), o `null` si todavía no llegó. */
	readonly hoy: string | null
	readonly recargar: () => void
}

const Contexto = createContext<ContextoPanel>({ salud: null, empresa: null, hoy: null, recargar: () => {} })

export function ProveedorPanel({ children }: { children: ReactNode }) {
	const salud = useRecurso<Salud>('/api/salud')
	const configuracion = useRecurso<Configuracion>('/api/configuracion')

	const valor = useMemo<ContextoPanel>(() => ({
		salud: salud.dato,
		empresa: configuracion.dato?.empresa ?? null,
		hoy: salud.dato?.sandbox.hoy ?? null,
		recargar: () => {
			salud.recargar(true)
			configuracion.recargar(true)
		},
	}), [salud, configuracion])

	return <Contexto value={valor}>{children}</Contexto>
}

export const usePanel = (): ContextoPanel => use(Contexto)
