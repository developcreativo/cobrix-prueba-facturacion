# SPEC · Integración Cobrix ↔ administrador de facturas del ISP

> Especificación técnica derivada de [`ENUNCIADO.md`](ENUNCIADO.md) y [`API.md`](API.md).
> Base de referencia: `data/billing-api.sqlite` con `SANDBOX_TODAY=2026-10-13`.
> Panel: `http://127.0.0.1:4300` · API del administrador: `http://127.0.0.1:4310/api/v1` · Swagger: `http://127.0.0.1:4310/docs`.

## 0. Supuestos y límites del alcance

Supuestos que asumo y que cambian el resultado si son incorrectos (corregir aquí antes de implementar):

1. **Los valores por defecto de la configuración son los que reproducen los criterios de aceptación**: estados importables `ACTIVO` + `CORTADO`, **sin** ventana de importación, **sin** máximo de cuotas recientes, **sin** topes por corrida, **sin** exclusión por tipo de documento y **0 días de gracia**. Cualquier otro default rompe los 42/20/USD 1.235,00 (p. ej. una ventana de 3 meses deja fuera 4 cuotas de MIGUEL ANGEL SOTO; excluir `J` elimina a COMERCIAL EL FARO).
2. **Un solo proveedor** configurado (el enunciado habla de «el proveedor» en singular). El modelo de datos lleva `proveedor_id` para no bloquear el multi-ISP, pero la UI gestiona uno.
3. **Toda la plata es USD**. No hay conversión de moneda: un contrato que no reporte USD coherente se descarta, no se convierte.
4. **`src/billing-api/**` y `data/billing-api.sqlite` son inmutables.** La integración solo habla HTTP. Esto es una restricción del enunciado y además un criterio de evaluación (robustez).
5. La **corrida automática** se implementa como planificador in-process (el proceso del panel ya es de larga vida). No se asume cron del sistema ni contenedor externo.
6. El panel es **single-tenant, de red local, sin login**. No se construye autenticación de operadores (no está pedida); sí se protege la contraseña del proveedor en reposo.

Fuera de alcance explícito: multi-ISP en UI, autenticación de usuarios del panel, webhooks del ISP, conciliación contable, exportación a sistemas externos.

---

## 1. Análisis de requisitos y criterios de aceptación

### 1.1 Módulo: Configuración (§3.1)

| Requisito | Criterio de aceptación |
| --- | --- |
| Empresa | Nombre, RIF y correo de cobranza persisten y se muestran en el encabezado del panel. RIF validado con el mismo normalizador de documentos; correo validado. |
| Credenciales del proveedor | URL, usuario y contraseña se guardan. **La contraseña nunca viaja al cliente**: el endpoint de lectura devuelve `password_definida: true/false`, nunca el valor. Guardar con el campo vacío **no borra** la contraseña existente. |
| Probar conexión | Hace `POST /usuario/login` + `GET /isp/lista_ids_contratos` y responde `OK · 27 contratos` en < 3 s. Con credenciales malas responde el mensaje de la API (`Contraseña Incorrecta`) y **no** persiste nada ni crea corrida. |
| Estados importables | Multi-selección sobre `ACTIVO, CORTADO, CORTESIA, RETIRADO, RECHAZADO, ANULADO`. Default `ACTIVO, CORTADO`. Guardar vacío es inválido (error de validación, no corrida vacía silenciosa). |
| Ventana de importación | `3 \| 6 \| 9 \| 12 \| sin ventana`. Con ventana `N`, se importan cuotas con `periodo >= addMonths(periodoActual, -N)`. |
| Máx. cuotas recientes por contrato | Entero 1–60 o vacío. Con `N`, se conservan las **N más recientes por periodo** del contrato; el resto sale como `limite_recientes`. |
| Días de gracia | Entero 0–60. `corte = vencimiento + dias_gracia` (días civiles). |
| Topes por corrida | `max_facturas_nuevas` y `max_monto_nuevo`. Al agotarse, las cuotas restantes salen como `tope_facturas` / `tope_monto` y **no se escriben**. El recorte es determinista (ver §3.4). |
| Excluir por tipo de documento | Subconjunto de `V, E, J, G, P`. Una cuota de un titular excluido sale como `tipo_documento_excluido`. |
| Corrida automática | Activable con hora `HH:MM` en `America/Caracas`. Dispara **importar y después actualizar pagadas**, en ese orden, no simuladas. Si el proceso estuvo caído a esa hora, no se reintenta el mismo día (se registra `omitida`). Dos corridas automáticas nunca se solapan con una manual (lock, ver §3.7). |

**Aceptación del módulo:** cambiar cualquier parámetro y correr «Simular importación» refleja el cambio en los contadores sin tocar la base de Cobrix.

