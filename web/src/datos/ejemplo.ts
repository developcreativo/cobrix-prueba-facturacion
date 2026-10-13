/**
 * DATOS DE EJEMPLO — TEMPORAL.
 *
 * Nada de lo que hay aquí es real: es una muestra tipada con el contrato de la API del panel
 * (`@/tipos/panel`, SPEC §3.8) para montar y revisar las pantallas sin backend. Cuando el módulo
 * de la API del panel esté conectado, **este archivo se borra**: las pantallas consumen los
 * mismos tipos, así que no cambian.
 *
 * Los números reproducen los criterios de aceptación del enunciado §5 con la base entregada y
 * `SANDBOX_TODAY=2026-10-13`, en el estado **justo después de la primera importación real**:
 *
 *   20 clientes · 21 contratos espejados (de 27 leídos) · 42 facturas abiertas por USD 1.235,00
 *   corrida de importación: 54 cuotas vistas en 54 filas · 42 importada · 9 excluida_estado
 *                           · 1 saldo_residual · 1 moneda_incoherente (1 fila, 2 cuotas)
 *                           · 1 sin_deuda (1 fila, 0 cuotas) · 12 cuotas excluidas
 *
 * Los contadores son los de `ContadoresImportacion` (`src/cobrix/corridas/importacion.ts`) y los
 * motivos y las trazas están copiados de `dominio/importacion.ts`: lo que se ve aquí es lo que
 * el backend produce, no una aproximación.
 *
 * La clasificación de pagos se muestra con una **simulación** de «actualizar pagadas»
 * (8 se marcarían pagadas, 1 abono parcial), que no cambia el estado anterior.
 */

import { describir } from '@/lib/resultados'
import type {
	ClienteFila,
	Contador,
	Configuracion,
	CorridaDetalle,
	CorridaResumen,
	EstadoContrato,
	Expediente,
	ErrorPanel,
	FacturaExpediente,
	LineaCorrida,
	ListaClientes,
	ListaCorridas,
	PasoTraza,
	Persona,
	PruebaConexion,
	Resultado,
	Resumen,
} from '@/tipos/panel'

export type * from '@/tipos/panel'

// ---------------------------------------------------------------- reloj del sandbox

export const FECHA_SANDBOX = '2026-10-13'
export const PERIODO_ACTUAL = '2026-10'
/** Instantes con desfase explícito, como los va a emitir la API. */
const AHORA = '2026-10-13T03:41:02-04:00'

const MESES_LARGOS = [
	'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
	'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
] as const

const mesLargo = (periodo: string): string => MESES_LARGOS[Number(periodo.slice(5, 7)) - 1] ?? ''
const primerDia = (periodo: string): string => `${periodo}-01`

// ---------------------------------------------------------------- semilla

interface SemillaCuota {
	readonly deuda_id: string
	readonly periodo: string
	/** Monto en centavos. */
	readonly monto: number
}

interface SemillaContrato {
	readonly id: number
	readonly plan: string
	readonly precio: number
	readonly sucursal: string
	/** Si falta, el del titular: un titular puede tener contratos en estados distintos. */
	readonly estado?: EstadoContrato
	readonly cuotas: readonly SemillaCuota[]
}

interface SemillaTitular {
	readonly id: string
	readonly nombre: string
	readonly documento: string
	readonly persona: Persona
	readonly email: string
	readonly telefono: string
	readonly estado: EstadoContrato
	readonly direccion: string
	readonly contratos: readonly SemillaContrato[]
	/** Por qué no se importa este titular; ausente = se importa. */
	readonly descarte?: Extract<Resultado, 'excluida_estado' | 'sin_deuda' | 'moneda_incoherente'>
}

const mensuales = (desde: string, meses: number, monto: number, primerId: number): SemillaCuota[] => {
	const [anio, mes] = [Number(desde.slice(0, 4)), Number(desde.slice(5, 7))]
	return Array.from({ length: meses }, (_, i) => {
		const total = mes - 1 + i
		const periodo = `${anio + Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`
		return { deuda_id: String(primerId + i), periodo, monto }
	})
}

const CCS = 'CALLE 2, URB. DE PRUEBA, CARACAS'
const VLN = 'AV. BOLIVAR, VALENCIA'
const MCB = 'CALLE 72, MARACAIBO'

