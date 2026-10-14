# Integración Cobrix ↔ administrador de facturas

El lado de Cobrix. Solo habla con el administrador por HTTP, como lo haría con un ISP real
(`src/billing-api/` y `data/billing-api.sqlite` no se tocan).

## Capas

```
dominio/     reglas puras: ni HTTP ni base de datos
  dinero        centavos enteros; el redondeo ocurre una sola vez, en el parseo
  identificacion normalización del documento del titular → clave del cliente
  periodo       detalle_deuda → periodo, vencimiento y corte
  configuracion valores por defecto y validación
  importacion   qué se importa, qué se excluye y por qué
  pagos         cuándo una factura abierta está realmente cobrada
  resultados    taxonomía de resultados y traza de reglas
  tipos         contratos de datos entre la lectura de la API y las reglas

api/         transporte
  cliente       token de 2 h, reintentos, tiempos de espera, errores explicables
  lectura       lectura ESTRICTA de cada respuesta: lo inesperado no se adivina

almacen/     persistencia (node:sqlite)
  esquema       DDL de la base de Cobrix
  base          apertura, transacciones y lectura de columnas con tipos estrechos
  configuracion empresa y proveedor; la contraseña entra pero no sale
  clientes      alta y refresco de titulares y contratos; eventos del expediente
  facturas      alta de facturas, `deuda_id` ya importados y totales de la cartera
  corridas      historial: abrir, cerrar, fallar, listar, detalle y el cerrojo

corridas/    orquestación (conecta api/ + dominio/ + almacen/)
  importacion   la corrida de importación, real y simulada
  pagadas       la corrida de actualización de pagadas, real y simulada
  progreso      eventos en vivo de una corrida, solo mientras alguien escuche

http/        la API JSON del panel y el servidor que lo sirve
  api           los endpoints de /api, con un solo formato de error
  vista         de la base al contrato del panel: snake_case e instantes con desfase
  bus           reparto del progreso a los clientes conectados por SSE
  servidor      /api + el panel compilado de web/dist + /enunciado

planificador  corrida automática diaria (importar y después pagadas), con reloj inyectable

apoyo/
  secreto       AES-256-GCM para la contraseña del proveedor
  limite        recorrido con concurrencia acotada, en orden y abortable
```

**`dominio/` no importa nada de `api/` ni de `almacen/`**, y por eso las reglas de
ENUNCIADO.md §4 se prueban en tablas, sin servidor ni base.

## Dónde está cada regla

| Regla del enunciado | Dónde |
| --- | --- |
| Un cliente por identificación, normalizada, J/G jurídicas | `dominio/identificacion.ts` |
| Una factura por cuota pendiente; `deuda_id "0"` no es cuota; saldo residual | `dominio/importacion.ts` |
| Periodo y vencimiento desde `detalle_deuda`; corte con días de gracia | `dominio/periodo.ts` |
| Estados importables, moneda coherente, nada se adivina | `dominio/importacion.ts` |
| Ventana y máximo de recientes | `dominio/importacion.ts` |
| Topes por corrida (son de la corrida: se aplican una vez sobre todas las candidatas) | `dominio/importacion.ts` (`aplicarTopes`) + `corridas/importacion.ts` |
| Idempotencia | `dominio/importacion.ts` + `corridas/importacion.ts` (lee los `deuda_id` ya importados) + `UNIQUE (proveedor_id, deuda_id)` en `almacen/esquema.ts` |
| Simular sin escribir, atomicidad de la corrida real y corrida fallida con su error | `corridas/importacion.ts` + `almacen/corridas.ts` |
| Una sola corrida real a la vez | `almacen/corridas.ts` (tabla `bloqueo`) + `409` en `http/api.ts` |
| La contraseña entra y no sale | `almacen/configuracion.ts` + `http/vista.ts` (`password_definida`) |
| Corrida automática diaria a una hora, sin solaparse | `planificador.ts` |
| El expediente refleja el ISP: refrescar titular y contrato **sin** insertar | `dominio/importacion.ts` (`frescos`) + `almacen/clientes.ts` (`refrescarCliente`, `refrescarContrato`) |
| Pagada, abono parcial, exonerada, sin evidencia | `dominio/pagos.ts` |
| La ventana del libro (hasta el último día del periodo actual) y el desempate del mes en curso | `corridas/pagadas.ts` |
| Rarezas de la API (`estado`, `success: false`, filas sin orden, cuotas futuras) | `api/cliente.ts` + `api/lectura.ts` |

**El orden de evaluación de las reglas de importación es parte de la especificación.** Está
documentado en la cabecera de `dominio/importacion.ts` y lo fija la prueba «descarta el saldo
residual ANTES de juzgar la moneda».

## Pruebas

```bash
npm test          # dominio + API del ISP + almacén + corridas (ciclo completo) + API del panel
npm run typecheck
```

El panel (React + Tailwind + shadcn/ui) vive en `web/` y se sirve compilado desde
`http/servidor.ts`. El esqueleto entregado en `src/web/` ya no se usa, y ENUNCIADO.md §3.7
autoriza reemplazarlo.
