/**
 * Moteur du jeu, partagé par l'API (Vercel), le mode démo du site et, via
 * l'API, par le bot. Tout est en fonctions pures : on donne un état, une action
 * et un contexte, on récupère le nouvel état. Aucune dépendance.
 *
 * Toutes les règles modifiables (prix, XP, chances...) sont en haut du fichier.
 */

/* ═══ Réglages ═══════════════════════════════════════════════════════════ */
export const BAG = 32; // emplacements d'inventaire
export const STAT_MAX = 100;
export const XP_NEED = (lv) => 100 + 40 * (lv - 1); // XP pour passer au niveau suivant
export const LEVEL_STAT_POINTS = 3; // points de stats gagnés à chaque niveau
export const NAV_CHANCE = 35; // % de chances qu'un message RP déclenche un événement
export const NAV_XP = 8; // XP par message RP en navigation
export const NAV_COOLDOWN_MS = 30_000; // un message compte au plus toutes les 30 s par joueur
export const NAV_LOG_MAX = 60; // entrées gardées dans le journal de bord
export const ASK_MAX = 160; // % maximum demandé à la vente
export const JOB_NEED = [100, 250]; // XP de métier pour passer Confirmé, puis Maître
export const JOB_LEVELS = ['Apprenti', 'Confirmé', 'Maître'];

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
export const RACES = ['Humain', 'Homme-poisson', 'Mink', 'Géant', 'Long-bras', 'Long-jambes', 'Skypiéen', 'Nain'];
export const CLASSES = ['Épéiste', 'Combattant', 'Tireur', 'Stratège', 'Soigneur', 'Voleur'];
export const FRUIT_TYPES = ['Paramecia', 'Zoan', 'Logia'];
export const SLOTS = { arme1: 'Arme 1', arme2: 'Arme 2' };
export const KIND = { conso: 'Consommable', mat: 'Matériau', tresor: 'Trésor', objet: 'Objet', arme: 'Arme', tenue: 'Tenue', accessoire: 'Accessoire' };
export const TECH_SOURCES = { physique: 'Physique', arme: 'Arme', haki: 'Haki', fruit: 'Fruit du démon' };

