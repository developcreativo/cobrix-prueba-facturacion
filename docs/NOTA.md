# Nota de decisiones

## 1. Qué entrego

La integración completa: importación de clientes y facturas, actualización de pagadas contra el
libro de cuotas del ISP, y un panel para operarla con configuración, sincronización, historial de
corridas, clientes y expediente. Backend en Node 24 + TypeScript estricto **sin dependencias de
producción**, persistencia en `node:sqlite`. El panel, en Vite + React + Tailwind + shadcn/ui.

Los criterios de aceptación de §5 se cumplen y están probados: **20 clientes, 42 facturas
abiertas por USD 1.235,00**, segunda corrida sin novedades, y tras los cinco cobros del
enunciado, **8 pagadas y 34 abiertas por USD 955,00**. 252 pruebas automáticas.

## 2. Cómo usé la IA

Claude Code, en un flujo deliberado: **especificación primero, después pruebas, después código**,
y con el trabajo repartido entre agentes con zonas separadas (uno para la lógica de datos, otro
para la interfaz, otro solo para verificar), coordinados por mí. Yo no acepté ningún informe como
evidencia: cada entrega la verifiqué contra el repositorio (`git status`, el diff real, los
comandos corriendo en mi terminal) antes de darla por buena.

Lo que **no** delegué: el orden de evaluación de las reglas, qué se cuenta como cuota y qué como
línea, qué hacer cuando la API se contradice, y todas las decisiones donde el enunciado era
ambiguo. Esas las tomé yo y están anotadas abajo y en los mensajes de commit.

## 3. Correcciones, en los dos sentidos

### Lo que propuso la IA y cambié

| # | Qué propuso | Qué hice y por qué |
| --- | --- | --- |
| 1 | Los topes de la corrida como una mochila codiciosa: si no cabía una cuota de USD 60, seguía adelante e importaba una de USD 25 más nueva | Lo cambié para que **la corrida se detenga en el tope**. Rellenar el hueco importa una cuota nueva antes que una vieja, y el operador no tiene forma de explicar el salto. Hay una prueba que distingue los dos comportamientos (`se frenaron 21 cuotas que habrían cabido`) |
| 2 | El panel inventó **29 nombres de contador en inglés** (`contractsObserved`, `installmentsImported`…) que no existen en el backend, y la pantalla afirmaba que eran «los mismos nombres que usa Cobrix por dentro» | Los sustituí por las claves reales y eliminé los cuatro que no tenían origen posible. El renombrado se arregla en diez minutos. El problema era **una afirmación falsa en la interfaz**, que no rompe nada y desinforma a quien venga después |
| 3 | `Contador.valor: number` para todos los contadores, incluido el monto | Añadí `tipo: 'cuenta' \| 'dinero'`. Los montos son centavos: se habría renderizado **«123.500»** en vez de «USD 1.235,00» el día de conectar |
| 4 | Las líneas de corrida sin declarar cuántas cuotas resumen | Una línea puede cubrir un contrato entero. Sin eso, la misma pantalla mostraba «Moneda incoherente (1)» junto a un contador que decía 2. Ahora se muestran las dos columnas y se explica por qué difieren |
| 5 | El panel pensaba redactar la sugerencia de «cómo seguir» a partir del código de error | El backend ya la redacta. Dos sitios redactando lo mismo acaban divergiendo, así que el panel muestra la del backend |
| 6 | Instantes documentados como UTC (`…Z`) cuando el almacén guarda hora civil de Caracas sin zona | Desfase de cuatro horas silencioso según la máquina. La capa HTTP emite ISO con `-04:00` explícito |
| 7 | Un agente escribió en `data/billing-api.sqlite` levantando su servidor en otro puerto pero apuntando al mismo fichero | Lo restauré y verifiqué el SHA-256. **Lo reportó él mismo**, arriba del todo y sin que yo preguntara. El aislamiento correcto (`BILLING_API_DB`) quedó documentado en el README |

### Donde me equivoqué yo

Dije que VALENTINA PAZ era el contrato `900121` y es el `900115`, y lo comprobó contra el sandbox
antes de escribir la prueba en vez de fiarse de mí. Afirmé que la taxonomía tenía 16 resultados
de importación y tiene 15. Y **reporté como fallo un comportamiento que no existía**, una ruta
que supuestamente redirigía mal: era estado de mi servidor de desarrollo, y se descartó con
siete variantes probadas con perfil limpio.

### El hallazgo que salió de ejecutar la base entregada

Esto lo encontré **antes de escribir una línea de código**, ejecutando un script de lectura
contra la base para comprobar si mis reglas daban los números del enunciado. **El orden de las
reglas no se puede elegir.** La cuota de saldo `0,001317` de SOFIA TORRES la publica
`contrato/individual` como `deuda: 0`. Si la coherencia de moneda se evalúa antes del descarte
por saldo residual, esa cuota mide 0 % del precio del plan y arrastra al contrato entero. La corrida daría *2 contratos por moneda y 0 residuales* en vez de 1 y 1, y
perdería además las cuotas legítimas de esa clienta. Está fijado por la prueba «descarta el saldo
residual ANTES de juzgar la moneda».

