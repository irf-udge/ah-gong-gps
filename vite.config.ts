import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

const API_PORT = process.env.API_PORT ?? '8787';

export default defineConfig({
  plugins: [react()],
  // Keep the documented DEMO_MODE=1 command consistent across the API and
  // browser bundles. Vite only exposes VITE_* variables automatically.
  define: {
    'import.meta.env.VITE_DEMO_MODE': JSON.stringify(process.env.VITE_DEMO_MODE ?? process.env.DEMO_MODE ?? ''),
  },
  resolve: {
    alias: {
      '@core': fileURLToPath(new URL('./src/core', import.meta.url)),
      '@providers': fileURLToPath(new URL('./src/providers', import.meta.url)),
      '@ui': fileURLToPath(new URL('./src/ui', import.meta.url)),
    },
  },
  server: {
    // `--host` so a phone on the same network can reach the dev server.
    // Mic + geolocation need a secure context: use a tunnel (cloudflared/ngrok)
    // when testing on a real device. See README § Testing on a phone.
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: `http://localhost:${API_PORT}`,
        changeOrigin: true,
      },
    },
  },
});
