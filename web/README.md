# Panel de Cobrix (`web/`)

Interfaz del panel: Vite + React 19 + TypeScript + Tailwind CSS v4 + shadcn/ui (Radix + cva),
con React Router. Es un proyecto autocontenido, con su propio `package.json`.

Las seis pantallas —resumen, configuración, sincronización, detalle de corrida, clientes y
expediente— consumen la **API del panel** (`/api/*`, `src/cobrix/http/api.ts`, SPEC §3.8). Todo lo
que se ve sale de ahí: el panel no guarda datos propios ni rellena huecos.

## Cómo levantarlo

```bash
# en la raíz del repositorio: API del panel en el 4300 e ISP simulado en el 4310
npm start

# aquí: servidor de desarrollo con HMR en http://localhost:5173, que redirige /api al 4300
npm install
npm run dev
```

`COBRIX_API` cambia el destino de esa redirección sin tocar `vite.config.ts`, por ejemplo para
apuntar a otra instancia con su propia base:

```bash
COBRIX_API=http://127.0.0.1:4302 npm run dev
```

El resto de los guiones:

```bash
npm run build      # typecheck + build estático en web/dist, que es lo que sirve `npm start`
npm run preview    # sirve web/dist (sin redirección de /api: hay que levantar el panel aparte)
npm run typecheck
npm run lint
```

La primera vez Cobrix está vacío a propósito, y el panel lo dice en vez de enseñar tablas vacías.
Para llenarlo: en **Configuración**, URL `http://127.0.0.1:4310/api/v1`, usuario `cobrix`,
contraseña `cobrix-sandbox`, «Probar conexión» y, en **Sincronización**, «Importar». Quedan 20
clientes y 42 facturas abiertas por USD 1.235,00.

## Mapa

| Carpeta | Qué hay |
| --- | --- |
| `src/paginas/` | Una pantalla por ruta: resumen, configuración, sincronización, corrida, clientes, expediente |
| `src/datos/` | `api.ts`, la única puerta a la API (el `fetch`, el SSE del progreso y los hooks de lectura), y `panel.tsx`, lo que se pide una vez al arrancar: reloj del sandbox, empresa y corrida en curso |
| `src/tipos/panel.ts` | El contrato de `/api/*`: lo que la API sirve, tal cual |
| `src/components/` | Piezas propias del panel (armazón, píldoras de estado, tablas, consola de corrida en vivo, explicador de decisiones) |
| `src/components/ui/` | Componentes de shadcn/ui, generados con su CLI (`npx shadcn@latest add …`) |
| `src/lib/` | `formato.ts` (montos, fechas y periodos), `resultados.ts` (taxonomía y tonos), `corridas.ts`, `utils.ts` (`cn`) |

## Convenciones

- **Una sola puerta a la red.** Ninguna pantalla hace `fetch`: todo pasa por `src/datos/api.ts`,
  que devuelve las respuestas sin transformarlas.
- **Los errores los redacta el backend.** Llegan como
  `{ error: { codigo, mensaje, sugerencia, endpoint, status } }` y se muestran tal cual; el panel
  solo añade, cuando el código tiene un destino claro, el enlace a la pantalla que lo arregla.
- **Formato en un solo sitio.** Montos `USD 1.235,00`, fechas `13 oct 2026`, periodos `oct 2026`:
  todo sale de `src/lib/formato.ts`. Los montos llegan en centavos enteros y los instantes con
  desfase explícito (`-04:00`).
- **Estados con color y texto.** Las etiquetas y los tonos de cada resultado son copia de
  `src/cobrix/dominio/resultados.ts`, que es la fuente de verdad.
- **Tema claro y oscuro con tokens.** Ningún componente escribe un color fijo: todo sale de las
  variables de `src/index.css`, incluidos los tonos de estado (`ok`, `warn`, `bad`, `info`, `mute`).
- **Responsive de verdad.** De 360 px en adelante sin desbordes: las tablas se convierten en
  tarjetas por debajo de `md`.

## Los tres estados de cada pantalla

Se alcanzan con datos reales, sin interruptores en la URL:

- **vacío** — Cobrix recién instalado, o después de «Borrar datos importados».
- **error** — para el servidor del panel (`Ctrl-C` en `npm start`) y recarga: sale el bloque con
  el mensaje, la sugerencia y el código, más «Reintentar».
- **cargando** — los skeletons se ven en la primera carga; para mirarlos con calma, limita la red
  en las herramientas del navegador.

## El progreso en vivo

Lanzar una corrida (`POST /api/corridas`) devuelve su id en cuanto existe, y con él se abre
`GET /api/corridas/:id/stream`: la consola muestra la barra, los contadores subiendo y las últimas
decisiones, con `aria-live` para quien no mire la pantalla. Al cerrarse la corrida se relee su
detalle para quedarse con el resumen definitivo. Si el navegador corta el stream, el panel pasa a
consultar el detalle cada pocos segundos y lo dice, en vez de dejar la barra congelada.
