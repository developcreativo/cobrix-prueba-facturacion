import { CheckCircle2, PlugZap, TriangleAlert } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'

import { BloqueError } from '@/components/estados'
import { Pildora } from '@/components/pildora'
import { EncabezadoPagina } from '@/components/piezas'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { CONFIGURACION, ERROR_EJEMPLO, PRUEBA_CONEXION_ERROR, PRUEBA_CONEXION_OK } from '@/datos/ejemplo'
import { fechaHora } from '@/lib/formato'
import { cn } from '@/lib/utils'
import { useVista } from '@/lib/vista'
import type { EstadoContrato, PruebaConexion, TipoDocumento } from '@/tipos/panel'

/** Configuración (§3.1): empresa y proveedor, con las opciones de importación agrupadas. */

const ESTADOS: readonly EstadoContrato[] = ['ACTIVO', 'CORTADO', 'CORTESIA', 'RETIRADO', 'RECHAZADO', 'ANULADO']
const TIPOS: readonly TipoDocumento[] = ['V', 'E', 'J', 'G', 'P']
const VENTANAS = [
	{ valor: 'sin', etiqueta: 'Sin ventana: todas las cuotas' },
	{ valor: '3', etiqueta: 'Últimos 3 meses' },
	{ valor: '6', etiqueta: 'Últimos 6 meses' },
	{ valor: '9', etiqueta: 'Últimos 9 meses' },
	{ valor: '12', etiqueta: 'Últimos 12 meses' },
] as const

function Campo({
	id,
	etiqueta,
	ayuda,
	error,
	children,
	className,
}: {
	id: string
	etiqueta: string
	ayuda?: string
	error?: string
	children: ReactNode
	className?: string
}) {
	return (
		// Label arriba, control, y la ayuda debajo: así los controles de una misma fila
		// quedan alineados aunque unos tengan ayuda y otros no.
		<div className={cn('grid content-start gap-1.5', className)}>
			<Label htmlFor={id}>{etiqueta}</Label>
			{children}
			{ayuda && (
				<p id={`${id}-ayuda`} className="text-xs text-muted-foreground">
					{ayuda}
				</p>
			)}
			{error && (
				<p id={`${id}-error`} role="alert" className="flex items-center gap-1.5 text-xs text-bad">
					<TriangleAlert className="size-3.5" aria-hidden="true" />
					{error}
				</p>
			)}
		</div>
	)
}

function GrupoCasillas({
	leyenda,
	ayuda,
	opciones,
	seleccionadas,
	alCambiar,
	error,
}: {
	leyenda: string
	ayuda?: string
	opciones: readonly string[]
	seleccionadas: readonly string[]
	alCambiar: (valor: string, activa: boolean) => void
	error?: string
}) {
	const id = useId()
	return (
		<fieldset
			className="grid gap-2 rounded-lg border border-border px-3.5 py-3"
			aria-invalid={error ? true : undefined}
			aria-describedby={error ? `${id}-error` : undefined}
		>
			<legend className="px-1 text-sm font-medium">{leyenda}</legend>
			{ayuda && <p className="text-xs text-muted-foreground">{ayuda}</p>}
			<div className="flex flex-wrap gap-x-5 gap-y-2.5">
				{opciones.map(opcion => (
					<div key={opcion} className="flex items-center gap-2">
						<Checkbox
							id={`${id}-${opcion}`}
							checked={seleccionadas.includes(opcion)}
							onCheckedChange={estado => alCambiar(opcion, estado === true)}
						/>
						<Label htmlFor={`${id}-${opcion}`} className="font-normal">
							{opcion}
						</Label>
					</div>
				))}
			</div>
			{error && (
				<p id={`${id}-error`} role="alert" className="flex items-center gap-1.5 text-xs text-bad">
					<TriangleAlert className="size-3.5" aria-hidden="true" />
					{error}
				</p>
			)}
		</fieldset>
	)
}

function Aviso({ tono, children }: { tono: 'ok' | 'bad'; children: ReactNode }) {
	return (
		<p
			className={
				tono === 'ok'
					? 'flex items-start gap-2 rounded-lg border border-ok-line bg-ok-soft/60 px-3 py-2 text-sm'
					: 'flex items-start gap-2 rounded-lg border border-bad-line bg-bad-soft/60 px-3 py-2 text-sm'
			}
		>
			{tono === 'ok' ? (
				<CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden="true" />
			) : (
				<TriangleAlert className="mt-0.5 size-4 shrink-0 text-bad" aria-hidden="true" />
			)}
			<span>{children}</span>
		</p>
	)
}

