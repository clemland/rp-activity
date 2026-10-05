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
    store = { player: G.demoPlayer(), shop: G.demoShop(), catalog: G.demoCatalog() };
  }
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
  player: structuredClone(store.player), shop: structuredClone(store.shop), catalog: structuredClone(store.catalog),
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
    const out = G.playerAction(store.player, action, { shop: store.shop, channelId: 'demo' });
    store.player = out.player;
    if (out.shop) store.shop = out.shop;
    saveStore();
    return structuredClone(out);
  }
  return call('POST', '/api/action', { channelId, action });
}

/** Outils du staff. */
export async function staff(op, payload = {}) {
  if (mode === 'demo') {
    if (op === 'players') return { players: [{ uid: 'demo', ident: store.player.id, level: store.player.level, photo: store.player.photo }] };
    if (op === 'act') {
      const out = G.staffAction(store.player, payload.action);
      store.player = out.player;
      saveStore();
      return structuredClone(out);
    }
    if (op === 'shop.save') {
      store.shop = G.normalizeShop(structuredClone(payload.shop));
      saveStore();
      return { shop: structuredClone(store.shop), toast: 'Boutique mise à jour' };
    }
    if (op === 'item.save' || op === 'recipe.save') {
      const items = op === 'item.save', table = items ? store.catalog.items : store.catalog.recipes;
      G.setCatalog(store.catalog);
      const data = items ? G.normalizeItem(payload.item) : G.normalizeRecipe(payload.recipe);
      let id = payload.id && table[payload.id] ? payload.id : G.slug(data.name);
      if (!payload.id) for (let n = 2; table[id]; n++) id = `${G.slug(data.name)}-${n}`;
      const isNew = !table[id];
      table[id] = data;
      saveStore();
      return { id, catalog: structuredClone(store.catalog), toast: `${items ? 'Objet' : 'Recette'} ${isNew ? 'créé' : 'modifié'}${items ? '' : 'e'} : ${data.name}` };
    }
    if (op === 'item.delete' || op === 'recipe.delete') {
      const items = op === 'item.delete';
      if (items) {
        const used = Object.values(store.catalog.recipes).filter((r) => r.needs[payload.id] || r.gives[payload.id]).map((r) => r.name);
        if (used.length) throw new Error(`Utilisé par la recette : ${used.join(', ')}. Modifie-la d’abord.`);
      }
      delete (items ? store.catalog.items : store.catalog.recipes)[payload.id];
      saveStore();
      return { catalog: structuredClone(store.catalog), toast: items ? 'Objet supprimé' : 'Recette supprimée' };
    }
    if (op === 'shop.delete') {
      store.shop = null;
      saveStore();
      return { shop: null, toast: 'Boutique fermée' };
    }
  }
  return call('POST', '/api/staff', { op, ...payload, channelId });
}

