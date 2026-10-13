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
import { ErrorDeApi, guardarConfiguracion, probarConexion, useRecurso } from '@/datos/api'
import { usePanel } from '@/datos/panel'
import { cn } from '@/lib/utils'
import type { Configuracion, ErrorPanel, EstadoContrato, PruebaConexion, TipoDocumento } from '@/tipos/panel'

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

/** Texto del formulario a número, respetando «vacío = sin límite». */
const aEnteroONulo = (valor: string): number | null => (valor.trim() === '' ? null : Math.trunc(Number(valor)))
const aCentavosONulo = (valor: string): number | null => (valor.trim() === '' ? null : Math.round(Number(valor) * 100))

interface Formulario {
	readonly nombre: string
	readonly rif: string
	readonly correo: string
	readonly nombreProveedor: string
	readonly url: string
	readonly usuario: string
	readonly password: string
	readonly estados: readonly string[]
	readonly ventana: string
	readonly recientes: string
	readonly gracia: string
	readonly topeFacturas: string
	readonly topeMonto: string
	readonly excluidos: readonly string[]
	readonly autoActiva: boolean
	readonly autoHora: string
}

const desdeConfiguracion = ({ empresa, proveedor }: Configuracion): Formulario => ({
	nombre: empresa.nombre,
	rif: empresa.rif,
	correo: empresa.email_cobranza,
	nombreProveedor: proveedor.nombre,
	url: proveedor.api_url,
	usuario: proveedor.usuario,
	password: '',
	estados: [...proveedor.estados_importables],
	ventana: proveedor.ventana_meses === null ? 'sin' : String(proveedor.ventana_meses),
	recientes: proveedor.max_cuotas_recientes === null ? '' : String(proveedor.max_cuotas_recientes),
	gracia: String(proveedor.dias_gracia),
	topeFacturas: proveedor.tope_facturas === null ? '' : String(proveedor.tope_facturas),
	topeMonto: proveedor.tope_monto_centavos === null ? '' : String(proveedor.tope_monto_centavos / 100),
	excluidos: [...proveedor.excluir_tipos_documento],
	autoActiva: proveedor.auto_activa,
	autoHora: proveedor.auto_hora ?? '03:00',
})

