import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../shared/game.js';

const cat = () => G.setCatalog(G.demoCatalog());

test('/register : fiche créée avec nom en un bloc, race, métier, classe', () => {
  cat();
  const p = G.newPlayer('1', { name: 'Monkey D. Lucien', race: 'homme poisson', job: 'Archéologue', classe: 'sabreur' });
  assert.equal(p.id.name, 'Monkey D. Lucien');
  assert.equal(p.id.race, 'Homme-poisson');
  assert.equal(p.job.id, 'archeologue');
  assert.equal(p.id.classe, 'Sabreur');
  assert.equal(p.inv.length, G.BAG);
  const sans = G.newPlayer('2', { name: 'X', race: 'Mink', job: 'aucun', classe: 'Tireur' });
  assert.equal(sans.job.id, null);
  assert.throws(() => G.newPlayer('3', { name: 'X', race: 'Elfe', classe: 'Tireur' }), /Race inconnue/);
  assert.throws(() => G.newPlayer('3', { name: 'X', race: 'Mink', classe: 'Mage' }), /Classe inconnue/);
  assert.throws(() => G.newPlayer('3', { name: 'X', race: 'Mink', classe: 'Tireur', job: 'Forgeron' }), /Métier inconnu/);
});

test('anciennes fiches : prénom + nom fusionnés, objets inconnus conservés', () => {
  G.setCatalog({});
  const p = G.normalize({ id: { first: 'Elio', last: 'Varenne' }, inv: [['vieux-truc', 2]], job: { id: 'forgeron', lvl: 2, xp: 50 } });
  assert.equal(p.id.name, 'Elio Varenne');
  assert.deepEqual(p.inv[0], ['vieux-truc', 2], 'jamais supprimé, même si le catalogue est vide');
  assert.equal(p.job.id, null);
  assert.equal(G.itemOf('vieux-truc').missing, true);
});

test('équipement : seulement les armes du catalogue, deux maximum', () => {
  cat();
  let p = G.demoPlayer();
  assert.throws(() => G.playerAction(p, { type: 'equip', key: 'bois-ex' }), /pas une arme/);
  G.addItem(p, 'sabre-ex', 2);
  p = G.playerAction(p, { type: 'equip', key: 'sabre-ex' }).player;
  assert.deepEqual(p.equip, { arme1: 'sabre-ex', arme2: 'sabre-ex' });
});

test('craft : ingrédients consommés, durée, récupération, annulation', () => {
  cat();
  const p = G.demoPlayer();
  const r = G.playerAction(p, { type: 'craft.start', id: 'tonneau-ex' }, { now: 1000 });
  assert.equal(G.count(r.player, 'bois-ex'), 2);
  assert.equal(r.player.craft.end, 21000);
  assert.throws(() => G.playerAction(r.player, { type: 'craft.start', id: 'tonneau-ex' }, { now: 2000 }), /déjà/);
  assert.throws(() => G.playerAction(r.player, { type: 'craft.collect' }, { now: 5000 }), /patience/);
  const done = G.playerAction(r.player, { type: 'craft.collect' }, { now: 21000 });
  assert.equal(G.count(done.player, 'tonneau-ex'), 1);
  assert.equal(done.player.craft, null);
  const annule = G.playerAction(r.player, { type: 'craft.cancel' });
  assert.equal(G.count(annule.player, 'bois-ex'), 4, 'ingrédients rendus');
});

test('craft : métier et niveau de maîtrise requis', () => {
  cat();
  const p = G.demoPlayer();
  p.job.id = 'medecin';
  assert.match(G.craftBlock(p, G.RECIPES['tonneau-ex']), /Charpentier/);
  p.job.id = 'charpentier';
  const r2 = { ...G.RECIPES['tonneau-ex'], lvl: 2 };
  assert.match(G.craftBlock(p, r2), /Confirmé/);
  p.job.lvl = 2;
  assert.equal(G.craftBlock(p, r2), null);
});

