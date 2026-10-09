/**
 * Teste les fonctions de l'API avec une fausse base Supabase (en mémoire)
 * et un faux Discord. Lancer : node --test --experimental-test-module-mocks test/api.test.js
 */
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

/* ─── Fausse base Supabase ─── */
const tables = { players: new Map(), shops: new Map(), items: new Map(), recipes: new Map(), meta: new Map(), crews: new Map(), ships: new Map() };
const keyOf = { players: 'id', shops: 'channel_id', items: 'id', recipes: 'id', meta: 'key', crews: 'id', ships: 'id' };
function query(table) {
  const q = { filters: [], op: 'select', payload: null };
  const rows = () => [...tables[table].values()].filter((r) => q.filters.every(([k, v, inList]) => (inList ? v.includes(r[k]) : r[k] === v)));
  const api = {
    select: () => api, order: () => api, limit: () => api,
    eq: (k, v) => (q.filters.push([k, v]), api),
    in: (k, vals) => (q.filters.push([k, vals, true]), api),
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
      } else res = { data: rows().map((r) => ({ id: r.id, key: r.key, channel_id: r.channel_id, data: r.data, version: r.version, ident: r.data?.id, level: r.data?.level, photo: r.data?.photo, job: r.data?.job, crewId: r.data?.crewId })), error: null };
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
let USERS = { 'tok-joueur': { id: 'u1', username: 'joueur' }, 'tok-mj': { id: 'u2', username: 'mj' } };
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
  if (u.includes('/channels/111111111111111111')) return json({ id: '111111111111111111', name: 'port-brisant', guild_id: 'g1' });
  if (u.includes('/channels/222222222222222222')) return json({ id: '222222222222222222', name: 'île-aux-forges', guild_id: 'g1' });
  if (u.includes('/channels/333333333333333333')) return json({ id: '333333333333333333', name: 'autre-serveur', guild_id: 'autre' });
  if (u.includes('/channels/')) return json({}, 404);
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
  r = await call('staff', { body: { op: 'recipe.save', recipe: { job: 'medecin', lvl: 1, seconds: 3600, needs: { 'planche-de-chene': 2 }, gives: { coffre: 1 } } }, headers: MJ });
  assert.equal(r.status, 200, JSON.stringify(r.out));
  assert.equal(r.out.catalog.recipes['1-coffre'].seconds, 3600);
  r = await call('staff', { body: { op: 'item.delete', id: 'coffre' }, headers: MJ });
  assert.equal(r.status, 400, 'objet utilisé par une recette');
  assert.match(r.out.error, /1 × Coffre/);
});

