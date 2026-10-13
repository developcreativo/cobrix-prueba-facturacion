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
| `src/tipos/panel.ts` | Contrato de la API del panel |
| `src/datos/ejemplo.ts` | Datos de muestra, temporales |

## Convenciones

- **Formato en un solo sitio.** Montos `USD 1.235,00`, fechas `13 oct 2026`, periodos `oct 2026`:
  todo sale de `src/lib/formato.ts`. Los montos llegan en centavos enteros.
- **Estados con color y texto.** Las etiquetas y los tonos de cada resultado son copia de
  `src/cobrix/dominio/resultados.ts`, que es la fuente de verdad.
- **Tema claro y oscuro con tokens.** Ningún componente escribe un color fijo: todo sale de las
  variables de `src/index.css`, incluidos los tonos de estado (`ok`, `warn`, `bad`, `info`, `mute`).
- **Responsive de verdad.** De 360 px en adelante sin desbordes: las tablas se convierten en
  tarjetas por debajo de `md`.

## Revisar estados sin backend

Cada pantalla que después traerá datos acepta un parámetro en la URL para forzar sus estados:

- `?estado=cargando` — skeletons
- `?estado=error` — bloque de error con mensaje, sugerencia y código
- `?estado=vacio` — estado vacío que explica qué hacer

Por ejemplo: `/clientes?estado=vacio`, `/?estado=error`, `/sincronizacion?estado=cargando`.