### 1.2 Módulo: Importación de clientes y facturas (§3.2, §4)

Con Cobrix vacío, configuración por defecto y `SANDBOX_TODAY=2026-10-13` — **verificado contra la base entregada**:

| Escenario | Esperado |
| --- | --- |
| Simular importación | `42` cuotas se importarían; `0` escrituras (se verifica con conteo de filas antes/después) |
| Importar | **20 clientes**, **42 facturas abiertas**, **USD 1.235,00** |
| Exclusiones de la misma corrida | `9` cuotas por estado del contrato, `1` contrato por moneda incoherente, `1` cuota por saldo residual |
| Importar otra vez | `0` facturas nuevas, `42` `ya_importada`; ninguna fila de Cobrix cambia (`updated_at` incluido) |
| LUIS GOMEZ (`V-9876543`) | 1 cliente con 2 contratos (`900102` ACTIVO, `900103` CORTADO) |
| ELENA RUIZ (`09000123`) | `cliente_id = 9000123` |
| COMERCIAL EL FARO (`J-40123456-7`) | `cliente_id = J401234567`, tipo **jurídica** |
| No deben existir como clientes | CARLOS ROJAS (cortesía), ROSA DIAZ (retirado), PEDRO LEON (rechazado), ANDRES VARGAS (anulado), LAURA MENDEZ (sin deuda), JORGE CASTILLO (moneda incoherente) |

> **Hallazgo que condiciona la implementación — el orden de las reglas no es libre.**
> SOFIA TORRES tiene una cuota con saldo `0,001317` sobre un plan de USD 25. `contrato/individual` la publica como `deuda: 0` (redondea a 2 decimales). Si la coherencia de moneda se evalúa **antes** de descartar el saldo residual, esa cuota mide `0 % < 1 %` del precio del plan y el contrato entero se descarta por moneda: salen *2* contratos por moneda y *0* residuales, y la corrida pierde las otras cuotas legítimas de SOFIA.
> El orden correcto, que reproduce `1 moneda incoherente` + `1 residual`, es: **(1)** descartar `deuda_id: "0"`, **(2)** descartar cuotas con `deuda` redondeada `< 0,01`, **(3)** evaluar coherencia de moneda a nivel de **contrato** sobre las cuotas que sobreviven (`max(deuda) < 1 % de precio_servicio` → contrato fuera).
> Verificado: con este orden la base entregada da exactamente `42 / USD 1.235,00 / 20 clientes / 9 estado / 1 moneda / 1 residual`.

### 1.3 Módulo: Actualización de pagadas (§3.3, §4)

Pagos creados en la caja del ISP (`/__sim/pagar`, `/__sim/anular`) después de importar:

| Cliente / contrato | En la caja | Esperado tras «Actualizar pagadas» |
| --- | --- | --- |
| ANA PEREZ `900101` | `{"id_contrato":900101}` | 3 facturas **pagadas** (incluye la que tenía abono de 5) |
| LUIS GOMEZ `900103` | `{"id_contrato":900103,"monto":25}` | 1 **pagada**; la siguiente **abierta** con resultado `abono_parcial` (saldo ISP 15 < saldo Cobrix 20) |
| COMERCIAL EL FARO `900104` | `{"id_contrato":900104}` | 2 facturas **pagadas** |
| MIGUEL ANGEL SOTO `900114` | `{"id_contrato":900114,"monto":70}` | las **2 cuotas más viejas** pagadas (35 + 35), el resto abiertas |
| ELENA RUIZ `900113` | `pagar` y luego `anular` con el `id_factura` devuelto | **nada cambia**: sus facturas siguen abiertas |

**Resultado final: 8 pagadas y 34 abiertas por USD 955,00** (280 cobrados = 70 + 20 + 120 + 70). Repetir la actualización no cambia nada y produce `8 ya_pagada`.

Casos negativos obligatorios:

- **Exonerada** (VALENTINA PAZ, `descuento = -tarifa`, saldo 0, `valor_pago` 0) → `exonerada`, nunca pagada.
- **Cuota fantasma** (ANA PEREZ, periodo `2025-08`, visible solo en `pago_informacion`) → ignorada; no crea factura ni línea de pago.
- **Cuota del mes en curso ausente del libro** → `abierta_sin_cobro`, **no** `sin_evidencia`, confirmando contra `contrato/individual` (§3.5).
- **Filas contradictorias** para un mismo `id_cuota` (saldos distintos entre facturas enlazadas) → `inconsistente`, factura intacta.

### 1.4 Módulo: Historial de corridas (§3.4)

