/**
 * Teste les fonctions de l'API avec une fausse base Supabase (en mémoire)
 * et un faux Discord. Lancer : node --test --experimental-test-module-mocks test/api.test.js
 */
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

/* ─── Fausse base Supabase ─── */
const tables = { players: new Map(), shops: new Map(), items: new Map(), recipes: new Map(), meta: new Map() };
const keyOf = { players: 'id', shops: 'channel_id', items: 'id', recipes: 'id', meta: 'key' };
function query(table) {
  const q = { filters: [], op: 'select', payload: null };
  const rows = () => [...tables[table].values()].filter((r) => q.filters.every(([k, v]) => r[k] === v));
  const api = {
    select: () => api, order: () => api, limit: () => api,
    eq: (k, v) => (q.filters.push([k, v]), api),
    insert: (row) => {
      const id = row[keyOf[table]];
      if (tables[table].has(id)) return Promise.resolve({ error: { code: '23505' } });
      tables[table].set(id, { ...row });
      return Promise.resolve({ error: null });
    },
    update: (patch) => ((q.op = 'update'), (q.payload = patch), api),
    delete: () => ((q.op = 'delete'), api),
    maybeSingle: async () => ({ data: rows()[0] ? structuredClone(rows()[0]) : null, error: null }),
    then: (ok, ko) => {
      let res;
      if (q.op === 'update') {
        const hit = rows();
        hit.forEach((r) => Object.assign(r, q.payload));
        res = { data: hit.map((r) => ({ version: r.version })), error: null };
      } else if (q.op === 'delete') {
        rows().forEach((r) => tables[table].delete(r[keyOf[table]]));
        res = { error: null };
      } else res = { data: rows().map((r) => ({ id: r.id, key: r.key, channel_id: r.channel_id, data: r.data, ident: r.data?.id, level: r.data?.level, photo: r.data?.photo })), error: null };
      return Promise.resolve(res).then(ok, ko);
    },
  };
  return api;
}
const uploads = [];
mock.module('@supabase/supabase-js', {
  namedExports: {
    createClient: () => ({ from: query, storage: { from: () => ({ upload: async (path) => (uploads.push(path), { error: null }) }) } }),
  },
});

/* ─── Faux Discord ─── */
process.env.SUPABASE_URL = 'http://fake';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
process.env.DISCORD_BOT_TOKEN = 'bot';
process.env.GUILD_ID = 'g1';
process.env.STAFF_ROLE_IDS = 'role-mj';
process.env.BOT_API_SECRET = 'secret';
const USERS = { 'tok-joueur': { id: 'u1', username: 'joueur' }, 'tok-mj': { id: 'u2', username: 'mj' } };
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  const json = (b, status = 200) => ({ ok: status < 400, status, json: async () => b, headers: new Map() });
  if (u.endsWith('/users/@me')) {
    const t = (opts.headers?.Authorization || '').replace('Bearer ', '');
    return USERS[t] ? json(USERS[t]) : json({}, 401);
  }
  if (u.includes('/guilds/g1/members/u2')) return json({ roles: ['role-mj'] });
  if (u.includes('/guilds/g1/members/')) return json({ roles: [] });
  if (u.endsWith('/guilds/g1')) return json({ owner_id: 'owner' });
  if (u.endsWith('/guilds/g1/roles')) return json([]);
  if (u.includes('/channels/')) return json({ name: 'port-brisant' });
  return json({}, 404);
};

const call = async (mod, { method = 'POST', body = {}, query = {}, headers = {} } = {}) => {
  const { default: handler } = await import(`../api/${mod}.js`);
  let status = 0, out;
  const res = { setHeader() {}, status: (s) => ((status = s), res), json: (b) => ((out = b), res) };
  await handler({ method, body, query, headers }, res);
  return { status, out };
};
const J = { authorization: 'Bearer tok-joueur' }, MJ = { authorization: 'Bearer tok-mj' };


const BOT = { 'x-bot-secret': 'secret' };

test('sans fiche : l’app reçoit player null, pas d’erreur', async () => {
  const r = await call('state', { method: 'GET', query: { channel: 'c1' }, headers: J });
  assert.equal(r.status, 200, JSON.stringify(r.out));
  assert.equal(r.out.player, null);
  assert.equal(r.out.me.staff, false);
  assert.deepEqual(r.out.catalog, { items: {}, recipes: {} });
  const a = await call('action', { body: { channelId: 'c1', action: { type: 'stats', alloc: { force: 1 } } }, headers: J });
  assert.equal(a.status, 404);
  assert.match(a.out.error, /register/);
});