/* ═══ Objets ═════════════════════════════════════════════════════════════ */
export const ITEMS = {
  gigot: { name: 'Gigot de mer', icon: 291, kind: 'conso', value: 1200, desc: "De quoi tenir jusqu'à la prochaine île." },
  poisson: { name: 'Poisson frais', icon: 292, kind: 'conso', value: 600, desc: 'Pêché du matin.' },
  pain: { name: 'Pain de bord', icon: 298, kind: 'conso', value: 400, desc: 'Dur comme du bois au bout de trois jours.' },
  mandarine: { name: 'Mandarine', icon: 295, kind: 'conso', value: 300, desc: 'Cueillie sur une île du sud.' },
  rhum: { name: 'Tonneau de rhum', icon: 308, kind: 'conso', value: 3500, desc: 'Pour fêter une prime qui grimpe.' },
  onguent: { name: 'Onguent', icon: 208, kind: 'conso', value: 2500, desc: 'Soigne coupures et brûlures.' },
  remede: { name: 'Remède du médecin', icon: 192, kind: 'conso', value: 5000, desc: 'Soigne les blessures graves.' },
  antidote: { name: 'Antidote universel', icon: 221, kind: 'conso', value: 18000, desc: 'Neutralise presque tous les poisons connus.' },
  bombe: { name: 'Bombe à mèche', icon: 278, kind: 'conso', value: 9000, desc: 'Fait un trou dans une coque. Ou dans un mur.' },
  tonique: { name: 'Tonique de combat', icon: 212, kind: 'conso', value: 15000, desc: 'Les muscles chauffent, la peur s’en va.' },
  bois: { name: 'Bois de charpente', icon: 331, kind: 'mat', value: 700, desc: 'Du chêne d’Adam, ou presque.' },
  minerai: { name: 'Minerai de fer', icon: 330, kind: 'mat', value: 2000, desc: 'Brut, lourd, indispensable à la forge.' },
  cuir: { name: 'Cuir tanné', icon: 333, kind: 'mat', value: 1800, desc: 'Pour les poignées et les fourreaux.' },
  tissu: { name: 'Rouleau de tissu', icon: 332, kind: 'mat', value: 800, desc: 'Toile solide.' },
  herbes: { name: 'Herbes médicinales', icon: 200, kind: 'mat', value: 1500, desc: 'Cueillies sur une île tropicale.' },
  papier: { name: 'Papier vierge', icon: 236, kind: 'mat', value: 500, desc: 'Pour cartes et journaux de bord.' },
  cordage: { name: 'Cordage de chanvre', icon: 275, kind: 'mat', value: 900, desc: 'Vingt mètres, prêt pour l’abordage.' },
  cristal: { name: 'Cristal magnétique', icon: 343, kind: 'mat', value: 30000, desc: 'Réagit au champ magnétique des îles.' },
  granit: { name: 'Granit marin', icon: 350, kind: 'mat', value: 1500000, desc: 'Émet l’énergie de la mer. Neutralise les fruits du démon.' },
  poudre: { name: 'Poudre noire', icon: 348, kind: 'mat', value: 2500, desc: 'Instable. Garder loin des lanternes.' },
  carte_m: { name: 'Carte marine', icon: 227, kind: 'objet', value: 8000, desc: 'Courants et récifs d’une zone du Grand Line.' },
  carte: { name: 'Carte au trésor', icon: 231, kind: 'tresor', value: 45000, desc: 'Une croix rouge sur une île absente des autres cartes.' },
  pepites: { name: "Pépites d'or", icon: 344, kind: 'tresor', value: 12000, desc: 'Ramassées au fond d’une épave.' },
  piece: { name: 'Pièce ancienne', icon: 361, kind: 'tresor', value: 25000, desc: 'Frappée par un royaume disparu.' },
  lingot: { name: "Lingot d'or", icon: 360, kind: 'tresor', value: 500000, desc: 'Se revend à n’importe quel comptoir.' },
  estampage: { name: 'Estampage de stèle', icon: 229, kind: 'tresor', value: 90000, desc: 'Le relevé d’une inscription que personne ne sait lire.' },
  lettre: { name: 'Bouteille à la mer', icon: 237, kind: 'objet', value: 1000, desc: 'Un message illisible, cacheté de cire noire.' },
  avis: { name: 'Premier avis de recherche', icon: 233, kind: 'objet', value: 0, desc: 'Ta toute première prime. On garde ça.' },
  cle: { name: 'Clé rouillée', icon: 240, kind: 'objet', value: 500, desc: 'Elle ouvre quelque chose, quelque part.' },
  pelle: { name: 'Pelle', icon: 277, kind: 'objet', value: 2500, desc: 'Pour creuser là où la carte l’indique.' },
  chaloupe: { name: 'Kit de chaloupe', icon: 266, kind: 'objet', value: 30000, desc: 'Une petite embarcation, prête à être assemblée.' },
  tonneau: { name: 'Tonneau vide', icon: 268, kind: 'objet', value: 1500, desc: 'Utile pour stocker… ou flotter.' },
  sabre: { name: 'Sabre d’abordage', icon: 147, kind: 'arme', slot: 'arme', value: 8000, desc: 'Court, lourd, efficace sur un pont encombré.' },
  pistolet: { name: 'Pistolet à silex', icon: 153, kind: 'arme', slot: 'arme', value: 25000, desc: 'Un coup, puis le temps de recharger.' },
  katana_bf: { name: 'Katana de bonne facture', icon: 398, kind: 'arme', slot: 'arme', value: 60000, desc: 'Équilibré, fiable, sans nom.' },
  katana: { name: 'Katana « Brise-Écume »', icon: 395, kind: 'arme', slot: 'arme', value: 380000, desc: 'Forgé pour couper les vagues.' },
  lame_gm: { name: 'Lame de granit marin', icon: 393, kind: 'arme', slot: 'arme', value: 900000, desc: 'Chaque coup affaiblit les mangeurs de fruit.' },
  veste: { name: 'Veste de capitaine', icon: 442, kind: 'tenue', value: 20000, desc: 'Portée sur les épaules, jamais enfilée.' },
  manteau: { name: 'Manteau de voyage', icon: 444, kind: 'tenue', value: 12000, desc: 'Coupe le vent et les embruns.' },
  chapeau: { name: 'Chapeau de paille', icon: 162, kind: 'accessoire', value: 500, desc: 'Léger. Rien de plus… pour l’instant.' },
  bague: { name: 'Bague du forgeron', icon: 176, kind: 'accessoire', value: 40000, desc: 'Gravée de runes de forge.' },
  logpose: { name: 'Log Pose', icon: 188, kind: 'accessoire', value: 120000, desc: 'Indique l’île suivante une fois le champ magnétique enregistré.' },
};