| Requisito | Criterio |
| --- | --- |
| Lista | Tipo, fecha/hora local, badge de simulación, estado (`completada` / `fallida`) y resumen de una línea. Orden descendente, paginada. |
| Detalle | Contadores destacados + **todos** los contadores + **una fila por cuota** con `resultado` y `motivo` legible. Filtrable por resultado. |
| Corrida fallida | Credenciales malas, API caída o timeout → corrida `fallida` con `error` (mensaje + endpoint + status) y las líneas ya clasificadas antes del fallo. Una corrida real que falla **no deja escrituras parciales** (transacción única). |
| Trazabilidad | Cada factura guarda la `corrida_id` que la creó y la que la marcó pagada. |

### 1.5 Módulo: Clientes y expediente (§3.5, §3.6)

| Requisito | Criterio |
| --- | --- |
| Tabla | Columnas: nombre, documento, tipo, nº contratos, abiertas, pagadas, deuda, vencimiento más antiguo. Ordenable por deuda y por vencimiento. |
| Búsqueda | Por nombre (parcial, sin acentos, case-insensitive), por cédula/RIF con o sin formato: `V-12345678`, `v12345678`, `12345678` y `09000123` encuentran a su titular. |
| Expediente | Datos del cliente; contratos (estado, plan, precio, sucursal); facturas (nº Cobrix, `deuda_id`, contrato, periodo, vencimiento, corte, total, saldo, estado, fecha de pago); historial (cliente creado, factura importada, factura pagada **con el `num_factura` del ISP que la pagó**). |
| Vacíos | Cobrix sin datos → estado vacío que enlaza a «Importar», no una tabla vacía. |

### 1.6 Módulo: Resumen (§3.8)

Totales (clientes, contratos, abiertas, pagadas, monto por cobrar), proveedor configurado, estado de la corrida automática, últimas 5 corridas y accesos directos a las dos acciones. Debe cuadrar con la tabla de clientes (misma fuente de verdad, una sola consulta agregada).

### 1.7 Transversal: UI/UX (§3.7) y calidad

- Estados visibles con color **y** texto (nunca solo color).
- Montos siempre `USD 1.235,00` (`es-VE`); fechas `13 oct 2026`; periodos `oct 2026`.
- Confirmación explícita antes de una corrida **real** (la simulación no la pide).
- Errores accionables: «qué pasó» + «cómo seguir» (p. ej. *Token rechazado por la API. Revisa usuario y contraseña en Configuración → Proveedor*).
- Responsive hasta 360 px: las tablas de facturas colapsan a tarjetas.
- Accesibilidad: foco visible, navegación por teclado en todo el flujo, `aria-live` para el progreso de la corrida, contraste AA.

---

## 2. Stack tecnológico

### 2.1 Recomendación

| Capa | Elección | Por qué |
| --- | --- | --- |
| Runtime | **Node 24 + TypeScript 5.9** con `strict` + `noUncheckedIndexedAccess` (el `tsconfig.json` entregado) | Ya es el contrato del repo; los tipos estrictos son la primera defensa contra «adivinar» una respuesta de la API. |
| Dominio / sincronización | **TypeScript sin dependencias**, funciones puras | El 35 % de la nota es clasificación correcta. Reglas puras = tests de tabla rápidos, deterministas y sin HTTP. |
| Persistencia Cobrix | **`node:sqlite`** (built-in) en `data/cobrix.sqlite` | Cero dependencias, transaccional, `UNIQUE` para idempotencia. Un ORM aquí es peso sin beneficio. |
| HTTP del panel | **`node:http` + router propio** (≈80 líneas) o **Hono** si se quiere middleware | API JSON pequeña y estable (12 endpoints). Hono es la alternativa razonable si se prefiere ergonomía a cero-deps. |
| Frontend | **Vite + React 19 + TypeScript + Tailwind CSS v4 + shadcn/ui** (Radix) + TanStack Query + React Router | Pedido explícitamente; shadcn da tablas, diálogos y formularios accesibles sin «look de IA». Radix resuelve foco y teclado, que son parte de la aceptación. |
| Tablas | **TanStack Table** (headless) | Orden, filtro y paginación sobre 42–200 filas sin reinventarlo. |
| Validación de entrada | **Zod** compartido entre API y formularios | Un solo esquema para validar el body del panel y el formulario de configuración. |
| Tests | **`node:test`** + `undici` para integración; **Playwright** opcional para un happy-path de UI | `node:test` ya está en `npm test`; no agrega runner nuevo. |
| Logs | JSON estructurado a stdout, propio (≈30 líneas) | Correlación por `corrida_id`; suficiente para la prueba, sin Pino. |

### 2.2 Cómo se levanta (contrato de un comando)

