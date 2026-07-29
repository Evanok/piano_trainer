import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { createCatalogApi } from './server/catalogApi.ts'

// Mounts the catalog API on the dev server so `npm run dev` stays a single
// process. Production runs the exact same handler from server/index.ts.
function catalogApi(): Plugin {
  return {
    name: 'piano-trainer-catalog-api',
    configureServer(server) {
      const handler = createCatalogApi()
      server.middlewares.use((req, res, next) => handler(req, res, next))
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), catalogApi()],
  server: {
    watch: {
      // Uploads write into data/; without this, saving a score would trigger a
      // full page reload and drop a practice session in progress.
      ignored: ['**/data/**'],
    },
  },
})
