/**
 * De la base al contrato del panel (`web/src/tipos/panel.ts`, docs/SPEC.md §3.8).
 *
 * Aquí vive todo lo que el panel necesita y el almacén no guarda, que la SPEC decidió calcular en
 * esta capa y no en columnas nuevas: `duracion_ms`, el número de factura de Cobrix, el título de
 * cada evento, la próxima ejecución del automático y el reloj del sandbox.
 *
 * DOS CONVENCIONES QUE NO SON DECORATIVAS:
 *  - **snake_case**: el panel ya consume estas claves; el dominio habla camelCase. La traducción
 *    ocurre solo aquí, en el borde.
 *  - **Instantes con desfase explícito**: el almacén guarda hora civil de Caracas sin zona
 *    (`instante()` en `almacen/corridas.ts`). Si se enviara cruda, cada navegador la interpretaría
 *    en su propia zona y el historial se movería de hora. Venezuela es UTC-4 todo el año (sin
 *    horario de verano desde 2016), así que el desfase es una constante y no una tabla.
 */

import { addMonths, currentPeriod, lastDayOfPeriod, periodLabel, today } from '../../shared/dates.ts'
import type { Configuracion } from '../almacen/configuracion.ts'
import type { CorridaGuardada, ErrorCorrida, LineaGuardada } from '../almacen/corridas.ts'
import type {
	ClienteGuardado, ContratoGuardado, EventoGuardado, FilaDeClientes,
} from '../almacen/clientes.ts'
import type { FacturaGuardada, TotalesCartera } from '../almacen/facturas.ts'
import { describir, type Resultado } from '../dominio/resultados.ts'

/** Zona de la empresa. Es constante: la SPEC retiró el campo configurable. */
export const ZONA = 'America/Caracas'
export const DESFASE = '-04:00'
export const MONEDA = 'USD'
export const VERSION = '1.0.0'

type Json = Record<string, unknown>

/** `2026-10-13T14:03:11` → `2026-10-13T14:03:11-04:00`. Las fechas de un día se dejan como están. */
export function conDesfase(instante: string | null): string | null {
	if (instante === null || instante === '') return null
	return /[Zz]|[+-]\d{2}:\d{2}$/.test(instante) ? instante : `${instante}${DESFASE}`
}

const comoMilisegundos = (instante: string): number => Date.parse(`${instante}${DESFASE}`)

export function duracionMs(inicio: string, fin: string | null): number | null {
	if (fin === null) return null
	const desde = comoMilisegundos(inicio)
	const hasta = comoMilisegundos(fin)
	return Number.isNaN(desde) || Number.isNaN(hasta) ? null : Math.max(hasta - desde, 0)
}

/** El número de Cobrix de una factura: `FAC-000042`, formateado a partir de su id. */
export const numeroDeFactura = (id: number): string => `FAC-${String(id).padStart(6, '0')}`

/** `2026-08` → `2026 Agosto`, como lo etiqueta el administrador. */
export const descripcionDeCuota = (periodo: string, plan: string): string =>
	plan === '' ? `Cuota ${periodLabel(periodo)}` : `${plan} - ${periodLabel(periodo)}`

export const relojDelSandbox = (): Json => ({ hoy: today(), periodo_actual: currentPeriod() })

// ---------------------------------------------------------------- errores

export function vistaError(error: ErrorCorrida | null): Json | undefined {
	if (error === null) return undefined
	return {
		codigo: error.codigo,
		mensaje: error.mensaje,
		sugerencia: error.sugerencia,
		endpoint: error.endpoint,
		status: error.status,
	}
}

// ---------------------------------------------------------------- configuración

export function vistaConfiguracion(configuracion: Configuracion): Json {
	return { empresa: vistaEmpresa(configuracion), proveedor: vistaProveedor(configuracion) }
}

export function vistaEmpresa(configuracion: Configuracion): Json {
	return {
		nombre: configuracion.empresa.nombre,
		rif: configuracion.empresa.rif,
		email_cobranza: configuracion.empresa.emailCobranza,
		zona_horaria: ZONA,
		moneda: MONEDA,
	}
}