/* ═══ Métiers ════════════════════════════════════════════════════════════ */
export const JOBS = {
  medecin: { name: 'Médecin', pic: 'stetho', desc: "Soigne l'équipage et prépare remèdes et antidotes.", actions: [
    { id: 'onguent', lvl: 1, name: 'Préparer un onguent', desc: 'Pour les coupures du quotidien.', needs: { herbes: 2 }, gives: { onguent: 1 }, xp: 15, jxp: 30 },
    { id: 'remede', lvl: 2, name: 'Préparer un remède', desc: 'Pour les blessures qui ne se referment pas seules.', needs: { herbes: 3, rhum: 1 }, gives: { remede: 1 }, xp: 30, jxp: 45 },
    { id: 'antidote', lvl: 3, name: 'Préparer un antidote universel', desc: 'Des années de recherche dans une fiole.', needs: { herbes: 5, cristal: 1 }, gives: { antidote: 1 }, xp: 60, jxp: 0 },
  ] },
  scientifique: { name: 'Scientifique', pic: 'potion', desc: "Expérimente, distille et invente ce que personne n'a encore osé.", actions: [
    { id: 'poudre', lvl: 1, name: 'Préparer de la poudre noire', desc: 'Le b.a.-ba de tout bon scientifique de bord.', needs: { minerai: 1, herbes: 1 }, gives: { poudre: 2 }, xp: 15, jxp: 30 },
    { id: 'bombe', lvl: 2, name: 'Fabriquer des bombes', desc: 'De la poudre, un tonneau, une mèche. Et beaucoup de prudence.', needs: { poudre: 2, tonneau: 1 }, gives: { bombe: 2 }, xp: 30, jxp: 45 },
    { id: 'tonique', lvl: 3, name: 'Synthétiser un tonique de combat', desc: 'La formule tient sur une ligne. Il a fallu dix ans pour l’écrire.', needs: { herbes: 3, cristal: 1, rhum: 1 }, gives: { tonique: 1 }, xp: 60, jxp: 0 },
  ] },
  navigateur: { name: 'Navigateur', pic: 'compass', desc: 'Lit le ciel et les courants, trace les cartes et garde le cap.', actions: [
    { id: 'meteo', lvl: 1, name: 'Lire la météo', desc: 'Pendant tes 3 prochains événements en mer, les mauvaises rencontres sont deux fois moins probables.', needs: {}, gives: {}, effect: 'meteo', xp: 10, jxp: 20 },
    { id: 'carte', lvl: 2, name: 'Tracer une carte marine', desc: 'Relever courants et récifs de la zone.', needs: { papier: 2 }, gives: { carte_m: 1 }, xp: 30, jxp: 45 },
    { id: 'logpose', lvl: 3, name: 'Calibrer un Log Pose', desc: 'Accorder un cristal au champ magnétique des îles.', needs: { cristal: 1, carte_m: 1 }, gives: { logpose: 1 }, xp: 60, jxp: 0 },
  ] },
  archeologue: { name: 'Archéologue', pic: 'tmap', desc: "Déchiffre les écrits anciens et retrouve ce que l'histoire a enterré.", actions: [
    { id: 'bouteille', lvl: 1, name: 'Déchiffrer une bouteille à la mer', desc: 'Le message cache parfois bien plus qu’il n’y paraît.', needs: { lettre: 1 }, gives: { carte: 1 }, xp: 20, jxp: 30 },
    { id: 'fouille', lvl: 2, name: 'Suivre une carte au trésor', desc: 'Creuser là où la croix l’indique.', needs: { carte: 1 }, tools: { pelle: 1 }, gives: { piece: 2, pepites: 3 }, xp: 45, jxp: 45 },
    { id: 'stele', lvl: 3, name: 'Relever une stèle ancienne', desc: 'Recopier une inscription que personne ne sait lire.', needs: { papier: 3, carte_m: 1 }, gives: { estampage: 1 }, xp: 70, jxp: 0 },
  ] },
  charpentier: { name: 'Charpentier', pic: 'hammer', desc: 'Construit, répare et entretient le navire.', actions: [
    { id: 'tonneau', lvl: 1, name: 'Fabriquer un tonneau', desc: 'Toujours utile à bord.', needs: { bois: 2 }, gives: { tonneau: 1 }, xp: 15, jxp: 30 },
    { id: 'coque', lvl: 2, name: 'Renforcer la coque', desc: 'Pendant tes 3 prochains événements en mer, les mauvaises rencontres sont deux fois moins probables.', needs: { bois: 3, cordage: 1 }, gives: {}, effect: 'coque', xp: 30, jxp: 45 },
    { id: 'chaloupe', lvl: 3, name: 'Construire une chaloupe', desc: 'Une embarcation complète, de la quille au mât.', needs: { bois: 8, cordage: 2, tissu: 2 }, gives: { chaloupe: 1 }, xp: 60, jxp: 0 },
  ] },
  forgeron: { name: 'Forgeron', pic: 'sabre', desc: "Façonne et répare les armes de l'équipage.", actions: [
    { id: 'sabre', lvl: 1, name: 'Forger un sabre', desc: 'Une lame simple mais solide.', needs: { minerai: 3, bois: 1 }, gives: { sabre: 1 }, xp: 25, jxp: 30 },
    { id: 'katana', lvl: 2, name: 'Forger un katana', desc: 'Plier l’acier cent fois.', needs: { minerai: 5, cuir: 1 }, gives: { katana_bf: 1 }, xp: 40, jxp: 45 },
    { id: 'granit', lvl: 3, name: 'Forger une lame de granit marin', desc: 'Le travail d’une vie.', needs: { granit: 1, minerai: 5, cuir: 2 }, gives: { lame_gm: 1 }, xp: 80, jxp: 0 },
  ] },
};

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
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

