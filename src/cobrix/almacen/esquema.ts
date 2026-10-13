/**
 * Base de datos de Cobrix. Solo la toca esta integración; el administrador de facturas es una
 * API remota y su SQLite no se lee nunca (ENUNCIADO.md §2).
 *
 * Decisiones:
 *  - Montos en centavos enteros: el administrador reporta hasta seis decimales.
 *  - `cliente.id` es la identificación normalizada y `factura (proveedor_id, deuda_id)` es
 *    única: la idempotencia de ENUNCIADO.md §4 está en el esquema, no solo en el código.
 *  - `corrida.configuracion` guarda con qué parámetros corrió: una corrida vieja sigue
 *    siendo explicable después de cambiar la configuración.
 *  - `corrida_linea.traza` guarda las reglas evaluadas en orden, que es lo que el panel
 *    muestra para explicar cada cuota.
 *  - `corrida_linea.titular_*` y `cliente.identificacion_bruta` guardan lo que el ADMINISTRADOR
 *    dijo. Las líneas de contratos que no se importan no tienen cliente en Cobrix, así que sin el
 *    nombre el detalle de la corrida sería ilegible para un cobrador; y el «documento» que se
 *    muestra en pantalla debe ser el del ISP (`V-12345678`), no la clave normalizada.
 *
 * Las migraciones son aditivas y se aplican solas al abrir (`MIGRACIONES`): una base vieja sigue
 * sirviendo y nadie tiene que borrar nada a mano.
 */

export const VERSION_ESQUEMA = 2

export const ESQUEMA = `
CREATE TABLE IF NOT EXISTS empresa (
	id INTEGER PRIMARY KEY CHECK (id = 1),
	nombre TEXT NOT NULL DEFAULT '',
	rif TEXT NOT NULL DEFAULT '',
	email_cobranza TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS proveedor (
	id INTEGER PRIMARY KEY CHECK (id = 1),
	nombre TEXT NOT NULL,
	api_url TEXT NOT NULL,
	usuario TEXT NOT NULL,
	-- AES-256-GCM. Nunca se devuelve al panel ni se escribe en los registros.
	password_cifrada BLOB,
	estados_importables TEXT NOT NULL DEFAULT '["ACTIVO","CORTADO"]',
	ventana_meses INTEGER,
	max_cuotas_recientes INTEGER,
	dias_gracia INTEGER NOT NULL DEFAULT 0,
	tope_facturas INTEGER,
	tope_monto INTEGER,
	excluir_tipos_documento TEXT NOT NULL DEFAULT '[]',
	auto_activa INTEGER NOT NULL DEFAULT 0,
	auto_hora TEXT
);

CREATE TABLE IF NOT EXISTS cliente (
	id TEXT PRIMARY KEY,
	tipo_documento TEXT,
	numero TEXT NOT NULL,
	nombre TEXT NOT NULL,
	-- Identificación tal como la publica el administrador: se muestra como «documento».
	identificacion_bruta TEXT NOT NULL DEFAULT '',
	persona TEXT NOT NULL CHECK (persona IN ('natural','juridica')),
	email TEXT,
	telefono TEXT,
	origen TEXT NOT NULL,
	creado_en TEXT NOT NULL,
	visto_en TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contrato (
	id INTEGER PRIMARY KEY,
	cliente_id TEXT NOT NULL REFERENCES cliente(id),
	codigo TEXT NOT NULL DEFAULT '',
	estado TEXT NOT NULL,
	plan TEXT NOT NULL DEFAULT '',
	precio INTEGER NOT NULL DEFAULT 0,
	sucursal TEXT NOT NULL DEFAULT '',
	moneda TEXT NOT NULL DEFAULT '',
	visto_en TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS factura (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	proveedor_id INTEGER NOT NULL DEFAULT 1,
	deuda_id TEXT NOT NULL,
	cliente_id TEXT NOT NULL REFERENCES cliente(id),
	contrato_id INTEGER NOT NULL REFERENCES contrato(id),
	periodo TEXT NOT NULL,
	vence_el TEXT NOT NULL,
	corta_el TEXT NOT NULL,
	total INTEGER NOT NULL CHECK (total > 0),
	saldo INTEGER NOT NULL CHECK (saldo >= 0),
	estado TEXT NOT NULL CHECK (estado IN ('abierta','pagada')),
	pagada_el TEXT,
	isp_factura_id INTEGER,
	isp_factura_num TEXT,
	corrida_creacion INTEGER NOT NULL,
	corrida_pago INTEGER,
	creada_en TEXT NOT NULL,
	UNIQUE (proveedor_id, deuda_id)
);

CREATE TABLE IF NOT EXISTS corrida (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	tipo TEXT NOT NULL CHECK (tipo IN ('importacion','pagadas')),
	simulacion INTEGER NOT NULL,
	disparo TEXT NOT NULL CHECK (disparo IN ('manual','automatica')),
	estado TEXT NOT NULL CHECK (estado IN ('en_curso','completada','fallida')),
	inicio TEXT NOT NULL,
	fin TEXT,
	contadores TEXT,
	resumen TEXT,
	error TEXT,
	configuracion TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS corrida_linea (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	corrida_id INTEGER NOT NULL REFERENCES corrida(id),
	contrato_id INTEGER,
	-- El acta: quién era el titular según el administrador, aunque no sea cliente de Cobrix.
	titular_nombre TEXT,
	titular_identificacion TEXT,
	deuda_id TEXT,
	periodo TEXT,
	monto INTEGER NOT NULL DEFAULT 0,
	cuotas INTEGER NOT NULL DEFAULT 1,
	resultado TEXT NOT NULL,
	motivo TEXT NOT NULL,
	traza TEXT NOT NULL DEFAULT '[]',
	factura_id INTEGER
);

CREATE TABLE IF NOT EXISTS evento (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	cliente_id TEXT NOT NULL REFERENCES cliente(id),
	factura_id INTEGER,
	tipo TEXT NOT NULL CHECK (tipo IN ('cliente_creado','factura_importada','factura_pagada')),
	ocurrido_en TEXT NOT NULL,
	corrida_id INTEGER,
	detalle TEXT
);

-- Una sola corrida real a la vez: el panel y la corrida automática comparten este cerrojo.
CREATE TABLE IF NOT EXISTS bloqueo (
	id INTEGER PRIMARY KEY CHECK (id = 1),
	corrida_id INTEGER,
	tomado_en TEXT
);

CREATE INDEX IF NOT EXISTS factura_cliente ON factura(cliente_id, estado);
CREATE INDEX IF NOT EXISTS factura_contrato ON factura(contrato_id, estado);
CREATE INDEX IF NOT EXISTS factura_abiertas ON factura(estado, vence_el);
CREATE INDEX IF NOT EXISTS contrato_cliente ON contrato(cliente_id);
CREATE INDEX IF NOT EXISTS linea_corrida ON corrida_linea(corrida_id, resultado);
CREATE INDEX IF NOT EXISTS evento_cliente ON evento(cliente_id, ocurrido_en);
`

/**
 * Columnas añadidas después de la primera versión. Se aplican en orden y se ignora el error de
 * «duplicate column name», que es la forma que tiene SQLite de decir «ya estaba»: así abrir una
 * base vieja la pone al día sin perder una fila.
 */
export const MIGRACIONES: readonly string[] = [
	`ALTER TABLE cliente ADD COLUMN identificacion_bruta TEXT NOT NULL DEFAULT ''`,
	'ALTER TABLE corrida_linea ADD COLUMN titular_nombre TEXT',
	'ALTER TABLE corrida_linea ADD COLUMN titular_identificacion TEXT',
]
