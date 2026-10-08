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
  assert.deepEqual(G.normalizeItem({ name: ' Rhum ', kind: 'bizarre', value: '-5' }), { name: 'Rhum', kind: 'objet', value: 0, weight: 0, desc: '', img: null });
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

test('techniques : deux types seulement, anciennes converties', () => {
  cat();
  assert.deepEqual(Object.keys(G.TECH_SOURCES), ['combat', 'fruit']);
  const p = G.normalize({ id: { name: 'X' }, techniques: [{ id: 1, name: 'A', src: 'haki' }, { id: 2, name: 'B', src: 'fruit' }] });
  assert.equal(p.techniques[0].src, 'combat');
  assert.equal(p.techniques[1].src, 'fruit');
});

test('poids des objets et de l’inventaire', () => {
  cat();
  const p = G.demoPlayer();
  assert.equal(G.invWeight(p), 3 + 4 * 2 + 2 * 0.5);
  assert.equal(G.normalizeItem({ name: 'Ancre', weight: '12,5' }).weight, 12.5);
  assert.equal(G.kg(12.5), '12,5 kg');
});

test('bateau : achat en boutique, nom/photo par le propriétaire', () => {
  cat();
  const p = G.demoPlayer(), shop = G.demoShop();
  assert.throws(() => G.playerAction(p, { type: 'shop.buy', key: 'caravelle-ex' }, { shop }), /nom/);
  const r = G.playerAction(p, { type: 'shop.buy', key: 'caravelle-ex', shipName: 'La Belle' }, { shop, now: 5 });
  assert.equal(r.newShip.name, 'La Belle');
  assert.equal(r.newShip.type, 'Caravelle');
  assert.equal(r.newShip.cannons, 4);
  assert.equal(r.newShip.capacity, 300);
  assert.deepEqual(r.newShip.owner, { kind: 'player', id: 'demo' });
  assert.equal(G.count(r.player, 'caravelle-ex'), 0, 'pas dans l’inventaire');
  const e = G.playerAction(r.player, { type: 'ship.edit', name: 'La Mouette', desc: 'Ma barque', photo: '/media/x.jpg' }, { ship: r.newShip });
  assert.equal(e.ship.name, 'La Mouette');
  const autre = { ...p, uid: 'autre' };
  assert.throws(() => G.playerAction(autre, { type: 'ship.edit', name: 'Volé' }, { ship: r.newShip }), /appartient/);
});

test('équipage : banque, coffre avec capacité du bateau, droits du capitaine', () => {
  cat();
  const crew = G.demoCrew(), ships = G.demoShips();
  const capitaine = G.demoPlayer();
  const membre = { ...G.demoPlayer(), uid: 'pnj-1' };
  let r = G.crewAction(membre, { type: 'crew.bank.deposit', amount: 1000 }, { crew, ships });
  assert.equal(r.crew.bank, 26000);
  assert.throws(() => G.crewAction(membre, { type: 'crew.bank.withdraw', amount: 10 }, { crew, ships }), /grade ne permet pas/);
  r = G.crewAction(capitaine, { type: 'crew.bank.withdraw', amount: 5000 }, { crew, ships });
  assert.equal(r.player.berry, capitaine.berry + 5000);
  r = G.crewAction(membre, { type: 'crew.chest.deposit', key: 'bois-ex', qty: 4 }, { crew, ships });
  assert.equal(r.crew.chest['bois-ex'], 10);
  const petit = { ...crew, ship: null, chest: { 'tonneau-ex': 6 } }; // 90 kg sur 100 sans bateau
  assert.throws(() => G.crewAction(membre, { type: 'crew.chest.deposit', key: 'bois-ex', qty: 4 }, { crew: { ...petit, chest: { 'tonneau-ex': 7 } }, ships }), /trop chargé/);
  G.crewAction(membre, { type: 'crew.chest.deposit', key: 'bois-ex', qty: 4 }, { crew: petit, ships }); // 98 kg : passe
  r = G.crewAction(membre, { type: 'crew.chest.withdraw', key: 'bois-ex', qty: 6 }, { crew, ships });
  assert.equal(r.crew.chest['bois-ex'], undefined);
  const etranger = { ...G.demoPlayer(), uid: 'x' };
  assert.throws(() => G.crewAction(etranger, { type: 'crew.bank.deposit', amount: 1 }, { crew, ships }), /fais pas partie/);
});

