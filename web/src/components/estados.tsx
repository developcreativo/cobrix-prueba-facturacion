import { Inbox, RotateCw, TriangleAlert } from 'lucide-react'
import type { ComponentType, ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Codigo } from '@/components/piezas'
import type { ErrorPanel } from '@/tipos/panel'

/**
 * Vacíos y errores.
 *
 * Un vacío explica qué hacer y lleva a la acción; un error dice **qué pasó** y **cómo seguir**.
 * La sugerencia sale del `codigo` del error (SPEC §3.8), que es estable, y si no se conoce,
 * del `detalle` que mandó el backend.
 */

export function EstadoVacio({
	titulo,
	descripcion,
	icono: Icono = Inbox,
	accion,
	children,
}: {
	titulo: string
	descripcion: ReactNode
	icono?: ComponentType<{ className?: string }>
	accion?: { a: string; etiqueta: string }
	children?: ReactNode
}) {
	return (
		<div className="grid justify-items-center gap-3 px-6 py-12 text-center">
			<span className="grid size-11 place-items-center rounded-full bg-muted text-muted-foreground" aria-hidden="true">
				<Icono className="size-5" />
			</span>
			<div className="grid gap-1">
				<p className="font-heading text-base font-medium">{titulo}</p>
				<p className="mx-auto max-w-[48ch] text-sm text-muted-foreground">{descripcion}</p>
			</div>
			{accion && (
				<Button asChild size="lg" className="mt-1">
					<Link to={accion.a}>{accion.etiqueta}</Link>
				</Button>
			)}
			{children}
		</div>
	)
}

/**
 * Atajos a la pantalla que arregla cada error, por código (`CodigoError` del cliente del ISP).
 * **La sugerencia la redacta el backend**; esto solo añade el enlace para no obligar al operador
 * a buscar la pantalla a mano.
 */
const DESTINO: Readonly<Record<string, { readonly a: string; readonly etiqueta: string }>> = {
	credenciales: { a: '/configuracion', etiqueta: 'Ir a Configuración → Administrador de facturas' },
	autorizacion: { a: '/configuracion', etiqueta: 'Probar la conexión' },
	red: { a: '/configuracion', etiqueta: 'Revisar la URL de la API' },
	corrida_en_curso: { a: '/sincronizacion', etiqueta: 'Ver la corrida en curso' },
}

export function BloqueError({
	error,
	alReintentar,
	accion,
	titulo = 'No se pudieron cargar los datos',
}: {
	error: ErrorPanel
	alReintentar?: () => void
	/** Un atajo propio de la pantalla, cuando el error tiene un destino concreto. */
	accion?: ReactNode
	titulo?: string
}) {
	const destino = DESTINO[error.codigo]
	return (
		<Card className="border border-bad-line bg-bad-soft/40 px-5 py-5 ring-0">
			<div className="grid gap-2.5 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-x-3.5">
				<span className="grid size-8 place-items-center rounded-full bg-bad-soft text-bad" aria-hidden="true">
					<TriangleAlert className="size-4" />
				</span>
				<div className="grid gap-2">
					<div className="grid gap-1">
						<p className="font-heading font-medium text-bad">{titulo}</p>
						<p className="text-sm">{error.mensaje}</p>
					</div>
					{error.sugerencia && <p className="text-sm text-muted-foreground">{error.sugerencia}</p>}
					<p className="flex flex-wrap items-center gap-x-3 gap-y-1">
						<Codigo>código: {error.codigo}</Codigo>
						{error.endpoint && <Codigo>{error.endpoint}</Codigo>}
						{error.status !== null && <Codigo>HTTP {error.status}</Codigo>}
					</p>
					{(alReintentar || destino || accion) && (
						<div className="mt-1 flex flex-wrap gap-2">
							{accion}
							{alReintentar && (
								<Button variant="outline" size="sm" onClick={alReintentar}>
									<RotateCw aria-hidden="true" />
									Reintentar
								</Button>
							)}
							{destino && (
								<Button asChild variant="ghost" size="sm">
									<Link to={destino.a}>{destino.etiqueta}</Link>
								</Button>
							)}
						</div>
					)}
				</div>
			</div>
		</Card>
	)
}
