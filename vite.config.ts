import { execSync } from 'node:child_process'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { createCatalogApi } from './server/catalogApi.ts'
import { migrateCatalog, resolveDataDir } from './server/catalogStore.ts'

function git(command: string): string {
  try {
    return execSync(command, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    // No tag on HEAD, or no git at all.
    return ''
  }
}

// Version label on the home page: the tag when HEAD carries one, the short
// commit otherwise. Resolved here because the build is the only moment git is
// guaranteed to be around -- the browser never sees a repository.
//
// The `-dirty` suffix matters more than it looks: without it the label names a
// commit while the running build contains uncommitted work, so the version on
// screen is not the version in the repository and cannot be checked out.
function resolveAppVersion(): string {
  const version = git('git describe --tags --exact-match HEAD') || git('git rev-parse --short HEAD')
  if (!version) {
    return 'unknown'
  }
  return git('git status --porcelain') ? `${version}-dirty` : version
}

process.env.VITE_APP_VERSION = resolveAppVersion()

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
