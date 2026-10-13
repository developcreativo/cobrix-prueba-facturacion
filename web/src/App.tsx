import { Route, Routes, useLocation } from 'react-router-dom'
import { useEffect } from 'react'

import { AppShell } from '@/components/app-shell'
import { EstadoVacio } from '@/components/estados'
import { EncabezadoPagina } from '@/components/piezas'
import { Card } from '@/components/ui/card'
import { TooltipProvider } from '@/components/ui/tooltip'
import { PaginaClientes } from '@/paginas/clientes'
import { PaginaConfiguracion } from '@/paginas/configuracion'
import { PaginaCorrida } from '@/paginas/corrida'
import { PaginaExpediente } from '@/paginas/expediente'
import { PaginaResumen } from '@/paginas/resumen'
import { PaginaSincronizacion } from '@/paginas/sincronizacion'

const TITULOS: Readonly<Record<string, string>> = {
	'/': 'Resumen',
	'/clientes': 'Clientes',
	'/sincronizacion': 'Sincronización',
	'/configuracion': 'Configuración',
}

/** El título del documento sigue a la ruta, incluida la de «no encontrada». */
function tituloDe(ruta: string): string {
	const fijo = TITULOS[ruta]
	if (fijo !== undefined) return fijo
	if (ruta.startsWith('/corridas/')) return 'Corrida'
	if (ruta.startsWith('/clientes/')) return 'Cliente'
	return 'Página no encontrada'
}

/** Al cambiar de ruta: título del documento y foco al principio del contenido. */
function AlNavegar() {
	const { pathname } = useLocation()
	useEffect(() => {
		document.title = `${tituloDe(pathname)} · Cobrix`
		window.scrollTo({ top: 0 })
	}, [pathname])
	return null
}

function PaginaNoEncontrada() {
	return (
		<>
			<EncabezadoPagina titulo="Página no encontrada" />
			<Card>
				<EstadoVacio
					titulo="Esta dirección no existe en el panel"
					descripcion="Puede que el enlace esté viejo. Vuelve al resumen y sigue desde ahí."
					accion={{ a: '/', etiqueta: 'Ir al resumen' }}
				/>
			</Card>
		</>
	)
}

export default function App() {
	return (
		<TooltipProvider>
			<AlNavegar />
			<AppShell>
				<Routes>
					<Route path="/" element={<PaginaResumen />} />
					<Route path="/configuracion" element={<PaginaConfiguracion />} />
					<Route path="/sincronizacion" element={<PaginaSincronizacion />} />
					<Route path="/corridas/:id" element={<PaginaCorrida />} />
					<Route path="/clientes" element={<PaginaClientes />} />
					<Route path="/clientes/:id" element={<PaginaExpediente />} />
					<Route path="*" element={<PaginaNoEncontrada />} />
				</Routes>
			</AppShell>
		</TooltipProvider>
	)
}