`npm start` sigue levantando **todo** (API simulada + panel). El panel sirve el build estático de Vite desde `web/dist`; si no existe, lo construye. `npm run dev` levanta Vite con HMR y proxy `/api` al backend.

```
npm install
npm start        # API 4310 + panel 4300 (build si hace falta)
npm run dev      # desarrollo con HMR
npm test         # unidad + integración + ciclo completo
npm run typecheck
```

### 2.3 Plan B (si el tiempo aprieta)

Mantener el panel renderizado en servidor sobre `src/web/layout.ts` + Tailwind compilado a un CSS estático, con islas de JS mínimas. Pierde algo de interactividad y gana un día. **Decisión:** se toma el stack de 2.1 porque UX/UI vale 20 % y el enunciado lo invita; el Plan B queda documentado como salida de emergencia, no como entrega.

---

## 3. Estrategia de implementación y flujo de datos

### 3.1 Arquitectura en capas

```
src/cobrix/
  api/            cliente HTTP del administrador (login, contratos, cuotas, libro)
    client.ts       fetch + token + reintentos + timeouts
    parse.ts        lectura ESTRICTA de cada respuesta → tipos del dominio o rechazo
  domain/         reglas puras, sin I/O
    identificacion.ts  normalización y tipo de persona
    deuda.ts           detalle_deuda → periodo, vencimiento, corte
    importar.ts        clasificación de cada cuota → Resultado
    pagadas.ts         evidencia de pago → Resultado
    dinero.ts          centavos, nunca float
  store/          node:sqlite: esquema, migraciones, repositorios
  runs/           orquestación de corridas (importar / pagadas, real y simulada)
  scheduler.ts    corrida automática diaria
  http/           API JSON del panel + SSE de progreso
web/              Vite + React + Tailwind + shadcn/ui
```

Regla de oro: **`domain/` no importa nada de `api/` ni de `store/`**. Entra data ya parseada, sale una decisión. Es lo que permite testear las 20+ reglas sin servidor.

### 3.2 Cliente HTTP: las rarezas de la API, resueltas de una vez

| Rareza observada | Manejo |
| --- | --- |
| Token de 2 h, sin refresh, expiración en UTC naive | Se guarda en memoria con su `exp`; se renueva al 90 % de vida. Un `401` dispara **un** re-login y un reintento; el segundo `401` falla la corrida. |
| `lista_ids_contratos`: cualquier `estado` no vacío devuelve solo activos | **Nunca** se envía `estado`. Hay un test que asserta que la URL construida no lo lleva. |
| Paginación declarada pero ignorada | Se lee `data` completo y se compara con `pagination.total`; si difieren, la corrida falla con `respuesta_inconsistente` (no se adivina). |
| `contrato/individual` devuelve lista **sin envoltorio y sin orden** | Se ordena en casa por `periodo` y `deuda_id`. Ninguna regla depende del orden recibido. |
| Fila `deuda_id: "0"` | Significa «sin deuda»: no es cuota. Resultado `sin_deuda`. |
| Filas de otro contrato o `deuda_id` duplicados | Contrato completo fuera: `respuesta_contradictoria`. |
| Estado de contrato desconocido | Contrato fuera: `estado_desconocido`. Nunca se asume importable. |
| `pago_informacion` trae `success: false` **con** datos | Se ignora `success`; la validez se decide por la forma de los datos. |
| `pago_informacion` sin fechas usa una ventana fija (2025-06-01 → 2026-05-31) | **Siempre** se envían `fecha_inicio` y `fecha_fin` explícitas. |
| El libro trae cuotas **futuras** y fantasmas | Se consulta por `tipo_busqueda=CUOTA` y se cruza por `id_cuota` contra las facturas abiertas de Cobrix; lo que no cruza se descarta sin contarlo. |
| `tipo_busqueda=FACTURA` devuelve `id_contrato: 0` | No se usa ese modo. |
| `POST /usuario/me` responde 500 | No se usa. |
| 5xx / timeouts | 3 intentos con backoff 250 ms → 1 s → 3 s; timeout 10 s por request; concurrencia máxima 4 contratos. |

### 3.3 Modelo de datos de Cobrix (montos en **centavos enteros**)

