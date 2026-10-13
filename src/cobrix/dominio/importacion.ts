/**
 * Reglas de importación: qué se trae del administrador de facturas, qué se deja fuera y por qué.
 *
 * Funciones puras (ENUNCIADO.md §4): entran filas ya validadas y la configuración, sale una
 * decisión por cuota con su motivo y su traza. Sin HTTP y sin base de datos, para que las
 * veinte reglas se puedan probar en una tabla.
 *
 * EL ORDEN IMPORTA. Verificado contra data/billing-api.sqlite (SANDBOX_TODAY=2026-10-13):
 * la cuota de SOFIA TORRES con saldo 0,001317 la publica `contrato/individual` como
 * `deuda: 0`. Si la coherencia de moneda se evaluara antes del descarte por saldo residual,
 * esa cuota mediría 0 % del precio del plan y arrastraría al contrato entero a
 * «moneda incoherente»: la corrida daría 2 contratos por moneda y 0 residuales en vez de
 * 1 y 1, y perdería las otras cuotas legítimas de esa clienta. Secuencia correcta:
 *   deuda_id "0" → estado → identificación → saldo residual → coherencia de moneda → cuota a cuota.
 *
 * POR QUÉ EXISTE `frescos`. El expediente muestra el contrato tal como está en el ISP: estado,
 * plan, precio y sucursal (ENUNCIADO.md §3.6). Si esos datos solo se actualizaran al importar una
 * cuota nueva, un contrato que pasa a CORTADO y no debe nada se quedaría ACTIVO en Cobrix para
 * siempre, y el panel mentiría sobre el ISP. Por eso la clasificación devuelve también los datos
 * vigentes del titular y del contrato, y los devuelve SOLO cuando el contrato superó todas las
 * comprobaciones de contrato (estado conocido e importable, identificación normalizable, tipo de
 * documento permitido y moneda coherente), que es justo cuando el flujo llega a la etapa cuota a
 * cuota. Si el contrato cayó antes, no hay nada fresco que ofrecer.
 *
 * Con UNA excepción, y es la que importa en cuanto existe la corrida de pagadas: un contrato AL
 * DÍA responde una sola fila con `deuda_id "0"` y retorna en el paso 1, antes de la etapa cuota a
 * cuota. Ese es justo el cliente que acaba de pagar todo, y dejarlo sin refrescar lo congelaría
 * para siempre con el estado que tenía el día que debía. Por eso ese retorno también ofrece
 * `frescos`, tras comprobar lo que SÍ se puede comprobar sin cuotas: estado conocido e
 * importable, identificación normalizable y tipo de documento permitido. La coherencia de moneda
 * se omite ahí a propósito: la regla compara la cuota más alta con el precio del plan y sin
 * cuotas no hay con qué comparar. Omitirla es seguro porque refrescar no inserta: lo único que
 * puede pasar es poner al día un contrato que Cobrix ya tenía.
 *
 * Y EL LÍMITE DURO: refrescar ACTUALIZA, NUNCA INSERTA. Quien consuma `frescos` solo puede tocar
 * clientes y contratos que Cobrix ya tiene. Si pudiera crear, cualquier titular cuyas cuotas
 * queden todas fuera (por ventana, por máximo de recientes o porque ya están importadas)
 * aparecería como cliente sin una sola factura y los 20 clientes de la aceptación pasarían a ser
 * más. `frescos` describe el presente del ISP; quién entra a Cobrix lo decide `candidatas`.
 */

import { addMonths } from '../../shared/dates.ts'
import { usd, type Centavos } from './dinero.ts'
import { normalizarIdentificacion, type Identificacion, type Persona, type TipoDocumento } from './identificacion.ts'
import { interpretarDetalleDeuda, periodoDeEtiqueta } from './periodo.ts'
import {
	pasoDescarta, pasoOk, pasoOmitida,
	type PasoTraza, type ResultadoImportacion,
} from './resultados.ts'
import type { FilaContrato, Lectura } from './tipos.ts'

/** Los estados que el administrador puede reportar. Cualquier otro deja al contrato fuera. */
export const ESTADOS_CONOCIDOS: readonly string[] = ['ACTIVO', 'CORTADO', 'CORTESIA', 'RETIRADO', 'RECHAZADO', 'ANULADO']

/** Un contrato en USD cuya cuota más alta no llega a este porcentaje del plan está mal reportado. */
const FRACCION_MINIMA_DEL_PLAN = 0.01