test('équipage : le capitaine assigne son bateau, qui devient celui de l’équipage', () => {
  cat();
  const crew = G.demoCrew();
  const ships = { ...G.demoShips(), perso: G.newShip({ name: 'Perso', type: 'Goélette', cannons: 2, capacity: 10, owner: { kind: 'player', id: 'demo' } }) };
  const p = G.demoPlayer();
  assert.throws(() => G.crewAction(p, { type: 'crew.ship', shipId: 'perso' }, { crew, ships }), /ne tient pas/);
  const lighter = { ...crew, chest: {} };
  const r = G.crewAction(p, { type: 'crew.ship', shipId: 'perso' }, { crew: lighter, ships });
  assert.equal(r.crew.ship, 'perso');
  assert.deepEqual(r.ships.perso.owner, { kind: 'crew', id: 'goeland-noir' });
  const membre = { ...p, uid: 'pnj-1' };
  assert.throws(() => G.crewAction(membre, { type: 'crew.ship', shipId: null }, { crew, ships }), /grade ne permet pas/);
});

test('grades : le capitaine crée un grade avec des permissions et l’attribue', () => {
  cat();
  const cap = G.demoPlayer(), membre = { ...G.demoPlayer(), uid: 'pnj-1' };
  let crew = G.demoCrew();
  assert.equal(G.rankName(crew, 'pnj-1'), 'Matelot');
  assert.throws(() => G.crewAction(membre, { type: 'crew.rank.save', name: 'Second', perms: {} }, { crew }), /capitaine/);
  crew = G.crewAction(cap, { type: 'crew.rank.save', name: 'Second', perms: { bankOut: true, invite: true, faux: true } }, { crew }).crew;
  const second = crew.ranks.find((r) => r.name === 'Second');
  assert.deepEqual(Object.keys(second.perms).filter((k) => second.perms[k]), ['bankOut', 'invite']);
  assert.throws(() => G.crewAction(membre, { type: 'crew.bank.withdraw', amount: 10 }, { crew }), /grade/);
  crew = G.crewAction(cap, { type: 'crew.member.rank', uid: 'pnj-1', rankId: second.id }, { crew }).crew;
  assert.equal(G.rankName(crew, 'pnj-1'), 'Second');
  assert.equal(G.crewAction(membre, { type: 'crew.bank.withdraw', amount: 10 }, { crew }).player.berry, membre.berry + 10);
  // supprimer le grade : retour au grade de base
  crew = G.crewAction(cap, { type: 'crew.rank.delete', id: second.id }, { crew }).crew;
  assert.equal(G.rankName(crew, 'pnj-1'), 'Matelot');
  assert.throws(() => G.crewAction(cap, { type: 'crew.rank.delete', id: G.DEFAULT_RANK }, { crew }), /base/);
});

