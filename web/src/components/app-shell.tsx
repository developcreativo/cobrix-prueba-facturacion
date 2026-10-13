import { CircleDollarSign, LayoutDashboard, RefreshCw, Settings, Users } from 'lucide-react'
import type { ComponentType } from 'react'
import { NavLink, useLocation } from 'react-router-dom'

import { BotonTema } from '@/components/tema'
import { FECHA_SANDBOX, RESUMEN } from '@/datos/ejemplo'
import { fecha, periodo } from '@/lib/formato'
import { cn } from '@/lib/utils'

/**
 * Armazón del panel: barra lateral en escritorio, barra inferior fija en móvil.
 *
 * El contenido nunca se desplaza en horizontal: la navegación de móvil es una barra
 * de cuatro destinos con icono y texto, que cabe en 360 px.
 */

interface Destino {
	readonly ruta: string
	readonly etiqueta: string
	readonly corto: string
	readonly icono: ComponentType<{ className?: string }>
}

const DESTINOS: readonly Destino[] = [
	{ ruta: '/', etiqueta: 'Resumen', corto: 'Resumen', icono: LayoutDashboard },
	{ ruta: '/clientes', etiqueta: 'Clientes', corto: 'Clientes', icono: Users },
	{ ruta: '/sincronizacion', etiqueta: 'Sincronización', corto: 'Sincronizar', icono: RefreshCw },
	{ ruta: '/configuracion', etiqueta: 'Configuración', corto: 'Ajustes', icono: Settings },
]

const esActivo = (ruta: string, actual: string): boolean =>
	ruta === '/' ? actual === '/' : actual === ruta || actual.startsWith(`${ruta}/`) || (ruta === '/sincronizacion' && actual.startsWith('/corridas'))

function Marca({ compacta = false }: { compacta?: boolean }) {
	return (
		<div className="flex items-center gap-2.5">
			<span className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground" aria-hidden="true">
				<CircleDollarSign className="size-5" />
			</span>
			<span className="grid">
				<span className="font-heading leading-tight font-semibold">Cobrix</span>
				{!compacta && <span className="text-xs leading-tight text-muted-foreground">Sincronización con el ISP</span>}
			</span>
		</div>
	)
}

export function AppShell({ children }: { children: React.ReactNode }) {
	const { pathname } = useLocation()

	return (
		<div className="min-h-dvh bg-background">
			<a href="#contenido" className="salto-contenido">
				Saltar al contenido
			</a>

			{/* Barra lateral: solo escritorio */}
			<aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col gap-6 border-r border-border bg-sidebar px-3 py-5 md:flex">
				<div className="px-2">
					<Marca />
				</div>
				<nav aria-label="Secciones del panel" className="grid gap-0.5">
					{DESTINOS.map(destino => (
						<NavLink
							key={destino.ruta}
							to={destino.ruta}
							aria-current={esActivo(destino.ruta, pathname) ? 'page' : undefined}
							className={cn(
								'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
								esActivo(destino.ruta, pathname) && 'bg-sidebar-accent text-sidebar-accent-foreground',
							)}
						>
							<destino.icono className="size-4 shrink-0" aria-hidden="true" />
							{destino.etiqueta}
						</NavLink>
					))}
				</nav>
				<div className="mt-auto grid gap-2 px-2 text-xs text-muted-foreground">
					<div className="flex items-center justify-between gap-2">
						<span className="truncate" title={RESUMEN.empresa.nombre}>
							{RESUMEN.empresa.nombre}
						</span>
						<BotonTema />
					</div>
					<p>
						Fecha del sandbox: {fecha(FECHA_SANDBOX)} · mes {periodo(RESUMEN.sandbox.periodo_actual)}
					</p>
				</div>
			</aside>

			{/* Barra superior: solo móvil */}
			<header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-border bg-sidebar px-4 py-2.5 md:hidden">
				<Marca compacta />
				<BotonTema />
			</header>

			<main id="contenido" tabIndex={-1} className="mx-auto w-full max-w-[1280px] px-4 pt-5 pb-28 md:pb-12 md:pl-64 lg:px-8 lg:pl-[17rem]">
				{children}
				<p className="mt-10 text-xs text-muted-foreground md:hidden">
					{RESUMEN.empresa.nombre} · sandbox {fecha(FECHA_SANDBOX)}
				</p>
			</main>

			{/* Navegación de móvil */}
			<nav
				aria-label="Secciones del panel"
				className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-border bg-sidebar pb-[env(safe-area-inset-bottom)] md:hidden"
			>
				{DESTINOS.map(destino => (
					<NavLink
						key={destino.ruta}
						to={destino.ruta}
						aria-current={esActivo(destino.ruta, pathname) ? 'page' : undefined}
						className={cn(
							'flex flex-col items-center gap-1 px-1 py-2 text-[11px] font-medium text-muted-foreground transition-colors',
							esActivo(destino.ruta, pathname) && 'text-primary',
						)}
					>
						<destino.icono className="size-5" aria-hidden="true" />
						{destino.corto}
					</NavLink>
				))}
			</nav>
		</div>
	)
}
