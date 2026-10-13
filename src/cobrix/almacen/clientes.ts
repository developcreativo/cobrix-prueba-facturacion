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

import type { DatosCliente, DatosContrato } from '../dominio/importacion.ts'
import { comoEntero, type Almacen } from './base.ts'

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
		INSERT INTO cliente (id, tipo_documento, numero, nombre, persona, email, telefono, origen, creado_en, visto_en)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
		cliente.id, cliente.tipoDocumento, cliente.numero, cliente.nombre, cliente.persona,
		cliente.email, cliente.telefono, origen, momento, momento,
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
		UPDATE cliente SET tipo_documento = ?, numero = ?, nombre = ?, persona = ?, email = ?, telefono = ?, visto_en = ?
		WHERE id = ?`).run(
		cliente.tipoDocumento, cliente.numero, cliente.nombre, cliente.persona,
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
