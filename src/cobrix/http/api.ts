/**
 * API JSON del panel (docs/SPEC.md §3.8). `node:http` y un router propio: hemos llegado hasta
 * aquí con cero dependencias de producción y la validación ya la saben hacer las reglas del
 * dominio (`validarEmpresa`, `validarProveedor`).
 *
 * Cuatro decisiones que explican la forma del archivo:
 *
 *  1. **Un solo formato de error**: `{ error: { codigo, mensaje, sugerencia, endpoint, status } }`.
 *     El backend redacta el «cómo seguir» (§3.7) y el panel lo muestra tal cual, en vez de
 *     reinventarlo a partir del código.
 *  2. **`POST /api/corridas` no espera a que la corrida termine.** Responde `201` en cuanto la
 *     corrida existe —el primer evento de progreso trae su id— para que el panel pueda abrir el
 *     stream y ver el avance. El resultado final se lee por el stream o por el detalle.
 *  3. **La contraseña entra y no sale.** `GET` devuelve `password_definida`; guardar con el campo
 *     vacío conserva la que había (lo garantiza `guardarProveedor`).
 *  4. **Un `ErrorApi` de «probar conexión» no es un error de la API del panel**: se responde
 *     `200 { ok: false, error }`, porque la pregunta («¿conecta?») se contestó perfectamente.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'

import { crearCliente, ErrorApi, type OpcionesCliente } from '../api/cliente.ts'
import { enTransaccion, type Almacen } from '../almacen/base.ts'
import {
	clientesExistentes, contratosDeCliente, eventosDeCliente, leerCliente, tablaDeClientes,
} from '../almacen/clientes.ts'
import {
	ConfiguracionInvalida, guardarEmpresa, guardarProveedor, leerConfiguracion, leerCredenciales,
} from '../almacen/configuracion.ts'
import {
	contarCorridas, corridaRealEnCurso, CorridaEnCurso, leerCorrida, listarCorridas, ultimaCorrida,
} from '../almacen/corridas.ts'
import { facturasDeCliente, totalesDeCartera } from '../almacen/facturas.ts'
import { correrImportacion, ProveedorSinCredenciales } from '../corridas/importacion.ts'
import { correrActualizacionDePagadas } from '../corridas/pagadas.ts'
import type { ProgresoCorrida } from '../corridas/progreso.ts'
import { esTipoDocumento, type TipoDocumento } from '../dominio/identificacion.ts'
import { ESTADOS_CONOCIDOS } from '../dominio/importacion.ts'
import { crearBusDeProgreso, type BusDeProgreso } from './bus.ts'
import {
	relojDelSandbox, VERSION, vistaConfiguracion, vistaContadores, vistaCorrida,
	vistaExpediente, vistaFilaDeClientes, vistaLinea, vistaResumen, vistaSnapshot, ZONA,
} from './vista.ts'

export interface OpcionesApi {
	readonly almacen: Almacen
	/** Para las pruebas: `fetch` propio y reintentos sin espera. */
	readonly opcionesCliente?: OpcionesCliente
}

export interface Api {
	/** `true` si la petición era suya; `false` para que el servidor sirva el panel. */
	manejar(peticion: IncomingMessage, respuesta: ServerResponse): Promise<boolean>
	readonly bus: BusDeProgreso
	cerrar(): void
}

const LIMITE_CUERPO = 64 * 1024

