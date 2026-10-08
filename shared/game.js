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
/** Grades de la Marine, du plus bas au plus haut, avec leur solde par semaine (berrys). */
export const MARINE_GRADES = [
  { name: '3ème Classe', pay: 250_000, medal: '🥉' },
  { name: '2ème Classe', pay: 500_000, medal: '🥈' },
  { name: '1ère Classe', pay: 1_000_000, medal: '🥇' },
  { name: 'Lieutenant', pay: 2_500_000, medal: '🏅' },
  { name: 'Capitaine', pay: 5_000_000, medal: '🏅' },
  { name: 'Vice-Amiral', pay: 10_000_000, medal: '🎖️' },
  { name: 'Amiral', pay: 30_000_000, medal: '🎖️' },
  { name: 'Amiral en Chef', pay: 50_000_000, medal: '🏆' },
];
export const GRADES = MARINE_GRADES.map((g) => g.name);
export const gradeOf = (name) => MARINE_GRADES.find((g) => g.name === name) || MARINE_GRADES[0];
const WEEK = 7 * 24 * 3600 * 1000;
/** Anciens grades → nouveaux. */
const OLD_GRADES = { Matelot: '3ème Classe', Caporal: '2ème Classe', Sergent: '1ère Classe', Adjudant: '1ère Classe', Enseigne: 'Lieutenant', 'Capitaine de corvette': 'Capitaine', Commodore: 'Vice-Amiral', 'Vice-amiral': 'Vice-Amiral' };
export const RACES = ['Humain', 'Mink', 'Géant', 'Shandia', 'Homme-poisson', 'Buccaneer'];
export const CLASSES = ['Fighter', 'Sabreur', 'Tireur'];
export const FRUIT_TYPES = ['Paramecia', 'Zoan', 'Logia'];
export const SLOTS = { arme1: 'Arme 1', arme2: 'Arme 2' };
export const TECH_SOURCES = { combat: 'Style de combat', fruit: 'Fruit du démon' };

/** Métiers. « Aucun métier » = job.id null. */
export const JOBS = {
  navigateur: { name: 'Navigateur', pic: 'compass' },
  archeologue: { name: 'Archéologue', pic: 'tmap' },
  charpentier: { name: 'Charpentier', pic: 'hammer' },
  scientifique: { name: 'Scientifique', pic: 'potion' },
  medecin: { name: 'Médecin', pic: 'stetho' },
};

/** Catégories d'objets. Seules les armes s'équipent. */
export const KIND = { arme: 'Arme', conso: 'Consommable', mat: 'Matériau', tresor: 'Trésor', objet: 'Objet', bateau: 'Bateau', amelioration: 'Amélioration de bateau' };
/** Améliorations de bateau : ce qu'elles ajoutent quand on les installe. */
export const UPGRADES = { cale: { name: 'Cale', unit: 'kg' }, canons: { name: 'Canons', unit: 'canons' }, voile: { name: 'Voile', unit: 'niveaux de vitesse' } };
export const CHEST_BASE = 100; // capacité (kg) du coffre d'un équipage sans bateau
export const SHIP_TYPES = ['Caravelle', 'Brick', 'Goélette', 'Frégate', 'Galion', 'Navire de guerre', 'Chaloupe'];

/* ═══ Catalogue (objets et recettes du staff) ════════════════════════════ */
export let ITEMS = {}; // id → { name, kind, value, desc, img }
export let RECIPES = {}; // id → { name, job, lvl, seconds, needs, gives, desc }
export function setCatalog({ items = {}, recipes = {} } = {}) {
  ITEMS = items;
  RECIPES = recipes;
}
/** Objet du catalogue, ou un objet « supprimé » si le staff l'a effacé. */
export const itemOf = (k) => ITEMS[k] || { name: 'Objet supprimé', kind: 'objet', value: 0, weight: 0, desc: 'Cet objet n’existe plus.', img: null, missing: true };
export const itemWeight = (k) => Number(ITEMS[k]?.weight) || 0;
/** Poids lisible : « 12,5 kg ». */
export const kg = (w) => `${(Math.round(w * 10) / 10).toLocaleString('fr-FR')} kg`;

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
    id: { name: n, epithet: '', faction: 'Pirate', crew: '', crewRole: '', grade: GRADES[0], race: r, classe: c, bounty: 0 },
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
  for (const t of p.techniques) if (!TECH_SOURCES[t.src]) t.src = 'combat';
  p.crewId ??= null;
  if (OLD_GRADES[p.id.grade]) p.id.grade = OLD_GRADES[p.id.grade];
  if (!GRADES.includes(p.id.grade)) p.id.grade = GRADES[0];
  p.inv ??= [];
  p.inv = p.inv.slice(0, BAG).map((s) => (s && s[0] && s[1] > 0 ? s : null));
  while (p.inv.length < BAG) p.inv.push(null);
  // Anciennes piles d'armes : une arme par case quand il y a de la place.
  for (let i = 0; i < p.inv.length; i++) {
    const s = p.inv[i];
    while (s && ITEMS[s[0]]?.kind === 'arme' && s[1] > 1) {
      const j = p.inv.findIndex((x) => !x);
      if (j < 0) break;
      p.inv[j] = [s[0], 1];
      s[1]--;
    }
  }
  // Chaque arme reçoit son identifiant ; l'ancien équipement (par type d'arme) devient un exemplaire précis.
  for (const s of p.inv) if (s && ITEMS[s[0]]?.kind === 'arme' && !s[2]) s[2] = newWid();
  p.equip ??= { arme1: null, arme2: null };
  for (const sl of Object.keys(SLOTS)) {
    const v = p.equip[sl];
    if (v && !p.inv.some((s) => s && s[2] === v)) {
      const taken = new Set(Object.values(p.equip));
      const inst = p.inv.find((s) => s && s[0] === v && s[2] && !taken.has(s[2]));
      p.equip[sl] = inst ? inst[2] : null;
    }
  }
  p.sellLock ??= {};
  p.craft ??= null;
  delete p.effects;
  delete p.navCd;
  fixEquip(p);
  return p;
}

