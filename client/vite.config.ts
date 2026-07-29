import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const SATELLITE_WASM_STUB = '\0satellite-wasm-stub'

/**
 * satellite.js re-exports an optional WASM backend from its entry point
 * (`export * from './wasm/index.js'`). Its pthreads build uses top-level await
 * and `node:worker_threads`, neither of which can be bundled for the browser.
 *
 * We only use the pure-JS SGP4 API, so keep that barrel out of the module
 * graph entirely rather than shipping a broken worker chunk.
 */
function stubSatelliteWasm(): Plugin {
  return {
    name: 'stub-satellite-wasm',
    enforce: 'pre',
    resolveId(source, importer) {
      if (importer?.includes('satellite.js') && /(^|\/)wasm\/index\.js$/.test(source)) {
        return SATELLITE_WASM_STUB
      }
      return null
    },
    load(id) {
      return id === SATELLITE_WASM_STUB ? 'export {}' : null
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), stubSatelliteWasm()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
