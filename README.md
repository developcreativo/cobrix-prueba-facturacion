# Cobrix ↔ administrador de facturas del ISP

Integración que importa clientes y facturas desde el administrador de facturas de un proveedor
de internet, aplica los pagos que el ISP ya cobró, y un panel para operarla.

Entrega de la prueba técnica de Cobrix. El enunciado original está en
[`docs/ENUNCIADO.md`](docs/ENUNCIADO.md); las decisiones, en [`docs/NOTA.md`](docs/NOTA.md).

```bash
npm install
npm start
```

Requiere **Node 24 o superior**. La primera vez, `npm start` **compila el panel**: instala sus
dependencias (unos 420 paquetes) y lo construye, lo que tarda unos segundos con la caché de npm
caliente y bastante más en una máquina sin ella. Si no puede —por ejemplo, sin red— no se cae: la
API sigue en pie y el panel responde 503 diciendo el comando exacto que falta
(`npm --prefix web install && npm --prefix web run build`).

Si el puerto está ocupado, cámbialo con `PORT` o `BILLING_API_PORT` (tabla al final).

| Qué | Dónde |
| --- | --- |
| **Panel de Cobrix** | **http://127.0.0.1:4300** |
| API del panel | http://127.0.0.1:4300/api/salud |
| API del administrador (simulada) | http://127.0.0.1:4310/api/v1 |
| Swagger del administrador | http://127.0.0.1:4310/docs |

La fecha del sandbox queda fijada en **2026-10-13**, que es con la que valen los números de los
criterios de aceptación.

## Primer uso, en orden

Cobrix arranca vacío a propósito: lo primero que verás son estados vacíos que explican qué hacer.

1. **Configuración** → en *Administrador de facturas*, la URL ya viene puesta
   (`http://127.0.0.1:4310/api/v1`) y el usuario es `cobrix`. Escribe la contraseña
   **`cobrix-sandbox`** y guarda. La contraseña se guarda cifrada y no vuelve a mostrarse.
2. **Probar conexión** → debe responder `Conexión correcta como cobrix: 27 contratos.`
3. **Sincronización** → **Simular importación**. Cuenta qué se importaría sin escribir nada:
   42 cuotas por USD 1.235,00 y 20 clientes por crear.
4. **Importar cuotas**. Pide confirmación, porque sí escribe. Al terminar, el Resumen muestra
   20 clientes, 21 contratos, 42 facturas abiertas y USD 1.235,00 por cobrar.
5. Abre la corrida en el historial y **despliega cualquier cuota**: ahí está la traza de las
   reglas que se evaluaron y por qué terminó donde terminó. Es el punto diferencial de esta
   entrega; está explicado en la nota.

   Donde mejor se ve es en las cuotas que **no** se importaron. Filtra por «Moneda incoherente» y
   despliega la de JORGE CASTILLO —reporta USD con cuotas que son el 0,3 % de su plan—, o por
   «Excluida por estado» y mira una de CARLOS ROJAS. La traza dice qué regla la descartó, con qué
   números, y cuáles ya no se evaluaron.

### Tres números de contratos, y los tres son correctos

El panel muestra **21 contratos espejados «de 27 leídos»**, y una corrida de pagadas puede decir
que consultó 19. No es una discrepancia:

- **27** son todos los contratos que el administrador publica.
- **21** son los que Cobrix guarda: los de los 20 clientes que sí se importaron. Los otros seis
  titulares quedaron fuera por estado, moneda o falta de deuda, y el enunciado pide que no
  existan como clientes.
- **19** son los que una actualización de pagadas necesita consultar: solo los que todavía tienen
  facturas abiertas.

### Para probar «Actualizar pagadas»

Los pagos los registra el ISP, no Cobrix. Se simulan desde la sección **Simulador** del Swagger
(`POST /__sim/pagar`), por ejemplo `{"id_contrato": 900101}` para cobrar toda la deuda de ese
contrato o `{"id_contrato": 900103, "monto": 25}` para un abono parcial. Después, en
**Sincronización → Actualizar pagadas**.

