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
const KEY = 'op_rp_demo_v7';
let store;
function loadStore() {
  try {
    store = JSON.parse(localStorage.getItem(KEY));
  } catch {}
  if (!store?.player) {
    G.setCatalog(G.demoCatalog());
    store = {
      player: G.demoPlayer(), shops: { demo: G.demoShop() }, catalog: G.demoCatalog(), ships: G.demoShips(),
      crews: {
        'goeland-noir': G.demoCrew(),
        // un autre équipage qui invite le joueur de démo, pour tester les invitations
        'les-albatros': G.normalizeCrew({ name: 'Les Albatros', members: ['pnj-3'], captain: 'pnj-3', invites: [{ uid: 'demo', by: 'pnj-3', at: Date.now() }] }),
      },
    };
  }
  if (!store.shops) store.shops = { demo: store.shop ?? null };
  store.crews ??= {};
  store.ships ??= {};
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
/** Équipage du joueur de démo et bateaux visibles, comme le renvoie l'API. */
const DEMO_NAMES = { demo: null, 'pnj-1': 'Matelot (démo)', 'pnj-2': 'Recrue (démo)', 'pnj-3': 'Capitaine Albatros (démo)' };
const demoName = (u) => (u === 'demo' ? G.fullName(store.player) : DEMO_NAMES[u] || 'Joueur (démo)');
function demoCrewShips() {
  const p = store.player;
  const c = p.crewId ? G.normalizeCrew(store.crews[p.crewId]) : null;
  const crew = c ? { id: p.crewId, ...c, memberNames: Object.fromEntries([...c.members, ...c.invites.map((i) => i.uid)].map((u) => [u, demoName(u)])) } : null;
  const ships = Object.entries(store.ships)
    .filter(([, s]) => (s.owner?.kind === 'player' && s.owner.id === p.uid) || (s.owner?.kind === 'crew' && crew && s.owner.id === crew.id))
    .map(([id, s]) => ({ id, ...s }));
  const invites = Object.entries(store.crews).map(([id, raw]) => [id, G.normalizeCrew(raw)]).filter(([, cc]) => cc.invites.some((i) => i.uid === 'demo'))
    .map(([id, cc]) => ({ id, name: cc.name, flag: cc.flag, members: cc.members.length, by: cc.invites.find((i) => i.uid === 'demo').by, byName: demoName(cc.invites.find((i) => i.uid === 'demo').by) }));
  return { crew: structuredClone(crew), ships: structuredClone(ships), invites };
}
const demoState = () => ({
  ...demoCrewShips(),
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
    if (action.type === 'crew.search') {
      const q = (action.q || '').toLowerCase();
      return { results: [{ uid: 'pnj-2', name: demoName('pnj-2'), crew: null }].filter((x) => x.name.toLowerCase().includes(q)) };
    }
    if (action.type === 'crew.join' || action.type === 'crew.decline') {
      const out = G.inviteAction(store.player, action, { crew: { id: action.crewId, ...store.crews[action.crewId] } });
      const { id, ...data } = out.crew;
      store.crews[action.crewId] = data;
      if (out.previous && store.crews[out.previous]) {
        const o = G.normalizeCrew(store.crews[out.previous]);
        if (o.captain === 'demo' && o.members.length > 1) throw new Error(`Tu es capitaine de ${o.name} : cède d’abord ta place.`);
        o.members = o.members.filter((u) => u !== 'demo');
        store.crews[out.previous] = G.normalizeCrew(o);
      }
      store.player = out.player;
      saveStore();
      return { ...structuredClone(out), ...demoCrewShips() };
    }
    if (action.type.startsWith('crew.')) {
      const { crew } = demoCrewShips();
      if (!crew) throw new Error('Tu n’as pas d’équipage.');
      const out = G.crewAction(store.player, action, { crew, ships: Object.fromEntries(Object.entries(store.ships).map(([id, s]) => [id, { id, ...s }])) });
      const { id, memberNames, ...data } = out.crew;
      store.crews[id] = data;
      for (const [sid, sh] of Object.entries(out.ships || {})) {
        const { id: _i, ...rest } = sh;
        store.ships[sid] = rest;
      }
      store.player = out.player;
      saveStore();
      return { ...structuredClone(out), ...demoCrewShips() };
    }
    if (action.type === 'ship.edit') {
      const { crew } = demoCrewShips();
      const out = G.playerAction(store.player, action, { ship: store.ships[action.shipId], crew });
      store.ships[action.shipId] = out.ship;
      saveStore();
      return { ...structuredClone(out), ...demoCrewShips() };
    }
    const out = G.playerAction(store.player, action, { shop: store.shops.demo, channelId: 'demo' });
    store.player = out.player;
    if (out.shop) store.shops.demo = out.shop;
    if (out.newShip) {
      let id = G.slug(out.newShip.name);
      for (let n = 2; store.ships[id]; n++) id = `${G.slug(out.newShip.name)}-${n}`;
      store.ships[id] = out.newShip;
      out.toast = `${out.newShip.name} est à toi ! Donne-lui un nom dans « Équipage ».`;
    }
    saveStore();
    return { ...structuredClone(out), ...demoCrewShips() };
  }
  return call('POST', '/api/action', { channelId, action });
}

/** Outils du staff. */
export async function staff(op, payload = {}) {
  if (mode === 'demo') {
    if (op === 'players') return { players: [{ uid: 'demo', ident: store.player.id, level: store.player.level, photo: store.player.photo, job: store.player.job.id, crewId: store.player.crewId }] };
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
    if (op === 'item.save' || op === 'recipe.save') {
      const items = op === 'item.save', table = items ? store.catalog.items : store.catalog.recipes;
      G.setCatalog(store.catalog);
      const data = items ? G.normalizeItem(payload.item) : G.normalizeRecipe(payload.recipe);
      const label = items ? data.name : G.recipeLabel(data);
      let id = payload.id && table[payload.id] ? payload.id : G.slug(label);
      if (!payload.id) for (let n = 2; table[id]; n++) id = `${G.slug(label)}-${n}`;
      const isNew = !table[id];
      table[id] = data;
      saveStore();
      return { id, catalog: structuredClone(store.catalog), toast: `${items ? 'Objet' : 'Recette'} ${isNew ? 'créé' : 'modifié'}${items ? '' : 'e'} : ${label}` };
    }
    if (op === 'item.delete' || op === 'recipe.delete') {
      const items = op === 'item.delete';
      if (items) {
        const used = Object.values(store.catalog.recipes).filter((r) => r.needs[payload.id] || r.gives[payload.id]).map(G.recipeLabel);
        if (used.length) throw new Error(`Utilisé par la recette : ${used.join(', ')}. Modifie-la d’abord.`);
      }
      delete (items ? store.catalog.items : store.catalog.recipes)[payload.id];
      saveStore();
      return { catalog: structuredClone(store.catalog), toast: items ? 'Objet supprimé' : 'Recette supprimée' };
    }
    if (op === 'crews') return { crews: structuredClone(store.crews), ships: structuredClone(store.ships) };
    if (op === 'crew.save') {
      const id = payload.id && store.crews[payload.id] ? payload.id : G.slug(payload.crew.name);
      const old = store.crews[id];
      const crew = G.normalizeCrew({ ...(old || {}), ...payload.crew, chest: old?.chest ?? {} });
      if (crew.members.includes('demo')) store.player.crewId = id;
      else if (store.player.crewId === id) store.player.crewId = null;
      if (crew.ship && store.ships[crew.ship]) store.ships[crew.ship].owner = { kind: 'crew', id };
      store.crews[id] = crew;
      saveStore();
      return { id, crew, toast: `Équipage ${old ? 'modifié' : 'créé'} : ${crew.name}` };
    }
    if (op === 'crew.delete') {
      if (store.player.crewId === payload.id) store.player.crewId = null;
      for (const sh of Object.values(store.ships)) if (sh.owner?.kind === 'crew' && sh.owner.id === payload.id) sh.owner = null;
      delete store.crews[payload.id];
      saveStore();
      return { toast: 'Équipage supprimé' };
    }
    if (op === 'ship.save') {
      const id = payload.id && store.ships[payload.id] ? payload.id : G.slug(payload.ship.name);
      const { id: _i, ...input } = payload.ship;
      const ship = store.ships[id] ? G.normalizeShip({ ...store.ships[id], ...input }) : G.newShip(input);
      store.ships[id] = ship;
      saveStore();
      return { id, ship, toast: `Bateau enregistré : ${ship.name}` };
    }
    if (op === 'ship.delete') {
      for (const c of Object.values(store.crews)) if (c.ship === payload.id) c.ship = null;
      delete store.ships[payload.id];
      saveStore();
      return { toast: 'Bateau supprimé' };
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
    throw new Error(`Opération inconnue en démo : ${op}`);
  }
  return call('POST', '/api/staff', { op, channelId, ...payload });
}