export function vistaProveedor(configuracion: Configuracion): Json {
	const proveedor = configuracion.proveedor
	return {
		nombre: proveedor.nombre,
		api_url: proveedor.apiUrl,
		usuario: proveedor.usuario,
		// La contraseña entra pero no sale: solo si hay una guardada (ENUNCIADO.md §3.1).
		password_definida: configuracion.passwordDefinida,
		estados_importables: proveedor.estadosImportables,
		ventana_meses: proveedor.ventanaMeses,
		max_cuotas_recientes: proveedor.maxCuotasRecientes,
		dias_gracia: proveedor.diasGracia,
		tope_facturas: proveedor.topeFacturas,
		tope_monto_centavos: proveedor.topeMonto,
		excluir_tipos_documento: proveedor.excluirTiposDocumento,
		auto_activa: proveedor.autoActiva,
		auto_hora: proveedor.autoHora,
		// Enlace al Swagger del administrador, derivado de su propia URL.
		docs_url: urlDeDocs(proveedor.apiUrl),
	}
}

/** `http://127.0.0.1:4310/api/v1` → `http://127.0.0.1:4310/docs`: el Swagger del administrador. */
function urlDeDocs(apiUrl: string): string | undefined {
	try {
		const url = new URL(apiUrl)
		return `${url.origin}/docs`
	} catch {
		return undefined
	}
}

// ---------------------------------------------------------------- corridas

export function vistaCorrida(corrida: CorridaGuardada): Json {
	const error = vistaError(corrida.error)
	return {
		id: corrida.id,
		tipo: corrida.tipo,
		simulacion: corrida.simulacion,
		disparo: corrida.disparo,
		estado: corrida.estado,
		inicio: conDesfase(corrida.inicio),
		fin: conDesfase(corrida.fin),
		duracion_ms: duracionMs(corrida.inicio, corrida.fin),
		resumen: corrida.resumen ?? (corrida.estado === 'en_curso' ? 'En curso…' : ''),
		...(error === undefined ? {} : { error }),
	}
}

/** Reglas con las que corrió, para que una corrida vieja siga siendo explicable. */
export function vistaSnapshot(configuracion: unknown): Json {
	const raiz = esObjeto(configuracion) ? configuracion : {}
	const reglas = esObjeto(raiz.reglas) ? raiz.reglas : {}
	return {
		estados_importables: Array.isArray(reglas.estadosImportables) ? reglas.estadosImportables : [],
		ventana_meses: numeroONulo(reglas.ventanaMeses),
		max_cuotas_recientes: numeroONulo(reglas.maxCuotasRecientes),
		dias_gracia: typeof reglas.diasGracia === 'number' ? reglas.diasGracia : 0,
		tope_facturas: numeroONulo(reglas.topeFacturas),
		tope_monto_centavos: numeroONulo(reglas.topeMonto),
		excluir_tipos_documento: Array.isArray(reglas.excluirTiposDocumento) ? reglas.excluirTiposDocumento : [],
	}
}

/**
 * La importación recorre TODOS los contratos del administrador; la de pagadas solo los que tienen
 * facturas abiertas en Cobrix, que son menos y bajan a medida que se cobran. Son tres cifras
 * correctas que no se pueden llamar igual.
 */
const CONTRATOS: Record<'importacion' | 'pagadas', string> = {
	importacion: 'Contratos leídos en el administrador',
	pagadas: 'Contratos con facturas abiertas',
}

/** Etiquetas de los contadores escalares, y cuáles van en las tarjetas de arriba. */
const ESCALARES: Record<string, { etiqueta: string; tipo: 'cuenta' | 'dinero'; destacado: boolean }> = {
	facturasNuevas: { etiqueta: 'Facturas nuevas', tipo: 'cuenta', destacado: true },
	montoNuevo: { etiqueta: 'Monto nuevo', tipo: 'dinero', destacado: true },
	clientesNuevos: { etiqueta: 'Clientes nuevos', tipo: 'cuenta', destacado: true },
	cuotasExcluidas: { etiqueta: 'Cuotas excluidas', tipo: 'cuenta', destacado: true },
	facturasPagadas: { etiqueta: 'Facturas pagadas', tipo: 'cuenta', destacado: true },
	montoCobrado: { etiqueta: 'Monto cobrado', tipo: 'dinero', destacado: true },
	facturasRevisadas: { etiqueta: 'Facturas revisadas', tipo: 'cuenta', destacado: true },
	// `contratos` cuenta cosas distintas en cada corrida, así que la etiqueta la pone `vistaContadores`.
	contratos: { etiqueta: 'Contratos', tipo: 'cuenta', destacado: false },
	cuotasVistas: { etiqueta: 'Cuotas vistas', tipo: 'cuenta', destacado: false },
	clientesRefrescados: { etiqueta: 'Clientes puestos al día', tipo: 'cuenta', destacado: false },
	contratosRefrescados: { etiqueta: 'Contratos puestos al día', tipo: 'cuenta', destacado: false },
}

