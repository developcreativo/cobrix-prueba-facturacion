/**
 * Fábricas de filas para las pruebas del dominio: la forma exacta que `api/lectura.ts` produce,
 * con los valores de ANA PEREZ (contrato 900101) como base.
 */

import type { FilaContrato, FilaLibro } from '../../src/cobrix/dominio/tipos.ts'

export function filaContrato(cambios: Partial<FilaContrato> = {}): FilaContrato {
	return {
		contratoId: 900101,
		codigo: '0900101',
		identificacionBruta: 'V-12345678',
		nombre: 'ANA PEREZ',
		estado: 'ACTIVO',
		email: 'ana.perez@example.com',
		telefono: '04121000000',
		plan: 'PLAN15MB25',
		sucursal: 'VALENCIA',
		monedaSigla: 'USD',
		precioServicio: 2500,
		deudaId: '7000008',
		deuda: 2500,
		detalleDeuda: ['PLAN15MB25 - 2026 Agosto'],
		...cambios,
	}
}

/** Varias cuotas del mismo contrato: `['2026-08', '2026-09']` → dos filas con su deuda_id. */
export function cuotasDe(periodos: readonly string[], cambios: Partial<FilaContrato> = {}): readonly FilaContrato[] {
	const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
	return periodos.map((periodo, indice) => {
		const [anio, mes] = periodo.split('-')
		return filaContrato({
			deudaId: String(7000008 + indice),
			detalleDeuda: [`PLAN15MB25 - ${anio} ${MESES[Number(mes) - 1]}`],
			...cambios,
		})
	})
}

export function filaLibro(cambios: Partial<FilaLibro> = {}): FilaLibro {
	return {
		contratoId: 900101,
		cuotaId: 7000008,
		periodo: '2026-08',
		tarifa: 2500,
		valorPago: 0,
		saldo: 2500,
		descuento: 0,
		facturaIspId: 0,
		facturaIspNum: '',
		fechaEmision: '2026-08-31',
		...cambios,
	}
}