/** Los 27 contratos que el administrador publica, con sus cuotas pendientes. */
const SEMILLA: readonly SemillaTitular[] = [
	{
		id: 'V12345678', nombre: 'ANA PEREZ', documento: 'V-12345678', persona: 'natural',
		email: 'ana.perez@example.com', telefono: '04121001001', estado: 'ACTIVO', direccion: CCS,
		contratos: [{
			id: 900101, plan: 'PLAN15MB25', precio: 2500, sucursal: 'CCS',
			cuotas: [
				{ deuda_id: '7000008', periodo: '2026-08', monto: 2000 },
				{ deuda_id: '7000009', periodo: '2026-09', monto: 2500 },
				{ deuda_id: '7000010', periodo: '2026-10', monto: 2500 },
			],
		}],
	},
	{
		id: 'V9876543', nombre: 'LUIS GOMEZ', documento: 'V-9876543', persona: 'natural',
		email: 'luis.gomez@example.com', telefono: '04121007919', estado: 'ACTIVO', direccion: CCS,
		contratos: [
			{ id: 900102, plan: 'PLAN30MB35', precio: 3500, sucursal: 'CCS', cuotas: [{ deuda_id: '7000022', periodo: '2026-10', monto: 3500 }] },
			{ id: 900103, plan: 'PLAN3MB20', precio: 2000, sucursal: 'CCS', estado: 'CORTADO', cuotas: mensuales('2026-07', 4, 2000, 7000031) },
		],
	},
	{
		id: 'J401234567', nombre: 'COMERCIAL EL FARO, C.A.', documento: 'J-40123456-7', persona: 'juridica',
		email: 'admin@elfaro.example.com', telefono: '02127778899', estado: 'ACTIVO', direccion: VLN,
		contratos: [{ id: 900104, plan: 'PLANFIBRA60', precio: 6000, sucursal: 'VLN', cuotas: mensuales('2026-09', 2, 6000, 7000044) }],
	},
	{
		id: 'E81234567', nombre: 'MARIA SILVA', documento: 'E-81234567', persona: 'natural',
		email: 'maria.silva@example.com', telefono: '04141002002', estado: 'ACTIVO', direccion: VLN,
		contratos: [{ id: 900105, plan: 'PLAN15MB25', precio: 2500, sucursal: 'VLN', cuotas: [{ deuda_id: '7000050', periodo: '2026-10', monto: 2500 }] }],
	},
	{
		id: 'V10145063', nombre: 'ADRIANA GONZALEZ', documento: 'V-10145063', persona: 'natural',
		email: 'adriana.gonzalez@example.com', telefono: '04161003003', estado: 'ACTIVO', direccion: CCS,
		contratos: [{ id: 900106, plan: 'PLAN15MB25', precio: 2500, sucursal: 'CCS', cuotas: [{ deuda_id: '7000053', periodo: '2026-10', monto: 2500 }] }],
	},
	{
		id: 'V20583496', nombre: 'ALEJANDRO MARTINEZ', documento: 'V-20583496', persona: 'natural',
		email: 'alejandro.martinez@example.com', telefono: '04121004004', estado: 'ACTIVO', direccion: MCB,
		contratos: [{ id: 900107, plan: 'PLAN30MB35', precio: 3500, sucursal: 'MCB', cuotas: [{ deuda_id: '7000056', periodo: '2026-10', monto: 3500 }] }],
	},
	{
		id: 'V14522442', nombre: 'CARMEN RAMIREZ', documento: 'V-14522442', persona: 'natural',
		email: 'carmen.ramirez@example.com', telefono: '04241005005', estado: 'ACTIVO', direccion: CCS,
		contratos: [{ id: 900108, plan: 'PLAN30MB35', precio: 3500, sucursal: 'CCS', cuotas: [{ deuda_id: '7000059', periodo: '2026-10', monto: 3500 }] }],
	},
	{
		id: 'V18378979', nombre: 'DANIEL LOPEZ', documento: 'V-18378979', persona: 'natural',
		email: 'daniel.lopez@example.com', telefono: '04121006006', estado: 'ACTIVO', direccion: VLN,
		contratos: [{ id: 900109, plan: 'PLAN15MB25', precio: 2500, sucursal: 'VLN', cuotas: [{ deuda_id: '7000062', periodo: '2026-10', monto: 2500 }] }],
	},
	{
		id: 'V12945411', nombre: 'FERNANDO HERNANDEZ', documento: 'V-12945411', persona: 'natural',
		email: 'fernando.hernandez@example.com', telefono: '04141007007', estado: 'ACTIVO', direccion: CCS,
		contratos: [{ id: 900110, plan: 'PLAN30MB35', precio: 3500, sucursal: 'CCS', cuotas: [{ deuda_id: '7000065', periodo: '2026-10', monto: 3500 }] }],
	},
	{
		id: 'V20666777', nombre: 'SOFIA TORRES', documento: 'V-20666777', persona: 'natural',
		email: 'sofia.torres@example.com', telefono: '04121008008', estado: 'ACTIVO', direccion: CCS,
		contratos: [{
			id: 900111, plan: 'PLAN15MB25', precio: 2500, sucursal: 'CCS',
			cuotas: [
				{ deuda_id: '7000040', periodo: '2026-10', monto: 2500 },
				// Saldo de 0,001317: el administrador lo publica como `deuda: 0`.
				{ deuda_id: '7000041', periodo: '2026-09', monto: 0 },
			],
		}],
	},
	{
		id: 'V10043562', nombre: 'GABRIELA MEDINA', documento: 'V-10043562', persona: 'natural',
		email: 'gabriela.medina@example.com', telefono: '04161009009', estado: 'ACTIVO', direccion: MCB,
		contratos: [{ id: 900112, plan: 'PLAN3MB20', precio: 2000, sucursal: 'MCB', cuotas: [{ deuda_id: '7000068', periodo: '2026-10', monto: 2000 }] }],
	},
	{
		id: '9000123', nombre: 'ELENA RUIZ', documento: '09000123', persona: 'natural',
		email: 'elena.ruiz@example.com', telefono: '04121010010', estado: 'ACTIVO', direccion: CCS,
		contratos: [{ id: 900113, plan: 'PLAN15MB25', precio: 2500, sucursal: 'CCS', cuotas: mensuales('2026-09', 2, 2500, 7000071) }],
	},
	{
		id: 'V23999000', nombre: 'MIGUEL ANGEL SOTO', documento: 'V-23999000', persona: 'natural',
		email: 'miguel.soto@example.com', telefono: '04241011011', estado: 'ACTIVO', direccion: VLN,
		contratos: [{ id: 900114, plan: 'PLAN30MB35', precio: 3500, sucursal: 'VLN', cuotas: mensuales('2026-03', 8, 3500, 7000075) }],
	},
	{
		id: 'V24077698', nombre: 'ISABEL SANCHEZ', documento: 'V-24077698', persona: 'natural',
		email: 'isabel.sanchez@example.com', telefono: '04121012012', estado: 'ACTIVO', direccion: CCS,
		contratos: [{ id: 900115, plan: 'PLAN30MB35', precio: 3500, sucursal: 'CCS', cuotas: [{ deuda_id: '7000085', periodo: '2026-10', monto: 3500 }] }],
	},
	{
		id: 'V14084073', nombre: 'JOSE RODRIGUEZ', documento: 'V-14084073', persona: 'natural',
		email: 'jose.rodriguez@example.com', telefono: '04141013013', estado: 'ACTIVO', direccion: MCB,
		contratos: [{ id: 900116, plan: 'PLAN15MB25', precio: 2500, sucursal: 'MCB', cuotas: [{ deuda_id: '7000088', periodo: '2026-10', monto: 2500 }] }],
	},
	{
		id: 'V22203836', nombre: 'LUISA GARCIA', documento: 'V-22203836', persona: 'natural',
		email: 'luisa.garcia@example.com', telefono: '04121014014', estado: 'ACTIVO', direccion: CCS,
		contratos: [{ id: 900117, plan: 'PLAN15MB25', precio: 2500, sucursal: 'CCS', cuotas: [{ deuda_id: '7000091', periodo: '2026-10', monto: 2500 }] }],
	},
	{
		id: 'V20910353', nombre: 'PATRICIA FLORES', documento: 'V-20910353', persona: 'natural',
		email: 'patricia.flores@example.com', telefono: '04161015015', estado: 'CORTADO', direccion: VLN,
		contratos: [{ id: 900118, plan: 'PLAN3MB20', precio: 2000, sucursal: 'VLN', cuotas: mensuales('2026-08', 3, 2000, 7000094) }],
	},
	{
		id: 'V16125887', nombre: 'RAFAEL PEREZ', documento: 'V-16125887', persona: 'natural',
		email: 'rafael.perez@example.com', telefono: '04121016016', estado: 'CORTADO', direccion: CCS,
		contratos: [{ id: 900119, plan: 'PLAN30MB35', precio: 3500, sucursal: 'CCS', cuotas: mensuales('2026-08', 3, 3500, 7000099) }],
	},
	{
		id: 'V15563525', nombre: 'RICARDO MORALES', documento: 'V-15563525', persona: 'natural',
		email: 'ricardo.morales@example.com', telefono: '04241017017', estado: 'CORTADO', direccion: MCB,
		contratos: [{ id: 900120, plan: 'PLAN15MB25', precio: 2500, sucursal: 'MCB', cuotas: mensuales('2026-08', 3, 2500, 7000104) }],
	},
	{
		id: 'V24111222', nombre: 'VALENTINA PAZ', documento: 'V-24111222', persona: 'natural',
		email: 'valentina.paz@example.com', telefono: '04121018018', estado: 'ACTIVO', direccion: CCS,
		contratos: [{ id: 900121, plan: 'PLAN15MB25', precio: 2500, sucursal: 'CCS', cuotas: mensuales('2026-09', 2, 2500, 7000109) }],
	},

	// --- titulares que NO se importan ---------------------------------------------------
	{
		id: 'V11222333', nombre: 'CARLOS ROJAS', documento: 'V-11222333', persona: 'natural',
		email: 'carlos.rojas@example.com', telefono: '04121019019', estado: 'CORTESIA', direccion: CCS,
		descarte: 'excluida_estado',
		contratos: [{ id: 900122, plan: 'PLAN15MB25', precio: 2500, sucursal: 'CCS', cuotas: mensuales('2026-09', 2, 2500, 7000112) }],
	},
	{
		id: 'V13444555', nombre: 'ROSA DIAZ', documento: 'V-13444555', persona: 'natural',
		email: 'rosa.diaz@example.com', telefono: '04141020020', estado: 'RETIRADO', direccion: VLN,
		descarte: 'excluida_estado',
		contratos: [{ id: 900123, plan: 'PLAN3MB20', precio: 2000, sucursal: 'VLN', cuotas: mensuales('2026-08', 3, 2000, 7000115) }],
	},
	{
		id: 'V17555666', nombre: 'PEDRO LEON', documento: 'V-17555666', persona: 'natural',
		email: 'pedro.leon@example.com', telefono: '04161021021', estado: 'RECHAZADO', direccion: MCB,
		descarte: 'excluida_estado',
		contratos: [{ id: 900124, plan: 'PLAN30MB35', precio: 3500, sucursal: 'MCB', cuotas: mensuales('2026-09', 2, 3500, 7000119) }],
	},
	{
		id: 'V19666777', nombre: 'ANDRES VARGAS', documento: 'V-19666777', persona: 'natural',
		email: 'andres.vargas@example.com', telefono: '04121022022', estado: 'ANULADO', direccion: CCS,
		descarte: 'excluida_estado',
		contratos: [{ id: 900125, plan: 'PLAN15MB25', precio: 2500, sucursal: 'CCS', cuotas: mensuales('2026-09', 2, 2500, 7000122) }],
	},
	{
		id: 'V21777888', nombre: 'LAURA MENDEZ', documento: 'V-21777888', persona: 'natural',
		email: 'laura.mendez@example.com', telefono: '04241023023', estado: 'ACTIVO', direccion: VLN,
		descarte: 'sin_deuda',
		contratos: [{ id: 900126, plan: 'PLAN15MB25', precio: 2500, sucursal: 'VLN', cuotas: [{ deuda_id: '0', periodo: PERIODO_ACTUAL, monto: 0 }] }],
	},
	{
		id: 'V22888999', nombre: 'JORGE CASTILLO', documento: 'V-22888999', persona: 'natural',
		email: 'jorge.castillo@example.com', telefono: '04121024024', estado: 'ACTIVO', direccion: CCS,
		descarte: 'moneda_incoherente',
		contratos: [{
			id: 900127, plan: 'PLANCORP120', precio: 12000, sucursal: 'CCS',
			// Dos cuotas que el administrador reporta en USD con montos imposibles: el contrato
			// entero sale en UNA línea con `cuotas: 2`.
			cuotas: [
				{ deuda_id: '7000125', periodo: '2026-09', monto: 35 },
				{ deuda_id: '7000126', periodo: '2026-10', monto: 35 },
			],
		}],
	},
]