test('fabrication : lancée, pas encore prête, puis terminée par le staff et récupérée', async () => {
  await call('staff', { body: { op: 'act', target: 'u1', action: { type: 'give', key: 'planche-de-chene', qty: 3 } }, headers: MJ });
  let r = await call('action', { body: { action: { type: 'craft.start', id: '1-coffre' } }, headers: J });
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
  const C1 = '111111111111111111';
  let r = await call('staff', { body: { op: 'shop.save', channelId: C1, shop: { name: 'Comptoir', seller: 'Rosa', items: [['coffre', 100, 2], ['inexistant', 5, 1]], buyRate: 0.4 } }, headers: MJ });
  assert.equal(r.status, 200, JSON.stringify(r.out));
  assert.deepEqual(r.out.shop.items, [['coffre', 100, 2]], 'objets inconnus retirés');
  assert.equal(r.out.shop.channel, '#port-brisant', 'nom retrouvé à partir de l’ID');
  await call('staff', { body: { op: 'act', target: 'u1', action: { type: 'edit', patch: { berry: 1000 } } }, headers: MJ });
  // u1 n'a encore écrit nulle part : pas de boutique
  r = await call('action', { body: { action: { type: 'shop.buy', key: 'coffre' } }, headers: J });
  assert.equal(r.status, 400);
  // il écrit un message RP dans ce salon : c'est sa position
  await call('bot', { body: { op: 'rp.message', userId: 'u1', channelId: C1, name: 'port-brisant', length: 500 }, headers: BOT });
  r = await call('action', { body: { action: { type: 'shop.buy', key: 'coffre' } }, headers: J });
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

test('panneau admin : le staff peut modifier sa propre fiche', async () => {
  await call('bot', { body: { op: 'register', userId: 'u2', name: 'Le MJ', race: 'Humain', classe: 'Fighter' }, headers: { 'x-bot-secret': 'secret' } });
  const r = await call('staff', { body: { op: 'act', target: 'u2', action: { type: 'levels', amount: 3 } }, headers: MJ });
  assert.equal(r.status, 200, JSON.stringify(r.out));
  assert.equal(r.out.player.level, 4);
});

test('actions en groupe : XP à plusieurs joueurs, échecs signalés sans bloquer les autres', async () => {
  let r = await call('staff', { body: { op: 'bulk', targets: ['u1', 'u2', 'fantome'], action: { type: 'xp', amount: 100 } }, headers: MJ });
  assert.equal(r.status, 200, JSON.stringify(r.out));
  assert.equal(r.out.ok, 2);
  assert.deepEqual(r.out.failed.map((f) => f.uid), ['fantome']);
  assert.match(r.out.toast, /2 joueurs, 1 échec/);
  r = await call('staff', { body: { op: 'bulk', targets: ['u1'], action: { type: 'edit', patch: { berry: 1 } } }, headers: MJ });
  assert.equal(r.status, 400, 'pas d’édition libre en groupe');
  r = await call('staff', { body: { op: 'bulk', targets: ['u1'], action: { type: 'xp', amount: 5 } }, headers: J });
  assert.equal(r.status, 403);
});

test('boutiques par ID de salon : ID inconnu, autre serveur, déplacement, liste', async () => {
  const shop = { name: 'Forge', seller: 'Brann', items: [], buyRate: 0.5 };
  let r = await call('staff', { body: { op: 'shop.save', channelId: '999999999999999999', shop }, headers: MJ });
  assert.equal(r.status, 400);
  assert.match(r.out.error, /introuvable/);
  r = await call('staff', { body: { op: 'shop.save', channelId: 'pas-un-id', shop }, headers: MJ });
  assert.equal(r.status, 400);
  r = await call('staff', { body: { op: 'shop.save', channelId: '333333333333333333', shop }, headers: MJ });
  assert.equal(r.status, 400);
  assert.match(r.out.error, /serveur principal/);
  r = await call('staff', { body: { op: 'shop.save', channelId: '111111111111111111', from: 'ancien', shop }, headers: MJ });
  assert.equal(r.status, 409, 'déjà une boutique dans ce salon');
  await call('staff', { body: { op: 'shop.save', channelId: '222222222222222222', shop }, headers: MJ });
  r = await call('staff', { body: { op: 'shops' }, headers: MJ });
  assert.deepEqual(Object.keys(r.out.shops).sort(), ['111111111111111111', '222222222222222222']);
  assert.equal(r.out.shops['222222222222222222'].channel, '#île-aux-forges');
});

test('équipage : création par le staff, membres synchronisés, changement d’équipage', async () => {
  const H = { 'x-bot-secret': 'secret' };
  await call('bot', { body: { op: 'register', userId: 'u8', name: 'Zoro Bis', race: 'Humain', classe: 'Sabreur' }, headers: H });
  let r = await call('staff', { body: { op: 'crew.save', crew: { name: 'Les Mouettes', captain: 'u1', members: ['u1', 'u8'], bank: 500 } }, headers: MJ });
  assert.equal(r.status, 200, JSON.stringify(r.out));
  assert.equal(r.out.id, 'les-mouettes');
  assert.equal(tables.players.get('u1').data.crewId, 'les-mouettes');
  r = await call('state', { method: 'GET', query: {}, headers: J });
  assert.equal(r.out.crew.name, 'Les Mouettes');
  assert.equal(r.out.crew.memberNames.u8, 'Zoro Bis');
  // u8 passe dans un autre équipage : il quitte le premier
  await call('staff', { body: { op: 'crew.save', crew: { name: 'Les Albatros', members: ['u8'] } }, headers: MJ });
  assert.deepEqual(tables.crews.get('les-mouettes').data.members, ['u1']);
  assert.equal(tables.players.get('u8').data.crewId, 'les-albatros');
  // retiré de l'équipage : plus de crewId
  await call('staff', { body: { op: 'crew.save', id: 'les-albatros', crew: { members: [] } }, headers: MJ });
  assert.equal(tables.players.get('u8').data.crewId, null);
});

test('équipage : banque et coffre par les joueurs, retrait d’argent réservé au capitaine', async () => {
  await call('staff', { body: { op: 'item.save', item: { name: 'Corde', kind: 'mat', value: 10, weight: 30 } }, headers: MJ });
  await call('staff', { body: { op: 'act', target: 'u1', action: { type: 'give', key: 'corde', qty: 4 } }, headers: MJ });
  let r = await call('action', { body: { action: { type: 'crew.bank.deposit', amount: 100 } }, headers: J });
  assert.equal(r.status, 200, JSON.stringify(r.out));
  assert.equal(r.out.crew.bank, 600);
  r = await call('action', { body: { action: { type: 'crew.chest.deposit', key: 'corde', qty: 3 } }, headers: J });
  assert.equal(r.status, 200, JSON.stringify(r.out));
  r = await call('action', { body: { action: { type: 'crew.chest.deposit', key: 'corde', qty: 1 } }, headers: J });
  assert.equal(r.status, 400, 'coffre de 100 kg sans bateau');
  assert.match(r.out.error, /trop chargé/);
  r = await call('action', { body: { action: { type: 'crew.bank.withdraw', amount: 50 } }, headers: J });
  assert.equal(r.status, 200, 'u1 est capitaine');
});

test('bateaux : création par le staff, achat en boutique, renommage, assignation à l’équipage', async () => {
  let r = await call('staff', { body: { op: 'ship.save', ship: { name: 'Sans modèle', owner: { kind: 'player', id: 'u1' } } }, headers: MJ });
  assert.equal(r.status, 400, 'un modèle est obligatoire');
  await call('staff', { body: { op: 'item.save', item: { name: 'Frégate', kind: 'bateau', value: 1, ship: { cannons: 20, capacity: 800, berths: 12, sail: 2 } } }, headers: MJ });
  r = await call('staff', { body: { op: 'ship.save', ship: { model: 'fregate', name: 'Le Vaillant', capacity: 999999, owner: { kind: 'player', id: 'u1' } } }, headers: MJ });
  assert.equal(r.status, 200, JSON.stringify(r.out));
  assert.equal(r.out.id, 'le-vaillant');
  assert.deepEqual([r.out.ship.type, r.out.ship.capacity, r.out.ship.cannons], ['Frégate', 800, 20], 'les chiffres viennent du modèle');
  await call('staff', { body: { op: 'item.save', item: { name: 'Caravelle', kind: 'bateau', value: 1000, ship: { type: 'Caravelle', cannons: 4, capacity: 300 } } }, headers: MJ });
  await call('staff', { body: { op: 'shop.save', channelId: '111111111111111111', shop: { name: 'Chantier', seller: 'Franky', items: [['caravelle', 100, 1]] } }, headers: MJ });
  await call('staff', { body: { op: 'act', target: 'u1', action: { type: 'berry', amount: 1000 } }, headers: MJ });
  r = await call('action', { body: { channelId: '111111111111111111', action: { type: 'shop.buy', key: 'caravelle' } }, headers: J });
  assert.equal(r.status, 200, JSON.stringify(r.out));
  const achat = r.out.ships.find((s) => s.type === 'Caravelle');
  assert.ok(achat, 'le bateau acheté apparaît');
  r = await call('action', { body: { action: { type: 'ship.edit', shipId: achat.id, name: 'La Mouette', desc: 'Petite et vive' } }, headers: J });
  assert.equal(r.status, 200, JSON.stringify(r.out));
  assert.ok(r.out.ships.some((s) => s.name === 'La Mouette'));
  r = await call('action', { body: { action: { type: 'crew.ship', shipId: 'le-vaillant' } }, headers: J });
  assert.equal(r.status, 200, JSON.stringify(r.out));
  assert.equal(r.out.crew.ship, 'le-vaillant');
  assert.deepEqual(tables.ships.get('le-vaillant').data.owner, { kind: 'crew', id: 'les-mouettes' });
  // Désormais le coffre accepte plus (capacité du bateau : 800 kg)
  r = await call('action', { body: { action: { type: 'crew.chest.deposit', key: 'corde', qty: 1 } }, headers: J });
  assert.equal(r.status, 200, JSON.stringify(r.out));
  // Le staff retire le bateau à l'équipage : l'équipage n'a plus de bateau attitré
  await call('staff', { body: { op: 'ship.save', id: 'le-vaillant', ship: { owner: null } }, headers: MJ });
  assert.equal(tables.crews.get('les-mouettes').data.ship, null);
});

test('équipage : grades, invitation et arrivée d’un joueur, exclusion', async () => {
  const H = { 'x-bot-secret': 'secret' };
  await call('bot', { body: { op: 'register', userId: 'u9', name: 'Nami Bis', race: 'Humain', classe: 'Tireur' }, headers: H });
  const U9 = { authorization: 'Bearer tok-u9' };
  USERS['tok-u9'] = { id: 'u9', username: 'nami' };
  // u1 est capitaine des Mouettes : il crée un grade et cherche u9
  let r = await call('action', { body: { action: { type: 'crew.rank.save', name: 'Navigatrice', perms: { invite: true } } }, headers: J });
  assert.equal(r.status, 200, JSON.stringify(r.out));
  r = await call('action', { body: { action: { type: 'crew.search', q: 'nami' } }, headers: J });
  assert.deepEqual(r.out.results.map((x) => x.uid), ['u9']);
  r = await call('action', { body: { action: { type: 'crew.invite', uid: 'u9' } }, headers: J });
  assert.equal(r.status, 200, JSON.stringify(r.out));
  assert.match(r.out.toast, /Nami Bis/);
  // u9 voit l'invitation et l'accepte
  r = await call('state', { method: 'GET', query: {}, headers: U9 });
  assert.equal(r.out.invites[0].name, 'Les Mouettes');
  r = await call('action', { body: { action: { type: 'crew.join', crewId: 'les-mouettes' } }, headers: U9 });
  assert.equal(r.status, 200, JSON.stringify(r.out));
  assert.equal(r.out.crew.name, 'Les Mouettes');
  assert.equal(tables.players.get('u9').data.crewId, 'les-mouettes');
  // grade attribué, puis exclusion
  const rank = tables.crews.get('les-mouettes').data.ranks.find((x) => x.name === 'Navigatrice');
  r = await call('action', { body: { action: { type: 'crew.member.rank', uid: 'u9', rankId: rank.id } }, headers: J });
  assert.equal(r.status, 200, JSON.stringify(r.out));
  r = await call('action', { body: { action: { type: 'crew.bank.withdraw', amount: 1 } }, headers: U9 });
  assert.equal(r.status, 400, 'pas la permission de retirer');
  r = await call('action', { body: { action: { type: 'crew.kick', uid: 'u9' } }, headers: J });
  assert.equal(r.status, 200, JSON.stringify(r.out));
  assert.equal(tables.players.get('u9').data.crewId, null);
});

test('images sur ImgBB quand la clé est configurée', async () => {
  const { env } = await import('../api/_lib/env.js');
  env.imgbbKey = 'cle-test';
  const appels = [];
  const ancien = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (String(url).startsWith('https://api.imgbb.com/')) {
      appels.push(Object.fromEntries(new URLSearchParams(opts.body)));
      return { ok: true, json: async () => ({ success: true, data: { url: 'https://i.ibb.co/abc/photo.png' } }) };
    }
    return ancien(url, opts);
  };
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  let r = await call('action', { body: { action: { type: 'photo.set', photo: png } }, headers: J });
  assert.equal(r.status, 200, JSON.stringify(r.out));
  assert.equal(r.out.player.photo, 'https://i.ibb.co/abc/photo.png');
  assert.equal(appels[0].key, 'cle-test');
  assert.ok(!appels[0].image.startsWith('data:'), 'base64 seul');
  r = await call('action', { body: { action: { type: 'photo.set', photo: 'https://exemple.com/a.gif' } }, headers: J });
  assert.equal(appels[1].image, 'https://exemple.com/a.gif', 'ImgBB récupère le lien');
  r = await call('action', { body: { action: { type: 'photo.set', photo: 'https://i.ibb.co/deja/la.png' } }, headers: J });
  assert.equal(appels.length, 2, 'déjà sur ImgBB : pas de nouvel envoi');
  globalThis.fetch = ancien;
  env.imgbbKey = undefined;
});

test('relais d’images : seulement ImgBB, réponse mise en cache', async () => {
  const { default: img } = await import('../api/img.js');
  const ancien = globalThis.fetch;
  globalThis.fetch = async (url) => ({ ok: true, status: 200, headers: new Map([['content-type', 'image/png']]), arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer });
  const appel = async (u) => {
    let status = 0, body, headers = {};
    const res = { setHeader: (k, v) => (headers[k] = v), status: (s) => ((status = s), res), send: (b) => ((body = b), res) };
    await img({ method: 'GET', query: { u } }, res);
    return { status, body, headers };
  };
  let r = await appel('https://i.ibb.co/abc/photo.png');
  assert.equal(r.status, 200);
  assert.equal(r.headers['Content-Type'], 'image/png');
  assert.match(r.headers['Cache-Control'], /s-maxage=31536000/);
  r = await appel('https://exemple.com/photo.png');
  assert.equal(r.status, 400, 'pas un relais ouvert à tout internet');
  r = await appel('https://i.ibb.co.pirate.com/x.png');
  assert.equal(r.status, 400);
  globalThis.fetch = ancien;
});

test('navigation : bateaux à quai, demande d’embarquement acceptée par le propriétaire, amélioration', async () => {
  const C1 = '111111111111111111';
  // u2 (MJ) possède un bateau à quai dans C1
  await call('bot', { body: { op: 'register', userId: 'u2', name: 'Le MJ', race: 'Humain', classe: 'Fighter' }, headers: { 'x-bot-secret': 'secret' } }).catch(() => {});
  await call('staff', { body: { op: 'item.save', item: { name: 'Brick', kind: 'bateau', value: 1, ship: { cannons: 2, capacity: 100, berths: 2, sail: 1 } } }, headers: MJ });
  let r = await call('staff', { body: { op: 'ship.save', ship: { model: 'brick', name: 'Le Marchand', owner: { kind: 'player', id: 'u2' }, positionId: C1 } }, headers: MJ });
  assert.equal(r.status, 200, JSON.stringify(r.out));
  assert.deepEqual(r.out.ship.position, { channelId: C1, name: 'port-brisant' });
  // u1 voit le bateau à quai et demande à monter
  r = await call('state', { method: 'GET', query: { channel: C1 }, headers: J });
  const sh = r.out.nav.harbor.find((x) => x.name === 'Le Marchand');
  assert.ok(sh, 'à quai dans ce salon');
  r = await call('action', { body: { channelId: C1, action: { type: 'ship.board', shipId: sh.id } }, headers: J });
  assert.equal(r.status, 200, JSON.stringify(r.out));
  assert.ok(r.out.requested);
  // le propriétaire voit la demande et accepte
  r = await call('state', { method: 'GET', query: { channel: C1 }, headers: MJ });
  assert.equal(r.out.nav.requests[0].uid, 'u1');
  r = await call('action', { body: { channelId: C1, action: { type: 'ship.request', shipId: sh.id, uid: 'u1', accept: true } }, headers: MJ });
  assert.equal(r.status, 200, JSON.stringify(r.out));
  r = await call('state', { method: 'GET', query: { channel: C1 }, headers: J });
  assert.equal(r.out.nav.aboard.name, 'Le Marchand');
  // amélioration installée par le propriétaire
  await call('staff', { body: { op: 'item.save', item: { name: 'Voile renforcée', kind: 'amelioration', upgrade: { type: 'voile', amount: 2 } } }, headers: MJ });
  await call('staff', { body: { op: 'act', target: 'u2', action: { type: 'give', key: 'voile-renforcee', qty: 1 } }, headers: MJ });
  const slot = tables.players.get('u2').data.inv.findIndex((x) => x && x[0] === 'voile-renforcee');
  r = await call('action', { body: { channelId: C1, action: { type: 'ship.upgrade', shipId: sh.id, slot } }, headers: MJ });
  assert.equal(r.status, 200, JSON.stringify(r.out));
  assert.equal(tables.ships.get(sh.id).data.sail, 3, 'voile 1 + 2');
  assert.equal(tables.players.get('u2').data.inv.some((x) => x && x[0] === 'voile-renforcee'), false);
});

test('Marine : solde versée à l’ouverture, flotte réservée aux Marines', async () => {
  const H = { 'x-bot-secret': 'secret' };
  await call('bot', { body: { op: 'register', userId: 'm1', name: 'Coby', race: 'Humain', classe: 'Fighter' }, headers: H });
  USERS['tok-m1'] = { id: 'm1', username: 'coby' };
  const M1 = { authorization: 'Bearer tok-m1' };
  await call('staff', { body: { op: 'act', target: 'm1', action: { type: 'edit', patch: { id: { faction: 'Marine', grade: 'Capitaine' } } } }, headers: MJ });
  let r = await call('state', { method: 'GET', query: {}, headers: M1 });
  assert.equal(r.out.salary.amount, 0, 'premier passage : le compteur démarre');
  // trois semaines plus tard
  tables.players.get('m1').data.salaryAt -= 3 * 7 * 24 * 3600 * 1000;
  r = await call('state', { method: 'GET', query: {}, headers: M1 });
  assert.equal(r.out.salary.amount, 15_000_000);
  assert.equal(r.out.player.berry, 15_000_000);
  // flotte : un pirate est refusé
  r = await call('staff', { body: { op: 'crew.save', crew: { kind: 'flotte', name: 'Flotte du Nord', members: ['m1', 'u9'] } }, headers: MJ });
  assert.equal(r.status, 400);
  assert.match(r.out.error, /pas Marine/);
  r = await call('staff', { body: { op: 'crew.save', crew: { kind: 'flotte', name: 'Flotte du Nord', members: ['m1'] } }, headers: MJ });
  assert.equal(r.status, 200, JSON.stringify(r.out));
  assert.equal(r.out.crew.kind, 'flotte');
});

test('bateau donné à une flotte sans bateau attitré : il le devient', async () => {
  await call('staff', { body: { op: 'crew.save', id: 'flotte-du-nord', crew: { ship: null } }, headers: MJ });
  const r = await call('staff', { body: { op: 'ship.save', ship: { model: 'brick', name: 'Le Garde-Côte', owner: { kind: 'crew', id: 'flotte-du-nord' } } }, headers: MJ });
  assert.equal(r.status, 200, JSON.stringify(r.out));
  assert.equal(tables.crews.get('flotte-du-nord').data.ship, r.out.id);
});

test('staff : améliorer un bateau existant (et corriger), historique noté', async () => {
  let r = await call('staff', { body: { op: 'ship.upgrade', id: 'le-garde-cote', type: 'canons', amount: 6 }, headers: MJ });
  assert.equal(r.status, 200, JSON.stringify(r.out));
  assert.equal(r.out.ship.cannons, 8);
  r = await call('staff', { body: { op: 'ship.upgrade', id: 'le-garde-cote', type: 'cale', amount: -1000 }, headers: MJ });
  assert.equal(r.out.ship.capacity, 0, 'jamais négatif');
  r = await call('staff', { body: { op: 'ship.upgrade', id: 'le-garde-cote', type: 'voile', amount: 2 }, headers: MJ });
  assert.equal(r.out.ship.sail, 3);
  assert.equal(r.out.ship.upgrades.length, 3);
  r = await call('staff', { body: { op: 'ship.upgrade', id: 'le-garde-cote', type: 'canons', amount: 2 }, headers: J });
  assert.equal(r.status, 403);
});

test('messages RP : salons déclarés, XP limitée, la position du joueur fait la boutique', async () => {
  const H = { 'x-bot-secret': 'secret' };
  let r = await call('bot', { body: { op: 'rp.channel.add', channelId: '111111111111111111', name: 'port-brisant', kind: 'salon', by: 'u2' }, headers: H });
  assert.equal(r.status, 200, JSON.stringify(r.out));
  r = await call('bot', { body: { op: 'rp.channels' }, headers: H });
  assert.deepEqual(r.out.channels.map((c) => c.id), ['111111111111111111']);
  // pas de fiche : rien
  r = await call('bot', { body: { op: 'rp.message', userId: 'inconnu', channelId: '111111111111111111', length: 900 }, headers: H });
  assert.equal(r.out.noProfile, true);
  // u1 écrit : +20 XP, position = port-brisant (où il y a une boutique)
  const avant = tables.players.get('u1').data;
  const xpAvant = avant.xp, niv = avant.level;
  r = await call('bot', { body: { op: 'rp.message', userId: 'u1', channelId: '111111111111111111', name: 'port-brisant', length: 500 }, headers: H });
  assert.equal(r.status, 200, JSON.stringify(r.out));
  assert.equal(r.out.counted, true);
  assert.equal(r.out.xp, 20);
  assert.ok(tables.players.get('u1').data.xp !== xpAvant || tables.players.get('u1').data.level > niv);
  r = await call('state', { method: 'GET', query: { channel: 'ailleurs' }, headers: J });
  assert.equal(r.out.channelId, '111111111111111111', 'la position, pas le salon de la commande');
  assert.equal(r.out.shop.name, 'Chantier');
  // message court : ni XP ni déplacement
  r = await call('bot', { body: { op: 'rp.message', userId: 'u1', channelId: '222222222222222222', length: 100 }, headers: H });
  assert.equal(r.out.counted, false);
  assert.equal(tables.players.get('u1').data.position.channelId, '111111111111111111');
  // 5 par jour
  for (let i = 0; i < 4; i++) await call('bot', { body: { op: 'rp.message', userId: 'u1', channelId: '111111111111111111', length: 500 }, headers: H });
  r = await call('bot', { body: { op: 'rp.message', userId: 'u1', channelId: '111111111111111111', length: 500 }, headers: H });
  assert.equal(r.out.limit, true);
  r = await call('bot', { body: { op: 'rp.channel.remove', channelId: '111111111111111111' }, headers: H });
  assert.deepEqual(r.out.channels, []);
});

test('carte : fond, îles avec salons vérifiés, déplacement, trajets, vue joueur', async () => {
  let r = await call('staff', { body: { op: 'map.bg', bg: 'https://i.ibb.co/abc/carte.png', ratio: 0.5 }, headers: MJ });
  assert.equal(r.status, 200, JSON.stringify(r.out));
  r = await call('staff', { body: { op: 'map.island.save', island: { name: 'Port-Brisant', x: 10, y: 20, channels: [{ id: '111111111111111111' }] } }, headers: MJ });
  assert.equal(r.status, 200, JSON.stringify(r.out));
  assert.equal(r.out.map.islands['port-brisant'].channels[0].name, 'port-brisant', 'nom retrouvé');
  r = await call('staff', { body: { op: 'map.island.save', island: { name: 'Fantôme', channels: [{ id: '999999999999999999' }] } }, headers: MJ });
  assert.equal(r.status, 400, 'salon inconnu refusé');
  await call('staff', { body: { op: 'map.island.save', island: { name: 'Île secrète', x: 80, y: 80, visible: false } }, headers: MJ });
  r = await call('staff', { body: { op: 'map.island.move', id: 'ile-secrete', x: 70, y: 60 }, headers: MJ });
  assert.equal(r.out.map.islands['ile-secrete'].x, 70);
  r = await call('staff', { body: { op: 'map.route', a: 'port-brisant', b: 'ile-secrete', value: 42 }, headers: MJ });
  assert.equal(r.out.map.routes['ile-secrete|port-brisant'], 42);
  // u1 est à port-brisant (sa position) : il voit son île, pas l'île secrète
  r = await call('state', { method: 'GET', query: {}, headers: J });
  assert.equal(r.out.map.here, 'port-brisant');
  assert.deepEqual(Object.keys(r.out.map.islands), ['port-brisant']);
  assert.equal(r.out.map.routes, undefined);
  // un joueur ne peut pas modifier la carte
  r = await call('staff', { body: { op: 'map.island.delete', id: 'port-brisant' }, headers: J });
  assert.equal(r.status, 403);
});

test('ImgBB : image trop lourde pour le relais → version allégée', async () => {
  const { env } = await import('../api/_lib/env.js');
  env.imgbbKey = 'cle';
  const ancien = globalThis.fetch;
  globalThis.fetch = async (url, o) => (String(url).startsWith('https://api.imgbb.com/')
    ? { ok: true, json: async () => ({ success: true, data: { url: 'https://i.ibb.co/x/enorme.png', size: 9_000_000, medium: { url: 'https://i.ibb.co/y/enorme-medium.png' } } }) }
    : ancien(url, o));
  const r = await call('action', { body: { action: { type: 'photo.set', photo: 'https://exemple.com/enorme.png' } }, headers: J });
  assert.equal(r.out.player.photo, 'https://i.ibb.co/y/enorme-medium.png');
  globalThis.fetch = ancien;
  env.imgbbKey = undefined;
});