```sql
CREATE TABLE empresa (id INTEGER PRIMARY KEY CHECK (id = 1), nombre TEXT, rif TEXT, email_cobranza TEXT);

CREATE TABLE proveedor (
  id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, api_url TEXT NOT NULL,
  usuario TEXT NOT NULL, password_cifrada BLOB,            -- AES-256-GCM, clave en COBRIX_SECRET
  estados_importables TEXT NOT NULL DEFAULT '["ACTIVO","CORTADO"]',
  ventana_meses INTEGER,                                   -- NULL = sin ventana
  max_cuotas_recientes INTEGER,                            -- NULL = todas
  dias_gracia INTEGER NOT NULL DEFAULT 0,
  tope_facturas INTEGER, tope_monto_centavos INTEGER,      -- NULL = sin tope
  excluir_tipos_documento TEXT NOT NULL DEFAULT '[]',
  auto_activa INTEGER NOT NULL DEFAULT 0, auto_hora TEXT
);

CREATE TABLE cliente (                                     -- id = identificación normalizada
  id TEXT PRIMARY KEY, tipo_documento TEXT, numero TEXT, nombre TEXT NOT NULL,
  persona TEXT NOT NULL CHECK (persona IN ('natural','juridica')),
  email TEXT, telefono TEXT, origen TEXT NOT NULL, creado_en TEXT NOT NULL
);

CREATE TABLE contrato (                                    -- id = contrato_id del administrador
  id INTEGER PRIMARY KEY, cliente_id TEXT NOT NULL REFERENCES cliente(id),
  codigo TEXT, estado TEXT NOT NULL, plan TEXT, precio_centavos INTEGER,
  sucursal TEXT, moneda TEXT, visto_en TEXT NOT NULL
);

CREATE TABLE factura (
  id INTEGER PRIMARY KEY AUTOINCREMENT,                    -- número de Cobrix
  proveedor_id INTEGER NOT NULL, deuda_id TEXT NOT NULL,   -- id externo de la cuota
  cliente_id TEXT NOT NULL REFERENCES cliente(id),
  contrato_id INTEGER NOT NULL REFERENCES contrato(id),
  periodo TEXT NOT NULL, vence_el TEXT NOT NULL, corta_el TEXT NOT NULL,
  total_centavos INTEGER NOT NULL CHECK (total_centavos > 0),
  saldo_centavos INTEGER NOT NULL,
  estado TEXT NOT NULL CHECK (estado IN ('abierta','pagada')),
  pagada_el TEXT, isp_factura_id INTEGER, isp_factura_num TEXT,
  corrida_creacion INTEGER NOT NULL, corrida_pago INTEGER,
  UNIQUE (proveedor_id, deuda_id)                          -- ← idempotencia estructural
);

CREATE TABLE corrida (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL CHECK (tipo IN ('importacion','pagadas')),
  simulacion INTEGER NOT NULL, disparo TEXT NOT NULL CHECK (disparo IN ('manual','automatica')),
  estado TEXT NOT NULL CHECK (estado IN ('en_curso','completada','fallida')),
  inicio TEXT NOT NULL, fin TEXT, contadores TEXT, error TEXT, config_snapshot TEXT
);

CREATE TABLE corrida_linea (
  corrida_id INTEGER NOT NULL REFERENCES corrida(id), contrato_id INTEGER,
  deuda_id TEXT, periodo TEXT, monto_centavos INTEGER,
  resultado TEXT NOT NULL, motivo TEXT NOT NULL, factura_id INTEGER
);

CREATE TABLE evento (                                      -- historial del expediente
  id INTEGER PRIMARY KEY AUTOINCREMENT, cliente_id TEXT NOT NULL, factura_id INTEGER,
  tipo TEXT NOT NULL, ocurrido_en TEXT NOT NULL, detalle TEXT
);
```

`config_snapshot` guarda la configuración con la que corrió: una corrida vieja sigue siendo explicable después de cambiar los parámetros.

### 3.4 Flujo: corrida de importación

```
1.  Abrir corrida (en_curso) con snapshot de configuración y lock exclusivo.
2.  Login → token. Fallo ⇒ corrida fallida con el mensaje de la API. Fin.
3.  GET /isp/lista_ids_contratos (sin `estado`). Validar data vs pagination.total.
4.  Por cada contrato (concurrencia 4): GET /isp/contrato/individual?id_contrato=…
    4.1  Validar coherencia: todas las filas con el contrato pedido, misma identificación,
         mismo estado, sin `deuda_id` repetido  → si no, contrato fuera (respuesta_contradictoria).
    4.2  Estado desconocido                      → estado_desconocido.
    4.3  Estado no importable                    → excluida_estado (una línea por cuota).
    4.4  Identificación no normalizable          → identificacion_invalida.
    4.5  Tipo de documento excluido              → tipo_documento_excluido.
    4.6  Descartar filas `deuda_id = "0"`        → sin_deuda.
    4.7  Descartar `deuda` < 0,01                → saldo_residual.
    4.8  Coherencia de moneda del CONTRATO:
         moneda_sigla ≠ USD  o  max(deuda sobrevivientes) < 1 % de precio_servicio
                                                 → moneda_incoherente (contrato completo).
    4.9  detalle_deuda → periodo + vencimiento; corte = vencimiento + dias_gracia.
         No parseable                            → periodo_invalido.
    4.10 Fuera de la ventana                     → fuera_de_ventana.
    4.11 Más allá del máximo de recientes        → limite_recientes.
    4.12 Ya existe (proveedor_id, deuda_id)      → ya_importada.
    4.13 Candidata.
5.  Ordenar candidatas por (periodo, contrato_id, deuda_id) y aplicar topes en ese orden:
    pasado el tope ⇒ tope_facturas / tope_monto. El orden determinista hace el recorte
    reproducible: la misma base da siempre el mismo conjunto frenado.
6.  Si es simulación: cerrar corrida con contadores y líneas. CERO escrituras de dominio.
7.  Si es real: UNA transacción →
    upsert cliente (ON CONFLICT DO NOTHING + refresco de datos de contacto),
    upsert contrato, INSERT factura, INSERT eventos, INSERT líneas, cerrar corrida.
    Cualquier error ⇒ ROLLBACK y corrida fallida: nunca estado a medias.
```