> **Cuidado:** `/__sim/pagar`, `/__sim/anular` y `/__sim/reiniciar` **escriben en
> `data/billing-api.sqlite`**, que viene versionado en el repositorio. Si quieres experimentar
> sin tocarlo, levanta una instancia aparte con su propia base:
>
> ```bash
> PORT=4320 BILLING_API_PORT=4330 \
>   BILLING_API_DB=/tmp/cobrix/billing.sqlite \
>   COBRIX_DB=/tmp/cobrix/cobrix.sqlite \
>   npm start
> ```
>
> Cambiar solo el puerto no aísla nada: lo que aísla es `BILLING_API_DB`.
> Para volver al estado de fábrica: `git restore data/billing-api.sqlite`.

## Pruebas

```bash
npm test          # 249 pruebas
npm run typecheck
```

Qué cubren, de dentro hacia fuera:

| Archivo | Qué prueba |
| --- | --- |
| `test/dominio-*.test.ts` | Las reglas de §4 en tablas: identificaciones, periodos, las 15 clasificaciones de importación, los 9 veredictos de pago, la configuración |
| `test/api-*.test.ts` | Lectura estricta de cada respuesta y el cliente HTTP: token, reintentos, 401, 5xx, tiempos de espera, y las rarezas documentadas de la API |
| `test/corrida-importacion.test.ts` | Los criterios de aceptación de §5, contra la API simulada |
| `test/corrida-limites.test.ts` | Ventana, máximo de recientes, topes, días de gracia y concurrencia, a nivel de corrida completa |
| `test/corrida-pagadas.test.ts` | El ciclo completo: importar → cobrar en la caja del ISP → actualizar pagadas, con los cinco casos de §5 |
| `test/http-api.test.ts` | Los doce endpoints del panel, el SSE y el 409 del cerrojo |
| `test/planificador.test.ts` | La corrida automática, con reloj inyectado |
| `test/entorno.test.ts` | El entorno entregado: la API del administrador responde como está documentada |

Ninguna prueba toca `data/billing-api.sqlite`: todas siembran su propia base temporal.

> **No ejecutes `npm run seed`.** Está en `package.json` porque venía con el material entregado,
> pero **borra y regenera `data/billing-api.sqlite` con el mes actual**, y con eso dejan de valer
> todos los números de los criterios de aceptación. Si llega a pasar:
> `git restore data/billing-api.sqlite`.

## Cómo está organizado

```
src/cobrix/
  dominio/     reglas puras: ni HTTP ni base de datos
  api/         cliente del administrador y lectura estricta de sus respuestas
  almacen/     persistencia en node:sqlite
  corridas/    orquestación de importación y de pagadas
  http/        la API JSON del panel y el servidor
  planificador.ts
web/           el panel: Vite + React + Tailwind + shadcn/ui
src/billing-api/   la API simulada del ISP — material entregado, no se modifica
```

`dominio/` no importa nada de `api/` ni de `almacen/`: por eso las reglas se prueban en tablas,
sin servidor ni base de datos. El mapa detallado está en
[`src/cobrix/README.md`](src/cobrix/README.md) y la arquitectura en
[`docs/SPEC.md`](docs/SPEC.md).

## Desarrollo del panel

```bash
npm start                 # la API en el 4300
cd web && npm run dev     # el panel con recarga en caliente, proxea /api al 4300
```

`COBRIX_API` cambia el destino del proxy si quieres apuntar a otra instancia.

## Variables de entorno

| Variable | Para qué |
| --- | --- |
| `PORT` · `BILLING_API_PORT` | Puertos del panel y de la API simulada (4300 y 4310) |
| `COBRIX_DB` | Base de Cobrix (`data/cobrix.sqlite`) |
| `BILLING_API_DB` | Base del administrador (`data/billing-api.sqlite`) |
| `SANDBOX_TODAY` | La fecha de «hoy» de todo el entorno (`2026-10-13`) |
| `COBRIX_SECRET` | Clave para cifrar la contraseña del proveedor. Si no está, se genera una local en `data/.clave` |