export function crearApi(opciones: OpcionesApi): Api {
	const { almacen } = opciones
	const bus = crearBusDeProgreso()

	async function manejar(peticion: IncomingMessage, respuesta: ServerResponse): Promise<boolean> {
		const url = new URL(peticion.url ?? '/', 'http://panel.local')
		const ruta = url.pathname.replace(/\/+$/, '') || '/'
		if (ruta !== '/api' && !ruta.startsWith('/api/')) return false

		const metodo = peticion.method ?? 'GET'
		if (metodo === 'OPTIONS') {
			respuesta.writeHead(204, { allow: 'GET, PUT, POST' })
			respuesta.end()
			return true
		}

		try {
			await enrutar(metodo, ruta, url, peticion, respuesta)
		} catch (error: unknown) {
			if (!respuesta.headersSent) {
				console.error('[api]', error)
				fallo(respuesta, 500, 'interno', error instanceof Error ? error.message : String(error),
					{ sugerencia: 'Revisa la consola del servidor: la petición no se completó.' })
			}
		}
		return true
	}

	async function enrutar(
		metodo: string,
		ruta: string,
		url: URL,
		peticion: IncomingMessage,
		respuesta: ServerResponse,
	): Promise<void> {
		// ------------------------------------------------ resumen y salud
		if (metodo === 'GET' && ruta === '/api/resumen') return json(respuesta, 200, resumen())
		if (metodo === 'GET' && ruta === '/api/salud') return json(respuesta, 200, salud())

		// ------------------------------------------------ configuración
		if (ruta === '/api/configuracion') {
			if (metodo === 'GET') return json(respuesta, 200, vistaConfiguracion(leerConfiguracion(almacen)))
			if (metodo === 'PUT') return guardar(respuesta, await cuerpo(peticion))
			return noPermitido(respuesta, 'GET, PUT')
		}
		if (ruta === '/api/configuracion/probar-conexion') {
			if (metodo !== 'POST') return noPermitido(respuesta, 'POST')
			return json(respuesta, 200, await probarConexion(await cuerpo(peticion)))
		}

		// ------------------------------------------------ corridas
		if (ruta === '/api/corridas') {
			if (metodo === 'GET') return json(respuesta, 200, historial(url))
			if (metodo === 'POST') return await lanzar(respuesta, await cuerpo(peticion))
			return noPermitido(respuesta, 'GET, POST')
		}
		const stream = /^\/api\/corridas\/(\d+)\/stream$/.exec(ruta)
		if (stream !== null) {
			if (metodo !== 'GET') return noPermitido(respuesta, 'GET')
			return abrirStream(respuesta, Number(stream[1]))
		}
		const detalle = /^\/api\/corridas\/(\d+)$/.exec(ruta)
		if (detalle !== null) {
			if (metodo !== 'GET') return noPermitido(respuesta, 'GET')
			return corrida(respuesta, Number(detalle[1]), url.searchParams.get('resultado'))
		}

		// ------------------------------------------------ clientes
		if (ruta === '/api/clientes') {
			if (metodo !== 'GET') return noPermitido(respuesta, 'GET')
			return json(respuesta, 200, clientes(url))
		}
		const expediente = /^\/api\/clientes\/([^/]+)$/.exec(ruta)
		if (expediente !== null) {
			if (metodo !== 'GET') return noPermitido(respuesta, 'GET')
			return verExpediente(respuesta, decodeURIComponent(expediente[1]!))
		}

		// ------------------------------------------------ datos
		if (ruta === '/api/datos/borrar') {
			if (metodo !== 'POST') return noPermitido(respuesta, 'POST')
			return borrar(respuesta, await cuerpo(peticion))
		}

		return fallo(respuesta, 404, 'no_encontrado', `No existe ${ruta}.`,
			{ sugerencia: 'Revisa la ruta: la API del panel vive bajo /api.' })
	}

	// ---------------------------------------------------------------- resumen

	function resumen(): unknown {
		const ultimaImportacion = ultimaCorrida(almacen, { tipo: 'importacion', estado: 'completada' })
		const contadores = ultimaImportacion?.contadores ?? null
		const contratosLeidos = contadores !== null && typeof contadores.contratos === 'number'
			? contadores.contratos
			: null
		const automatica = ultimaCorrida(almacen, { disparo: 'automatica' })
		return vistaResumen(
			leerConfiguracion(almacen),
			totalesDeCartera(almacen),
			contratosLeidos,
			listarCorridas(almacen, { limite: 5 }),
			automatica?.inicio ?? null,
		)
	}

	function salud(): unknown {
		const configuracion = leerConfiguracion(almacen)
		const totales = totalesDeCartera(almacen)
		const enCurso = corridaRealEnCurso(almacen)
		return {
			version: VERSION,
			zona: ZONA,
			sandbox: relojDelSandbox(),
			base: {
				ok: true,
				clientes: totales.clientes,
				facturas: totales.abiertas + totales.pagadas,
				corridas: contarCorridas(almacen),
			},
			proveedor: {
				api_url: configuracion.proveedor.apiUrl,
				usuario: configuracion.proveedor.usuario,
				password_definida: configuracion.passwordDefinida,
			},
			corrida_en_curso: enCurso === null ? null : { id: enCurso.id, desde: enCurso.desde },
		}
	}

	// ---------------------------------------------------------------- configuración

	function guardar(respuesta: ServerResponse, entrada: unknown): void {
		if (!esObjeto(entrada)) {
			return fallo(respuesta, 400, 'cuerpo_invalido', 'Se esperaba un objeto JSON con empresa y proveedor.')
		}
		const actual = leerConfiguracion(almacen)
		const empresa = esObjeto(entrada.empresa) ? entrada.empresa : {}
		const proveedor = esObjeto(entrada.proveedor) ? entrada.proveedor : {}

		try {
			enTransaccion(almacen.db, () => {
				guardarEmpresa(almacen, {
					nombre: texto(empresa.nombre, actual.empresa.nombre),
					rif: texto(empresa.rif, actual.empresa.rif),
					emailCobranza: texto(empresa.email_cobranza, actual.empresa.emailCobranza),
				})
				guardarProveedor(almacen, {
					nombre: texto(proveedor.nombre, actual.proveedor.nombre),
					apiUrl: texto(proveedor.api_url, actual.proveedor.apiUrl),
					usuario: texto(proveedor.usuario, actual.proveedor.usuario),
					// Vacío o ausente: se conserva la contraseña guardada.
					password: typeof proveedor.password === 'string' ? proveedor.password : null,
					estadosImportables: estados(proveedor.estados_importables, actual.proveedor.estadosImportables),
					ventanaMeses: enteroONulo(proveedor.ventana_meses, actual.proveedor.ventanaMeses),
					maxCuotasRecientes: enteroONulo(proveedor.max_cuotas_recientes, actual.proveedor.maxCuotasRecientes),
					diasGracia: entero(proveedor.dias_gracia, actual.proveedor.diasGracia),
					topeFacturas: enteroONulo(proveedor.tope_facturas, actual.proveedor.topeFacturas),
					topeMonto: enteroONulo(proveedor.tope_monto_centavos, actual.proveedor.topeMonto),
					excluirTiposDocumento: tipos(proveedor.excluir_tipos_documento, actual.proveedor.excluirTiposDocumento),
					autoActiva: booleano(proveedor.auto_activa, actual.proveedor.autoActiva),
					autoHora: texto(proveedor.auto_hora, actual.proveedor.autoHora ?? '') || null,
				})
			})
		} catch (error: unknown) {
			if (error instanceof ConfiguracionInvalida) {
				return fallo(respuesta, 400, 'configuracion_invalida', error.problemas.join(' '),
					{ sugerencia: 'Corrige los campos marcados y vuelve a guardar.' })
			}
			throw error
		}
		json(respuesta, 200, vistaConfiguracion(leerConfiguracion(almacen)))
	}

	/** Probar conexión no persiste nada: puede probar lo guardado o lo que el formulario trae. */
	async function probarConexion(entrada: unknown): Promise<unknown> {
		const cuerpoEntrada = esObjeto(entrada) ? entrada : {}
		const guardadas = leerCredenciales(almacen)
		const configuracion = leerConfiguracion(almacen)
		const apiUrl = texto(cuerpoEntrada.api_url, guardadas?.apiUrl ?? configuracion.proveedor.apiUrl)
		const usuario = texto(cuerpoEntrada.usuario, guardadas?.usuario ?? configuracion.proveedor.usuario)
		const password = typeof cuerpoEntrada.password === 'string' && cuerpoEntrada.password !== ''
			? cuerpoEntrada.password
			: guardadas?.password ?? null

		if (password === null) {
			return {
				ok: false,
				mensaje: 'Falta la contraseña del proveedor.',
				error: {
					codigo: 'credenciales',
					mensaje: 'No hay contraseña guardada ni escrita en el formulario.',
					sugerencia: 'Escribe la contraseña en Configuración → Proveedor y vuelve a probar.',
					endpoint: null,
					status: null,
				},
			}
		}

		const desde = Date.now()
		try {
			const api = crearCliente({ apiUrl, usuario, password }, opciones.opcionesCliente)
			const prueba = await api.probarConexion()
			return {
				ok: true,
				mensaje: `Conexión correcta como ${prueba.usuario}: ${prueba.contratos} contratos.`,
				contratos: prueba.contratos,
				latencia_ms: Date.now() - desde,
			}
		} catch (error: unknown) {
			// La pregunta se contestó: no conecta. No es un 500 de la API del panel.
			const detalle = error instanceof ErrorApi
				? { codigo: error.codigo, mensaje: error.message, sugerencia: error.sugerencia, endpoint: error.endpoint, status: error.status }
				: { codigo: 'interno', mensaje: error instanceof Error ? error.message : String(error), sugerencia: null, endpoint: null, status: null }
			return { ok: false, mensaje: detalle.mensaje, latencia_ms: Date.now() - desde, error: detalle }
		}
	}

	// ---------------------------------------------------------------- corridas

	function historial(url: URL): unknown {
		const tipo = url.searchParams.get('tipo')
		return {
			total: contarCorridas(almacen),
			corridas: listarCorridas(almacen, {
				tipo: tipo === 'importacion' || tipo === 'pagadas' ? tipo : undefined,
				limite: entero(url.searchParams.get('limite'), 50),
				desplazamiento: entero(url.searchParams.get('desplazamiento'), 0),
			}).map(vistaCorrida),
		}
	}

	function corrida(respuesta: ServerResponse, id: number, resultado: string | null): void {
		const guardada = leerCorrida(almacen, id, { resultado: resultado ?? undefined })
		if (guardada === null) {
			return fallo(respuesta, 404, 'corrida_no_encontrada', `No existe la corrida ${id}.`,
				{ sugerencia: 'Vuelve al historial: puede que se haya borrado con «Borrar datos».' })
		}
		const conocidos = clientesExistentes(almacen)
		json(respuesta, 200, {
			...vistaCorrida(guardada),
			contadores: vistaContadores(guardada.contadores),
			lineas: guardada.lineas.map(linea => vistaLinea(linea, conocidos)),
			config_snapshot: vistaSnapshot(guardada.configuracion),
		})
	}

	/**
	 * Arranca la corrida y responde en cuanto existe, sin esperar a que termine: el panel abre el
	 * stream con ese id. Los dos errores que impiden arrancar se distinguen con su código HTTP.
	 */
	async function lanzar(respuesta: ServerResponse, entrada: unknown): Promise<void> {
		const cuerpoEntrada = esObjeto(entrada) ? entrada : {}
		const tipo = cuerpoEntrada.tipo
		if (tipo !== 'importacion' && tipo !== 'pagadas') {
			return fallo(respuesta, 400, 'tipo_invalido', 'El tipo de corrida debe ser «importacion» o «pagadas».')
		}
		if (typeof cuerpoEntrada.simulacion !== 'boolean') {
			return fallo(respuesta, 400, 'simulacion_invalida', 'Hay que decir si la corrida es una simulación (true o false).')
		}
		const simulacion = cuerpoEntrada.simulacion

		let anunciarId: ((id: number) => void) | null = null
		const idAnunciado = new Promise<number>(listo => {
			anunciarId = listo
		})
		const alProgresar = (evento: ProgresoCorrida): void => {
			bus.publicar(evento)
			anunciarId?.(evento.corridaId)
		}

		const corriendo = tipo === 'importacion'
			? correrImportacion(almacen, { simulacion, alProgresar, opcionesCliente: opciones.opcionesCliente })
			: correrActualizacionDePagadas(almacen, { simulacion, alProgresar, opcionesCliente: opciones.opcionesCliente })

		try {
			const id = await Promise.race([idAnunciado, corriendo.then(resultado => resultado.corridaId)])
			json(respuesta, 201, { id, tipo, simulacion })
		} catch (error: unknown) {
			if (error instanceof CorridaEnCurso) {
				return fallo(respuesta, 409, 'corrida_en_curso', error.message, {
					sugerencia: 'Espera a que termine la corrida en curso y vuelve a intentarlo.',
				})
			}
			if (error instanceof ProveedorSinCredenciales) {
				return fallo(respuesta, 400, 'proveedor_sin_credenciales', error.message, { sugerencia: error.sugerencia })
			}
			throw error
		}
	}

	/** SSE: el estado actual primero y los eventos después; al cerrar la corrida, se cierra. */
	function abrirStream(respuesta: ServerResponse, id: number): void {
		respuesta.writeHead(200, {
			'content-type': 'text/event-stream; charset=utf-8',
			'cache-control': 'no-cache, no-transform',
			connection: 'keep-alive',
			'x-accel-buffering': 'no',
		})

		const enviar = (evento: ProgresoCorrida): void => {
			respuesta.write(`data: ${JSON.stringify(vistaProgreso(evento))}\n\n`)
		}

		const ultimo = bus.ultimo(id)
		if (ultimo !== null) enviar(ultimo)

		if (ultimo?.cerrada === true) {
			respuesta.end()
			return
		}

		// Nada en memoria: o la corrida ya terminó (y el historial la tiene) o no existe.
		if (ultimo === null) {
			const guardada = leerCorrida(almacen, id)
			if (guardada === null || guardada.estado !== 'en_curso') {
				enviar({
					corridaId: id,
					fase: guardada === null ? 'Corrida desconocida' : 'Corrida cerrada',
					procesados: 0,
					total: 0,
					contadores: {},
					ultimas: [],
					cerrada: true,
				})
				respuesta.end()
				return
			}
		}

		const baja = bus.suscribir(id, evento => {
			enviar(evento)
			if (evento.cerrada) {
				baja()
				respuesta.end()
			}
		})
		respuesta.on('close', baja)
	}

	// ---------------------------------------------------------------- clientes

	function clientes(url: URL): unknown {
		const orden = url.searchParams.get('orden')
		const tabla = tablaDeClientes(almacen, {
			q: url.searchParams.get('q') ?? '',
			limite: entero(url.searchParams.get('limite'), 200),
			desplazamiento: entero(url.searchParams.get('desplazamiento'), 0),
			orden: orden === 'deuda' || orden === 'vencimiento' ? orden : 'nombre',
		})
		return { total: tabla.total, clientes: tabla.clientes.map(vistaFilaDeClientes) }
	}

	function verExpediente(respuesta: ServerResponse, id: string): void {
		const cliente = leerCliente(almacen, id)
		if (cliente === null) {
			return fallo(respuesta, 404, 'cliente_no_encontrado', `No hay ningún cliente con la identificación ${id}.`,
				{ sugerencia: 'Busca por nombre o documento en la tabla de clientes.' })
		}
		json(respuesta, 200, vistaExpediente(
			cliente,
			contratosDeCliente(almacen, id),
			facturasDeCliente(almacen, id),
			eventosDeCliente(almacen, id),
		))
	}

	// ---------------------------------------------------------------- datos

	/**
	 * Vaciar Cobrix para volver a empezar (está en la captura de referencia de Sincronización).
	 * Exige confirmación explícita y se niega si hay una corrida viva: borrar la base debajo de
	 * una corrida dejaría su historial apuntando a filas que ya no existen.
	 */
	function borrar(respuesta: ServerResponse, entrada: unknown): void {
		const cuerpoEntrada = esObjeto(entrada) ? entrada : {}
		if (cuerpoEntrada.confirmar !== true) {
			return fallo(respuesta, 400, 'sin_confirmar', 'Borrar los datos de Cobrix exige `confirmar: true`.',
				{ sugerencia: 'Confirma la acción en el diálogo del panel.' })
		}
		const enCurso = corridaRealEnCurso(almacen)
		if (enCurso !== null) {
			return fallo(respuesta, 409, 'corrida_en_curso', `La corrida ${enCurso.id} está en curso: no se borra nada.`,
				{ sugerencia: 'Espera a que termine y vuelve a intentarlo.' })
		}

		const antes = totalesDeCartera(almacen)
		const corridas = contarCorridas(almacen)
		const eventos = contarFilas('evento')
		const borrados = enTransaccion(almacen.db, () => {
			// Orden de las claves ajenas: eventos y facturas antes que contratos y clientes.
			almacen.db.exec('DELETE FROM evento')
			almacen.db.exec('DELETE FROM factura')
			almacen.db.exec('DELETE FROM contrato')
			almacen.db.exec('DELETE FROM cliente')
			almacen.db.exec('DELETE FROM corrida_linea')
			almacen.db.exec('DELETE FROM corrida')
			almacen.db.exec('UPDATE bloqueo SET corrida_id = NULL, tomado_en = NULL WHERE id = 1')
			return {
				clientes: antes.clientes,
				contratos: antes.contratos,
				facturas: antes.abiertas + antes.pagadas,
				corridas,
				eventos,
			}
		})
		json(respuesta, 200, { borrados })
	}

	const contarFilas = (tabla: string): number => {
		const fila = almacen.db.prepare(`SELECT COUNT(*) AS n FROM ${tabla}`).get() as Record<string, unknown>
		return typeof fila.n === 'number' ? fila.n : Number(fila.n ?? 0)
	}

	return { manejar, bus, cerrar: () => bus.cerrar() }
}