**Reglas de dominio puras involucradas**

- **Identificación:** se quitan separadores, se pasa a mayúsculas, se valida `^([VEJGP])?(\d{6,12})$` y se eliminan ceros a la izquierda del número. `V-12345678 → V12345678`; `09000123 → 9000123`; `J-40123456-7 → J401234567`. `J`/`G` ⇒ jurídica; resto ⇒ natural. No normalizable ⇒ el contrato no se importa.
- **Periodo:** `"PLAN15MB25 - 2026 Agosto"` → mes en español (tabla fija, sin `Date.parse`) → `periodo 2026-08`, `vencimiento 2026-08-01`. Varias entradas en `detalle_deuda` que no concuerden ⇒ `periodo_invalido`.
- **Dinero:** `Math.round(valor * 100)` una sola vez, en el borde del parseo. El dominio y la base solo ven enteros.

### 3.5 Flujo: corrida de actualización de pagadas

```
1.  Abrir corrida + login (igual que importación).
2.  Agrupar las facturas ABIERTAS de Cobrix por contrato.
3.  Por contrato: GET /isp/pago_informacion?id_contrato=…&tipo_busqueda=CUOTA
      &fecha_inicio=<primer día del periodo más viejo abierto>
      &fecha_fin=<último día del periodo actual>     ← incluye la cuota del mes en curso
4.  Indexar las filas por detalle_pago.id_cuota (puede haber varias: una por factura ISP).
5.  Por cada factura abierta, con sus filas:
    a) 0 filas            → consultar contrato/individual (fallback del §4 del enunciado):
                              · sigue listada con deuda > 0 → abierta_sin_cobro
                              · no aparece                  → sin_evidencia  (JAMÁS pagada)
    b) filas que se contradicen entre sí (saldo_cuota / valor_pago distintos) → inconsistente
    c) saldo_cuota = 0 y valor_pago > 0  → PAGADA (fecha y num_factura del cobro más reciente)
    d) saldo_cuota = 0 y valor_pago = 0  → exonerada (no es pago)
    e) 0 < saldo_cuota < saldo Cobrix    → abono_parcial: se informa, sigue ABIERTA
    f) saldo_cuota = saldo Cobrix        → sin_cambio
    g) saldo_cuota > saldo Cobrix        → saldo_aumentado (anulación en el ISP) → sigue abierta
6.  Simulación ⇒ solo contadores y líneas. Real ⇒ una transacción: factura a `pagada`
    (+ pagada_el, isp_factura_id, isp_factura_num, corrida_pago) + evento `factura_pagada`.
```

El caso ELENA RUIZ (pagar y anular) cae en (f): el libro vuelve a mostrar `saldo_cuota = tarifa` y `valor_pago = 0` aunque exista una factura enlazada. Por eso la condición de pago exige **las dos cosas**: saldo 0 **y** algo pagado.

### 3.6 Idempotencia

Tres capas, no una:

1. **Estructural:** `UNIQUE (proveedor_id, deuda_id)` en `factura`; `cliente.id` es la identificación normalizada.
2. **Lógica:** la clasificación devuelve `ya_importada` / `ya_pagada` antes de intentar escribir.
3. **Verificada:** un test corre importar → importar y asserta `0` nuevas, 42 `ya_importada` y un hash de la tabla `factura` idéntico.

### 3.7 Concurrencia y corrida automática