export const fullName = (p) => p?.id?.name || [p?.id?.first, p?.id?.last].filter(Boolean).join(' ') || 'Inconnu';
export const count = (p, k) => p.inv.reduce((a, s) => a + (s && s[0] === k ? s[1] : 0), 0);
/*
 * Armes : chaque exemplaire a son identifiant (3e valeur de la case : [id, 1, wid]).
 * L'équipement pointe vers un exemplaire précis, qui le suit quand on le déplace.
 */
export const newWid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const equippedWids = (p) => new Set(Object.values(p.equip).filter(Boolean));
export const isSlotEquipped = (p, i) => !!p.inv[i]?.[2] && equippedWids(p).has(p.inv[i][2]);
/** Nombre d'exemplaires équipés de cet objet. */
export const equippedCount = (p, k) => p.inv.reduce((a, s) => a + (s && s[0] === k && s[2] && equippedWids(p).has(s[2]) ? 1 : 0), 0);
export const isEquipped = (p, k) => equippedCount(p, k) > 0;
/** Quantité utilisable (vendable, déposable…) : sans les armes équipées. */
export const freeCount = (p, k) => count(p, k) - equippedCount(p, k);
/** Case d'inventaire de l'arme équipée dans un emplacement (ou -1). */
export const equipSlotIndex = (p, sl) => (p.equip[sl] ? p.inv.findIndex((s) => s && s[2] === p.equip[sl]) : -1);
export const isWeapon = (k) => ITEMS[k]?.kind === 'arme';
export const invWeight = (p) => p.inv.reduce((a, s) => a + (s ? itemWeight(s[0]) * s[1] : 0), 0);

export function addItem(p, k, q = 1) {
  if (!ITEMS[k]) fail('Objet inconnu.');
  if (ITEMS[k].kind === 'arme') {
    // Les armes ne s'empilent pas : une arme = une case.
    const free = p.inv.reduce((a, x) => a + (x ? 0 : 1), 0);
    if (free < q) return false;
    for (let n = 0; n < q; n++) p.inv[p.inv.findIndex((x) => !x)] = [k, 1, newWid()];
    return true;
  }
  const s = p.inv.find((x) => x && x[0] === k);
  if (s) { s[1] += q; return true; }
  const i = p.inv.findIndex((x) => !x);
  if (i < 0) return false; // inventaire plein
  p.inv[i] = [k, q];
  return true;
}
export function removeItem(p, k, q = 1) {
  // Les exemplaires non équipés partent en premier.
  const eq = equippedWids(p);
  const order = p.inv.map((_, i) => i).reverse().sort((a, b) => (eq.has(p.inv[a]?.[2]) ? 1 : 0) - (eq.has(p.inv[b]?.[2]) ? 1 : 0));
  for (const i of order) {
    if (q <= 0) break;
    const s = p.inv[i];
    if (!s || s[0] !== k) continue;
    const take = Math.min(q, s[1]);
    s[1] -= take; q -= take;
    if (s[1] <= 0) p.inv[i] = null;
  }
  fixEquip(p);
  return q === 0;
}
/** L'équipement ne peut pointer que vers une arme encore dans l'inventaire. */
export function fixEquip(p) {
  for (const sl of Object.keys(SLOTS)) if (p.equip[sl] && equipSlotIndex(p, sl) < 0) p.equip[sl] = null;
  if (p.equip.arme1 && p.equip.arme1 === p.equip.arme2) p.equip.arme2 = null;
}
/**
 * Solde de la Marine, versée chaque semaine selon le grade actuel.
 * Appelée à chaque chargement de la fiche : verse les semaines écoulées.
 * Le compteur démarre quand le joueur devient Marine (pas de rattrapage avant).
 * Renvoie { weeks, amount } (0 si rien à verser) ; modifie p.
 */
