/**
 * Configuración de Cobrix: valores por defecto y validación, como reglas puras.
 *
 * Los valores por defecto NO son arbitrarios: son los que reproducen los criterios de
 * aceptación de ENUNCIADO.md §5 con la base entregada (42 cuotas, 20 clientes, USD 1.235,00).
 * Con una ventana de 3 meses se perderían 4 cuotas de MIGUEL ANGEL SOTO; excluyendo el tipo J
 * desaparecería COMERCIAL EL FARO, C.A. Si alguno cambia, los números de la prueba cambian.
 */

import { TIPOS_DOCUMENTO, esTipoDocumento, type TipoDocumento } from './identificacion.ts'
import { ESTADOS_CONOCIDOS, type ConfiguracionImportacion } from './importacion.ts'

export const VENTANAS_PERMITIDAS: readonly number[] = [3, 6, 9, 12]
export const HORA = /^([01]\d|2[0-3]):([0-5]\d)$/

export interface Empresa {
	readonly nombre: string
	readonly rif: string
	readonly emailCobranza: string
}

export interface Proveedor extends ConfiguracionImportacion {
	readonly nombre: string
	readonly apiUrl: string
	readonly usuario: string
	readonly autoActiva: boolean
	/** `HH:MM` en America/Caracas. */
	readonly autoHora: string | null
}

export const PROVEEDOR_POR_DEFECTO: Proveedor = {
	nombre: 'Administrador de facturas del ISP',
	apiUrl: 'http://127.0.0.1:4310/api/v1',
	usuario: 'cobrix',
	estadosImportables: ['ACTIVO', 'CORTADO'],
	ventanaMeses: null,
	maxCuotasRecientes: null,
	diasGracia: 0,
	topeFacturas: null,
	topeMonto: null,
	excluirTiposDocumento: [],
	autoActiva: false,
	autoHora: '03:00',
}

export const EMPRESA_POR_DEFECTO: Empresa = { nombre: '', rif: '', emailCobranza: '' }

const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/** Devuelve los problemas encontrados: vacío significa que la configuración es guardable. */
export function validarEmpresa(empresa: Empresa): readonly string[] {
	const problemas: string[] = []
	if (empresa.nombre.trim() === '') problemas.push('El nombre de la empresa es obligatorio.')
	if (empresa.rif.trim() === '') problemas.push('El RIF de la empresa es obligatorio.')
	if (empresa.emailCobranza.trim() !== '' && !CORREO.test(empresa.emailCobranza)) {
		problemas.push('El correo de cobranza no tiene forma de correo.')
	}
	return problemas
}

export function validarProveedor(proveedor: Proveedor): readonly string[] {
	const problemas: string[] = []

	if (!/^https?:\/\/.+/.test(proveedor.apiUrl)) {
		problemas.push('La URL de la API debe empezar por http:// o https://.')
	}
	if (proveedor.usuario.trim() === '') problemas.push('El usuario de la API es obligatorio.')

	if (proveedor.estadosImportables.length === 0) {
		problemas.push('Hay que importar al menos un estado de contrato.')
	}
	const desconocidos = proveedor.estadosImportables.filter(estado => !ESTADOS_CONOCIDOS.includes(estado))
	if (desconocidos.length > 0) {
		problemas.push(`Estados de contrato desconocidos: ${desconocidos.join(', ')}.`)
	}

	if (proveedor.ventanaMeses !== null && !VENTANAS_PERMITIDAS.includes(proveedor.ventanaMeses)) {
		problemas.push(`La ventana de importación debe ser ${VENTANAS_PERMITIDAS.join(', ')} meses o ninguna.`)
	}
	if (proveedor.maxCuotasRecientes !== null && !enteroEntre(proveedor.maxCuotasRecientes, 1, 60)) {
		problemas.push('El máximo de cuotas recientes por contrato va de 1 a 60, o vacío para todas.')
	}
	if (!enteroEntre(proveedor.diasGracia, 0, 60)) {
		problemas.push('Los días de gracia van de 0 a 60.')
	}
	if (proveedor.topeFacturas !== null && !enteroEntre(proveedor.topeFacturas, 1, 100_000)) {
		problemas.push('El tope de facturas nuevas debe ser un entero positivo, o vacío para no limitar.')
	}
	if (proveedor.topeMonto !== null && !enteroEntre(proveedor.topeMonto, 1, 1_000_000_000)) {
		problemas.push('El tope de monto nuevo debe ser positivo, o vacío para no limitar.')
	}

	const tipos = proveedor.excluirTiposDocumento.filter(tipo => !esTipoDocumento(tipo))
	if (tipos.length > 0) {
		problemas.push(`Tipos de documento desconocidos: ${tipos.join(', ')}. Válidos: ${TIPOS_DOCUMENTO.join(', ')}.`)
	}
	if (proveedor.excluirTiposDocumento.length === TIPOS_DOCUMENTO.length) {
		problemas.push('No se pueden excluir todos los tipos de documento: no quedaría nada por importar.')
	}

	if (proveedor.autoActiva && (proveedor.autoHora === null || !HORA.test(proveedor.autoHora))) {
		problemas.push('La corrida automática necesita una hora válida en formato HH:MM.')
	}

	return problemas
}

/** Lo que las reglas de importación necesitan de la configuración, sin los datos de conexión. */
export function reglasDe(proveedor: Proveedor): ConfiguracionImportacion {
	return {
		estadosImportables: proveedor.estadosImportables,
		ventanaMeses: proveedor.ventanaMeses,
		maxCuotasRecientes: proveedor.maxCuotasRecientes,
		diasGracia: proveedor.diasGracia,
		topeFacturas: proveedor.topeFacturas,
		topeMonto: proveedor.topeMonto,
		excluirTiposDocumento: proveedor.excluirTiposDocumento,
	}
}

export function tiposDocumentoDesde(valores: readonly unknown[]): readonly TipoDocumento[] {
	return valores.filter(esTipoDocumento)
}

const enteroEntre = (valor: number, minimo: number, maximo: number): boolean =>
	Number.isInteger(valor) && valor >= minimo && valor <= maximo