const estadoDe = (titular: SemillaTitular, contrato: SemillaContrato): EstadoContrato => contrato.estado ?? titular.estado

const IMPORTABLES: readonly EstadoContrato[] = ['ACTIVO', 'CORTADO']
const DIAS_GRACIA = 0

const TITULARES_IMPORTADOS = SEMILLA.filter(t => !t.descarte)

/** Los contratos que Cobrix guarda: solo los de los titulares que sí se importan. */
const CONTRATOS_ESPEJADOS = TITULARES_IMPORTADOS.reduce((total, titular) => total + titular.contratos.length, 0)

// ---------------------------------------------------------------- facturas derivadas

interface FacturaPlana extends FacturaExpediente {
	readonly cliente_id: string
	readonly cliente_nombre: string
}

const FACTURAS: readonly FacturaPlana[] = (() => {
	const filas: FacturaPlana[] = []
	let numero = 0
	for (const titular of TITULARES_IMPORTADOS) {
		for (const contrato of titular.contratos) {
			for (const cuota of contrato.cuotas) {
				if (cuota.monto <= 0) continue // saldo residual: no se importa
				numero += 1
				filas.push({
					id: numero,
					numero: `FAC-${String(numero).padStart(6, '0')}`,
					deuda_id: cuota.deuda_id,
					contrato_id: contrato.id,
					periodo: cuota.periodo,
					descripcion: `${contrato.plan} - ${cuota.periodo.slice(0, 4)} ${mesLargo(cuota.periodo)}`,
					vence_el: primerDia(cuota.periodo),
					corta_el: primerDia(cuota.periodo),
					total_centavos: cuota.monto,
					saldo_centavos: cuota.monto,
					estado: 'abierta',
					pagada_el: null,
					isp_factura_num: null,
					cliente_id: titular.id,
					cliente_nombre: titular.nombre,
				})
			}
		}
	}
	return filas
})()

const facturasDe = (clienteId: string): readonly FacturaPlana[] => FACTURAS.filter(f => f.cliente_id === clienteId)

const facturaDeCuota = (deudaId: string): FacturaPlana | undefined => FACTURAS.find(f => f.deuda_id === deudaId)

// ---------------------------------------------------------------- clientes