test('/register par le bot : fiche créée, impossible deux fois', async () => {
  let r = await call('bot', { body: { op: 'register', userId: 'u1', name: 'Monkey D. Lucien', race: 'Mink', job: 'medecin', classe: 'Fighter', by: 'u2' }, headers: BOT });
  assert.equal(r.status, 200, JSON.stringify(r.out));
  assert.equal(r.out.player.id.name, 'Monkey D. Lucien');
  r = await call('bot', { body: { op: 'register', userId: 'u1', name: 'X', race: 'Mink', classe: 'Fighter' }, headers: BOT });
  assert.equal(r.status, 409);
  r = await call('bot', { body: { op: 'register', userId: 'u3', name: 'X', race: 'Elfe', classe: 'Fighter' }, headers: BOT });
  assert.equal(r.status, 400);
  r = await call('bot', { body: { op: 'register', userId: 'u1' }, headers: { 'x-bot-secret': 'faux' } });
  assert.equal(r.status, 401);
});

test('un joueur ne peut pas utiliser les outils staff', async () => {
  const r = await call('staff', { body: { op: 'item.save', item: { name: 'Triche', value: 1e9 } }, headers: J });
  assert.equal(r.status, 403);
});

test('le staff crée des objets et une recette ; identifiants uniques', async () => {
  let r = await call('staff', { body: { op: 'item.save', item: { name: 'Planche de chêne', kind: 'mat', value: 300 } }, headers: MJ });
  assert.equal(r.status, 200, JSON.stringify(r.out));
  assert.equal(r.out.id, 'planche-de-chene');
  r = await call('staff', { body: { op: 'item.save', item: { name: 'Planche de chêne', kind: 'mat', value: 500 } }, headers: MJ });
  assert.equal(r.out.id, 'planche-de-chene-2');
  await call('staff', { body: { op: 'item.save', item: { name: 'Coffre', kind: 'objet', value: 2000 } }, headers: MJ });
  r = await call('staff', { body: { op: 'recipe.save', recipe: { name: 'Fabriquer un coffre', job: 'medecin', lvl: 1, seconds: 3600, needs: { 'planche-de-chene': 2 }, gives: { coffre: 1 } } }, headers: MJ });
  assert.equal(r.status, 200, JSON.stringify(r.out));
  assert.equal(r.out.catalog.recipes['fabriquer-un-coffre'].seconds, 3600);
  r = await call('staff', { body: { op: 'item.delete', id: 'coffre' }, headers: MJ });
  assert.equal(r.status, 400, 'objet utilisé par une recette');
  assert.match(r.out.error, /Fabriquer un coffre/);
});

test('fabrication : lancée, pas encore prête, puis terminée par le staff et récupérée', async () => {
  await call('staff', { body: { op: 'act', target: 'u1', action: { type: 'give', key: 'planche-de-chene', qty: 3 } }, headers: MJ });
  let r = await call('action', { body: { action: { type: 'craft.start', id: 'fabriquer-un-coffre' } }, headers: J });
  assert.equal(r.status, 200, JSON.stringify(r.out));
  assert.ok(r.out.player.craft);
  r = await call('action', { body: { action: { type: 'craft.collect' } }, headers: J });
  assert.equal(r.status, 400);
  assert.match(r.out.error, /patience/);
  await call('staff', { body: { op: 'act', target: 'u1', action: { type: 'craft.finish' } }, headers: MJ });
  r = await call('action', { body: { action: { type: 'craft.collect' } }, headers: J });
  assert.equal(r.status, 200, JSON.stringify(r.out));
  assert.ok(r.out.player.inv.some((s) => s && s[0] === 'coffre'));
});

