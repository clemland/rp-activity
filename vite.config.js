import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Liste des images du dossier public/icons, connue au moment de construire le site.
 * Dans l'app : import ICON_FILES from 'virtual:icon-list'.
 */
function iconList() {
  const dir = path.resolve('public/icons');
  return {
    name: 'icon-list',
    resolveId: (id) => (id === 'virtual:icon-list' ? '\0icon-list' : null),
    load(id) {
      if (id !== '\0icon-list') return null;
      const files = fs.existsSync(dir)
        ? fs.readdirSync(dir).filter((f) => /\.(png|webp|gif|jpe?g|svg)$/i.test(f)).sort((a, b) => a.localeCompare(b))
        : [];
      return `export default ${JSON.stringify(files)};`;
    },
  };
}

export default defineConfig({
  plugins: [iconList()],
  server: { port: 5173, allowedHosts: true, hmr: { clientPort: 443 } },
  build: { outDir: 'dist', assetsInlineLimit: 0 },
});