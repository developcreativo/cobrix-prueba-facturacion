/**
 * Lectura estricta de las respuestas del administrador de facturas.
 *
 * Única puerta de entrada de datos externos al dominio: aquí todo `unknown` se convierte en una
 * forma validada de `dominio/tipos.ts` o en un rechazo con motivo. Lo que no se entiende no se
 * interpreta a medias: el contrato queda fuera y la corrida lo informa (ENUNCIADO.md §4).
 *
 * Rarezas que se manejan aquí (docs/API.md §3):
 *  - `contrato/individual` devuelve una lista SIN envoltorio, sin orden y a veces con la fila
 *    `deuda_id: "0"` que significa «sin deuda».
 *  - `pago_informacion` trae `success: false` aunque haya datos: ese campo se ignora.
 *  - `lista_ids_contratos` declara paginación que no aplica: se compara `data` con `total`.
 */

import { aCentavos } from '../dominio/dinero.ts'
import { ilegible, legible, type FilaContrato, type FilaLibro, type Lectura } from '../dominio/tipos.ts'

const FECHA = /^\d{4}-\d{2}-\d{2}$/
const SOLO_DIGITOS = /^\d+$/

type Objeto = Record<string, unknown>

const esObjeto = (valor: unknown): valor is Objeto =>
	typeof valor === 'object' && valor !== null && !Array.isArray(valor)

const texto = (valor: unknown): string | null => (typeof valor === 'string' ? valor : null)
const entero = (valor: unknown): number | null =>
	typeof valor === 'number' && Number.isInteger(valor) ? valor : null

/** Lista de ids de contratos. La paginación de la API es decorativa, pero `total` debe cuadrar. */
export function leerIdsDeContratos(payload: unknown): Lectura<readonly number[]> {
	if (!esObjeto(payload) || !Array.isArray(payload.data)) {
		return ilegible('no_es_lista', 'lista_ids_contratos no devolvió el envoltorio con `data`')
	}
	const ids: number[] = []
	for (const valor of payload.data) {
		const id = entero(valor)
		if (id === null) return ilegible('fila_invalida', `id de contrato no entero: ${JSON.stringify(valor)}`)
		ids.push(id)
	}
	const total = esObjeto(payload.pagination) ? entero(payload.pagination.total) : null
	if (total !== null && total !== ids.length) {
		return ilegible('paginacion_incompleta',
			`la API dice ${total} contratos y devolvió ${ids.length}: no se asume que el resto no exista`)
	}
	if (new Set(ids).size !== ids.length) {
		return ilegible('datos_inconsistentes', 'la lista de contratos trae ids repetidos')
	}
	return legible(ids)
}

/** Cuotas pendientes de un contrato: una fila por cuota, lista sin envoltorio. */
export function leerCuotasDeContrato(payload: unknown, idSolicitado: number): Lectura<readonly FilaContrato[]> {
	if (!Array.isArray(payload)) {
		return ilegible('no_es_lista', 'contrato/individual no devolvió una lista')
	}
	const filas: FilaContrato[] = []
	for (const [indice, cruda] of payload.entries()) {
		const fila = leerFilaContrato(cruda)
		if (fila === null) return ilegible('fila_invalida', `la fila ${indice + 1} no trae los campos esperados`)
		if (fila.contratoId !== idSolicitado) {
			return ilegible('contrato_ajeno',
				`se pidió el contrato ${idSolicitado} y una fila responde por el ${fila.contratoId}`)
		}
		filas.push(fila)
	}
	if (filas.length === 0) return legible(filas)

	const base = filas[0]!
	const distinto = filas.find(fila =>
		fila.identificacionBruta !== base.identificacionBruta || fila.nombre !== base.nombre || fila.estado !== base.estado)
	if (distinto !== undefined) {
		return ilegible('datos_inconsistentes',
			`el mismo contrato se describe de dos formas: «${base.nombre}/${base.estado}» y «${distinto.nombre}/${distinto.estado}»`)
	}
	const ids = filas.map(fila => fila.deudaId)
	if (new Set(ids).size !== ids.length) {
		return ilegible('cuota_duplicada', 'la respuesta repite la misma cuota (deuda_id duplicado)')
	}
	if (ids.includes('0') && ids.length > 1) {
		return ilegible('datos_inconsistentes', 'la respuesta mezcla la fila «sin deuda» (deuda_id 0) con cuotas reales')
	}
	return legible(filas)
}

