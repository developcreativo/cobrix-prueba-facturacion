/**
 * Historial de corridas (ENUNCIADO.md §3.4): abrir, cerrar, fallar, listar y explicar.
 *
 * Tres decisiones que vienen de los invariantes de la corrida:
 *
 *  1. **`abrirCorrida` abre su propia transacción y es lo único aquí que lo hace.** Cerrar,
 *     fallar y guardar líneas son sentencias sueltas, para que la corrida real pueda meterlas
 *     dentro de su única transacción (`enTransaccion`) sin anidar BEGIN. Gracias a eso una
 *     corrida que revierte sus escrituras sigue existiendo en el historial: la apertura se
 *     confirmó antes y el fallo se registra después, en una transacción aparte.
 *  2. **Las simulaciones se registran igual que las reales.** El historial tiene que mostrarlas
 *     (con su badge), aunque no escriban nada de dominio.
 *  3. **El cerrojo vive en la tabla `bloqueo` y se considera libre si la corrida que lo tomó ya
 *     no está `en_curso`.** Así un proceso que muriera a mitad de una corrida no deja la
 *     instalación bloqueada para siempre.
 */

import { today } from '../../shared/dates.ts'
import type { Centavos } from '../dominio/dinero.ts'
import { IMPORTACION, PAGOS, type PasoTraza, type Resultado, type Veredicto } from '../dominio/resultados.ts'
import { comoEntero, comoEnteroONulo, comoTexto, comoTextoONulo, enTransaccion, type Almacen } from './base.ts'

export type TipoCorrida = 'importacion' | 'pagadas'
export type DisparoCorrida = 'manual' | 'automatica'
export type EstadoCorrida = 'en_curso' | 'completada' | 'fallida'

const RELOJ = new Intl.DateTimeFormat('en-GB', {
	timeZone: 'America/Caracas', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
})

/**
 * `2026-10-13T14:03:11`. El día lo manda `today()`, que respeta `SANDBOX_TODAY` y hace
 * reproducibles los criterios de aceptación; la hora es la de America/Caracas, como el resto
 * del panel. Nunca se usa `new Date()` directo para la parte de la fecha.
 */
export function instante(): string {
	return `${today()}T${RELOJ.format(new Date())}`
}

export interface AperturaCorrida {
	readonly tipo: TipoCorrida
	readonly simulacion: boolean
	readonly disparo: DisparoCorrida
	/** Con qué parámetros corrió: una corrida vieja sigue siendo explicable. Sin secretos. */
	readonly configuracion: unknown
}

export interface CorridaAbierta {
	readonly id: number
	/** Instante de apertura; la corrida lo usa para fechar todas sus filas. */
	readonly inicio: string
}

/** El panel traduce este error a un 409: hay una corrida real en curso. */
export class CorridaEnCurso extends Error {
	readonly corridaId: number
	readonly desde: string | null

	constructor(corridaId: number, desde: string | null) {
		super(`La corrida ${corridaId} está en curso desde ${desde ?? 'hace un momento'}: espera a que termine.`)
		this.name = 'CorridaEnCurso'
		this.corridaId = corridaId
		this.desde = desde
	}
}

/** Lo que el operador necesita saber de un fallo: qué pasó, dónde y cómo seguir. */
export interface ErrorCorrida {
	readonly mensaje: string
	readonly codigo: string
	readonly endpoint: string | null
	readonly status: number | null
	readonly sugerencia: string | null
}

export interface LineaCorridaEntrada {
	readonly contratoId: number | null
	/** Quién era el titular según el administrador, aunque no sea cliente de Cobrix. */
	readonly titularNombre?: string | null
	readonly titularIdentificacion?: string | null
	readonly deudaId: string | null
	readonly periodo: string | null
	readonly monto: Centavos
	readonly cuotas: number
	readonly resultado: Resultado
	readonly motivo: string
	readonly traza: readonly PasoTraza[]
	readonly facturaId?: number | null
}

export interface LineaGuardada extends LineaCorridaEntrada {
	readonly id: number
	readonly facturaId: number | null
	readonly titularNombre: string | null
	readonly titularIdentificacion: string | null
}