export interface ConfiguracionImportacion {
	readonly estadosImportables: readonly string[]
	/** Solo cuotas desde el mes actual menos N meses. `null` = sin ventana. */
	readonly ventanaMeses: number | null
	/** Máximo de cuotas recientes por contrato. `null` = todas. */
	readonly maxCuotasRecientes: number | null
	readonly diasGracia: number
	readonly topeFacturas: number | null
	readonly topeMonto: Centavos | null
	readonly excluirTiposDocumento: readonly TipoDocumento[]
}

export interface ContextoImportacion {
	/** `2026-10`. Se pasa, no se consulta, para que las reglas sean deterministas. */
	readonly periodoActual: string
	readonly configuracion: ConfiguracionImportacion
	/** `deuda_id` que Cobrix ya tiene: por eso la segunda corrida no duplica nada. */
	readonly yaImportadas: ReadonlySet<string>
}

export interface LineaImportacion {
	readonly contratoId: number
	readonly deudaId: string | null
	readonly periodo: string | null
	readonly monto: Centavos
	readonly resultado: ResultadoImportacion
	readonly motivo: string
	/** Cuántas cuotas resume la línea: 1 por cuota, N cuando el contrato cae completo. */
	readonly cuotas: number
	readonly traza: readonly PasoTraza[]
}

export interface DatosCliente {
	readonly id: string
	readonly tipoDocumento: TipoDocumento | null
	readonly numero: string
	readonly nombre: string
	readonly persona: Persona
	readonly email: string | null
	readonly telefono: string | null
}

export interface DatosContrato {
	readonly id: number
	readonly codigo: string
	readonly estado: string
	readonly plan: string
	readonly precio: Centavos
	readonly sucursal: string
	readonly moneda: string
}

/** Una cuota que pasó todas las reglas. Solo falta ver si cabe en los topes de la corrida. */
export interface Candidata {
	readonly contratoId: number
	readonly deudaId: string
	readonly periodo: string
	readonly venceEl: string
	readonly cortaEl: string
	readonly monto: Centavos
	readonly cliente: DatosCliente
	readonly contrato: DatosContrato
	readonly traza: readonly PasoTraza[]
}

/** Datos vigentes del titular y del contrato: sirven para REFRESCAR lo que Cobrix ya tiene. */
export interface DatosFrescos {
	readonly cliente: DatosCliente
	readonly contrato: DatosContrato
}

export interface ClasificacionContrato {
	readonly lineas: readonly LineaImportacion[]
	readonly candidatas: readonly Candidata[]
	/**
	 * `null` cuando el contrato quedó fuera antes de la etapa cuota a cuota: no se refresca lo
	 * que no se pudo verificar. Nunca autoriza a crear un cliente ni un contrato (ver cabecera).
	 */
	readonly frescos: DatosFrescos | null
}