function leerFilaContrato(cruda: unknown): FilaContrato | null {
	if (!esObjeto(cruda)) return null
	const contratoId = entero(cruda.contrato_id)
	const identificacionBruta = texto(cruda.identificacion_contrato)
	const nombre = texto(cruda.nombre_contrato)
	const estado = texto(cruda.estado)
	const deudaId = texto(cruda.deuda_id)
	const deuda = aCentavos(cruda.deuda)
	const monedaSigla = texto(cruda.moneda_sigla)
	const precioServicio = aCentavos(cruda.precio_servicio)
	if (contratoId === null || identificacionBruta === null || nombre === null) return null
	if (estado === null || estado === '' || deudaId === null || !SOLO_DIGITOS.test(deudaId)) return null
	if (deuda === null || deuda < 0 || monedaSigla === null || precioServicio === null) return null
	if (!Array.isArray(cruda.detalle_deuda) || cruda.detalle_deuda.some(item => typeof item !== 'string')) return null
	return {
		contratoId,
		codigo: texto(cruda.codigo) ?? '',
		identificacionBruta,
		nombre,
		estado,
		email: normalizarContacto(cruda.email),
		telefono: normalizarContacto(cruda.telefono),
		plan: texto(cruda.nombre_plan) ?? '',
		sucursal: texto(cruda.nombre_sucursal) ?? '',
		monedaSigla,
		precioServicio,
		deudaId,
		deuda,
		detalleDeuda: cruda.detalle_deuda as readonly string[],
	}
}

/** `email` llega en mayúsculas y los contactos vacíos llegan como `''`. */
function normalizarContacto(valor: unknown): string | null {
	const valorTexto = texto(valor)?.trim()
	return valorTexto === undefined || valorTexto === '' ? null : valorTexto.toLowerCase()
}

/**
 * Libro de cuotas y pagos (`tipo_busqueda=CUOTA`): una fila por cuota y por cada factura del ISP
 * que la tocó. Se devuelven todas, incluidas las futuras y las que ya no existen en el contrato;
 * el cruce con las facturas abiertas de Cobrix lo hace la corrida.
 */
export function leerLibroDeCuotas(payload: unknown, idContrato: number): Lectura<readonly FilaLibro[]> {
	if (!esObjeto(payload) || !Array.isArray(payload.data)) {
		// `success: false` con datos es normal en esta API; la ausencia de `data` no lo es.
		return ilegible('no_es_lista', 'pago_informacion no devolvió el envoltorio con `data`')
	}
	const filas: FilaLibro[] = []
	for (const [indice, cruda] of payload.data.entries()) {
		const fila = leerFilaLibro(cruda)
		if (fila === null) return ilegible('fila_invalida', `la fila ${indice + 1} del libro no trae los campos esperados`)
		if (fila.contratoId !== idContrato) {
			return ilegible('contrato_ajeno',
				`se pidió el libro del contrato ${idContrato} y una fila responde por el ${fila.contratoId}`)
		}
		filas.push(fila)
	}
	return legible(filas)
}

function leerFilaLibro(cruda: unknown): FilaLibro | null {
	if (!esObjeto(cruda) || !esObjeto(cruda.detalle_pago)) return null
	const detalle = cruda.detalle_pago
	const facturaIspId = entero(cruda.id_factura)
	const fechaEmision = texto(cruda.fecha_emision)
	// En modo CUOTA el contrato viene en las dos partes y deben coincidir.
	const contratoId = entero(cruda.id_contrato)
	const contratoDetalle = entero(detalle.id_contrato)
	const cuotaId = entero(detalle.id_cuota)
	const periodo = texto(detalle.periodo_cuota)
	const tarifa = aCentavos(detalle.tarifa)
	const valorPago = aCentavos(detalle.valor_pago)
	const saldo = aCentavos(detalle.saldo_cuota)
	const descuento = aCentavos(detalle.descuento)
	if (facturaIspId === null || facturaIspId < 0 || fechaEmision === null || !FECHA.test(fechaEmision)) return null
	if (contratoId === null || contratoDetalle === null || contratoId !== contratoDetalle) return null
	if (cuotaId === null || cuotaId <= 0 || periodo === null || !/^\d{4}-\d{2}$/.test(periodo)) return null
	if (tarifa === null || valorPago === null || saldo === null || descuento === null) return null
	return {
		contratoId,
		cuotaId,
		periodo,
		tarifa,
		valorPago,
		saldo,
		descuento,
		facturaIspId,
		facturaIspNum: texto(cruda.num_factura) ?? '',
		fechaEmision,
	}
}
