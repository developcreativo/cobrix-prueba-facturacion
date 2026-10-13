/**
 * Cifrado de la contraseña del proveedor (AES-256-GCM).
 *
 * El enunciado solo pide que la contraseña no se muestre al editar, pero guardarla en claro en
 * un archivo SQLite es gratis de evitar. La clave sale de `COBRIX_SECRET` o, si no está, de un
 * archivo local que se crea con permisos 600 y no se versiona.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const ALGORITMO = 'aes-256-gcm'
const LARGO_IV = 12
const LARGO_TAG = 16

/** Formato guardado: iv (12) + tag (16) + texto cifrado. */
export function cifrar(texto: string, clave: Buffer): Buffer {
	const iv = randomBytes(LARGO_IV)
	const cifrador = createCipheriv(ALGORITMO, clave, iv)
	const cifrado = Buffer.concat([cifrador.update(texto, 'utf8'), cifrador.final()])
	return Buffer.concat([iv, cifrador.getAuthTag(), cifrado])
}

/** `null` cuando el dato está corrupto o la clave cambió: nunca se devuelve basura. */
export function descifrar(datos: Buffer, clave: Buffer): string | null {
	if (datos.length <= LARGO_IV + LARGO_TAG) return null
	try {
		const descifrador = createDecipheriv(ALGORITMO, clave, datos.subarray(0, LARGO_IV))
		descifrador.setAuthTag(datos.subarray(LARGO_IV, LARGO_IV + LARGO_TAG))
		return Buffer.concat([
			descifrador.update(datos.subarray(LARGO_IV + LARGO_TAG)),
			descifrador.final(),
		]).toString('utf8')
	} catch {
		return null
	}
}

/** Clave efímera, para bases en memoria: no toca el disco. */
export function claveEfimera(): Buffer {
	return claveDelEntorno() ?? randomBytes(32)
}

/**
 * Clave de 32 bytes. `COBRIX_SECRET` manda; si no está, se usa (o se crea) el archivo indicado.
 */
export function claveLocal(rutaArchivo: string): Buffer {
	const delEntorno = claveDelEntorno()
	if (delEntorno !== null) return delEntorno
	if (existsSync(rutaArchivo)) {
		const guardada = Buffer.from(readFileSync(rutaArchivo, 'utf8').trim(), 'hex')
		if (guardada.length === 32) return guardada
	}
	const nueva = randomBytes(32)
	mkdirSync(dirname(rutaArchivo), { recursive: true })
	writeFileSync(rutaArchivo, nueva.toString('hex'), { encoding: 'utf8', mode: 0o600 })
	chmodSync(rutaArchivo, 0o600)
	return nueva
}

function claveDelEntorno(): Buffer | null {
	const valor = process.env.COBRIX_SECRET
	return valor === undefined || valor === '' ? null : createHash('sha256').update(valor).digest()
}
