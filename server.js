/**
 * Serveur local : remplace Vercel sur ton PC.
 *  - le site (avec rechargement à chaud),
 *  - l'API (les mêmes fichiers api/*.js que sur Vercel),
 *  - les images (/media/... relayées depuis Supabase),
 *  - option --tunnel : une adresse HTTPS publique pour Discord.
 *
 * Usage : npm run local     (http://localhost:3000, sans Discord)
 *         npm run discord   (avec le tunnel, pour tester dans Discord)
 */
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const PORT = Number(process.env.PORT) || 3000;
const ROOT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1'));
const TUNNEL = process.argv.includes('--tunnel');

/* ─── Variables d'environnement (avant de charger l'API) ─── */
try {
  process.loadEnvFile(path.join(ROOT, '.env'));
} catch {
  console.error('⚠️  Fichier activity/.env introuvable : copie .env.example en .env et remplis-le.');
  process.exit(1);
}
const manquantes = ['VITE_DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'DISCORD_BOT_TOKEN', 'BOT_API_SECRET', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']
  .filter((k) => !process.env[k]);
if (manquantes.length) console.warn(`⚠️  Vide dans activity/.env : ${manquantes.join(', ')}`);

/* ─── API : mêmes fichiers que sur Vercel ─── */
const ROUTES = ['token', 'state', 'action', 'staff', 'bot'];
const handlers = {};
for (const nom of ROUTES) handlers[nom] = (await import(pathToFileURL(path.join(ROOT, 'api', `${nom}.js`)).href)).default;

const MAX_BODY = 6 * 1024 * 1024;
function lireCorps(req) {
  return new Promise((ok, ko) => {
    let taille = 0;
    const morceaux = [];
    req.on('data', (c) => {
      taille += c.length;
      if (taille > MAX_BODY) {
        ko(Object.assign(new Error('Requête trop lourde.'), { status: 413 }));
        req.destroy();
      } else morceaux.push(c);
    });
    req.on('end', () => {
      const txt = Buffer.concat(morceaux).toString('utf8');
      try {
        ok(txt ? JSON.parse(txt) : {});
      } catch {
        ok({});
      }
    });
    req.on('error', ko);
  });
}

/** Imite l'objet réponse de Vercel : res.status(200).json({...}). */
function adapter(res) {
  res.status = (s) => ((res.statusCode = s), res);
  res.json = (b) => {
    if (!res.headersSent) res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(b));
    return res;
  };
  return res;
}

async function api(req, res, nom) {
  adapter(res);
  const url = new URL(req.url, 'http://local');
  req.query = Object.fromEntries(url.searchParams);
  try {
    req.body = req.method === 'GET' ? {} : await lireCorps(req);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
  await handlers[nom](req, res);
}

/* ─── Images : relayées depuis le stockage Supabase ─── */
async function media(req, res) {
  const chemin = req.url.split('?')[0].replace(/^\/media\//, '');
  if (!chemin || chemin.includes('..')) return void (res.statusCode = 404, res.end());
  const r = await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/public/media/${chemin}`).catch(() => null);
  if (!r?.ok) return void (res.statusCode = 404, res.end());
  res.setHeader('Content-Type', r.headers.get('content-type') || 'application/octet-stream');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.end(Buffer.from(await r.arrayBuffer()));
}

/* ─── Site : Vite en mode intégré (rechargement à chaud) ─── */
const { createServer } = await import('vite');
const serveur = http.createServer();
const vite = await createServer({
  root: ROOT,
  appType: 'spa',
  server: { middlewareMode: true, hmr: { server: serveur, clientPort: TUNNEL ? 443 : PORT } },
});

serveur.on('request', async (req, res) => {
  const p = req.url.split('?')[0];
  try {
    const m = /^\/api\/([a-z]+)\/?$/.exec(p);
    if (m && ROUTES.includes(m[1])) return await api(req, res, m[1]);
    if (p.startsWith('/media/')) return await media(req, res);
    vite.middlewares(req, res, () => {
      res.statusCode = 404;
      res.end('Introuvable');
    });
  } catch (err) {
    console.error(err);
    if (!res.headersSent) adapter(res).status(500).json({ error: 'Erreur interne.' });
  }
});

serveur.listen(PORT, () => {
  console.log(`🖥️  Site et API : http://localhost:${PORT}`);
  console.log(`🤖 Dans le .env du bot : API_URL=http://localhost:${PORT}`);
  if (!TUNNEL) console.log('ℹ️  Hors Discord, le site s’ouvre en mode démo. Pour Discord : npm run discord');
});

/* ─── Tunnel HTTPS pour Discord ─── */
if (TUNNEL) {
  const { Tunnel } = await import('cloudflared');
  const tunnel = Tunnel.quick(`http://localhost:${PORT}`);
  tunnel.once('url', (url) => {
    const host = url.replace(/^https?:\/\//, '');
    console.log(`
┌────────────────────────────────────────────────────────────────────┐
  🌐 Tunnel prêt : ${url}

  Developer Portal > Activities > URL Mappings, une seule ligne :
     PREFIX  /      TARGET  ${host}

  ⚠️  L'adresse change à chaque lancement : remets-la à jour à chaque fois.
└────────────────────────────────────────────────────────────────────┘`);
  });
  tunnel.on('exit', (code) => code && console.error(`❌ Le tunnel s'est arrêté (code ${code}). Pare-feu ou réseau qui bloque Cloudflare ?`));
  const stop = () => {
    tunnel.stop();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

if (!fs.existsSync(path.join(ROOT, 'node_modules'))) console.warn('⚠️  Lance d’abord : npm install');
