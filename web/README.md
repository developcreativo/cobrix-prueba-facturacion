# Panel de Cobrix (`web/`)

Interfaz del panel: Vite + React 19 + TypeScript + Tailwind CSS v4 + shadcn/ui (Radix + cva),
con React Router. Es un proyecto autocontenido, con su propio `package.json`.

```bash
npm install
npm run dev        # desarrollo con HMR en http://127.0.0.1:5173 (proxy de /api al 4300)
npm run build      # typecheck + build estático en web/dist
npm run preview    # sirve web/dist
npm run typecheck
npm run lint
```

## Estado actual

Las pantallas están montadas con **datos de ejemplo** (`src/datos/ejemplo.ts`): todavía no se
habla con la API del panel. Ese archivo es temporal y está tipado con el contrato de
`docs/SPEC.md` §3.8, que vive en `src/tipos/panel.ts`; al conectar la API solo cambia de dónde
salen los objetos, no las pantallas.

## Mapa

| Carpeta | Qué hay |
| --- | --- |
| `src/paginas/` | Una pantalla por ruta: resumen, configuración, sincronización, corrida, clientes, expediente |
| `src/components/` | Piezas propias del panel (armazón, píldoras de estado, tablas, consola de corrida, explicador de decisiones) |
| `src/components/ui/` | Componentes de shadcn/ui, generados con su CLI (`npx shadcn@latest add …`) |
| `src/lib/` | `formato.ts` (montos, fechas y periodos), `resultados.ts` (taxonomía y tonos), `utils.ts` (`cn`) |
| `src/datos/` | `api.ts` (el único `fetch` del panel y sus hooks) y `panel.tsx` (salud y empresa, una vez al arrancar) |
| `src/tipos/panel.ts` | Contrato de la API del panel |

## Convenciones

- **Formato en un solo sitio.** Montos `USD 1.235,00`, fechas `13 oct 2026`, periodos `oct 2026`:
  todo sale de `src/lib/formato.ts`. Los montos llegan en centavos enteros.
- **Estados con color y texto.** Las etiquetas y los tonos de cada resultado son copia de
  `src/cobrix/dominio/resultados.ts`, que es la fuente de verdad.
- **Tema claro y oscuro con tokens.** Ningún componente escribe un color fijo: todo sale de las
  variables de `src/index.css`, incluidos los tonos de estado (`ok`, `warn`, `bad`, `info`, `mute`).
- **Responsive de verdad.** De 360 px en adelante sin desbordes: las tablas se convierten en
  tarjetas por debajo de `md`.

## Los tres estados de cada pantalla, con datos reales

Ya no hace falta forzarlos con un parámetro en la URL (se retiró con los datos de ejemplo):

- **vacío** — Cobrix recién instalado, o después de «Borrar datos importados».
- **error** — para el servidor del panel (`Ctrl-C` en `npm start`) y recarga: sale el bloque con
  el mensaje, la sugerencia y el código, más «Reintentar».
- **cargando** — los skeletons se ven en la primera carga; para mirarlos con calma, limita la red
  en las herramientas del navegador.

El «cómo seguir» de cualquier error lo redacta el backend (`sugerencia`); el panel solo lo
muestra y, cuando el código tiene un destino claro, añade el enlace a la pantalla que lo arregla.
