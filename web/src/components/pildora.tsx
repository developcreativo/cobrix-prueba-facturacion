import { AlertTriangle, Check, CircleDot, Info, Minus } from 'lucide-react'
import type { ComponentType, ReactNode } from 'react'

import { Badge } from '@/components/ui/badge'
import {
	CLASES_TONO,
	ETIQUETA_CORRIDA,
	ETIQUETA_FACTURA,
	TONO_CONTRATO,
	TONO_CORRIDA,
	TONO_FACTURA,
	etiquetaResultado,
	tonoResultado,
} from '@/lib/resultados'
import { cn } from '@/lib/utils'
import type { EstadoContrato, EstadoCorrida, EstadoFactura, Resultado, Tono } from '@/tipos/panel'

/**
 * Píldora de estado: color **y** texto, nunca solo color. Cada tono lleva además su propio
 * icono, para que se distinga también en escala de grises o con daltonismo.
 */

const ICONO: Record<Tono, ComponentType<{ className?: string }>> = {
	ok: Check,
	warn: AlertTriangle,
	bad: CircleDot,
	info: Info,
	mute: Minus,
}

export function Pildora({
	tono,
	children,
	className,
	conIcono = true,
}: {
	tono: Tono
	children: ReactNode
	className?: string
	conIcono?: boolean
}) {
	const Icono = ICONO[tono]
	return (
		<Badge className={cn('h-auto border px-2 py-0.5 text-xs leading-5 font-medium whitespace-normal', CLASES_TONO[tono], className)}>
			{conIcono && <Icono className="size-3 shrink-0" aria-hidden="true" />}
			{children}
		</Badge>
	)
}

export function PildoraResultado({ resultado, simulacion = false, className }: { resultado: Resultado; simulacion?: boolean; className?: string }) {
	return (
		<Pildora tono={tonoResultado(resultado)} className={className}>
			{etiquetaResultado(resultado, simulacion)}
		</Pildora>
	)
}

export function PildoraContrato({ estado }: { estado: EstadoContrato }) {
	return <Pildora tono={TONO_CONTRATO[estado]}>{estado}</Pildora>
}

export function PildoraFactura({ estado }: { estado: EstadoFactura }) {
	return <Pildora tono={TONO_FACTURA[estado]}>{ETIQUETA_FACTURA[estado]}</Pildora>
}

export function PildoraCorrida({ estado }: { estado: EstadoCorrida }) {
	return <Pildora tono={TONO_CORRIDA[estado]}>{ETIQUETA_CORRIDA[estado]}</Pildora>
}

/** Marca una corrida que no escribió nada. */
export function PildoraSimulacion() {
	return (
		<Pildora tono="info" conIcono={false} className="border-dashed">
			Simulación
		</Pildora>
	)
}
