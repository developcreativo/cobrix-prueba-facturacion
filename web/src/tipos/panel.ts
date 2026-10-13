/**
 * Contrato de la API del panel (SPEC §3.8).
 *
 * Estos tipos son lo que el panel espera recibir de `/api/*`. Hoy los satisface
 * `src/datos/ejemplo.ts` con datos de muestra; cuando el módulo de la API del panel esté
 * conectado, las pantallas no cambian: solo cambia de dónde salen los objetos.
 *
 * Convenciones que vienen del dominio (`src/cobrix/dominio/`, `src/cobrix/almacen/`) y no se
 * negocian aquí:
 * - **Todos los montos son centavos enteros** (`*_centavos`). El formateo vive en `lib/formato.ts`.
 * - Los días son `YYYY-MM-DD` y los periodos `YYYY-MM`.
 * - Los instantes son ISO **con desfase explícito**: `2026-10-13T14:03:11-04:00`. El almacén
 *   guarda hora civil de Caracas (`almacen/corridas.ts`, `instante()`) y la API le pone el
 *   desfase al serializar; el panel nunca asume UTC.
 */

// ---------------------------------------------------------------- errores

/**
 * Forma única de error de la API del panel.
 *
 * Es la misma `ErrorCorrida` del almacén (`src/cobrix/almacen/corridas.ts`): el backend ya
 * redacta la **sugerencia** de cómo seguir, y el panel la muestra tal cual en vez de
 * reinventarla a partir del código.
 */
export interface ErrorPanel {
	/** Código estable, para distinguir casos sin leer el mensaje. */
	readonly codigo: string
	/** Qué pasó, en una frase. */
	readonly mensaje: string
	/** Cómo seguir, redactado por el backend. */
	readonly sugerencia: string | null
	readonly endpoint: string | null
	readonly status: number | null
}

export interface RespuestaError {
	readonly error: ErrorPanel
}

// ---------------------------------------------------------------- taxonomía (espejo del dominio)

export type Tono = 'ok' | 'warn' | 'bad' | 'info' | 'mute'

export type ResultadoImportacion =
	| 'importada'
	| 'ya_importada'
	| 'sin_deuda'
	| 'saldo_residual'
	| 'excluida_estado'
	| 'estado_desconocido'
	| 'identificacion_invalida'
	| 'tipo_documento_excluido'
	| 'moneda_incoherente'
	| 'periodo_invalido'
	| 'fuera_de_ventana'
	| 'limite_recientes'
	| 'tope_facturas'
	| 'tope_monto'
	| 'respuesta_contradictoria'

export type ResultadoPago =
	| 'marcada_pagada'
	| 'ya_pagada'
	| 'abono_parcial'
	| 'sin_cambio'
	| 'saldo_aumentado'
	| 'exonerada'
	| 'abierta_sin_cobro'
	| 'sin_evidencia'
	| 'inconsistente'

export type Resultado = ResultadoImportacion | ResultadoPago

export type Veredicto = 'ok' | 'descarta' | 'omitida'

/** Un paso del explicador de decisiones (SPEC §5.2). */
export interface PasoTraza {
	readonly regla: string
	readonly veredicto: Veredicto
	readonly detalle: string
}

// ---------------------------------------------------------------- configuración

export type EstadoContrato = 'ACTIVO' | 'CORTADO' | 'CORTESIA' | 'RETIRADO' | 'RECHAZADO' | 'ANULADO'

export type TipoDocumento = 'V' | 'E' | 'J' | 'G' | 'P'

export interface Empresa {
	readonly nombre: string
	readonly rif: string
	readonly email_cobranza: string
	readonly zona_horaria: string
	readonly moneda: string
}

export interface Proveedor {
	readonly nombre: string
	readonly api_url: string
	readonly usuario: string
	/** La contraseña nunca viaja al cliente (SPEC §1.1). */
	readonly password_definida: boolean
	readonly estados_importables: readonly EstadoContrato[]
	/** `null` = sin ventana. */
	readonly ventana_meses: number | null
	/** `null` = todas las cuotas. */
	readonly max_cuotas_recientes: number | null
	readonly dias_gracia: number
	/** `null` = sin tope. */
	readonly tope_facturas: number | null
	/** `null` = sin tope. */
	readonly tope_monto_centavos: number | null
	readonly excluir_tipos_documento: readonly TipoDocumento[]
	readonly auto_activa: boolean
	/** `HH:MM` en la zona de la empresa. */
	readonly auto_hora: string | null
	readonly actualizado_en: string
	readonly docs_url?: string
}

