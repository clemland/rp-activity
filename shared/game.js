/**
 * Moteur du jeu, partagé par l'API (Vercel) et le mode démo du site.
 * Fonctions pures : on donne un état, une action et un contexte, on récupère
 * le nouvel état.
 *
 * Les objets et les recettes ne sont PAS ici : le staff les crée dans l'app
 * (écran Gestion) et ils sont stockés dans la base. On les charge avec
 * setCatalog() avant d'appliquer une action.
 */

/* ═══ Réglages ═══════════════════════════════════════════════════════════ */
export const BAG = 32; // emplacements d'inventaire
export const STAT_MAX = 100;
export const XP_NEED = (lv) => 100 + 40 * (lv - 1); // XP pour passer au niveau suivant
export const LEVEL_STAT_POINTS = 3; // points de stats gagnés à chaque niveau
export const ASK_MAX = 160; // % maximum demandé à la vente
export const JOB_LEVELS = ['Apprenti', 'Confirmé', 'Maître'];
export const CRAFT_MAX_SECONDS = 30 * 24 * 3600; // 30 jours

export const STATS = [
  { key: 'force', name: 'Force', pic: 'st_swords' },
  { key: 'rapidite', name: 'Rapidité', pic: 'st_leg' },
  { key: 'resistance', name: 'Résistance', pic: 'st_shield' },
  { key: 'sdc', name: 'Technique', pic: 'st_sparkle' },
];
export const HAKI = [
  { key: 'observation', name: "Haki de l'observation", icon: 12 },
  { key: 'armement', name: "Haki de l'armement", icon: 13 },
  { key: 'rois', name: 'Haki des rois', icon: 14 },
];
export const FACTIONS = ['Pirate', 'Marine', 'Révolutionnaire', 'Chasseur de primes', 'Civil'];
export const GRADES = ['Matelot', 'Caporal', 'Sergent', 'Adjudant', 'Enseigne', 'Lieutenant', 'Capitaine de corvette', 'Capitaine', 'Commodore', 'Vice-amiral', 'Amiral'];
export const RACES = ['Humain', 'Mink', 'Géant', 'Shandia', 'Homme-poisson', 'Buccaneer'];
export const CLASSES = ['Fighter', 'Sabreur', 'Tireur'];
export const FRUIT_TYPES = ['Paramecia', 'Zoan', 'Logia'];
export const SLOTS = { arme1: 'Arme 1', arme2: 'Arme 2' };
export const TECH_SOURCES = { physique: 'Physique', arme: 'Arme', haki: 'Haki', fruit: 'Fruit du démon' };

/** Métiers. « Aucun métier » = job.id null. */
export const JOBS = {
  navigateur: { name: 'Navigateur', pic: 'compass' },
  archeologue: { name: 'Archéologue', pic: 'tmap' },
  charpentier: { name: 'Charpentier', pic: 'hammer' },
  scientifique: { name: 'Scientifique', pic: 'potion' },
  medecin: { name: 'Médecin', pic: 'stetho' },
};

/** Catégories d'objets. Seules les armes s'équipent. */
export const KIND = { arme: 'Arme', conso: 'Consommable', mat: 'Matériau', tresor: 'Trésor', objet: 'Objet' };

/* ═══ Catalogue (objets et recettes du staff) ════════════════════════════ */
export let ITEMS = {}; // id → { name, kind, value, desc, img }
export let RECIPES = {}; // id → { name, job, lvl, seconds, needs, gives, desc }
export function setCatalog({ items = {}, recipes = {} } = {}) {
  ITEMS = items;
  RECIPES = recipes;
}
/** Objet du catalogue, ou un objet « supprimé » si le staff l'a effacé. */
export const itemOf = (k) => ITEMS[k] || { name: 'Objet supprimé', kind: 'objet', value: 0, desc: 'Cet objet n’existe plus.', img: null, missing: true };