export const CLIENTES: readonly ClienteFila[] = TITULARES_IMPORTADOS.map(titular => {
	const facturas = facturasDe(titular.id)
	const abiertas = facturas.filter(f => f.estado === 'abierta')
	const vencimientos = abiertas.map(f => f.vence_el).sort()
	return {
		id: titular.id,
		nombre: titular.nombre,
		documento: titular.documento,
		persona: titular.persona,
		contratos: titular.contratos.length,
		facturas_abiertas: abiertas.length,
		facturas_pagadas: facturas.length - abiertas.length,
		deuda_centavos: abiertas.reduce((suma, f) => suma + f.saldo_centavos, 0),
		vence_mas_antigua: vencimientos[0] ?? null,
	}
}).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))

export const LISTA_CLIENTES: ListaClientes = { total: CLIENTES.length, clientes: CLIENTES }

const sinAcentos = (texto: string): string => texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const soloDigitos = (texto: string): string => texto.replace(/\D/g, '').replace(/^0+/, '')

/** Búsqueda del §3.5: por nombre sin acentos o por documento con o sin formato. */
export function buscarClientes(consulta: string): ListaClientes {
	const q = consulta.trim()
	if (!q) return LISTA_CLIENTES
	const texto = sinAcentos(q)
	const digitos = soloDigitos(q)
	const clientes = CLIENTES.filter(cliente =>
		sinAcentos(cliente.nombre).includes(texto) ||
		sinAcentos(cliente.documento).replace(/[^a-z0-9]/g, '').includes(texto.replace(/[^a-z0-9]/g, '')) ||
		(digitos.length > 0 && soloDigitos(cliente.documento) === digitos),
	)
	return { total: clientes.length, clientes }
}

// ---------------------------------------------------------------- expedientes

export function expedientePorId(id: string): Expediente | undefined {
	const titular = TITULARES_IMPORTADOS.find(t => t.id === id)
	if (!titular) return undefined
	const facturas = [...facturasDe(id)].sort((a, b) => b.periodo.localeCompare(a.periodo) || a.contrato_id - b.contrato_id)
	const abiertas = facturas.filter(f => f.estado === 'abierta')

	const historial = [
		...facturas.map((factura, indice) => ({
			id: 1000 + indice,
			tipo: 'factura_importada' as const,
			ocurrido_en: AHORA,
			titulo: 'Factura importada',
			detalle: `Cuota ${factura.deuda_id} · ${factura.descripcion}`,
			factura_numero: factura.numero,
		})),
		{
			id: 1,
			tipo: 'cliente_creado' as const,
			ocurrido_en: AHORA,
			titulo: 'Cliente creado',
			detalle: `Cliente creado desde el contrato ${titular.contratos[0]?.id ?? ''} del administrador`,
			factura_numero: null,
		},
	]

	return {
		cliente: {
			id: titular.id,
			nombre: titular.nombre,
			documento: titular.documento,
			persona: titular.persona,
			email: titular.email,
			telefono: titular.telefono,
			origen: `Administrador de facturas · clave ***${titular.documento.slice(-4)}`,
			creado_en: AHORA,
		},
		totales: {
			deuda_centavos: abiertas.reduce((suma, f) => suma + f.saldo_centavos, 0),
			facturas_abiertas: abiertas.length,
			facturas_pagadas: facturas.length - abiertas.length,
			contratos: titular.contratos.length,
		},
		contratos: titular.contratos.map(contrato => ({
			id: contrato.id,
			estado: estadoDe(titular, contrato),
			plan: contrato.plan,
			precio_centavos: contrato.precio,
			moneda: 'USD',
			sucursal: contrato.sucursal,
			direccion: titular.direccion,
		})),
		facturas,
		historial,
	}
}

// ---------------------------------------------------------------- traza de reglas (explicador)

/**
 * Las trazas son copia literal de las que arma `clasificarContrato` en
 * `src/cobrix/dominio/importacion.ts`: mismos nombres de regla, mismo orden y mismo texto. Si
 * el dominio cambia una regla, aquí se nota.
 */

const ok = (regla: string, detalle: string): PasoTraza => ({ regla, veredicto: 'ok', detalle })
const descarta = (regla: string, detalle: string): PasoTraza => ({ regla, veredicto: 'descarta', detalle })
const omitida = (regla: string, detalle: string): PasoTraza => ({ regla, veredicto: 'omitida', detalle })

const money = (centavos: number): string => `USD ${new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(centavos / 100)}`

const pasoEstado = (estado: EstadoContrato): PasoTraza => ok('estado del contrato', `${estado} está entre los importables`)

const pasoIdentificacion = (titular: SemillaTitular): PasoTraza =>
	ok('identificación del titular', `${titular.documento} → ${titular.id} (${titular.persona === 'juridica' ? 'jurídica' : 'natural'})`)

const pasoMoneda = (contrato: SemillaContrato, mayor: number): PasoTraza =>
	ok('coherencia de moneda', `USD con cuotas de hasta ${money(mayor)} sobre un plan de ${money(contrato.precio)}`)

const etiquetaCuota = (contrato: SemillaContrato, cuota: SemillaCuota): string =>
	`${contrato.plan} - ${cuota.periodo.slice(0, 4)} ${mesLargo(cuota.periodo)}`

const pasoPeriodo = (contrato: SemillaContrato, cuota: SemillaCuota): PasoTraza =>
	ok('periodo de la cuota', `${etiquetaCuota(contrato, cuota)} → ${cuota.periodo}, vence ${primerDia(cuota.periodo)}, corta ${primerDia(cuota.periodo)}`)

// ---------------------------------------------------------------- líneas de la importación

type ModoCorrida = 'simulacion' | 'real' | 'repetida'

/**
 * Construye las filas del detalle como las guarda `almacen/corridas.ts`.
 *
 * Lo importante: **una fila no es siempre una cuota**. Un contrato que se descarta entero
 * (moneda incoherente) deja UNA fila con `cuotas: 2`, sin `deuda_id` ni periodo; la fila
 * «sin deuda» del administrador va con `cuotas: 0`.
 */
