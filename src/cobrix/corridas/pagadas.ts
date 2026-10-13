/**
 * Corrida de actualización de pagadas (ENUNCIADO.md §3.3, docs/SPEC.md §3.5): el espejo de la
 * importación. Mismo cerrojo, mismo registro en el historial, misma transacción única y mismo
 * trato de los errores de la API. Las reglas viven en `dominio/pagos.ts`; aquí solo se ordenan
 * los pasos y se escribe.
 *
 * LA VENTANA DEL LIBRO NO ES DECORATIVA. `pago_informacion` filtra por la fecha de emisión de la
 * factura que tocó la cuota y, cuando una cuota no tiene ningún cobro, el administrador le pone
 * una fecha sintética: el ÚLTIMO día de su periodo. Por eso `hasta` es `lastDayOfPeriod` del
 * periodo actual y no «hoy»: con un `hasta` en 2026-10-13 la cuota del mes en curso (fecha
 * sintética 2026-10-31) desaparecería del libro y la leeríamos como si no existiera, cuando
 * simplemente no se ha cobrado todavía. `desde` es el primer día del periodo más viejo que Cobrix
 * tiene abierto en ESE contrato: ni se pide más historia de la necesaria ni se deja fuera el cobro
 * de la cuota más vieja.
 *
 * TRES DECISIONES QUE CONVIENE SABER:
 *  1. **Una factura ya pagada en Cobrix produce `ya_pagada` sin preguntarle nada a la API**
 *     (SPEC §1.3: repetir la corrida da 8 `ya_pagada`). Solo las ABIERTAS van al libro, y solo
 *     ellas aportan al cálculo de la ventana.
 *  2. **`contrato/individual` se pide una sola vez por contrato**, y solo si alguna de sus
 *     facturas no apareció en el libro: es el desempate del mes en curso de ENUNCIADO.md §4.
 *  3. **Una respuesta ilegible nunca se interpreta como «no pagada» ni como «sin evidencia»**:
 *     la factura sale `inconsistente` y queda intacta. Nada se adivina.
 */

import { currentPeriod, lastDayOfPeriod } from '../../shared/dates.ts'
import { crearCliente, ErrorApi, type ClienteAdministrador, type OpcionesCliente } from '../api/cliente.ts'
import { enTransaccion, type Almacen } from '../almacen/base.ts'
import { registrarEvento } from '../almacen/clientes.ts'
import { leerConfiguracion, leerCredenciales } from '../almacen/configuracion.ts'
import {
	abrirCorrida, cerrarCorrida, fallarCorrida, guardarLineas,
	type DisparoCorrida, type ErrorCorrida, type LineaCorridaEntrada,
} from '../almacen/corridas.ts'
import { facturasAbiertas, facturasPagadas, marcarPagada, type FacturaConTitular } from '../almacen/facturas.ts'
import { mapConLimite } from '../apoyo/limite.ts'
import { reglasDe } from '../dominio/configuracion.ts'
import { usd, type Centavos } from '../dominio/dinero.ts'
import { evaluarPago, veredictoSinLibro, type VeredictoPago } from '../dominio/pagos.ts'
import { describir, pasoDescarta, pasoOk, type PasoTraza, type Resultado } from '../dominio/resultados.ts'
import type { FilaLibro } from '../dominio/tipos.ts'
import { ProveedorSinCredenciales } from './importacion.ts'
import { crearProgreso, type AlProgresar } from './progreso.ts'

const CONCURRENCIA_POR_DEFECTO = 4

export interface OpcionesCorridaPagadas {
	/** `true` hace exactamente lo mismo sin escribir nada de dominio. */
	readonly simulacion?: boolean
	readonly disparo?: DisparoCorrida
	readonly opcionesCliente?: OpcionesCliente
	readonly concurrencia?: number
	/** Progreso en vivo para el SSE del panel. Sin esto, la corrida no gasta nada en progreso. */
	readonly alProgresar?: AlProgresar
}

export interface ContadoresPagadas {
	readonly contratos: number
	readonly facturasRevisadas: number
	readonly facturasPagadas: number
	readonly montoCobrado: Centavos
	/** Facturas por resultado. Su suma es `facturasRevisadas`: ninguna queda sin explicación. */
	readonly facturas: Readonly<Record<string, number>>
	/** Líneas por resultado. En esta corrida hay exactamente una línea por factura. */
	readonly lineas: Readonly<Record<string, number>>
}

export interface ResultadoCorridaPagadas {
	readonly corridaId: number
	readonly estado: 'completada' | 'fallida'
	readonly simulacion: boolean
	readonly contadores: ContadoresPagadas
	readonly resumen: string
	readonly error: ErrorCorrida | null
}