/**
 * Los contadores guardados, aplanados para el panel. `clave` es la ruta real dentro de los
 * contadores de la corrida (`cuotas.importada`, `facturas.marcada_pagada`), así que el panel no
 * inventa ninguna cifra: si no está aquí, no existe.
 *
 * Las líneas por resultado solo se publican cuando difieren de las cuotas: coinciden siempre
 * salvo cuando una línea resume un contrato entero, y repetirlas sería ruido.
 */
export function vistaContadores(
	tipo: 'importacion' | 'pagadas',
	contadores: Readonly<Record<string, unknown>> | null,
): readonly Json[] {
	if (contadores === null) return []
	const lista: Json[] = []

	for (const [clave, forma] of Object.entries(ESCALARES)) {
		const valor = contadores[clave]
		if (typeof valor !== 'number') continue
		const etiqueta = clave === 'contratos' ? CONTRATOS[tipo] : forma.etiqueta
		lista.push({ clave, etiqueta, valor, tipo: forma.tipo, destacado: forma.destacado })
	}

	const cuotas = esObjeto(contadores.cuotas) ? contadores.cuotas : {}
	const facturas = esObjeto(contadores.facturas) ? contadores.facturas : {}
	const lineas = esObjeto(contadores.lineas) ? contadores.lineas : {}

	for (const [grupo, sufijo] of [['cuotas', ' (cuotas)'], ['facturas', '']] as const) {
		const fuente = grupo === 'cuotas' ? cuotas : facturas
		for (const [resultado, valor] of Object.entries(fuente)) {
			if (typeof valor !== 'number') continue
			lista.push({
				clave: `${grupo}.${resultado}`,
				etiqueta: `${etiquetaDeResultado(resultado)}${sufijo}`,
				valor,
				tipo: 'cuenta',
				destacado: false,
			})
		}
	}

	for (const [resultado, valor] of Object.entries(lineas)) {
		if (typeof valor !== 'number' || valor === cuotas[resultado]) continue
		lista.push({
			clave: `lineas.${resultado}`,
			etiqueta: `${etiquetaDeResultado(resultado)} (líneas)`,
			valor,
			tipo: 'cuenta',
			destacado: false,
		})
	}

	return lista
}

const etiquetaDeResultado = (resultado: string): string => {
	const descripcion = describir(resultado as Resultado)
	return descripcion === undefined ? resultado : descripcion.etiqueta
}

/**
 * Una línea del detalle. `cliente_id` solo se rellena cuando ese titular existe de verdad en
 * Cobrix: una línea de un contrato descartado lleva nombre (para que la fila se entienda) pero no
 * enlace a un expediente que no existe.
 */
export function vistaLinea(linea: LineaGuardada, clientes: ReadonlySet<string>): Json {
	const titular = linea.titularIdentificacion ?? null
	return {
		id: linea.id,
		contrato_id: linea.contratoId,
		deuda_id: linea.deudaId,
		periodo: linea.periodo,
		cuotas: linea.cuotas,
		monto_centavos: linea.monto,
		resultado: linea.resultado,
		motivo: linea.motivo,
		factura_id: linea.facturaId,
		traza: linea.traza,
		cliente_id: titular !== null && clientes.has(titular) ? titular : null,
		cliente_nombre: linea.titularNombre ?? null,
		// La SPEC retiró la descripción por línea: duplicaba el motivo que la línea ya trae.
		descripcion: null,
		factura_numero: linea.facturaId === null ? null : numeroDeFactura(linea.facturaId),
	}
}

// ---------------------------------------------------------------- clientes y expediente

export function vistaFilaDeClientes(fila: FilaDeClientes): Json {
	return {
		id: fila.id,
		nombre: fila.nombre,
		documento: fila.documento,
		persona: fila.persona,
		contratos: fila.contratos,
		facturas_abiertas: fila.abiertas,
		facturas_pagadas: fila.pagadas,
		deuda_centavos: fila.deuda,
		vence_mas_antigua: fila.venceMasAntigua,
	}
}

const TITULOS: Record<string, string> = {
	cliente_creado: 'Cliente creado',
	factura_importada: 'Factura importada',
	factura_pagada: 'Factura pagada en el ISP',
}