function lineasImportacion(modo: ModoCorrida): LineaCorrida[] {
	const lineas: LineaCorrida[] = []
	const agregar = (linea: Omit<LineaCorrida, 'id'>): void => {
		lineas.push({ ...linea, id: lineas.length + 1 })
	}

	for (const titular of SEMILLA) {
		for (const contrato of titular.contratos) {
			const estado = estadoDe(titular, contrato)
			const base = {
				contrato_id: contrato.id,
				cliente_id: titular.descarte ? null : titular.id,
				cliente_nombre: titular.nombre,
				factura_id: null,
				factura_numero: null,
			}

			// Fila «deuda_id 0»: no es una cuota.
			if (titular.descarte === 'sin_deuda') {
				agregar({
					...base,
					deuda_id: null,
					periodo: null,
					descripcion: null,
					cuotas: 0,
					monto_centavos: 0,
					resultado: 'sin_deuda',
					motivo: 'El administrador responde con la fila «deuda_id 0»: el contrato no debe nada.',
					traza: [descarta('fila deuda_id "0"', 'no es una cuota, es la señal de «sin deuda»')],
				})
				continue
			}

			// Contrato descartado entero: UNA fila que resume todas sus cuotas.
			if (titular.descarte === 'moneda_incoherente') {
				const monto = contrato.cuotas.reduce((total, cuota) => total + cuota.monto, 0)
				const mayor = Math.max(...contrato.cuotas.map(cuota => cuota.monto))
				const minimo = Math.round(contrato.precio * 0.01)
				agregar({
					...base,
					deuda_id: null,
					periodo: null,
					descripcion: null,
					cuotas: contrato.cuotas.length,
					monto_centavos: monto,
					resultado: 'moneda_incoherente',
					motivo: `Reporta USD pero su cuota más alta es ${money(mayor)} frente a un plan de ${money(contrato.precio)} (menos del 1 %). Quedan fuera ${contrato.cuotas.length} cuota(s) por ${money(monto)}.`,
					traza: [
						pasoEstado(estado),
						pasoIdentificacion(titular),
						descarta('coherencia de moneda', `cuota mayor ${money(mayor)} < 1 % del plan (${money(minimo)})`),
					],
				})
				continue
			}

			const conSaldo = contrato.cuotas.filter(cuota => cuota.monto >= 1)
			const mayor = conSaldo.length === 0 ? 0 : Math.max(...conSaldo.map(cuota => cuota.monto))

			for (const cuota of contrato.cuotas) {
				const comun = {
					...base,
					deuda_id: cuota.deuda_id,
					periodo: cuota.periodo,
					descripcion: etiquetaCuota(contrato, cuota),
					cuotas: 1,
					monto_centavos: cuota.monto,
				}

				// Estado no importable: una fila por cuota, con la traza cortada en el primer paso.
				if (titular.descarte === 'excluida_estado') {
					agregar({
						...comun,
						resultado: 'excluida_estado',
						motivo: `Contrato ${estado}: «${estado}» no está en los importables (${IMPORTABLES.join(', ')}).`,
						traza: [descarta('estado del contrato', `«${estado}» no está en los importables (${IMPORTABLES.join(', ')})`)],
					})
					continue
				}

				if (cuota.monto < 1) {
					agregar({
						...comun,
						resultado: 'saldo_residual',
						motivo: 'Saldo residual de menos de un centavo: no se importa.',
						traza: [
							pasoEstado(estado),
							pasoIdentificacion(titular),
							descarta('saldo de la cuota', `${money(cuota.monto)} es menos de un centavo`),
							omitida('coherencia de moneda', 'no se evalúa: la cuota ya quedó descartada'),
						],
					})
					continue
				}

				const factura = facturaDeCuota(cuota.deuda_id)
				const previos = [pasoEstado(estado), pasoIdentificacion(titular), pasoMoneda(contrato, mayor), pasoPeriodo(contrato, cuota)]

				if (modo === 'repetida') {
					agregar({
						...comun,
						resultado: 'ya_importada',
						motivo: 'La cuota ya tiene su factura en Cobrix: no se duplica.',
						factura_id: factura?.id ?? null,
						factura_numero: factura?.numero ?? null,
						traza: [
							...previos,
							ok('idempotencia', `la cuota ${cuota.deuda_id} ya existe en Cobrix`),
							omitida('ventana y máximo de recientes', 'no se reevalúan: la factura ya existe'),
						],
					})
					continue
				}

				const simulada = modo === 'simulacion'
				agregar({
					...comun,
					resultado: 'importada',
					motivo: simulada
						? `Se importaría por ${money(cuota.monto)}: vence el ${primerDia(cuota.periodo)} y corta el ${primerDia(cuota.periodo)}.`
						: `Factura ${factura?.id ?? 0} creada por ${money(cuota.monto)}: vence el ${primerDia(cuota.periodo)} y corta el ${primerDia(cuota.periodo)}.`,
					factura_id: simulada ? null : factura?.id ?? null,
					factura_numero: simulada ? null : factura?.numero ?? null,
					traza: [
						...previos,
						ok('idempotencia', 'la cuota todavía no está en Cobrix'),
						simulada
							? omitida('creación de la factura', 'simulación: no se escribe nada')
							: ok('creación de la factura', `factura ${factura?.id ?? 0} de Cobrix por ${money(cuota.monto)}`),
					],
				})
			}
		}
	}

	return lineas
}

// ---------------------------------------------------------------- líneas de pagos

/** Qué hizo la caja del ISP con cada cuota (criterios de aceptación §5 del enunciado). */
const COBROS: Readonly<Record<string, Extract<Resultado, 'marcada_pagada' | 'abono_parcial' | 'exonerada' | 'abierta_sin_cobro' | 'sin_cambio'>>> = {
	// ANA PEREZ 900101: pagó toda la deuda.
	'7000008': 'marcada_pagada', '7000009': 'marcada_pagada', '7000010': 'marcada_pagada',
	// LUIS GOMEZ 900103: pagó 25 sobre cuotas de 20 → una pagada y un abono parcial.
	'7000031': 'marcada_pagada', '7000032': 'abono_parcial',
	// COMERCIAL EL FARO 900104: pagó sus dos cuotas.
	'7000044': 'marcada_pagada', '7000045': 'marcada_pagada',
	// MIGUEL ANGEL SOTO 900114: pagó 70 → sus dos cuotas más viejas.
	'7000075': 'marcada_pagada', '7000076': 'marcada_pagada',
	// VALENTINA PAZ: cuota exonerada (saldo 0 sin nada cobrado): no es un pago.
	'7000109': 'exonerada',
}

const ISP_FACTURA: Readonly<Record<string, string>> = {
	'7000008': '008800118', '7000009': '008800118', '7000010': '008800118',
	'7000031': '008800119',
	'7000044': '008800120', '7000045': '008800120',
	'7000075': '008800121', '7000076': '008800121',
}