test('catalogue : validation des objets et recettes', () => {
  cat();
  assert.throws(() => G.normalizeItem({ name: '' }), /nom/);
  assert.deepEqual(G.normalizeItem({ name: ' Rhum ', kind: 'bizarre', value: '-5' }), { name: 'Rhum', kind: 'objet', value: 0, desc: '', img: null });
  assert.throws(() => G.normalizeRecipe({ name: 'X', gives: { inconnu: 1 } }), /produire/);
  const r = G.normalizeRecipe({ name: 'X', job: 'forgeron', lvl: 9, seconds: 99999999, needs: { 'bois-ex': 2, fantome: 1 }, gives: { 'tonneau-ex': 1 } });
  assert.equal(r.job, null);
  assert.equal(r.lvl, 3);
  assert.equal(r.seconds, G.CRAFT_MAX_SECONDS);
  assert.deepEqual(r.needs, { 'bois-ex': 2 });
});

test('boutique : achat et revente avec le catalogue', () => {
  cat();
  const p = G.demoPlayer(), shop = G.demoShop();
  const r = G.playerAction(p, { type: 'shop.buy', key: 'clous-ex' }, { shop });
  assert.equal(r.player.berry, p.berry - 250);
  assert.equal(r.shop.items[1][2], 19);
  const v = G.playerAction(p, { type: 'shop.sell', key: 'bois-ex' }, { shop });
  assert.equal(v.player.berry, p.berry + 200);
});

test('staff : nom en un bloc, métier aucun, édition bornée', () => {
  cat();
  const p = G.demoPlayer();
  const r = G.staffAction(p, { type: 'edit', patch: { id: { name: 'Mira', race: 'Shandia', classe: 'Fighter' }, job: null, volonte: 9 } });
  assert.equal(r.player.id.name, 'Mira');
  assert.equal(r.player.id.race, 'Shandia');
  assert.equal(r.player.job.id, null);
  assert.equal(r.player.volonte, 5);
  assert.throws(() => G.staffAction(p, { type: 'edit', patch: { id: { name: '  ' } } }), /vide/);
});

test('durées lisibles', () => {
  assert.equal(G.duree(45), '45 s');
  assert.equal(G.duree(90), '1 min 30 s');
  assert.equal(G.duree(3600 * 2 + 1800), '2 h 30 min');
  assert.equal(G.duree(86400 * 3), '3 j');
});

test('staff : XP précise, positive ou négative, et redescente de niveau', () => {
  cat();
  const p = G.newPlayer('1', { name: 'X', race: 'Mink', classe: 'Tireur' });
  let r = G.staffAction(p, { type: 'xp', amount: 250 }); // 100 pour le niv 2, 140 pour le niv 3, reste 10
  assert.equal(r.player.level, 3);
  assert.equal(r.player.xp, 10);
  assert.equal(r.ups, 2);
  r = G.staffAction(r.player, { type: 'xp', amount: -20 }); // 10 - 20 → niv 2 avec 140 - 10 = 130
  assert.equal(r.player.level, 2);
  assert.equal(r.player.xp, 130);
  r = G.staffAction(r.player, { type: 'xp', amount: -99999 });
  assert.equal(r.player.level, 1);
  assert.equal(r.player.xp, 0);
  assert.throws(() => G.staffAction(p, { type: 'xp', amount: 0 }), /quantité/);
});

test('staff : niveaux précis, avec ou sans points de stats ; berrys ±', () => {
  cat();
  const p = G.newPlayer('1', { name: 'X', race: 'Mink', classe: 'Tireur' });
  let r = G.staffAction(p, { type: 'levels', amount: 5 });
  assert.equal(r.player.level, 6);
  assert.equal(r.player.statPts, 15);
  r = G.staffAction(r.player, { type: 'levels', amount: 2, points: false });
  assert.equal(r.player.level, 8);
  assert.equal(r.player.statPts, 15);
  r = G.staffAction(r.player, { type: 'levels', amount: -100 });
  assert.equal(r.player.level, 1);
  r = G.staffAction(r.player, { type: 'berry', amount: 5000 });
  r = G.staffAction(r.player, { type: 'berry', amount: -9000 });
  assert.equal(r.player.berry, 0, 'jamais négatif');
});