export function clasificarContrato(
	contratoId: number,
	lectura: Lectura<readonly FilaContrato[]>,
	contexto: ContextoImportacion,
): ClasificacionContrato {
	const cfg = contexto.configuracion

	if (!lectura.ok) {
		return soloLineas([{
			contratoId, deudaId: null, periodo: null, monto: 0, cuotas: 0,
			resultado: 'respuesta_contradictoria',
			motivo: `La API se contradice: ${lectura.detalle}. El contrato queda fuera.`,
			traza: [pasoDescarta('lectura de la respuesta', lectura.detalle)],
		}])
	}

	const filas = lectura.datos
	if (filas.length === 0) return { lineas: [], candidatas: [], frescos: null }
	const base = filas[0]!

	// 1. La fila con deuda_id "0" no es una cuota: el contrato no debe nada.
	const sinDeuda = filas.filter(fila => fila.deudaId === '0')
	const cuotas = filas.filter(fila => fila.deudaId !== '0')
	const lineasSinDeuda: LineaImportacion[] = sinDeuda.map(() => ({
		contratoId, deudaId: null, periodo: null, monto: 0, cuotas: 0,
		resultado: 'sin_deuda',
		motivo: 'El administrador responde con la fila «deuda_id 0»: el contrato no debe nada.',
		traza: [pasoDescarta('fila deuda_id "0"', 'no es una cuota, es la señal de «sin deuda»')],
	}))
	// Un contrato al día no trae cuotas que clasificar, pero sí datos que poner al día.
	if (cuotas.length === 0) {
		return { lineas: lineasSinDeuda, candidatas: [], frescos: frescosDeContratoAlDia(base, cfg) }
	}

	const traza: PasoTraza[] = []

	// 2. Estado del contrato: desconocido o no importable.
	if (!ESTADOS_CONOCIDOS.includes(base.estado)) {
		return soloLineas([...lineasSinDeuda, lineaDeContrato(contratoId, cuotas, 'estado_desconocido',
			`Estado «${base.estado}» no reconocido. No se asume que sea importable.`,
			[...traza, pasoDescarta('estado del contrato', `«${base.estado}» no está entre los conocidos`)])])
	}
	if (!cfg.estadosImportables.includes(base.estado)) {
		const detalle = `«${base.estado}» no está en los importables (${cfg.estadosImportables.join(', ')})`
		return soloLineas([...lineasSinDeuda, ...cuotas.map(fila => ({
			contratoId,
			deudaId: fila.deudaId,
			periodo: periodoDeEtiqueta(fila.detalleDeuda[0]),
			monto: fila.deuda,
			cuotas: 1,
			resultado: 'excluida_estado' as const,
			motivo: `Contrato ${base.estado}: ${detalle}.`,
			traza: [...traza, pasoDescarta('estado del contrato', detalle)],
		}))])
	}
	traza.push(pasoOk('estado del contrato', `${base.estado} está entre los importables`))

	// 3. Titular: identificación utilizable y tipo de documento permitido.
	const identificacion = normalizarIdentificacion(base.identificacionBruta)
	if (identificacion === null) {
		return soloLineas([...lineasSinDeuda, lineaDeContrato(contratoId, cuotas, 'identificacion_invalida',
			`La identificación «${base.identificacionBruta}» no es utilizable: se esperaba letra opcional (V, E, J, G, P) y de 6 a 12 dígitos.`,
			[...traza, pasoDescarta('identificación del titular', `«${base.identificacionBruta}» no normaliza`)])])
	}
	traza.push(pasoOk('identificación del titular',
		`${base.identificacionBruta} → ${identificacion.id} (${identificacion.persona})`))

	if (identificacion.tipo !== null && cfg.excluirTiposDocumento.includes(identificacion.tipo)) {
		return soloLineas([...lineasSinDeuda, lineaDeContrato(contratoId, cuotas, 'tipo_documento_excluido',
			`Tipo de documento ${identificacion.tipo} excluido por configuración.`,
			[...traza, pasoDescarta('tipo de documento', `${identificacion.tipo} está en los excluidos`)])])
	}

	// 4. Saldo residual: el administrador sigue listando cuotas de menos de un centavo.
	const conSaldo = cuotas.filter(fila => fila.deuda >= 1)
	const lineasResiduales: LineaImportacion[] = cuotas
		.filter(fila => fila.deuda < 1)
		.map(fila => ({
			contratoId,
			deudaId: fila.deudaId,
			periodo: periodoDeEtiqueta(fila.detalleDeuda[0]),
			monto: fila.deuda,
			cuotas: 1,
			resultado: 'saldo_residual' as const,
			motivo: 'Saldo residual de menos de un centavo: no se importa.',
			traza: [
				...traza,
				pasoDescarta('saldo de la cuota', `${usd(fila.deuda)} es menos de un centavo`),
				pasoOmitida('coherencia de moneda', 'no se evalúa: la cuota ya quedó descartada'),
			],
		}))
	if (conSaldo.length === 0) return soloLineas([...lineasSinDeuda, ...lineasResiduales])

	// 5. Coherencia de moneda, a nivel de contrato y sobre las cuotas que sobrevivieron.
	const mayor = Math.max(...conSaldo.map(fila => fila.deuda))
	const minimo = Math.round(base.precioServicio * FRACCION_MINIMA_DEL_PLAN)
	if (base.monedaSigla !== 'USD') {
		return soloLineas([...lineasSinDeuda, ...lineasResiduales,
			lineaDeContrato(contratoId, conSaldo, 'moneda_incoherente',
				`El contrato reporta ${base.monedaSigla}: Cobrix solo importa USD.`,
				[...traza, pasoDescarta('coherencia de moneda', `moneda_sigla ${base.monedaSigla} ≠ USD`)])])
	}
	if (base.precioServicio > 0 && mayor < minimo) {
		return soloLineas([...lineasSinDeuda, ...lineasResiduales,
			lineaDeContrato(contratoId, conSaldo, 'moneda_incoherente',
				`Reporta USD pero su cuota más alta es ${usd(mayor)} frente a un plan de ${usd(base.precioServicio)} (menos del 1 %).`,
				[...traza, pasoDescarta('coherencia de moneda',
					`cuota mayor ${usd(mayor)} < 1 % del plan (${usd(minimo)})`)])])
	}
	traza.push(pasoOk('coherencia de moneda', `USD con cuotas de hasta ${usd(mayor)} sobre un plan de ${usd(base.precioServicio)}`))

	// 6. Cuota a cuota: periodo, idempotencia, ventana y máximo de recientes.
	const cliente = datosCliente(base, identificacion)
	const contrato = datosContrato(base)
	const lineas: LineaImportacion[] = [...lineasSinDeuda, ...lineasResiduales]
	const candidatas: Candidata[] = []

	const leidas = conSaldo.map(fila => ({ fila, vencimiento: interpretarDetalleDeuda(fila.detalleDeuda, cfg.diasGracia) }))
	for (const { fila, vencimiento } of leidas) {
		if (vencimiento === null) {
			lineas.push({
				contratoId, deudaId: fila.deudaId, periodo: null, monto: fila.deuda, cuotas: 1,
				resultado: 'periodo_invalido',
				motivo: `No se pudo leer el periodo de «${fila.detalleDeuda.join(' · ') || '(vacío)'}».`,
				traza: [...traza, pasoDescarta('periodo de la cuota', 'detalle_deuda no dice un periodo legible')],
			})
		}
	}

	// Las «recientes» se cuentan sobre todas las cuotas legibles del contrato, incluidas las
	// que Cobrix ya importó: así el conjunto conservado no cambia de una corrida a otra.
	const legibles = leidas.filter(item => item.vencimiento !== null)
	const recientes = new Set(
		[...legibles]
			.sort((a, b) => (a.vencimiento!.periodo < b.vencimiento!.periodo ? 1 : a.vencimiento!.periodo > b.vencimiento!.periodo ? -1 : 0))
			.slice(0, cfg.maxCuotasRecientes ?? legibles.length)
			.map(item => item.fila.deudaId),
	)
	const desde = cfg.ventanaMeses === null ? null : addMonths(contexto.periodoActual, -cfg.ventanaMeses)

	for (const { fila, vencimiento } of legibles) {
		const periodo = vencimiento!.periodo
		const trazaCuota = [...traza, pasoOk('periodo de la cuota',
			`${fila.detalleDeuda[0]} → ${periodo}, vence ${vencimiento!.venceEl}, corta ${vencimiento!.cortaEl}`)]

		if (contexto.yaImportadas.has(fila.deudaId)) {
			lineas.push({
				contratoId, deudaId: fila.deudaId, periodo, monto: fila.deuda, cuotas: 1,
				resultado: 'ya_importada',
				motivo: 'La cuota ya tiene su factura en Cobrix: no se duplica.',
				traza: [...trazaCuota,
					pasoOk('idempotencia', `la cuota ${fila.deudaId} ya existe en Cobrix`),
					pasoOmitida('ventana y máximo de recientes', 'no se reevalúan: la factura ya existe')],
			})
			continue
		}

		if (desde !== null && periodo < desde) {
			lineas.push({
				contratoId, deudaId: fila.deudaId, periodo, monto: fila.deuda, cuotas: 1,
				resultado: 'fuera_de_ventana',
				motivo: `Periodo ${periodo}, anterior a la ventana de ${cfg.ventanaMeses} meses (desde ${desde}).`,
				traza: [...trazaCuota, pasoDescarta('ventana de importación', `${periodo} < ${desde}`)],
			})
			continue
		}

		if (!recientes.has(fila.deudaId)) {
			lineas.push({
				contratoId, deudaId: fila.deudaId, periodo, monto: fila.deuda, cuotas: 1,
				resultado: 'limite_recientes',
				motivo: `Solo se conservan las ${cfg.maxCuotasRecientes} cuotas más recientes del contrato.`,
				traza: [...trazaCuota, pasoDescarta('máximo de cuotas recientes',
					`${periodo} queda fuera de las ${cfg.maxCuotasRecientes} más recientes`)],
			})
			continue
		}

		candidatas.push({
			contratoId, deudaId: fila.deudaId, periodo,
			venceEl: vencimiento!.venceEl, cortaEl: vencimiento!.cortaEl,
			monto: fila.deuda, cliente, contrato,
			traza: [...trazaCuota, pasoOk('idempotencia', 'la cuota todavía no está en Cobrix')],
		})
	}

	return { lineas, candidatas, frescos: { cliente, contrato } }
}

