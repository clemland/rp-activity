/**
 * Accès aux données. Dans Discord : l'API Vercel. Hors Discord : un mode démo
 * qui applique les mêmes règles (shared/game.js) dans le navigateur.
 */
import * as G from '../shared/game.js';
import { inDiscord, connect } from './discord.js';

let token = null;
export let mode = 'demo';
export let channelId = null;

async function call(method, path, body) {
  const r = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Erreur du serveur.');
  return data;
}

/* ─── Mode démo : tout reste dans ce navigateur ─── */
const KEY = 'op_rp_demo_v5';
let store;
function loadStore() {
  try {
    store = JSON.parse(localStorage.getItem(KEY));
  } catch {}
  if (!store?.player) {
    G.setCatalog(G.demoCatalog());
    store = { player: G.demoPlayer(), shops: { demo: G.demoShop() }, catalog: G.demoCatalog() };
  }
  if (!store.shops) store.shops = { demo: store.shop ?? null };
  delete store.shop;
  G.setCatalog(store.catalog);
  G.normalize(store.player);
}
const saveStore = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {}
};
export function resetDemo() {
  localStorage.removeItem(KEY);
  loadStore();
}
const demoState = () => ({
  me: { uid: 'mj-demo', name: 'Démo', staff: true }, // le MJ de la démo n'est pas le joueur, pour pouvoir tester l'édition
  player: structuredClone(store.player), shop: structuredClone(store.shops.demo ?? null), catalog: structuredClone(store.catalog),
  channelId: 'demo', channelName: 'port-brisant',
});

/* ─── Interface commune ─── */
export async function boot() {
  if (inDiscord()) {
    const c = await connect();
    token = c.token;
    channelId = c.channelId;
    mode = 'discord';
    return state();
  }
  loadStore();
  channelId = 'demo';
  return demoState();
}

/** État complet ; le staff peut demander la fiche d'un autre joueur. */
export async function state(playerId) {
  if (mode === 'demo') return demoState();
  const q = new URLSearchParams({ channel: channelId || '' });
  if (playerId) q.set('player', playerId);
  return call('GET', `/api/state?${q}`);
}

/** Action du joueur sur sa propre fiche. */
export async function act(action) {
  if (mode === 'demo') {
    G.setCatalog(store.catalog);
    const out = G.playerAction(store.player, action, { shop: store.shops.demo, channelId: 'demo' });
    store.player = out.player;
    if (out.shop) store.shops.demo = out.shop;
    saveStore();
    return structuredClone(out);
  }
  return call('POST', '/api/action', { channelId, action });
}

/** Outils du staff. */
export async function staff(op, payload = {}) {
  if (mode === 'demo') {
    if (op === 'players') return { players: [{ uid: 'demo', ident: store.player.id, level: store.player.level, photo: store.player.photo, job: store.player.job.id }] };
    if (op === 'act') {
      const out = G.staffAction(store.player, payload.action);
      store.player = out.player;
      saveStore();
      return structuredClone(out);
    }
    if (op === 'bulk') {
      let ok = 0;
      const failed = [];
      for (const uid of payload.targets) {
        try {
          if (uid !== 'demo') throw new Error('pas de fiche');
          store.player = G.staffAction(store.player, payload.action).player;
          ok++;
        } catch (err) {
          failed.push({ uid, error: err.message });
        }
      }
      saveStore();
      return { ok, failed, toast: `Appliqué à ${ok} joueur${ok > 1 ? 's' : ''}` };
    }
    if (op === 'shops') return { shops: structuredClone(Object.fromEntries(Object.entries(store.shops).filter(([, v]) => v))) };
    if (op === 'shop.save') {
      const id = String(payload.channelId);
      if (payload.from && payload.from !== id && store.shops[id]) throw new Error('Il y a déjà une boutique dans ce salon.');
      const shop = G.normalizeShop(structuredClone(payload.shop));
      shop.channel = id === 'demo' ? '#port-brisant' : `#salon-${id.slice(-4)}`;
      store.shops[id] = shop;
      if (payload.from && payload.from !== id) delete store.shops[payload.from];
      saveStore();
      return { channelId: id, shop: structuredClone(shop), toast: 'Boutique enregistrée' };
    }
    if (op === 'shop.delete') {
      delete store.shops[payload.channelId];
      saveStore();
      return { shop: null, toast: 'Boutique fermée' };
    }
  }
  return call('POST', '/api/staff', { op, channelId, ...payload });
}

