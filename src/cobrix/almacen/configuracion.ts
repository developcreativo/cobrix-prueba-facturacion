/**
 * Repositorio de configuración: empresa y proveedor.
 *
 * La contraseña entra, se cifra y no vuelve a salir hacia el panel: `leerConfiguracion` solo
 * dice si está definida (ENUNCIADO.md §3.1). Guardar con el campo vacío NO la borra, para que
 * editar la URL no deje al proveedor sin credenciales.
 */

import type { CredencialesProveedor } from '../api/cliente.ts'
import {
	validarEmpresa, validarProveedor,
	type Empresa, type Proveedor,
} from '../dominio/configuracion.ts'
import { esTipoDocumento, type TipoDocumento } from '../dominio/identificacion.ts'
import { cifrar, descifrar } from '../apoyo/secreto.ts'
import {
	comoBooleano, comoBuffer, comoEntero, comoEnteroONulo, comoListaDeTextos, comoTexto, comoTextoONulo,
	type Almacen,
} from './base.ts'

export interface Configuracion {
	readonly empresa: Empresa
	readonly proveedor: Proveedor
	/** Nunca se expone la contraseña, solo si hay una guardada. */
	readonly passwordDefinida: boolean
}

export class ConfiguracionInvalida extends Error {
	readonly problemas: readonly string[]

	constructor(problemas: readonly string[]) {
		super(problemas.join(' '))
		this.name = 'ConfiguracionInvalida'
		this.problemas = problemas
	}
}

export function leerConfiguracion(almacen: Almacen): Configuracion {
	const empresaFila = almacen.db.prepare('SELECT * FROM empresa WHERE id = 1').get() as Record<string, unknown>
	const proveedorFila = almacen.db.prepare('SELECT * FROM proveedor WHERE id = 1').get() as Record<string, unknown>
	return {
		empresa: {
			nombre: comoTexto(empresaFila.nombre),
			rif: comoTexto(empresaFila.rif),
			emailCobranza: comoTexto(empresaFila.email_cobranza),
		},
		proveedor: {
			nombre: comoTexto(proveedorFila.nombre),
			apiUrl: comoTexto(proveedorFila.api_url),
			usuario: comoTexto(proveedorFila.usuario),
			estadosImportables: comoListaDeTextos(proveedorFila.estados_importables),
			ventanaMeses: comoEnteroONulo(proveedorFila.ventana_meses),
			maxCuotasRecientes: comoEnteroONulo(proveedorFila.max_cuotas_recientes),
			diasGracia: comoEntero(proveedorFila.dias_gracia),
			topeFacturas: comoEnteroONulo(proveedorFila.tope_facturas),
			topeMonto: comoEnteroONulo(proveedorFila.tope_monto),
			excluirTiposDocumento: comoListaDeTextos(proveedorFila.excluir_tipos_documento)
				.filter((tipo): tipo is TipoDocumento => esTipoDocumento(tipo)),
			autoActiva: comoBooleano(proveedorFila.auto_activa),
			autoHora: comoTextoONulo(proveedorFila.auto_hora),
		},
		passwordDefinida: comoBuffer(proveedorFila.password_cifrada) !== null,
	}
}

export function guardarEmpresa(almacen: Almacen, empresa: Empresa): void {
	const problemas = validarEmpresa(empresa)
	if (problemas.length > 0) throw new ConfiguracionInvalida(problemas)
	almacen.db.prepare('UPDATE empresa SET nombre = ?, rif = ?, email_cobranza = ? WHERE id = 1')
		.run(empresa.nombre.trim(), empresa.rif.trim(), empresa.emailCobranza.trim())
}

export interface EntradaProveedor extends Proveedor {
	/** Vacío o ausente: se conserva la contraseña que ya estaba guardada. */
	readonly password?: string | null
}

export function guardarProveedor(almacen: Almacen, entrada: EntradaProveedor): void {
	const problemas = validarProveedor(entrada)
	if (problemas.length > 0) throw new ConfiguracionInvalida(problemas)

	const nueva = typeof entrada.password === 'string' && entrada.password !== ''
		? cifrar(entrada.password, almacen.clave)
		: null

	almacen.db.prepare(`
		UPDATE proveedor SET nombre = ?, api_url = ?, usuario = ?,
			password_cifrada = COALESCE(?, password_cifrada),
			estados_importables = ?, ventana_meses = ?, max_cuotas_recientes = ?, dias_gracia = ?,
			tope_facturas = ?, tope_monto = ?, excluir_tipos_documento = ?, auto_activa = ?, auto_hora = ?
		WHERE id = 1`).run(
		entrada.nombre.trim(),
		entrada.apiUrl.trim().replace(/\/+$/, ''),
		entrada.usuario.trim(),
		nueva,
		JSON.stringify(entrada.estadosImportables),
		entrada.ventanaMeses,
		entrada.maxCuotasRecientes,
		entrada.diasGracia,
		entrada.topeFacturas,
		entrada.topeMonto,
		JSON.stringify(entrada.excluirTiposDocumento),
		entrada.autoActiva ? 1 : 0,
		entrada.autoHora,
	)
}

/** `null` cuando todavía no hay contraseña: la corrida no arranca a ciegas. */
export function leerCredenciales(almacen: Almacen): CredencialesProveedor | null {
	const fila = almacen.db.prepare('SELECT api_url, usuario, password_cifrada FROM proveedor WHERE id = 1')
		.get() as Record<string, unknown>
	const cifrada = comoBuffer(fila.password_cifrada)
	if (cifrada === null) return null
	const password = descifrar(cifrada, almacen.clave)
	if (password === null) return null
	return { apiUrl: comoTexto(fila.api_url), usuario: comoTexto(fila.usuario), password }
}