/**
 * Topes de la corrida. Dos decisiones deliberadas:
 *
 *  - El recorte se hace sobre un orden fijo (periodo, contrato, cuota), así que frenar es
 *    reproducible: la misma base deja fuera exactamente las mismas cuotas.
 *  - Al llegar al tope la corrida SE DETIENE; no sigue buscando cuotas más baratas que todavía
 *    quepan. Rellenar el hueco importaría una cuota nueva antes que una más vieja y el operador
 *    no tendría forma de explicar por qué se saltó una deuda y se trajo otra.
 */
export function aplicarTopes(
	candidatas: readonly Candidata[],
	cfg: ConfiguracionImportacion,
): { readonly aImportar: readonly Candidata[]; readonly frenadas: readonly LineaImportacion[] } {
	const ordenadas = [...candidatas].sort((a, b) =>
		a.periodo.localeCompare(b.periodo) || a.contratoId - b.contratoId || a.deudaId.localeCompare(b.deudaId))

	const aImportar: Candidata[] = []
	const frenadas: LineaImportacion[] = []
	let monto = 0
	let tope: 'tope_facturas' | 'tope_monto' | null = null

	for (const candidata of ordenadas) {
		if (tope === null) {
			if (cfg.topeFacturas !== null && aImportar.length >= cfg.topeFacturas) tope = 'tope_facturas'
			else if (cfg.topeMonto !== null && monto + candidata.monto > cfg.topeMonto) tope = 'tope_monto'
		}
		if (tope === null) {
			monto += candidata.monto
			aImportar.push(candidata)
			continue
		}
		const regla = tope === 'tope_facturas' ? 'tope de facturas nuevas' : 'tope de monto nuevo'
		frenadas.push({
			contratoId: candidata.contratoId, deudaId: candidata.deudaId, periodo: candidata.periodo,
			monto: candidata.monto, cuotas: 1,
			resultado: tope,
			motivo: tope === 'tope_facturas'
				? `La corrida alcanzó el tope de ${cfg.topeFacturas} facturas nuevas: queda frenada, no se importa.`
				: `La corrida alcanzó el tope de ${usd(cfg.topeMonto ?? 0)} de monto nuevo: queda frenada, no se importa.`,
			traza: [...candidata.traza, pasoDescarta(regla, 'la corrida ya llegó al tope configurado')],
		})
	}

	return { aImportar, frenadas }
}