function trazaPago(factura: FacturaPlana, resultado: Resultado): PasoTraza[] {
	const numeroIsp = ISP_FACTURA[factura.deuda_id]
	switch (resultado) {
		case 'marcada_pagada':
			return [
				ok('filas del libro', `${factura.deuda_id} aparece en pago_informacion con 1 fila`),
				ok('coherencia entre filas', 'todas las filas de la cuota dicen lo mismo'),
				ok('saldo en el administrador', 'saldo_cuota USD 0,00'),
				ok('cobro registrado', `valor_pago ${money(factura.total_centavos)} · factura del administrador ${numeroIsp ?? ''} del ${FECHA_SANDBOX}`),
			]
		case 'abono_parcial':
			return [
				ok('filas del libro', `${factura.deuda_id} aparece en pago_informacion con 1 fila`),
				ok('coherencia entre filas', 'todas las filas de la cuota dicen lo mismo'),
				descarta('saldo en el administrador', `el administrador debe USD 15,00 y Cobrix ${money(factura.saldo_centavos)}: es un abono, no un pago`),
				{ regla: 'cobro registrado', veredicto: 'omitida', detalle: 'no se evalúa: solo se marcan pagadas las cuotas saldadas' },
			]
		case 'exonerada':
			return [
				ok('filas del libro', `${factura.deuda_id} aparece en pago_informacion con 1 fila`),
				ok('coherencia entre filas', 'todas las filas de la cuota dicen lo mismo'),
				ok('saldo en el administrador', 'saldo_cuota USD 0,00 (descuento igual a la tarifa)'),
				descarta('cobro registrado', 'valor_pago USD 0,00: nadie pagó, la cuota fue exonerada'),
			]
		case 'abierta_sin_cobro':
			return [
				descarta('filas del libro', `${factura.deuda_id} no aparece en pago_informacion para la ventana consultada`),
				ok('confirmación contra el contrato', `el contrato ${factura.contrato_id} la sigue debiendo: ${money(factura.saldo_centavos)}`),
				{ regla: 'cobro registrado', veredicto: 'omitida', detalle: 'no se evalúa: no hay cobro que leer' },
			]
		default:
			return [
				ok('filas del libro', `${factura.deuda_id} aparece en pago_informacion con 1 fila`),
				ok('coherencia entre filas', 'todas las filas de la cuota dicen lo mismo'),
				descarta('saldo en el administrador', `saldo_cuota ${money(factura.saldo_centavos)}: igual al de Cobrix, nadie pagó`),
				{ regla: 'cobro registrado', veredicto: 'omitida', detalle: 'no se evalúa: la cuota sigue con saldo' },
			]
	}
}

function lineasPagos(): LineaCorrida[] {
	return FACTURAS.map((factura, indice) => {
		const resultado: Resultado = COBROS[factura.deuda_id] ?? (factura.periodo === PERIODO_ACTUAL ? 'abierta_sin_cobro' : 'sin_cambio')
		const numeroIsp = ISP_FACTURA[factura.deuda_id]
		const motivo =
			resultado === 'marcada_pagada' ? `Factura del administrador ${numeroIsp ?? ''} del ${FECHA_SANDBOX}`
				: resultado === 'abono_parcial' ? 'El administrador debe USD 15,00 y Cobrix USD 20,00. No se aplica: solo se marcan pagadas las cuotas saldadas'
					: resultado === 'exonerada' ? 'Saldo 0 sin nada cobrado: cuota exonerada, no es un pago'
						: resultado === 'abierta_sin_cobro' ? 'La cuota del mes en curso aún no está en el libro; el contrato la sigue debiendo'
							: 'El libro coincide con Cobrix: la cuota sigue con saldo'
		return {
			id: indice + 1,
			contrato_id: factura.contrato_id,
			deuda_id: factura.deuda_id,
			periodo: factura.periodo,
			cuotas: 1,
			cliente_id: factura.cliente_id,
			cliente_nombre: factura.cliente_nombre,
			descripcion: factura.descripcion,
			monto_centavos: factura.total_centavos,
			resultado,
			motivo,
			factura_id: factura.id,
			factura_numero: factura.numero,
			traza: trazaPago(factura, resultado),
		}
	})
}

// ---------------------------------------------------------------- contadores

/**
 * Contadores reales.
 *
 * Las claves son las de `ContadoresImportacion` (`src/cobrix/corridas/importacion.ts`): los
 * totales de la corrida y, con punto, el desglose por resultado (`cuotas.importada`,
 * `lineas.moneda_incoherente`). **No hay contadores inventados**: si una cifra no sale de ahí,
 * no se muestra. `montoNuevo` son centavos, por eso lleva `tipo: 'dinero'`.
 */

const cuenta = (clave: string, etiqueta: string, valor: number, destacado = false): Contador =>
	({ clave, etiqueta, valor, tipo: 'cuenta', destacado })

const dinero = (clave: string, etiqueta: string, valor: number, destacado = false): Contador =>
	({ clave, etiqueta, valor, tipo: 'dinero', destacado })

interface Desglose {
	readonly cuotas: Readonly<Record<string, number>>
	readonly lineas: Readonly<Record<string, number>>
	readonly excluidas: number
	readonly nuevas: number
	readonly monto: number
}

/** Mismo recuento que `contar()` en el backend: la suma de `cuotas` es `cuotasVistas`. */
function desglosar(lineas: readonly LineaCorrida[], resultadoNuevo: Resultado): Desglose {
	const porCuota: Record<string, number> = {}
	const porLinea: Record<string, number> = {}
	let excluidas = 0
	let nuevas = 0
	let monto = 0
	for (const linea of lineas) {
		porCuota[linea.resultado] = (porCuota[linea.resultado] ?? 0) + linea.cuotas
		porLinea[linea.resultado] = (porLinea[linea.resultado] ?? 0) + 1
		if (describir(linea.resultado).excluye) excluidas += linea.cuotas
		if (linea.resultado === resultadoNuevo) {
			nuevas += 1
			monto += linea.monto_centavos
		}
	}
	return { cuotas: porCuota, lineas: porLinea, excluidas, nuevas, monto }
}

/** El desglose por resultado, como pares `cuotas.X` / `lineas.X`. */
function contadoresPorResultado(desglose: Desglose, unidad: 'cuotas' | 'facturas'): Contador[] {
	return Object.keys(desglose.cuotas).flatMap(resultado => {
		const etiqueta = describir(resultado as Resultado).etiqueta
		return [
			cuenta(`${unidad}.${resultado}`, etiqueta, desglose.cuotas[resultado] ?? 0),
			cuenta(`lineas.${resultado}`, etiqueta, desglose.lineas[resultado] ?? 0),
		]
	})
}

const CONTRATOS_LEIDOS = SEMILLA.reduce((total, titular) => total + titular.contratos.length, 0)

