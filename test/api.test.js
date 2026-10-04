/**
 * Teste les fonctions de l'API avec une fausse base Supabase (en mémoire)
 * et un faux Discord. Lancer : node --test --experimental-test-module-mocks test/api.test.js
 */
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

/* ─── Fausse base Supabase ─── */
const tables = { players: new Map(), shops: new Map(), navs: new Map() };
const keyOf = { players: 'id', shops: 'channel_id', navs: 'channel_id' };
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
      } else res = { data: rows().map((r) => ({ id: r.id, channel_id: r.channel_id, ident: r.data?.id, level: r.data?.level, photo: r.data?.photo })), error: null };
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

test('première ouverture : fiche vierge créée, pas staff', async () => {
  const r = await call('state', { method: 'GET', query: { channel: 'c1' }, headers: J });
  assert.equal(r.status, 200);
  assert.equal(r.out.me.staff, false);
  assert.equal(r.out.player.id.first, 'joueur');
  assert.equal(r.out.shop, null);
  assert.equal(r.out.channelName, 'port-brisant');
  assert.ok(tables.players.has('u1'));
});

test('sans jeton : refusé', async () => {
  const r = await call('state', { method: 'GET', headers: {} });
  assert.equal(r.status, 401);
});

test('un joueur ne peut pas utiliser les outils staff', async () => {
  const r = await call('staff', { body: { op: 'players' }, headers: J });
  assert.equal(r.status, 403);
});

test('le staff crée une boutique, le joueur achète', async () => {
  const shop = { name: 'Comptoir', seller: 'Rosa', items: [['rhum', 100, 2]], buyRate: 0.4 };
  let r = await call('staff', { body: { op: 'shop.save', channelId: 'c1', shop }, headers: MJ });
  assert.equal(r.status, 200, JSON.stringify(r.out));
  r = await call('action', { body: { channelId: 'c1', action: { type: 'shop.buy', key: 'rhum' } }, headers: J });
  assert.equal(r.status, 200, JSON.stringify(r.out));
  assert.equal(r.out.player.berry, 900);
  assert.equal(tables.shops.get('c1').data.items[0][2], 1);
  r = await call('action', { body: { channelId: 'c1', action: { type: 'shop.buy', key: 'katana' } }, headers: J });
  assert.equal(r.status, 400);
  assert.match(r.out.error, /pas vendu/);
});

test('le staff modifie la fiche du joueur et lui donne un objet', async () => {
  let r = await call('staff', { body: { op: 'act', target: 'u1', action: { type: 'edit', patch: { volonte: 3, haki: { observation: 2 } } } }, headers: MJ });
  assert.equal(r.status, 200, JSON.stringify(r.out));
  assert.equal(r.out.player.volonte, 3);
  r = await call('staff', { body: { op: 'act', target: 'u1', action: { type: 'give', key: 'sabre', qty: 1 } }, headers: MJ });
  assert.equal(r.out.player.inv.filter(Boolean).length, 2);
  const list = await call('staff', { body: { op: 'players' }, headers: MJ });
  assert.ok(list.out.players.some((p) => p.uid === 'u1'));
});

test('navigation : lever l’ancre, message RP via le bot, cooldown', async () => {
  let r = await call('action', { body: { channelId: 'c1', action: { type: 'nav.toggle' } }, headers: J });
  assert.equal(r.out.nav.active, true);
  r = await call('bot', { body: { op: 'channels' }, headers: { 'x-bot-secret': 'secret' } });
  assert.deepEqual(r.out.channels, ['c1']);
  r = await call('bot', { body: { op: 'channels' }, headers: { 'x-bot-secret': 'faux' } });
  assert.equal(r.status, 401);
  r = await call('bot', { body: { op: 'message', channelId: 'c1', userId: 'u1', name: 'joueur' }, headers: { 'x-bot-secret': 'secret' } });
  assert.equal(r.status, 200, JSON.stringify(r.out));
  assert.equal(r.out.counted, true);
  r = await call('bot', { body: { op: 'message', channelId: 'c1', userId: 'u1' }, headers: { 'x-bot-secret': 'secret' } });
  assert.equal(r.out.counted, false, 'cooldown de 30 s');
});

test('navigation : un événement à choix se résout une seule fois, par son joueur', async () => {
  // On force un événement à choix dans le journal.
  const nav = tables.navs.get('c1');
  nav.data.log.push({ t: 'ev', id: 'ev1', ev: 'tempete', uid: 'u1', name: 'joueur', at: 1 });
  let r = await call('bot', { body: { op: 'choose', channelId: 'c1', userId: 'u2', entryId: 'ev1', choice: 1 }, headers: { 'x-bot-secret': 'secret' } });
  assert.equal(r.status, 400);
  r = await call('bot', { body: { op: 'choose', channelId: 'c1', userId: 'u1', entryId: 'ev1', choice: 1 }, headers: { 'x-bot-secret': 'secret' } });
  assert.equal(r.status, 200, JSON.stringify(r.out));
  assert.match(r.out.event.result, /abri/);
  r = await call('action', { body: { channelId: 'c1', action: { type: 'nav.choose', entryId: 'ev1', choice: 0 } }, headers: J });
  assert.equal(r.status, 400);
});

test('photo envoyée : stockée dans le bucket, chemin /media enregistré', async () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const r = await call('action', { body: { channelId: 'c1', action: { type: 'photo.set', photo: png } }, headers: J });
  assert.equal(r.status, 200, JSON.stringify(r.out));
  assert.match(r.out.player.photo, /^\/media\/photos\/u1-/);
  assert.equal(uploads.length, 1);
});

test('écriture concurrente : la version empêche d’écraser', async () => {
  const { read, write, Conflict } = await import('../api/_lib/db.js');
  const row = await read('players', 'u1');
  await write('players', 'u1', row.data, row.version);
  await assert.rejects(write('players', 'u1', row.data, row.version), Conflict);
});