/** El progreso viaja con las mismas claves que una línea del detalle. */
function vistaProgreso(evento: ProgresoCorrida): unknown {
	return {
		corrida_id: evento.corridaId,
		fase: evento.fase,
		procesados: evento.procesados,
		total: evento.total,
		contadores: evento.contadores,
		ultimas: evento.ultimas.map((linea, indice) => ({
			// Estas líneas todavía no están en la base: el id es su orden en el evento.
			id: indice,
			contrato_id: linea.contratoId,
			deuda_id: linea.deudaId,
			periodo: linea.periodo,
			cuotas: linea.cuotas,
			monto_centavos: linea.monto,
			resultado: linea.resultado,
			motivo: linea.motivo,
			factura_id: linea.facturaId ?? null,
			traza: linea.traza,
			cliente_id: null,
			cliente_nombre: linea.titularNombre ?? null,
			descripcion: null,
			factura_numero: null,
		})),
		cerrada: evento.cerrada,
	}
}

// ---------------------------------------------------------------- utilidades HTTP

function json(respuesta: ServerResponse, status: number, cuerpoJson: unknown): void {
	const texto = JSON.stringify(cuerpoJson)
	respuesta.writeHead(status, {
		'content-type': 'application/json; charset=utf-8',
		'content-length': Buffer.byteLength(texto),
		'cache-control': 'no-store',
	})
	respuesta.end(texto)
}