test('invitations : inviter, accepter (en quittant l’ancien équipage), refuser, quitter', () => {
  cat();
  const cap = G.demoPlayer();
  let crew = G.demoCrew();
  const nouveau = G.normalize({ uid: 'n1', id: { name: 'Nami' }, crewId: 'ancien' });
  assert.throws(() => G.inviteAction(nouveau, { type: 'crew.join' }, { crew }), /n’existe plus/);
  crew = G.crewAction(cap, { type: 'crew.invite', uid: 'n1', name: 'Nami' }, { crew }).crew;
  assert.throws(() => G.crewAction(cap, { type: 'crew.invite', uid: 'n1' }, { crew }), /déjà invité/);
  const j = G.inviteAction(nouveau, { type: 'crew.join' }, { crew });
  assert.ok(j.crew.members.includes('n1'));
  assert.equal(j.player.crewId, 'goeland-noir');
  assert.equal(j.previous, 'ancien', 'à retirer de son ancien équipage');
  assert.equal(j.crew.invites.length, 0);
  // quitter
  const l = G.crewAction(j.player, { type: 'crew.leave' }, { crew: j.crew });
  assert.equal(l.player.crewId, null);
  assert.ok(!l.crew.members.includes('n1'));
  // le capitaine ne part pas sans céder sa place
  assert.throws(() => G.crewAction(cap, { type: 'crew.leave' }, { crew }), /Cède/);
  const t = G.crewAction(cap, { type: 'crew.transfer', uid: 'pnj-1' }, { crew });
  assert.equal(t.crew.captain, 'pnj-1');
});

test('exclure : réservé à la permission, jamais le capitaine', () => {
  cat();
  const cap = G.demoPlayer(), membre = { ...G.demoPlayer(), uid: 'pnj-1' };
  const crew = G.demoCrew();
  assert.throws(() => G.crewAction(membre, { type: 'crew.kick', uid: 'demo' }, { crew }), /grade/);
  const k = G.crewAction(cap, { type: 'crew.kick', uid: 'pnj-1' }, { crew });
  assert.equal(k.kicked, 'pnj-1');
  assert.ok(!k.crew.members.includes('pnj-1'));
});

test('armes : jamais empilées, une case par arme', () => {
  cat();
  const p = G.demoPlayer();
  G.addItem(p, 'sabre-ex', 2);
  assert.equal(p.inv.filter((x) => x && x[0] === 'sabre-ex').length, 3);
  assert.ok(p.inv.every((x) => !x || x[0] !== 'sabre-ex' || x[1] === 1));
  const i = p.inv.findIndex((x) => x && x[0] === 'sabre-ex'), j = p.inv.findIndex((x, n) => n > i && x && x[0] === 'sabre-ex');
  const m = G.playerAction(p, { type: 'inv.move', from: i, to: j }).player;
  assert.deepEqual([m.inv[i], m.inv[j]], [['sabre-ex', 1], ['sabre-ex', 1]], 'échange, pas d’empilement');
  const vieux = G.normalize({ id: { name: 'X' }, inv: [['sabre-ex', 3]] });
  assert.equal(vieux.inv.filter((x) => x && x[0] === 'sabre-ex').length, 3, 'anciennes piles séparées');
  const plein = G.normalize({ id: { name: 'X' }, inv: Array.from({ length: 32 }, () => ['bois-ex', 1]) });
  assert.equal(G.addItem(plein, 'sabre-ex', 1), false);
});

test('recettes : désignées par ce qu’elles produisent', () => {
  cat();
  const r = G.normalizeRecipe({ gives: { 'tonneau-ex': 2, 'clous-ex': 1 }, needs: { 'bois-ex': 1 } });
  assert.equal(r.name, undefined);
  assert.equal(G.recipeLabel(r), '2 × Tonneau (exemple), 1 × Clous (exemple)');
});

test('grades : classement par importance', () => {
  cat();
  const cap = G.demoPlayer();
  let crew = G.crewAction(cap, { type: 'crew.rank.save', name: 'Second', perms: {} }, { crew: G.demoCrew() }).crew;
  assert.deepEqual(crew.ranks.map((r) => r.name), ['Matelot', 'Second']);
  const id = crew.ranks[1].id;
  crew = G.crewAction(cap, { type: 'crew.rank.move', id, dir: -1 }, { crew }).crew;
  assert.deepEqual(crew.ranks.map((r) => r.name), ['Second', 'Matelot']);
});