/* ═══ Personnage ═════════════════════════════════════════════════════════ */
/** Fiche vierge, créée au premier /profil. Le staff la remplit ensuite. */
export function newPlayer(uid, name = 'Nouveau pirate') {
  return normalize({
    uid,
    id: { first: str(name, 40), last: '', epithet: '', faction: 'Pirate', crew: '', crewRole: '', grade: 'Matelot', race: 'Humain', classe: 'Combattant', bounty: 0 },
    level: 1, xp: 0, statPts: 0, berry: 1000,
    stats: { force: 10, rapidite: 10, resistance: 10, sdc: 10 },
    volonte: 0, haki: { observation: 0, armement: 0, rois: null }, fruit: null,
    job: { id: 'navigateur', lvl: 1, xp: 0 },
    techniques: [], inv: [], equip: { arme1: null, arme2: null },
  });
}

/** Complète une fiche (anciennes données, champs manquants). */
export function normalize(p) {
  p.photo ??= null;
  p.id ??= {};
  p.stats ??= {};
  for (const s of STATS) p.stats[s.key] ??= 10;
  p.volonte ??= 0;
  p.haki ??= {};
  for (const h of HAKI) if (!(h.key in p.haki)) p.haki[h.key] = h.key === 'rois' ? null : 0;
  p.fruit ??= null;
  p.job ??= { id: 'navigateur', lvl: 1, xp: 0 };
  if (!JOBS[p.job.id]) p.job.id = 'navigateur';
  p.techniques ??= [];
  p.inv ??= [];
  p.inv = p.inv.slice(0, BAG).map((s) => (s && ITEMS[s[0]] && s[1] > 0 ? s : null));
  while (p.inv.length < BAG) p.inv.push(null);
  p.equip ??= { arme1: null, arme2: null };
  p.effects ??= { meteo: 0, coque: 0 };
  p.sellLock ??= {};
  p.navCd ??= 0;
  fixEquip(p);
  return p;
}

export const fullName = (p) => [p.id.first, p.id.last].filter(Boolean).join(' ') || 'Inconnu';
export const count = (p, k) => p.inv.reduce((a, s) => a + (s && s[0] === k ? s[1] : 0), 0);
export const equippedCount = (p, k) => Object.values(p.equip).filter((x) => x === k).length;
export const isEquipped = (p, k) => Object.values(p.equip).includes(k);

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
    if (k && (!ITEMS[k] || equippedCount(p, k) > count(p, k))) p.equip[sl] = null;
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

/* ═══ Boutiques ══════════════════════════════════════════════════════════ */
/** Boutique vierge, créée par le staff dans un salon. */
export function newShop(channelName = '') {
  return { channel: channelName ? `#${channelName}` : '#salon', name: 'Comptoir', seller: 'Le marchand', face: '🧔', img: null, buyRate: 0.4, difficulty: 0, items: [['gigot', 1200, -1]] };
}
export function normalizeShop(s) {
  s.items = (s.items || []).filter((x) => ITEMS[x[0]]).map(([k, price, stock]) => [k, int(price, 0, 1e11), stock < 0 ? -1 : int(stock, 0, 1e6)]);
  s.buyRate = Math.min(1, Math.max(0.05, Number(s.buyRate) || 0.4));
  s.difficulty = int(s.difficulty ?? 0, 0, 50);
  return s;
}
export const refPrice = (shop, k) => Math.max(1, Math.round(ITEMS[k].value * shop.buyRate));
/** Chance que le vendeur accepte : 100 % au prix de référence, chute vite au-delà. */
export function sellChance(shop, pct) {
  if (pct <= 100) return 100;
  const x = (pct - 100) / (ASK_MAX - 100);
  return Math.max(3, Math.round(100 * Math.pow(1 - x, 1.6) - (shop?.difficulty || 0) * x));
}

/* ═══ Navigation ═════════════════════════════════════════════════════════ */
export const newNav = () => ({ active: false, log: [] });