function contadoresImportacion(lineas: readonly LineaCorrida[], modo: ModoCorrida): Contador[] {
	const desglose = desglosar(lineas, 'importada')
	const cuotasVistas = Object.entries(desglose.cuotas).reduce((total, [, valor]) => total + valor, 0)
	const simulacion = modo === 'simulacion'
	const refrescados = modo === 'repetida' ? { clientes: CLIENTES.length, contratos: CONTRATOS_ESPEJADOS } : { clientes: 0, contratos: 0 }

	return [
		cuenta('contratos', 'Contratos leídos', CONTRATOS_LEIDOS, true),
		cuenta('cuotasVistas', 'Cuotas vistas', cuotasVistas, true),
		cuenta('facturasNuevas', simulacion ? 'Facturas que se importarían' : 'Facturas nuevas', desglose.nuevas, true),
		dinero('montoNuevo', simulacion ? 'Monto que se importaría' : 'Monto nuevo', desglose.monto, true),
		cuenta('clientesNuevos', simulacion ? 'Clientes por crear' : 'Clientes nuevos', modo === 'repetida' ? 0 : CLIENTES.length, true),
		cuenta('cuotasExcluidas', 'Cuotas excluidas', desglose.excluidas, true),
		cuenta('clientesRefrescados', 'Clientes puestos al día', refrescados.clientes, refrescados.clientes > 0),
		cuenta('contratosRefrescados', 'Contratos puestos al día', refrescados.contratos, refrescados.contratos > 0),
		...contadoresPorResultado(desglose, 'cuotas'),
	]
}

/**
 * Pagadas: el módulo `src/cobrix/corridas/pagos.ts` todavía no existe, así que estas claves
 * siguen la forma de `ContadoresImportacion` (totales + desglose por resultado) y las confirma
 * el backend cuando lo escriba. Ninguna cifra sale de otro sitio que no sean las filas.
 */
function contadoresPagos(lineas: readonly LineaCorrida[], simulacion: boolean): Contador[] {
	const desglose = desglosar(lineas, 'marcada_pagada')
	const abonos = desglose.cuotas.abono_parcial ?? 0
	const contratos = new Set(lineas.map(linea => linea.contrato_id)).size

	return [
		cuenta('contratos', 'Contratos consultados', contratos, false),
		cuenta('facturasRevisadas', 'Facturas revisadas', lineas.length, true),
		cuenta('facturasPagadas', simulacion ? 'Facturas que se marcarían pagadas' : 'Facturas marcadas pagadas', desglose.nuevas, true),
		dinero('montoCobrado', 'Monto cobrado por el ISP', desglose.monto, true),
		cuenta('abonosParciales', 'Abonos parciales', abonos, true),
		cuenta('facturasAbiertas', 'Siguen abiertas', lineas.length - desglose.nuevas - abonos, true),
		...contadoresPorResultado(desglose, 'facturas'),
	]
}

// ---------------------------------------------------------------- resúmenes de una línea

/** Copia de `resumir()` (`src/cobrix/corridas/importacion.ts`): la misma frase del historial. */
function resumirImportacion(contadores: readonly Contador[], simulacion: boolean): string {
	const valor = (clave: string): number => contadores.find(c => c.clave === clave)?.valor ?? 0
	const partes: string[] = []
	const nuevas = valor('facturasNuevas')
	partes.push(nuevas === 0
		? (simulacion ? 'No se importaría ninguna factura' : 'Sin facturas nuevas')
		: `${simulacion ? 'Se importarían ' : ''}${nuevas} facturas nuevas por ${money(valor('montoNuevo'))}`)
	const clientes = valor('clientesNuevos')
	if (clientes > 0) partes.push(`${clientes} ${simulacion ? 'clientes por crear' : 'clientes nuevos'}`)
	const yaImportadas = valor('cuotas.ya_importada')
	if (yaImportadas > 0) partes.push(`${yaImportadas} cuotas ya estaban importadas`)
	const excluidas = valor('cuotasExcluidas')
	if (excluidas > 0) partes.push(`${excluidas} cuotas excluidas`)
	const clientesAlDia = valor('clientesRefrescados')
	const contratosAlDia = valor('contratosRefrescados')
	if (clientesAlDia > 0 || contratosAlDia > 0) {
		partes.push(`${clientesAlDia} clientes y ${contratosAlDia} contratos ${simulacion ? 'por poner' : 'puestos'} al día`)
	}
	return `${simulacion ? 'Simulación · ' : ''}${partes.join('; ')}`
}

function resumirPagos(contadores: readonly Contador[], simulacion: boolean): string {
	const valor = (clave: string): number => contadores.find(c => c.clave === clave)?.valor ?? 0
	const partes: string[] = []
	const pagadas = valor('facturasPagadas')
	partes.push(pagadas === 0
		? (simulacion ? 'No se marcaría ninguna factura pagada' : 'Sin facturas nuevas pagadas')
		: `${simulacion ? 'Se marcarían pagadas ' : ''}${pagadas} facturas por ${money(valor('montoCobrado'))}`)
	const abonos = valor('abonosParciales')
	if (abonos > 0) partes.push(`${abonos} abono parcial en el administrador`)
	partes.push(`${valor('facturasAbiertas')} facturas siguen abiertas`)
	return `${simulacion ? 'Simulación · ' : ''}${partes.join('; ')}`
}

// ---------------------------------------------------------------- corridas

const SNAPSHOT = {
	estados_importables: IMPORTABLES,
	ventana_meses: null,
	max_cuotas_recientes: null,
	dias_gracia: DIAS_GRACIA,
	tope_facturas: null,
	tope_monto_centavos: null,
	excluir_tipos_documento: [],
} as const

const LINEAS_IMPORTACION_SIMULADA = lineasImportacion('simulacion')
const LINEAS_IMPORTACION = lineasImportacion('real')
const LINEAS_IMPORTACION_REPETIDA = lineasImportacion('repetida')
const LINEAS_PAGOS = lineasPagos()

const CONTADORES_1 = contadoresImportacion(LINEAS_IMPORTACION_SIMULADA, 'simulacion')
const CONTADORES_2 = contadoresImportacion(LINEAS_IMPORTACION, 'real')
const CONTADORES_3 = contadoresPagos(LINEAS_PAGOS, true)
const CONTADORES_4 = contadoresImportacion(LINEAS_IMPORTACION_REPETIDA, 'repetida')
const CONTADORES_5 = contadoresPagos([], false)

/** `ErrorCorrida` tal como lo arma `describirError()` a partir de un `ErrorApi`. */
const ERROR_CREDENCIALES: ErrorPanel = {
	codigo: 'credenciales',
	mensaje: 'Contraseña Incorrecta',
	sugerencia: 'Revisa el usuario y la contraseña en Configuración → Proveedor.',
	endpoint: 'POST /usuario/login',
	status: 401,
}

