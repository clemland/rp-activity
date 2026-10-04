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
const KEY = 'op_rp_demo_v4';
let store;
function loadStore() {
  try {
    store = JSON.parse(localStorage.getItem(KEY));
  } catch {}
  if (!store?.player) store = { player: G.demoPlayer(), shop: G.demoShop(), nav: G.newNav() };
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
  me: { uid: 'demo', name: 'Démo', staff: true },
  player: structuredClone(store.player), shop: structuredClone(store.shop), nav: structuredClone(store.nav),
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
    const out = G.playerAction(store.player, action, { shop: store.shop, nav: store.nav, channelId: 'demo' });
    store.player = out.player;
    if (out.shop) store.shop = out.shop;
    if (out.nav) store.nav = out.nav;
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
    if (op === 'shop.delete') {
      store.shop = null;
      saveStore();
      return { shop: null, toast: 'Boutique fermée' };
    }
  }
  return call('POST', '/api/staff', { op, ...payload, channelId });
}

/** Démo seulement : simule un message RP dans le salon (sur Discord, c'est le bot). */
export function demoMessage(text) {
  store.nav.log.push({ t: 'msg', at: Date.now(), text: String(text).slice(0, 400), name: G.fullName(store.player) });
  const r = G.navMessage(store.player, store.nav, { ignoreCooldown: true });
  store.player = r.player;
  store.nav = r.nav;
  if (!r.entry) store.nav.log.push({ t: 'sys', at: Date.now(), text: `+${G.NAV_XP} XP · rien à signaler` });
  saveStore();
  return { player: structuredClone(r.player), nav: structuredClone(r.nav), ups: r.ups };
}