const EV = {
  calme: { w: 5, tone: 'calm', icon: 99, title: 'Mer d’huile', text: () => 'Pas un souffle de vent. L’équipage en profite pour souffler.',
    auto: () => ({ xp: 5, text: '+5 XP' }) },
  poissons: { w: 3, tone: 'good', icon: 292, title: 'Banc de poissons', text: () => 'Des centaines de poissons argentés filent sous la coque.',
    auto: (p, rng) => { const n = 2 + Math.floor(rng() * 3); addItem(p, 'poisson', n); return { xp: 10, text: `+${n} Poisson frais, +10 XP` }; } },
  coffre: { w: 2, tone: 'good', icon: 270, title: 'Coffre à la dérive', text: () => 'Un coffre cerclé de fer flotte à tribord.',
    auto: (p, rng) => { const r = d(rng, 100); const it = r > 92 ? 'carte' : r > 60 ? 'piece' : 'pepites'; addItem(p, it, 1); return { xp: 20, text: `+1 ${ITEMS[it].name}, +20 XP` }; } },
  bouteille: { w: 2, tone: 'good', icon: 237, title: 'Bouteille à la mer', text: () => 'Une bouteille cachetée de cire noire heurte la coque.',
    auto: (p) => { addItem(p, 'lettre', 1); return { xp: 10, text: '+1 Bouteille à la mer, +10 XP' }; } },
  ile: { w: 2, tone: 'good', icon: 206, title: 'Île à l’horizon', text: () => 'Une petite île couverte de palmiers. Le temps d’une escale…',
    auto: (p) => { addItem(p, 'bois', 2); addItem(p, 'herbes', 2); return { xp: 15, text: '+2 Bois de charpente, +2 Herbes médicinales, +15 XP' }; } },
  tempete: { w: 3, tone: 'bad', icon: 101, title: 'Tempête soudaine', text: () => 'Le ciel vire au noir en quelques minutes. Les vagues dépassent le mât.', choices: [
    { label: 'Tenir la barre', stat: 'resistance', dc: 14, win: () => ({ xp: 35, text: 'Le navire tient bon. +35 XP' }),
      lose: (p, rng) => { const pool = p.inv.filter((s) => s && ITEMS[s[0]].kind === 'conso'); if (!pool.length) return { xp: 5, text: 'Le pont est balayé, mais rien n’est perdu. +5 XP' }; const [k] = pick(rng, pool); removeItem(p, k, 1); return { xp: 5, text: `Une vague emporte 1 ${ITEMS[k].name}. +5 XP` }; } },
    { label: 'Se mettre à l’abri', safe: true, win: () => ({ xp: 5, text: 'Vous attendez que ça passe. +5 XP' }) },
  ] },
  navire: { w: 3, tone: 'bad', icon: 115, title: 'Voile à l’horizon', text: (p) => (p.id.faction === 'Marine' ? 'Un pavillon pirate se rapproche. Ils vous ont repérés.' : 'Un navire de la Marine change de cap et fonce sur vous.'), choices: [
    { label: 'Engager le combat', stat: ['force', 'sdc'], dc: 16,
      win: (p, rng) => { const gain = 15000 + Math.floor(rng() * 10000); p.berry += gain; let t = `Victoire ! +${fmt(gain)} berrys, +60 XP`; if (p.id.faction === 'Pirate') { p.id.bounty = (p.id.bounty || 0) + 2000000; t += ', prime +2.000.000'; } return { xp: 60, text: t }; },
      lose: (p) => { const loss = Math.min(p.berry, 5000); p.berry -= loss; return { xp: 10, text: `Repli forcé. −${fmt(loss)} berrys, +10 XP` }; } },
    { label: 'Prendre la fuite', stat: 'rapidite', dc: 12, win: () => ({ xp: 15, text: 'Vous les semez dans les récifs. +15 XP' }),
      lose: (p) => { const loss = Math.min(p.berry, 3000); p.berry -= loss; return { xp: 5, text: `Ils vous rattrapent, il faut payer pour passer. −${fmt(loss)} berrys` }; } },
  ] },
  monstre: { w: 2, tone: 'bad', icon: 120, title: 'Monstre marin', text: () => 'Une ombre gigantesque passe sous le navire, puis une gueule surgit de l’eau.', choices: [
    { label: 'Trancher', stat: 'sdc', dc: 16, win: (p) => { addItem(p, 'gigot', 3); return { xp: 80, text: 'Le monstre coule. Ce soir, c’est grillade : +3 Gigot de mer, +80 XP' }; },
      lose: () => ({ xp: 10, text: 'Il vous projette contre le bastingage avant de replonger. +10 XP' }) },
    { label: 'Haki de l’observation', haki: 'observation', dc: 14, win: () => ({ xp: 40, text: 'Tu sens où il va frapper : le navire l’évite. +40 XP' }),
      lose: () => ({ xp: 5, text: 'Trop tard, la coque encaisse le choc. +5 XP' }) },
  ] },
  brouillard: { w: 2, tone: 'calm', icon: 103, title: 'Brouillard épais', text: () => 'On ne voit plus la proue depuis la poupe.', choices: [
    { label: 'Naviguer à l’instinct', vol: true, dc: 13, win: (p) => { addItem(p, 'herbes', 1); addItem(p, 'cristal', 1); return { xp: 45, text: 'Vous débouchez sur une crique inconnue : +1 Cristal magnétique, +1 Herbes, +45 XP' }; },
      lose: () => ({ xp: 5, text: 'Vous tournez en rond jusqu’au matin. +5 XP' }) },
    { label: 'Jeter l’ancre et attendre', safe: true, win: () => ({ xp: 5, text: 'Le brouillard se lève à l’aube. +5 XP' }) },
  ] },
};
export const EVENT_ICONS = Object.fromEntries(Object.entries(EV).map(([k, v]) => [k, v.icon]));

