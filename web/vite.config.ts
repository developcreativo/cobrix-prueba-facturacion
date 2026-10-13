import { fileURLToPath, URL } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// El panel se sirve como build estático desde `web/dist` (SPEC §2.2).
// En desarrollo, `/api` se redirige al backend del panel en el 4300.
export default defineConfig({
	plugins: [react(), tailwindcss()],
	resolve: {
		alias: {
			'@': fileURLToPath(new URL('./src', import.meta.url)),
		},
	},
	server: {
		port: 5173,
		proxy: {
			'/api': { target: 'http://127.0.0.1:4300', changeOrigin: true },
		},
	},
})
