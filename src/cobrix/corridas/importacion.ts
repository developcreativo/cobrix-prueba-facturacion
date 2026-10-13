/**
 * Corrida de importación: la orquestación que conecta el administrador de facturas con la base
 * de Cobrix (ENUNCIADO.md §3.2, docs/SPEC.md §3.4). Aquí no se decide nada: las reglas están en
 * `dominio/importacion.ts` y la persistencia en `almacen/`. Esto solo ordena los pasos.
 *
 * Los cuatro invariantes que sostiene este módulo:
 *
 *  1. **Se recorren TODOS los contratos** (`lista_ids_contratos` sin `estado`), en orden
 *     ascendente y con concurrencia 4, y el tope se aplica UNA vez sobre el conjunto completo
 *     de candidatas: el tope es por corrida, no por contrato.
 *  2. **Una simulación no escribe nada de dominio.** Ni cliente, ni contrato, ni factura, ni
 *     evento. Sí se registran la corrida y sus líneas, porque el historial debe mostrarlas.
 *  3. **Una corrida real es una sola transacción.** Clientes, contratos, facturas, eventos y
 *     líneas entran juntos o no entran. La corrida se abre antes (transacción propia), la API se
 *     lee fuera de toda transacción y, si la escritura revierte, el fallo se registra después en
 *     otra transacción: así una corrida fallida existe en el historial sin dejar datos a medias.
 *  4. **Refrescar no inserta.** Un contrato importable que no trae ninguna cuota nueva igual
 *     actualiza a su titular y a su contrato (`ClasificacionContrato.frescos`), para que el
 *     expediente no mienta sobre el ISP; pero solo con UPDATE. Si pudiera crear, LAURA MENDEZ
 *     (ACTIVO y sin deuda) entraría como cliente sin una sola factura y los 20 clientes de la
 *     aceptación serían 21.
 *  5. **Cualquier `ErrorApi` aborta la corrida completa.** Una importación a medias no se
 *     distingue de «no había nada que importar», y el operador necesita saber que el ISP se cayó.
 *     Un contrato ilegible (`lectura.ok === false`) no es eso: lo clasifica el dominio como
 *     `respuesta_contradictoria` y la corrida sigue.
 */

import { currentPeriod } from '../../shared/dates.ts'
import { crearCliente, ErrorApi, type OpcionesCliente } from '../api/cliente.ts'
import { enTransaccion, type Almacen } from '../almacen/base.ts'
import {
	clientesExistentes, contratosExistentes, guardarCliente, guardarContrato,
	refrescarCliente, refrescarContrato, registrarEvento,
} from '../almacen/clientes.ts'
import { leerConfiguracion, leerCredenciales } from '../almacen/configuracion.ts'
import {
	abrirCorrida, cerrarCorrida, fallarCorrida, guardarLineas,
	type DisparoCorrida, type ErrorCorrida, type LineaCorridaEntrada,
} from '../almacen/corridas.ts'
import { deudasImportadas, insertarFactura } from '../almacen/facturas.ts'
import { mapConLimite } from '../apoyo/limite.ts'
import { reglasDe } from '../dominio/configuracion.ts'
import { usd, type Centavos } from '../dominio/dinero.ts'
import {
	aplicarTopes, clasificarContrato,
	type Candidata, type ContextoImportacion, type DatosFrescos,
} from '../dominio/importacion.ts'
import { describir, pasoOk, pasoOmitida, type Resultado } from '../dominio/resultados.ts'
import { crearProgreso, type AlProgresar } from './progreso.ts'

const CONCURRENCIA_POR_DEFECTO = 4

/** La corrida no arranca a ciegas: sin contraseña no hay nada que probar contra el ISP. */
export class ProveedorSinCredenciales extends Error {
	readonly sugerencia: string

	constructor() {
		super('El proveedor no tiene contraseña guardada: la corrida no arranca.')
		this.name = 'ProveedorSinCredenciales'
		this.sugerencia = 'Completa usuario y contraseña en Configuración → Proveedor y usa «Probar conexión».'
	}
}

export interface OpcionesCorrida {
	/** `true` hace exactamente lo mismo sin escribir nada de dominio. */
	readonly simulacion?: boolean
	readonly disparo?: DisparoCorrida
	/** Para las pruebas: reintentos sin espera, `fetch` propio, tiempos más cortos. */
	readonly opcionesCliente?: OpcionesCliente
	readonly concurrencia?: number
	/** Progreso en vivo para el SSE del panel. Sin esto, la corrida no gasta nada en progreso. */
	readonly alProgresar?: AlProgresar
}