Un **lock de corrida** en SQLite (fila única con el `corrida_id` en curso) impide dos corridas reales simultáneas; el panel deshabilita los botones y la API responde `409 corrida_en_curso`. El planificador compara cada minuto `HH:MM` en `America/Caracas` con la hora configurada, registra la última fecha ejecutada y encadena importación → pagadas. Si hay una corrida en curso a su hora, se registra `omitida` con el motivo.

### 3.8 API JSON del panel

| Método | Ruta | Uso |
| --- | --- | --- |
| `GET` | `/api/resumen` | totales, proveedor, estado del automático, últimas corridas |
| `GET` `PUT` | `/api/configuracion` | leer (sin contraseña) / guardar validado con Zod |
| `POST` | `/api/configuracion/probar-conexion` | login + conteo de contratos |
| `POST` | `/api/corridas` | `{ tipo: 'importacion'\|'pagadas', simulacion: boolean }` → `201` o `409` |
| `GET` | `/api/corridas` | historial paginado |
| `GET` | `/api/corridas/:id` | contadores + líneas (filtro por `resultado`) |
| `GET` | `/api/corridas/:id/stream` | **SSE** de progreso en vivo |
| `GET` | `/api/clientes?q=` | tabla con agregados |
| `GET` | `/api/clientes/:id` | expediente completo |
| `GET` | `/api/salud` | versión, fecha del sandbox, estado de la base y del proveedor |

Errores siempre con la misma forma: `{ error: { codigo, mensaje, detalle?, endpoint? } }`, con `codigo` estable para que la UI sepa qué sugerir.

### 3.9 Plan de pruebas

| Nivel | Qué cubre |
| --- | --- |
| Unidad (tabla) | normalización de identificaciones (incluye `09000123`, `J-40123456-7`, basura); `detalle_deuda` → periodo/vencimiento/corte; **orden de reglas** residual → moneda (el caso SOFIA TORRES); ventana; máximo de recientes; topes y su determinismo; los 7 veredictos de pago. |
| Contrato con la API | login y caducidad; `estado` nunca se envía; lista sin envoltorio y sin orden; `success: false` con datos; `pago_informacion` sin fechas devuelve otra ventana; fila `deuda_id "0"`. |
| Integración | contra la API real en proceso, puerto 0, base temporal sembrada con `seedBillingApi`. |
| Aceptación (ciclo completo) | importar (42 / 20 / USD 1.235,00) → `/__sim/pagar` ×4 → `/__sim/anular` ×1 → actualizar pagadas (8 pagadas / 34 abiertas / USD 955,00) → repetir ambas (sin cambios). |
| Fallos | credenciales malas ⇒ corrida fallida sin escrituras; API que devuelve 500 ⇒ reintento y luego fallo; timeout. |
| UI (opcional) | Playwright: configurar → simular → importar → abrir expediente. |

### 3.10 Cronograma de 4 días

| Día | Entregable |
| --- | --- |
| 1 | Esquema + repositorios, cliente HTTP con token y reintentos, parseo estricto, normalizadores, tests de unidad en verde. |
| 2 | Corrida de importación (real + simulada) con su taxonomía completa, historial, líneas; test de aceptación de importación. |
| 3 | Corrida de pagadas con los 7 veredictos y el fallback del mes en curso; ciclo completo en verde; planificador. |
| 4 | Panel (React + Tailwind + shadcn/ui), las 6 pantallas, SSE de progreso, responsive/A11y, README y Nota de IA. |

---

## 4. Plantilla para la «Nota de IA»

Guardar como `docs/NOTA.md` y enlazarla desde el `README`. Breve: 1–2 páginas.

```markdown
# Nota de decisiones · prueba Cobrix

## 1. Resumen en 5 líneas
Qué construí, con qué stack, qué cumple (números de §5 del enunciado) y qué dejé fuera.

## 2. Herramientas de IA utilizadas
| Herramienta | Para qué | Qué NO le delegué |
| --- | --- | --- |
| <modelo / CLI> | <p. ej. andamiaje de componentes, tests de tabla, redacción de docs> | <p. ej. las reglas de clasificación, el orden de evaluación> |

Cómo la usé: <flujo real: spec primero, tests antes del código, revisión manual de cada diff>.

## 3. Resuelto con IA vs. corregido a mano
| # | Problema | Qué propuso la IA | Qué corregí y por qué |
| --- | --- | --- | --- |
| 1 | <p. ej. coherencia de moneda> | <evaluarla antes del saldo residual> | <invertí el orden: con la base entregada daba 2 contratos por moneda y 0 residuales en vez de 1 y 1; verificado con un test> |
| 2 | | | |

Errores que detecté por mi cuenta y la IA no: <lista honesta>.

## 4. Decisiones de diseño
| Decisión | Alternativa descartada | Por qué |
| --- | --- | --- |
| Montos en centavos enteros | float / decimal string | el administrador reporta 6 decimales; los enteros eliminan la deriva |
| Dominio puro sin I/O | reglas dentro del cliente HTTP | las 20+ reglas se testean sin servidor |
| <...> | | |

Ambigüedades del enunciado y cómo las resolví: <una línea por ambigüedad>.

## 5. Punto diferencial
Qué agregué que no se pidió, qué problema del operador resuelve y dónde verlo en el panel.

## 6. Qué haría con más tiempo
3–5 ítems priorizados, con el costo estimado de cada uno.
```