export function vistaExpediente(
	cliente: ClienteGuardado,
	contratos: readonly ContratoGuardado[],
	facturas: readonly FacturaGuardada[],
	eventos: readonly EventoGuardado[],
): Json {
	const planDe = new Map(contratos.map(contrato => [contrato.id, contrato.plan]))
	return {
		cliente: {
			id: cliente.id,
			nombre: cliente.nombre,
			documento: cliente.documento,
			persona: cliente.persona,
			email: cliente.email,
			telefono: cliente.telefono,
			origen: cliente.origen,
			creado_en: conDesfase(cliente.creadoEn),
		},
		totales: {
			deuda_centavos: cliente.deuda,
			facturas_abiertas: cliente.abiertas,
			facturas_pagadas: cliente.pagadas,
			contratos: cliente.contratos,
		},
		contratos: contratos.map(contrato => ({
			id: contrato.id,
			estado: contrato.estado,
			plan: contrato.plan,
			precio_centavos: contrato.precio,
			moneda: contrato.moneda,
			sucursal: contrato.sucursal,
			// La SPEC retiró la dirección del contrato: el administrador la publica, pero no se guarda.
			direccion: null,
		})),
		facturas: facturas.map(factura => ({
			id: factura.id,
			numero: numeroDeFactura(factura.id),
			deuda_id: factura.deudaId,
			contrato_id: factura.contratoId,
			periodo: factura.periodo,
			descripcion: descripcionDeCuota(factura.periodo, planDe.get(factura.contratoId) ?? ''),
			vence_el: factura.venceEl,
			corta_el: factura.cortaEl,
			total_centavos: factura.total,
			saldo_centavos: factura.saldo,
			estado: factura.estado,
			pagada_el: factura.pagadaEl,
			isp_factura_num: factura.ispFacturaNum,
		})),
		historial: eventos.map(evento => ({
			id: evento.id,
			tipo: evento.tipo,
			ocurrido_en: conDesfase(evento.ocurridoEn),
			titulo: TITULOS[evento.tipo] ?? evento.tipo,
			detalle: evento.detalle ?? '',
			factura_numero: evento.facturaId === null ? null : numeroDeFactura(evento.facturaId),
		})),
	}
}

// ---------------------------------------------------------------- resumen

export function vistaResumen(
	configuracion: Configuracion,
	totales: TotalesCartera,
	contratosLeidos: number | null,
	ultimas: readonly CorridaGuardada[],
	ultimaAutomatica: string | null,
): Json {
	return {
		totales: {
			clientes: totales.clientes,
			contratos: totales.contratos,
			contratos_leidos_ultima_corrida: contratosLeidos,
			facturas_abiertas: totales.abiertas,
			facturas_pagadas: totales.pagadas,
			por_cobrar_centavos: totales.porCobrar,
		},
		empresa: vistaEmpresa(configuracion),
		proveedor: vistaProveedor(configuracion),
		automatico: {
			activa: configuracion.proveedor.autoActiva,
			hora: configuracion.proveedor.autoHora,
			zona: ZONA,
			ultima_ejecucion: conDesfase(ultimaAutomatica),
			proxima_ejecucion: conDesfase(proximaEjecucion(configuracion.proveedor.autoActiva, configuracion.proveedor.autoHora)),
		},
		ultimas_corridas: ultimas.map(vistaCorrida),
		sandbox: relojDelSandbox(),
	}
}

/**
 * Cuándo toca la próxima corrida automática: hoy a esa hora si todavía no pasó, mañana si ya
 * pasó. Se calcula con el reloj del sandbox para que el panel y el planificador cuenten lo mismo.
 */
export function proximaEjecucion(activa: boolean, hora: string | null, ahora = instanteLocal()): string | null {
	if (!activa || hora === null || !/^([01]\d|2[0-3]):[0-5]\d$/.test(hora)) return null
	const hoy = ahora.slice(0, 10)
	const candidata = `${hoy}T${hora}:00`
	if (candidata > ahora) return candidata
	const manana = diaSiguiente(hoy)
	return `${manana}T${hora}:00`
}

/** Hora civil de Caracas: el día lo fija `today()` (respeta `SANDBOX_TODAY`). */
export function instanteLocal(): string {
	const reloj = new Intl.DateTimeFormat('en-GB', {
		timeZone: ZONA, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
	})
	return `${today()}T${reloj.format(new Date())}`
}

function diaSiguiente(dia: string): string {
	const fecha = new Date(`${dia}T00:00:00Z`)
	fecha.setUTCDate(fecha.getUTCDate() + 1)
	return fecha.toISOString().slice(0, 10)
}

// Se usan en `api.ts` para el estado del automático y la ventana del libro.
export { addMonths, lastDayOfPeriod }

function esObjeto(valor: unknown): valor is Json {
	return typeof valor === 'object' && valor !== null && !Array.isArray(valor)
}

const numeroONulo = (valor: unknown): number | null => (typeof valor === 'number' ? valor : null)
