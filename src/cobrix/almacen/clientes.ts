/**
 * Clientes, contratos y eventos del expediente.
 *
 * Un cliente por identificación normalizada (ENUNCIADO.md §4): la clave primaria es el propio
 * documento, así que dos contratos del mismo titular no pueden producir dos clientes. Los datos
 * de contacto y el estado del contrato **se refrescan** en cada corrida, porque en el ISP
 * cambian; `creado_en` y `origen` no se tocan nunca: son la memoria de cuándo y de dónde entró.
 *
 * Ninguna función abre transacción: la corrida real envuelve todas sus escrituras en una sola
 * (`enTransaccion`), y abrir otra dentro haría fallar a SQLite.
 */

import { normalizarIdentificacion } from '../dominio/identificacion.ts'
import type { DatosCliente, DatosContrato } from '../dominio/importacion.ts'
import { comoEntero, comoTexto, comoTextoONulo, type Almacen } from './base.ts'

/** La escritura se rechaza entera: nunca se guarda un cliente a medias. */
export class DatosInvalidos extends Error {
	readonly problemas: readonly string[]

	constructor(problemas: readonly string[]) {
		super(problemas.join(' '))
		this.name = 'DatosInvalidos'
		this.problemas = problemas
	}
}

export type TipoEvento = 'cliente_creado' | 'factura_importada' | 'factura_pagada'

export interface NuevoEvento {
	readonly clienteId: string
	readonly facturaId?: number | null
	readonly tipo: TipoEvento
	readonly corridaId?: number | null
	readonly detalle?: string | null
}

const IDENTIFICACION = /^[VEJGP]?\d{1,12}$/
export const INSTANTE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/

/** Toda escritura valida su entrada: un dato inválido se rechaza entero y con el motivo. */
function exigir(problemas: readonly string[]): void {
	if (problemas.length > 0) throw new DatosInvalidos(problemas)
}

function problemasDelCliente(cliente: DatosCliente, momento: string): readonly string[] {
	const problemas: string[] = []
	if (!IDENTIFICACION.test(cliente.id)) {
		problemas.push(`La identificación «${cliente.id}» no está normalizada: no sirve como clave de cliente.`)
	}
	if (cliente.persona !== 'natural' && cliente.persona !== 'juridica') {
		problemas.push(`Tipo de persona desconocido: «${String(cliente.persona)}».`)
	}
	if (cliente.nombre.trim() === '') problemas.push(`El cliente ${cliente.id} no tiene nombre.`)
	if (!INSTANTE.test(momento)) problemas.push(`«${momento}» no es un instante AAAA-MM-DDTHH:MM:SS.`)
	return problemas
}

function problemasDelContrato(contrato: DatosContrato, momento: string): readonly string[] {
	const problemas: string[] = []
	if (!Number.isInteger(contrato.id) || contrato.id <= 0) {
		problemas.push(`El contrato «${String(contrato.id)}» no tiene un id utilizable.`)
	}
	if (contrato.estado.trim() === '') problemas.push(`El contrato ${contrato.id} llegó sin estado.`)
	if (!Number.isInteger(contrato.precio) || contrato.precio < 0) {
		problemas.push(`El precio del contrato ${contrato.id} debe ser un entero de centavos.`)
	}
	if (!INSTANTE.test(momento)) problemas.push(`«${momento}» no es un instante AAAA-MM-DDTHH:MM:SS.`)
	return problemas
}

/**
 * Alta o refresco del titular. Devuelve si hubo que crearlo, porque el evento
 * `cliente_creado` solo corresponde cuando el cliente entra por primera vez.
 */
