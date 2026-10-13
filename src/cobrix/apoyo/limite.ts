/**
 * Recorrido con concurrencia acotada.
 *
 * Una corrida consulta un endpoint por contrato: con 27 contratos son 27 peticiones y con un
 * ISP real pueden ser miles. Lanzarlas todas a la vez tumbaría al administrador de facturas
 * (docs/SPEC.md §3.2 fija el máximo en 4), y hacerlas en serie haría la corrida innecesariamente
 * lenta. `mapConLimite` mantiene ocupados como máximo `limite` trabajos a la vez.
 *
 * Dos garantías de las que depende la corrida:
 *  - **La salida conserva el orden de la entrada**, no el de finalización: la clasificación de
 *    los contratos es determinista aunque las respuestas lleguen desordenadas.
 *  - **El primer fallo aborta el recorrido**: no se toman trabajos nuevos y se espera a los que
 *    ya estaban en vuelo antes de propagar el error, para no dejar peticiones huérfanas.
 */

export async function mapConLimite<Entrada, Salida>(
	elementos: readonly Entrada[],
	limite: number,
	trabajo: (elemento: Entrada, indice: number) => Promise<Salida>,
): Promise<Salida[]> {
	if (!Number.isInteger(limite) || limite < 1) {
		throw new RangeError(`El límite de concurrencia debe ser un entero de 1 o más, no «${String(limite)}».`)
	}

	const salida: Salida[] = new Array<Salida>(elementos.length)
	let siguiente = 0
	let abortado = false
	let fallo: unknown = undefined

	const obrero = async (): Promise<void> => {
		while (!abortado) {
			const indice = siguiente++
			if (indice >= elementos.length) return
			try {
				salida[indice] = await trabajo(elementos[indice]!, indice)
			} catch (error: unknown) {
				if (!abortado) {
					abortado = true
					fallo = error
				}
				return
			}
		}
	}

	// Ningún obrero rechaza: el fallo se guarda y se propaga una sola vez, al final.
	await Promise.all(Array.from({ length: Math.min(limite, elementos.length) }, () => obrero()))
	if (abortado) throw fallo
	return salida
}
