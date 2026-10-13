import { ChevronRight } from 'lucide-react'
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'

/**
 * Tabla que a menos de `md` se convierte en tarjetas.
 *
 * Es la misma información en los dos formatos: a partir de 768 px, una tabla con cabeceras;
 * por debajo (incluido 360 px), una tarjeta por fila con el título arriba y los pares
 * etiqueta/valor debajo. Nada se desborda en horizontal y nada se pierde.
 */

export interface Columna<T> {
	readonly clave: string
	readonly cabecera: string
	readonly celda: (fila: T) => ReactNode
	/** Alineada a la derecha y con cifras tabulares: montos y contadores. */
	readonly numerica?: boolean
	/** Se omite en la tarjeta de móvil (normalmente porque ya está en el título). */
	readonly soloTabla?: boolean
	/** Deja que el texto se parta en varias líneas (descripciones, direcciones). */
	readonly envuelve?: boolean
	readonly className?: string
}

interface Props<T> {
	readonly columnas: readonly Columna<T>[]
	readonly filas: readonly T[]
	readonly claveFila: (fila: T) => string
	/** Convierte cada fila en un enlace (a la ficha correspondiente). */
	readonly enlaceFila?: (fila: T) => string
	/** Título de la tarjeta en móvil. */
	readonly tituloTarjeta: (fila: T) => ReactNode
	readonly subtituloTarjeta?: (fila: T) => ReactNode
	/** Descripción de la tabla para lectores de pantalla. */
	readonly etiqueta: string
}

export function TablaDatos<T>({ columnas, filas, claveFila, enlaceFila, tituloTarjeta, subtituloTarjeta, etiqueta }: Props<T>) {
	const navegar = useNavigate()

	/**
	 * Clic en cualquier punto de la fila (§3.5: «cada fila abre el expediente»).
	 *
	 * Es un atajo, no el enlace: el enlace de verdad sigue siendo el nombre, que es lo que ven el
	 * teclado y los lectores de pantalla, y lo que sabe abrirse en otra pestaña. Por eso aquí se
	 * ignoran los clics que ya tienen dueño, los que solo terminan una selección de texto y los
	 * que llevan modificador, que el usuario espera que abran pestaña y eso solo lo hace un `a`.
	 */
	const abrirFila = (evento: ReactMouseEvent<HTMLTableRowElement>, destino: string): void => {
		if (evento.defaultPrevented) return
		if (evento.target instanceof Element && evento.target.closest('a, button, input, select, textarea, label')) return
		if ((window.getSelection()?.toString() ?? '') !== '') return
		if (evento.metaKey || evento.ctrlKey || evento.shiftKey || evento.altKey) return
		navegar(destino)
	}

	return (
		<>
			{/* Escritorio */}
			<div className="hidden md:block">
				<Table>
					<caption className="sr-only">{etiqueta}</caption>
					<TableHeader>
						<TableRow className="bg-muted/60 hover:bg-muted/60">
							{columnas.map(columna => (
								<TableHead key={columna.clave} className={cn('text-xs text-muted-foreground', columna.numerica && 'text-right', columna.className)}>
									{columna.cabecera}
								</TableHead>
							))}
							{enlaceFila && <TableHead className="w-8" />}
						</TableRow>
					</TableHeader>
					<TableBody>
						{filas.map(fila => {
							const destino = enlaceFila?.(fila)
							return (
								<TableRow
									key={claveFila(fila)}
									className={cn('align-top', destino !== undefined && 'cursor-pointer')}
									onClick={destino === undefined ? undefined : evento => abrirFila(evento, destino)}
								>
									{columnas.map((columna, indice) => (
										<TableCell
											key={columna.clave}
											className={cn(
												'py-2.5',
												columna.envuelve && 'whitespace-normal',
												columna.numerica && 'tabular text-right',
												columna.className,
											)}
										>
											{indice === 0 && destino ? (
												<Link to={destino} className="font-medium text-primary underline-offset-4 hover:underline">
													{columna.celda(fila)}
												</Link>
											) : (
												columna.celda(fila)
											)}
										</TableCell>
									))}
									{destino && (
										<TableCell className="py-2.5 text-right">
											<Link to={destino} className="inline-grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
												<ChevronRight className="size-4" aria-hidden="true" />
												<span className="sr-only">Abrir</span>
											</Link>
										</TableCell>
									)}
								</TableRow>
							)
						})}
					</TableBody>
				</Table>
			</div>

			{/* Móvil */}
			<ul className="grid gap-2 md:hidden" aria-label={etiqueta}>
				{filas.map(fila => {
					const destino = enlaceFila?.(fila)
					const cuerpo = (
						<>
							<div className="flex items-start justify-between gap-3">
								<div className="grid min-w-0 gap-0.5">
									<span className={cn('font-medium', destino && 'text-primary')}>{tituloTarjeta(fila)}</span>
									{subtituloTarjeta && <span className="text-xs text-muted-foreground">{subtituloTarjeta(fila)}</span>}
								</div>
								{destino && <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
							</div>
							<dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
								{columnas
									.filter(columna => !columna.soloTabla)
									.map(columna => (
										<div key={columna.clave} className="col-span-2 grid grid-cols-subgrid items-baseline">
											<dt className="text-xs text-muted-foreground">{columna.cabecera}</dt>
											<dd className={cn('min-w-0 break-words', columna.numerica && 'tabular text-right')}>{columna.celda(fila)}</dd>
										</div>
									))}
							</dl>
						</>
					)
					return (
						<li key={claveFila(fila)}>
							{destino ? (
								<Link to={destino} className="grid gap-2 rounded-lg border border-border bg-card p-3 transition-colors hover:bg-muted/50">
									{cuerpo}
								</Link>
							) : (
								<div className="grid gap-2 rounded-lg border border-border bg-card p-3">{cuerpo}</div>
							)}
						</li>
					)
				})}
			</ul>
		</>
	)
}
