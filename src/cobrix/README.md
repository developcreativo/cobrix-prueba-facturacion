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

apoyo/
  secreto       AES-256-GCM para la contraseña del proveedor
```

Regla de capas: **`dominio/` no importa nada de `api/` ni de `almacen/`**. Por eso las reglas de
ENUNCIADO.md §4 se prueban en tablas, sin servidor ni base.

## Dónde está cada regla

| Regla del enunciado | Dónde |
| --- | --- |
| Un cliente por identificación, normalizada, J/G jurídicas | `dominio/identificacion.ts` |
| Una factura por cuota pendiente; `deuda_id "0"` no es cuota; saldo residual | `dominio/importacion.ts` |
| Periodo y vencimiento desde `detalle_deuda`; corte con días de gracia | `dominio/periodo.ts` |
| Estados importables, moneda coherente, nada se adivina | `dominio/importacion.ts` |
| Ventana, máximo de recientes, topes por corrida | `dominio/importacion.ts` |
| Idempotencia | `dominio/importacion.ts` + `UNIQUE (proveedor_id, deuda_id)` en `almacen/esquema.ts` |
| Pagada, abono parcial, exonerada, sin evidencia | `dominio/pagos.ts` |
| Rarezas de la API (`estado`, `success: false`, filas sin orden, cuotas futuras) | `api/cliente.ts` + `api/lectura.ts` |

**El orden de evaluación de las reglas de importación no es libre**: está documentado en la
cabecera de `dominio/importacion.ts` y fijado por la prueba «descarta el saldo residual ANTES de
juzgar la moneda».

## Pruebas

```bash
npm test          # dominio (tablas) + API (sandbox y stub) + almacén
npm run typecheck
```

Pendiente: orquestación de corridas, API del panel y pantallas (ver `docs/SPEC.md` §3).
