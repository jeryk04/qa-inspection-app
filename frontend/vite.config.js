import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // Self-signed HTTPS for the dev server -- Android only offers a real
    // "Install app" (standalone, no address bar) for a page served over a
    // secure context; plain http only ever gets a browser-shortcut-style
    // "Add to Home Screen". The tablet has to click through a one-time
    // "not secure" warning the first time it opens this cert.
    basicSsl(),
    VitePWA({
      registerType: 'autoUpdate',
      // Registers the service worker in `vite dev` too, not just a
      // production build -- installability requires one, and this is
      // meant to be tested straight off the dev server.
      devOptions: { enabled: true, type: 'module' },
      manifest: {
        name: 'Inspection App',
        short_name: 'Inspection',
        description: 'Digital inspection data sheets for Incoming, Set-up, In-Process, and Final Inspection.',
        theme_color: '#1d5c85',
        background_color: '#123a5c',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  // host: true binds to 0.0.0.0 (not just localhost) so a tablet/phone on
  // the same LAN can reach the dev server -- matches the backend's LAN CORS
  // allowance in backend/src/index.js.
  server: {
    host: true,
    // Native fs.watch crashes immediately on this mapped/network drive
    // (Error: UNKNOWN: unknown error, watch) -- polling avoids relying on
    // OS-level watch handles.
    watch: {
      usePolling: true,
    },
  },
  // `vite preview` serves the production build (see deploy/) -- needs the
  // same LAN-reachable host: true as the dev server above, since it's what
  // shop-floor tablets actually hit once deployed, not just localhost.
  preview: {
    host: true,
  },
})
