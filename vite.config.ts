import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Web MIDI (and other powerful browser APIs) requires a secure context --
  // testing from a phone means going through an HTTPS tunnel (e.g.
  // cloudflared) with a hostname Vite doesn't recognize by default, which its
  // dev/preview servers otherwise block (DNS-rebinding protection).
  server: { allowedHosts: true },
  preview: { allowedHosts: true },
})