export function guardarCliente(
	almacen: Almacen,
	cliente: DatosCliente,
	momento: string,
	origen: string,
): { readonly creado: boolean } {
	if (refrescarCliente(almacen, cliente, momento)) return { creado: false }

	almacen.db.prepare(`
		INSERT INTO cliente (id, tipo_documento, numero, nombre, identificacion_bruta, persona, email, telefono,
			origen, creado_en, visto_en)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
		cliente.id, cliente.tipoDocumento, cliente.numero, cliente.nombre, cliente.identificacionBruta,
		cliente.persona, cliente.email, cliente.telefono, origen, momento, momento,
	)
	return { creado: true }
}

/**
 * Refresco del titular: actualiza el contacto si el cliente ya existe y **nunca inserta**.
 * Devuelve `false` cuando no había a quién refrescar. `creado_en` y `origen` no se tocan: son
 * la memoria de cuándo y de dónde entró. Lo consume la corrida con `ClasificacionContrato.frescos`
 * para los contratos que no traen ninguna cuota nueva.
 */
export function refrescarCliente(almacen: Almacen, cliente: DatosCliente, momento: string): boolean {
	exigir(problemasDelCliente(cliente, momento))
	const resultado = almacen.db.prepare(`
		UPDATE cliente SET tipo_documento = ?, numero = ?, nombre = ?, identificacion_bruta = ?, persona = ?,
			email = ?, telefono = ?, visto_en = ?
		WHERE id = ?`).run(
		cliente.tipoDocumento, cliente.numero, cliente.nombre, cliente.identificacionBruta, cliente.persona,
		cliente.email, cliente.telefono, momento, cliente.id,
	)
	return comoEntero(resultado.changes) > 0
}

/**
 * Refresco del contrato: estado, plan, precio, sucursal y moneda, si el contrato ya existe.
 * **Nunca inserta y nunca cambia de titular**: reasignar el `cliente_id` no es refrescar, y
 * apuntar a un titular que Cobrix no tiene rompería la clave ajena y tumbaría la corrida entera.
 */
export function refrescarContrato(almacen: Almacen, contrato: DatosContrato, momento: string): boolean {
	exigir(problemasDelContrato(contrato, momento))
	const resultado = almacen.db.prepare(`
		UPDATE contrato SET codigo = ?, estado = ?, plan = ?, precio = ?, sucursal = ?, moneda = ?, visto_en = ?
		WHERE id = ?`).run(
		contrato.codigo, contrato.estado, contrato.plan, contrato.precio,
		contrato.sucursal, contrato.moneda, momento, contrato.id,
	)
	return comoEntero(resultado.changes) > 0
}

/** Alta o refresco del contrato: estado, plan, precio y sucursal vienen del ISP en cada corrida. */
export function guardarContrato(
	almacen: Almacen,
	contrato: DatosContrato,
	clienteId: string,
	momento: string,
): { readonly creado: boolean } {
	exigir([
		...problemasDelContrato(contrato, momento),
		...(IDENTIFICACION.test(clienteId) ? [] : [`El contrato ${contrato.id} apunta a un cliente inválido: «${clienteId}».`]),
	])

	const existe = almacen.db.prepare('SELECT 1 FROM contrato WHERE id = ?').get(contrato.id) !== undefined
	if (existe) {
		almacen.db.prepare(`
			UPDATE contrato SET cliente_id = ?, codigo = ?, estado = ?, plan = ?, precio = ?, sucursal = ?, moneda = ?, visto_en = ?
			WHERE id = ?`).run(
			clienteId, contrato.codigo, contrato.estado, contrato.plan, contrato.precio,
			contrato.sucursal, contrato.moneda, momento, contrato.id,
		)
		return { creado: false }
	}

	almacen.db.prepare(`
		INSERT INTO contrato (id, cliente_id, codigo, estado, plan, precio, sucursal, moneda, visto_en)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
		contrato.id, clienteId, contrato.codigo, contrato.estado, contrato.plan, contrato.precio,
		contrato.sucursal, contrato.moneda, momento,
	)
	return { creado: true }
}

/** El historial del expediente (ENUNCIADO.md §3.6): qué pasó, cuándo y en qué corrida. */
export function registrarEvento(almacen: Almacen, evento: NuevoEvento, momento: string): number {
	const problemas: string[] = []
	if (!IDENTIFICACION.test(evento.clienteId)) problemas.push(`El evento apunta a un cliente inválido: «${evento.clienteId}».`)
	if (!INSTANTE.test(momento)) problemas.push(`«${momento}» no es un instante AAAA-MM-DDTHH:MM:SS.`)
	if (problemas.length > 0) throw new DatosInvalidos(problemas)

	const resultado = almacen.db.prepare(`
		INSERT INTO evento (cliente_id, factura_id, tipo, ocurrido_en, corrida_id, detalle)
		VALUES (?, ?, ?, ?, ?, ?)`).run(
		evento.clienteId, evento.facturaId ?? null, evento.tipo, momento,
		evento.corridaId ?? null, evento.detalle ?? null,
	)
	return comoEntero(resultado.lastInsertRowid)
}