/** `GET` / `PUT /api/configuracion` */
export interface Configuracion {
	readonly empresa: Empresa
	readonly proveedor: Proveedor
}

/** `POST /api/configuracion/probar-conexion` */
export interface PruebaConexion {
	readonly ok: boolean
	readonly mensaje: string
	readonly contratos?: number
	readonly latencia_ms?: number
	readonly error?: ErrorPanel
}

// ---------------------------------------------------------------- corridas

export type TipoCorrida = 'importacion' | 'pagadas'
export type DisparoCorrida = 'manual' | 'automatica'
export type EstadoCorrida = 'en_curso' | 'completada' | 'fallida'

export interface CorridaResumen {
	readonly id: number
	readonly tipo: TipoCorrida
	readonly simulacion: boolean
	readonly disparo: DisparoCorrida
	readonly estado: EstadoCorrida
	readonly inicio: string
	readonly fin: string | null
	readonly duracion_ms: number | null
	/** Resumen de una línea, ya redactado por el backend. */
	readonly resumen: string
	readonly error?: ErrorPanel
}

/**
 * Un contador de la corrida.
 *
 * `clave` es la ruta real dentro de `ContadoresImportacion`
 * (`src/cobrix/corridas/importacion.ts`): `contratos`, `cuotasVistas`, `montoNuevo`,
 * `cuotas.importada`, `lineas.moneda_incoherente`… El panel no inventa contadores: si una cifra
 * no sale de ahí, no se muestra.
 */
export interface Contador {
	readonly clave: string
	readonly etiqueta: string
	readonly valor: number
	/** `dinero` son centavos y se muestran como `USD 1.235,00`; `cuenta` es un entero. */
	readonly tipo: 'cuenta' | 'dinero'
	/** Si va en las tarjetas destacadas de arriba. */
	readonly destacado: boolean
}

/**
 * Una fila del detalle de la corrida (`LineaGuardada` en `src/cobrix/almacen/corridas.ts`).
 *
 * Casi siempre es una cuota (`cuotas: 1`), pero **no siempre**: cuando el administrador deja
 * fuera un contrato entero (moneda incoherente, estado desconocido, identificación inválida…)
 * el backend guarda **una sola fila que resume varias cuotas**, con `deuda_id` y `periodo` en
 * `null` y `cuotas > 1`. La fila «sin deuda» (`deuda_id "0"` del administrador) no es una cuota:
 * va con `cuotas: 0`.
 */
export interface LineaCorrida {
	readonly id: number
	readonly contrato_id: number | null
	readonly deuda_id: string | null
	readonly periodo: string | null
	/** Cuántas cuotas del administrador resume esta fila. */
	readonly cuotas: number
	readonly monto_centavos: number
	readonly resultado: Resultado
	/** Motivo legible, una línea. */
	readonly motivo: string
	readonly factura_id: number | null
	/** Explicador de decisiones: las reglas evaluadas, en orden (SPEC §5.2). */
	readonly traza: readonly PasoTraza[]
	/**
	 * Datos que el almacén no guarda en la línea y que la capa `/api` resuelve al servir
	 * (cliente de la factura, número de Cobrix, descripción de la cuota). Van opcionales
	 * porque una línea de un contrato descartado puede no tener cliente en Cobrix.
	 */
	readonly cliente_id: string | null
	readonly cliente_nombre: string | null
	readonly descripcion: string | null
	readonly factura_numero: string | null
}

/** `GET /api/corridas/:id` */
export interface CorridaDetalle extends CorridaResumen {
	readonly contadores: readonly Contador[]
	readonly lineas: readonly LineaCorrida[]
	/** Configuración con la que corrió: una corrida vieja sigue siendo explicable. */
	readonly config_snapshot: {
		readonly estados_importables: readonly EstadoContrato[]
		readonly ventana_meses: number | null
		readonly max_cuotas_recientes: number | null
		readonly dias_gracia: number
		readonly tope_facturas: number | null
		readonly tope_monto_centavos: number | null
		readonly excluir_tipos_documento: readonly TipoDocumento[]
	}
}

/** `GET /api/corridas` */
export interface ListaCorridas {
	readonly total: number
	readonly corridas: readonly CorridaResumen[]
}

