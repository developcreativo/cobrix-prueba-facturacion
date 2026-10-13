import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

import App from '@/App'
import { ProveedorTema } from '@/components/tema'
import '@/index.css'

const raiz = document.getElementById('root')
if (!raiz) throw new Error('No se encontró el nodo #root del panel')

createRoot(raiz).render(
	<StrictMode>
		<ProveedorTema>
			<BrowserRouter>
				<App />
			</BrowserRouter>
		</ProveedorTema>
	</StrictMode>,
)