/** Los titulares que Cobrix ya conoce: con esto la corrida sabe cuántos clientes son nuevos. */
export function clientesExistentes(almacen: Almacen): ReadonlySet<string> {
	const filas = almacen.db.prepare('SELECT id FROM cliente').all() as Array<Record<string, unknown>>
	return new Set(filas.map(fila => String(fila.id)))
}

/** Los contratos que Cobrix ya conoce: refrescar solo puede tocar estos. */
export function contratosExistentes(almacen: Almacen): ReadonlySet<number> {
	const filas = almacen.db.prepare('SELECT id FROM contrato').all() as Array<Record<string, unknown>>
	return new Set(filas.map(fila => comoEntero(fila.id)))
}

export function contarClientes(almacen: Almacen): number {
	const fila = almacen.db.prepare('SELECT COUNT(*) AS total FROM cliente').get() as Record<string, unknown>
	return comoEntero(fila.total)
}

// ------------------------------------------------- consultas para el panel

export interface FilaDeClientes {
	readonly id: string
	readonly nombre: string
	/** El documento tal como lo publica el administrador. */
	readonly documento: string
	readonly persona: string
	readonly contratos: number
	readonly abiertas: number
	readonly pagadas: number
	readonly deuda: number
	readonly venceMasAntigua: string | null
}

export interface BusquedaDeClientes {
	readonly q?: string
	readonly limite?: number
	readonly desplazamiento?: number
	readonly orden?: 'nombre' | 'deuda' | 'vencimiento'
}

/**
 * La tabla de clientes de ENUNCIADO.md §3.5 con sus agregados, en UNA consulta: así el total de
 * la pantalla de clientes no puede discrepar del Resumen.
 *
 * La búsqueda entiende las tres formas con las que un cobrador escribe lo mismo: el nombre
 * (parcial), el documento con formato (`V-9876543`) y el número suelto (`9876543`, `09000123`).
 * El término se normaliza con la misma regla del dominio, así que `09000123` encuentra a
 * `9000123`. Los acentos se quitan del término buscado (SQLite no sabe quitarlos del dato).
 */
export function tablaDeClientes(almacen: Almacen, busqueda: BusquedaDeClientes = {}): {
	readonly total: number
	readonly clientes: readonly FilaDeClientes[]
} {
	const limite = Math.min(Math.max(busqueda.limite ?? 200, 1), 1_000)
	const desplazamiento = Math.max(busqueda.desplazamiento ?? 0, 0)
	const q = (busqueda.q ?? '').trim()

	const filtro = q === '' ? '1 = 1' : `(
		LOWER(c.nombre) LIKE '%' || ? || '%'
		OR c.id = ?
		OR c.numero = ?
		OR UPPER(REPLACE(REPLACE(REPLACE(c.identificacion_bruta, '-', ''), '.', ''), ' ', '')) LIKE '%' || ? || '%'
	)`
	const sinAcentos = q.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
	const identificacion = normalizarIdentificacion(q)
	const limpio = sinAcentos.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
	const parametros: Array<string | number> = q === ''
		? []
		: [sinAcentos.toLowerCase(), identificacion?.id ?? limpio, identificacion?.numero ?? limpio, limpio]

	const orden = busqueda.orden === 'deuda'
		? 'deuda DESC, c.nombre'
		: busqueda.orden === 'vencimiento'
			? 'vence_mas_antigua IS NULL, vence_mas_antigua, c.nombre'
			: 'c.nombre'

	const filas = almacen.db.prepare(`
		SELECT c.id, c.nombre, c.identificacion_bruta, c.persona,
			(SELECT COUNT(*) FROM contrato t WHERE t.cliente_id = c.id) AS contratos,
			COUNT(CASE WHEN f.estado = 'abierta' THEN 1 END) AS abiertas,
			COUNT(CASE WHEN f.estado = 'pagada' THEN 1 END) AS pagadas,
			COALESCE(SUM(CASE WHEN f.estado = 'abierta' THEN f.saldo END), 0) AS deuda,
			MIN(CASE WHEN f.estado = 'abierta' THEN f.vence_el END) AS vence_mas_antigua
		FROM cliente c LEFT JOIN factura f ON f.cliente_id = c.id
		WHERE ${filtro}
		GROUP BY c.id
		ORDER BY ${orden}
		LIMIT ? OFFSET ?`).all(...parametros, limite, desplazamiento) as Array<Record<string, unknown>>

	const total = comoEntero((almacen.db.prepare(`SELECT COUNT(*) AS n FROM cliente c WHERE ${filtro}`)
		.get(...parametros) as Record<string, unknown>).n)

	return { total, clientes: filas.map(comoFilaDeClientes) }
}