/**
 * Datos vigentes de un contrato sin cuotas pendientes. Repite las comprobaciones de contrato que
 * no necesitan cuotas y omite la de moneda (ver la cabecera). No produce ni una línea: solo dice
 * si este contrato es de los que Cobrix puede poner al día.
 */
function frescosDeContratoAlDia(base: FilaContrato, cfg: ConfiguracionImportacion): DatosFrescos | null {
	if (!ESTADOS_CONOCIDOS.includes(base.estado) || !cfg.estadosImportables.includes(base.estado)) return null
	const identificacion = normalizarIdentificacion(base.identificacionBruta)
	if (identificacion === null) return null
	if (identificacion.tipo !== null && cfg.excluirTiposDocumento.includes(identificacion.tipo)) return null
	return { cliente: datosCliente(base, identificacion), contrato: datosContrato(base) }
}

function soloLineas(lineas: readonly LineaImportacion[]): ClasificacionContrato {
	return { lineas, candidatas: [], frescos: null }
}

function lineaDeContrato(
	contratoId: number,
	afectadas: readonly FilaContrato[],
	resultado: ResultadoImportacion,
	motivo: string,
	traza: readonly PasoTraza[],
): LineaImportacion {
	const monto = afectadas.reduce((total, fila) => total + fila.deuda, 0)
	return {
		contratoId, deudaId: null, periodo: null, monto, cuotas: afectadas.length,
		resultado,
		motivo: `${motivo} Quedan fuera ${afectadas.length} cuota(s) por ${usd(monto)}.`,
		traza,
	}
}

function datosCliente(fila: FilaContrato, identificacion: Identificacion): DatosCliente {
	return {
		id: identificacion.id,
		tipoDocumento: identificacion.tipo,
		numero: identificacion.numero,
		nombre: fila.nombre,
		persona: identificacion.persona,
		email: fila.email,
		telefono: fila.telefono,
	}
}

function datosContrato(fila: FilaContrato): DatosContrato {
	return {
		id: fila.contratoId,
		codigo: fila.codigo,
		estado: fila.estado,
		plan: fila.plan,
		precio: fila.precioServicio,
		sucursal: fila.sucursal,
		moneda: fila.monedaSigla,
	}
}
