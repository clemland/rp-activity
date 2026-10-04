import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5173, allowedHosts: true, hmr: { clientPort: 443 } },
  build: { outDir: 'dist', assetsInlineLimit: 0 },
});
