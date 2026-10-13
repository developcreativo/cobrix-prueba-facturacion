import { createContext, use, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'

import { Button } from '@/components/ui/button'

/**
 * Tema claro / oscuro / el del sistema.
 *
 * Solo pone o quita la clase `dark` en `<html>`: todos los colores salen de los tokens
 * de `index.css`. La preferencia se guarda en `localStorage` y el script de `index.html`
 * la aplica antes del primer pintado para que no haya parpadeo.
 */

export type Tema = 'claro' | 'oscuro' | 'sistema'

const CLAVE = 'cobrix-tema'

interface ContextoTema {
	readonly tema: Tema
	readonly cambiar: (tema: Tema) => void
}

const Contexto = createContext<ContextoTema>({ tema: 'sistema', cambiar: () => {} })

const leerGuardado = (): Tema => {
	const guardado = typeof localStorage === 'undefined' ? null : localStorage.getItem(CLAVE)
	return guardado === 'claro' || guardado === 'oscuro' ? guardado : 'sistema'
}

const aplicar = (tema: Tema): void => {
	const oscuro = tema === 'oscuro' || (tema === 'sistema' && window.matchMedia('(prefers-color-scheme: dark)').matches)
	document.documentElement.classList.toggle('dark', oscuro)
}

export function ProveedorTema({ children }: { children: ReactNode }) {
	const [tema, setTema] = useState<Tema>(leerGuardado)

	useEffect(() => {
		aplicar(tema)
		const medio = window.matchMedia('(prefers-color-scheme: dark)')
		const alCambiarSistema = (): void => {
			if (tema === 'sistema') aplicar(tema)
		}
		medio.addEventListener('change', alCambiarSistema)
		return () => medio.removeEventListener('change', alCambiarSistema)
	}, [tema])

	const cambiar = useCallback((siguiente: Tema) => {
		setTema(siguiente)
		if (siguiente === 'sistema') localStorage.removeItem(CLAVE)
		else localStorage.setItem(CLAVE, siguiente)
	}, [])

	const valor = useMemo(() => ({ tema, cambiar }), [tema, cambiar])
	return <Contexto value={valor}>{children}</Contexto>
}

export const useTema = (): ContextoTema => use(Contexto)

const SIGUIENTE: Record<Tema, Tema> = { sistema: 'claro', claro: 'oscuro', oscuro: 'sistema' }
const NOMBRE: Record<Tema, string> = { sistema: 'el del sistema', claro: 'claro', oscuro: 'oscuro' }

/** Botón que rota entre sistema → claro → oscuro, diciendo siempre en qué tema está. */
export function BotonTema({ className }: { className?: string }) {
	const { tema, cambiar } = useTema()
	const Icono = tema === 'claro' ? Sun : tema === 'oscuro' ? Moon : Monitor
	return (
		<Button
			variant="ghost"
			size="icon-sm"
			className={className}
			onClick={() => cambiar(SIGUIENTE[tema])}
			title={`Tema ${NOMBRE[tema]}. Cambiar a ${NOMBRE[SIGUIENTE[tema]]}`}
		>
			<Icono aria-hidden="true" />
			<span className="sr-only">{`Tema ${NOMBRE[tema]}. Cambiar a ${NOMBRE[SIGUIENTE[tema]]}`}</span>
		</Button>
	)
}