function choiceHint(p, c) {
  if (c.safe) return 'sans risque';
  if (c.vol) return `Volonté ${p.volonte}★ · DD ${c.dc}`;
  if (c.haki) return `Haki ${p.haki[c.haki] ?? 0}★ · DD ${c.dc}`;
  return `${[].concat(c.stat).map((k) => STATS.find((s) => s.key === k).name).join(' + ')} · DD ${c.dc}`;
}

/** Vue d'un événement, telle que l'affichent le site et le bot. */
export function eventView(entry, p) {
  const ev = EV[entry.ev];
  if (!ev) return null;
  return {
    id: entry.id, uid: entry.uid, name: entry.name, tone: ev.tone, icon: ev.icon, title: ev.title,
    text: entry.text || ev.text(p || { id: {} }),
    choices: entry.result ? [] : (ev.choices || []).map((c, i) => ({ i, label: c.label, hint: p ? choiceHint(p, c) : '' })),
    result: entry.result || null, roll: entry.roll || null,
  };
}

function pickEvent(p, rng) {
  const pool = Object.entries(EV).map(([id, ev]) => {
    let w = ev.w * 10;
    if (ev.tone === 'bad') { if (p.effects.meteo > 0) w /= 2; if (p.effects.coque > 0) w /= 2; }
    return [id, Math.max(1, w)];
  });
  let r = rng() * pool.reduce((a, [, w]) => a + w, 0);
  for (const [id, w] of pool) if ((r -= w) <= 0) return id;
  return pool[0][0];
}
const pushLog = (nav, entry) => { nav.log.push(entry); if (nav.log.length > NAV_LOG_MAX) nav.log.splice(0, nav.log.length - NAV_LOG_MAX); };

/**
 * Un joueur écrit un message RP dans un salon où la navigation est active.
 * Renvoie l'événement déclenché (ou null), l'XP gagnée et les niveaux.
 */
export function navMessage(player, nav, { rng = Math.random, now = Date.now(), ignoreCooldown = false } = {}) {
  const p = clone(player), n = clone(nav) || newNav();
  if (!n.active) return { player: p, nav: n, entry: null, ups: 0, counted: false };
  if (!ignoreCooldown && now - (p.navCd || 0) < NAV_COOLDOWN_MS) return { player: p, nav: n, entry: null, ups: 0, counted: false };
  p.navCd = now;
  let ups = gainXP(p, NAV_XP);
  let entry = null;
  if (d(rng, 100) <= NAV_CHANCE) {
    const evId = pickEvent(p, rng), ev = EV[evId];
    entry = { t: 'ev', id: `${now.toString(36)}${Math.floor(rng() * 1e6).toString(36)}`, ev: evId, uid: p.uid, name: fullName(p), at: now, text: ev.text(p) };
    if (ev.auto) { const r = ev.auto(p, rng); entry.result = r.text; ups += gainXP(p, r.xp); }
    if (p.effects.meteo > 0) p.effects.meteo--;
    if (p.effects.coque > 0) p.effects.coque--;
    pushLog(n, entry);
  }
  return { player: p, nav: n, entry, ups, counted: true };
}

/** Le joueur choisit une option d'un événement qui le concerne. */
export function navChoose(player, nav, entryId, choiceIdx, { rng = Math.random } = {}) {
  const p = clone(player), n = clone(nav);
  const entry = n?.log.find((e) => e.id === entryId);
  if (!entry) fail('Cet événement n’existe plus.');
  if (entry.uid !== p.uid) fail('Cet événement concerne un autre joueur.');
  if (entry.result) fail('Ce choix a déjà été fait.');
  const c = EV[entry.ev]?.choices?.[choiceIdx];
  if (!c) fail('Choix invalide.');
  let res;
  if (c.safe) res = c.win(p, rng);
  else {
    const r = d(rng, 20);
    const stats = [].concat(c.stat || []);
    const bonus = c.vol ? p.volonte * 3 : c.haki ? (p.haki[c.haki] ?? 0) * 3 : Math.floor(stats.reduce((a, k) => a + p.stats[k], 0) / stats.length / 5);
    const total = r + bonus, ok = total >= c.dc;
    res = ok ? c.win(p, rng) : c.lose(p, rng);
    entry.roll = `d20 ${r} + ${bonus} = ${total} ${ok ? '≥' : '<'} ${c.dc}`;
    entry.ok = ok;
  }
  entry.result = `${c.label} : ${res.text}`;
  const ups = gainXP(p, res.xp);
  return { player: p, nav: n, entry, ups };
}