## 4. Decisiones donde el enunciado no decidía

| Decisión | Por qué |
| --- | --- |
| **Un error de la API aborta la corrida entera** en vez de importar lo que se pueda | Una importación parcial no se distingue de «no había nada que importar». El operador necesita saber que el ISP se cayó |
| **La ventana del libro llega hasta fin del mes en curso** | `pago_informacion` filtra por fecha de emisión y a una cuota sin cobro le pone una fecha sintética a fin de mes. Pidiendo «hasta hoy», la cuota del mes desaparece y se lee como ausente |
| **Refrescar nunca inserta** | Un contrato importable pone al día estado, plan y contacto aunque no traiga cuotas nuevas. Si además pudiera crear, LAURA MENDEZ (activa y sin deuda) aparecería como cliente y la aceptación pasaría de 20 a 21 |
| **Una respuesta ilegible no es «no pagada»** | Si el libro se contradice o no se puede leer, la factura queda intacta y se informa. Nunca se marca pagada y nunca se asume lo contrario |
| **El Resumen muestra 21 contratos «de 27 leídos»** | La captura de referencia muestra 27 porque espeja todos los contratos. Cobrix no puede, porque guardar los 27 obligaría a crear clientes que el enunciado prohíbe, y por eso se muestran los dos números |
| **Cero dependencias de producción** | `node:sqlite` y `node:http` bastan. Las reglas, que son el 35 % de la nota, se prueban sin servidor ni base |
| **La contraseña del proveedor se guarda cifrada** (AES-256-GCM) | El enunciado solo pide no mostrarla al editar, pero dejarla en claro en un SQLite era gratis de evitar. No sale en ninguna respuesta de la API ni en el registro de corridas |

## 5. El punto diferencial: el explicador de decisiones

Cada cuota de cada corrida guarda **la traza de las reglas que se evaluaron, en orden, con su
veredicto**, y el panel la despliega:

```
Cuota 7000041 · SOFIA TORRES · sep 2026 · deuda USD 0,00
  ✓ estado del contrato         ACTIVO está entre los importables (ACTIVO, CORTADO)
  ✓ identificación del titular  V-20666777 → V20666777 (natural)
  ✗ saldo de la cuota           USD 0,00 es menos de un centavo  → NO SE IMPORTA
  ·  coherencia de moneda       no se evalúa: la cuota ya quedó descartada
```

Los tres veredictos se distinguen por símbolo, por color y por un texto para lectores de
pantalla. La traza se produce **en el mismo lugar donde se decide**, así que no puede
desincronizarse de la regla, y se guarda con la corrida: una corrida de hace un mes se sigue
explicando aunque la configuración haya cambiado.

Lo que más pesa en la evaluación es interpretar bien cada respuesta de la API, y esto deja esa
interpretación **auditable por el operador y por el siguiente desarrollador**. También es la
documentación viva de las reglas de §4: si alguien cambia una, la pantalla lo dice.

De apoyo está la **consola de corrida en vivo**, con la barra, los contadores subiendo y las
últimas decisiones scrolleando. El progreso llega por SSE desde la corrida real. Si el navegador
corta el stream, pasa a consultar el detalle cada pocos segundos y la barra no se congela.

## 6. Qué dejé fuera, a conciencia

- **Multi-ISP y autenticación de operadores.** El modelo lleva `proveedor_id` para no bloquearlo,
  pero la UI gestiona uno y el panel no tiene login, que no estaba pedido.
- **`duracion_ms` con precisión real.** Los instantes se guardan con precisión de segundo, así que
  casi todas las corridas muestran «menos de 1 s». Guardar milisegundos es una columna.
- **Errores de validación campo a campo.** `PUT /api/configuracion` devuelve los problemas en una
  sola frase, y el panel los muestra completos encima del formulario, no junto a cada campo.
- **Code splitting del panel.** El bundle son ~500 kB en un solo *chunk*. Con `lucide-react` y
  Radix es el candidato obvio, pero no cambia nada funcional.

## 7. Qué haría con más tiempo, por orden

1. **Una vista de cobranza priorizada**: antigüedad de deuda por tramos, cortes de la semana y
   top deudores. Hoy el panel informa, y con esto el cobrador sabría a quién llamar primero.
2. **Reintentos selectivos por contrato.** Hoy un error de la API aborta la corrida completa, que
   es lo correcto por defecto. Con más tiempo, reintentaría el contrato fallido y marcaría la
   corrida como parcial, con su lista de pendientes.
3. **Métricas de la integración**: latencia por endpoint y tasa de error del ISP en el Resumen,
   para distinguir «el ISP está caído» de «mi integración falla».
4. **Exportar a CSV** la cartera y el detalle de una corrida, que es lo primero que pide cualquier
   equipo de cobranza.