export interface CorridaGuardada {
	readonly id: number
	readonly tipo: TipoCorrida
	readonly simulacion: boolean
	readonly disparo: DisparoCorrida
	readonly estado: EstadoCorrida
	readonly inicio: string
	readonly fin: string | null
	readonly contadores: Readonly<Record<string, unknown>> | null
	readonly resumen: string | null
	readonly error: ErrorCorrida | null
	readonly configuracion: unknown
}

export interface DetalleCorrida extends CorridaGuardada {
	readonly lineas: readonly LineaGuardada[]
}

// ------------------------------------------------------------------ cerrojo

/** La corrida real en curso, o `null` si el cerrojo está libre (o quedó huérfano). */
export function corridaRealEnCurso(almacen: Almacen): { readonly id: number; readonly desde: string | null } | null {
	const fila = almacen.db.prepare(`
		SELECT c.id AS id, b.tomado_en AS tomado_en
		FROM bloqueo b JOIN corrida c ON c.id = b.corrida_id
		WHERE b.id = 1 AND c.estado = 'en_curso'`).get() as Record<string, unknown> | undefined
	if (fila === undefined) return null
	return { id: comoEntero(fila.id), desde: comoTextoONulo(fila.tomado_en) }
}

function liberarCerrojo(almacen: Almacen, corridaId: number): void {
	almacen.db.prepare('UPDATE bloqueo SET corrida_id = NULL, tomado_en = NULL WHERE id = 1 AND corrida_id = ?')
		.run(corridaId)
}

// ------------------------------------------------------------------ ciclo de vida

/**
 * Registra la corrida como `en_curso` y, si es real, toma el cerrojo. Todo en una transacción
 * propia: cuando esta función vuelve, la corrida ya existe en el historial pase lo que pase
 * después. Lanza `CorridaEnCurso` si hay otra real trabajando — también para una simulación,
 * que no toma el cerrojo pero tampoco puede leer un estado que está cambiando.
 */
export function abrirCorrida(almacen: Almacen, apertura: AperturaCorrida): CorridaAbierta {
	const inicio = instante()
	return enTransaccion(almacen.db, () => {
		const ocupado = corridaRealEnCurso(almacen)
		if (ocupado !== null) throw new CorridaEnCurso(ocupado.id, ocupado.desde)

		const resultado = almacen.db.prepare(`
			INSERT INTO corrida (tipo, simulacion, disparo, estado, inicio, configuracion)
			VALUES (?, ?, ?, 'en_curso', ?, ?)`).run(
			apertura.tipo, apertura.simulacion ? 1 : 0, apertura.disparo, inicio,
			JSON.stringify(apertura.configuracion ?? null),
		)
		const id = comoEntero(resultado.lastInsertRowid)
		if (!apertura.simulacion) {
			almacen.db.prepare('UPDATE bloqueo SET corrida_id = ?, tomado_en = ? WHERE id = 1').run(id, inicio)
		}
		return { id, inicio }
	})
}

export function cerrarCorrida(
	almacen: Almacen,
	corridaId: number,
	cierre: { readonly contadores: unknown; readonly resumen: string },
): void {
	almacen.db.prepare(`
		UPDATE corrida SET estado = 'completada', fin = ?, contadores = ?, resumen = ?, error = NULL
		WHERE id = ?`).run(instante(), JSON.stringify(cierre.contadores ?? null), cierre.resumen, corridaId)
	liberarCerrojo(almacen, corridaId)
}

/**
 * Una corrida que falla queda registrada con su error: el operador necesita distinguir
 * «el ISP se cayó» de «no había nada que importar» (ENUNCIADO.md §3.4).
 */
export function fallarCorrida(
	almacen: Almacen,
	corridaId: number,
	error: ErrorCorrida,
	cierre: { readonly contadores?: unknown; readonly resumen?: string } = {},
): void {
	almacen.db.prepare(`
		UPDATE corrida SET estado = 'fallida', fin = ?, contadores = ?, resumen = ?, error = ?
		WHERE id = ?`).run(
		instante(),
		JSON.stringify(cierre.contadores ?? null),
		cierre.resumen ?? `Falló: ${error.mensaje}`,
		JSON.stringify(error),
		corridaId,
	)
	liberarCerrojo(almacen, corridaId)
}

