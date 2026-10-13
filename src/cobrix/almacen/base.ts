/**
 * Apertura de la base de Cobrix y utilidades compartidas por los repositorios.
 *
 * `node:sqlite` viene con Node 24, así que la persistencia no agrega dependencias. Cada
 * corrida real escribe dentro de una transacción: o queda completa o no queda nada.
 */

import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { claveEfimera, claveLocal } from '../apoyo/secreto.ts'
import { EMPRESA_POR_DEFECTO, PROVEEDOR_POR_DEFECTO } from '../dominio/configuracion.ts'
import { ESQUEMA, MIGRACIONES, VERSION_ESQUEMA } from './esquema.ts'

export const RUTA_BASE_POR_DEFECTO = resolve(import.meta.dirname, '../../../data/cobrix.sqlite')
const RUTA_CLAVE_POR_DEFECTO = resolve(import.meta.dirname, '../../../data/.clave')

export interface Almacen {
	readonly db: DatabaseSync
	/** Clave con la que se cifra la contraseña del proveedor. */
	readonly clave: Buffer
	cerrar(): void
}

export interface OpcionesAlmacen {
	/** Ruta del archivo SQLite; `:memory:` para pruebas. */
	readonly ruta?: string
	readonly rutaClave?: string
}

export function abrirAlmacen(opciones: OpcionesAlmacen = {}): Almacen {
	const ruta = opciones.ruta ?? RUTA_BASE_POR_DEFECTO
	const enMemoria = ruta === ':memory:'
	if (!enMemoria) mkdirSync(dirname(ruta), { recursive: true })

	const db = new DatabaseSync(ruta)
	db.exec('PRAGMA foreign_keys = ON')
	if (!enMemoria) db.exec('PRAGMA journal_mode = WAL')
	db.exec(ESQUEMA)
	migrar(db)
	db.exec(`PRAGMA user_version = ${VERSION_ESQUEMA}`)
	sembrarFilasUnicas(db)

	// Una base en memoria (pruebas) no debe crear archivos de clave en el disco.
	const clave = opciones.rutaClave !== undefined
		? claveLocal(opciones.rutaClave)
		: enMemoria ? claveEfimera() : claveLocal(RUTA_CLAVE_POR_DEFECTO)
	return { db, clave, cerrar: () => db.close() }
}

/** Pone al día una base creada con un esquema anterior. Solo añade; nunca borra ni reescribe. */
function migrar(db: DatabaseSync): void {
	for (const paso of MIGRACIONES) {
		try {
			db.exec(paso)
		} catch (error: unknown) {
			// «duplicate column name» es la forma de SQLite de decir que la migración ya estaba.
			const mensaje = error instanceof Error ? error.message : String(error)
			if (!mensaje.includes('duplicate column name')) throw error
		}
	}
}

/** Empresa, proveedor y cerrojo son filas únicas: existen desde el primer arranque. */
function sembrarFilasUnicas(db: DatabaseSync): void {
	db.prepare('INSERT OR IGNORE INTO empresa (id, nombre, rif, email_cobranza) VALUES (1, ?, ?, ?)')
		.run(EMPRESA_POR_DEFECTO.nombre, EMPRESA_POR_DEFECTO.rif, EMPRESA_POR_DEFECTO.emailCobranza)
	db.prepare(`
		INSERT OR IGNORE INTO proveedor (id, nombre, api_url, usuario, estados_importables, ventana_meses,
			max_cuotas_recientes, dias_gracia, tope_facturas, tope_monto, excluir_tipos_documento, auto_activa, auto_hora)
		VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
		PROVEEDOR_POR_DEFECTO.nombre,
		PROVEEDOR_POR_DEFECTO.apiUrl,
		PROVEEDOR_POR_DEFECTO.usuario,
		JSON.stringify(PROVEEDOR_POR_DEFECTO.estadosImportables),
		PROVEEDOR_POR_DEFECTO.ventanaMeses,
		PROVEEDOR_POR_DEFECTO.maxCuotasRecientes,
		PROVEEDOR_POR_DEFECTO.diasGracia,
		PROVEEDOR_POR_DEFECTO.topeFacturas,
		PROVEEDOR_POR_DEFECTO.topeMonto,
		JSON.stringify(PROVEEDOR_POR_DEFECTO.excluirTiposDocumento),
		PROVEEDOR_POR_DEFECTO.autoActiva ? 1 : 0,
		PROVEEDOR_POR_DEFECTO.autoHora,
	)
	db.prepare('INSERT OR IGNORE INTO bloqueo (id, corrida_id, tomado_en) VALUES (1, NULL, NULL)').run()
}

/** Todo o nada: si `trabajo` lanza, no queda ninguna escritura. */
export function enTransaccion<T>(db: DatabaseSync, trabajo: () => T): T {
	db.exec('BEGIN')
	try {
		const resultado = trabajo()
		db.exec('COMMIT')
		return resultado
	} catch (error: unknown) {
		db.exec('ROLLBACK')
		throw error
	}
}

// ------------------------------------------------- lectura de columnas con tipos estrechos

type Celda = unknown

export const comoTexto = (valor: Celda, porDefecto = ''): string => (typeof valor === 'string' ? valor : porDefecto)

export const comoTextoONulo = (valor: Celda): string | null => (typeof valor === 'string' && valor !== '' ? valor : null)

export function comoEntero(valor: Celda, porDefecto = 0): number {
	if (typeof valor === 'number') return Math.trunc(valor)
	if (typeof valor === 'bigint') return Number(valor)
	return porDefecto
}

export function comoEnteroONulo(valor: Celda): number | null {
	if (typeof valor === 'number') return Math.trunc(valor)
	if (typeof valor === 'bigint') return Number(valor)
	return null
}

export const comoBooleano = (valor: Celda): boolean => comoEntero(valor) === 1

export function comoListaDeTextos(valor: Celda): readonly string[] {
	if (typeof valor !== 'string') return []
	try {
		const datos: unknown = JSON.parse(valor)
		return Array.isArray(datos) ? datos.filter((item): item is string => typeof item === 'string') : []
	} catch {
		return []
	}
}

export function comoBuffer(valor: Celda): Buffer | null {
	if (valor instanceof Uint8Array) return Buffer.from(valor)
	return null
}