interface Extra {
	readonly sugerencia?: string | null
	readonly endpoint?: string | null
	readonly status?: number | null
}

function fallo(respuesta: ServerResponse, status: number, codigo: string, mensaje: string, extra: Extra = {}): void {
	json(respuesta, status, {
		error: {
			codigo,
			mensaje,
			sugerencia: extra.sugerencia ?? null,
			endpoint: extra.endpoint ?? null,
			status: extra.status ?? null,
		},
	})
}

function noPermitido(respuesta: ServerResponse, permitidos: string): void {
	respuesta.setHeader('allow', permitidos)
	fallo(respuesta, 405, 'metodo_no_permitido', `Este recurso solo acepta ${permitidos}.`)
}

async function cuerpo(peticion: IncomingMessage): Promise<unknown> {
	const trozos: Buffer[] = []
	let tamano = 0
	for await (const trozo of peticion) {
		const buffer = trozo as Buffer
		tamano += buffer.length
		if (tamano > LIMITE_CUERPO) throw new Error('El cuerpo de la petición es demasiado grande.')
		trozos.push(buffer)
	}
	if (trozos.length === 0) return {}
	try {
		return JSON.parse(Buffer.concat(trozos).toString('utf8')) as unknown
	} catch {
		return null
	}
}

// ---------------------------------------------------------------- lectura de la entrada