export interface ContadoresImportacion {
	readonly contratos: number
	/** Cuotas que el administrador reportó (sin contar la fila «deuda_id 0», que no es cuota). */
	readonly cuotasVistas: number
	readonly clientesNuevos: number
	/** Clientes y contratos que ya existían y la corrida puso al día (nunca se crean aquí). */
	readonly clientesRefrescados: number
	readonly contratosRefrescados: number
	readonly facturasNuevas: number
	readonly montoNuevo: Centavos
	readonly cuotasExcluidas: number
	/** Cuotas por resultado. Su suma es `cuotasVistas`: ninguna cuota se queda sin explicación. */
	readonly cuotas: Readonly<Record<string, number>>
	/** Líneas por resultado. Una línea puede resumir un contrato entero (`cuotas > 1`). */
	readonly lineas: Readonly<Record<string, number>>
}

export interface ResultadoCorridaImportacion {
	readonly corridaId: number
	readonly estado: 'completada' | 'fallida'
	readonly simulacion: boolean
	readonly contadores: ContadoresImportacion
	readonly resumen: string
	readonly error: ErrorCorrida | null
}

/**
 * Ejecuta la corrida. Devuelve el resultado incluso cuando falla: una corrida fallida es un
 * desenlace normal que el historial muestra. Solo lanza cuando no llegó a arrancar:
 * `ProveedorSinCredenciales` (falta configurar) y `CorridaEnCurso` (cerrojo tomado).
 */