function comoFilaDeClientes(fila: Record<string, unknown>): FilaDeClientes {
	const id = comoTexto(fila.id)
	return {
		id,
		nombre: comoTexto(fila.nombre),
		// Una base migrada puede no tener la cruda: se cae a la clave, que siempre está.
		documento: comoTextoONulo(fila.identificacion_bruta) ?? id,
		persona: comoTexto(fila.persona, 'natural'),
		contratos: comoEntero(fila.contratos),
		abiertas: comoEntero(fila.abiertas),
		pagadas: comoEntero(fila.pagadas),
		deuda: comoEntero(fila.deuda),
		venceMasAntigua: comoTextoONulo(fila.vence_mas_antigua),
	}
}

export interface ClienteGuardado extends FilaDeClientes {
	readonly email: string | null
	readonly telefono: string | null
	readonly origen: string
	readonly creadoEn: string
}

export function leerCliente(almacen: Almacen, id: string): ClienteGuardado | null {
	const fila = almacen.db.prepare(`
		SELECT c.*,
			(SELECT COUNT(*) FROM contrato t WHERE t.cliente_id = c.id) AS contratos,
			(SELECT COUNT(*) FROM factura f WHERE f.cliente_id = c.id AND f.estado = 'abierta') AS abiertas,
			(SELECT COUNT(*) FROM factura f WHERE f.cliente_id = c.id AND f.estado = 'pagada') AS pagadas,
			(SELECT COALESCE(SUM(f.saldo), 0) FROM factura f WHERE f.cliente_id = c.id AND f.estado = 'abierta') AS deuda,
			(SELECT MIN(f.vence_el) FROM factura f WHERE f.cliente_id = c.id AND f.estado = 'abierta') AS vence_mas_antigua
		FROM cliente c WHERE c.id = ?`).get(id) as Record<string, unknown> | undefined
	if (fila === undefined) return null
	return {
		...comoFilaDeClientes(fila),
		email: comoTextoONulo(fila.email),
		telefono: comoTextoONulo(fila.telefono),
		origen: comoTexto(fila.origen),
		creadoEn: comoTexto(fila.creado_en),
	}
}

export interface ContratoGuardado {
	readonly id: number
	readonly estado: string
	readonly plan: string
	readonly precio: number
	readonly moneda: string
	readonly sucursal: string
	readonly codigo: string
}

export function contratosDeCliente(almacen: Almacen, clienteId: string): readonly ContratoGuardado[] {
	const filas = almacen.db.prepare('SELECT * FROM contrato WHERE cliente_id = ? ORDER BY id')
		.all(clienteId) as Array<Record<string, unknown>>
	return filas.map(fila => ({
		id: comoEntero(fila.id),
		estado: comoTexto(fila.estado),
		plan: comoTexto(fila.plan),
		precio: comoEntero(fila.precio),
		moneda: comoTexto(fila.moneda, 'USD'),
		sucursal: comoTexto(fila.sucursal),
		codigo: comoTexto(fila.codigo),
	}))
}

export interface EventoGuardado {
	readonly id: number
	readonly tipo: TipoEvento
	readonly ocurridoEn: string
	readonly detalle: string | null
	readonly facturaId: number | null
}

/** El historial del expediente, de lo más reciente a lo más viejo. */
export function eventosDeCliente(almacen: Almacen, clienteId: string, limite = 200): readonly EventoGuardado[] {
	const filas = almacen.db.prepare(
		'SELECT * FROM evento WHERE cliente_id = ? ORDER BY ocurrido_en DESC, id DESC LIMIT ?',
	).all(clienteId, Math.min(Math.max(limite, 1), 1_000)) as Array<Record<string, unknown>>
	return filas.map(fila => ({
		id: comoEntero(fila.id),
		tipo: comoTexto(fila.tipo, 'cliente_creado') as TipoEvento,
		ocurridoEn: comoTexto(fila.ocurrido_en),
		detalle: comoTextoONulo(fila.detalle),
		facturaId: comoEnteroONuloLocal(fila.factura_id),
	}))
}

const comoEnteroONuloLocal = (valor: unknown): number | null =>
	typeof valor === 'number' || typeof valor === 'bigint' ? comoEntero(valor) : null