/** Una factura revisada con su veredicto: lo que va a la línea y, si toca, a la escritura. */
interface Decision {
	readonly factura: FacturaConTitular
	readonly veredicto: VeredictoPago
}

export async function correrActualizacionDePagadas(
	almacen: Almacen,
	opciones: OpcionesCorridaPagadas = {},
): Promise<ResultadoCorridaPagadas> {
	const simulacion = opciones.simulacion ?? false
	const concurrencia = opciones.concurrencia ?? CONCURRENCIA_POR_DEFECTO

	const { proveedor } = leerConfiguracion(almacen)
	const credenciales = leerCredenciales(almacen)
	if (credenciales === null) throw new ProveedorSinCredenciales()

	const periodoActual = currentPeriod()
	const hasta = lastDayOfPeriod(periodoActual)
	const corrida = abrirCorrida(almacen, {
		tipo: 'pagadas',
		simulacion,
		disparo: opciones.disparo ?? 'manual',
		configuracion: {
			proveedor: { nombre: proveedor.nombre, apiUrl: proveedor.apiUrl, usuario: proveedor.usuario },
			// Las reglas no deciden nada aquí, pero el detalle de la corrida enseña el mismo
			// bloque de configuración para los dos tipos: una sola forma que leer en el panel.
			reglas: reglasDe(proveedor),
			periodoActual,
			ventanaDelLibro: { hasta, desde: 'el primer día del periodo más viejo abierto en cada contrato' },
		},
	})

	const progreso = crearProgreso(corrida.id, 'Conectando con el administrador', 0, opciones.alProgresar)
	progreso.empezar()
	const lineas: LineaCorridaEntrada[] = []
	let contratos = 0

	try {
		// 1. Las que Cobrix ya tenía pagadas se explican sin molestar al administrador.
		const yaPagadas = facturasPagadas(almacen)
		const abiertas = facturasAbiertas(almacen)
		const porContrato = agruparPorContrato(abiertas)
		contratos = porContrato.length

		const decisiones: Decision[] = yaPagadas.map(factura => ({ factura, veredicto: veredictoYaPagada(factura) }))

		// 2. Solo las abiertas van al libro. Sin ninguna, la corrida no toca la API.
		progreso.fijarTotal(porContrato.length, 'Revisando el libro de cuotas')
		if (porContrato.length > 0) {
			const api = crearCliente(credenciales, opciones.opcionesCliente)
			// Los cuatro obreros pueden arrancar juntos: `api/cliente.ts` comparte el login en vuelo
			// y hacen una sola sesión entre todos.
			const porLote = await mapConLimite(porContrato, concurrencia, async grupo => {
				const lote = await revisarContrato(api, grupo, hasta)
				progreso.avanzar(lote.map(lineaDePago))
				return lote
			})
			for (const lote of porLote) decisiones.push(...lote)
		}

		for (const decision of decisiones) lineas.push(lineaDePago(decision))

		// 3. Escritura. Simulación: corrida y líneas. Real: todo en una transacción.
		const contadores = enTransaccion(almacen.db, () => {
			if (!simulacion) escribirPagos(almacen, corrida.id, decisiones)
			const cuenta = contar(lineas, contratos)
			guardarLineas(almacen, corrida.id, lineas)
			cerrarCorrida(almacen, corrida.id, { contadores: cuenta, resumen: resumir(cuenta, simulacion) })
			return cuenta
		})

		progreso.cerrar(contadores.lineas)
		return {
			corridaId: corrida.id,
			estado: 'completada',
			simulacion,
			contadores,
			resumen: resumir(contadores, simulacion),
			error: null,
		}
	} catch (error: unknown) {
		// La transacción ya revirtió: ninguna factura quedó marcada. Se registra el fallo aparte y
		// se descartan las líneas `marcada_pagada`, que describían algo que no ocurrió.
		const sinEscrituras = lineas.filter(linea => linea.resultado !== 'marcada_pagada')
		const contadores = contar(sinEscrituras, contratos)
		const detalle = describirError(error)
		progreso.cerrar(contadores.lineas, `Corrida fallida: ${detalle.mensaje}`)
		enTransaccion(almacen.db, () => {
			guardarLineas(almacen, corrida.id, sinEscrituras)
			fallarCorrida(almacen, corrida.id, detalle, {
				contadores,
				resumen: `Falló: ${detalle.mensaje}${detalle.endpoint === null ? '' : ` (${detalle.endpoint})`}`,
			})
		})
		return {
			corridaId: corrida.id,
			estado: 'fallida',
			simulacion,
			contadores,
			resumen: `Falló: ${detalle.mensaje}`,
			error: detalle,
		}
	}
}