const CORRIDAS_DETALLE: readonly CorridaDetalle[] = [
	{
		id: 1, tipo: 'importacion', simulacion: true, disparo: 'manual', estado: 'completada',
		inicio: '2026-10-13T03:40:11-04:00', fin: '2026-10-13T03:40:11-04:00', duracion_ms: 118,
		resumen: resumirImportacion(CONTADORES_1, true),
		contadores: CONTADORES_1,
		lineas: LINEAS_IMPORTACION_SIMULADA,
		config_snapshot: SNAPSHOT,
	},
	{
		id: 2, tipo: 'importacion', simulacion: false, disparo: 'manual', estado: 'completada',
		inicio: '2026-10-13T03:41:02-04:00', fin: '2026-10-13T03:41:02-04:00', duracion_ms: 134,
		resumen: resumirImportacion(CONTADORES_2, false),
		contadores: CONTADORES_2,
		lineas: LINEAS_IMPORTACION,
		config_snapshot: SNAPSHOT,
	},
	{
		id: 3, tipo: 'pagadas', simulacion: true, disparo: 'manual', estado: 'completada',
		inicio: '2026-10-13T03:42:30-04:00', fin: '2026-10-13T03:42:31-04:00', duracion_ms: 963,
		resumen: resumirPagos(CONTADORES_3, true),
		contadores: CONTADORES_3,
		lineas: LINEAS_PAGOS,
		config_snapshot: SNAPSHOT,
	},
	{
		id: 4, tipo: 'importacion', simulacion: false, disparo: 'automatica', estado: 'completada',
		inicio: '2026-10-13T03:45:00-04:00', fin: '2026-10-13T03:45:00-04:00', duracion_ms: 121,
		resumen: resumirImportacion(CONTADORES_4, false),
		contadores: CONTADORES_4,
		lineas: LINEAS_IMPORTACION_REPETIDA,
		config_snapshot: SNAPSHOT,
	},
	{
		id: 5, tipo: 'pagadas', simulacion: false, disparo: 'automatica', estado: 'fallida',
		inicio: '2026-10-13T03:45:04-04:00', fin: '2026-10-13T03:45:06-04:00', duracion_ms: 2043,
		resumen: `Falló: ${ERROR_CREDENCIALES.mensaje} (${ERROR_CREDENCIALES.endpoint})`,
		error: ERROR_CREDENCIALES,
		contadores: CONTADORES_5,
		lineas: [],
		config_snapshot: SNAPSHOT,
	},
]

const resumenDe = (corrida: CorridaDetalle): CorridaResumen => ({
	id: corrida.id,
	tipo: corrida.tipo,
	simulacion: corrida.simulacion,
	disparo: corrida.disparo,
	estado: corrida.estado,
	inicio: corrida.inicio,
	fin: corrida.fin,
	duracion_ms: corrida.duracion_ms,
	resumen: corrida.resumen,
	...(corrida.error ? { error: corrida.error } : {}),
})

const POR_FECHA = [...CORRIDAS_DETALLE].sort((a, b) => b.id - a.id)

export const LISTA_CORRIDAS: ListaCorridas = {
	total: POR_FECHA.length,
	corridas: POR_FECHA.map(resumenDe),
}

export const corridaPorId = (id: number): CorridaDetalle | undefined => CORRIDAS_DETALLE.find(c => c.id === id)

// ---------------------------------------------------------------- configuración y resumen

export const CONFIGURACION: Configuracion = {
	empresa: {
		nombre: 'ISP de Prueba (sandbox)',
		rif: 'J-00000000-0',
		email_cobranza: 'cobranza@example.com',
		zona_horaria: 'America/Caracas',
		moneda: 'USD',
	},
	proveedor: {
		nombre: 'Administrador de facturas',
		api_url: 'http://127.0.0.1:4310',
		usuario: 'cobrix',
		password_definida: true,
		estados_importables: IMPORTABLES,
		ventana_meses: null,
		max_cuotas_recientes: null,
		dias_gracia: DIAS_GRACIA,
		tope_facturas: null,
		tope_monto_centavos: null,
		excluir_tipos_documento: [],
		auto_activa: false,
		auto_hora: '03:00',
		actualizado_en: AHORA,
		docs_url: 'http://127.0.0.1:4310/docs',
	},
}

export const RESUMEN: Resumen = {
	totales: {
		clientes: CLIENTES.length,
		contratos: CONTRATOS_ESPEJADOS,
		contratos_leidos_ultima_corrida: CONTRATOS_LEIDOS,
		facturas_abiertas: FACTURAS.filter(f => f.estado === 'abierta').length,
		facturas_pagadas: FACTURAS.filter(f => f.estado === 'pagada').length,
		por_cobrar_centavos: FACTURAS.filter(f => f.estado === 'abierta').reduce((suma, f) => suma + f.saldo_centavos, 0),
	},
	empresa: CONFIGURACION.empresa,
	proveedor: CONFIGURACION.proveedor,
	automatico: {
		activa: false,
		hora: CONFIGURACION.proveedor.auto_hora,
		zona: 'America/Caracas',
		ultima_ejecucion: '2026-10-13T07:45:04Z',
		proxima_ejecucion: null,
	},
	ultimas_corridas: LISTA_CORRIDAS.corridas.slice(0, 5),
	sandbox: { hoy: FECHA_SANDBOX, periodo_actual: PERIODO_ACTUAL },
}

/** Respuesta de «Probar conexión» cuando todo va bien. */
export const PRUEBA_CONEXION_OK: PruebaConexion = {
	ok: true,
	mensaje: 'Conexión correcta: 27 contratos en el administrador de facturas.',
	contratos: 27,
	latencia_ms: 184,
}

/** Respuesta de «Probar conexión» con credenciales malas. */
export const PRUEBA_CONEXION_ERROR: PruebaConexion = {
	ok: false,
	mensaje: 'No se pudo iniciar sesión en el administrador de facturas.',
	error: ERROR_CREDENCIALES,
}

/** Error de muestra para revisar el bloque de error de cada pantalla. */
export const ERROR_EJEMPLO: ErrorPanel = {
	codigo: 'tiempo_agotado',
	mensaje: 'El administrador no respondió en 10 s a GET /isp/lista_ids_contratos.',
	sugerencia: 'El administrador no respondió a tiempo. Reintenta; si persiste, avisa al ISP.',
	endpoint: 'GET /isp/lista_ids_contratos',
	status: null,
}

/** Guion de la consola en vivo: las decisiones de la importación, en orden (SPEC §5.3). */
export const GUION_CONSOLA = {
	corrida_id: 2,
	tipo: 'importacion' as const,
	total: LINEAS_IMPORTACION.length,
	lineas: LINEAS_IMPORTACION,
}