export function PaginaConfiguracion() {
	const vista = useVista()
	const { empresa, proveedor } = CONFIGURACION

	const [nombre, setNombre] = useState(empresa.nombre)
	const [rif, setRif] = useState(empresa.rif)
	const [correo, setCorreo] = useState(empresa.email_cobranza)
	const [empresaGuardada, setEmpresaGuardada] = useState(false)

	const [nombreProveedor, setNombreProveedor] = useState(proveedor.nombre)
	const [url, setUrl] = useState(proveedor.api_url)
	const [usuario, setUsuario] = useState(proveedor.usuario)
	const [password, setPassword] = useState('')
	const [estados, setEstados] = useState<string[]>([...proveedor.estados_importables])
	const [ventana, setVentana] = useState(proveedor.ventana_meses === null ? 'sin' : String(proveedor.ventana_meses))
	const [recientes, setRecientes] = useState(proveedor.max_cuotas_recientes === null ? '' : String(proveedor.max_cuotas_recientes))
	const [gracia, setGracia] = useState(String(proveedor.dias_gracia))
	const [topeFacturas, setTopeFacturas] = useState(proveedor.tope_facturas === null ? '' : String(proveedor.tope_facturas))
	const [topeMonto, setTopeMonto] = useState(proveedor.tope_monto_centavos === null ? '' : String(proveedor.tope_monto_centavos / 100))
	const [excluidos, setExcluidos] = useState<string[]>([...proveedor.excluir_tipos_documento])
	const [autoActiva, setAutoActiva] = useState(proveedor.auto_activa)
	const [autoHora, setAutoHora] = useState(proveedor.auto_hora ?? '03:00')
	const [proveedorGuardado, setProveedorGuardado] = useState(false)
	const [prueba, setPrueba] = useState<PruebaConexion | null>(null)
	const [probando, setProbando] = useState(false)

	const correoInvalido = correo.trim() !== '' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)
	const sinEstados = estados.length === 0

	const alternar = (lista: string[], valor: string, activa: boolean): string[] =>
		activa ? [...lista, valor] : lista.filter(item => item !== valor)

	const probarConexion = (): void => {
		setProbando(true)
		setPrueba(null)
		// Demostración sin backend: una contraseña distinta de la del sandbox falla.
		window.setTimeout(() => {
			setPrueba(password === '' || password === 'cobrix-sandbox' ? PRUEBA_CONEXION_OK : PRUEBA_CONEXION_ERROR)
			setProbando(false)
		}, 450)
	}

	if (vista === 'error') {
		return (
			<>
				<EncabezadoPagina titulo="Configuración" />
				<BloqueError error={ERROR_EJEMPLO} alReintentar={() => window.location.reload()} />
			</>
		)
	}

	if (vista === 'cargando') {
		return (
			<>
				<EncabezadoPagina titulo="Configuración" />
				<div className="grid gap-4">
					<Skeleton className="h-52 w-full rounded-xl" />
					<Skeleton className="h-[30rem] w-full rounded-xl" />
				</div>
			</>
		)
	}

	return (
		<>
			<EncabezadoPagina
				titulo="Configuración"
				descripcion="Los datos de la empresa y del administrador de facturas del ISP, con las mismas opciones de importación que usa Cobrix."
			/>

			<div className="grid gap-5">
				<form
					onSubmit={evento => {
						evento.preventDefault()
						if (!correoInvalido) setEmpresaGuardada(true)
					}}
				>
					<Card>
						<CardHeader>
							<CardTitle>Empresa</CardTitle>
							<CardDescription>Quién cobra. Aparece en el pie del panel y en los correos de cobranza.</CardDescription>
						</CardHeader>
						<CardContent className="grid gap-4">
							<div className="grid gap-4 md:grid-cols-3">
								<Campo id="empresa-nombre" etiqueta="Nombre">
									<Input id="empresa-nombre" value={nombre} onChange={evento => setNombre(evento.target.value)} required />
								</Campo>
								<Campo id="empresa-rif" etiqueta="RIF" ayuda="Con o sin guiones: J-00000000-0">
									<Input id="empresa-rif" value={rif} onChange={evento => setRif(evento.target.value)} aria-describedby="empresa-rif-ayuda" />
								</Campo>
								<Campo
									id="empresa-correo"
									etiqueta="Correo de cobranza"
									error={correoInvalido ? 'Escribe un correo válido, por ejemplo cobranza@example.com' : undefined}
								>
									<Input
										id="empresa-correo"
										type="email"
										value={correo}
										onChange={evento => setCorreo(evento.target.value)}
										aria-invalid={correoInvalido}
										aria-describedby={correoInvalido ? 'empresa-correo-error' : undefined}
									/>
								</Campo>
							</div>
							<p className="text-sm text-muted-foreground">
								Zona horaria y moneda: <strong className="font-medium text-foreground">{empresa.zona_horaria}</strong> ·{' '}
								<strong className="font-medium text-foreground">{empresa.moneda}</strong>. Toda la plata de la integración es {empresa.moneda}.
							</p>
							<div className="flex flex-wrap items-center gap-3">
								<Button type="submit">Guardar empresa</Button>
								<span aria-live="polite" className="text-sm text-ok">
									{empresaGuardada && 'Datos de la empresa guardados.'}
								</span>
							</div>
						</CardContent>
					</Card>
				</form>

				<form
					onSubmit={evento => {
						evento.preventDefault()
						if (!sinEstados) setProveedorGuardado(true)
					}}
				>
					<Card>
						<CardHeader>
							<CardTitle>Administrador de facturas</CardTitle>
							<CardDescription>De dónde salen los contratos y las cuotas, y con qué reglas se importan.</CardDescription>
							<CardAction>
								<Button type="button" variant="outline" onClick={probarConexion} disabled={probando}>
									<PlugZap aria-hidden="true" />
									{probando ? 'Probando…' : 'Probar conexión'}
								</Button>
							</CardAction>
						</CardHeader>
						<CardContent className="grid gap-5">
							<div aria-live="polite" className="empty:hidden">
								{probando && <p className="text-sm text-muted-foreground">Iniciando sesión en el administrador de facturas…</p>}
								{!probando && prueba?.ok && <Aviso tono="ok">{prueba.mensaje}</Aviso>}
								{!probando && prueba && !prueba.ok && (
									<Aviso tono="bad">
										{prueba.mensaje} {prueba.error?.sugerencia}
									</Aviso>
								)}
							</div>

							<div className="grid gap-4 md:grid-cols-3">
								<Campo id="proveedor-nombre" etiqueta="Nombre visible">
									<Input id="proveedor-nombre" value={nombreProveedor} onChange={evento => setNombreProveedor(evento.target.value)} />
								</Campo>
								<Campo id="proveedor-url" etiqueta="URL de la API" ayuda="Con o sin /api/v1. El simulador local es http://127.0.0.1:4310">
									<Input
										id="proveedor-url"
										type="url"
										value={url}
										onChange={evento => setUrl(evento.target.value)}
										aria-describedby="proveedor-url-ayuda"
										className="font-mono text-[0.8rem]"
									/>
								</Campo>
								<Campo id="proveedor-usuario" etiqueta="Usuario o correo">
									<Input id="proveedor-usuario" value={usuario} onChange={evento => setUsuario(evento.target.value)} autoComplete="username" />
								</Campo>
								<Campo id="proveedor-password" etiqueta="Contraseña" ayuda="Déjala vacía para conservar la actual. Nunca se muestra.">
									<Input
										id="proveedor-password"
										type="password"
										value={password}
										placeholder="••••••••"
										onChange={evento => setPassword(evento.target.value)}
										autoComplete="current-password"
										aria-describedby="proveedor-password-ayuda"
									/>
								</Campo>
								<div className="flex items-start pt-7">
									{proveedor.password_definida ? <Pildora tono="ok">Hay una contraseña guardada</Pildora> : <Pildora tono="warn">Sin contraseña</Pildora>}
								</div>
							</div>

							<GrupoCasillas
								leyenda="Estados de contrato que se importan"
								ayuda="Por defecto ACTIVO y CORTADO. Las cuotas de un contrato en otro estado salen como «Excluida por estado»."
								opciones={ESTADOS}
								seleccionadas={estados}
								alCambiar={(valor, activa) => setEstados(lista => alternar(lista, valor, activa))}
								error={sinEstados ? 'Elige al menos un estado: con la lista vacía no se importaría nada.' : undefined}
							/>

							<div className="grid gap-4 md:grid-cols-3">
								<Campo id="ventana" etiqueta="Ventana de importación" ayuda="Solo cuotas desde el mes actual menos N meses.">
									<Select value={ventana} onValueChange={setVentana}>
										<SelectTrigger id="ventana" className="w-full">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{VENTANAS.map(opcion => (
												<SelectItem key={opcion.valor} value={opcion.valor}>
													{opcion.etiqueta}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</Campo>
								<Campo id="recientes" etiqueta="Máx. cuotas recientes por contrato" ayuda="Vacío = todas. De 1 a 60; se conservan las más recientes.">
									<Input
										id="recientes"
										type="number"
										min={1}
										max={60}
										value={recientes}
										placeholder="todas"
										onChange={evento => setRecientes(evento.target.value)}
										aria-describedby="recientes-ayuda"
									/>
								</Campo>
								<Campo id="gracia" etiqueta="Días de gracia para el corte" ayuda="Corte = vencimiento + días. De 0 a 60.">
									<Input
										id="gracia"
										type="number"
										min={0}
										max={60}
										value={gracia}
										onChange={evento => setGracia(evento.target.value)}
										aria-describedby="gracia-ayuda"
									/>
								</Campo>
								<Campo id="tope-facturas" etiqueta="Tope de facturas nuevas por corrida" ayuda="Vacío = sin tope. Lo que exceda queda frenado, no se importa.">
									<Input
										id="tope-facturas"
										type="number"
										min={1}
										value={topeFacturas}
										placeholder="sin tope"
										onChange={evento => setTopeFacturas(evento.target.value)}
										aria-describedby="tope-facturas-ayuda"
									/>
								</Campo>
								<Campo id="tope-monto" etiqueta="Tope de monto nuevo por corrida (USD)" ayuda="Vacío = sin tope.">
									<Input
										id="tope-monto"
										type="number"
										min={0}
										step="0.01"
										value={topeMonto}
										placeholder="sin tope"
										onChange={evento => setTopeMonto(evento.target.value)}
										aria-describedby="tope-monto-ayuda"
									/>
								</Campo>
							</div>

							<GrupoCasillas
								leyenda="Excluir por tipo de documento del titular"
								ayuda="J y G son personas jurídicas; el resto, naturales."
								opciones={TIPOS}
								seleccionadas={excluidos}
								alCambiar={(valor, activa) => setExcluidos(lista => alternar(lista, valor, activa))}
							/>

							<fieldset className="grid gap-3 rounded-lg border border-border px-3.5 py-3">
								<legend className="px-1 text-sm font-medium">Corrida automática</legend>
								<div className="flex flex-wrap items-center gap-x-6 gap-y-3">
									<div className="flex items-center gap-2.5">
										<Switch id="auto-activa" checked={autoActiva} onCheckedChange={setAutoActiva} />
										<Label htmlFor="auto-activa" className="font-normal">
											Importar y actualizar pagadas una vez al día
										</Label>
									</div>
									<div className="flex items-center gap-2">
										<Label htmlFor="auto-hora" className="font-normal">
											A las
										</Label>
										<Input
											id="auto-hora"
											type="time"
											value={autoHora}
											disabled={!autoActiva}
											onChange={evento => setAutoHora(evento.target.value)}
											className="w-32"
										/>
										<span className="text-sm text-muted-foreground">({empresa.zona_horaria})</span>
									</div>
								</div>
								<p className="text-xs text-muted-foreground">
									Corre primero la importación y después la actualización de pagadas, en ese orden y sin simular.
								</p>
							</fieldset>

							<div className="flex flex-wrap items-center gap-3">
								<Button type="submit">Guardar proveedor</Button>
								<span className="text-sm text-muted-foreground">Última modificación: {fechaHora(proveedor.actualizado_en)}</span>
								<span aria-live="polite" className="text-sm text-ok">
									{proveedorGuardado && 'Configuración del proveedor guardada.'}
								</span>
							</div>
						</CardContent>
					</Card>
				</form>
			</div>
		</>
	)
}
