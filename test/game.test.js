import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../shared/game.js';

const seq = (...vals) => { let i = 0; return () => vals[i++ % vals.length]; };

test('nouvelle fiche complète et inventaire de 32 cases', () => {
  const p = G.newPlayer('1', 'Luffo');
  assert.equal(p.inv.length, G.BAG);
  assert.equal(p.id.first, 'Luffo');
  assert.equal(p.haki.rois, null);
});

test('répartition des stats : refuse plus que les points disponibles', () => {
  const p = G.demoPlayer();
  assert.throws(() => G.playerAction(p, { type: 'stats', alloc: { force: 4 } }), G.GameError);
  const r = G.playerAction(p, { type: 'stats', alloc: { force: 2, sdc: 1 } });
  assert.equal(r.player.stats.force, 26);
  assert.equal(r.player.statPts, 0);
  assert.equal(p.stats.force, 24, "l'état d'origine n'est pas modifié");
});

test('équipement : deux armes maximum, pas de tenue', () => {
  let p = G.demoPlayer();
  p = G.playerAction(p, { type: 'equip', key: 'pistolet' }).player;
  assert.deepEqual(p.equip, { arme1: 'sabre', arme2: 'pistolet' });
  G.addItem(p, 'katana', 1);
  assert.throws(() => G.playerAction(p, { type: 'equip', key: 'katana' }), /deux armes/);
  assert.throws(() => G.playerAction(p, { type: 'equip', key: 'veste' }), /pas une arme/);
  p = G.playerAction(p, { type: 'equip', key: 'katana', slot: 'arme2' }).player;
  assert.equal(p.equip.arme2, 'katana');
});

test('déplacer et empiler dans l’inventaire', () => {
  let p = G.demoPlayer();
  p = G.playerAction(p, { type: 'inv.move', from: 4, to: 20 }).player;
  assert.deepEqual(p.inv[20], ['minerai', 4]);
  assert.equal(p.inv[4], null);
});

test('boutique : achat débite et baisse le stock, vente avec refus verrouillé', () => {
  const p = G.demoPlayer(), shop = G.demoShop();
  const r = G.playerAction(p, { type: 'shop.buy', key: 'sabre' }, { shop });
  assert.equal(r.player.berry, p.berry - 8000);
  assert.equal(r.shop.items.find((x) => x[0] === 'sabre')[2], 2);
  const refus = G.playerAction(p, { type: 'shop.sell', key: 'pepites', pct: 160 }, { shop, channelId: 'c1', rng: () => 0.99 });
  assert.equal(refus.refused, true);
  assert.equal(refus.player.sellLock.c1.pepites, true);
  const ok = G.playerAction(refus.player, { type: 'shop.sell', key: 'pepites', pct: 160 }, { shop, channelId: 'c1' });
  assert.equal(ok.player.berry, p.berry + G.refPrice(shop, 'pepites'), 'verrouillé : prix de référence');
});

test('métier : objets requis et XP de métier', () => {
  const p = G.demoPlayer();
  const r = G.playerAction(p, { type: 'job.do', id: 'sabre' });
  assert.equal(G.count(r.player, 'sabre'), 2);
  assert.equal(G.count(r.player, 'minerai'), 1);
  assert.equal(r.player.job.xp, 100);
  const up = G.playerAction(r.player, { type: 'job.up' });
  assert.equal(up.player.job.lvl, 2);
  assert.throws(() => G.playerAction(up.player, { type: 'job.do', id: 'sabre' }), /manquants/);
});

test('navigation : cooldown, événement et choix réservé au joueur', () => {
  const p = G.demoPlayer();
  let nav = G.playerAction(p, { type: 'nav.toggle' }).nav;
  // rng : 0 => d100 = 1 (événement), puis choix de l'événement
  const r = G.navMessage(p, nav, { rng: seq(0, 0.6, 0.5, 0.5), now: 100000 });
  assert.equal(r.counted, true);
  assert.ok(r.entry);
  const again = G.navMessage(r.player, r.nav, { now: 100001 });
  assert.equal(again.counted, false, 'cooldown');
  nav = r.nav;
  const ev = G.eventView(r.entry, r.player);
  if (ev.choices.length) {
    const other = { ...r.player, uid: 'autre' };
    assert.throws(() => G.navChoose(other, nav, r.entry.id, 0), /autre joueur/);
    const c = G.navChoose(r.player, nav, r.entry.id, 0, { rng: () => 0.99 });
    assert.ok(c.entry.result);
    assert.throws(() => G.navChoose(c.player, c.nav, r.entry.id, 0), /déjà/);
  }
});

test('staff : édition bornée, Haki des rois à 0 = non éveillé', () => {
  const p = G.demoPlayer();
  const r = G.staffAction(p, { type: 'edit', patch: { volonte: 9, haki: { rois: 0, armement: 3 }, stats: { force: 500 }, id: { faction: 'Inconnue', first: 'Mira' } } });
  assert.equal(r.player.volonte, 5);
  assert.equal(r.player.haki.rois, null);
  assert.equal(r.player.haki.armement, 3);
  assert.equal(r.player.stats.force, G.STAT_MAX);
  assert.equal(r.player.id.faction, 'Pirate');
  assert.equal(r.player.id.first, 'Mira');
});

test('niveau : XP et points de stats', () => {
  const p = G.newPlayer('1', 'x');
  const ups = G.gainXP(p, 100 + 140);
  assert.equal(ups, 2);
  assert.equal(p.level, 3);
  assert.equal(p.statPts, 6);
});