export function paySalary(p, now = Date.now()) {
  if (p.id?.faction !== 'Marine') {
    p.salaryAt = null;
    return { weeks: 0, amount: 0 };
  }
  if (!p.salaryAt) {
    p.salaryAt = now;
    return { weeks: 0, amount: 0 };
  }
  const weeks = Math.floor((now - p.salaryAt) / WEEK);
  if (weeks <= 0) return { weeks: 0, amount: 0 };
  const amount = weeks * gradeOf(p.id.grade).pay;
  p.berry += amount;
  p.salaryAt += weeks * WEEK;
  return { weeks, amount };
}
export const nextPay = (p) => (p.id?.faction === 'Marine' && p.salaryAt ? p.salaryAt + WEEK : null);

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
  const kind = KIND[x.kind] ? x.kind : 'objet';
  return {
    name,
    kind,
    value: int(x.value, 0, 1e12),
    weight: kind === 'bateau' ? 0 : Math.round(Math.min(1e5, Math.max(0, Number(String(x.weight ?? 0).replace(',', '.')) || 0)) * 10) / 10,
    ...(kind === 'bateau' && { ship: { ...normalizeShipStats(x.ship || {}), type: name } }), // le nom est le type
    ...(kind === 'amelioration' && { upgrade: { type: UPGRADES[x.upgrade?.type] ? x.upgrade.type : 'cale', amount: int(x.upgrade?.amount ?? 1, 1, 1e6) } }),
    desc: str(x.desc, 400),
    img: x.img ? str(x.img, 3_000_000) : null, // data URL avant envoi, puis chemin /media/...
  };
}
/** Une recette se désigne par ce qu'elle produit : « 2 × Planche, 1 × Clou ». */
export const recipeLabel = (r) => Object.entries(r?.gives || {}).map(([k, q]) => `${q} × ${itemOf(k).name}`).join(', ') || 'Recette';
export function normalizeRecipe(x) {
  const items = (o) =>
    Object.fromEntries(
      Object.entries(o || {})
        .map(([k, q]) => [k, int(q, 0, 9999)])
        .filter(([k, q]) => q > 0 && ITEMS[k]),
    );
  const gives = items(x.gives);
  if (!Object.keys(gives).length) fail('La recette doit produire au moins un objet.');
  return {
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
      if (y && y[0] === x[0] && !isWeapon(x[0])) { y[1] += x[1]; p.inv[from] = null; } else { p.inv[to] = x; p.inv[from] = y; }
      break;
    }
    case 'inv.drop': {
      const s = p.inv[a.slot];
      if (!slotOk(a.slot) || !s) fail('Emplacement vide.');
      if (isSlotEquipped(p, a.slot)) fail('Retire-la d’abord de ton équipement.');
      s[1]--; if (s[1] <= 0) p.inv[a.slot] = null;
      fixEquip(p);
      out.toast = `Jeté par-dessus bord : ${itemOf(s[0]).name}`;
      break;
    }
    case 'equip': {
      // a.slot : case d'inventaire de l'arme choisie ; a.to : emplacement voulu (sinon le premier libre).
      const i = a.slot, it = p.inv[i];
      if (!slotOk(i) || !it) fail('Choisis une arme dans ton inventaire.');
      if (!isWeapon(it[0])) fail(`${itemOf(it[0]).name} n’est pas une arme.`);
      if (!it[2]) it[2] = newWid();
      const wid = it[2];
      let to = a.to;
      if (to && !SLOTS[to]) fail('Emplacement invalide.');
      const cur = Object.keys(SLOTS).find((sl) => p.equip[sl] === wid);
      if (!to && cur) {
        p.equip[cur] = null; // déjà équipée : on la retire
        out.toast = `Retiré : ${itemOf(it[0]).name}`; out.item = it[0];
        break;
      }
      if (!to) to = !p.equip.arme1 ? 'arme1' : !p.equip.arme2 ? 'arme2' : null;
      if (!to) fail('Tu portes déjà deux armes : retires-en une d’abord.');
      if (cur && cur !== to) p.equip[cur] = p.equip[to]; // changement de main : on échange
      p.equip[to] = wid;
      out.toast = `Équipé : ${itemOf(it[0]).name}`; out.item = it[0]; out.slot = to;
      break;
    }
    case 'unequip': {
      if (!SLOTS[a.slot] || !p.equip[a.slot]) fail('Rien à retirer.');
      const k = p.inv[equipSlotIndex(p, a.slot)]?.[0];
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
      p.craft = { recipe: a.id, name: recipeLabel(r), gives: r.gives, start: now, end: now + r.seconds * 1000 };
      out.toast = r.seconds ? `Fabrication lancée : ${recipeLabel(r)} (${duree(r.seconds)})` : `Fabrication lancée : ${recipeLabel(r)}`;
      break;
    }
    case 'craft.collect': {
      const c = p.craft;
      if (!c) fail('Aucune fabrication en cours.');
      if (now < c.end) fail(`Encore ${duree((c.end - now) / 1000)} de patience.`);
      const test = clone(p);
      const isShip = (k) => ITEMS[k]?.kind === 'bateau';
      for (const [k, q] of Object.entries(c.gives)) if (ITEMS[k] && !isShip(k) && !addItem(test, k, q)) fail('Inventaire plein : libère de la place pour récupérer ta fabrication.');
      for (const [k, q] of Object.entries(c.gives)) if (ITEMS[k] && !isShip(k)) addItem(p, k, q);
      // Un bateau fabriqué sort à quai dans le salon où on le récupère.
      out.newShips = Object.entries(c.gives).filter(([k]) => isShip(k)).flatMap(([k, q]) =>
        Array.from({ length: q }, () => newShip({ model: k, owner: { kind: 'player', id: p.uid }, position: ctx.channelId ? { channelId: ctx.channelId, name: ctx.channelName || '' } : null }, now)));
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
    case 'ship.edit': {
      // Le propriétaire (ou le capitaine pour un bateau d'équipage) renomme, décrit, change la photo.
      const ship = clone(ctx.ship);
      if (!ship) fail('Bateau introuvable.');
      if (!canEditShip(p, ship, ctx.crew)) fail('Ce bateau ne t’appartient pas.');
      if ('name' in a) {
        const n = str(a.name, 60);
        if (!n) fail('Donne un nom au bateau.');
        ship.name = n;
      }
      if ('desc' in a) ship.desc = str(a.desc, 600);
      if ('photo' in a) ship.photo = a.photo ? str(a.photo, 600000) : null;
      out.ship = ship;
      out.toast = `Bateau mis à jour : ${ship.name}`;
      break;
    }
    case 'tech.save': {
      const name = str(a.name, 40);
      if (!name) fail('Donne un nom à ta technique.');
      const data = { name, src: TECH_SOURCES[a.src] ? a.src : 'combat', desc: str(a.desc, 600), ok: false };
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
      if (ITEMS[k].kind === 'bateau') {
        // Le bateau arrive avec le nom de son type : le propriétaire le personnalise ensuite.
        out.newShip = newShip({ model: k, owner: { kind: 'player', id: p.uid }, position: ctx.channelId ? { channelId: ctx.channelId, name: (shop.channel || '').replace(/^#/, '') } : null }, now);
      }
      else if (!addItem(p, k, 1)) fail('Inventaire plein.');
      p.berry -= price;
      if (stock > 0) row[2]--;
      out.shop = shop; out.toast = out.newShip ? `${out.newShip.type} acheté : donne-lui un nom dans Équipage > Bateaux` : `Acheté : ${ITEMS[k].name}`; out.item = k; out.delta = -price;
      break;
    }
    case 'shop.sell': {
      const shop = ctx.shop;
      if (!shop) fail('Pas de boutique dans ce salon.');
      const k = a.key, it = itemOf(k);
      if (!count(p, k)) fail('Tu n’as pas cet objet.');
      if (!it.value) fail(`${it.name} ne se vend pas.`);
      if (freeCount(p, k) < 1) fail('Retire-le d’abord de ton équipement.');
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
      if (ITEMS[k].kind === 'bateau' && a.type === 'give') fail('Un bateau se crée dans Flotte > Bateaux, pas dans l’inventaire.');
      if (a.type === 'give') { if (!addItem(p, k, q)) fail('Inventaire plein.'); out.toast = `Donné : ${q} × ${ITEMS[k].name}`; }
      else { removeItem(p, k, Math.min(q, count(p, k))); out.toast = `Retiré : ${q} × ${ITEMS[k].name}`; }
      break;
    }
    case 'xp': {
      // Ajoute ou retire un nombre précis d'XP ; en retirant, on peut redescendre de niveau.
      const n = int(a.amount, -1e7, 1e7);
      if (!n) fail('Indique une quantité d’XP.');
      if (n > 0) out.ups = gainXP(p, n);
      else {
        p.xp += n;
        while (p.xp < 0 && p.level > 1) {
          p.level--;
          p.xp += XP_NEED(p.level);
        }
        p.xp = Math.max(0, p.xp);
      }
      out.toast = `${n > 0 ? '+' : '−'}${fmt(Math.abs(n))} XP pour ${fullName(p)} (niveau ${p.level})`;
      break;
    }
    case 'levels': {
      // Ajoute ou retire des niveaux ; par défaut, les niveaux gagnés donnent leurs points de stats.
      const n = int(a.amount, -998, 998);
      if (!n) fail('Indique un nombre de niveaux.');
      const before = p.level;
      p.level = Math.min(999, Math.max(1, p.level + n));
      const gained = p.level - before;
      if (gained > 0 && a.points !== false) p.statPts += gained * LEVEL_STAT_POINTS;
      p.xp = Math.min(p.xp, XP_NEED(p.level) - 1);
      out.toast = `${fullName(p)} : niveau ${before} → ${p.level}`;
      break;
    }
    case 'berry': {
      const n = int(a.amount, -1e12, 1e12);
      if (!n) fail('Indique un montant.');
      p.berry = Math.max(0, p.berry + n);
      out.toast = `${n > 0 ? '+' : '−'}${fmt(Math.abs(n))} berrys pour ${fullName(p)}`;
      break;
    }
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

/* ═══ Bateaux ════════════════════════════════════════════════════════════ */
/** Caractéristiques enregistrées à la création : type, canons, capacité (kg). */
export function normalizeShipStats(x) {
  return {
    type: str(x.type, 40) || 'Navire',
    cannons: int(x.cannons, 0, 500),
    capacity: Math.round(Math.min(1e7, Math.max(0, Number(x.capacity) || 0))),
    berths: int(x.berths ?? 4, 1, 1000), // places (personnes à bord)
    sail: int(x.sail ?? 1, 1, 100), // niveau de voile = vitesse (pour la navigation)
  };
}
/** Nouveau bateau, à partir d'un modèle (objet « Bateau ») ou de caractéristiques libres. */
export function newShip({ model = null, name, desc, photo, type, cannons, capacity, berths, sail, owner = null, position = null } = {}, now = Date.now()) {
  const m = model ? ITEMS[model] : null;
  if (model && m?.kind !== 'bateau') fail('Ce modèle de bateau n’existe pas.');
  const given = { type, cannons, capacity, berths, sail };
  for (const k of Object.keys(given)) if (given[k] == null) delete given[k];
  const stats = normalizeShipStats(m ? { ...m.ship, ...given } : given);
  return normalizeShip({ name: str(name, 60) || stats.type || m?.name || 'Bateau sans nom', desc: str(desc ?? m?.desc ?? '', 600), photo: photo || null, icon: m?.img || null, model, ...stats, owner, position, created: now });
}
export function normalizeShip(s) {
  Object.assign(s, normalizeShipStats(s));
  s.name = str(s.name, 60) || 'Bateau sans nom';
  s.desc ??= '';
  s.photo ??= null;
  s.icon ??= null;
  s.owner = s.owner && ['player', 'crew'].includes(s.owner.kind) && s.owner.id ? { kind: s.owner.kind, id: String(s.owner.id) } : null;
  s.position = s.position?.channelId ? { channelId: String(s.position.channelId), name: str(s.position.name, 60) } : null; // salon où il est à quai
  s.passengers = [...new Set((s.passengers || []).map(String))].slice(0, s.berths);
  s.requests = (s.requests || []).filter((r) => r?.uid && !s.passengers.includes(String(r.uid))).slice(-50);
  s.upgrades ??= [];
  return s;
}
export function canEditShip(p, ship, crew) {
  if (ship.owner?.kind === 'player') return ship.owner.id === p.uid;
  if (ship.owner?.kind === 'crew') return !!crew && crew.id === ship.owner.id && crewCan(crew, p.uid, 'ship');
  return false;
}

/** Monte-t-on directement (propriétaire ou équipage propriétaire), sans demander ? */
export function isShipFamily(p, ship, crew) {
  if (ship.owner?.kind === 'player') return ship.owner.id === p.uid;
  if (ship.owner?.kind === 'crew') return !!crew && crew.id === ship.owner.id && crew.members.includes(p.uid);
  return false;
}
/** Qui gère le bateau (embarquements, améliorations) : propriétaire, ou membre autorisé de l'équipage. */
export const canManageShip = (p, ship, crew) => canEditShip(p, ship, crew);

/**
 * Embarquement, débarquement, demandes et améliorations.
 * ctx : { crew (équipage du joueur), channelId (salon où l'Activity est ouverte), now }.
 * Renvoie { player, ship, toast, boarded?, left?, requested?, accepted? }.
 */
export function shipAction(player, ship0, action, ctx = {}) {
  const p = clone(player), ship = normalizeShip(clone(ship0));
  const a = action || {};
  const out = { player: p, ship, toast: null };
  const full = () => ship.passengers.length >= ship.berths;
  switch (a.type) {
    case 'ship.board': {
      if (ship.passengers.includes(p.uid)) fail('Tu es déjà à bord.');
      if (!ship.position || ship.position.channelId !== ctx.channelId) fail('Ce bateau n’est pas à quai ici.');
      if (isShipFamily(p, ship, ctx.crew)) {
        if (full()) fail('Il n’y a plus de place à bord.');
        ship.passengers.push(p.uid);
        out.boarded = true;
        out.toast = `Tu montes à bord de ${ship.name}`;
      } else {
        if (ship.requests.some((r) => r.uid === p.uid)) fail('Ta demande est déjà envoyée.');
        ship.requests.push({ uid: p.uid, at: ctx.now || Date.now() });
        out.requested = true;
        out.toast = `Demande envoyée pour monter à bord de ${ship.name}`;
      }
      break;
    }
    case 'ship.leave': {
      if (!ship.passengers.includes(p.uid)) fail('Tu n’es pas à bord.');
      ship.passengers = ship.passengers.filter((u) => u !== p.uid);
      out.left = true;
      out.toast = `Tu descends de ${ship.name}`;
      break;
    }
    case 'ship.request.cancel': {
      ship.requests = ship.requests.filter((r) => r.uid !== p.uid);
      out.toast = 'Demande annulée';
      break;
    }
    case 'ship.request': {
      // Le propriétaire (ou un membre autorisé) accepte ou refuse une demande.
      if (!canManageShip(p, ship, ctx.crew)) fail('Ce n’est pas ton bateau.');
      const r = ship.requests.find((x) => x.uid === a.uid);
      if (!r) fail('Cette demande n’existe plus.');
      ship.requests = ship.requests.filter((x) => x !== r);
      if (a.accept) {
        if (full()) fail('Il n’y a plus de place à bord.');
        ship.passengers.push(a.uid);
        out.accepted = a.uid;
        out.toast = 'Demande acceptée : le joueur est à bord';
      } else out.toast = 'Demande refusée';
      break;
    }
    case 'ship.kick': {
      if (!canManageShip(p, ship, ctx.crew)) fail('Ce n’est pas ton bateau.');
      if (!ship.passengers.includes(a.uid)) fail('Ce joueur n’est pas à bord.');
      ship.passengers = ship.passengers.filter((u) => u !== a.uid);
      out.toast = 'Le joueur est débarqué';
      break;
    }
    case 'ship.upgrade': {
      // Installer une amélioration (fabriquée par un charpentier) : l'objet est consommé.
      if (!canManageShip(p, ship, ctx.crew)) fail('Ce n’est pas ton bateau.');
      const s = p.inv[a.slot];
      const it = s && ITEMS[s[0]];
      if (!it || it.kind !== 'amelioration') fail('Choisis une amélioration dans ton inventaire.');
      const { type, amount } = it.upgrade;
      if (type === 'cale') ship.capacity += amount;
      if (type === 'canons') ship.cannons += amount;
      if (type === 'voile') ship.sail += amount;
      removeItem(p, s[0], 1);
      ship.upgrades.push({ item: s[0], type, amount, at: ctx.now || Date.now(), by: p.uid });
      out.toast = `${it.name} installée sur ${ship.name} : +${fmt(amount)} ${UPGRADES[type].unit}`;
      out.item = s[0];
      break;
    }
    default: fail('Action inconnue.');
  }
  return out;
}

/* ═══ Équipages ══════════════════════════════════════════════════════════ */
/** Permissions qu'un capitaine peut donner à un grade. Le capitaine les a toutes. */
export const CREW_PERMS = {
  bankIn: 'Déposer à la banque',
  bankOut: 'Retirer de la banque',
  invite: 'Inviter des joueurs',
  kick: 'Exclure des membres',
  ranks: 'Attribuer les grades',
  ship: 'Choisir le bateau',
  edit: 'Modifier le nom et le Jolly Roger',
};
export const DEFAULT_RANK = 'matelot'; // grade de base, renommable mais pas supprimable
const INVITE_TTL = 7 * 24 * 3600 * 1000;
const defaultRank = () => ({ id: DEFAULT_RANK, name: 'Matelot', perms: { bankIn: true } });
/** Permissions qui ont du sens selon le type : une flotte n'a pas de banque. */
export const permsFor = (c) => Object.fromEntries(Object.entries(CREW_PERMS).filter(([k]) => c?.kind !== 'flotte' || !k.startsWith('bank')));
/** Mots selon le type : « l’équipage » / « la flotte », etc. */
export function crewWords(c) {
  return c?.kind === 'flotte'
    ? { Nom: 'Flotte', le: 'la flotte', de: 'de la flotte', ce: 'cette flotte', un: 'une flotte', chef: 'commandant', Chef: 'Commandant' }
    : { Nom: 'Équipage', le: 'l’équipage', de: 'de l’équipage', ce: 'cet équipage', un: 'un équipage', chef: 'capitaine', Chef: 'Capitaine' };
}

export const CREW_KINDS = { equipage: 'Équipage', flotte: 'Flotte de la Marine' };
export const crewWord = (c) => (c?.kind === 'flotte' ? 'flotte' : 'équipage');
export function normalizeCrew(c) {
  c.kind = c.kind === 'flotte' ? 'flotte' : 'equipage';
  c.name = str(c.name, 60) || (c.kind === 'flotte' ? 'Flotte sans nom' : 'Équipage sans nom');
  c.flag ??= null; // Jolly Roger (image)
  c.members = [...new Set((c.members || []).map(String))];
  c.captain = c.captain && c.members.includes(String(c.captain)) ? String(c.captain) : c.members[0] ?? null;
  c.bank = c.kind === 'flotte' ? 0 : int(c.bank, 0, 1e13); // une flotte n'a pas de banque commune
  c.chest = Object.fromEntries(Object.entries(c.chest || {}).map(([k, q]) => [k, int(q, 0, 1e7)]).filter(([, q]) => q > 0));
  c.ship ??= null;
  // Grades
  c.ranks = (Array.isArray(c.ranks) ? c.ranks : [])
    .filter((r) => r && r.id)
    .map((r) => ({ id: String(r.id), name: str(r.name, 30) || 'Grade', perms: Object.fromEntries(Object.keys(CREW_PERMS).map((k) => [k, !!r.perms?.[k]])) }))
    .slice(0, 20);
  if (!c.ranks.some((r) => r.id === DEFAULT_RANK)) c.ranks.push({ ...defaultRank(), perms: Object.fromEntries(Object.keys(CREW_PERMS).map((k) => [k, !!defaultRank().perms[k]])) });
  const ids = new Set(c.ranks.map((r) => r.id));
  const mr = c.memberRanks || {};
  c.memberRanks = Object.fromEntries(c.members.map((u) => [u, ids.has(mr[u]) ? mr[u] : DEFAULT_RANK]));
  // Invitations (7 jours), jamais pour un membre
  const now = Date.now();
  c.invites = (c.invites || []).filter((i) => i && i.uid && !c.members.includes(String(i.uid)) && now - (i.at || 0) < INVITE_TTL).slice(-50);
  return c;
}
/** Le membre a-t-il cette permission ? Le capitaine a tout. */
export function crewCan(crew, uid, perm) {
  if (!crew || !crew.members.includes(uid)) return false;
  if (crew.captain === uid) return true;
  const r = crew.ranks.find((x) => x.id === crew.memberRanks[uid]);
  return !!r?.perms?.[perm];
}
export const rankName = (crew, uid) => (crew.captain === uid ? (crew.kind === 'flotte' ? 'Commandant' : 'Capitaine') : crew.ranks.find((r) => r.id === crew.memberRanks[uid])?.name ?? 'Matelot');
export const chestWeight = (c) => Object.entries(c.chest || {}).reduce((a, [k, q]) => a + itemWeight(k) * q, 0);
export const crewCapacity = (ship) => (ship ? ship.capacity : CHEST_BASE);

/**
 * Action d'un membre sur son équipage (banque, coffre, bateau d'équipage).
 * ctx : { crew, ships: { id: ship } } ; renvoie { player, crew, ships?, toast, item? }.
 */
export function crewAction(player, action, ctx = {}) {
  const p = clone(player), crew = ctx.crew ? normalizeCrew(clone(ctx.crew)) : null;
  const a = action || {};
  if (!crew || !crew.members.includes(p.uid)) fail(`Tu ne fais pas partie de ${crewWords(crew).ce}.`);
  const W = crewWords(crew);
  const need = (perm) => {
    if (!crewCan(crew, p.uid, perm)) fail(`Ton grade ne permet pas de : ${CREW_PERMS[perm].toLowerCase()}.`);
  };
  const isCap = crew.captain === p.uid;
  const ship = crew.ship ? ctx.ships?.[crew.ship] ?? null : null;
  const out = { player: p, crew, toast: null };
  switch (a.type) {
    case 'crew.bank.deposit': {
      if (crew.kind === 'flotte') fail('Une flotte n’a pas de banque commune.');
      need('bankIn');
      const n = int(a.amount, 0, 1e13);
      if (!n) fail('Indique un montant.');
      if (p.berry < n) fail('Pas assez de berrys.');
      p.berry -= n; crew.bank += n;
      out.toast = `${fmt(n)} berrys déposés dans la banque ${W.de}`;
      break;
    }
    case 'crew.bank.withdraw': {
      if (crew.kind === 'flotte') fail('Une flotte n’a pas de banque commune.');
      need('bankOut');
      const n = int(a.amount, 0, 1e13);
      if (!n) fail('Indique un montant.');
      if (crew.bank < n) fail('La banque n’a pas assez de berrys.');
      crew.bank -= n; p.berry += n;
      out.toast = `${fmt(n)} berrys retirés de la banque`;
      break;
    }
    case 'crew.chest.deposit': {
      const k = a.key, q = int(a.qty ?? 1, 1, 1e6);
      if (count(p, k) < q) fail('Tu n’as pas assez de cet objet.');
      if (freeCount(p, k) < q) fail('Retire-le d’abord de ton équipement.');
      const cap = crewCapacity(ship);
      if (chestWeight(crew) + itemWeight(k) * q > cap + 1e-9) fail(`Le coffre est trop chargé (${kg(chestWeight(crew))} / ${kg(cap)}).`);
      removeItem(p, k, q);
      crew.chest[k] = (crew.chest[k] || 0) + q;
      out.toast = `Déposé dans le coffre : ${q} × ${itemOf(k).name}`; out.item = k;
      break;
    }
    case 'crew.chest.withdraw': {
      const k = a.key, q = int(a.qty ?? 1, 1, 1e6);
      if ((crew.chest[k] || 0) < q) fail('Le coffre n’en contient pas assez.');
      if (!ITEMS[k]) fail('Objet supprimé : il ne peut plus être sorti.');
      if (!addItem(p, k, q)) fail('Ton inventaire est plein.');
      crew.chest[k] -= q;
      if (!crew.chest[k]) delete crew.chest[k];
      out.toast = `Sorti du coffre : ${q} × ${itemOf(k).name}`; out.item = k;
      break;
    }
    case 'crew.ship': {
      need('ship');
      if (!a.shipId) { crew.ship = null; out.toast = 'L’équipage n’a plus de bateau attitré'; break; }
      const s = clone(ctx.ships?.[a.shipId]);
      if (!s) fail('Bateau introuvable.');
      const mine = s.owner?.kind === 'player' && s.owner.id === p.uid;
      const ours = s.owner?.kind === 'crew' && s.owner.id === crew.id;
      if (!mine && !ours) fail(`Ce bateau n’appartient ni à toi ni à ${W.le}.`);
      if (chestWeight(crew) > s.capacity) fail(`Le coffre (${kg(chestWeight(crew))}) ne tient pas dans ce bateau (${kg(s.capacity)}).`);
      s.owner = { kind: 'crew', id: crew.id }; // le bateau devient celui de l'équipage
      crew.ship = a.shipId;
      out.ships = { [a.shipId]: s };
      out.toast = `${s.name} est maintenant le bateau ${W.de}`;
      break;
    }
    case 'crew.edit': {
      need('edit');
      if ('name' in a) {
        const n = str(a.name, 60);
        if (!n) fail(`Donne un nom à ${W.le}.`);
        crew.name = n;
      }
      if ('flag' in a) crew.flag = a.flag ? str(a.flag, 3_000_000) : null;
      out.toast = `${W.Nom} mis${crew.kind === 'flotte' ? 'e' : ''} à jour`;
      break;
    }
    case 'crew.rank.save': {
      if (!isCap) fail(`Seul le ${W.chef} crée et modifie les grades.`);
      const name = str(a.name, 30);
      if (!name) fail('Donne un nom au grade.');
      const perms = Object.fromEntries(Object.keys(CREW_PERMS).map((k) => [k, !!a.perms?.[k] && k in permsFor(crew)]));
      let r = a.id && crew.ranks.find((x) => x.id === a.id);
      if (r) Object.assign(r, { name, perms });
      else {
        if (crew.ranks.length >= 20) fail('20 grades maximum.');
        let id = slug(name), n = 2;
        while (crew.ranks.some((x) => x.id === id)) id = `${slug(name)}-${n++}`;
        r = { id, name, perms };
        crew.ranks.push(r);
      }
      out.toast = `Grade enregistré : ${name}`;
      break;
    }
    case 'crew.rank.delete': {
      if (!isCap) fail(`Seul le ${W.chef} supprime les grades.`);
      if (a.id === DEFAULT_RANK) fail('Le grade de base ne peut pas être supprimé (tu peux le renommer).');
      const r = crew.ranks.find((x) => x.id === a.id);
      if (!r) fail('Grade introuvable.');
      crew.ranks = crew.ranks.filter((x) => x !== r);
      for (const u of crew.members) if (crew.memberRanks[u] === r.id) crew.memberRanks[u] = DEFAULT_RANK;
      out.toast = `Grade supprimé : ${r.name}`;
      break;
    }
    case 'crew.rank.move': {
      if (!isCap) fail(`Seul le ${W.chef} organise les grades.`);
      const i = crew.ranks.findIndex((x) => x.id === a.id), j = i + (a.dir < 0 ? -1 : 1);
      if (i < 0) fail('Grade introuvable.');
      if (j < 0 || j >= crew.ranks.length) break;
      [crew.ranks[i], crew.ranks[j]] = [crew.ranks[j], crew.ranks[i]];
      break;
    }
    case 'crew.member.rank': {
      need('ranks');
      if (!crew.members.includes(a.uid)) fail(`Ce joueur n’est pas dans ${W.le}.`);
      if (a.uid === crew.captain) fail(`Le ${W.chef} n’a pas de grade à changer.`);
      if (!crew.ranks.some((x) => x.id === a.rankId)) fail('Grade introuvable.');
      if (!isCap && a.uid === p.uid) fail('Tu ne peux pas changer ton propre grade.');
      crew.memberRanks[a.uid] = a.rankId;
      out.toast = `Grade attribué : ${crew.ranks.find((x) => x.id === a.rankId).name}`;
      break;
    }
    case 'crew.invite': {
      need('invite');
      const u = String(a.uid || '');
      if (!u) fail('Choisis un joueur.');
      if (crew.kind === 'flotte' && a.faction && a.faction !== 'Marine') fail('Seuls les Marines peuvent rejoindre une flotte.');
      if (crew.members.includes(u)) fail(`Ce joueur est déjà dans ${W.le}.`);
      if (crew.invites.some((i) => i.uid === u)) fail('Ce joueur est déjà invité.');
      crew.invites.push({ uid: u, by: p.uid, at: ctx.now || Date.now() });
      out.toast = `Invitation envoyée${a.name ? ` à ${str(a.name, 60)}` : ''}`;
      break;
    }
    case 'crew.invite.cancel': {
      need('invite');
      crew.invites = crew.invites.filter((i) => i.uid !== a.uid);
      out.toast = 'Invitation annulée';
      break;
    }
    case 'crew.kick': {
      need('kick');
      if (!crew.members.includes(a.uid)) fail(`Ce joueur n’est pas dans ${W.le}.`);
      if (a.uid === crew.captain) fail(`On ne peut pas exclure le ${W.chef}.`);
      if (a.uid === p.uid) fail(`Pour partir, utilise « Quitter ${W.le} ».`);
      crew.members = crew.members.filter((u) => u !== a.uid);
      delete crew.memberRanks[a.uid];
      out.kicked = a.uid;
      out.toast = 'Membre exclu';
      break;
    }
    case 'crew.transfer': {
      if (!isCap) fail(`Seul le ${W.chef} peut céder sa place.`);
      if (!crew.members.includes(a.uid) || a.uid === p.uid) fail(`Choisis un autre membre ${W.de}.`);
      crew.captain = a.uid;
      crew.memberRanks[p.uid] = DEFAULT_RANK;
      out.toast = `Tu as cédé ta place de ${W.chef}`;
      break;
    }
    case 'crew.leave': {
      if (isCap && crew.members.length > 1) fail(`Cède d’abord ta place de ${W.chef} à un autre membre.`);
      crew.members = crew.members.filter((u) => u !== p.uid);
      delete crew.memberRanks[p.uid];
      if (isCap) crew.captain = null;
      p.crewId = null;
      out.left = true;
      out.toast = `Tu as quitté ${crew.name}`;
      break;
    }
    default: fail('Action inconnue.');
  }
  return out;
}

/**
 * Réponse d'un joueur à une invitation : rejoindre ou refuser.
 * ctx : { crew } (l'équipage qui invite). Renvoie { player, crew, toast }.
 */
export function inviteAction(player, action, ctx = {}) {
  const p = clone(player), crew = ctx.crew ? normalizeCrew(clone(ctx.crew)) : null;
  if (!crew || !crew.invites.some((i) => i.uid === p.uid)) fail('Cette invitation n’existe plus.');
  if (action.type === 'crew.join' && crew.kind === 'flotte' && p.id.faction !== 'Marine') fail('Seuls les Marines peuvent rejoindre une flotte.');
  crew.invites = crew.invites.filter((i) => i.uid !== p.uid);
  if (action.type === 'crew.decline') return { player: p, crew, toast: `Invitation de ${crew.name} refusée` };
  if (action.type !== 'crew.join') fail('Action inconnue.');
  crew.members.push(p.uid);
  crew.memberRanks[p.uid] = DEFAULT_RANK;
  if (!crew.captain) crew.captain = p.uid;
  const previous = p.crewId && p.crewId !== crew.id ? p.crewId : null;
  p.crewId = crew.id;
  return { player: p, crew, previous, toast: `Bienvenue dans ${crew.name} !` };
}

/* ═══ Mode démo (hors Discord) ═══════════════════════════════════════════ */
/** Petit catalogue d'exemple, seulement pour la démo : le vrai est vide au départ. */
export function demoCatalog() {
  return {
    items: {
      'bois-ex': { name: 'Bois (exemple)', kind: 'mat', value: 500, weight: 2, desc: 'Objet d’exemple de la démo.', img: null },
      'clous-ex': { name: 'Clous (exemple)', kind: 'mat', value: 200, weight: 0.5, desc: 'Objet d’exemple de la démo.', img: null },
      'tonneau-ex': { name: 'Tonneau (exemple)', kind: 'objet', value: 2000, weight: 15, desc: 'Objet d’exemple de la démo.', img: null },
      'sabre-ex': { name: 'Sabre (exemple)', kind: 'arme', value: 8000, weight: 3, desc: 'Une arme d’exemple.', img: null },
      'caravelle-ex': { name: 'Caravelle', kind: 'bateau', value: 150000, weight: 0, ship: { type: 'Caravelle', cannons: 0, capacity: 300, berths: 6, sail: 2 }, desc: 'Petit navire rapide, idéal pour débuter.', img: null },
      'cale-ex': { name: 'Extension de cale (exemple)', kind: 'amelioration', value: 20000, weight: 20, upgrade: { type: 'cale', amount: 200 }, desc: 'Fabriquée par un charpentier.', img: null },
    },
    recipes: {
      'cale-ex': { job: 'charpentier', lvl: 1, seconds: 30, needs: { 'bois-ex': 3, 'clous-ex': 2 }, gives: { 'cale-ex': 1 }, desc: 'Recette d’exemple : amélioration de bateau.' },
      'tonneau-ex': { job: 'charpentier', lvl: 1, seconds: 20, needs: { 'bois-ex': 2, 'clous-ex': 1 }, gives: { 'tonneau-ex': 1 }, desc: 'Recette d’exemple : 20 secondes.' },
    },
  };
}
export function demoPlayer() {
  return normalize({
    uid: 'demo', photo: null,
    id: { name: 'Elio Varenne', epithet: 'Le Brise-Lames', faction: 'Pirate', crew: 'Équipage du Goéland Noir', crewRole: 'Capitaine', grade: '3ème Classe', race: 'Humain', classe: 'Sabreur', bounty: 87000000 },
    level: 12, xp: 470, statPts: 3, berry: 412500,
    stats: { force: 24, rapidite: 31, resistance: 20, sdc: 27 }, volonte: 2,
    haki: { observation: 2, armement: 1, rois: null },
    fruit: { name: 'Shio Shio no Mi', type: 'Paramecia', stars: 2, desc: "Fait naître, durcit et façonne le sel." },
    job: { id: 'charpentier', lvl: 1 },
    techniques: [{ id: 1, name: 'Mur de sel', src: 'fruit', ok: true, media: null, desc: 'Une paroi de sel cristallisé jaillit devant lui.' }],
    crewId: 'goeland-noir',
    inv: [['sabre-ex', 1], ['bois-ex', 4], ['clous-ex', 2]],
    equip: { arme1: 'sabre-ex', arme2: null },
  });
}
export function demoShop() {
  return { channel: '#port-brisant', name: 'Comptoir de Port-Brisant', seller: 'Maman Rosa', face: '👵', img: null, buyRate: 0.4, difficulty: 0,
    items: [['bois-ex', 600, -1], ['clous-ex', 250, 20], ['sabre-ex', 9000, 2], ['caravelle-ex', 150000, 1]] };
}
export function demoCrew() {
  return normalizeCrew({ id: 'goeland-noir', name: 'Équipage du Goéland Noir', flag: null, captain: 'demo', members: ['demo', 'pnj-1'], bank: 25000, chest: { 'bois-ex': 6 }, ship: 'brise-lames' });
}
export function demoShips() {
  return {
    'brise-lames': normalizeShip({ name: 'Le Brise-Lames', desc: 'Le navire de l’équipage.', type: 'Brick', cannons: 8, capacity: 500, berths: 10, sail: 3, owner: { kind: 'crew', id: 'goeland-noir' }, position: { channelId: 'demo', name: 'port-brisant' }, created: 0 }),
    'mouette-pnj': normalizeShip({ name: 'La Mouette Rieuse', desc: 'Le bateau d’un autre joueur (démo).', type: 'Goélette', cannons: 2, capacity: 150, berths: 3, sail: 2, owner: { kind: 'player', id: 'pnj-3' }, position: { channelId: 'demo', name: 'port-brisant' }, created: 0 }),
  };
}
