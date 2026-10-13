import { ArrowLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

/** Piezas comunes a todas las pantallas: encabezado, tarjeta de dato, bloques de datos. */

export function EncabezadoPagina({
	titulo,
	descripcion,
	acciones,
	volver,
	meta,
}: {
	titulo: string
	descripcion?: ReactNode
	acciones?: ReactNode
	volver?: { a: string; etiqueta: string }
	meta?: ReactNode
}) {
	return (
		<div className="mb-6 grid gap-3">
			{volver && (
				<Link
					to={volver.a}
					className="inline-flex w-fit items-center gap-1.5 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground"
				>
					<ArrowLeft className="size-4" aria-hidden="true" />
					{volver.etiqueta}
				</Link>
			)}
			<div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
				<div className="grid gap-1.5">
					<h1 className="font-heading text-2xl leading-tight font-semibold tracking-tight">{titulo}</h1>
					{descripcion && <p className="max-w-[72ch] text-sm text-muted-foreground">{descripcion}</p>}
					{meta && <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">{meta}</div>}
				</div>
				{acciones && <div className="flex flex-wrap items-center gap-2">{acciones}</div>}
			</div>
		</div>
	)
}

/** Tarjeta de un número grande con su etiqueta. */
export function TarjetaDato({
	etiqueta,
	valor,
	pie,
	acento = false,
}: {
	etiqueta: string
	valor: ReactNode
	pie?: ReactNode
	acento?: boolean
}) {
	// Un monto («USD 1.235,00») no cabe al mismo cuerpo que un contador de dos cifras cuando hay
	// seis tarjetas en fila: el tamaño baja según lo largo que sea el valor, y así nunca se corta.
	const largo = typeof valor === 'string' ? valor.length : 0
	return (
		<Card size="sm" className={cn('gap-1 px-4 py-3.5', acento && 'ring-2 ring-primary/30')}>
			<span className="text-xs font-medium text-muted-foreground">{etiqueta}</span>
			<span
				className={cn(
					'tabular font-heading leading-tight font-semibold whitespace-nowrap',
					largo > 9 ? 'text-base sm:text-lg' : 'text-lg sm:text-2xl',
				)}
			>
				{valor}
			</span>
			{pie && <span className="text-xs leading-snug text-muted-foreground">{pie}</span>}
		</Card>
	)
}

export function RejillaDatos({ children, className }: { children: ReactNode; className?: string }) {
	return <div className={cn('grid grid-cols-2 gap-3 lg:grid-cols-4', className)}>{children}</div>
}

/** Lista de pares etiqueta/valor, legible también en 360 px. */
export function ListaDeDatos({ children, className }: { children: ReactNode; className?: string }) {
	return <dl className={cn('grid gap-x-6 gap-y-2.5 text-sm sm:grid-cols-[minmax(10rem,auto)_minmax(0,1fr)]', className)}>{children}</dl>
}

export function Dato({ etiqueta, children, mono = false }: { etiqueta: string; children: ReactNode; mono?: boolean }) {
	return (
		<div className="grid gap-0.5 sm:col-span-2 sm:grid-cols-subgrid sm:items-baseline">
			<dt className="pr-4 text-muted-foreground">{etiqueta}</dt>
			<dd className={cn('min-w-0 break-words', mono && 'font-mono text-[0.8rem]')}>{children}</dd>
		</div>
	)
}

/**
 * Sección con título y, dentro, una tabla o una lista.
 *
 * En escritorio la caja es una tarjeta; en móvil no hay caja, porque la tabla ya se convirtió
 * en tarjetas y anidar bordes solo roba ancho.
 */
export function Seccion({
	titulo,
	descripcion,
	accion,
	children,
	nota,
	id,
}: {
	titulo: string
	descripcion?: ReactNode
	accion?: ReactNode
	children: ReactNode
	nota?: ReactNode
	id?: string
}) {
	return (
		<section className="grid gap-3" aria-labelledby={id}>
			<div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
				<div className="grid gap-0.5">
					<h2 id={id} className="font-heading text-base font-medium">
						{titulo}
					</h2>
					{descripcion && <p className="text-sm text-muted-foreground">{descripcion}</p>}
				</div>
				{accion}
			</div>
			<div className="min-w-0 md:overflow-hidden md:rounded-xl md:bg-card md:ring-1 md:ring-foreground/10">{children}</div>
			{nota && <p className="text-xs text-muted-foreground">{nota}</p>}
		</section>
	)
}

export function SkeletonTabla({ filas = 5 }: { filas?: number }) {
	return (
		<div className="grid gap-2 p-1" aria-hidden="true">
			<Skeleton className="h-8 w-full" />
			{Array.from({ length: filas }, (_, i) => (
				<Skeleton key={i} className="h-12 w-full" />
			))}
		</div>
	)
}

export function SkeletonTarjetas({ cantidad = 4 }: { cantidad?: number }) {
	return (
		<RejillaDatos>
			{Array.from({ length: cantidad }, (_, i) => (
				<Skeleton key={i} className="h-[4.75rem] w-full rounded-xl" />
			))}
		</RejillaDatos>
	)
}

/** Identificadores y claves técnicas: monoespaciado y discreto. */
export function Codigo({ children, className }: { children: ReactNode; className?: string }) {
	return <span className={cn('font-mono text-[0.8rem] text-muted-foreground', className)}>{children}</span>
}