// ------------------------------------------------------------------ líneas

/** Una fila por cuota, con su traza: es la base del explicador de decisiones del panel. */
export function guardarLineas(almacen: Almacen, corridaId: number, lineas: readonly LineaCorridaEntrada[]): number {
	if (lineas.length === 0) return 0
	const desconocidos = [...new Set(lineas.map(linea => linea.resultado).filter(resultado => !esResultado(resultado)))]
	if (desconocidos.length > 0) {
		throw new Error(`Resultados fuera de la taxonomía: ${desconocidos.join(', ')}. Declararlos en dominio/resultados.ts.`)
	}

	const sentencia = almacen.db.prepare(`
		INSERT INTO corrida_linea (corrida_id, contrato_id, titular_nombre, titular_identificacion,
			deuda_id, periodo, monto, cuotas, resultado, motivo, traza, factura_id)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
	for (const linea of lineas) {
		sentencia.run(
			corridaId, linea.contratoId, linea.titularNombre ?? null, linea.titularIdentificacion ?? null,
			linea.deudaId, linea.periodo, Math.trunc(linea.monto), Math.trunc(linea.cuotas),
			linea.resultado, linea.motivo, JSON.stringify(linea.traza), linea.facturaId ?? null,
		)
	}
	return lineas.length
}

// ------------------------------------------------------------------ lectura

export interface FiltroHistorial {
	readonly tipo?: TipoCorrida
	readonly limite?: number
	readonly desplazamiento?: number
}

/** Historial para la lista, de la más reciente a la más vieja. */
export function listarCorridas(almacen: Almacen, filtro: FiltroHistorial = {}): readonly CorridaGuardada[] {
	const limite = Math.min(Math.max(filtro.limite ?? 50, 1), 500)
	const desplazamiento = Math.max(filtro.desplazamiento ?? 0, 0)
	const filas = (filtro.tipo === undefined
		? almacen.db.prepare('SELECT * FROM corrida ORDER BY id DESC LIMIT ? OFFSET ?').all(limite, desplazamiento)
		: almacen.db.prepare('SELECT * FROM corrida WHERE tipo = ? ORDER BY id DESC LIMIT ? OFFSET ?')
			.all(filtro.tipo, limite, desplazamiento)) as Array<Record<string, unknown>>
	return filas.map(comoCorrida)
}

export interface FiltroUltima {
	readonly tipo?: TipoCorrida
	readonly estado?: EstadoCorrida
	readonly disparo?: DisparoCorrida
}

/** La corrida más reciente que cumpla el filtro: la usa el Resumen del panel. */
export function ultimaCorrida(almacen: Almacen, filtro: FiltroUltima = {}): CorridaGuardada | null {
	const condiciones: string[] = []
	const parametros: string[] = []
	if (filtro.tipo !== undefined) {
		condiciones.push('tipo = ?')
		parametros.push(filtro.tipo)
	}
	if (filtro.estado !== undefined) {
		condiciones.push('estado = ?')
		parametros.push(filtro.estado)
	}
	if (filtro.disparo !== undefined) {
		condiciones.push('disparo = ?')
		parametros.push(filtro.disparo)
	}
	const donde = condiciones.length === 0 ? '' : `WHERE ${condiciones.join(' AND ')}`
	const fila = almacen.db.prepare(`SELECT * FROM corrida ${donde} ORDER BY id DESC LIMIT 1`)
		.get(...parametros) as Record<string, unknown> | undefined
	return fila === undefined ? null : comoCorrida(fila)
}

export function contarCorridas(almacen: Almacen): number {
	const fila = almacen.db.prepare('SELECT COUNT(*) AS total FROM corrida').get() as Record<string, unknown>
	return comoEntero(fila.total)
}

export function leerCorrida(almacen: Almacen, corridaId: number, filtro: { readonly resultado?: string } = {}): DetalleCorrida | null {
	const fila = almacen.db.prepare('SELECT * FROM corrida WHERE id = ?').get(corridaId) as Record<string, unknown> | undefined
	if (fila === undefined) return null
	const filas = (filtro.resultado === undefined
		? almacen.db.prepare('SELECT * FROM corrida_linea WHERE corrida_id = ? ORDER BY id').all(corridaId)
		: almacen.db.prepare('SELECT * FROM corrida_linea WHERE corrida_id = ? AND resultado = ? ORDER BY id')
			.all(corridaId, filtro.resultado)) as Array<Record<string, unknown>>
	return { ...comoCorrida(fila), lineas: filas.map(comoLinea) }
}

function comoCorrida(fila: Record<string, unknown>): CorridaGuardada {
	return {
		id: comoEntero(fila.id),
		tipo: comoTexto(fila.tipo) === 'pagadas' ? 'pagadas' : 'importacion',
		simulacion: comoEntero(fila.simulacion) === 1,
		disparo: comoTexto(fila.disparo) === 'automatica' ? 'automatica' : 'manual',
		estado: comoEstado(fila.estado),
		inicio: comoTexto(fila.inicio),
		fin: comoTextoONulo(fila.fin),
		contadores: comoObjeto(fila.contadores),
		resumen: comoTextoONulo(fila.resumen),
		error: comoError(fila.error),
		configuracion: comoJson(fila.configuracion),
	}
}

function comoLinea(fila: Record<string, unknown>): LineaGuardada {
	return {
		id: comoEntero(fila.id),
		contratoId: comoEnteroONulo(fila.contrato_id),
		titularNombre: comoTextoONulo(fila.titular_nombre),
		titularIdentificacion: comoTextoONulo(fila.titular_identificacion),
		deudaId: comoTextoONulo(fila.deuda_id),
		periodo: comoTextoONulo(fila.periodo),
		monto: comoEntero(fila.monto),
		cuotas: comoEntero(fila.cuotas),
		resultado: comoTexto(fila.resultado) as Resultado,
		motivo: comoTexto(fila.motivo),
		traza: comoTraza(fila.traza),
		facturaId: comoEnteroONulo(fila.factura_id),
	}
}

const esResultado = (valor: string): boolean => valor in IMPORTACION || valor in PAGOS

const VEREDICTOS: readonly string[] = ['ok', 'descarta', 'omitida']

/** La traza vuelve de JSON: se lee con la misma desconfianza que una respuesta de la API. */
function comoTraza(valor: unknown): readonly PasoTraza[] {
	const datos = comoJson(valor)
	if (!Array.isArray(datos)) return []
	return datos.flatMap((paso): PasoTraza[] => {
		if (typeof paso !== 'object' || paso === null) return []
		const objeto = paso as Record<string, unknown>
		const veredicto = comoTexto(objeto.veredicto)
		return [{
			regla: comoTexto(objeto.regla),
			veredicto: (VEREDICTOS.includes(veredicto) ? veredicto : 'omitida') as Veredicto,
			detalle: comoTexto(objeto.detalle),
		}]
	})
}

function comoError(valor: unknown): ErrorCorrida | null {
	const datos = comoObjeto(valor)
	if (datos === null) return null
	return {
		mensaje: comoTexto(datos.mensaje),
		codigo: comoTexto(datos.codigo, 'desconocido'),
		endpoint: comoTextoONulo(datos.endpoint),
		status: comoEnteroONulo(datos.status),
		sugerencia: comoTextoONulo(datos.sugerencia),
	}
}

function comoObjeto(valor: unknown): Record<string, unknown> | null {
	const datos = comoJson(valor)
	return typeof datos === 'object' && datos !== null && !Array.isArray(datos) ? (datos as Record<string, unknown>) : null
}

function comoJson(valor: unknown): unknown {
	if (typeof valor !== 'string' || valor === '') return null
	try {
		return JSON.parse(valor)
	} catch {
		return null
	}
}

function comoEstado(valor: unknown): EstadoCorrida {
	const texto = comoTexto(valor)
	return texto === 'completada' || texto === 'fallida' ? texto : 'en_curso'
}