/* ═══ Actions des joueurs ════════════════════════════════════════════════ */
/**
 * Applique une action du joueur sur SA fiche.
 * ctx : { rng, now, channelId, shop, nav }
 * Renvoie { player, shop?, nav?, toast, icon, ups }.
 */
export function playerAction(player, action, ctx = {}) {
  const p = clone(player);
  const rng = ctx.rng || Math.random;
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
      out.toast = `Jeté par-dessus bord : ${ITEMS[s[0]].name}`;
      break;
    }
    case 'equip': {
      const k = a.key, it = ITEMS[k];
      if (!it || !count(p, k)) fail('Tu n’as pas cet objet.');
      if (it.slot !== 'arme') fail(`${it.name} n’est pas une arme.`);
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
        out.toast = `Retiré : ${it.name}`; out.icon = it.icon;
        break;
      } else {
        slot = !p.equip.arme1 ? 'arme1' : !p.equip.arme2 ? 'arme2' : null;
        if (!slot) fail('Tu portes déjà deux armes : retires-en une d’abord.');
        p.equip[slot] = k;
      }
      out.toast = `Équipé : ${it.name}`; out.icon = it.icon; out.slot = slot;
      break;
    }
    case 'unequip': {
      if (!SLOTS[a.slot] || !p.equip[a.slot]) fail('Rien à retirer.');
      const it = ITEMS[p.equip[a.slot]];
      p.equip[a.slot] = null;
      out.toast = `Retiré : ${it.name}`; out.icon = it.icon;
      break;
    }
    case 'job.do': {
      const job = JOBS[p.job.id], act = job.actions.find((x) => x.id === a.id);
      if (!act) fail('Action inconnue.');
      if (act.lvl > p.job.lvl) fail(`Demande le niveau ${JOB_LEVELS[act.lvl - 1]}.`);
      for (const [k, q] of Object.entries({ ...act.needs, ...(act.tools || {}) })) if (count(p, k) < q) fail('Objets manquants.');
      for (const [k, q] of Object.entries(act.needs)) removeItem(p, k, q);
      for (const [k, q] of Object.entries(act.gives)) if (!addItem(p, k, q)) fail('Inventaire plein.');
      if (act.effect) p.effects[act.effect] = 3;
      if (JOB_NEED[p.job.lvl - 1] != null) p.job.xp += act.jxp;
      out.ups = gainXP(p, act.xp);
      const got = Object.entries(act.gives).map(([k, q]) => `${q} × ${ITEMS[k].name}`).join(', ');
      out.toast = got ? `Fabriqué : ${got}` : act.effect === 'meteo' ? 'Tu as lu le ciel : 3 événements en mer adoucis' : 'Coque renforcée : 3 événements en mer adoucis';
      out.icon = Object.keys(act.gives)[0] ? ITEMS[Object.keys(act.gives)[0]].icon : job.pic;
      break;
    }
    case 'job.up': {
      const need = JOB_NEED[p.job.lvl - 1];
      if (need == null || p.job.xp < need) fail('Pas encore assez d’expérience de métier.');
      p.job.xp -= need; p.job.lvl++;
      out.toast = `${JOBS[p.job.id].name} : tu passes ${JOB_LEVELS[p.job.lvl - 1]} !`; out.icon = JOBS[p.job.id].pic;
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
        p.techniques.push({ id: Date.now() + Math.floor(rng() * 1000), media: null, ...data });
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
      if (!row) fail('Cet objet n’est pas vendu ici.');
      const [k, price, stock] = row;
      if (stock === 0) fail('Épuisé.');
      if (p.berry < price) fail('Pas assez de berrys.');
      if (!addItem(p, k, 1)) fail('Inventaire plein.');
      p.berry -= price;
      if (stock > 0) row[2]--;
      out.shop = shop; out.toast = `Acheté : ${ITEMS[k].name}`; out.icon = ITEMS[k].icon; out.delta = -price;
      break;
    }
    case 'shop.sell': {
      const shop = ctx.shop;
      if (!shop) fail('Pas de boutique dans ce salon.');
      const k = a.key, it = ITEMS[k];
      if (!it || !count(p, k)) fail('Tu n’as pas cet objet.');
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
          out.refused = true; out.toast = `Jet ${r} > ${chance} : ${shop.seller} refuse de payer ${fmt(price)} pour ${it.name}`; out.icon = it.icon;
          break;
        }
      }
      removeItem(p, k, 1); p.berry += price;
      out.toast = pct > 100 ? `${shop.seller} accepte : vendu ${fmt(price)}` : `Vendu : ${it.name}`; out.icon = it.icon; out.delta = price;
      break;
    }
    case 'nav.toggle': {
      const nav = clone(ctx.nav) || newNav();
      nav.active = !nav.active;
      pushLog(nav, { t: 'sys', at: ctx.now || Date.now(), text: nav.active ? `⚓ ${fullName(p)} lève l’ancre. La navigation commence.` : `⚓ ${fullName(p)} jette l’ancre. Fin de la navigation.` });
      out.nav = nav;
      break;
    }
    case 'nav.choose': {
      const r = navChoose(p, ctx.nav, a.entryId, a.choice, { rng });
      Object.assign(p, r.player); out.player = p; out.nav = r.nav; out.ups = r.ups; out.entry = r.entry;
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
      if ('first' in id || 'last' in id) {
        const first = str(id.first ?? p.id.first, 40), last = str(id.last ?? p.id.last, 40);
        if (!first && !last) fail('Indique au moins un prénom ou un nom.');
        p.id.first = first; p.id.last = last;
      }
      if ('epithet' in id) p.id.epithet = str(id.epithet, 40);
      if ('faction' in id && FACTIONS.includes(id.faction)) p.id.faction = id.faction;
      if ('crew' in id) p.id.crew = str(id.crew, 60);
      if ('crewRole' in id) p.id.crewRole = str(id.crewRole, 40);
      if ('grade' in id && GRADES.includes(id.grade)) p.id.grade = id.grade;
      if ('race' in id && RACES.includes(id.race)) p.id.race = id.race;
      if ('classe' in id && CLASSES.includes(id.classe)) p.id.classe = id.classe;
      if ('bounty' in id) p.id.bounty = int(id.bounty, 0, 1e12);
      if ('job' in x && JOBS[x.job] && x.job !== p.job.id) p.job = { id: x.job, lvl: 1, xp: 0 };
      if ('jobLvl' in x) p.job.lvl = int(x.jobLvl, 1, 3);
      if ('fruit' in x) {
        const f = x.fruit;
        p.fruit = f && str(f.name, 60)
          ? { name: str(f.name, 60), type: FRUIT_TYPES.includes(f.type) ? f.type : 'Paramecia', stars: int(f.stars ?? p.fruit?.stars ?? 1, 0, 5), desc: str(f.desc ?? (p.fruit?.name === f.name ? p.fruit.desc : ''), 400) }
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

/** Fiche de démonstration (mode démo hors Discord). */
export function demoPlayer() {
  return normalize({
    uid: 'demo', photo: null,
    id: { first: 'Elio', last: 'Varenne', epithet: 'Le Brise-Lames', faction: 'Pirate', crew: 'Équipage du Goéland Noir', crewRole: 'Capitaine', grade: 'Matelot', race: 'Humain', classe: 'Épéiste', bounty: 87000000 },
    level: 12, xp: 470, statPts: 3, berry: 412500,
    stats: { force: 24, rapidite: 31, resistance: 20, sdc: 27 }, volonte: 2,
    haki: { observation: 2, armement: 1, rois: null },
    fruit: { name: 'Shio Shio no Mi', type: 'Paramecia', stars: 2, desc: "Fait naître, durcit et façonne le sel, y compris celui qu'il arrache à la mer." },
    job: { id: 'forgeron', lvl: 1, xp: 70 },
    techniques: [
      { id: 1, name: 'Mur de sel', src: 'fruit', ok: true, media: null, desc: 'Une paroi de sel cristallisé jaillit devant lui. Encaisse un boulet de canon, pas deux.' },
      { id: 2, name: 'Tempête cristalline', src: 'fruit', ok: true, media: null, desc: "Une nuée d'éclats de sel tranchants dans un rayon de vingt mètres." },
      { id: 3, name: 'Coupe des abysses', src: 'arme', ok: true, media: null, desc: "Un seul coup de lame, à ras de l'eau, qui ouvre une vague en deux." },
    ],
    inv: [['sabre', 1], ['veste', 1], ['chapeau', 1], ['pistolet', 1], ['minerai', 4], ['bois', 2], ['cuir', 1], null, ['gigot', 2], ['poisson', 3], ['mandarine', 6], ['rhum', 2], ['herbes', 2], ['pepites', 3], ['avis', 1], ['cle', 1]],
    equip: { arme1: 'sabre', arme2: null },
  });
}
export function demoShop() {
  return { channel: '#port-brisant', name: 'Comptoir de Port-Brisant', seller: 'Maman Rosa', face: '👵', img: null, buyRate: 0.4, difficulty: 0,
    items: [['gigot', 1200, -1], ['poisson', 600, -1], ['pain', 400, -1], ['rhum', 3500, -1], ['cordage', 900, 20], ['bois', 700, 30], ['tissu', 800, 15], ['herbes', 1500, 12], ['papier', 500, -1], ['pelle', 2500, 6], ['remede', 5000, 5], ['sabre', 8000, 3], ['manteau', 12000, 2]] };
}
