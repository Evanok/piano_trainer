import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { createCatalogApi } from './server/catalogApi.ts'
import { migrateCatalog, resolveDataDir } from './server/catalogStore.ts'

// Mounts the catalog API on the dev server so `npm run dev` stays a single
// process. Production runs the exact same handler from server/index.ts.
function catalogApi(): Plugin {
  return {
    name: 'piano-trainer-catalog-api',
    async configureServer(server) {
      const dataDir = resolveDataDir()
      // A broken catalog must not keep the dev server from starting: the
      // front-end is still perfectly usable, only the API will report the error.
      await migrateCatalog(dataDir).catch((error: unknown) => {
        console.error('[catalog] metadata migration failed:', error)
      })
      const handler = createCatalogApi(dataDir)
      server.middlewares.use((req, res, next) => handler(req, res, next))
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), catalogApi()],
  // Web MIDI (and other powerful browser APIs) requires a secure context --
  // testing from a phone means going through an HTTPS tunnel (e.g.
  // cloudflared) with a hostname Vite doesn't recognize by default, which its
  // dev/preview servers otherwise block (DNS-rebinding protection).
  server: {
    allowedHosts: true,
    watch: {
      // Uploads write into data/; without this, saving a score would trigger a
      // full page reload and drop a practice session in progress.
      ignored: ['**/data/**'],
    },
  },
  preview: { allowedHosts: true },
})