export function PaginaConfiguracion() {
	const recurso = useRecurso<Configuracion>('/api/configuracion')
	const panel = usePanel()
	const configuracion = recurso.dato

	// El formulario se siembra con lo guardado en cuanto llega, y se vuelve a sembrar si la
	// configuración cambia por detrás (guardar devuelve la versión nueva).
	const [sembrada, setSembrada] = useState<Configuracion | null>(null)
	const [formulario, setFormulario] = useState<Formulario | null>(null)
	if (configuracion !== null && configuracion !== sembrada) {
		setSembrada(configuracion)
		setFormulario(desdeConfiguracion(configuracion))
	}
	const cambiar = (parche: Partial<Formulario>): void => setFormulario(actual => (actual === null ? actual : { ...actual, ...parche }))

	const [empresaGuardada, setEmpresaGuardada] = useState(false)
	const [errorEmpresa, setErrorEmpresa] = useState<ErrorPanel | null>(null)
	const [guardandoEmpresa, setGuardandoEmpresa] = useState(false)
	const [proveedorGuardado, setProveedorGuardado] = useState(false)
	const [errorProveedor, setErrorProveedor] = useState<ErrorPanel | null>(null)
	const [guardandoProveedor, setGuardandoProveedor] = useState(false)
	const [prueba, setPrueba] = useState<PruebaConexion | null>(null)
	const [probando, setProbando] = useState(false)

	const correoInvalido = formulario !== null && formulario.correo.trim() !== '' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(formulario.correo)
	const sinEstados = formulario !== null && formulario.estados.length === 0

	const alternar = (lista: readonly string[], valor: string, activa: boolean): string[] =>
		activa ? [...lista, valor] : lista.filter(item => item !== valor)

	const alGuardar = (bloque: 'empresa' | 'proveedor'): void => {
		if (formulario === null) return
		const esEmpresa = bloque === 'empresa'
		const marcarError = esEmpresa ? setErrorEmpresa : setErrorProveedor
		const marcarGuardado = esEmpresa ? setEmpresaGuardada : setProveedorGuardado
		const marcarEnCurso = esEmpresa ? setGuardandoEmpresa : setGuardandoProveedor

		marcarError(null)
		marcarGuardado(false)
		marcarEnCurso(true)
		guardarConfiguracion(
			esEmpresa
				? { empresa: { nombre: formulario.nombre, rif: formulario.rif, email_cobranza: formulario.correo } }
				: {
					proveedor: {
						nombre: formulario.nombreProveedor,
						api_url: formulario.url,
						usuario: formulario.usuario,
						// Vacía: se conserva la guardada. La contraseña entra y no sale.
						...(formulario.password === '' ? {} : { password: formulario.password }),
						estados_importables: formulario.estados as EstadoContrato[],
						ventana_meses: formulario.ventana === 'sin' ? null : Number(formulario.ventana),
						max_cuotas_recientes: aEnteroONulo(formulario.recientes),
						dias_gracia: Math.trunc(Number(formulario.gracia || '0')),
						tope_facturas: aEnteroONulo(formulario.topeFacturas),
						tope_monto_centavos: aCentavosONulo(formulario.topeMonto),
						excluir_tipos_documento: formulario.excluidos as TipoDocumento[],
						auto_activa: formulario.autoActiva,
						auto_hora: formulario.autoHora === '' ? null : formulario.autoHora,
					},
				},
		)
			.then(() => {
				marcarGuardado(true)
				if (!esEmpresa) cambiar({ password: '' })
				recurso.recargar(true)
				panel.recargar()
			})
			.catch((fallo: unknown) => marcarError(fallo instanceof ErrorDeApi ? fallo.detalle : null))
			.finally(() => marcarEnCurso(false))
	}

	/** Prueba lo que hay en el formulario, sin guardarlo. Nunca lanza: responde `ok: false`. */
	const alProbar = (): void => {
		if (formulario === null) return
		setProbando(true)
		setPrueba(null)
		probarConexion({ api_url: formulario.url, usuario: formulario.usuario, ...(formulario.password === '' ? {} : { password: formulario.password }) })
			.then(setPrueba)
			.catch((fallo: unknown) => {
				if (fallo instanceof ErrorDeApi) setPrueba({ ok: false, mensaje: fallo.detalle.mensaje, error: fallo.detalle })
			})
			.finally(() => setProbando(false))
	}

	if (recurso.error !== null) {
		return (
			<>
				<EncabezadoPagina titulo="Configuración" />
				<BloqueError error={recurso.error} alReintentar={() => recurso.recargar()} />
			</>
		)
	}

	if (configuracion === null || formulario === null) {
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

	const { empresa, proveedor } = configuracion

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
						if (!correoInvalido) alGuardar('empresa')
					}}
				>
					<Card>
						<CardHeader>
							<CardTitle>Empresa</CardTitle>
							<CardDescription>Quién cobra. Aparece en el pie del panel y en los correos de cobranza.</CardDescription>
						</CardHeader>
						<CardContent className="grid gap-4">
							{errorEmpresa && <BloqueError error={errorEmpresa} titulo="No se guardó la empresa" />}
							<div className="grid gap-4 md:grid-cols-3">
								<Campo id="empresa-nombre" etiqueta="Nombre">
									<Input id="empresa-nombre" value={formulario.nombre} onChange={evento => cambiar({ nombre: evento.target.value })} required />
								</Campo>
								<Campo id="empresa-rif" etiqueta="RIF" ayuda="Con o sin guiones: J-00000000-0">
									<Input id="empresa-rif" value={formulario.rif} onChange={evento => cambiar({ rif: evento.target.value })} aria-describedby="empresa-rif-ayuda" />
								</Campo>
								<Campo
									id="empresa-correo"
									etiqueta="Correo de cobranza"
									error={correoInvalido ? 'Escribe un formulario.correo válido, por ejemplo cobranza@example.com' : undefined}
								>
									<Input
										id="empresa-correo"
										type="email"
										value={formulario.correo}
										onChange={evento => cambiar({ correo: evento.target.value })}
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
								<Button type="submit" disabled={guardandoEmpresa}>
									{guardandoEmpresa ? 'Guardando…' : 'Guardar empresa'}
								</Button>
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
						if (!sinEstados) alGuardar('proveedor')
					}}
				>
					<Card>
						<CardHeader>
							<CardTitle>Administrador de facturas</CardTitle>
							<CardDescription>De dónde salen los contratos y las cuotas, y con qué reglas se importan.</CardDescription>
							<CardAction>
								<Button type="button" variant="outline" onClick={alProbar} disabled={probando}>
									<PlugZap aria-hidden="true" />
									{probando ? 'Probando…' : 'Probar conexión'}
								</Button>
							</CardAction>
						</CardHeader>
						<CardContent className="grid gap-5">
							{errorProveedor && <BloqueError error={errorProveedor} titulo="No se guardó la configuración" />}

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
									<Input id="proveedor-nombre" value={formulario.nombreProveedor} onChange={evento => cambiar({ nombreProveedor: evento.target.value })} />
								</Campo>
								<Campo id="proveedor-url" etiqueta="URL de la API" ayuda="Con o sin /api/v1. El simulador local es http://127.0.0.1:4310/api/v1">
									<Input
										id="proveedor-url"
										type="formulario.url"
										value={formulario.url}
										onChange={evento => cambiar({ url: evento.target.value })}
										aria-describedby="proveedor-url-ayuda"
										className="font-mono text-[0.8rem]"
									/>
								</Campo>
								<Campo id="proveedor-usuario" etiqueta="Usuario o correo">
									<Input id="proveedor-usuario" value={formulario.usuario} onChange={evento => cambiar({ usuario: evento.target.value })} autoComplete="username" />
								</Campo>
								<Campo id="proveedor-password" etiqueta="Contraseña" ayuda="Déjala vacía para conservar la actual. Nunca se muestra.">
									<Input
										id="proveedor-password"
										type="formulario.password"
										value={formulario.password}
										placeholder={proveedor.password_definida ? '••••••••' : 'Escribe la contraseña del proveedor'}
										onChange={evento => cambiar({ password: evento.target.value })}
										autoComplete="current-formulario.password"
										aria-describedby="proveedor-password-ayuda"
									/>
								</Campo>
								<div className="flex items-start pt-7">
									{proveedor.password_definida ? (
										<Pildora tono="ok">Hay una contraseña guardada</Pildora>
									) : (
										<Pildora tono="warn">Sin contraseña: la corrida no arranca</Pildora>
									)}
								</div>
							</div>

							<GrupoCasillas
								leyenda="Estados de contrato que se importan"
								ayuda="Por defecto ACTIVO y CORTADO. Las cuotas de un contrato en otro estado salen como «Excluida por estado»."
								opciones={ESTADOS}
								seleccionadas={formulario.estados}
								alCambiar={(valor, activa) => cambiar({ estados: alternar(formulario.estados, valor, activa) })}
								error={sinEstados ? 'Elige al menos un estado: con la lista vacía no se importaría nada.' : undefined}
							/>

							<div className="grid gap-4 md:grid-cols-3">
								<Campo id="ventana" etiqueta="Ventana de importación" ayuda="Solo cuotas desde el mes actual menos N meses.">
									<Select value={formulario.ventana} onValueChange={valor => cambiar({ ventana: valor })}>
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
										value={formulario.recientes}
										placeholder="todas"
										onChange={evento => cambiar({ recientes: evento.target.value })}
										aria-describedby="recientes-ayuda"
									/>
								</Campo>
								<Campo id="gracia" etiqueta="Días de gracia para el corte" ayuda="Corte = vencimiento + días. De 0 a 60.">
									<Input
										id="gracia"
										type="number"
										min={0}
										max={60}
										value={formulario.gracia}
										onChange={evento => cambiar({ gracia: evento.target.value })}
										aria-describedby="gracia-ayuda"
									/>
								</Campo>
								<Campo id="tope-facturas" etiqueta="Tope de facturas nuevas por corrida" ayuda="Vacío = sin tope. Lo que exceda queda frenado, no se importa.">
									<Input
										id="tope-facturas"
										type="number"
										min={1}
										value={formulario.topeFacturas}
										placeholder="sin tope"
										onChange={evento => cambiar({ topeFacturas: evento.target.value })}
										aria-describedby="tope-facturas-ayuda"
									/>
								</Campo>
								<Campo id="tope-monto" etiqueta="Tope de monto nuevo por corrida (USD)" ayuda="Vacío = sin tope.">
									<Input
										id="tope-monto"
										type="number"
										min={0}
										step="0.01"
										value={formulario.topeMonto}
										placeholder="sin tope"
										onChange={evento => cambiar({ topeMonto: evento.target.value })}
										aria-describedby="tope-monto-ayuda"
									/>
								</Campo>
							</div>

							<GrupoCasillas
								leyenda="Excluir por tipo de documento del titular"
								ayuda="J y G son personas jurídicas; el resto, naturales."
								opciones={TIPOS}
								seleccionadas={formulario.excluidos}
								alCambiar={(valor, activa) => cambiar({ excluidos: alternar(formulario.excluidos, valor, activa) })}
							/>

							<fieldset className="grid gap-3 rounded-lg border border-border px-3.5 py-3">
								<legend className="px-1 text-sm font-medium">Corrida automática</legend>
								<div className="flex flex-wrap items-center gap-x-6 gap-y-3">
									<div className="flex items-center gap-2.5">
										<Switch id="auto-activa" checked={formulario.autoActiva} onCheckedChange={valor => cambiar({ autoActiva: valor })} />
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
											value={formulario.autoHora}
											disabled={!formulario.autoActiva}
											onChange={evento => cambiar({ autoHora: evento.target.value })}
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
								<Button type="submit" disabled={guardandoProveedor}>
									{guardandoProveedor ? 'Guardando…' : 'Guardar proveedor'}
								</Button>
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