test('boutique avec les objets du staff', async () => {
  let r = await call('staff', { body: { op: 'shop.save', channelId: 'c1', shop: { name: 'Comptoir', seller: 'Rosa', items: [['coffre', 100, 2], ['inexistant', 5, 1]], buyRate: 0.4 } }, headers: MJ });
  assert.equal(r.status, 200, JSON.stringify(r.out));
  assert.deepEqual(r.out.shop.items, [['coffre', 100, 2]], 'objets inconnus retirés');
  await call('staff', { body: { op: 'act', target: 'u1', action: { type: 'edit', patch: { berry: 1000 } } }, headers: MJ });
  r = await call('action', { body: { channelId: 'c1', action: { type: 'shop.buy', key: 'coffre' } }, headers: J });
  assert.equal(r.status, 200, JSON.stringify(r.out));
  assert.equal(r.out.player.berry, 900);
});

test('/edit profil : ouverture une seule fois, refus signalé pour un non-staff, joueur sans fiche refusé', async () => {
  let r = await call('bot', { body: { op: 'open', userId: 'u2', mode: 'edit', target: 'u1' }, headers: BOT });
  assert.equal(r.status, 200, JSON.stringify(r.out));
  r = await call('state', { method: 'GET', query: { channel: 'c1' }, headers: MJ });
  assert.deepEqual(r.out.open, { mode: 'edit', target: 'u1' });
  assert.equal(r.out.player, null, 'le MJ peut ne pas avoir de fiche');
  r = await call('state', { method: 'GET', query: { channel: 'c1' }, headers: MJ });
  assert.equal(r.out.open, null);
  await call('bot', { body: { op: 'open', userId: 'u1', mode: 'admin' }, headers: BOT });
  r = await call('state', { method: 'GET', query: { channel: 'c1' }, headers: J });
  assert.equal(r.out.openDenied, true);
  r = await call('bot', { body: { op: 'open', userId: 'u2', mode: 'edit', target: 'personne' }, headers: BOT });
  assert.equal(r.status, 404);
  r = await call('state', { method: 'GET', query: { player: 'u1' }, headers: MJ });
  assert.equal(r.out.player.id.name, 'Monkey D. Lucien');
});

test('photo envoyée : stockée dans le bucket, chemin /media enregistré', async () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const r = await call('action', { body: { action: { type: 'photo.set', photo: png } }, headers: J });
  assert.equal(r.status, 200, JSON.stringify(r.out));
  assert.match(r.out.player.photo, /^\/media\/photos\/u1-/);
});

test('écriture concurrente : la version empêche d’écraser', async () => {
  const { read, write, Conflict } = await import('../api/_lib/db.js');
  const row = await read('players', 'u1');
  await write('players', 'u1', row.data, row.version);
  await assert.rejects(write('players', 'u1', row.data, row.version), Conflict);
});

test('/delete profil : fiche supprimée, puis le joueur n’a plus de fiche', async () => {
  const H = { 'x-bot-secret': 'secret' };
  await call('bot', { body: { op: 'register', userId: 'u7', name: 'À supprimer', race: 'Géant', classe: 'Fighter' }, headers: H });
  let r = await call('bot', { body: { op: 'delete', userId: 'u7', by: 'u2' }, headers: H });
  assert.equal(r.status, 200, JSON.stringify(r.out));
  assert.equal(r.out.name, 'À supprimer');
  r = await call('bot', { body: { op: 'delete', userId: 'u7' }, headers: H });
  assert.equal(r.status, 404);
  r = await call('bot', { body: { op: 'delete', userId: 'u1' }, headers: { 'x-bot-secret': 'faux' } });
  assert.equal(r.status, 401);
});

test('/panel admin : ouverture en mode admin, sans joueur', async () => {
  let r = await call('bot', { body: { op: 'open', userId: 'u2', mode: 'admin' }, headers: { 'x-bot-secret': 'secret' } });
  assert.equal(r.status, 200, JSON.stringify(r.out));
  r = await call('state', { method: 'GET', query: { channel: 'c1' }, headers: MJ });
  assert.deepEqual(r.out.open, { mode: 'admin', target: null });
});

test('anti-triche : le staff ne peut pas modifier sa propre fiche', async () => {
  await call('bot', { body: { op: 'register', userId: 'u2', name: 'Le MJ', race: 'Humain', classe: 'Fighter' }, headers: { 'x-bot-secret': 'secret' } });
  const r = await call('staff', { body: { op: 'act', target: 'u2', action: { type: 'edit', patch: { berry: 999999999 } } }, headers: MJ });
  assert.equal(r.status, 403);
  assert.match(r.out.error, /propre fiche/);
});