/** Evento del stream SSE `GET /api/corridas/:id/stream` (SPEC §5.3). */
export interface ProgresoCorrida {
	readonly corrida_id: number
	readonly fase: string
	readonly procesados: number
	readonly total: number
	readonly contadores: Readonly<Record<string, number>>
	/** Últimas decisiones, de la más reciente a la más vieja. */
	readonly ultimas: readonly LineaCorrida[]
	readonly cerrada: boolean
}

// ---------------------------------------------------------------- clientes

export type Persona = 'natural' | 'juridica'

export interface ClienteFila {
	/** Identificación normalizada: `V12345678`, `9000123`, `J401234567`. */
	readonly id: string
	readonly nombre: string
	/** Documento tal como lo publica el administrador: `V-12345678`. */
	readonly documento: string
	readonly persona: Persona
	readonly contratos: number
	readonly facturas_abiertas: number
	readonly facturas_pagadas: number
	readonly deuda_centavos: number
	/** Vencimiento de la factura abierta más vieja; `null` si no debe nada. */
	readonly vence_mas_antigua: string | null
}

/** `GET /api/clientes?q=` */
export interface ListaClientes {
	readonly total: number
	readonly clientes: readonly ClienteFila[]
}

// ---------------------------------------------------------------- expediente

export interface ContratoExpediente {
	readonly id: number
	readonly estado: EstadoContrato
	readonly plan: string
	readonly precio_centavos: number
	readonly moneda: string
	readonly sucursal: string
	readonly direccion: string | null
}

export type EstadoFactura = 'abierta' | 'pagada'

export interface FacturaExpediente {
	readonly id: number
	/** Número de Cobrix: `FAC-000008`. */
	readonly numero: string
	/** `deuda_id`: la cuota en el administrador. */
	readonly deuda_id: string
	readonly contrato_id: number
	readonly periodo: string
	readonly descripcion: string
	readonly vence_el: string
	readonly corta_el: string
	readonly total_centavos: number
	readonly saldo_centavos: number
	readonly estado: EstadoFactura
	readonly pagada_el: string | null
	/** Número de la factura del ISP que la pagó. */
	readonly isp_factura_num: string | null
}

export type TipoEvento = 'cliente_creado' | 'factura_importada' | 'factura_pagada'

export interface EventoExpediente {
	readonly id: number
	readonly tipo: TipoEvento
	readonly ocurrido_en: string
	readonly titulo: string
	readonly detalle: string
	readonly factura_numero: string | null
}

/** `GET /api/clientes/:id` */
export interface Expediente {
	readonly cliente: {
		readonly id: string
		readonly nombre: string
		readonly documento: string
		readonly persona: Persona
		readonly email: string | null
		readonly telefono: string | null
		readonly origen: string
		readonly creado_en: string
	}
	readonly totales: {
		readonly deuda_centavos: number
		readonly facturas_abiertas: number
		readonly facturas_pagadas: number
		readonly contratos: number
	}
	readonly contratos: readonly ContratoExpediente[]
	readonly facturas: readonly FacturaExpediente[]
	readonly historial: readonly EventoExpediente[]
}

// ---------------------------------------------------------------- resumen

/** `GET /api/resumen` */
export interface Resumen {
	readonly totales: {
		readonly clientes: number
		/** Contratos que Cobrix guarda: solo los de los clientes importados. */
		readonly contratos: number
		/**
		 * `contadores.contratos` de la última importación completada. Siempre es mayor o igual
		 * que `contratos`: el administrador tiene contratos que Cobrix no espeja porque su
		 * titular no se importa. Se muestran los dos para que la diferencia no parezca un error.
		 */
		readonly contratos_leidos_ultima_corrida: number | null
		readonly facturas_abiertas: number
		readonly facturas_pagadas: number
		readonly por_cobrar_centavos: number
	}
	readonly empresa: Empresa
	readonly proveedor: Proveedor
	readonly automatico: {
		readonly activa: boolean
		readonly hora: string | null
		readonly zona: string
		readonly ultima_ejecucion: string | null
		readonly proxima_ejecucion: string | null
	}
	readonly ultimas_corridas: readonly CorridaResumen[]
	/** Reloj del sandbox: evita la confusión de «¿por qué esta cuota es del futuro?». */
	readonly sandbox: {
		readonly hoy: string
		readonly periodo_actual: string
	}
}