/* ═══ Outils ═════════════════════════════════════════════════════════════ */
export class GameError extends Error {}
const fail = (msg) => {
  throw new GameError(msg);
};
const int = (v, min, max) => Math.min(max, Math.max(min, Math.round(Number(v) || 0)));
const str = (v, max) => String(v ?? '').trim().slice(0, max);
const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
export const fmt = (n) => Number(n).toLocaleString('fr-FR').replace(/\u202f|\u00a0/g, '.');
const d = (rng, faces) => 1 + Math.floor(rng() * faces);
const norm = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[-'’\s]+/g, ' ').trim();
const inList = (list, v) => list.find((x) => norm(x) === norm(v));

/** Durée lisible : « 2 h 30 min », « 3 j ». */
export function duree(sec) {
  sec = Math.max(0, Math.round(sec));
  const j = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (j) return `${j} j${h ? ` ${h} h` : ''}`;
  if (h) return `${h} h${m ? ` ${m} min` : ''}`;
  if (m) return `${m} min${s && m < 5 ? ` ${s} s` : ''}`;
  return `${s} s`;
}

/* ═══ Personnage ═════════════════════════════════════════════════════════ */
/** Fiche créée par le staff avec /register. */
export function newPlayer(uid, { name, race, job, classe } = {}) {
  const n = str(name, 60);
  if (!n) fail('Il faut un nom.');
  const r = inList(RACES, race);
  if (!r) fail(`Race inconnue. Choix : ${RACES.join(', ')}.`);
  const c = inList(CLASSES, classe);
  if (!c) fail(`Classe inconnue. Choix : ${CLASSES.join(', ')}.`);
  const j = !job || norm(job) === 'aucun' ? null : Object.keys(JOBS).find((k) => k === job || norm(JOBS[k].name) === norm(job));
  if (job && norm(job) !== 'aucun' && !j) fail(`Métier inconnu. Choix : ${Object.values(JOBS).map((x) => x.name).join(', ')} ou aucun.`);
  return normalize({
    uid,
    id: { name: n, epithet: '', faction: 'Pirate', crew: '', crewRole: '', grade: 'Matelot', race: r, classe: c, bounty: 0 },
    level: 1, xp: 0, statPts: 0, berry: 0,
    stats: { force: 10, rapidite: 10, resistance: 10, sdc: 10 },
    volonte: 0, haki: { observation: 0, armement: 0, rois: null }, fruit: null,
    job: { id: j, lvl: 1 },
    techniques: [], inv: [], equip: { arme1: null, arme2: null },
    created: Date.now(),
  });
}

/** Complète une fiche (anciennes données, champs manquants). Ne supprime jamais d'objet. */
export function normalize(p) {
  p.photo ??= null;
  p.id ??= {};
  if (p.id.name == null) p.id.name = [p.id.first, p.id.last].filter(Boolean).join(' ') || 'Inconnu';
  delete p.id.first;
  delete p.id.last;
  p.stats ??= {};
  for (const s of STATS) p.stats[s.key] ??= 10;
  p.volonte ??= 0;
  p.haki ??= {};
  for (const h of HAKI) if (!(h.key in p.haki)) p.haki[h.key] = h.key === 'rois' ? null : 0;
  p.fruit ??= null;
  p.job ??= { id: null, lvl: 1 };
  if (p.job.id && !JOBS[p.job.id]) p.job.id = null;
  delete p.job.xp;
  p.techniques ??= [];
  p.inv ??= [];
  p.inv = p.inv.slice(0, BAG).map((s) => (s && s[0] && s[1] > 0 ? s : null));
  while (p.inv.length < BAG) p.inv.push(null);
  p.equip ??= { arme1: null, arme2: null };
  p.sellLock ??= {};
  p.craft ??= null;
  delete p.effects;
  delete p.navCd;
  fixEquip(p);
  return p;
}

export const fullName = (p) => p?.id?.name || [p?.id?.first, p?.id?.last].filter(Boolean).join(' ') || 'Inconnu';
export const count = (p, k) => p.inv.reduce((a, s) => a + (s && s[0] === k ? s[1] : 0), 0);
export const equippedCount = (p, k) => Object.values(p.equip).filter((x) => x === k).length;
export const isEquipped = (p, k) => Object.values(p.equip).includes(k);
export const isWeapon = (k) => ITEMS[k]?.kind === 'arme';

export function addItem(p, k, q = 1) {
  if (!ITEMS[k]) fail('Objet inconnu.');
  const s = p.inv.find((x) => x && x[0] === k);
  if (s) { s[1] += q; return true; }
  const i = p.inv.findIndex((x) => !x);
  if (i < 0) return false; // inventaire plein
  p.inv[i] = [k, q];
  return true;
}
export function removeItem(p, k, q = 1) {
  for (let i = p.inv.length - 1; i >= 0 && q > 0; i--) {
    const s = p.inv[i];
    if (!s || s[0] !== k) continue;
    const take = Math.min(q, s[1]);
    s[1] -= take; q -= take;
    if (s[1] <= 0) p.inv[i] = null;
  }
  fixEquip(p);
  return q === 0;
}
/** On ne peut pas équiper plus d'exemplaires qu'on n'en possède. */
export function fixEquip(p) {
  for (const sl of ['arme2', 'arme1']) {
    const k = p.equip[sl];
    if (k && equippedCount(p, k) > count(p, k)) p.equip[sl] = null;
  }
}
/** Ajoute de l'XP ; renvoie le nombre de niveaux gagnés. */
export function gainXP(p, n) {
  if (!n) return 0;
  p.xp += n;
  let ups = 0;
  while (p.xp >= XP_NEED(p.level)) {
    p.xp -= XP_NEED(p.level); p.level++; p.statPts += LEVEL_STAT_POINTS; ups++;
  }
  return ups;
}

/* ═══ Catalogue : validation des objets et recettes du staff ═════════════ */
export function slug(name) {
  return norm(name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'objet';
}
export function normalizeItem(x) {
  const name = str(x.name, 60);
  if (!name) fail('Donne un nom à l’objet.');
  return {
    name,
    kind: KIND[x.kind] ? x.kind : 'objet',
    value: int(x.value, 0, 1e12),
    desc: str(x.desc, 400),
    img: x.img ? str(x.img, 3_000_000) : null, // data URL avant envoi, puis chemin /media/...
  };
}
export function normalizeRecipe(x) {
  const name = str(x.name, 60);
  if (!name) fail('Donne un nom à la recette.');
  const items = (o) =>
    Object.fromEntries(
      Object.entries(o || {})
        .map(([k, q]) => [k, int(q, 0, 9999)])
        .filter(([k, q]) => q > 0 && ITEMS[k]),
    );
  const gives = items(x.gives);
  if (!Object.keys(gives).length) fail('La recette doit produire au moins un objet.');
  return {
    name,
    job: x.job && JOBS[x.job] ? x.job : null,
    lvl: int(x.lvl, 1, 3),
    seconds: int(x.seconds, 0, CRAFT_MAX_SECONDS),
    needs: items(x.needs),
    gives,
    desc: str(x.desc, 400),
  };
}
/** Le joueur peut-il lancer cette recette ? Renvoie la raison sinon. */
export function craftBlock(p, r) {
  if (r.job && r.job !== p.job.id) return `Réservé au métier ${JOBS[r.job].name}.`;
  if (r.job && p.job.lvl < r.lvl) return `Demande le niveau ${JOB_LEVELS[r.lvl - 1]}.`;
  if (Object.entries(r.needs).some(([k, q]) => count(p, k) < q)) return 'Objets manquants.';
  return null;
}

/* ═══ Boutiques ══════════════════════════════════════════════════════════ */
export function newShop(channelName = '') {
  return { channel: channelName ? `#${channelName}` : '#salon', name: 'Comptoir', seller: 'Le marchand', face: '🧔', img: null, buyRate: 0.4, difficulty: 0, items: [] };
}
export function normalizeShop(s) {
  s.items = (s.items || []).filter((x) => x && x[0]).map(([k, price, stock]) => [k, int(price, 0, 1e11), stock < 0 ? -1 : int(stock, 0, 1e6)]);
  s.buyRate = Math.min(1, Math.max(0.05, Number(s.buyRate) || 0.4));
  s.difficulty = int(s.difficulty ?? 0, 0, 50);
  return s;
}
export const refPrice = (shop, k) => Math.max(1, Math.round(itemOf(k).value * shop.buyRate));
/** Chance que le vendeur accepte : 100 % au prix de référence, chute vite au-delà. */
export function sellChance(shop, pct) {
  if (pct <= 100) return 100;
  const x = (pct - 100) / (ASK_MAX - 100);
  return Math.max(3, Math.round(100 * Math.pow(1 - x, 1.6) - (shop?.difficulty || 0) * x));
}

/* ═══ Actions des joueurs ════════════════════════════════════════════════ */
/**
 * Applique une action du joueur sur SA fiche.
 * ctx : { rng, now, channelId, shop }
 * Renvoie { player, shop?, toast, icon, ups }.
 */
export function playerAction(player, action, ctx = {}) {
  const p = clone(player);
  const rng = ctx.rng || Math.random;
  const now = ctx.now || Date.now();
  const out = { player: p, toast: null, icon: null, ups: 0 };
  const a = action || {};
  const slotOk = (i) => Number.isInteger(i) && i >= 0 && i < BAG;

  switch (a.type) {
    case 'stats': {
      const alloc = a.alloc || {};
      let spent = 0;
      for (const [k, v] of Object.entries(alloc)) {
        if (!STATS.some((s) => s.key === k)) fail('Statistique inconnue.');
        const n = int(v, 0, STAT_MAX);
        if (p.stats[k] + n > STAT_MAX) fail(`Maximum ${STAT_MAX} par statistique.`);
        spent += n;
      }
      if (!spent) fail('Aucun point réparti.');
      if (spent > p.statPts) fail('Pas assez de points.');
      for (const [k, v] of Object.entries(alloc)) p.stats[k] += int(v, 0, STAT_MAX);
      p.statPts -= spent;
      out.toast = `${spent} point${spent > 1 ? 's' : ''} de stats réparti${spent > 1 ? 's' : ''}`;
      break;
    }
    case 'inv.move': {
      const { from, to } = a;
      if (!slotOk(from) || !slotOk(to) || from === to) fail('Déplacement invalide.');
      const x = p.inv[from], y = p.inv[to];
      if (!x) fail('Emplacement vide.');
      if (y && y[0] === x[0]) { y[1] += x[1]; p.inv[from] = null; } else { p.inv[to] = x; p.inv[from] = y; }
      break;
    }
    case 'inv.drop': {
      const s = p.inv[a.slot];
      if (!slotOk(a.slot) || !s) fail('Emplacement vide.');
      if (isEquipped(p, s[0]) && equippedCount(p, s[0]) >= count(p, s[0])) fail('Retire-le d’abord de ton équipement.');
      s[1]--; if (s[1] <= 0) p.inv[a.slot] = null;
      fixEquip(p);
      out.toast = `Jeté par-dessus bord : ${itemOf(s[0]).name}`;
      break;
    }
    case 'equip': {
      const k = a.key, it = itemOf(k);
      if (!count(p, k)) fail('Tu n’as pas cet objet.');
      if (!isWeapon(k)) fail(`${it.name} n’est pas une arme.`);
      let slot = a.slot;
      if (slot && !SLOTS[slot]) fail('Emplacement invalide.');
      if (slot) {
        if (p.equip[slot] !== k) {
          const other = slot === 'arme1' ? 'arme2' : 'arme1';
          if (equippedCount(p, k) >= count(p, k)) { p.equip[other] = p.equip[slot]; p.equip[slot] = k; } // change de main
          else p.equip[slot] = k;
        }
      } else if (isEquipped(p, k) && equippedCount(p, k) >= count(p, k)) {
        slot = p.equip.arme2 === k ? 'arme2' : 'arme1';
        p.equip[slot] = null;
        out.toast = `Retiré : ${it.name}`; out.item = k;
        break;
      } else {
        slot = !p.equip.arme1 ? 'arme1' : !p.equip.arme2 ? 'arme2' : null;
        if (!slot) fail('Tu portes déjà deux armes : retires-en une d’abord.');
        p.equip[slot] = k;
      }
      out.toast = `Équipé : ${it.name}`; out.item = k; out.slot = slot;
      break;
    }
    case 'unequip': {
      if (!SLOTS[a.slot] || !p.equip[a.slot]) fail('Rien à retirer.');
      const k = p.equip[a.slot];
      p.equip[a.slot] = null;
      out.toast = `Retiré : ${itemOf(k).name}`; out.item = k;
      break;
    }
    case 'craft.start': {
      const r = RECIPES[a.id];
      if (!r) fail('Recette inconnue.');
      if (p.craft) fail('Tu as déjà une fabrication en cours.');
      const why = craftBlock(p, r);
      if (why) fail(why);
      for (const [k, q] of Object.entries(r.needs)) removeItem(p, k, q);
      p.craft = { recipe: a.id, name: r.name, gives: r.gives, start: now, end: now + r.seconds * 1000 };
      out.toast = r.seconds ? `Fabrication lancée : ${r.name} (${duree(r.seconds)})` : `Fabrication lancée : ${r.name}`;
      break;
    }
    case 'craft.collect': {
      const c = p.craft;
      if (!c) fail('Aucune fabrication en cours.');
      if (now < c.end) fail(`Encore ${duree((c.end - now) / 1000)} de patience.`);
      const test = clone(p);
      for (const [k, q] of Object.entries(c.gives)) if (ITEMS[k] && !addItem(test, k, q)) fail('Inventaire plein : libère de la place pour récupérer ta fabrication.');
      for (const [k, q] of Object.entries(c.gives)) if (ITEMS[k]) addItem(p, k, q);
      p.craft = null;
      out.toast = `Récupéré : ${Object.entries(c.gives).map(([k, q]) => `${q} × ${itemOf(k).name}`).join(', ')}`;
      out.item = Object.keys(c.gives)[0];
      break;
    }
    case 'craft.cancel': {
      const c = p.craft;
      if (!c) fail('Aucune fabrication en cours.');
      const r = RECIPES[c.recipe];
      if (r) for (const [k, q] of Object.entries(r.needs)) if (ITEMS[k]) addItem(p, k, q);
      p.craft = null;
      out.toast = 'Fabrication annulée, ingrédients rendus';
      break;
    }
    case 'tech.save': {
      const name = str(a.name, 40);
      if (!name) fail('Donne un nom à ta technique.');
      const data = { name, src: TECH_SOURCES[a.src] ? a.src : 'physique', desc: str(a.desc, 600), ok: false };
      if (a.media !== undefined) data.media = a.media ? str(a.media, 600000) : null;
      if (a.id != null) {
        const t = p.techniques.find((x) => x.id === a.id);
        if (!t) fail('Technique introuvable.');
        Object.assign(t, data);
        out.toast = 'Technique modifiée, en attente de validation';
      } else {
        if (p.techniques.length >= 40) fail('Trop de techniques.');
        p.techniques.push({ id: now + Math.floor(rng() * 1000), media: null, ...data });
        out.toast = 'Technique proposée au MJ';
      }
      break;
    }
    case 'tech.delete': {
      const t = p.techniques.find((x) => x.id === a.id);
      if (!t) fail('Technique introuvable.');
      p.techniques = p.techniques.filter((x) => x !== t);
      out.toast = `Technique supprimée : ${t.name}`;
      break;
    }
    case 'photo.set': {
      const ph = a.photo;
      if (typeof ph === 'string') p.photo = str(ph, 600000);
      else if (ph && typeof ph.url === 'string') p.photo = { url: str(ph.url, 2000), l: +ph.l || 0, t: +ph.t || 0, w: +ph.w || 100 };
      else fail('Photo invalide.');
      out.toast = 'Nouvelle photo enregistrée';
      break;
    }
    case 'photo.remove': p.photo = null; out.toast = 'Photo retirée'; break;

    case 'shop.buy': {
      const shop = clone(ctx.shop);
      if (!shop) fail('Pas de boutique dans ce salon.');
      const row = shop.items.find(([k]) => k === a.key);
      if (!row || !ITEMS[row[0]]) fail('Cet objet n’est pas vendu ici.');
      const [k, price, stock] = row;
      if (stock === 0) fail('Épuisé.');
      if (p.berry < price) fail('Pas assez de berrys.');
      if (!addItem(p, k, 1)) fail('Inventaire plein.');
      p.berry -= price;
      if (stock > 0) row[2]--;
      out.shop = shop; out.toast = `Acheté : ${ITEMS[k].name}`; out.item = k; out.delta = -price;
      break;
    }
    case 'shop.sell': {
      const shop = ctx.shop;
      if (!shop) fail('Pas de boutique dans ce salon.');
      const k = a.key, it = itemOf(k);
      if (!count(p, k)) fail('Tu n’as pas cet objet.');
      if (!it.value) fail(`${it.name} ne se vend pas.`);
      if (isEquipped(p, k) && equippedCount(p, k) >= count(p, k)) fail('Retire-le d’abord de ton équipement.');
      const ch = ctx.channelId || 'demo';
      const locked = !!p.sellLock[ch]?.[k];
      const pct = locked ? 100 : int(a.pct ?? 100, 100, ASK_MAX);
      const ref = refPrice(shop, k), price = Math.round((ref * pct) / 100);
      if (pct > 100) {
        const chance = sellChance(shop, pct), r = d(rng, 100);
        if (r > chance) {
          p.sellLock[ch] ??= {}; p.sellLock[ch][k] = true;
          out.refused = true; out.toast = `Jet ${r} > ${chance} : ${shop.seller} refuse de payer ${fmt(price)} pour ${it.name}`; out.item = k;
          break;
        }
      }
      removeItem(p, k, 1); p.berry += price;
      out.toast = pct > 100 ? `${shop.seller} accepte : vendu ${fmt(price)}` : `Vendu : ${it.name}`; out.item = k; out.delta = price;
      break;
    }
    default: fail('Action inconnue.');
  }
  return out;
}

/* ═══ Actions du staff ═══════════════════════════════════════════════════ */
/** Modifications réservées aux MJ, sur la fiche d'un joueur. */
export function staffAction(player, action) {
  const p = clone(player);
  const a = action || {};
  const out = { player: p, toast: 'Fiche mise à jour', ups: 0 };
  switch (a.type) {
    case 'edit': {
      const x = a.patch || {};
      const id = x.id || {};
      if ('name' in id) {
        const n = str(id.name, 60);
        if (!n) fail('Le nom ne peut pas être vide.');
        p.id.name = n;
      }
      if ('epithet' in id) p.id.epithet = str(id.epithet, 40);
      if ('faction' in id && inList(FACTIONS, id.faction)) p.id.faction = inList(FACTIONS, id.faction);
      if ('crew' in id) p.id.crew = str(id.crew, 60);
      if ('crewRole' in id) p.id.crewRole = str(id.crewRole, 40);
      if ('grade' in id && inList(GRADES, id.grade)) p.id.grade = inList(GRADES, id.grade);
      if ('race' in id && inList(RACES, id.race)) p.id.race = inList(RACES, id.race);
      if ('classe' in id && inList(CLASSES, id.classe)) p.id.classe = inList(CLASSES, id.classe);
      if ('bounty' in id) p.id.bounty = int(id.bounty, 0, 1e12);
      if ('job' in x) p.job.id = x.job && JOBS[x.job] ? x.job : null;
      if ('jobLvl' in x) p.job.lvl = int(x.jobLvl, 1, 3);
      if ('fruit' in x) {
        const f = x.fruit;
        p.fruit = f && str(f.name, 60)
          ? { name: str(f.name, 60), type: inList(FRUIT_TYPES, f.type) || 'Paramecia', stars: int(f.stars ?? p.fruit?.stars ?? 1, 0, 5), desc: str(f.desc ?? (p.fruit?.name === f.name ? p.fruit.desc : ''), 400) }
          : null;
      }
      if ('volonte' in x) p.volonte = int(x.volonte, 0, 5);
      if (x.haki) for (const h of HAKI) if (h.key in x.haki) { const v = int(x.haki[h.key], 0, 5); p.haki[h.key] = h.key === 'rois' && v === 0 ? null : v; }
      if ('level' in x) p.level = int(x.level, 1, 999);
      if ('xp' in x) p.xp = int(x.xp, 0, XP_NEED(p.level) - 1);
      if ('berry' in x) p.berry = int(x.berry, 0, 1e12);
      if ('statPts' in x) p.statPts = int(x.statPts, 0, 999);
      if (x.stats) for (const s of STATS) if (s.key in x.stats) p.stats[s.key] = int(x.stats[s.key], 0, STAT_MAX);
      break;
    }
    case 'give': case 'take': {
      const k = a.key, q = int(a.qty ?? 1, 1, 9999);
      if (!ITEMS[k]) fail('Objet inconnu.');
      if (a.type === 'give') { if (!addItem(p, k, q)) fail('Inventaire plein.'); out.toast = `Donné : ${q} × ${ITEMS[k].name}`; }
      else { removeItem(p, k, Math.min(q, count(p, k))); out.toast = `Retiré : ${q} × ${ITEMS[k].name}`; }
      break;
    }
    case 'xp': out.ups = gainXP(p, int(a.amount, 0, 1e6)); out.toast = `+${int(a.amount, 0, 1e6)} XP`; break;
    case 'craft.finish': {
      if (!p.craft) fail('Aucune fabrication en cours.');
      p.craft.end = Date.now();
      out.toast = 'Fabrication terminée : le joueur peut la récupérer';
      break;
    }
    case 'tech.validate': {
      const t = p.techniques.find((x) => x.id === a.id);
      if (!t) fail('Technique introuvable.');
      if (a.ok) { t.ok = true; out.toast = `Technique validée : ${t.name}`; }
      else { p.techniques = p.techniques.filter((x) => x !== t); out.toast = `Technique refusée : ${t.name}`; }
      break;
    }
    default: fail('Action inconnue.');
  }
  fixEquip(p);
  return out;
}

/* ═══ Mode démo (hors Discord) ═══════════════════════════════════════════ */
/** Petit catalogue d'exemple, seulement pour la démo : le vrai est vide au départ. */
export function demoCatalog() {
  return {
    items: {
      'bois-ex': { name: 'Bois (exemple)', kind: 'mat', value: 500, desc: 'Objet d’exemple de la démo.', img: null },
      'clous-ex': { name: 'Clous (exemple)', kind: 'mat', value: 200, desc: 'Objet d’exemple de la démo.', img: null },
      'tonneau-ex': { name: 'Tonneau (exemple)', kind: 'objet', value: 2000, desc: 'Objet d’exemple de la démo.', img: null },
      'sabre-ex': { name: 'Sabre (exemple)', kind: 'arme', value: 8000, desc: 'Une arme d’exemple.', img: null },
    },
    recipes: {
      'tonneau-ex': { name: 'Assembler un tonneau', job: 'charpentier', lvl: 1, seconds: 20, needs: { 'bois-ex': 2, 'clous-ex': 1 }, gives: { 'tonneau-ex': 1 }, desc: 'Recette d’exemple : 20 secondes.' },
    },
  };
}
export function demoPlayer() {
  return normalize({
    uid: 'demo', photo: null,
    id: { name: 'Elio Varenne', epithet: 'Le Brise-Lames', faction: 'Pirate', crew: 'Équipage du Goéland Noir', crewRole: 'Capitaine', grade: 'Matelot', race: 'Humain', classe: 'Sabreur', bounty: 87000000 },
    level: 12, xp: 470, statPts: 3, berry: 412500,
    stats: { force: 24, rapidite: 31, resistance: 20, sdc: 27 }, volonte: 2,
    haki: { observation: 2, armement: 1, rois: null },
    fruit: { name: 'Shio Shio no Mi', type: 'Paramecia', stars: 2, desc: "Fait naître, durcit et façonne le sel." },
    job: { id: 'charpentier', lvl: 1 },
    techniques: [{ id: 1, name: 'Mur de sel', src: 'fruit', ok: true, media: null, desc: 'Une paroi de sel cristallisé jaillit devant lui.' }],
    inv: [['sabre-ex', 1], ['bois-ex', 4], ['clous-ex', 2]],
    equip: { arme1: 'sabre-ex', arme2: null },
  });
}
export function demoShop() {
  return { channel: '#port-brisant', name: 'Comptoir de Port-Brisant', seller: 'Maman Rosa', face: '👵', img: null, buyRate: 0.4, difficulty: 0,
    items: [['bois-ex', 600, -1], ['clous-ex', 250, 20], ['sabre-ex', 9000, 2]] };
}