interface GrupoContrato {
	readonly contratoId: number
	readonly facturas: readonly FacturaConTitular[]
	/** Primer día del periodo más viejo abierto: el inicio de la ventana del libro. */
	readonly desde: string
}

function agruparPorContrato(abiertas: readonly FacturaConTitular[]): readonly GrupoContrato[] {
	const porContrato = new Map<number, FacturaConTitular[]>()
	for (const factura of abiertas) {
		const grupo = porContrato.get(factura.contratoId)
		if (grupo === undefined) porContrato.set(factura.contratoId, [factura])
		else grupo.push(factura)
	}
	return [...porContrato.entries()]
		.sort(([a], [b]) => a - b)
		.map(([contratoId, facturas]) => ({
			contratoId,
			facturas,
			desde: `${facturas.map(factura => factura.periodo).reduce((a, b) => (a < b ? a : b))}-01`,
		}))
}

/**
 * Un contrato, de principio a fin: libro, veredictos y, si alguna cuota no apareció, UNA consulta
 * al contrato para desempatar entre «abierta sin cobro» y «sin evidencia».
 */
async function revisarContrato(
	api: ClienteAdministrador,
	grupo: GrupoContrato,
	hasta: string,
): Promise<readonly Decision[]> {
	const libro = await api.libroDeCuotas(grupo.contratoId, grupo.desde, hasta)
	if (!libro.ok) {
		// El libro no se puede leer: ninguna factura se toca y ninguna se declara sin evidencia.
		return grupo.facturas.map(factura => ({
			factura,
			veredicto: veredictoIlegible(factura, `El libro del contrato ${grupo.contratoId} no se pudo leer: ${libro.detalle}.`,
				'libro de cuotas'),
		}))
	}

	// Las cuotas del libro que no correspondan a una factura abierta (futuras, fantasmas, ya
	// cobradas hace meses) se descartan sin contarlas: no son líneas de esta corrida.
	const porCuota = new Map<string, FilaLibro[]>()
	for (const fila of libro.datos) {
		const clave = String(fila.cuotaId)
		const filas = porCuota.get(clave)
		if (filas === undefined) porCuota.set(clave, [fila])
		else filas.push(fila)
	}

	const decisiones: Decision[] = []
	const pendientesDeContrato: Array<{ factura: FacturaConTitular; traza: readonly PasoTraza[] }> = []
	for (const factura of grupo.facturas) {
		const evaluacion = evaluarPago(factura, porCuota.get(factura.deudaId) ?? [])
		if (evaluacion.tipo === 'veredicto') decisiones.push({ factura, veredicto: evaluacion.veredicto })
		else pendientesDeContrato.push({ factura, traza: evaluacion.traza })
	}

	if (pendientesDeContrato.length > 0) {
		const contrato = await api.cuotasDeContrato(grupo.contratoId)
		if (!contrato.ok) {
			for (const { factura } of pendientesDeContrato) {
				decisiones.push({
					factura,
					veredicto: veredictoIlegible(factura,
						`La cuota ${factura.deudaId} no está en el libro y la respuesta del contrato no se pudo leer: ${contrato.detalle}.`,
						'contrato/individual'),
				})
			}
		} else {
			const pendientes = new Set(contrato.datos.filter(fila => fila.deudaId !== '0' && fila.deuda > 0)
				.map(fila => fila.deudaId))
			for (const { factura, traza } of pendientesDeContrato) {
				decisiones.push({ factura, veredicto: veredictoSinLibro(factura, pendientes.has(factura.deudaId), traza) })
			}
		}
	}

	// Se devuelve en el orden en que Cobrix tiene las facturas, no en el de las respuestas.
	const porId = new Map(decisiones.map(decision => [decision.factura.facturaId, decision]))
	return grupo.facturas.flatMap(factura => {
		const decision = porId.get(factura.facturaId)
		return decision === undefined ? [] : [decision]
	})
}

function escribirPagos(almacen: Almacen, corridaId: number, decisiones: readonly Decision[]): void {
	for (const { factura, veredicto } of decisiones) {
		if (veredicto.resultado !== 'marcada_pagada' || veredicto.cobro === undefined) continue
		const cobro = veredicto.cobro
		marcarPagada(almacen, factura.facturaId, {
			pagadaEl: cobro.fecha,
			ispFacturaId: cobro.facturaIspId,
			ispFacturaNum: cobro.facturaIspNum,
			corridaPago: corridaId,
		})
		registrarEvento(almacen, {
			clienteId: factura.clienteId,
			facturaId: factura.facturaId,
			tipo: 'factura_pagada',
			corridaId,
			detalle: `El ISP cobró ${usd(factura.saldo)} de la cuota ${factura.deudaId} con su factura ${cobro.facturaIspNum} del ${cobro.fecha}.`,
		}, `${cobro.fecha}T00:00:00`)
	}
}