function esObjeto(valor: unknown): valor is Record<string, unknown> {
	return typeof valor === 'object' && valor !== null && !Array.isArray(valor)
}

const texto = (valor: unknown, porDefecto: string): string => (typeof valor === 'string' ? valor : porDefecto)

function entero(valor: unknown, porDefecto: number): number {
	const numero = typeof valor === 'string' ? Number(valor) : valor
	return typeof numero === 'number' && Number.isFinite(numero) ? Math.trunc(numero) : porDefecto
}

function enteroONulo(valor: unknown, porDefecto: number | null): number | null {
	if (valor === null) return null
	if (valor === undefined || valor === '') return porDefecto
	const numero = typeof valor === 'string' ? Number(valor) : valor
	return typeof numero === 'number' && Number.isFinite(numero) ? Math.trunc(numero) : porDefecto
}

const booleano = (valor: unknown, porDefecto: boolean): boolean => (typeof valor === 'boolean' ? valor : porDefecto)

function estados(valor: unknown, porDefecto: readonly string[]): readonly string[] {
	if (!Array.isArray(valor)) return porDefecto
	// Se filtra lo que no es un estado conocido; `validarProveedor` rechaza la lista vacía.
	return valor.filter((estado): estado is string => typeof estado === 'string' && ESTADOS_CONOCIDOS.includes(estado))
}

function tipos(valor: unknown, porDefecto: readonly TipoDocumento[]): readonly TipoDocumento[] {
	if (!Array.isArray(valor)) return porDefecto
	return valor.filter(esTipoDocumento)
}