Dos reglas para que la nota sume en lugar de restar: **nada de afirmaciones no verificadas** (si dice «idempotente», hay un test que lo prueba) y **el apartado 3 es el que más se lee** — una corrección concreta y bien explicada vale más que diez líneas de proceso.

---

## 5. Calidad y punto diferencial

### 5.1 Definición de «hecho»

Una funcionalidad está lista cuando: `npm test` y `npm run typecheck` pasan; los criterios de §1 se cumplen con la base entregada; la pantalla funciona a 360 px y con teclado; los errores tienen mensaje accionable; y hay una línea en el README o en la nota si la decisión no es obvia.

### 5.2 Punto diferencial principal — «Explicador de decisiones»

Cada línea de corrida guarda, además del resultado, la **traza de reglas evaluadas** en orden con su veredicto. En el detalle de la corrida, cualquier cuota se despliega así:

```
Cuota 7000041 · SOFIA TORRES · 2026-09 · deuda 0,00
  ✓ estado del contrato ACTIVO está en los importables
  ✓ identificación V-20666777 → V20666777 (natural)
  ✗ saldo residual: deuda 0,00 < USD 0,01  → NO SE IMPORTA
  ·  coherencia de moneda: no evaluada (cuota ya descartada)
```

Por qué es el diferencial correcto para esta prueba: el 35 % de la nota es «cada respuesta se interpreta bien», y esto convierte la clasificación en algo **auditable por el operador y por el siguiente dev**, no en una caja negra. Cuesta poco (la traza se produce donde ya se decide) y hace de documentación viva de las reglas de §4.

### 5.3 Punto diferencial secundario — consola de corrida en vivo

`GET /api/corridas/:id/stream` (SSE) emite `contrato_iniciado`, `cuota_clasificada` y `corrida_cerrada`. El panel muestra barra de progreso, contadores que suben y las últimas decisiones scrolleando, con `aria-live="polite"`. Una corrida de 27 contratos deja de ser un spinner. Degrada a *polling* si el navegador corta el stream.

### 5.4 Ideas adicionales, por relación valor/costo

| Idea | Valor para el operador | Costo |
| --- | --- | --- |
| **Vista de cobranza priorizada**: antigüedad de deuda (0–30/31–60/61–90/90+), próximos cortes de la semana, top deudores | Convierte el panel en herramienta de decisión, no de consulta | bajo (una consulta agregada + una pantalla) |
| **Diff de simulación**: «si corres esto ahora, cambian estas 3 facturas» comparando la simulación con el estado actual | Hace útil la simulación en el día a día, no solo al inicio | bajo |
| **`npm run demo`**: siembra, importa, paga en la caja, actualiza y abre el panel en el estado final de los criterios de aceptación | El evaluador ve el ciclo completo en 20 segundos | muy bajo, impacto alto |
| **Salud del proveedor**: latencia y último error por endpoint en el Resumen | Distingue «el ISP está caído» de «mi integración falla» | bajo |
| **Export CSV** de la corrida y de la cartera | Sale del panel al Excel del cobrador | muy bajo |
| **Reloj del sandbox visible** (`SANDBOX_TODAY`) en el pie | Evita la confusión de «¿por qué esta cuota es del futuro?» | trivial |
| Docker + `docker compose up` | Despliegue de un comando | medio |

Recomendación: entregar 5.2 + 5.3 + `npm run demo` + reloj del sandbox. Es el conjunto que más nota mueve por hora invertida; el resto queda listado en «qué haría con más tiempo».

### 5.5 Seguridad y robustez mínimas

- Contraseña del proveedor cifrada (AES-256-GCM, clave en `COBRIX_SECRET`, generada al primer arranque si no existe); nunca en logs, nunca en respuestas, nunca en el snapshot de configuración.
- Validación de todo input con Zod en el borde HTTP; sin `any` en el dominio.
- Sin SQL concatenado: solo `prepare` con parámetros.
- Logs JSON con `corrida_id`; los cuerpos de la API se registran truncados y sin credenciales.
- Timeouts y concurrencia acotados: la integración no puede tumbar al ISP ni colgarse indefinidamente.