function lineaDePago({ factura, veredicto }: Decision): LineaCorridaEntrada {
	return {
		contratoId: factura.contratoId,
		titularNombre: factura.clienteNombre,
		titularIdentificacion: factura.clienteId,
		deudaId: factura.deudaId,
		periodo: factura.periodo,
		// Lo que está en juego: el saldo abierto o, si ya estaba pagada, lo que se cobró.
		monto: factura.saldo > 0 ? factura.saldo : factura.total,
		cuotas: 1,
		resultado: veredicto.resultado,
		motivo: veredicto.motivo,
		traza: veredicto.traza,
		facturaId: factura.facturaId,
	}
}

function veredictoYaPagada(factura: FacturaConTitular): VeredictoPago {
	return {
		resultado: 'ya_pagada',
		motivo: `Cobrix ya la tenía pagada: no se vuelve a revisar contra el administrador.`,
		traza: [
			pasoOk('factura pagada en Cobrix', `cuota ${factura.deudaId}, periodo ${factura.periodo}, ${usd(factura.total)}`),
			pasoOk('idempotencia', 'una factura pagada no se vuelve a cobrar ni se consulta de nuevo'),
		],
	}
}

function veredictoIlegible(factura: FacturaConTitular, motivo: string, regla: string): VeredictoPago {
	return {
		resultado: 'inconsistente',
		motivo: `${motivo} La factura ${factura.facturaId} queda intacta: nada se adivina.`,
		traza: [pasoDescarta(regla, 'la respuesta no se pudo leer: no se concluye nada sobre el pago')],
	}
}

/**
 * Contadores que cuadran: cada factura revisada aporta exactamente una línea y las
 * `marcada_pagada` son exactamente las facturas que cambiaron de estado.
 */
function contar(lineas: readonly LineaCorridaEntrada[], contratos: number): ContadoresPagadas {
	const facturas: Record<string, number> = {}
	const porLinea: Record<string, number> = {}
	let pagadas = 0
	let montoCobrado = 0

	for (const linea of lineas) {
		const resultado: Resultado = linea.resultado
		facturas[resultado] = (facturas[resultado] ?? 0) + 1
		porLinea[resultado] = (porLinea[resultado] ?? 0) + 1
		if (resultado === 'marcada_pagada') {
			pagadas++
			montoCobrado += linea.monto
		}
	}

	return {
		contratos,
		facturasRevisadas: lineas.length,
		facturasPagadas: pagadas,
		montoCobrado,
		facturas,
		lineas: porLinea,
	}
}

/** Una línea para la lista del historial. */
function resumir(contadores: ContadoresPagadas, simulacion: boolean): string {
	if (contadores.facturasRevisadas === 0) return 'No hay facturas en Cobrix: nada que revisar.'
	const partes: string[] = []
	partes.push(contadores.facturasPagadas === 0
		? (simulacion ? 'No se marcaría ninguna factura pagada' : 'Ninguna factura nueva pagada')
		: `${simulacion ? 'Se marcarían ' : ''}${contadores.facturasPagadas} facturas pagadas por ${usd(contadores.montoCobrado)}`)

	const atencion = Object.entries(contadores.facturas)
		.filter(([resultado]) => describir(resultado as Resultado).tono === 'warn' || describir(resultado as Resultado).tono === 'bad')
		.map(([resultado, cuantas]) => `${cuantas} ${describir(resultado as Resultado).etiqueta.toLowerCase()}`)
	if (atencion.length > 0) partes.push(atencion.join(', '))

	const yaPagadas = contadores.facturas.ya_pagada ?? 0
	if (yaPagadas > 0) partes.push(`${yaPagadas} ya estaban pagadas`)
	const abiertas = contadores.facturasRevisadas - contadores.facturasPagadas - yaPagadas
	if (abiertas > 0) partes.push(`${abiertas} siguen abiertas`)
	return `${simulacion ? 'Simulación · ' : ''}${partes.join('; ')}`
}

function describirError(error: unknown): ErrorCorrida {
	if (error instanceof ErrorApi) {
		return {
			mensaje: error.message,
			codigo: error.codigo,
			endpoint: error.endpoint,
			status: error.status,
			sugerencia: error.sugerencia,
		}
	}
	return {
		mensaje: error instanceof Error ? error.message : String(error),
		codigo: 'interno',
		endpoint: null,
		status: null,
		sugerencia: 'Ninguna factura cambió de estado. El detalle de la corrida tiene lo ya revisado.',
	}
}