export async function correrImportacion(
	almacen: Almacen,
	opciones: OpcionesCorrida = {},
): Promise<ResultadoCorridaImportacion> {
	const simulacion = opciones.simulacion ?? false
	const concurrencia = opciones.concurrencia ?? CONCURRENCIA_POR_DEFECTO

	const { proveedor } = leerConfiguracion(almacen)
	const credenciales = leerCredenciales(almacen)
	if (credenciales === null) throw new ProveedorSinCredenciales()

	const reglas = reglasDe(proveedor)
	const corrida = abrirCorrida(almacen, {
		tipo: 'importacion',
		simulacion,
		disparo: opciones.disparo ?? 'manual',
		// Sin la contraseña: el snapshot se muestra en el panel.
		configuracion: { proveedor: { nombre: proveedor.nombre, apiUrl: proveedor.apiUrl, usuario: proveedor.usuario }, reglas },
	})

	const momento = corrida.inicio
	const progreso = crearProgreso(corrida.id, 'Conectando con el administrador', 0, opciones.alProgresar)
	progreso.empezar()
	const lineas: LineaCorridaEntrada[] = []
	let contratos = 0
	let cuotasVistas = 0
	let clientesNuevos = 0

	try {
		// 1. Lectura de la API: fuera de cualquier transacción, porque tarda y puede fallar.
		const api = crearCliente(credenciales, opciones.opcionesCliente)
		const ids = [...await api.idsDeContratos()].sort((a, b) => a - b)
		contratos = ids.length
		const contexto: ContextoImportacion = {
			periodoActual: currentPeriod(),
			configuracion: reglas,
			yaImportadas: deudasImportadas(almacen),
		}
		const conocidos = clientesExistentes(almacen)
		const contratosConocidos = contratosExistentes(almacen)
		// 2. Cada contrato se lee y se clasifica en su obrero, para poder contarlo en vivo; el
		// ensamblado va después, en el orden de los contratos y no en el de las respuestas.
		progreso.fijarTotal(ids.length, 'Leyendo contratos del administrador')
		const clasificaciones = await mapConLimite(ids, concurrencia, async id => {
			const lectura = await api.cuotasDeContrato(id)
			const clasificacion = clasificarContrato(id, lectura, contexto)
			progreso.avanzar(clasificacion.lineas)
			return {
				clasificacion,
				cuotas: lectura.ok ? lectura.datos.filter(fila => fila.deudaId !== '0').length : 0,
			}
		})

		const candidatas: Candidata[] = []
		const frescos: DatosFrescos[] = []
		for (const { clasificacion, cuotas } of clasificaciones) {
			cuotasVistas += cuotas
			lineas.push(...clasificacion.lineas)
			candidatas.push(...clasificacion.candidatas)
			if (clasificacion.frescos !== null) frescos.push(clasificacion.frescos)
		}

		// 3. Los topes son de la corrida: se aplican una sola vez, sobre todas las candidatas.
		const { aImportar, frenadas } = aplicarTopes(candidatas, reglas)
		lineas.push(...frenadas)
		clientesNuevos = new Set(aImportar.map(candidata => candidata.cliente.id).filter(id => !conocidos.has(id))).size

		// Lo que se refresca: lo que ya existe en Cobrix y no entra por la vía de la importación
		// (esas filas las escribe `escribirDominio`). Se calcula igual en simulación y en real.
		const importados = {
			clientes: new Set(aImportar.map(candidata => candidata.cliente.id)),
			contratos: new Set(aImportar.map(candidata => candidata.contratoId)),
		}
		const aRefrescar = frescos.filter(fresco =>
			(conocidos.has(fresco.cliente.id) && !importados.clientes.has(fresco.cliente.id))
			|| (contratosConocidos.has(fresco.contrato.id) && !importados.contratos.has(fresco.contrato.id)))
		const refrescos = {
			clientes: new Set(aRefrescar.map(fresco => fresco.cliente.id)
				.filter(id => conocidos.has(id) && !importados.clientes.has(id))).size,
			contratos: new Set(aRefrescar.map(fresco => fresco.contrato.id)
				.filter(id => contratosConocidos.has(id) && !importados.contratos.has(id))).size,
		}

		// 4. Escritura. Simulación: solo corrida y líneas. Real: todo en una transacción.
		const contadores = enTransaccion(almacen.db, () => {
			if (!simulacion) {
				escribirDominio(almacen, corrida.id, aImportar, momento, proveedor.nombre, lineas)
				refrescarExistentes(almacen, aRefrescar, momento, importados)
			} else {
				for (const candidata of aImportar) lineas.push(lineaImportada(candidata, null))
			}

			const cuenta = contar(lineas, { contratos, cuotasVistas, clientesNuevos, refrescos })
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
		// La transacción de escritura ya revirtió: nada de dominio quedó. Se registra el fallo
		// aparte y se descartan las líneas «importada», que describían algo que no ocurrió.
		const sinEscrituras = lineas.filter(linea => linea.resultado !== 'importada')
		const contadores = contar(sinEscrituras, { contratos, cuotasVistas, clientesNuevos: 0 })
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

/**
 * Las escrituras de dominio de una corrida real. Se llama dentro de la transacción única:
 * cliente y contrato antes que la factura (las claves ajenas lo exigen) y un cliente o un
 * contrato se tocan una sola vez por corrida aunque traigan varias cuotas.
 */
function escribirDominio(
	almacen: Almacen,
	corridaId: number,
	aImportar: readonly Candidata[],
	momento: string,
	origen: string,
	lineas: LineaCorridaEntrada[],
): void {
	const clientesVistos = new Set<string>()
	const contratosVistos = new Set<number>()

	for (const candidata of aImportar) {
		if (!clientesVistos.has(candidata.cliente.id)) {
			clientesVistos.add(candidata.cliente.id)
			const { creado } = guardarCliente(almacen, candidata.cliente, momento, origen)
			if (creado) {
				registrarEvento(almacen, {
					clienteId: candidata.cliente.id,
					tipo: 'cliente_creado',
					corridaId,
					detalle: `Alta por importación desde ${origen}.`,
				}, momento)
			}
		}
		if (!contratosVistos.has(candidata.contratoId)) {
			contratosVistos.add(candidata.contratoId)
			guardarContrato(almacen, candidata.contrato, candidata.cliente.id, momento)
		}

		const facturaId = insertarFactura(almacen, {
			deudaId: candidata.deudaId,
			clienteId: candidata.cliente.id,
			contratoId: candidata.contratoId,
			periodo: candidata.periodo,
			venceEl: candidata.venceEl,
			cortaEl: candidata.cortaEl,
			total: candidata.monto,
			corridaCreacion: corridaId,
		}, momento)

		registrarEvento(almacen, {
			clienteId: candidata.cliente.id,
			facturaId,
			tipo: 'factura_importada',
			corridaId,
			detalle: `Cuota ${candidata.deudaId} del contrato ${candidata.contratoId}, periodo ${candidata.periodo}, ${usd(candidata.monto)}.`,
		}, momento)

		lineas.push(lineaImportada(candidata, facturaId))
	}
}

/**
 * Pone al día lo que Cobrix ya tiene y la importación no tocó. Solo UPDATE: si el cliente o el
 * contrato no existen, no pasa nada (ver el invariante 4 de la cabecera). Se llama dentro de la
 * transacción única de la corrida real; la simulación no llega aquí.
 */
function refrescarExistentes(
	almacen: Almacen,
	aRefrescar: readonly DatosFrescos[],
	momento: string,
	importados: { readonly clientes: ReadonlySet<string>; readonly contratos: ReadonlySet<number> },
): void {
	const clientesVistos = new Set<string>()
	for (const fresco of aRefrescar) {
		if (!importados.clientes.has(fresco.cliente.id) && !clientesVistos.has(fresco.cliente.id)) {
			clientesVistos.add(fresco.cliente.id)
			refrescarCliente(almacen, fresco.cliente, momento)
		}
		if (!importados.contratos.has(fresco.contrato.id)) refrescarContrato(almacen, fresco.contrato, momento)
	}
}

/** La línea de una cuota importada; en simulación se anota que la factura no se creó. */
function lineaImportada(candidata: Candidata, facturaId: number | null): LineaCorridaEntrada {
	const paso = facturaId === null
		? pasoOmitida('creación de la factura', 'simulación: no se escribe nada')
		: pasoOk('creación de la factura', `factura ${facturaId} de Cobrix por ${usd(candidata.monto)}`)
	return {
		contratoId: candidata.contratoId,
		titularNombre: candidata.cliente.nombre,
		titularIdentificacion: candidata.cliente.id,
		deudaId: candidata.deudaId,
		periodo: candidata.periodo,
		monto: candidata.monto,
		cuotas: 1,
		resultado: 'importada',
		motivo: facturaId === null
			? `Se importaría por ${usd(candidata.monto)}: vence el ${candidata.venceEl} y corta el ${candidata.cortaEl}.`
			: `Factura ${facturaId} creada por ${usd(candidata.monto)}: vence el ${candidata.venceEl} y corta el ${candidata.cortaEl}.`,
		traza: [...candidata.traza, paso],
		facturaId,
	}
}

/**
 * Contadores que cuadran: la suma de `cuotas` por resultado es el número de cuotas vistas y
 * las líneas `importada` son exactamente las facturas creadas. Si algún día no cuadra, es que
 * una cuota se perdió entre la clasificación y la escritura.
 */
function contar(
	lineas: readonly LineaCorridaEntrada[],
	totales: {
		readonly contratos: number
		readonly cuotasVistas: number
		readonly clientesNuevos: number
		readonly refrescos?: { readonly clientes: number; readonly contratos: number }
	},
): ContadoresImportacion {
	const cuotas: Record<string, number> = {}
	const porLinea: Record<string, number> = {}
	let cuotasExcluidas = 0
	let facturasNuevas = 0
	let montoNuevo = 0

	for (const linea of lineas) {
		const resultado: Resultado = linea.resultado
		cuotas[resultado] = (cuotas[resultado] ?? 0) + linea.cuotas
		porLinea[resultado] = (porLinea[resultado] ?? 0) + 1
		if (describir(resultado).excluye) cuotasExcluidas += linea.cuotas
		if (resultado === 'importada') {
			facturasNuevas++
			montoNuevo += linea.monto
		}
	}

	return {
		contratos: totales.contratos,
		cuotasVistas: totales.cuotasVistas,
		clientesNuevos: totales.clientesNuevos,
		clientesRefrescados: totales.refrescos?.clientes ?? 0,
		contratosRefrescados: totales.refrescos?.contratos ?? 0,
		facturasNuevas,
		montoNuevo,
		cuotasExcluidas,
		cuotas,
		lineas: porLinea,
	}
}

/** Una línea para la lista del historial: lo que el operador necesita leer de un vistazo. */
function resumir(contadores: ContadoresImportacion, simulacion: boolean): string {
	const partes: string[] = []
	partes.push(contadores.facturasNuevas === 0
		? (simulacion ? 'No se importaría ninguna factura' : 'Sin facturas nuevas')
		: `${simulacion ? 'Se importarían ' : ''}${contadores.facturasNuevas} facturas nuevas por ${usd(contadores.montoNuevo)}`)
	if (contadores.clientesNuevos > 0) {
		partes.push(`${contadores.clientesNuevos} ${simulacion ? 'clientes por crear' : 'clientes nuevos'}`)
	}
	const yaImportadas = contadores.cuotas.ya_importada ?? 0
	if (yaImportadas > 0) partes.push(`${yaImportadas} cuotas ya estaban importadas`)
	if (contadores.cuotasExcluidas > 0) partes.push(`${contadores.cuotasExcluidas} cuotas excluidas`)
	if (contadores.clientesRefrescados > 0 || contadores.contratosRefrescados > 0) {
		partes.push(`${contadores.clientesRefrescados} clientes y ${contadores.contratosRefrescados} contratos ${simulacion ? 'por poner' : 'puestos'} al día`)
	}
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
		sugerencia: 'Nada quedó escrito a medias. El detalle de la corrida tiene las cuotas ya clasificadas.',
	}
}
