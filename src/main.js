/**
 * Activity « Fiche RP » : fiche, boutique et navigation.
 * L'affichage est ici ; les règles du jeu sont dans shared/game.js et
 * s'appliquent côté serveur (api/). Hors Discord, un mode démo les applique
 * dans le navigateur.
 */
import '@fontsource/ultra/400.css';
import '@fontsource/alegreya/400.css';
import '@fontsource/alegreya/500.css';
import '@fontsource/alegreya/700.css';
import '@fontsource/alegreya/800.css';
import '@fontsource/alegreya/400-italic.css';
import '@fontsource/alegreya/700-italic.css';
import './style.css';
import * as G from '../shared/game.js';
import * as API from './api.js';
import { mediaSrc } from './discord.js';
/** Adresse d'image prête à afficher (dans Discord, les images ImgBB passent par /ibb). */
const imgSrc = (u) => esc(mediaSrc(u));
import {
  $, ico, pic, glyph, paintStatic, berry, esc, stars, fmt, calm, replay, countTo, floatText, fillGauges, toast,
  openDialog, closeDialog, readAsDataUrl, readImage, askConfirm, askText, setIcons, icon, ICON_SLOTS,
} from './ui.js';
import ICON_FILES from 'virtual:icon-list';

const { JOBS, STATS, HAKI, SLOTS, KIND, JOB_LEVELS, XP_NEED, STAT_MAX, ASK_MAX, BAG } = G;
const itemOf = (k) => G.itemOf(k);
/** Icône d'un objet : son image si le staff en a mis une, sinon une icône selon sa catégorie. */
const KIND_ICON = { arme: 147, conso: 192, mat: 331, tresor: 270, objet: 237, bateau: 231, amelioration: 266, ingredient: 331, plat: 192 };
const itemIco = (k) => {
  const it = itemOf(k);
  return it.img ? `<span class="ico item-img" aria-hidden="true"><img src="${imgSrc(it.img)}" alt="" loading="lazy" draggable="false"></span>` : icon(`objet-${it.kind}`);
};

/** Icône d'une recette : l'objet produit, le modèle du bateau construit, ou l'icône du travail ou du soin. */
const WORK_ICON = { voile: 'ship-speed', canon: 'ship-power', cale: 'objet-mat', granit: 'ship-granit', plongee: 'ship-plongee', moteur: 'ship-engine', reparation: 'ship-robust' };
function recipeIco(r) {
  if (r?.work) return r.work.type === 'construire' ? itemIco(r.work.model) : icon(WORK_ICON[r.work.type] || 'metier-charpentier');
  if (r?.care) return icon('metier-medecin');
  return itemIco(Object.keys(r?.gives || {})[0]);
}

/* ═══ État ═══════════════════════════════════════════════════════════════ */
let ME = null; // { uid, name, staff }
let S = null; // fiche affichée
let SHOP = null; // boutique du salon (ou null)
let CHNAME = ''; // nom du salon où est le joueur
let POSID = null; // position du joueur : dernier salon RP où il a écrit (boutique et port en dépendent)
let CREW = null; // équipage du joueur affiché
let SHIPS = []; // ses bateaux et ceux de son équipage
let NAVD = null; // port du salon : bateaux à quai, bateau à bord, demandes d'embarquement
let ADMIN = false; // panneau admin (/panel admin, /edit profil) ; /profil = vue joueur pure, même pour le staff
const tools = () => ADMIN && !!ME?.staff;
/** Permission staff de ce membre (écran Permissions) ; les admins et STAFF_ROLE_IDS ont tout. */
const staffCan = (p) => G.staffCan(ME?.perms, p);
let VIEW = null; // uid d'un autre joueur ouvert par le staff (lecture seule pour lui)
const shown = {};
const fullName = () => G.fullName(S);
const count = (k) => G.count(S, k);
const isEquipped = (k) => G.isEquipped(S, k);
const equippedCount = (k) => G.equippedCount(S, k);
const slotEquipped = (i) => G.isSlotEquipped(S, i);

/* ═══ Actions : optimistes quand le résultat ne dépend pas du hasard ═════ */
const OPTIMISTIC = new Set(['stats', 'inv.move', 'inv.drop', 'equip', 'unequip', 'craft.start', 'craft.cancel', 'shop.buy', 'tech.delete', 'photo.remove']);
let busy = 0;
const setBusy = (d) => {
  busy += d;
  document.body.classList.toggle('busy', busy > 0);
};
function showLevelUp(ups) {
  if (!ups) return;
  $('lu-title').textContent = `Niveau ${S.level} !`;
  $('lu-text').innerHTML = `+${G.LEVEL_STAT_POINTS * ups} points de statistiques à répartir.`;
  if (!$('levelup').open) $('levelup').showModal();
}
$('levelup').addEventListener('click', () => $('levelup').close());

function applyOut(out, { quiet = false, noUps = false } = {}) {
  if (out.player) S = out.player;
  if (out.shop) SHOP = out.shop;
  if ('crew' in out) CREW = out.crew;
  if (out.nav) NAVD = out.nav;
  if (out.invites) INVITES = out.invites;
  if (out.ships) SHIPS = out.ships;
  renderAll();
  if (!quiet && out.toast) toast(esc(out.toast), out.item ? itemIco(out.item) : out.icon);
  if (!noUps) showLevelUp(out.ups);
}

const OPEN_DENIED = 'Le site ne te reconnaît pas comme staff : /edit profil est refusé. Mets les mêmes OWNER_IDS / STAFF_ROLE_IDS que le bot dans les variables Vercel, puis redéploie.';

/**
 * Action du joueur sur sa fiche. Renvoie le résultat, ou null en cas d'erreur.
 *
 * Les actions partent UNE PAR UNE vers le serveur (file d'attente) : enchaîner
 * vite plusieurs déplacements ne crée plus de conflits. Quand le résultat ne
 * dépend pas du hasard, l'écran est mis à jour tout de suite (sans attendre) ;
 * l'état du serveur n'est repris qu'une fois la file vide, pour ne pas
 * « reculer » pendant que d'autres actions attendent. En cas d'erreur, on se
 * resynchronise avec le serveur au lieu de revenir à un ancien état.
 */
let queue = Promise.resolve(), inFlight = 0, needSync = false;
async function run(action) {
  if (VIEW || !S) return null;
  let local = null;
  if (OPTIMISTIC.has(action.type)) {
    try {
      local = G.playerAction(S, action, { shop: SHOP, channelId: POSID, crew: CREW, store: NAVD?.aboard, storeId: NAVD?.aboard?.id });
    } catch (e) {
      if (e instanceof G.GameError) {
        toast(esc(e.message));
        return null;
      }
      throw e;
    }
    applyOut(local);
  }
  inFlight++;
  setBusy(1);
  const job = queue.then(() => API.act(action));
  queue = job.catch(() => {});
  try {
    const out = await job;
    inFlight--;
    if (inFlight === 0 && !needSync) applyOut(out, { quiet: !!local, noUps: !!local });
    else if (!local) {
      // résultat non prévisible (vente, fabrication…) : on montre le message tout de suite
      if (out.toast) toast(esc(out.toast), out.item ? itemIco(out.item) : out.icon);
      showLevelUp(out.ups);
    }
    return out;
  } catch (e) {
    inFlight--;
    toast(esc(e.message || 'Erreur.'));
    needSync = true;
    return null;
  } finally {
    setBusy(-1);
    if (inFlight === 0 && needSync) resync();
  }
}
/** Reprend l'état exact du serveur (après une erreur dans la file). */
async function resync() {
  needSync = false;
  try {
    const st = await API.state(VIEW || undefined);
    G.setCatalog(st.catalog);
    S = st.player;
    SHOP = st.shop;
    CREW = st.crew;
    SHIPS = st.ships || [];
    INVITES = st.invites || [];
    NAVD = st.nav;
    CHNAME = st.channelName || '';
    POSID = st.channelId || null;
    MAP = st.map || null;
    renderAll();
  } catch {}
}

/** Action du staff sur la fiche affichée. */
async function staffAct(action) {
  setBusy(1);
  try {
    const out = await API.staff('act', { target: VIEW || ME.uid, action });
    applyOut(out);
    return out;
  } catch (e) {
    toast(esc(e.message || 'Erreur.'));
    return null;
  } finally {
    setBusy(-1);
  }
}

/* ═══ Carte d'identité ═══════════════════════════════════════════════════ */
/** Pas de photo : un grand point d'interrogation, façon avis de recherche sans portrait. */
const PORTRAIT = `
<svg viewBox="0 0 200 230" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Pas encore de photo">
  <defs>
    <linearGradient id="pp-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a5fb8"/><stop offset="1" stop-color="#163a7d"/></linearGradient>
    <pattern id="pp-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="3" height="8" fill="#ffffff" opacity=".06"/></pattern>
  </defs>
  <rect width="200" height="230" fill="url(#pp-sky)"/>
  <rect width="200" height="230" fill="url(#pp-hatch)"/>
  <circle cx="100" cy="104" r="62" fill="none" stroke="#e6a223" stroke-width="3" stroke-dasharray="4 7" opacity=".55"/>
  <text x="100" y="140" text-anchor="middle" font-family="Ultra, Georgia, serif" font-size="118" fill="#17255e" opacity=".55" transform="translate(5 6)">?</text>
  <text x="100" y="140" text-anchor="middle" font-family="Ultra, Georgia, serif" font-size="118" fill="#f2c84b" stroke="#17255e" stroke-width="5" paint-order="stroke">?</text>
  <path d="M0 196 Q25 188 50 196 T100 196 T150 196 T200 196 V230 H0Z" fill="#0f2c63"/>
  <path d="M0 196 Q25 188 50 196 T100 196 T150 196 T200 196" fill="none" stroke="#9fd3ef" stroke-width="3" opacity=".7"/>
</svg>`;
const FACTION = {
  Pirate: { cls: 'f-pirate', icon: '@faction-pirate' },
  Marine: { cls: 'f-marine', icon: '@faction-marine' },
  Révolutionnaire: { cls: 'f-revo', icon: '@faction-revolutionnaire' },
  'Chasseur de primes': { cls: 'f-chasseur', icon: '@faction-chasseur' },
  Civil: { cls: 'f-civil', icon: '@faction-civil' },
};
const CLASS_ICON = { Fighter: { icon: '@classe-fighter' }, Sabreur: { icon: '@classe-sabreur' }, Tireur: { icon: '@classe-tireur' } };

function photoHTML(p = S) {
  if (!p.photo) return PORTRAIT;
  const name = esc(G.fullName(p));
  const broken = `onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'ph-broken',textContent:'Image introuvable'}))"`;
  if (typeof p.photo === 'string') return `<img src="${imgSrc(p.photo)}" alt="Portrait de ${name}" ${broken}>`;
  const f = p.photo;
  return `<img class="ph-link" src="${imgSrc(f.url)}" alt="Portrait de ${name}" style="left:${f.l}%;top:${f.t}%;width:${f.w}%" ${broken}>`;
}
/** Rôle affiché sous le nom : grade pour un Marine, grade dans l'équipage pour un membre d'équipage. */
function affiliation() {
  const { faction, crew, crewRole, grade } = S.id;
  const group = CREW && CREW.members?.includes(S.uid) ? CREW : null;
  if (faction === 'Marine') return `<b>${esc(grade)}</b> de la Marine${group?.kind === 'flotte' ? `, ${esc(group.name)}` : ''}`;
  if (group) return `<b>${esc(G.rankName(group, S.uid))}</b> de ${esc(group.name)}`;
  return [crewRole && `<b>${esc(crewRole)}</b>`, crew && esc(crew)].filter(Boolean).join(', ');
}
/** Temps avant la prochaine solde de la Marine (versée à l'ouverture de l'app). */
function nextPayText() {
  const next = G.nextPay(S);
  if (!next) return 'Première solde à la prochaine ouverture';
  const left = next - Date.now();
  if (left <= 0) return 'Prochaine solde : disponible, rouvre l’app';
  return `Prochaine solde dans ${G.duree(left / 1000)}`;
}
function badgeHTML() {
  const { faction, grade, bounty } = S.id;
  if (faction === 'Marine') {
    const i = G.GRADES.indexOf(grade), g = G.gradeOf(grade);
    // Officiers généraux : étoiles ; en dessous : galons
    const marks = i >= 5 ? '<i class="star"></i>'.repeat(i - 4) : '<i></i>'.repeat(Math.min(i + 1, 4));
    return `<div class="plaque blue"><span class="pl-label">${g.medal} Grade</span><div class="chev">${marks}</div><span class="pl-value">${esc(grade)}</span><span class="pl-foot">Solde : ${berry(g.pay)} / semaine</span><span class="pl-foot pay-next">${nextPayText()}</span></div>`;
  }
  if (bounty > 0) return `<div class="plaque"><span class="pl-label">Prime</span><span class="pl-value" id="h-bounty">${berry(bounty)}</span><span class="pl-foot">Dead or alive</span></div>`;
  return '';
}

/** Temps restant avant la guérison d'une blessure soignée (convalescence). */
const healIn = (h) => (h.healAt - Date.now() > 0 ? `dans ${G.duree((h.healAt - Date.now()) / 1000)}` : 'bientôt');
/** Étiquette de santé sous le nom : « Intact », ou le résumé des blessures et maladies (dépliable). */
function healthHTML(p) {
  const list = p.health || [];
  if (!list.length) return '<span class="hp-tag ok">💚 Intact</span>';
  const worst = Math.max(...list.map((h) => h.level));
  const nb = (t, w) => {
    const n = list.filter((h) => h.type === t).length;
    return n ? `${n} ${w}${n > 1 ? 's' : ''}` : '';
  };
  const sum = `${list.length} blessure${list.length > 1 ? 's' : ''}`;
  return `<details class="health"><summary class="hp-tag lvl-${worst}">${worst >= 3 ? '🩸' : '🩹'} ${sum} · ${G.HEALTH_LEVELS[worst - 1]}</summary>
    <ul>${list.map((h) => `<li><b>🩹 ${esc(h.label)}</b> <small class="note">${esc(G.injuryName(h.type))}</small><span class="hp-lvl-${h.level}">${G.HEALTH_LEVELS[h.level - 1]}</span>${h.healAt ? ` <small class="ok">💚 en convalescence, guérie ${healIn(h)}</small>` : ''}${h.desc ? `<br><small>${esc(h.desc)}</small>` : ''}</li>`).join('')}</ul></details>`;
}
/** Îles découvertes du joueur (onglet Édition MJ) : cases à cocher. */
function discoveredHTML() {
  if (!amap) {
    loadAdminMap().then(() => VIEW && renderMjTab());
    return '<p class="note" style="margin:0">Chargement de la carte…</p>';
  }
  const isl = Object.entries(amap.islands).filter(([, i]) => i.kind === 'island');
  if (!isl.length) return '<p class="note" style="margin:0">Aucune île sur la carte.</p>';
  const known = new Set(S.discovered || []);
  return `<p class="note" style="margin:0">Les îles cochées restent toujours sur sa carte, en plus des îles visibles par tous. Il découvre aussi une île en y arrivant en bateau, ou en y écrivant un message RP.</p>
    <div class="perms">${isl.map(([id, i]) => `<label><input type="checkbox" data-disc="${esc(id)}" ${known.has(id) ? 'checked' : ''}> ${esc(i.name)}${i.visible ? ' <small class="note">(visible par tous)</small>' : ''}</label>`).join('')}</div>`;
}
$('v-mj').addEventListener('change', (e) => {
  const id = e.target.dataset?.disc;
  if (id) staffAct({ type: 'discover', id, on: e.target.checked });
});
/** Section « État de santé » de l'onglet Édition MJ. */
function healthToolsHTML() {
  const list = S.health || [];
  return `<h3 class="ed-h">État de santé</h3>
    <div class="mj-tools">
      ${list.length ? `<div class="member-list">${list.map((h) => `<div class="member-row"><span class="m-name">🩹 <b>${esc(h.label)}</b> <small class="note">${esc(G.injuryName(h.type))}</small>${h.desc ? ` <small class="note">${esc(h.desc)}</small>` : ''}${h.healAt ? ` <small class="ok">💚 convalescence : guérie ${healIn(h)}</small>` : ''}</span><span class="rank-badge hp-lvl-${h.level}">${G.HEALTH_LEVELS[h.level - 1]}</span><span class="m-acts"><button class="btn sm ghost" data-health-del="${esc(h.id)}">Guérir</button></span></div>`).join('')}</div>` : '<p class="note" style="margin:0">💚 Intact : aucune blessure, aucune maladie.</p>'}
      <div class="mj-row health-row">
        <label for="mjh-type">Catégorie</label><select id="mjh-type" aria-label="Catégorie">${Object.entries(G.injuryTypes()).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
        <label for="mjh-level">Gravité</label><select id="mjh-level" aria-label="Gravité">${G.HEALTH_LEVELS.map((l, i) => `<option value="${i + 1}">${l}</option>`).join('')}</select>
        <input id="mjh-label" maxlength="80" placeholder="Ex. Bras cassé, Fièvre…" aria-label="Description courte">
        <input id="mjh-desc" maxlength="300" placeholder="Détail (facultatif)" aria-label="Détail">
        <button class="btn sm" id="mjh-add">Ajouter</button>
        ${list.length > 1 ? '<button class="btn sm ghost" id="mjh-clear">Tout guérir</button>' : ''}
      </div>
      ${Object.keys(G.INJURIES).length ? '' : '<p class="note" style="margin:0">Crée des catégories (fracture, brûlure…) dans Gestion > Blessures pour les choisir ici.</p>'}
    </div>`;
}

function renderHero() {
  const f = FACTION[S.id.faction] || FACTION.Pirate;
  const key = JSON.stringify(S.photo || '') + (S.uid || '');
  if (shown.photo !== key) {
    $('portrait').innerHTML = photoHTML() + (VIEW ? '' : '<span class="cam" aria-hidden="true">📷</span>');
    shown.photo = key;
  }
  $('h-faction').innerHTML = `<span class="stamp ${f.cls}">${glyph(f.icon)}${esc(S.id.faction)}</span>`;
  $('h-name').textContent = fullName();
  $('h-epithet').textContent = S.id.epithet ? `« ${S.id.epithet} »` : '';
  const aff = affiliation();
  $('h-aff').innerHTML = aff;
  $('h-aff').hidden = !aff;
    const hh = $('h-health');
  if (hh) {
    const open = hh.querySelector('details')?.open; // garder le détail déplié au rafraîchissement
    hh.innerHTML = healthHTML(S) + careInHTML();
    if (open) hh.querySelector('details')?.setAttribute('open', '');
  }
  const pos = $('h-pos');
  if (pos) pos.innerHTML = S.position ? `📍 <b>#${esc(S.position.name || S.position.channelId)}</b>` : '📍 Nulle part pour l’instant : écris un message RP dans un salon RP.';
  // Actions RP récompensées aujourd'hui (le compteur repart à minuit, heure de Paris)
  const done = S.rp?.day === G.rpDay() ? S.rp.count : 0;
  $('h-rp').innerHTML = `<span class="rp-l">RP aujourd’hui</span><span class="rp-dots" aria-hidden="true">${Array.from({ length: G.RP_DAILY }, (_, i) => `<i class="${i < done ? 'on' : ''}"></i>`).join('')}</span><b>${done} / ${G.RP_DAILY}</b>${done >= G.RP_DAILY ? '<small class="note">limite atteinte, retour à minuit</small>' : `<small class="note">+${G.RP_XP} XP par message de ${G.RP_MIN_CHARS} caractères</small>`}`;
  $('h-rp').setAttribute('aria-label', `Actions RP récompensées aujourd’hui : ${done} sur ${G.RP_DAILY}`);
  const job = S.job.id ? JOBS[S.job.id] : { name: 'Aucun' };
  $('h-traits').innerHTML = [
    ['Race', S.id.race, `@race-${G.slug(S.id.race)}`, G.RACE_INFO[S.id.race]?.desc],
    ['Classe', S.id.classe, CLASS_ICON[S.id.classe]?.icon ?? '@classe-sabreur'],
    ['Métier', job.name, `@metier-${S.job.id || 'aucun'}`],
    ...(S.fruit ? [['Fruit', S.fruit.name, '@fruit']] : []),
  ].map(([k, v, i, t]) => `<li ${t ? `title="${esc(t)}"` : ''}>${glyph(i)}<span><small>${k}</small>${esc(v)}</span></li>`).join('');

  const prevBounty = shown.bounty;
  $('badge-slot').innerHTML = badgeHTML();
  $('h-will').innerHTML = `${icon('volonte')}<span class="will-l">Volonté</span>${stars(S.volonte)}`;
  $('h-will').setAttribute('aria-label', `Volonté : ${S.volonte} sur 5`);
  const bt = $('h-bounty');
  if (bt && prevBounty != null && prevBounty !== S.id.bounty) {
    countTo(bt, prevBounty, S.id.bounty);
    replay(bt.parentElement, 'bump');
  }
  shown.bounty = bt ? S.id.bounty : null;

  const need = S.level >= G.MAX_LEVEL ? 1 : XP_NEED(S.level), lvEl = $('id-lv');
  if (shown.level != null && shown.level !== S.level) replay(lvEl.parentElement, 'bump');
  shown.level = S.level;
  lvEl.textContent = S.level;
  $('xp-gauge').querySelector('i').style.width = `${(S.xp / need) * 100}%`;
  $('xp-gauge').setAttribute('aria-valuenow', S.xp);
  $('xp-gauge').setAttribute('aria-valuemax', need);
  $('xp-cap').textContent = S.level >= G.MAX_LEVEL ? 'Niveau maximal' : `${S.xp} / ${need}`;
  if (S.level >= G.MAX_LEVEL) $('xp-gauge').querySelector('i').style.width = '100%';

  const pEl = $('purse');
  if (shown.berry == null || shown.berryOf !== S.uid) pEl.innerHTML = berry(S.berry);
  else if (shown.berry !== S.berry) {
    const diff = S.berry - shown.berry;
    countTo(pEl, shown.berry, S.berry);
    replay(pEl.parentElement, 'bump');
    floatText(pEl.parentElement, `${diff > 0 ? '+' : '−'}${berry(Math.abs(diff))}`, diff > 0);
  }
  shown.berry = S.berry;
  shown.berryOf = S.uid;
  document.title = `Fiche de ${fullName()}`;
  $('open-photo').hidden = !!VIEW;
  $('open-edit').hidden = !(tools() && VIEW);
}
$('portrait').addEventListener('click', () => !VIEW && openPhoto());
$('open-photo').addEventListener('click', () => openPhoto());
$('portrait').addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && !VIEW) {
    e.preventDefault();
    openPhoto();
  }
});

/* ═══ Photo ══════════════════════════════════════════════════════════════ */
const OUT_W = 400, OUT_H = 460;
const crop = { img: null, w: 0, h: 0, zoom: 1, ox: 0, oy: 0, base: 1, url: null };
const stageSize = () => {
  const r = $('ph-stage').getBoundingClientRect();
  return { W: r.width, H: r.height };
};
function clampCrop() {
  const { W, H } = stageSize(), s = crop.base * crop.zoom;
  crop.ox = Math.min(0, Math.max(W - crop.w * s, crop.ox));
  crop.oy = Math.min(0, Math.max(H - crop.h * s, crop.oy));
}
function drawCrop() {
  const el = $('ph-img');
  if (!crop.img) {
    el.hidden = true;
    $('ph-empty').hidden = false;
    $('ph-zoom').disabled = true;
    $('ph-save').disabled = true;
    return;
  }
  const s = crop.base * crop.zoom;
  el.hidden = false;
  $('ph-empty').hidden = true;
  $('ph-zoom').disabled = false;
  $('ph-save').disabled = false;
  el.style.width = `${crop.w * s}px`;
  el.style.height = `${crop.h * s}px`;
  el.style.transform = `translate(${crop.ox}px, ${crop.oy}px)`;
}
function loadCrop(src, url = null) {
  const img = new Image();
  img.crossOrigin = url ? null : 'anonymous';
  img.onload = () => {
    const { W, H } = stageSize();
    Object.assign(crop, { img, url, w: img.naturalWidth, h: img.naturalHeight, zoom: 1 });
    crop.base = Math.max(W / crop.w, H / crop.h);
    crop.ox = (W - crop.w * crop.base) / 2;
    crop.oy = (H - crop.h * crop.base) / 2;
    $('ph-img').src = mediaSrc(src);
    $('ph-zoom').value = 1;
    $('ph-err').textContent = '';
    drawCrop();
  };
  img.onerror = () => {
    $('ph-err').textContent = url
      ? 'Aperçu impossible pour ce lien. Tu peux quand même l’enregistrer : le serveur va récupérer l’image.'
      : 'Impossible de lire cette image. Essaie un JPG ou un PNG.';
    if (url) {
      Object.assign(crop, { img: null, url });
      $('ph-save').disabled = false;
    }
  };
  img.src = mediaSrc(src);
}
async function readFile(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) return void ($('ph-err').textContent = 'Ce fichier n’est pas une image.');
  if (file.size > 15 * 1024 * 1024) return void ($('ph-err').textContent = 'Image trop lourde (15 Mo maximum).');
  loadCrop(await readImage(file, { max: 2400 }));
}
function openPhoto() {
  if (VIEW) return;
  Object.assign(crop, { img: null, url: null });
  $('ph-err').textContent = '';
  $('ph-remove').hidden = !S.photo;
  $('ph-url').value = '';
  openDialog('d-photo');
  if (!S.photo) drawCrop();
  else loadCrop(typeof S.photo === 'string' ? S.photo : S.photo.url);
}
function loadUrl() {
  const raw = $('ph-url').value.trim();
  if (!raw) return void ($('ph-err').textContent = 'Colle d’abord un lien.');
  let u;
  try {
    u = new URL(raw);
  } catch {
    return void ($('ph-err').textContent = 'Ce lien n’est pas valide.');
  }
  if (!/^https?:$/.test(u.protocol)) return void ($('ph-err').textContent = 'Le lien doit commencer par http:// ou https://');
  $('ph-err').textContent = 'Chargement…';
  loadCrop(u.href, u.href);
}
$('ph-url-go').addEventListener('click', loadUrl);
$('ph-url').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    loadUrl();
  }
});
$('d-photo').addEventListener('paste', (e) => {
  const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
  if (file) {
    e.preventDefault();
    return void readFile(file);
  }
  const txt = e.clipboardData?.getData('text')?.trim();
  if (txt && /^https?:\/\//.test(txt) && e.target !== $('ph-url')) {
    e.preventDefault();
    $('ph-url').value = txt;
    loadUrl();
  }
});
$('ph-file').addEventListener('change', (e) => {
  readFile(e.target.files[0]);
  e.target.value = '';
});
$('ph-pick').addEventListener('click', () => $('ph-file').click());
$('ph-zoom').addEventListener('input', (e) => {
  const { W, H } = stageSize(), old = crop.base * crop.zoom;
  crop.zoom = +e.target.value;
  const s = crop.base * crop.zoom;
  crop.ox = W / 2 - ((W / 2 - crop.ox) * s) / old;
  crop.oy = H / 2 - ((H / 2 - crop.oy) * s) / old;
  clampCrop();
  drawCrop();
});
let pan = null;
$('ph-stage').addEventListener('pointerdown', (e) => {
  if (!crop.img) return void $('ph-file').click();
  pan = { x: e.clientX, y: e.clientY, ox: crop.ox, oy: crop.oy };
  $('ph-stage').setPointerCapture(e.pointerId);
  $('ph-stage').classList.add('panning');
});
$('ph-stage').addEventListener('pointermove', (e) => {
  if (!pan) return;
  crop.ox = pan.ox + e.clientX - pan.x;
  crop.oy = pan.oy + e.clientY - pan.y;
  clampCrop();
  drawCrop();
});
const endPan = () => {
  pan = null;
  $('ph-stage').classList.remove('panning');
};
$('ph-stage').addEventListener('pointerup', endPan);
$('ph-stage').addEventListener('pointercancel', endPan);
$('ph-stage').addEventListener('wheel', (e) => {
  if (!crop.img) return;
  e.preventDefault();
  const z = $('ph-zoom');
  z.value = Math.min(4, Math.max(1, +z.value - e.deltaY * 0.002));
  z.dispatchEvent(new Event('input'));
}, { passive: false });
['dragenter', 'dragover'].forEach((t) => $('ph-stage').addEventListener(t, (e) => {
  e.preventDefault();
  $('ph-stage').classList.add('drop');
}));
['dragleave', 'drop'].forEach((t) => $('ph-stage').addEventListener(t, () => $('ph-stage').classList.remove('drop')));
$('ph-stage').addEventListener('drop', (e) => {
  e.preventDefault();
  readFile(e.dataTransfer.files[0]);
});
$('ph-remove').addEventListener('click', async () => {
  closeDialog($('d-photo'));
  await run({ type: 'photo.remove' });
});
$('ph-save').addEventListener('click', async () => {
  let photo;
  const { W, H } = stageSize(), s = crop.base * crop.zoom;
  if (crop.url) {
    // Lien : on garde le cadrage en % ; le serveur recopie l'image chez nous.
    const r = (v) => Math.round(v * 100) / 100;
    photo = crop.img ? { url: crop.url, l: r((crop.ox / W) * 100), t: r((crop.oy / H) * 100), w: r(((crop.w * s) / W) * 100) } : crop.url;
  } else if (crop.img) {
    const k = OUT_W / W, c = document.createElement('canvas');
    c.width = OUT_W;
    c.height = OUT_H;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#9fd3ef';
    ctx.fillRect(0, 0, OUT_W, OUT_H);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(crop.img, crop.ox * k, crop.oy * k, crop.w * s * k, crop.h * s * k);
    try {
      photo = c.toDataURL('image/jpeg', 0.86);
    } catch {
      return void ($('ph-err').textContent = 'Cette image ne peut pas être recadrée ici. Importe-la depuis ton appareil.');
    }
  } else return;
  $('ph-save').disabled = true;
  $('ph-err').textContent = 'Envoi…';
  const out = await run({ type: 'photo.set', photo });
  $('ph-save').disabled = false;
  if (out) {
    closeDialog($('d-photo'));
    replay($('portrait'), 'swing');
  } else $('ph-err').textContent = '';
});

/* ═══ Stats & compétences ════════════════════════════════════════════════ */
let pending = {};
const skillRow = ({ glyphHTML, name, sub, v, req }) => `<div class="sk">
    ${glyphHTML}
    <div class="sk-main"><div class="sk-name">${name}${sub ? ` <small>${sub}</small>` : ''}</div>${stars(v ?? 0)}</div>
    ${req ? `<div class="sk-req">${req}</div>` : ''}
  </div>`;
function renderPerso() {
  const spent = Object.values(pending).reduce((a, b) => a + b, 0);
  const left = S.statPts - spent;
  const rows = [];
  HAKI.forEach((h) => {
    const v = S.haki[h.key];
    if (v) rows.push(skillRow({ glyphHTML: icon(`haki-${h.key}`), name: h.name, v }));
  });
  if (S.fruit) rows.push(skillRow({ glyphHTML: icon('fruit'), name: esc(S.fruit.name), sub: esc(S.fruit.type), v: S.fruit.stars, req: S.fruit.stars >= 5 ? 'Éveillé' : '' }));
  $('v-perso').innerHTML = `
    <div class="perso-grid">
      <section>
        <div class="sec-head"><h2>Statistiques</h2><span class="pill">Points <b>${left}</b></span></div>
        ${STATS.map((s) => {
          const add = pending[s.key] || 0, v = S.stats[s.key] + add;
          return `<div class="stat">
            ${icon(`stat-${s.key}`)}
            <span><b>${s.name}</b></span>
            <div class="gauge" role="progressbar" aria-label="${s.name}" aria-valuenow="${v}" aria-valuemin="0" aria-valuemax="${STAT_MAX}"><i style="width:${Math.min(100, (v / STAT_MAX) * 100)}%"></i></div>
            <div class="step">
              <button class="sq" data-stat="${s.key}" data-d="-1" ${add <= 0 ? 'disabled' : ''} aria-label="Retirer un point en ${s.name}">−</button>
              <span class="val ${add ? 'up' : ''}">${v}</span>
              <button class="sq" data-stat="${s.key}" data-d="1" ${left <= 0 || v >= STAT_MAX ? 'disabled' : ''} aria-label="Ajouter un point en ${s.name}">+</button>
            </div>
          </div>`;
        }).join('')}
        ${spent ? `<div class="stat-actions">
          <button class="btn ghost sm" id="stat-cancel">Annuler</button>
          <button class="btn sm" id="stat-apply">Valider (${spent})</button>
        </div>` : ''}
      </section>
      <section>
        <div class="sec-head"><h2>Compétences</h2></div>
        <div class="sk-list">${rows.join('') || '<p class="note">Aucune compétence débloquée pour l’instant. Elles s’obtiennent en RP, auprès d’un MJ.</p>'}</div>
      </section>
    </div>`;
}
$('v-perso').addEventListener('click', async (e) => {
  const sq = e.target.closest('.sq');
  if (sq) {
    const k = sq.dataset.stat;
    pending[k] = Math.max(0, (pending[k] || 0) + Number(sq.dataset.d));
    renderPerso();
    replay(document.querySelector(`#v-perso .sq[data-stat="${k}"]`)?.closest('.stat')?.querySelector('.val'), 'bump');
    replay(document.querySelector('#v-perso .pill b'), 'bump');
    document.querySelector(`#v-perso .sq[data-stat="${k}"][data-d="${sq.dataset.d}"]`)?.focus();
    return;
  }
  if (e.target.id === 'stat-cancel') {
    pending = {};
    renderPerso();
  }
  if (e.target.id === 'stat-apply') {
    const alloc = pending;
    pending = {};
    await run({ type: 'stats', alloc });
  }
});

/* ═══ Techniques ═════════════════════════════════════════════════════════ */
const SRC_CLS = { combat: 'src-lame', fruit: 'src-fruit' };
let editingTech = null;
let techMedia;
/** Statut d'une technique : validée (rien), refusée (avec motif) ou à valider. */
const techStatus = (t) => (t.ok ? '' : t.refused ? '<span class="status refused">Refusée</span>' : '<span class="status wait">À valider</span>');
function renderTech() {
  const wait = S.techniques.filter((t) => !t.ok && !t.refused).length;
  const refused = S.techniques.filter((t) => !t.ok && t.refused).length;
  $('v-tech').innerHTML = `
    <div class="tech-tools">
      <div><h2>Techniques</h2><p class="lede" style="margin:0">Crée tes propres techniques. Un MJ les valide avant qu'elles soient utilisables en RP.</p></div>
      <button class="btn" id="new-tech">${icon('tab-t-tech')}Nouvelle technique</button>
    </div>
    ${wait ? `<p class="note">${wait} technique${wait > 1 ? 's' : ''} en attente de validation.</p>` : ''}
    ${refused ? `<p class="note">${refused} technique${refused > 1 ? 's' : ''} refusée${refused > 1 ? 's' : ''} : lis le motif, corrige-la, et elle repartira en validation.</p>` : ''}
    ${S.techniques.map((t) => `
      <details class="tech" ${t.refused && !t.ok ? 'open' : ''}>
        <summary>
          ${t.media ? `<span class="t-thumb"><img src="${imgSrc(t.media)}" alt="" loading="lazy"></span>` : ''}
          <span><span class="t-name">${esc(t.name)}</span>${techStatus(t)}<br><span class="t-meta"><span class="${SRC_CLS[t.src]}">${G.TECH_SOURCES[t.src]}</span></span></span>
          <span class="cost"><span class="chev" aria-hidden="true">▾</span></span>
        </summary>
        ${!t.ok && t.refused ? `<p class="refused-why"><b>Motif du refus :</b> ${esc(t.refused.reason)}</p>` : ''}
        ${t.media ? `<div class="t-media"><img src="${imgSrc(t.media)}" alt="Illustration de ${esc(t.name)}" loading="lazy" onerror="this.parentElement.classList.add('broken');this.remove()"></div>` : ''}
        <p>${esc(t.desc) || '<em>Pas de description.</em>'}</p>
        <div class="t-actions">
          <button class="btn sm ghost" data-edit-tech="${t.id}">${!t.ok && t.refused ? 'Corriger et reproposer' : 'Modifier'}</button><button class="btn sm ghost" data-del-tech="${t.id}">Supprimer</button>
          ${tools() && VIEW && !t.ok ? `<button class="btn sm" data-ok-tech="${t.id}">Valider</button>${t.refused ? '' : `<button class="btn sm ghost" data-no-tech="${t.id}">Refuser</button>`}` : ''}
        </div>
      </details>`).join('') || '<p class="note">Aucune technique pour l’instant.</p>'}`;
}
/** Le staff refuse une technique : le motif est obligatoire, le joueur le verra sur sa fiche. */
async function askRefuseReason() {
  return askText('Explique au joueur pourquoi : il verra ce motif sur sa fiche et pourra corriger sa technique.', { title: 'Refuser la technique', ok: 'Refuser', placeholder: 'Ex. trop puissante pour son niveau', max: 300 });
}
function showTechMedia() {
  const box = $('tf-preview');
  box.innerHTML = techMedia
    ? `<img src="${imgSrc(techMedia)}" alt="Aperçu" onerror="this.parentElement.innerHTML='<span class=&quot;note&quot;>Aperçu impossible. Le serveur récupérera l’image à l’enregistrement.</span>'">`
    : '<span class="note">Aucune image</span>';
  $('tf-media-del').hidden = !techMedia;
}
function openTechForm(t = null) {
  editingTech = t?.id ?? null;
  $('tech-title').textContent = t ? (t.refused && !t.ok ? 'Corriger la technique' : 'Modifier la technique') : 'Nouvelle technique';
  $('tech-submit').textContent = t ? (t.ok ? 'Enregistrer' : 'Reproposer la technique') : 'Proposer la technique';
  $('tf-src').innerHTML = Object.entries(G.TECH_SOURCES).map(([k, l]) => `<option value="${k}" ${t?.src === k ? 'selected' : ''}>${l}</option>`).join('');
  $('tf-name').value = t?.name ?? '';
  $('tf-desc').value = t?.desc ?? '';
  techMedia = t?.media ?? null;
  $('tf-url').value = '';
  showTechMedia();
  $('tech-err').textContent = t && !t.ok && t.refused ? `Motif du refus : ${t.refused.reason}` : '';
  openDialog('d-tech');
}
$('v-tech').addEventListener('click', async (e) => {
  const id = (attr) => {
    const el = e.target.closest(`[${attr}]`);
    return el ? Number(el.getAttribute(attr)) : null;
  };
  if (e.target.closest('#new-tech')) return openTechForm();
  const ed = id('data-edit-tech');
  if (ed != null) return openTechForm(S.techniques.find((t) => t.id === ed));
  const del = id('data-del-tech');
  if (del != null) return run({ type: 'tech.delete', id: del });
  const ok = id('data-ok-tech');
  if (ok != null) return staffAct({ type: 'tech.validate', id: ok, ok: true });
  const no = id('data-no-tech');
  if (no != null) {
    const reason = await askRefuseReason();
    if (reason) staffAct({ type: 'tech.validate', id: no, ok: false, reason });
  }
});
$('tf-pick').addEventListener('click', () => $('tf-file').click());
$('tf-file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  if (!f.type.startsWith('image/')) return void ($('tech-err').textContent = 'Ce fichier n’est pas une image.');
  if (f.size > 2 * 1024 * 1024) return void ($('tech-err').textContent = 'Fichier trop lourd (2 Mo maximum). Pour un gros GIF, utilise plutôt un lien.');
  techMedia = await readImage(f);
  $('tf-url').value = '';
  $('tech-err').textContent = '';
  showTechMedia();
});
function techUrl() {
  const raw = $('tf-url').value.trim();
  if (!raw) return;
  try {
    const u = new URL(raw);
    if (!/^https?:$/.test(u.protocol)) throw 0;
    techMedia = u.href;
    $('tech-err').textContent = '';
    showTechMedia();
  } catch {
    $('tech-err').textContent = 'Le lien doit commencer par http:// ou https://';
  }
}
$('tf-url-go').addEventListener('click', techUrl);
$('tf-url').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    techUrl();
  }
});
$('tf-media-del').addEventListener('click', () => {
  techMedia = null;
  $('tf-url').value = '';
  showTechMedia();
});
$('d-tech').addEventListener('paste', (e) => {
  const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/'));
  if (!f) return;
  e.preventDefault();
  const dt = new DataTransfer();
  dt.items.add(f);
  $('tf-file').files = dt.files;
  $('tf-file').dispatchEvent(new Event('change'));
});
$('tech-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('tf-name').value.trim();
  if (!name) {
    $('tech-err').textContent = 'Donne un nom à ta technique.';
    return $('tf-name').focus();
  }
  $('tech-submit').disabled = true;
  $('tech-err').textContent = techMedia && !techMedia.startsWith('/media/') && !/^https:\/\/i\.ibb\.co\//.test(techMedia) ? 'Envoi de l’image…' : '';
  const out = await run({ type: 'tech.save', id: editingTech ?? undefined, name, src: $('tf-src').value, desc: $('tf-desc').value.trim(), media: techMedia });
  $('tech-submit').disabled = false;
  if (out) closeDialog($('d-tech'));
  else $('tech-err').textContent = '';
});
/* ═══ Inventaire ═════════════════════════════════════════════════════════ */
let sel = null;
function renderInv() {
  const used = S.inv.filter(Boolean).length;
  const n = S.inv.reduce((a, s) => a + (s ? s[1] : 0), 0);
  const selItem = sel != null ? S.inv[sel] : null;
  if (!selItem) sel = null;
  let det = `<div class="detail empty">Choisis un objet pour voir sa description. Fais-le glisser pour le ranger ailleurs, ou une arme sur un emplacement pour l'équiper.</div>`;
  if (selItem) {
    const [k, q] = selItem, it = itemOf(k), eq = slotEquipped(sel);
    det = `<div class="detail" id="inv-detail">
      <div class="slot-ico">${itemIco(k)}</div>
      <div><h3>${esc(it.name)} <span class="tag">${KIND[it.kind]}</span> <span class="tag" style="color:${G.rarityOf(k).color}">${G.rarityOf(k).name}</span></h3>
        ${it.heal ? `<p class="note" style="margin:4px 0">🩹 Soigne : ${esc(it.heal.type ? G.injuryName(it.heal.type) : 'toute blessure')}, jusqu’à ${G.HEALTH_LEVELS[it.heal.level - 1].toLowerCase()}</p>` : ''}
        ${!VIEW && (it.heal || (it.kind !== 'arme' && it.kind !== 'bateau')) ? `<div class="mj-row">${it.heal ? `<button class="btn sm" data-use="${esc(k)}">Utiliser</button>` : ''}${it.kind !== 'arme' && it.kind !== 'bateau' ? `<button class="btn sm ghost" data-give="${esc(k)}">Donner</button>` : ''}</div>` : ''}<p>${esc(it.desc)} Quantité : ${q}. Poids : ${G.kg((it.weight || 0) * q)}. Valeur : ${it.value ? berry(it.value) : 'aucune'}.</p></div>
      <div class="acts">
        ${G.isWeapon(k) ? `<button class="btn sm" data-equip="${sel}">${eq ? 'Retirer' : 'Équiper'}</button>` : ''}
        <button class="btn sm ghost" data-drop="${sel}" ${eq ? 'disabled title="Retire-la d’abord"' : ''}>Jeter un</button>
      </div>
    </div>`;
  }
  // Une seule arme équipée sur trois identiques : seule la première case porte la marque.
  $('v-inv').innerHTML = `
    <div class="sec-head"><h2>Inventaire</h2><span class="pill">${icon('bourse')}<b>${berry(S.berry)}</b></span></div>
    <p class="lede">${used} / ${BAG} emplacements · ${n} objet${n > 1 ? 's' : ''}</p>
    <div class="gauge weight-bar ${G.invWeight(S) >= G.MAX_CARRY * 0.9 ? 'bad' : ''}" aria-label="Poids porté"><i style="width:${Math.min(100, (G.invWeight(S) / G.MAX_CARRY) * 100)}%"></i></div>
    <div class="gauge-cap"><span>Poids porté</span><span class="${G.invWeight(S) > G.MAX_CARRY ? 'req' : ''}">${G.kg(G.invWeight(S))} / ${G.MAX_CARRY} kg</span></div>
    <div class="equip">
      ${Object.entries(SLOTS).map(([sl, label]) => {
        const idx = G.equipSlotIndex(S, sl), k = idx >= 0 ? S.inv[idx][0] : null, it = k && itemOf(k);
        return `<button class="eslot ${it ? 'filled' : ''}" data-eslot="${sl}" aria-label="${label}${it ? ' : ' + esc(it.name) + ', cliquer pour retirer' : ' vide'}">
          <span class="frame">${it ? itemIco(k) : ''}</span>
          <span><b>${label}</b><span class="n">${it ? esc(it.name) : 'Glisse une arme ici'}</span></span>
        </button>`;
      }).join('')}
    </div>
    <div class="hold" id="hold">
      ${S.inv.map((s, i) => {
        if (!s) return `<div class="cell empty" data-slot="${i}"></div>`;
        const [k, q] = s, it = itemOf(k);
        const eq = slotEquipped(i);
        return `<button class="cell ${G.rarityOf(k).key !== 'commun' ? 'rar' : ''}" style="--rar:${G.rarityOf(k).color}" data-slot="${i}" aria-pressed="${sel === i}" aria-label="${esc(it.name)}, quantité ${q}${eq ? ', équipé' : ''}">${itemIco(k)}${eq ? '<span class="eq">É</span>' : ''}${q > 1 ? `<span class="qty">${q}</span>` : ''}</button>`;
      }).join('')}
    </div>
    ${det}`;
}
/** Équipe l'arme de cette case (to : emplacement voulu, sinon le premier libre ; re-cliquer la retire). */
async function equip(slot, to) {
  const out = await run({ type: 'equip', slot, to });
  if (out?.slot || to) replay(document.querySelector(`#v-inv [data-eslot="${out?.slot || to}"]`), 'bought');
}
let drag = null, justDragged = false;
$('v-inv').addEventListener('pointerdown', (e) => {
  if (VIEW) return;
  const cell = e.target.closest('.cell[data-slot]:not(.empty)');
  if (!cell || e.button > 0) return;
  drag = { from: +cell.dataset.slot, x: e.clientX, y: e.clientY, cell, on: false, ghost: null, over: null };
});
function ghostMove(d, e, icon, selector) {
  if (!d.on) {
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) return false;
    d.on = true;
    d.ghost = document.createElement('div');
    d.ghost.className = 'drag-ghost';
    d.ghost.innerHTML = icon;
    document.body.appendChild(d.ghost);
    d.cell.classList.add('dragging');
    document.body.classList.add('is-dragging');
  }
  e.preventDefault();
  d.ghost.style.transform = `translate(${e.clientX - 28}px, ${e.clientY - 28}px) rotate(-8deg) scale(1.15)`;
  const t = document.elementFromPoint(e.clientX, e.clientY)?.closest(selector) || null;
  if (t !== d.over) {
    d.over?.classList.remove('over');
    d.over = t;
    t?.classList.add('over');
  }
  return true;
}
function ghostEnd(d) {
  d.ghost?.remove();
  d.cell.classList.remove('dragging');
  d.over?.classList.remove('over');
  document.body.classList.remove('is-dragging');
}
window.addEventListener('pointermove', (e) => {
  if (drag) ghostMove(drag, e, itemIco(S.inv[drag.from]?.[0]), '#v-inv .cell, #v-inv .eslot');
  if (sdrag) ghostMove(sdrag, e, itemIco(sdrag.k), '#drop-counter');
}, { passive: false });
window.addEventListener('pointerup', () => {
  if (drag) {
    const d = drag;
    drag = null;
    if (!d.on) return;
    justDragged = true;
    setTimeout(() => (justDragged = false), 0);
    ghostEnd(d);
    const t = d.over;
    if (!t) return;
    if (t.dataset.eslot) {
      const k = S.inv[d.from][0];
      if (!G.isWeapon(k)) {
        replay(t, 'shake');
        return toast(`${esc(itemOf(k).name)} n’est pas une arme`);
      }
      return void equip(d.from, t.dataset.eslot);
    }
    const to = +t.dataset.slot;
    if (to === d.from) return;
    if (sel === d.from) sel = to;
    else if (sel === to) sel = d.from;
    run({ type: 'inv.move', from: d.from, to });
    replay(document.querySelector(`#v-inv [data-slot="${to}"]`), 'bought');
  }
  if (sdrag) {
    const d = sdrag;
    sdrag = null;
    if (!d.on) return;
    sJust = true;
    setTimeout(() => (sJust = false), 0);
    ghostEnd(d);
    if (d.over) putOnCounter(d.k);
  }
});
window.addEventListener('pointercancel', () => {
  if (drag) ghostEnd(drag);
  if (sdrag) ghostEnd(sdrag);
  drag = sdrag = null;
});
$('v-inv').addEventListener('click', (e) => {
  if (justDragged) return;
  const c = e.target.closest('.cell[data-slot]:not(.empty)');
  if (c) {
    sel = Number(c.dataset.slot);
    renderInv();
    replay($('inv-detail'), 'in');
    return document.querySelector(`#v-inv [data-slot="${sel}"]`)?.focus();
  }
  if (VIEW) return;
  const eqs = e.target.closest('[data-equip]')?.dataset.equip;
  if (eqs != null) return void equip(Number(eqs));
  const es = e.target.closest('[data-eslot]')?.dataset.eslot;
  if (es && S.equip[es]) return void run({ type: 'unequip', slot: es });
  const drop = e.target.closest('[data-drop]');
  if (drop) {
    const slot = +drop.dataset.drop, last = S.inv[slot]?.[1] <= 1;
    const finish = () => {
      if (last) sel = null;
      run({ type: 'inv.drop', slot });
    };
    const cell = document.querySelector(`#v-inv [data-slot="${slot}"]`);
    if (last && cell && !calm.matches) {
      cell.classList.add('gone');
      cell.addEventListener('animationend', finish, { once: true });
    } else finish();
  }
});

/* ═══ Métier : atelier de fabrication ════════════════════════════════════ */
const fmtEnd = (ms) => G.duree(Math.max(0, ms - Date.now()) / 1000);
let craftFilter = 'dispo';
function needChip([k, q], have = true, store = NAVD?.aboard) {
  const h = G.stockOf(S, store, k), it = itemOf(k); // inventaire + cale du bateau où l'on est à bord
  return `<span class="need ${have ? (h >= q ? 'have' : 'miss') : ''}">${itemIco(k)}${esc(it.name)} ${have ? `${h}/${q}` : `× ${q}`}</span>`;
}
/** Fonctionnalités activées ou non (vérifiées à l'ouverture de l'onglet Métier, au plus une fois par minute). */
let FEAT = {}, featAt = 0, SEA = null; // SEA : événements en mer par niveau (réglés par le staff)
function refreshFeatures() {
  if (VIEW || Date.now() - featAt < 60_000) return;
  featAt = Date.now();
  run({ type: 'features.get' }).then((out) => {
    if (!out?.features) return;
    const before = JSON.stringify([FEAT, SEA]);
    FEAT = out.features;
    SEA = out.seaEvents || SEA;
    if (JSON.stringify([FEAT, SEA]) !== before) {
      renderJob();
      if (typeof renderAll === 'function') renderAll();
    }
  });
}
/** Outils d'une recette (requis, gardés) : en vert si on les a, en rouge sinon. */
function toolsHTML(r, store = NAVD?.aboard) {
  const list = Object.entries(r.tools || {});
  if (!list.length) return '';
  return `<b>Outils</b><div class="needs">${list.map(([k, q]) => {
    const h = G.toolCount(S, store, k) - (r.needs?.[k] || 0);
    return `<span class="need ${h >= q ? 'have' : 'miss'}">${itemIco(k)}${esc(itemOf(k).name)}${q > 1 ? ` × ${q}` : ''}</span>`;
  }).join('')}</div>`;
}
/* Recettes de base de la cuisine : retirées de l'onglet Métier, affichées dans l'onglet Cuisine */
let kitchenRecs = {};
function renderJob() {
  kitchenRecs = {};
  try {
    for (const [k, r] of Object.entries(G.RECIPES)) {
      if (!r?.kitchen) continue;
      kitchenRecs[k] = r;
      delete G.RECIPES[k];
    }
  } catch {
    // le catalogue ne se laisse pas modifier : les recettes de base restent aussi dans l'onglet Métier
  }
  try {
    return renderJobInner();
  } finally {
    try {
      Object.assign(G.RECIPES, kitchenRecs);
    } catch {}
  }
}
function kitchenHTML() {
  const list = Object.entries(kitchenRecs);
  if (!list.length) return '';
  return `<div class="sec-head"><h2 style="font-size:20px">🥘 Recettes de base</h2></div>
    <div class="recipes">${list.map(([id, r]) => `<article class="recipe">
      <h3 class="rc-title">${recipeIco(r)}${esc(G.recipeLabel(r))}</h3>
      <b>Il faut</b><div class="needs">${Object.entries(r.needs).map((x) => needChip(x)).join('') || '<span class="note">Rien</span>'}</div>${toolsHTML(r)}
      <div class="recipe-foot"><span class="note">${r.seconds ? `⏳ ${G.duree(r.seconds)}` : 'immédiat'}</span>${VIEW ? '' : `<button class="btn sm" data-craft="${esc(id)}" ${S.craft || G.craftBlock(S, r, CREW) ? 'disabled' : ''}>Préparer</button>`}</div>
    </article>`).join('')}</div>
    ${S.craft ? `<p class="note">En cours : ${esc(S.craft.name)}. À récupérer dans l’onglet Métier une fois prêt.</p>` : ''}`;
}
function renderJobInner() {
  renameJobTab();
  if (nouveautes() && !VIEW && jobView === 'cuisine') {
    $('v-job').innerHTML = jobSwitchHTML() + cookHTML();
    return;
  }
  if ($('v-job')?.offsetParent) refreshFeatures(); // onglet visible : on vérifie si les métiers sont ouverts
  if (FEAT.metiers === false && !VIEW && !beta()) {
    $('v-job').innerHTML = '<div class="feat-off"><span aria-hidden="true">🛠️</span><h2>Fonctionnalité désactivée pour le moment</h2><p class="note">Les métiers reviendront bientôt.</p></div>';
    return;
  }
  if (!S) return;
  const job = S.job.id ? JOBS[S.job.id] : null;
  const recs = Object.entries(G.RECIPES).filter(([, r]) => !r.work && !r.care && (!r.job || r.job === S.job.id));
  const shownRecs = craftFilter === 'dispo' ? recs.filter(([, r]) => !G.craftBlock(S, r, NAVD?.aboard)) : recs;
  const c = S.craft;
  const ready = c && Date.now() >= c.end;
  $('v-job').innerHTML = `
    <div class="job-head">
      <div class="badge">${icon(`metier-${S.job.id || 'aucun'}`)}</div>
      <div>
        <h2>${job ? esc(job.name) : 'Aucun métier'} ${job && !job.noLevel ? `<span class="pips" aria-label="Niveau ${S.job.lvl} sur 3">${[1, 2, 3].map((i) => `<i class="${i <= S.job.lvl ? 'on' : ''}"></i>`).join('')}</span>` : ''}</h2>
        ${job && !job.noLevel ? `<p class="lede" style="margin:0">${JOB_LEVELS[S.job.lvl - 1]}</p>` : ''}
      </div>
    </div>

    ${c ? `<div class="craft-now ${ready ? 'ready' : ''}">
      <div class="craft-gives">${c.work ? `<span class="need">${recipeIco({ work: c.work })}${esc(c.name)}</span>` : ''}${Object.entries(c.gives).map(([k, q]) => `<span class="need">${itemIco(k)}${q} × ${esc(itemOf(k).name)}</span>`).join('')}</div>
      <div class="craft-info">
        <b>${esc(c.name)}</b>
        ${ready ? '<span class="ok">Prête à récupérer !</span>' : `<span>Encore <b id="craft-left">${fmtEnd(c.end)}</b></span>`}
        <div class="gauge" aria-hidden="true"><i id="craft-bar" style="width:${c.end > c.start ? Math.min(100, ((Date.now() - c.start) / (c.end - c.start)) * 100) : 100}%"></i></div>
      </div>
      <div class="craft-acts">
        ${ready ? '<button class="btn" id="craft-collect">Récupérer</button>' : '<button class="btn sm ghost" id="craft-cancel">Annuler</button>'}
        ${tools() && VIEW && !ready ? '<button class="btn sm ghost" id="craft-finish" title="Outil MJ">Terminer (MJ)</button>' : ''}
      </div>
    </div>` : ''}

    <div class="sec-head" style="margin-top:16px">
      <h2 style="font-size:20px">Recettes</h2>
      <div class="seg" role="group" aria-label="Filtre">
        <button aria-pressed="${craftFilter === 'dispo'}" data-cf="dispo">Réalisables</button>
        <button aria-pressed="${craftFilter === 'toutes'}" data-cf="toutes">Toutes</button>
      </div>
    </div>
    ${shownRecs.length ? `<div class="recipes">${shownRecs.map(([id, r]) => {
      const why = G.craftBlock(S, r, NAVD?.aboard);
      return `<article class="recipe ${why ? 'locked' : ''}">
        <h3 class="rc-title">${Object.keys(r.gives).slice(0, 1).map((k) => itemIco(k)).join('')}${esc(G.recipeLabel(r))}</h3>
        <p class="note">${r.job ? `${JOBS[r.job].name}${JOBS[r.job].noLevel ? '' : ` · ${JOB_LEVELS[r.lvl - 1]}`}` : 'Tous métiers'} · ${r.seconds ? `⏳ ${G.duree(r.seconds)}` : 'immédiat'}${r.game?.list?.length ? ' · 🎮 mini-jeu' : ''}</p>
        ${r.desc ? `<p>${esc(r.desc)}</p>` : ''}
        <b>Il faut</b>
        <div class="needs">${Object.entries(r.needs).map((x) => needChip(x)).join('') || '<span class="note">Rien</span>'}</div>
        ${toolsHTML(r)}

        <div class="recipe-foot">
          ${why ? `<span class="req">${esc(why)}</span>` : '<span></span>'}
          <button class="btn sm" data-craft="${esc(id)}" ${why || c ? 'disabled' : ''}>${c ? 'Atelier occupé' : 'Fabriquer'}</button>
        </div>
      </article>`;
    }).join('')}</div>` : `<p class="note">${recs.length ? 'Aucune recette réalisable pour l’instant : il te manque des objets. Affiche « Toutes » pour voir ce qu’il faut.' : 'Aucune recette pour ton métier pour l’instant.'}</p>`}${atelierHTML()}${cabinetHTML()}${inventionsHTML()}`;
  if (nouveautes() && !VIEW) $('v-job').insertAdjacentHTML('afterbegin', jobSwitchHTML()); // sous-onglets Métier / Cuisine
}
$('v-job').addEventListener('click', async (e) => {
  const cf = e.target.closest('[data-cf]')?.dataset.cf;
  if (cf) {
    craftFilter = cf;
    return renderJob();
  }
  const id = e.target.closest('[data-craft]')?.dataset.craft;
  if (id) {
    const r = G.RECIPES[id];
    if (r?.game?.list?.length) {
      // Recette avec mini-jeu : les ingrédients sont perdus en cas d'échec
      if (!(await askConfirm('Si tu rates le mini-jeu, rien n’est perdu, mais tu devras attendre la moitié du temps de la recette avant de réessayer.', { title: `${G.recipeLabel(r)} ?`, ok: 'Commencer' }))) return;
      const success = await customGame(r, S.job.lvl, G.recipeLabel(r));
      return void run({ type: 'craft.start', id, success });
    }
    return void run({ type: 'craft.start', id });
  }
  if (e.target.id === 'craft-collect' && (await run({ type: 'craft.collect' }))) replay(document.querySelector('#v-job .badge'), 'bought');
  if (e.target.id === 'craft-cancel' && (await askConfirm('Les ingrédients te seront rendus.', { title: 'Annuler la fabrication ?', ok: 'Annuler la fabrication', danger: true }))) run({ type: 'craft.cancel' });
  if (e.target.id === 'craft-finish') staffAct({ type: 'craft.finish' });
});
// Compte à rebours de la fabrication en cours
setInterval(() => {
  const left = $('craft-left');
  if (!left || !S?.craft) return;
  const c = S.craft;
  if (Date.now() >= c.end) return renderJob();
  left.textContent = fmtEnd(c.end);
  const bar = $('craft-bar');
  if (bar) bar.style.width = `${Math.min(100, ((Date.now() - c.start) / (c.end - c.start)) * 100)}%`;
}, 1000);

/* ═══ Atelier naval du charpentier ═══════════════════════════════════════ */
let atelierShip = null;
let atelierWood = {}; // bois choisi pour chaque recette de construction « bois au choix »
/** Les trois statistiques d'un bateau et sa coque. */
function shipStatsHTML(sh) {
  const st = G.shipStats(sh);
  const pct = Math.round((st.hull / Math.max(1, st.hullMax)) * 100);
  return `<div class="ship-trio"><span title="Vitesse">${icon('ship-speed')} <b>${st.speed}</b><small>Vitesse</small></span><span title="Robustesse">${icon('ship-robust')} <b>${st.robust}</b><small>Robustesse</small></span><span title="Puissance offensive">${icon('ship-power')} <b>${st.power}</b><small>Puissance</small></span></div>
    <div class="gauge hull ${st.damaged ? 'bad' : ''}" aria-label="Coque"><i style="width:${pct}%"></i></div>
    <div class="gauge-cap"><span>Coque${st.damaged ? ' · ⚠️ en avarie' : ''}</span><span>${st.hull} / ${st.hullMax}</span></div>`;
}
/** Section « Atelier naval » de l'onglet Métier, pour les charpentiers. */
function atelierHTML() {
  if (S.job.id !== 'charpentier') return '';
  const works = Object.entries(G.RECIPES).filter(([, r]) => r.work);
  if (!works.length) return '';
  const ships = SHIPS.filter((sh) => G.canManageShip(S, sh, CREW));
  if (!ships.some((x) => x.id === atelierShip)) atelierShip = ships[0]?.id ?? null;
  const ship = ships.find((x) => x.id === atelierShip) || null;
  const st = ship ? G.shipStats(ship) : null;
  return `<div class="sec-head" style="margin-top:22px"><h2 style="font-size:20px">⚓ Atelier naval</h2></div>
    <p class="note">Choisis un bateau et un travail. Les matériaux sont pris au début : réussis le mini-jeu pour que le travail tienne.</p>
    ${ships.length ? `<div class="mj-row"><label for="atelier-ship">Bateau</label><select id="atelier-ship">${ships.map((x) => `<option value="${esc(x.id)}" ${x.id === atelierShip ? 'selected' : ''}>${esc(x.name)} (${esc(x.type)})</option>`).join('')}</select>${st ? `<span class="note">Vitesse ${st.speed} · Robustesse ${st.robust} · Puissance ${st.power} · Coque ${st.hull}/${st.hullMax}</span>` : ''}</div>` : '<p class="note">Tu n’as pas de bateau à travailler (à toi, ou à ton équipage avec la permission « Choisir le bateau »). Tu peux quand même en construire un.</p>'}
    <div class="recipes">${works.map(([id, r0]) => {
      // Construction au bois au choix : le bois choisi s'ajoute aux ingrédients
      const choix = r0.work.type === 'construire' && r0.work.wood === 'choix';
      const wood = atelierWood[id] || 'standard';
      const r = choix ? { ...r0, work: { ...r0.work, wood }, needs: G.workNeeds(r0, wood) } : r0;
      const store = r.work.type === 'construire' ? NAVD?.aboard : ship; // cale du bateau travaillé (ou de celui où l'on est à bord)
      const why = G.workBlock(S, r, r.work.type === 'construire' ? null : ship, store);
      return `<article class="recipe ${why ? 'locked' : ''}">
        <h3 class="rc-title">${recipeIco(r)}${esc(G.workLabel(r.work))}</h3>
        ${choix ? `<div class="mj-row"><label>Bois</label><select data-wood-for="${esc(id)}" aria-label="Bois du bateau">${Object.entries(G.WOODS).map(([k, w]) => `<option value="${k}" ${k === wood ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}</select></div>` : ''}
        <p class="note">${r.job ? `${JOBS[r.job].name}${JOBS[r.job].noLevel ? '' : ` · ${JOB_LEVELS[r.lvl - 1]}`}` : 'Tous métiers'}${r.work.type === 'voile' ? ` · rang ${JOB_LEVELS[G.sailRank(r.work.level) - 1]}` : ''}</p>
        ${r.desc ? `<p>${esc(r.desc)}</p>` : ''}
        <b>Il faut</b>
        <div class="needs">${Object.entries(r.needs).map((x) => needChip(x, true, store)).join('') || '<span class="note">Rien</span>'}</div>
        ${toolsHTML(r, store)}
        <div class="recipe-foot">${why ? `<span class="req">${esc(why)}</span>` : '<span></span>'}<button class="btn sm" data-work="${esc(id)}" ${why ? 'disabled' : ''}>Travailler</button></div>
      </article>`;
    }).join('')}</div>`;
}
$('v-job').addEventListener('change', (e) => {
  const wf = e.target.dataset?.woodFor;
  if (wf) {
    atelierWood[wf] = e.target.value;
    return renderJob();
  }
  if (e.target.id === 'atelier-ship') {
    atelierShip = e.target.value;
    renderJob();
  }
});
$('v-job').addEventListener('click', (e) => {
  const id = e.target.closest('[data-work]')?.dataset.work;
  if (id) startWork(id);
});
async function startWork(id) {
  const r0 = G.RECIPES[id];
  if (!r0?.work) return;
  const wood = r0.work.type === 'construire' && r0.work.wood === 'choix' ? atelierWood[id] || 'standard' : null;
  const r = wood ? { ...r0, work: { ...r0.work, wood }, needs: G.workNeeds(r0, wood) } : r0;
  const label = G.workLabel(r.work);
  if (!(await askConfirm('Les matériaux seront pris tout de suite. Si tu rates le mini-jeu, ils sont perdus.', { title: `${label} ?`, ok: 'Commencer' }))) return;
  const success = r.game ? await customGame(r, S.job.lvl, label) : await workGame(r, S.job.lvl, label);
  await run({ type: 'ship.work', id, shipId: r.work.type === 'construire' ? null : atelierShip, success, wood: wood || undefined });
}
/** Mini-jeu du marteau : planter les clous quand le curseur passe dans la zone dorée. Renvoie true si réussi. */
function nailGame(diff, title) {
  return new Promise((resolve) => {
    const d = $('d-nail'), board = $('nail-board'), cur = $('nail-cursor'), zone = $('nail-zone');
    $('nail-title').textContent = title;
    let pos = 0, dir = 1, last = performance.now(), raf = 0, hits = 0, left = diff.strikes, done = false, zx = 0;
    const placeZone = () => {
      zx = 10 + Math.random() * (80 - diff.zone);
      zone.style.left = `${zx}%`;
      zone.style.width = `${diff.zone}%`;
    };
    const paint = () => {
      $('nail-row').innerHTML = Array.from({ length: diff.nails }, (_, i) => `<span class="nail ${i < hits ? 'in' : ''}">${i < hits ? diff.icon || '🔩' : '◦'}</span>`).join('') + `<small class="note">${left} coup${left > 1 ? 's' : ''} restant${left > 1 ? 's' : ''}</small>`;
    };
    const stop = () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', key);
    };
    const finish = (ok) => {
      if (done) return;
      done = true;
      stop();
      $('nail-msg').textContent = ok ? 'Travail solide !' : 'Raté…';
      setTimeout(() => {
        if (d.open) closeDialog(d);
        resolve(ok);
      }, 900);
    };
    const hit = () => {
      if (done) return;
      left--;
      if (pos >= zx && pos <= zx + diff.zone) {
        hits++;
        $('nail-msg').textContent = 'Bien planté !';
        placeZone();
      } else {
        replay(board, 'shake');
        $('nail-msg').textContent = 'À côté…';
      }
      paint();
      if (hits >= diff.nails) return finish(true);
      if (hits + left < diff.nails) finish(false);
    };
    const key = (e) => {
      if (e.code !== 'Space' || e.repeat || e.target.closest?.('button')) return;
      e.preventDefault();
      hit();
    };
    const tick = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      pos += dir * diff.speed * 100 * dt;
      if (pos >= 100) { pos = 100; dir = -1; }
      if (pos <= 0) { pos = 0; dir = 1; }
      cur.style.left = `${pos}%`;
      raf = requestAnimationFrame(tick);
    };
    $('nail-hit').textContent = diff.verb || '🔨 Frapper';
    $('nail-hit').onclick = hit;
    board.onclick = hit;
    d.addEventListener('close', () => {
      if (done) return;
      done = true;
      stop();
      resolve(false); // fenêtre fermée en cours de route : travail abandonné
    }, { once: true });
    document.addEventListener('keydown', key);
    $('nail-msg').textContent = '';
    placeZone();
    paint();
    openDialog('d-nail');
    raf = requestAnimationFrame((t) => {
      last = t;
      tick(t);
    });
  });
}
/** Champs « Travail sur bateau » de l'éditeur de recette. */
function workFieldsHTML(r) {
  const w = r.work || null;
  const models = Object.entries(G.ITEMS).filter(([, it]) => it.kind === 'bateau');
  const sel = (id, obj, cur) => `<select id="${id}">${Object.entries(obj).map(([k, v]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${esc(typeof v === 'string' ? v : v.name)}</option>`).join('')}</select>`;
  return `<div class="wide work-box"><label for="rc-work">Travail sur bateau (atelier du charpentier)</label>
    <select id="rc-work"><option value="">Aucun : recette normale</option>${Object.entries(G.SHIP_WORKS).map(([k, l]) => `<option value="${k}" ${w?.type === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
    ${w?.type === 'construire' ? `<div class="mj-row"><label for="rc-w-model">Type</label><select id="rc-w-model">${models.map(([k, it]) => `<option value="${esc(k)}" ${k === w.model ? 'selected' : ''}>${esc(it.name)}</option>`).join('') || '<option value="">Crée d’abord un modèle (Gestion, catégorie Bateau)</option>'}</select><label for="rc-w-wood">Bois</label><select id="rc-w-wood"><option value="choix" ${w.wood === 'choix' ? 'selected' : ''}>Au choix du charpentier</option>${Object.entries(G.WOODS).map(([k, v]) => `<option value="${k}" ${k === w.wood ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select>${w.wood === 'choix' ? `<label for="rc-w-wqty">Quantité de bois</label><input id="rc-w-wqty" type="number" min="0" value="${w.woodQty || 0}">` : ''}</div>
    ${w.wood === 'choix' ? '<p class="note" style="margin:0">Le bois choisi par le charpentier s’ajoute aux ingrédients. L’objet de chaque bois se règle dans Panneau admin > Bateaux > Réglages > Bois de construction.</p>' : ''}` : ''}
    ${w?.type === 'voile' ? `<div class="mj-row"><label for="rc-w-level">Niveau de voile obtenu</label><input id="rc-w-level" type="number" min="1" max="3" value="${w.level}"><span class="note">Niveau 1 : Apprenti · 2 : Confirmé · 3 : Maître. La voile doit être au niveau précédent (0 = voile d’origine).</span></div>` : ''}
    ${w?.type === 'canon' ? `<div class="mj-row"><label for="rc-w-size">Calibre</label>${sel('rc-w-size', G.CANNONS, w.size)}<label for="rc-w-count">Nombre</label><input id="rc-w-count" type="number" min="1" max="20" value="${w.count}"></div>` : ''}
    ${w?.type === 'cale' ? `<div class="mj-row"><label for="rc-w-amount">Cale ajoutée (kg)</label><input id="rc-w-amount" type="number" min="10" value="${w.amount}"></div>` : ''}
    ${w?.type === 'reparation' ? `<div class="mj-row"><label for="rc-w-amount">Coque réparée (%)</label><input id="rc-w-amount" type="number" min="1" max="100" value="${w.amount}"></div>` : ''}
    ${w ? '<p class="note" style="margin:4px 0 0">Un travail s’applique directement au bateau choisi, après le mini-jeu : retire la ligne « Résultat » ci-dessous si tu ne veux pas qu’il donne aussi un objet. Choisis le métier Charpentier.</p>' : ''}
  </div>`;
}
function readWorkFields(r) {
  const t = $('rc-work')?.value;
  if (!t) return void (r.work = null);
  const prev = r.work?.type === t ? r.work : {};
  r.work = G.normalizeWork({
    ...prev, type: t,
    model: $('rc-w-model')?.value ?? prev.model, wood: $('rc-w-wood')?.value ?? prev.wood,
    level: $('rc-w-level')?.value ?? prev.level, size: $('rc-w-size')?.value ?? prev.size,
    count: $('rc-w-count')?.value ?? prev.count, amount: $('rc-w-amount')?.value ?? prev.amount,
    woodQty: $('rc-w-wqty')?.value ?? prev.woodQty,
  });
  if (t === 'construire' && !r.work.model) r.work.model = Object.keys(G.ITEMS).find((k) => G.ITEMS[k].kind === 'bateau') || '';
}

/* ═══ Amarrer son bateau ailleurs dans le port ════════════════════════════ */
document.addEventListener('click', (e) => {
  const id = e.target.closest('[data-dock]')?.dataset.dock;
  if (id) dockDialog(id);
});
async function dockDialog(shipId) {
  const out = await run({ type: 'ship.dock.options', shipId });
  if (!out?.options) return;
  if (!out.options.length) return void toast(`Aucun endroit où s’amarrer sur ${esc(out.island)}.`);
  $('dock-title').textContent = `Amarrer sur ${out.island}`;
  const sel = $('dock-to');
  delete sel.dataset.enhanced;
  if (sel.parentElement?.classList.contains('sel-wrap')) sel.parentElement.replaceWith(sel); // on retire l'ancien filtre
  sel.innerHTML = out.options.map((o) => `<option value="${esc(o.id)}">${o.parentId ? '' : '#'}${esc(o.name)}</option>`).join('');
  $('dock-ok').onclick = async () => {
    const channelId = sel.value;
    closeDialog($('d-dock'));
    await run({ type: 'ship.dock', shipId, channelId });
  };
  openDialog('d-dock');
}

/* ═══ Longs menus déroulants : un champ « Filtrer… » au-dessus ════════════ */
function enhanceSelect(sel) {
  if (sel.dataset.enhanced || sel.options.length < 12) return;
  sel.dataset.enhanced = '1';
  const q = document.createElement('input');
  q.type = 'search';
  q.className = 'sel-search';
  q.placeholder = 'Filtrer…';
  q.setAttribute('aria-label', 'Filtrer la liste');
  q.addEventListener('input', () => {
    const t = normTxt(q.value);
    let first = null;
    for (const o of sel.options) {
      const ok = !t || normTxt(o.textContent).includes(t);
      o.hidden = !ok;
      if (ok && !first && o.value) first = o;
    }
    if (first && sel.selectedOptions[0]?.hidden) sel.value = first.value; // le premier choix qui correspond
  });
  // Le filtre et le menu restent ensemble dans la même case (lignes en grille : ingrédients, boutique, butins…)
  const wrap = document.createElement('span');
  wrap.className = 'sel-wrap';
  sel.replaceWith(wrap);
  wrap.append(q, sel);
}
let enhanceQueued = false;
new MutationObserver(() => {
  if (enhanceQueued) return;
  enhanceQueued = true;
  requestAnimationFrame(() => {
    enhanceQueued = false;
    document.querySelectorAll('select').forEach(enhanceSelect);
  });
}).observe(document.body, { childList: true, subtree: true });

/* ═══ Mini-jeux : plusieurs variantes tirées au hasard, contenu différent à chaque partie ═══ */
const mgRnd = (a, b) => a + Math.random() * (b - a);
const mgPick = (arr) => arr[Math.floor(Math.random() * arr.length)];
/** Tracé aléatoire et doux (incision, sciage) : y(x) entre 18 et 142 sur un canevas de 460 × 160. */
function randomCurve(level = 1, straight = false) {
  const mid = mgRnd(60, 100);
  const amp = straight ? mgRnd(4, 10) : mgRnd(16, 26) + level * 4;
  const w = [[mgRnd(0.8, 1.6) * (straight ? 1 : 1 + level * 0.3), mgRnd(0, 6.28), amp], [mgRnd(2, 3.5), mgRnd(0, 6.28), amp * mgRnd(0.15, 0.4)]];
  return (x) => Math.max(18, Math.min(142, mid + w.reduce((s, [f, p, a]) => s + Math.sin((x / 460) * Math.PI * f + p) * a, 0)));
}
/**
 * Chemin libre et aléatoire (incision, sciage) dans un cadre de 460 × 260 : il peut boucler, se croiser
 * et revenir en arrière. gentle : trait plus doux, d'un bord à l'autre (sciage).
 */
function randomPath(level = 1, gentle = false) {
  const W = 460, H = 260, m = 34;
  const n = gentle ? 3 + Math.min(level, 3) : 4 + level * 2;
  const ctrl = [];
  for (let tries = 0; ctrl.length < n && tries < 400; tries++) {
    const p = gentle ? { x: m + ((W - 2 * m) * ctrl.length) / (n - 1), y: mgRnd(70, H - 70) } : { x: mgRnd(m, W - m), y: mgRnd(m, H - m) };
    const prev = ctrl[ctrl.length - 1];
    if (!prev || gentle || Math.hypot(p.x - prev.x, p.y - prev.y) > 90) ctrl.push(p);
  }
  // Courbe de Catmull-Rom qui passe par tous les points de contrôle
  const P = [ctrl[0], ...ctrl, ctrl[ctrl.length - 1]];
  const cr = (a, b, c, d, t) => 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t);
  const out = [];
  for (let i = 1; i < P.length - 2; i++) {
    for (let k = 0; k < 25; k++) {
      const t = k / 25;
      out.push({ x: cr(P[i - 1].x, P[i].x, P[i + 1].x, P[i + 2].x, t), y: cr(P[i - 1].y, P[i].y, P[i + 1].y, P[i + 2].y, t) });
    }
  }
  out.push(ctrl[ctrl.length - 1]);
  return out.map((p) => ({ x: Math.max(8, Math.min(W - 8, p.x)), y: Math.max(8, Math.min(H - 8, p.y)) }));
}
/** Points éparpillés sans se chevaucher (en %), dans une zone environ 2,7 fois plus large que haute. */
function mgScatter(n, minDist = 15) {
  const pts = [];
  for (let tries = 0; pts.length < n && tries < 800; tries++) {
    const p = { x: mgRnd(7, 93), y: mgRnd(14, 86) };
    if (pts.every((q) => Math.hypot((q.x - p.x) * 2.7, q.y - p.y) > minDist)) pts.push(p);
  }
  while (pts.length < n) pts.push({ x: mgRnd(7, 93), y: mgRnd(14, 86) });
  return pts;
}
/**
 * Fenêtre de mini-jeu : enchaîne des étapes. Avec drain > 0, les constantes vitales baissent
 * pendant toute la partie (opération). Renvoie true si toutes les étapes sont réussies.
 */
function miniGame({ title, help = '', drain = 0, steps, doneText = null }) {
  return new Promise((resolve) => {
    const d = $('d-mg'), area = $('mg-area');
    $('mg-title').textContent = title;
    $('mg-help').textContent = help;
    $('mg-step').textContent = '';
    $('mg-vit-wrap').hidden = !drain;
    $('mg-vit').style.width = '100%';
    $('mg-vit-n').textContent = '100 %';
    $('mg-vit').parentElement.classList.remove('bad');
    $('mg-msg').textContent = '';
    let vit = 100, i = -1, done = false, raf = 0, last = performance.now(), tickFn = null;
    const key = (e) => {
      if (e.code !== 'Space' || e.repeat || e.target.closest?.('button, input')) return;
      e.preventDefault();
      $('mg-hit')?.click();
    };
    const stop = () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', key);
    };
    const finish = (ok, text) => {
      if (done) return;
      done = true;
      stop();
      $('mg-msg').textContent = text || (ok ? 'Réussi !' : 'Raté…');
      setTimeout(() => {
        if (d.open) closeDialog(d);
        resolve(ok);
      }, 1100);
    };
    const api = {
      area,
      msg: (t) => ($('mg-msg').textContent = t),
      hurt: (n, t) => {
        if (drain) vit -= n;
        if (t) api.msg(t);
      },
      onTick: (fn) => (tickFn = fn),
      next: () => {
        if (done) return;
        tickFn = null;
        i++;
        if (i >= steps.length) return finish(true, drain ? 'Opération réussie : le patient est sauvé !' : doneText || 'Travail réussi !');
        $('mg-step').textContent = steps.length > 1 ? `Étape ${i + 1} sur ${steps.length}` : '';
        steps[i](api);
      },
      fail: (t) => finish(false, t),
    };
    const tick = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (drain) {
        vit -= drain * dt;
        const v = Math.max(0, vit);
        $('mg-vit').style.width = `${v}%`;
        $('mg-vit-n').textContent = `${Math.round(v)} %`;
        $('mg-vit').parentElement.classList.toggle('bad', v < 30);
        if (vit <= 0) return finish(false, 'Les constantes se sont effondrées : opération ratée.');
      }
      tickFn?.(dt);
      if (!done) raf = requestAnimationFrame(tick);
    };
    d.addEventListener('close', () => {
      if (done) return;
      done = true;
      stop();
      resolve(false); // fenêtre fermée : abandon
    }, { once: true });
    document.addEventListener('keydown', key);
    openDialog('d-mg');
    api.next();
    raf = requestAnimationFrame((t) => {
      last = t;
      tick(t);
    });
  });
}
/** Étape « au bon moment » : un curseur va et vient, il faut frapper dans la zone. */
const timingStep = (o) => (api) => {
  let pos = 0, dir = 1, zx = 0, got = 0, miss = 0;
  api.area.innerHTML = `<p class="op-step">${o.label}</p><div class="nail-board ${o.cls || ''}" id="mg-board"><div class="nail-zone ${o.zoneCls || ''}" id="mg-zone"></div><div class="nail-cursor" id="mg-cur"></div></div>
    <div class="nail-row" id="mg-row"></div><div class="form-actions"><button type="button" class="btn" id="mg-hit">${o.verb}</button></div>`;
  const place = () => {
    zx = mgRnd(5, 95 - o.zone);
    $('mg-zone').style.left = `${zx}%`;
    $('mg-zone').style.width = `${o.zone}%`;
  };
  const row = () => {
    const left = o.misses != null ? o.misses - miss : null;
    $('mg-row').innerHTML = `${Array.from({ length: o.hits }, (_, k) => `<span class="nail ${k < got ? 'in' : ''}">${k < got ? o.icon : '◦'}</span>`).join('')}${left != null ? `<small class="note">${left} erreur${left > 1 ? 's' : ''} permise${left > 1 ? 's' : ''}</small>` : ''}`;
  };
  const hit = () => {
    if (pos >= zx && pos <= zx + o.zone) {
      got++;
      api.msg(o.good || 'Bien !');
      if (got >= o.hits) return api.next();
      place();
    } else {
      replay($('mg-board'), 'shake');
      miss++;
      if (o.penalty) api.hurt(o.penalty, o.bad || 'Raté !');
      else api.msg(o.bad || 'À côté…');
      if (o.misses != null && miss > o.misses) return api.fail();
    }
    row();
  };
  $('mg-hit').onclick = hit;
  $('mg-board').onclick = hit;
  api.onTick((dt) => {
    pos += dir * o.speed * 100 * dt;
    if (pos >= 100) { pos = 100; dir = -1; }
    if (pos <= 0) { pos = 0; dir = 1; }
    const c = $('mg-cur');
    if (c) c.style.left = `${pos}%`;
  });
  place();
  row();
};
/** Étape « tracé » : suivre un chemin libre (boucles, retours en arrière) du point vert au point rouge, sans lâcher. */
const traceStep = (o) => (api) => {
  const W = 460, H = 260, pts = o.path;
  let tries = o.tries ?? null, drawing = false, dev = [], prog = 0;
  api.area.innerHTML = `<p class="op-step">${o.label}</p><canvas id="mg-cv" class="op-cv trace-cv ${o.cls || ''}" width="${W}" height="${H}"></canvas>${tries != null ? '<p class="note" id="mg-tries" style="margin:4px 0 0"></p>' : ''}`;
  const cv = $('mg-cv'), g = cv.getContext('2d');
  const showTries = () => tries != null && ($('mg-tries').textContent = `${tries} essai${tries > 1 ? 's' : ''} restant${tries > 1 ? 's' : ''}`);
  const drawPath = () => {
    g.clearRect(0, 0, W, H);
    g.setLineDash([6, 6]);
    g.strokeStyle = '#17255e';
    g.lineWidth = 2;
    g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
    g.stroke();
    g.setLineDash([]);
    // Petites flèches : le sens du chemin
    g.fillStyle = 'rgba(23,37,94,.55)';
    for (let i = 12; i < pts.length - 6; i += 18) {
      const a = pts[i], b = pts[i + 2];
      g.save();
      g.translate(a.x, a.y);
      g.rotate(Math.atan2(b.y - a.y, b.x - a.x));
      g.beginPath();
      g.moveTo(6, 0);
      g.lineTo(-4, -4);
      g.lineTo(-4, 4);
      g.fill();
      g.restore();
    }
    const s = pts[0], f = pts[pts.length - 1];
    g.fillStyle = '#2f9a55';
    g.beginPath();
    g.arc(s.x, s.y, 8, 0, 7);
    g.fill();
    g.fillStyle = '#c7352c';
    g.beginPath();
    g.arc(f.x, f.y, 6, 0, 7);
    g.fill();
  };
  const pt = (e) => {
    const r = cv.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };
  const missed = (text) => {
    if (o.penalty) api.hurt(o.slip ?? 8, text);
    else api.msg(text);
    if (tries != null && --tries <= 0) return api.fail('Trop d’essais ratés.');
    showTries();
    drawPath();
  };
  cv.onpointerdown = (e) => {
    const p = pt(e);
    if (Math.hypot(p.x - pts[0].x, p.y - pts[0].y) > 22) return void api.msg('Commence sur le point vert.');
    drawing = true;
    dev = [];
    prog = 0;
    cv.setPointerCapture(e.pointerId);
    drawPath();
    g.strokeStyle = o.ink || '#c7352c';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(p.x, p.y);
  };
  cv.onpointermove = (e) => {
    if (!drawing) return;
    const p = pt(e);
    // Point du chemin le plus proche, en avançant seulement : on suit le chemin dans l'ordre, boucles comprises
    let best = prog, bd = Infinity;
    for (let j = prog; j < Math.min(pts.length, prog + 30); j++) {
      const dd = Math.hypot(p.x - pts[j].x, p.y - pts[j].y);
      if (dd < bd) {
        bd = dd;
        best = j;
      }
    }
    dev.push(bd);
    if (bd < o.tolerance * 3) prog = best;
    g.lineTo(p.x, p.y);
    g.stroke();
    if (prog < pts.length - 3) return;
    drawing = false;
    const avg = dev.reduce((a, b) => a + b, 0) / Math.max(1, dev.length);
    if (avg > o.tolerance) {
      if (o.penalty) {
        api.hurt(Math.min(35, (avg - o.tolerance) * 2), o.bad || 'Tracé imprécis…');
        return api.next();
      }
      return missed(o.bad || 'Trop imprécis : recommence.');
    }
    api.msg(o.good || 'Tracé propre.');
    api.next();
  };
  cv.onpointerup = () => {
    if (!drawing) return;
    drawing = false;
    missed('Tu as lâché : recommence.');
  };
  drawPath();
  showTries();
};
/** Étape « dans l'ordre » : des points numérotés (1, 2, 3…) éparpillés n'importe où dans la zone. */
const orderStep = (o) => (api) => {
  const pts = mgScatter(o.n, o.n > 8 ? 12 : 15);
  let next = 1, miss = 0;
  api.area.innerHTML = `<p class="op-step">${o.label}</p><div class="op-sut tall ${o.cls || ''}" id="mg-pts">${pts.map((p, k) => `<button type="button" class="op-pt" data-pt="${k + 1}" style="left:${p.x}%;top:${p.y}%">${k + 1}</button>`).join('')}</div>`;
  $('mg-pts').onclick = (e) => {
    const b = e.target.closest('[data-pt]');
    if (!b || b.disabled) return;
    if (+b.dataset.pt === next) {
      b.classList.add('done');
      b.disabled = true;
      next++;
      if (next > o.n) api.next();
    } else {
      replay(b, 'shake');
      miss++;
      if (o.penalty) api.hurt(o.penalty, o.bad || 'Mauvais point !');
      else api.msg(o.bad || 'Pas dans l’ordre !');
      if (o.misses != null && miss > o.misses) api.fail('Trop d’erreurs.');
    }
  };
};
/** Étape « réflexes » : des cibles apparaissent n'importe où, il faut cliquer avant qu'elles disparaissent. */
const whackStep = (o) => (api) => {
  let hit = 0, miss = 0, t = 0, since = o.every, alive = [];
  api.area.innerHTML = `<p class="op-step">${o.label}</p><div class="op-sut whack ${o.cls || ''}" id="mg-wh"></div><div class="nail-row" id="mg-row"></div>`;
  const box = $('mg-wh');
  const row = () => ($('mg-row').innerHTML = `<small class="note">${hit} / ${o.total}${o.misses != null ? ` · ${o.misses - miss} oubli${o.misses - miss > 1 ? 's' : ''} permis` : ''}</small>`);
  const spawn = () => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'wh-t';
    b.textContent = o.icon;
    b.style.left = `${mgRnd(8, 92)}%`;
    b.style.top = `${mgRnd(15, 85)}%`;
    b.dataset.born = String(t);
    box.appendChild(b);
    alive.push(b);
  };
  box.onclick = (e) => {
    const b = e.target.closest('.wh-t');
    if (!b) return;
    b.remove();
    alive = alive.filter((x) => x !== b);
    hit++;
    if (hit >= o.total) return api.next();
    row();
  };
  api.onTick((dt) => {
    t += dt;
    since += dt;
    if (since >= o.every && hit + alive.length < o.total + 2) {
      since = 0;
      spawn();
    }
    for (const b of [...alive]) {
      if (t - +b.dataset.born <= o.life) continue;
      b.remove();
      alive = alive.filter((x) => x !== b);
      miss++;
      if (o.penalty) api.hurt(o.penalty, o.bad || 'Trop tard !');
      else api.msg(o.bad || 'Trop tard !');
      if (o.misses != null && miss > o.misses) return api.fail('Trop d’oublis.');
      row();
    }
  });
  row();
};
/** Étape « mémoire » : des pièces s'allument dans un ordre aléatoire, il faut le refaire. */
const simonStep = (o) => (api) => {
  const colors = ['#c7352c', '#2f6fd0', '#2f9a55', '#e6a223'];
  const seq = Array.from({ length: o.len }, () => Math.floor(Math.random() * 4));
  let k = 0, showing = true, miss = 0;
  api.area.innerHTML = `<p class="op-step">${o.label}</p><div class="simon" id="mg-sim">${colors.map((c, j) => `<button type="button" class="sim-pad" data-pad="${j}" style="--c:${c}" disabled>${o.icons?.[j] || ''}</button>`).join('')}</div>`;
  const pads = () => document.querySelectorAll('#mg-sim .sim-pad');
  const flash = (j) => {
    const p = document.querySelector(`#mg-sim [data-pad="${j}"]`);
    if (!p) return;
    p.classList.add('lit');
    setTimeout(() => p.classList.remove('lit'), 380);
  };
  const play = () => {
    if (!$('mg-sim')) return;
    showing = true;
    api.msg('Regarde bien…');
    pads().forEach((p) => (p.disabled = true));
    seq.forEach((j, n) => setTimeout(() => flash(j), 600 + n * 550));
    setTimeout(() => {
      if (!$('mg-sim')) return;
      showing = false;
      k = 0;
      api.msg('À toi : refais la même suite.');
      pads().forEach((p) => (p.disabled = false));
    }, 600 + seq.length * 550 + 200);
  };
  $('mg-sim').onclick = (e) => {
    const p = e.target.closest('[data-pad]');
    if (!p || showing) return;
    const j = +p.dataset.pad;
    flash(j);
    if (j === seq[k]) {
      if (++k >= seq.length) api.next();
      return;
    }
    miss++;
    replay($('mg-sim'), 'shake');
    if (o.misses != null && miss > o.misses) return api.fail('Mauvais ordre.');
    api.msg('Raté : on recommence la suite.');
    showing = true;
    setTimeout(play, 700);
  };
  play();
};
/** Atelier du charpentier : un mini-jeu au hasard (ou celui demandé), difficulté selon le travail et le rang. */
function workGame(recipe, rank, title, kind = null) {
  const d = G.workDifficulty(recipe, { job: { lvl: rank } });
  const lvl = 1 + Math.round(((d.speed - 0.6) / 1.4) * 4); // 1 (facile) à 5 (très dur)
  const games = {
    marteau: () => timingStep({ label: '🔨 <b>Marteau</b> : frappe quand le curseur passe dans la zone dorée (clic, Espace ou le bouton).', verb: '🔨 Frapper', icon: '🔩', speed: d.speed, zone: d.zone, hits: d.nails, misses: d.strikes - d.nails, good: 'Bien planté !' }),
    scie: () => traceStep({ label: '🪚 <b>Sciage</b> : suis le trait de coupe du point vert au point rouge, sans lâcher.', path: randomPath(lvl, true), tolerance: Math.max(5, 13 - lvl * 1.5 + rank * 1.5), tries: 1 + rank, cls: 'wood-cv', ink: '#5a3a1e', bad: 'Coupe de travers : recommence.', good: 'Coupe nette !' }),
    assemblage: () => simonStep({ label: '🧩 <b>Assemblage</b> : retiens l’ordre des pièces, puis assemble-les dans le même ordre.', len: 2 + lvl, misses: rank - 1, icons: ['🪵', '🔩', '⚙️', '🪢'] }),
    calfatage: () => whackStep({ label: '💧 <b>Calfatage</b> : bouche les fuites avant que l’eau n’entre !', icon: '💧', total: 5 + lvl, life: Math.max(0.9, 2.2 - lvl * 0.25 + rank * 0.2), every: Math.max(0.45, 0.95 - lvl * 0.08), misses: rank, cls: 'hull-wh' }),
  };
  const k = kind && games[kind] ? kind : mgPick(Object.keys(games));
  return miniGame({ title, steps: [games[k]()] });
}
/** Soin d'une blessure légère : un mini-jeu au hasard (ou celui demandé). */
function bandageGame(label, rank = 1, kind = null) {
  const games = {
    serrer: () => timingStep({ label: '🩹 <b>Bandage</b> : serre quand le curseur est dans la zone.', verb: '🩹 Serrer', icon: '🩹', speed: 0.9, zone: 24 + (rank - 1) * 3, hits: 3, misses: 1 + rank }),
    nettoyer: () => whackStep({ label: '🦠 <b>Désinfecter</b> : nettoie les microbes de la plaie avant qu’ils ne s’incrustent.', icon: '🦠', total: 6, life: 1.8 + rank * 0.2, every: 0.8, misses: rank, cls: 'skin-wh' }),
    points: () => orderStep({ label: '🧵 <b>Points de suture</b> : clique les points dans l’ordre (1, 2, 3…).', n: 6, misses: rank }),
  };
  const k = kind && games[kind] ? kind : mgPick(Object.keys(games));
  return miniGame({ title: `Soin léger : ${label}`, steps: [games[k]()] });
}
/** Étapes d'une opération, selon la gravité (2 Sérieuse, 3 Grave, 4 Critique). */
const OP_STEPS = { anesthesie: '💉 Anesthésie', incision: '🔪 Incision', suture: '🧵 Suture', hemorragie: '🩸 Hémorragie' };
function opSteps(level) {
  return {
    anesthesie: () => timingStep({ label: '💉 <b>Anesthésie</b> : injecte quand l’aiguille est dans la zone verte.', verb: '💉 Injecter', icon: '💉', speed: 0.8 + level * 0.25, zone: Math.max(8, 20 - level * 3), hits: 1, penalty: 12, cls: 'op-dose', zoneCls: 'op-ok', bad: 'Mauvaise dose : le patient réagit mal !' }),
    incision: () => traceStep({ label: '🔪 <b>Incision</b> : pars du point vert et suis le tracé jusqu’au point rouge, sans lâcher. Il peut boucler et revenir en arrière : suis les flèches.', path: randomPath(level), tolerance: 11, penalty: 1, bad: 'Incision imprécise…', good: 'Incision propre.' }),
    suture: () => orderStep({ label: '🧵 <b>Suture</b> : clique les points dans l’ordre (1, 2, 3…).', n: 5 + level * 2, penalty: 6 }),
    hemorragie: () => whackStep({ label: '🩸 <b>Hémorragie</b> : comprime les saignements avant qu’ils ne s’aggravent !', icon: '🩸', total: 3 + level, life: Math.max(1, 2.4 - level * 0.3), every: 0.8, penalty: 6, cls: 'skin-wh' }),
  };
}
/**
 * Opération : anesthésie, puis 2 étapes au hasard (3 pour une blessure critique), pendant que les constantes baissent.
 * only : une seule étape (test dans le panneau admin).
 */
function opGame2(level, title, rank = S?.job?.lvl || 1, only = null, opts = {}) {
  // Vitesse de chute des constantes (% par seconde) : durée choisie par le staff, sinon selon la gravité et le rang
  const drain = opts.time ? 100 / opts.time : Math.max(0.8, 0.8 + level * 0.6 - (rank - G.careRank(level)) * 0.4);
  const s = opSteps(opts.diff || level); // difficulté choisie par le staff, sinon la gravité
  const pool = opts.list?.length ? opts.list : ['incision', 'suture', 'hemorragie'];
  const steps = only && s[only]
    ? [s[only]()]
    : [s.anesthesie(), ...(opts.all ? pool : [...pool].sort(() => Math.random() - 0.5).slice(0, Math.min(pool.length, level >= 4 ? 3 : 2))).map((k) => (s[k] ? s[k]() : SIMPLE_GAMES[k][1](opts.diff || level, rank)))];
  return miniGame({ title, help: `Garde le patient en vie : ses constantes baissent pendant toute l’opération (environ ${Math.round(100 / drain)} s sans erreur).`, drain, steps });
}

/* ═══ Mini-jeux choisis recette par recette ══════════════════════════════ */
const SIMPLE_GAMES = {
  marteau: ['🔨 Marteau', (d, rank) => timingStep({ label: '🔨 <b>Marteau</b> : frappe quand le curseur passe dans la zone dorée.', verb: '🔨 Frapper', icon: '🔩', speed: 0.6 + d * 0.28, zone: Math.max(6, 24 - d * 3.5 + (rank - 1) * 4), hits: 3 + Math.ceil(d / 2), misses: 1 + rank, good: 'Bien planté !' })],
  scie: ['🪚 Sciage', (d, rank) => traceStep({ label: '🪚 <b>Sciage</b> : suis le trait de coupe du point vert au point rouge, sans lâcher.', path: randomPath(d, true), tolerance: Math.max(5, 14 - d * 1.6 + rank * 1.5), tries: 1 + rank, cls: 'wood-cv', ink: '#5a3a1e', bad: 'Coupe de travers : recommence.', good: 'Coupe nette !' })],
  trace: ['✏️ Tracé libre', (d, rank) => traceStep({ label: '✏️ <b>Tracé</b> : suis le chemin du point vert au point rouge, sans lâcher (il peut boucler : suis les flèches).', path: randomPath(d), tolerance: Math.max(6, 15 - d * 1.5 + rank * 1.5), tries: 1 + rank })],
  assemblage: ['🧩 Assemblage', (d, rank) => simonStep({ label: '🧩 <b>Assemblage</b> : retiens l’ordre des pièces, puis refais-le.', len: 2 + d, misses: rank - 1, icons: ['🪵', '🔩', '⚙️', '🪢'] })],
  calfatage: ['💧 Calfatage', (d, rank) => whackStep({ label: '💧 <b>Calfatage</b> : bouche les fuites avant que l’eau n’entre !', icon: '💧', total: 4 + d, life: Math.max(0.8, 2.4 - d * 0.3 + rank * 0.2), every: Math.max(0.4, 1 - d * 0.1), misses: rank, cls: 'hull-wh' })],
  bandage: ['🩹 Bandage', (d, rank) => timingStep({ label: '🩹 <b>Bandage</b> : serre quand le curseur est dans la zone.', verb: '🩹 Serrer', icon: '🩹', speed: 0.6 + d * 0.2, zone: Math.max(8, 30 - d * 4 + (rank - 1) * 3), hits: 2 + Math.ceil(d / 2), misses: 1 + rank })],
  desinfecter: ['🦠 Désinfecter', (d, rank) => whackStep({ label: '🦠 <b>Désinfecter</b> : nettoie les microbes avant qu’ils ne s’incrustent.', icon: '🦠', total: 4 + d, life: Math.max(0.9, 2.4 - d * 0.25 + rank * 0.2), every: 0.8, misses: rank, cls: 'skin-wh' })],
  points: ['🔢 Points dans l’ordre', (d, rank) => orderStep({ label: '🔢 <b>Dans l’ordre</b> : clique les points dans l’ordre (1, 2, 3…).', n: 3 + d * 2, misses: rank })],
  extraction: ['🔧 Extraction', (d, rank) => extractionStep({ label: '🔧 <b>Extraction</b> : guide la pince du point vert jusqu’à l’éclat, sans toucher les parois.', path: randomPath(Math.max(1, d - 1)), width: Math.max(16, 34 - d * 3 + rank * 2), penalty: 8 })],
  reduction: ['🦴 Réduction', (d, rank) => rotateStep({ label: '🦴 <b>Réduction</b> : fais pivoter chaque fragment d’os (clic) jusqu’à ce que toutes les flèches pointent vers le haut.', n: 3 + Math.ceil(d / 2), icon: '🦴', dur: Math.max(10, 22 - d * 2 + rank * 2) })],
  massage: ['❤️ Massage cardiaque', (d, rank) => rhythmStep({ label: '❤️ <b>Massage cardiaque</b> : appuie au moment où le cœur bat (clic, Espace ou le bouton).', beat: Math.max(0.5, 0.85 - d * 0.06), win: 0.1 + rank * 0.03, goal: 8 + d * 2, penalty: 4 })],
  transfusion: ['🩸 Transfusion', (d, rank) => holdStep({ label: '🩸 <b>Transfusion</b> : maintiens le bouton (ou Espace) pour injecter, et garde le niveau de sang dans la zone verte.', lo: 45, hi: Math.min(85, 75 - d * 3 + rank * 2), need: 6 + d, dur: 20 + d * 2, penalty: 3 })],
  fouiller: ['🖌️ Fouiller', (d, rank) => scratchStep({ label: '🖌️ <b>Fouiller</b> : dégage la relique de la terre en glissant dessus, doucement pour ne pas l’abîmer.', icon: '🏺', dur: Math.max(14, 26 - d * 2 + rank * 2), maxSpeed: 1.1 - d * 0.1 + rank * 0.1 })],
  recoller: ['🏺 Recoller', (d, rank) => rotateStep({ label: '🏺 <b>Recoller</b> : fais pivoter chaque fragment (clic) jusqu’à ce que toutes les flèches pointent vers le haut.', n: 3 + Math.ceil(d / 2), icon: '🧩', dur: Math.max(10, 24 - d * 2 + rank * 2) })],
  dechiffrer: ['📜 Déchiffrer', (d, rank) => pairsStep({ label: '📜 <b>Déchiffrer</b> : retrouve les paires de symboles gravés.', pairs: Math.min(8, 3 + d), misses: Math.max(2, 8 - d + rank) })],
};
const OP_KEYS = ['incision', 'suture', 'hemorragie'];
const DIFF_NAMES = ['Automatique', 'Très facile', 'Facile', 'Normale', 'Difficile', 'Extrême'];
/** Mini-jeu d'une recette, selon ce que le staff a choisi (jeux et difficulté). careLevel ≥ 2 : opération. */
function customGame(recipe, rank, title, careLevel = 0) {
  const g = recipe.game || { list: [], diff: 0 };
  const chosen = g.list.filter((k) => OP_KEYS.includes(k) || SIMPLE_GAMES[k]);
  if (careLevel >= 2) {
    // Opération : anesthésie, puis des étapes tirées parmi TOUT ce qui est coché
    return opGame2(careLevel, `Opération : ${title}`, rank, null, { list: chosen.length ? chosen : OP_KEYS, diff: g.diff || 0, all: chosen.length > 0, time: g.time || 0 });
  }
  // Jeu simple : les gestes médicaux deviennent leur version simple
  const SIMPLE_OF = { incision: 'trace', suture: 'points', hemorragie: 'desinfecter' };
  let pool = [...new Set(chosen.map((k) => SIMPLE_OF[k] || k))];
  if (!pool.length) pool = recipe.work ? ['marteau', 'scie', 'assemblage', 'calfatage'] : recipe.care ? ['bandage', 'desinfecter', 'points'] : ['marteau', 'assemblage', 'points', 'trace'];
  const auto = recipe.work ? 1 + Math.round(((G.workDifficulty(recipe, { job: { lvl: rank } }).speed - 0.6) / 1.4) * 4) : 2;
  const keys = chosen.length ? pool : [mgPick(pool)]; // cochés : tous, l'un après l'autre ; sinon un jeu habituel
  return miniGame({ title, steps: keys.map((k) => SIMPLE_GAMES[k][1](g.diff || auto, rank)) });
}
let rcTest = { rank: 1, lvl: 1 }; // rang et gravité choisis pour tester le mini-jeu d'une recette
/** Section « Mini-jeu » de l'éditeur de recette. */
function gameFieldsHTML(r) {
  const g = r.game || { list: [], diff: 0 };
  const box = (k, label) => `<label><input type="checkbox" data-game="${k}" ${g.list.includes(k) ? 'checked' : ''}> ${label}</label>`;
  const isOp = r.care && r.care.level >= 2;
  return `<div class="wide"><label><input type="checkbox" id="rc-kitchen" ${r.kitchen ? 'checked' : ''}> 🥘 Recette de base de la cuisine (dans l’onglet Cuisine, pour tout le monde)</label></div><div class="wide work-box"><b>🎮 Mini-jeu</b>
    <div class="mj-row"><label for="rc-gdiff">Difficulté</label><select id="rc-gdiff">${DIFF_NAMES.map((l, i) => `<option value="${i}" ${(g.diff || 0) === i ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    ${r.care ? `<div class="mj-row"><label for="rc-gtime">Durée de l’opération</label><input id="rc-gtime" type="number" min="0" max="600" value="${g.time || 0}" style="width:90px"><span class="note">secondes avant que les constantes tombent à zéro (0 = automatique)</span></div>` : ''}
    <div class="mj-row"><label for="rc-trank">Tester en</label><select id="rc-trank">${JOB_LEVELS.map((l, i) => `<option value="${i + 1}" ${rcTest.rank === i + 1 ? 'selected' : ''}>${l}</option>`).join('')}</select>
      ${r.care ? `<select id="rc-tlvl" aria-label="Gravité de la blessure">${G.HEALTH_LEVELS.slice(0, r.care.level).map((l, i) => `<option value="${i + 1}" ${rcTest.lvl === i + 1 ? 'selected' : ''}>Blessure ${l.toLowerCase()}</option>`).join('')}</select>` : ''}
      <button type="button" class="btn sm" id="rc-test">▶ Tester</button></div>
    <b style="font-size:14px">Mini-jeux à enchaîner : tous ceux cochés, l’un après l’autre, dans cet ordre${r.care ? ' (pour une opération, l’anesthésie vient d’abord)' : ''}</b>
    <div class="perms">${Object.entries(SIMPLE_GAMES).map(([k, [l]]) => box(k, l)).join('')}</div>
    ${r.care ? `<b style="font-size:14px">Gestes médicaux</b><div class="perms">${OP_KEYS.map((k) => box(k, OP_STEPS[k])).join('')}</div>` : ''}
    <p class="note" style="margin:0">${r.work || r.care ? 'Rien de coché : les mini-jeux habituels.' : 'Rien de coché : pas de mini-jeu (fabrication directe). Avec un mini-jeu, rien n’est perdu en cas d’échec, mais la recette se repose la moitié de sa durée.'} Difficulté « Automatique » : selon le travail, la gravité et le rang.</p>
  </div>`;
}
function readGameFields(r) {
  if (!$('rc-gdiff')) return;
  r.kitchen = !!$('rc-kitchen')?.checked;
  if ($('rc-trank')) rcTest.rank = +$('rc-trank').value || 1;
  if ($('rc-tlvl')) rcTest.lvl = +$('rc-tlvl').value || 1;
  const list = [...document.querySelectorAll('#rc-body [data-game]')].filter((c) => c.checked).map((c) => c.dataset.game);
  const diff = +$('rc-gdiff').value || 0;
  const time = Math.max(0, Math.min(600, Math.round(+$('rc-gtime')?.value || 0)));
  r.game = list.length || diff || time ? { list, diff, time } : null;
}

/** Onglet « Savoir-faire » : sous-onglets Métier et Cuisine (testeurs seulement pour l'instant). */
let jobView = 'metier';
const jobSwitchHTML = () => `<div class="job-switch" role="tablist">${[['metier', '🛠️ Métier'], ['cuisine', '🍳 Cuisine']].map(([k, l]) => `<button type="button" role="tab" class="${jobView === k ? 'on' : ''}" aria-selected="${jobView === k}" data-jobview="${k}">${l}</button>`).join('')}</div>`;
function renameJobTab() {
  const tab = $('t-job');
  if (!tab) return;
  const want = nouveautes() && !VIEW ? 'Savoir-faire' : 'Métier';
  const walker = document.createTreeWalker(tab, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) if (/Métier|Savoir-faire/.test(n.nodeValue)) n.nodeValue = n.nodeValue.replace(/Métier|Savoir-faire/, want);
}
$('v-job').addEventListener('click', (e) => {
  const v = e.target.closest('[data-jobview]')?.dataset.jobview;
  if (!v || v === jobView) return;
  jobView = v;
  renderJob();
});
/** Nouveautés en test (cuisine, commerce) : visibles seulement par les testeurs. */
function beta() {
  return G.isBeta(ME?.uid);
}
/** Nouveautés visibles : ouvertes à tous (G.NEW_OPEN), sinon seulement pour les testeurs. */
function nouveautes() {
  return G.NEW_OPEN || beta();
}
/* ═══ Cuisine : mini-jeux ════════════════════════════════════════════════ */
/** Couper : cliquer le plus vite possible. */
const chopStep = () => (api) => {
  const goal = 20, dur = 6;
  let n = 0, t = 0, over = false;
  api.area.innerHTML = `<p class="op-step">🔪 <b>Couper</b> : clique le plus vite possible ! ${goal} coupes en ${dur} secondes.</p>
    <div class="chop"><button type="button" class="btn chop-btn" id="mg-hit">🔪 Couper !</button></div>
    <div class="gauge"><i id="ck-p" style="width:0%"></i></div><div class="gauge-cap"><span id="ck-n">0 / ${goal}</span><span id="ck-t">${dur} s</span></div>`;
  $('mg-hit').onclick = () => {
    if (over) return;
    n++;
    $('ck-p').style.width = `${Math.min(100, (n / goal) * 100)}%`;
    $('ck-n').textContent = `${n} / ${goal}`;
    if (n >= goal) {
      over = true;
      api.msg('Bien coupé !');
      setTimeout(() => api.next(), 500);
    }
  };
  api.onTick((dt) => {
    if (over) return;
    t += dt;
    $('ck-t').textContent = `${Math.max(0, Math.ceil(dur - t))} s`;
    if (t >= dur) {
      over = true;
      api.fail('Trop lent : les ingrédients sont mal coupés.');
    }
  });
};
/** Cuire au four : garder la température dans la zone verte ; trop chaud, ça brûle. */
const ovenStep = () => (api) => {
  const lo = mgRnd(170, 210), hi = lo + 35, dur = 25, ph = mgRnd(0, 6.28);
  let temp = 120, prog = 0, burn = 0, t = 0, hold = 0, over = false;
  const pct = (v) => Math.max(0, Math.min(100, (v - 50) / 2.5));
  api.area.innerHTML = `<p class="op-step">🔥 <b>Cuire au four</b> : garde la température dans la zone verte (${Math.round(lo)} à ${Math.round(hi)} °C) avec ＋ et − (ou les flèches ↑ ↓). La cuisson n’avance que dans le vert ; trop chaud, ça brûle.</p>
    <div class="oven"><div class="oven-th"><i id="ov-z" style="bottom:${pct(lo)}%;height:${pct(hi) - pct(lo)}%"></i><b id="ov-t"></b></div>
      <div class="oven-side"><button type="button" class="btn sm" id="ov-up">＋ Chauffer</button><button type="button" class="btn sm ghost" id="ov-dn">− Baisser</button></div></div>
    <div class="gauge"><i id="ov-p" style="width:0%"></i></div><div class="gauge-cap"><span>Cuisson</span><span id="ov-pn">0 %</span></div>
    <div class="gauge"><i id="ov-b" style="width:0%;background:var(--red)"></i></div><div class="gauge-cap"><span>Brûlé</span><span id="ov-bn">0 %</span></div>`;
  for (const [id, v] of [['ov-up', 1], ['ov-dn', -1]]) {
    const b = $(id);
    b.onpointerdown = () => (hold = v);
    b.onpointerup = b.onpointerleave = b.onpointercancel = () => (hold = 0);
  }
  const key = (e) => {
    if (e.key === 'ArrowUp') hold = e.type === 'keydown' ? 1 : 0;
    if (e.key === 'ArrowDown') hold = e.type === 'keydown' ? -1 : 0;
  };
  document.addEventListener('keydown', key);
  document.addEventListener('keyup', key);
  const end = (fn) => {
    over = true;
    document.removeEventListener('keydown', key);
    document.removeEventListener('keyup', key);
    fn();
  };
  api.onTick((dt) => {
    if (over) return;
    t += dt;
    temp = Math.max(50, Math.min(300, temp + (hold * 70 + 22 * Math.sin(t * 0.8 + ph) - 10) * dt));
    if (temp >= lo && temp <= hi) prog += (100 / 10) * dt; // 10 s dans le vert pour cuire
    if (temp > hi) burn += (temp - hi) * 0.9 * dt;
    $('ov-t').style.bottom = `${pct(temp)}%`;
    $('ov-t').textContent = `${Math.round(temp)} °C`;
    $('ov-p').style.width = `${Math.min(100, prog)}%`;
    $('ov-pn').textContent = `${Math.min(100, Math.round(prog))} %`;
    $('ov-b').style.width = `${Math.min(100, burn)}%`;
    $('ov-bn').textContent = `${Math.min(100, Math.round(burn))} %`;
    if (burn >= 100) return end(() => api.fail('Brûlé !'));
    if (prog >= 100) return end(() => { api.msg('Cuisson parfaite !'); setTimeout(() => api.next(), 600); });
    if (t >= dur) end(() => api.fail('Pas assez cuit.'));
  });
};
/** Mélanger : faire des tours dans le bol, sans aller trop vite. */
const stirStep = () => (api) => {
  const turns = 5, dur = 15;
  let total = 0, last = null, lastT = 0, t = 0, over = false;
  api.area.innerHTML = `<p class="op-step">🥄 <b>Mélanger</b> : fais des cercles dans le bol (glisse avec la souris ou le doigt), ${turns} tours, sans aller trop vite.</p>
    <div class="bowl" id="ck-bowl"><span aria-hidden="true">🥣</span></div>
    <div class="gauge"><i id="st-p" style="width:0%"></i></div><div class="gauge-cap"><span id="st-n">0 / ${turns} tours</span><span id="st-t">${dur} s</span></div>`;
  const bowl = $('ck-bowl');
  const ang = (e) => {
    const r = bowl.getBoundingClientRect();
    return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2));
  };
  bowl.onpointerdown = (e) => {
    last = ang(e);
    lastT = performance.now();
    bowl.setPointerCapture(e.pointerId);
  };
  bowl.onpointermove = (e) => {
    if (last == null || over) return;
    const a = ang(e), now = performance.now();
    let d = a - last;
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    const speed = Math.abs(d) / (2 * Math.PI) / Math.max(0.001, (now - lastT) / 1000); // tours par seconde
    last = a;
    lastT = now;
    if (speed > 2.2) return void api.msg('Doucement, ça éclabousse !');
    total += Math.abs(d);
    const done = total / (2 * Math.PI);
    $('st-p').style.width = `${Math.min(100, (done / turns) * 100)}%`;
    $('st-n').textContent = `${Math.min(turns, Math.floor(done))} / ${turns} tours`;
    if (done >= turns) {
      over = true;
      api.msg('Bien mélangé !');
      setTimeout(() => api.next(), 500);
    }
  };
  bowl.onpointerup = bowl.onpointercancel = () => (last = null);
  api.onTick((dt) => {
    if (over) return;
    t += dt;
    $('st-t').textContent = `${Math.max(0, Math.ceil(dur - t))} s`;
    if (t >= dur) {
      over = true;
      api.fail('Pas assez mélangé.');
    }
  });
};
/** Frire : retirer chaque aliment quand il est doré (zone jaune), ni avant, ni après. */
const fryStep = () => (api) => {
  const foods = Array.from({ length: 4 }, () => ({ p: -mgRnd(0, 45), v: mgRnd(14, 24), out: false }));
  let miss = 0, done = 0, over = false;
  api.area.innerHTML = `<p class="op-step">🍳 <b>Frire</b> : retire chaque aliment quand sa barre est dans la zone dorée, ni avant, ni après ! Une erreur permise.</p>
    <div class="fry">${foods.map((f, i) => `<button type="button" class="fry-it" data-fry="${i}"><span aria-hidden="true">🍤</span><span class="fry-bar"><i class="fry-zone"></i><i class="fry-p" id="fry-${i}"></i></span></button>`).join('')}</div>`;
  const take = (i, good, text) => {
    const f = foods[i];
    if (f.out || over) return;
    f.out = true;
    done++;
    document.querySelector(`[data-fry="${i}"]`)?.classList.add(good ? 'ok' : 'ko');
    if (!good) {
      miss++;
      api.msg(text);
    }
    if (miss > 1) {
      over = true;
      return api.fail('Trop de fritures ratées.');
    }
    if (done >= foods.length) {
      over = true;
      api.msg('Friture réussie !');
      setTimeout(() => api.next(), 500);
    }
  };
  api.area.querySelector('.fry').onclick = (e) => {
    const b = e.target.closest('[data-fry]');
    if (!b) return;
    const i = +b.dataset.fry, p = foods[i].p;
    take(i, p >= 70 && p <= 90, p < 70 ? 'Pas encore cuit !' : 'Trop cuit !');
  };
  api.onTick((dt) => {
    if (over) return;
    foods.forEach((f, i) => {
      if (f.out) return;
      f.p += f.v * dt;
      const el = $(`fry-${i}`);
      if (el) el.style.width = `${Math.max(0, Math.min(100, f.p))}%`;
      if (f.p > 100) take(i, false, 'Brûlé !');
    });
  });
};
/** Contour d'un légume à éplucher (différent à chaque fois). */
function peelPath() {
  const cx = 230, cy = 130, rx = mgRnd(120, 170), ry = mgRnd(70, 100), a0 = mgRnd(0, 6.28), amp = mgRnd(0.05, 0.12), bumps = Math.floor(mgRnd(3, 6)), ph = mgRnd(0, 6.28);
  const pts = [];
  for (let i = 0; i <= 160; i++) {
    const a = a0 + (i / 160) * Math.PI * 1.85, k = 1 + amp * Math.sin(a * bumps + ph);
    pts.push({ x: cx + Math.cos(a) * rx * k, y: cy + Math.sin(a) * ry * k });
  }
  return pts;
}
const COOK_GAMES = {
  couper: () => chopStep(),
  four: () => ovenStep(),
  melanger: () => stirStep(),
  assaisonner: () => timingStep({ label: '🧂 <b>Assaisonner</b> : verse quand le curseur est dans la zone.', verb: '🧂 Verser', icon: '🧂', speed: 1.1, zone: 14, hits: 2, misses: 1, good: 'Juste ce qu’il faut !' }),
  eplucher: () => traceStep({ label: '🥔 <b>Éplucher</b> : suis le contour du légume, du point vert au point rouge, sans lâcher.', path: peelPath(), tolerance: 11, tries: 2, bad: 'Trop épais : recommence.', good: 'Bien épluché !' }),
  frire: () => fryStep(),
  dresser: () => simonStep({ label: '🍽️ <b>Dresser</b> : retiens l’ordre des éléments, puis pose-les dans le même ordre.', len: 4, misses: 1, icons: ['🥩', '🥕', '🍚', '🌿'] }),
};
/** Toutes les étapes d'une recette de cuisine, dans l'ordre. */
const cookGame = (r) => miniGame({ title: `Cuisine : ${r.name}`, steps: r.steps.filter((k) => COOK_GAMES[k]).map((k) => COOK_GAMES[k]()), doneText: 'Le plat est prêt !' });

/* ═══ Cuisine : recettes du cuisinier (onglet Métier) ═══════════════════ */
function cookHTML() {
  if (!nouveautes()) return '';
  const list = S.cook || [];
  const status = (r) => (r.ok ? '<span class="status ok">Validée</span>' : r.refused ? '<span class="status refused">Refusée</span>' : '<span class="status wait">À valider</span>');
  return `${kitchenHTML()}<div class="sec-head" style="margin-top:22px"><h2 style="font-size:20px">🍳 Mes recettes</h2>${VIEW ? '' : '<button class="btn sm" id="ck-new">+ Nouvelle recette</button>'}</div>
    <p class="note">Tout le monde peut cuisiner ! Crée tes recettes : ingrédients, étapes dans l’ordre et plat final. Une fois validée par le staff, tu peux la cuisiner.</p>
    ${list.length ? `<div class="recipes">${list.map((r) => `<article class="recipe">
      ${r.photo ? `<img class="ck-thumb" src="${imgSrc(r.photo)}" alt="">` : ''}
      <h3 class="rc-title">${esc(r.name)} ${status(r)}</h3>
      ${!r.ok && r.refused ? `<p class="refused-why"><b>Motif du refus :</b> ${esc(r.refused.reason)}</p>` : ''}
      <b>Il faut</b><div class="needs">${Object.entries(r.needs).map((x) => needChip(x)).join('')}</div>
      <p class="note" style="margin:4px 0">${r.steps.map((k) => G.COOK_STEPS[k]).join(' → ')}</p>
      ${VIEW ? '' : `<div class="t-actions">${r.ok ? (G.cooldownLeft(S, `c:${r.id}`) ? `<button class="btn sm" disabled>⏳ Repos : ${G.duree(G.cooldownLeft(S, `c:${r.id}`) / 1000)}</button>` : `<button class="btn sm" data-ck-make="${r.id}" ${Object.entries(r.needs).every(([k, q]) => G.count(S, k) >= q) ? '' : 'disabled'}>🍳 Cuisiner</button>`) : ''}<button class="btn sm ghost" data-ck-edit="${r.id}">${!r.ok && r.refused ? 'Corriger et reproposer' : 'Modifier'}</button><button class="btn sm ghost" data-ck-delr="${r.id}">Supprimer</button></div>`}
    </article>`).join('')}</div>` : '<p class="note">Aucune recette pour l’instant.</p>'}`;
}
let cookDraft = null;
const COOK_STEP_KEYS = Object.keys(G.COOK_STEPS);
function openCook(x = null) {
  cookDraft = { id: x?.id ?? null, name: x?.name ?? '', desc: x?.desc ?? '', photo: x?.photo ?? null, needs: { ...(x?.needs || {}) }, steps: [...(x?.steps || [])], add: COOK_STEP_KEYS[0] };
  $('ck-title').textContent = x ? 'Modifier la recette' : 'Nouvelle recette';
  $('ck-err').textContent = x && !x.ok && x.refused ? `Motif du refus : ${x.refused.reason}` : '';
  renderCookEdit();
  openDialog('d-cook');
}
function renderCookEdit() {
  const d = cookDraft;
  const ingr = Object.entries(G.ITEMS).filter(([, it]) => it.kind === 'ingredient').sort((a, b) => a[1].name.localeCompare(b[1].name));
  $('ck-body').innerHTML = `
    <div class="form">
      <div class="wide"><label for="ck-name">Nom du plat</label><input id="ck-name" maxlength="60" value="${esc(d.name)}"></div>
      <div class="wide"><label for="ck-desc">Description du plat</label><textarea id="ck-desc" rows="4" maxlength="1000" class="ck-ta">${esc(d.desc)}</textarea></div>
      <div class="wide"><label>Photo du plat</label><div class="se-row">${d.photo ? `<img class="ck-photo" src="${imgSrc(d.photo)}" alt="">` : '<span class="note">Aucune photo.</span>'}<button type="button" class="btn sm" id="ck-pick">${d.photo ? 'Changer' : 'Choisir une image'}</button><input type="file" id="ck-file" accept="image/*" hidden></div></div>
    </div>
    <h3 class="ed-h">Ingrédients</h3>
    ${ingr.length ? `<div class="se-items">${Object.entries(d.needs).map(([k, q]) => `<div class="rc-row"><span>${itemIco(k)}</span><select data-ck-ing="${esc(k)}" aria-label="Ingrédient">${ingr.map(([id, it]) => `<option value="${esc(id)}" ${id === k ? 'selected' : ''}>${esc(it.name)}</option>`).join('')}</select><input type="number" min="1" max="99" data-ck-q="${esc(k)}" value="${q}" aria-label="Quantité"><button type="button" class="close sm-close" data-ck-del="${esc(k)}" aria-label="Retirer">×</button></div>`).join('') || '<p class="note">Aucun ingrédient.</p>'}</div>
      <button type="button" class="btn sm ghost" id="ck-add-ing">+ Ajouter un ingrédient</button>` : '<p class="note">Le staff n’a encore créé aucun objet de la catégorie « Ingrédient ».</p>'}
    <h3 class="ed-h">Étapes (dans l’ordre)</h3>
    ${d.steps.length ? `<ol class="ck-steps">${d.steps.map((k, i) => `<li><span>${G.COOK_STEPS[k]}</span><button type="button" class="btn sm ghost" data-ck-up="${i}" ${i ? '' : 'disabled'} aria-label="Monter">↑</button><button type="button" class="btn sm ghost" data-ck-down="${i}" ${i < d.steps.length - 1 ? '' : 'disabled'} aria-label="Descendre">↓</button><button type="button" class="close sm-close" data-ck-rm="${i}" aria-label="Retirer">×</button></li>`).join('')}</ol>` : '<p class="note">Aucune étape.</p>'}
    <div class="mj-row"><select id="ck-step" aria-label="Étape à ajouter">${COOK_STEP_KEYS.map((k) => `<option value="${k}" ${k === d.add ? 'selected' : ''}>${G.COOK_STEPS[k]}</option>`).join('')}</select><button type="button" class="btn sm" id="ck-add-step">+ Ajouter l’étape</button><button type="button" class="btn sm ghost" id="ck-test" ${d.steps.length ? '' : 'disabled'}>▶ Tester les étapes</button></div>`;
}
function readCook() {
  const d = cookDraft;
  if (!$('ck-name')) return;
  d.name = $('ck-name').value;
  d.desc = $('ck-desc').value;
  d.add = $('ck-step')?.value || d.add;
  const needs = {};
  document.querySelectorAll('#ck-body [data-ck-ing]').forEach((s) => {
    const q = +document.querySelector(`#ck-body [data-ck-q="${CSS.escape(s.dataset.ckIng)}"]`)?.value || 1;
    needs[s.value] = Math.min(99, (needs[s.value] || 0) + Math.max(1, q));
  });
  d.needs = needs;
}
$('d-cook').addEventListener('change', (e) => {
  if (!e.target.dataset?.ckIng) return;
  readCook();
  renderCookEdit();
});
$('d-cook').addEventListener('click', async (e) => {
  const d = cookDraft;
  if (!d) return;
  const t = e.target;
  const idx = (a) => t.closest(`[${a}]`)?.getAttribute(a);
  if (t.closest('#ck-pick')) return $('ck-file').click();
  if (t.closest('#ck-add-ing')) {
    readCook();
    const free = Object.keys(G.ITEMS).find((k) => G.ITEMS[k].kind === 'ingredient' && !d.needs[k]);
    if (free) d.needs[free] = 1;
    return renderCookEdit();
  }
  if (idx('data-ck-del') != null) {
    readCook();
    delete d.needs[idx('data-ck-del')];
    return renderCookEdit();
  }
  if (t.closest('#ck-add-step')) {
    readCook();
    if (d.steps.length < 15) d.steps.push($('ck-step').value);
    return renderCookEdit();
  }
  for (const [a, move] of [['data-ck-up', -1], ['data-ck-down', 1]]) {
    const i = idx(a);
    if (i == null) continue;
    readCook();
    const j = +i + move;
    [d.steps[+i], d.steps[j]] = [d.steps[j], d.steps[+i]];
    return renderCookEdit();
  }
  if (idx('data-ck-rm') != null) {
    readCook();
    d.steps.splice(+idx('data-ck-rm'), 1);
    return renderCookEdit();
  }
  if (t.closest('#ck-test')) {
    // Essai des étapes de la recette, dans l'ordre (rien n'est consommé)
    readCook();
    if (!d.steps.length) return;
    const ok = await cookGame({ name: d.name.trim() || 'test', steps: d.steps });
    return void toast(ok ? '✅ Toutes les étapes réussies' : '❌ Raté');
  }
  if (t.closest('#ck-save')) {
    readCook();
    if (!d.name.trim()) return void ($('ck-err').textContent = 'Donne un nom au plat.');
    if (d.desc.trim().length < 10) return void ($('ck-err').textContent = 'Décris le plat (10 caractères minimum).');
    if (!Object.keys(d.needs).length) return void ($('ck-err').textContent = 'Choisis au moins un ingrédient.');
    if (!d.steps.length) return void ($('ck-err').textContent = 'Ajoute au moins une étape.');
    $('ck-save').disabled = true;
    $('ck-err').textContent = d.photo?.startsWith('data:') ? 'Envoi de la photo…' : '';
    const out = await run({ type: 'cook.save', id: d.id ?? undefined, name: d.name.trim(), desc: d.desc.trim(), photo: d.photo, needs: d.needs, steps: d.steps });
    $('ck-save').disabled = false;
    if (out) closeDialog($('d-cook'));
    else $('ck-err').textContent = '';
  }
});
$('ck-body').addEventListener('change', async (e) => {
  if (e.target.id !== 'ck-file') return;
  const f = e.target.files?.[0];
  if (!f || !f.type.startsWith('image/')) return;
  readCook();
  cookDraft.photo = await readImage(f, { max: 1200, maxBytes: 700 * 1024 });
  renderCookEdit();
});
$('v-job').addEventListener('click', async (e) => {
  if (e.target.closest('#ck-new')) return openCook();
  const ed = e.target.closest('[data-ck-edit]')?.dataset.ckEdit;
  if (ed) return openCook(S.cook.find((x) => x.id === Number(ed)));
  const del = e.target.closest('[data-ck-delr]')?.dataset.ckDelr;
  if (del) {
    if (await askConfirm('La recette sera supprimée. Les plats déjà cuisinés restent.', { title: 'Supprimer cette recette ?', ok: 'Supprimer', danger: true })) run({ type: 'cook.delete', id: Number(del) });
    return;
  }
  const mk = e.target.closest('[data-ck-make]')?.dataset.ckMake;
  if (mk) {
    const r = S.cook.find((x) => x.id === Number(mk));
    if (!r) return;
    if (!(await askConfirm('Si tu rates une étape, tu gardes tes ingrédients, mais tu devras attendre 5 minutes avant de réessayer.', { title: `Cuisiner : ${r.name} ?`, ok: 'En cuisine !' }))) return;
    const success = await cookGame(r);
    run({ type: 'cook.make', id: r.id, success });
  }
});

/* ═══ Carnet de suivi (bouton flottant ; en test, réservé aux testeurs) ═══ */
/** Markdown simple et sûr (le texte est échappé avant la mise en forme). */
function md(src) {
  let s = esc(String(src || ''));
  s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/__([^_\n]+)__/g, '<u>$1</u>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>').replace(/~~([^~\n]+)~~/g, '<s>$1</s>');
  s = s.replace(/\|\|([^|\n]+)\|\|/g, '<span class="spoil" tabindex="0">$1</span>');
  s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<]+)/g, (m, pre, url) => `${pre}<a href="${url}" target="_blank" rel="noopener" class="${/discord\.com\/channels\//.test(url) ? 'jr-link' : ''}">${/discord\.com\/channels\//.test(url) ? '🔗 Action RP' : url}</a>`);
  s = s.split('\n').map((l) => {
    if (/^### /.test(l)) return `<h5>${l.slice(4)}</h5>`;
    if (/^## /.test(l)) return `<h4>${l.slice(3)}</h4>`;
    if (/^# /.test(l)) return `<h3>${l.slice(2)}</h3>`;
    if (/^&gt; /.test(l)) return `<blockquote>${l.slice(5)}</blockquote>`;
    if (/^[-*] /.test(l)) return `<li>${l.slice(2)}</li>`;
    return l ? `${l}<br>` : '<br>';
  }).join('');
  return s.replace(/(<li>[\s\S]*?<\/li>)+/g, (m) => `<ul>${m}</ul>`);
}
const jrDate = (t) => (t ? new Date(t).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '');
let jrEdit = null, jrSecrets = null;
const journalFab = document.createElement('button');
journalFab.type = 'button';
journalFab.id = 'journal-fab';
journalFab.hidden = true;
journalFab.textContent = '📓 Carnet';
document.body.append(journalFab);
setInterval(() => {
  journalFab.hidden = !S;
}, 1500);
function jrEntryHTML(e) {
  return `<article class="jr-entry">
    <header><span><b>${esc(e.title || 'Sans titre')}</b> <small class="note">${jrDate(e.at)}${e.edited ? ' · modifiée' : ''}</small></span>
      ${!VIEW ? `<span class="jr-acts"><button class="btn sm ghost" data-jr-edit="${e.id}">Modifier</button><button class="btn sm ghost" data-jr-del="${e.id}">Supprimer</button></span>` : ''}</header>
    ${e.text ? `<div class="jr-text">${md(e.text)}</div>` : ''}
    ${e.images.length ? `<div class="inv-gallery">${e.images.map((u) => `<img src="${imgSrc(u)}" alt="">`).join('')}</div>` : ''}
    ${e.notes.length ? `<div class="jr-notes">${e.notes.map((n) => `<div class="jr-note">${n.emoji ? `<span class="jr-emo">${esc(n.emoji)}</span>` : ''}<span><b>${esc(n.byName || 'Staff')}</b>${n.text ? ` ${esc(n.text)}` : ''}</span>${VIEW ? `<button class="close sm-close" data-jr-ndel="${e.id}:${n.id}" aria-label="Retirer l’annotation">×</button>` : ''}</div>`).join('')}</div>` : ''}
    ${VIEW ? `<div class="jr-annot">${['👍', '🔥', '⭐', '😂', '❤️', '👀'].map((em) => `<button type="button" class="jr-q" data-jr-emo="${e.id}" data-emo="${em}" aria-label="Réagir ${em}">${em}</button>`).join('')}
      <input class="jr-emoin" data-jr-emoin="${e.id}" maxlength="16" placeholder="😀" aria-label="Émoji de ton choix" title="N’importe quel émoji (Mac : Ctrl + Cmd + Espace ; Windows : Windows + point)">
      <input data-jr-txt="${e.id}" maxlength="500" placeholder="Annoter (visible par le joueur)…"><button class="btn sm" data-jr-send="${e.id}">Annoter</button></div>` : ''}
  </article>`;
}
function jrEditorHTML() {
  const d = jrEdit;
  return `<div class="crew-box jr-editor">
    <input id="jr-t" maxlength="80" placeholder="Titre (facultatif)" value="${esc(d.title)}">
    ${d.preview ? `<div class="jr-text jr-preview">${md(d.text) || '<span class="note">Rien à afficher.</span>'}</div>` : `<textarea id="jr-x" rows="8" maxlength="4000" placeholder="Écris ce que tu veux…">${esc(d.text)}</textarea>`}
    <p class="note" style="margin:0">Le markdown est activé.</p>
    ${d.images.length ? `<div class="inv-gallery edit">${d.images.map((u, i) => `<span class="inv-img"><img src="${imgSrc(u)}" alt=""><button type="button" class="close sm-close" data-jr-rmimg="${i}" aria-label="Retirer l’image">×</button></span>`).join('')}</div>` : ''}
    <div class="se-row"><button type="button" class="btn sm ghost" id="jr-pick" ${d.images.length >= 4 ? 'disabled' : ''}>🖼️ Ajouter une image</button><input type="file" id="jr-file" accept="image/*" multiple hidden><button type="button" class="btn sm ghost" id="jr-prev">${d.preview ? '✏️ Écrire' : '👁️ Aperçu'}</button></div>
    <div class="form-actions"><button type="button" class="btn ghost" id="jr-cancel">Annuler</button><button type="button" class="btn" id="jr-save">${d.id ? 'Enregistrer' : 'Ajouter au carnet'}</button></div>
  </div>`;
}
function jrSecretsHTML() {
  return `<details class="crew-box jr-secret" open><summary>🔒 Notes secrètes du staff <small class="note">(le joueur ne les voit jamais)</small></summary>
    ${jrSecrets == null ? '<p class="note">Chargement…</p>' : jrSecrets.length ? jrSecrets.map((n) => `<div class="jr-note"><span><b>${esc(n.byName || 'Staff')}</b> <small class="note">${jrDate(n.at)}</small><br>${md(n.text)}</span><button class="close sm-close" data-jr-sdel="${n.id}" aria-label="Supprimer la note">×</button></div>`).join('') : '<p class="note">Aucune note.</p>'}
    <div class="jr-annot"><input id="jr-secret" maxlength="1000" placeholder="Ex. lui donner un FDD"><button class="btn sm" id="jr-secret-add">Ajouter</button></div>
  </details>`;
}
function readJr() {
  if (!jrEdit) return;
  if ($('jr-t')) jrEdit.title = $('jr-t').value;
  if ($('jr-x')) jrEdit.text = $('jr-x').value;
}
function renderJournal() {
  if (!S) return;
  const list = S.journal || [];
  $('jr-title').textContent = VIEW ? `📓 Carnet de ${S.id?.name || 'ce joueur'}` : '📓 Mon carnet';
  $('jr-body').innerHTML = `
    ${VIEW ? jrSecretsHTML() : jrEdit ? jrEditorHTML() : '<div class="form-actions" style="justify-content:flex-start;margin-top:0"><button class="btn" id="jr-new">+ Nouvelle entrée</button></div>'}
    ${list.length ? list.map(jrEntryHTML).join('') : '<p class="note">Le carnet est vide.</p>'}`;
}
journalFab.addEventListener('click', async () => {
  jrEdit = null;
  jrSecrets = null;
  renderJournal();
  openDialog('d-journal');
  if (VIEW) {
    try {
      jrSecrets = (await API.staff('secret.get', { target: S.uid })).notes;
    } catch (err) {
      jrSecrets = [];
      toast(esc(err.message));
    }
    renderJournal();
  }
});
/** Action du staff sur le carnet du joueur consulté (annotations). */
async function jrStaff(action) {
  setBusy(1);
  try {
    const out = await API.staff('act', { target: S.uid, action });
    if (out.player) S.journal = out.player.journal;
    toast(esc(out.toast || 'Enregistré'));
  } catch (err) {
    toast(esc(err.message));
  } finally {
    setBusy(-1);
  }
  renderJournal();
}
$('d-journal').addEventListener('click', async (e) => {
  const t = e.target;
  const attr = (a) => t.closest(`[${a}]`)?.getAttribute(a);
  if (t.closest('#jr-new')) {
    jrEdit = { id: null, title: '', text: '', images: [], preview: false };
    return renderJournal();
  }
  if (attr('data-jr-edit')) {
    const x = S.journal.find((j) => j.id === Number(attr('data-jr-edit')));
    jrEdit = { id: x.id, title: x.title, text: x.text, images: [...x.images], preview: false };
    renderJournal();
    return $('jr-body').scrollTo?.(0, 0);
  }
  if (attr('data-jr-del')) {
    if (await askConfirm('L’entrée et ses annotations seront supprimées.', { title: 'Supprimer cette entrée ?', ok: 'Supprimer', danger: true })) {
      await run({ type: 'journal.delete', id: Number(attr('data-jr-del')) });
      renderJournal();
    }
    return;
  }
  if (t.closest('#jr-cancel')) {
    jrEdit = null;
    return renderJournal();
  }
  if (t.closest('#jr-prev')) {
    readJr();
    jrEdit.preview = !jrEdit.preview;
    return renderJournal();
  }
  if (t.closest('#jr-pick')) return $('jr-file').click();
  if (attr('data-jr-rmimg') != null) {
    readJr();
    jrEdit.images.splice(+attr('data-jr-rmimg'), 1);
    return renderJournal();
  }
  if (t.closest('#jr-save')) {
    readJr();
    const d = jrEdit;
    $('jr-save').disabled = true;
    const out = await run({ type: 'journal.save', id: d.id ?? undefined, title: d.title.trim(), text: d.text.trim(), images: d.images });
    if (out) jrEdit = null;
    return renderJournal();
  }
  // Staff : réactions rapides, émoji au choix, annotations, notes secrètes
  if (attr('data-jr-emo')) return jrStaff({ type: 'journal.note', id: Number(attr('data-jr-emo')), emoji: t.closest('[data-emo]').dataset.emo, text: '' });
  if (attr('data-jr-send')) {
    const id = Number(attr('data-jr-send'));
    const text = document.querySelector(`[data-jr-txt="${id}"]`)?.value.trim() || '';
    const emoji = document.querySelector(`[data-jr-emoin="${id}"]`)?.value.trim() || '';
    if (!text && !emoji) return void toast('Mets un émoji, une annotation, ou les deux.');
    return jrStaff({ type: 'journal.note', id, text, emoji });
  }
  if (attr('data-jr-ndel')) {
    const [id, nid] = attr('data-jr-ndel').split(':').map(Number);
    return jrStaff({ type: 'journal.note.delete', id, nid });
  }
  if (t.closest('#jr-secret-add') || attr('data-jr-sdel')) {
    const add = !!t.closest('#jr-secret-add');
    const text = $('jr-secret')?.value.trim();
    if (add && !text) return void toast('Écris une note.');
    setBusy(1);
    try {
      const out = await API.staff(add ? 'secret.add' : 'secret.delete', add ? { target: S.uid, text } : { target: S.uid, id: Number(attr('data-jr-sdel')) });
      jrSecrets = out.notes;
      toast(esc(out.toast));
    } catch (err) {
      toast(esc(err.message));
    } finally {
      setBusy(-1);
    }
    return renderJournal();
  }
});
$('d-journal').addEventListener('change', async (e) => {
  if (e.target.id !== 'jr-file' || !jrEdit) return;
  readJr();
  for (const f of [...e.target.files].filter((x) => x.type.startsWith('image/'))) {
    if (jrEdit.images.length >= 4) break;
    jrEdit.images.push(await readImage(f, { max: 1200, maxBytes: 700 * 1024 }));
  }
  renderJournal();
});

/* Liens du carnet : dans une Activity, Discord bloque les liens classiques, on passe par son SDK pour les ouvrir */
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="http"]');
  if (!a || !a.closest('.jr-text')) return;
  e.preventDefault();
  const url = a.href;
  const sdk = window.__discordSdk;
  if (sdk?.commands?.openExternalLink) sdk.commands.openExternalLink({ url }).catch(() => window.open(url, '_blank'));
  else window.open(url, '_blank');
});

/* ═══ Commerce entre joueurs (bouton flottant) ═══════════════════════════ */
const tradeFab = document.createElement('button');
tradeFab.type = 'button';
tradeFab.id = 'trade-fab';
tradeFab.hidden = true;
document.body.append(tradeFab);
function updateTradeFab() {
  const n = S?.offers?.length || 0;
  tradeFab.hidden = !S || VIEW || !nouveautes();
  const html = `🤝 Commerce${n ? ` <b>${n}</b>` : ''}`;
  if (tradeFab.innerHTML !== html) tradeFab.innerHTML = html;
}
setInterval(updateTradeFab, 1500);
let tradeHere = null;
function renderTrade() {
  if (!S) return;
  const offers = S.offers || [];
  const sellable = [...new Set(S.inv.filter(Boolean).map((x) => x[0]))].filter((k) => G.ITEMS[k] && !['arme', 'bateau'].includes(G.ITEMS[k].kind));
  const people = (tradeHere || []).filter((p) => p.uid !== S.uid);
  $('tr-body').innerHTML = `
    <h3 class="ed-h">Offres reçues</h3>
    ${offers.length ? offers.map((o) => `<div class="trade-offer"><span>${itemIco(o.key)} <b>${o.qty} × ${esc(itemOf(o.key).name)}</b> de ${esc(o.fromName)} pour <b>${berry(o.price)}</b></span><span><button class="btn sm" data-tr-ok="${esc(o.id)}">Acheter</button> <button class="btn sm ghost" data-tr-no="${esc(o.id)}">Refuser</button></span></div>`).join('') : '<p class="note">Aucune offre.</p>'}
    <h3 class="ed-h">Vendre un objet</h3>
    ${sellable.length ? `<div class="form">
      <div><label for="tr-item">Objet</label><select id="tr-item">${sellable.map((k) => `<option value="${esc(k)}">${esc(itemOf(k).name)} (${G.count(S, k)})</option>`).join('')}</select></div>
      <div><label for="tr-qty">Quantité</label><input id="tr-qty" type="number" min="1" value="1"></div>
      <div><label for="tr-price">Prix (฿)</label><input id="tr-price" type="number" min="0" value="0"></div>
      <div><label for="tr-to">Acheteur</label><select id="tr-to">${tradeHere == null ? '<option value="">Recherche…</option>' : people.length ? people.map((p) => `<option value="${esc(p.uid)}">${esc(p.name)}</option>`).join('') : '<option value="">Personne ici</option>'}</select></div>
    </div>
    <p class="note">L’acheteur doit être au même endroit que toi. Il accepte ou refuse l’offre dans l’app.</p>
    <div class="form-actions"><button class="btn" id="tr-sell">Proposer la vente</button></div>` : '<p class="note">Rien à vendre (les armes et les bateaux ne se vendent pas ici).</p>'}`;
}
tradeFab.addEventListener('click', async () => {
  tradeHere = null;
  renderTrade();
  openDialog('d-trade');
  const out = await run({ type: 'players.here' });
  tradeHere = out?.players || [];
  renderTrade();
});
$('d-trade').addEventListener('click', async (e) => {
  const ok = e.target.closest('[data-tr-ok]')?.dataset.trOk, no = e.target.closest('[data-tr-no]')?.dataset.trNo;
  if (ok || no) {
    await run({ type: 'trade.answer', id: ok || no, accept: !!ok });
    return renderTrade();
  }
  if (e.target.closest('#tr-sell')) {
    const to = $('tr-to').value;
    if (!to) return void toast('Personne à qui vendre ici.');
    const out = await run({ type: 'trade.offer', key: $('tr-item').value, qty: +$('tr-qty').value || 1, price: +$('tr-price').value || 0, to });
    if (out) closeDialog($('d-trade'));
  }
});

/* ═══ Nouveaux mini-jeux : médecine et archéologie ═══════════════════════ */
/** Extraction : guider une pince dans un couloir, sans toucher les parois. */
const extractionStep = (o) => (api) => {
  const W = 460, H = 260, pts = o.path, half = o.width / 2;
  let drawing = false, prog = 0;
  api.area.innerHTML = `<p class="op-step">${o.label}</p><canvas id="mg-cv" class="op-cv trace-cv" width="${W}" height="${H}"></canvas>`;
  const cv = $('mg-cv'), g = cv.getContext('2d');
  const path = (n = pts.length) => {
    g.beginPath();
    pts.slice(0, n).forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
  };
  const draw = () => {
    g.clearRect(0, 0, W, H);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.strokeStyle = '#7a2a22';
    g.lineWidth = o.width + 6;
    path();
    g.stroke();
    g.strokeStyle = '#f6e3d3';
    g.lineWidth = o.width;
    path();
    g.stroke();
    if (prog) {
      g.strokeStyle = 'rgba(47,111,208,.6)';
      g.lineWidth = 4;
      path(prog + 1);
      g.stroke();
    }
    const s = pts[0], f = pts[pts.length - 1];
    g.fillStyle = '#2f9a55';
    g.beginPath();
    g.arc(s.x, s.y, 8, 0, 7);
    g.fill();
    g.font = '22px serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(o.target || '🔩', f.x, f.y);
  };
  const pt = (e) => {
    const r = cv.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };
  const hit = (text) => {
    drawing = false;
    prog = 0;
    replay(cv, 'shake');
    if (o.penalty) api.hurt(o.penalty, text);
    else api.msg(text);
    draw();
  };
  cv.onpointerdown = (e) => {
    const p = pt(e);
    if (Math.hypot(p.x - pts[0].x, p.y - pts[0].y) > 18) return void api.msg('Commence sur le point vert.');
    drawing = true;
    prog = 0;
    cv.setPointerCapture(e.pointerId);
    api.msg('Doucement…');
  };
  cv.onpointermove = (e) => {
    if (!drawing) return;
    const p = pt(e);
    let best = prog, bd = Infinity;
    for (let j = Math.max(0, prog - 5); j < Math.min(pts.length, prog + 30); j++) {
      const dd = Math.hypot(p.x - pts[j].x, p.y - pts[j].y);
      if (dd < bd) {
        bd = dd;
        best = j;
      }
    }
    if (bd > half) return hit(o.bad || 'Tu as touché la paroi !');
    prog = Math.max(prog, best);
    draw();
    if (prog >= pts.length - 2) {
      drawing = false;
      api.msg(o.good || 'Extraction réussie !');
      api.next();
    }
  };
  cv.onpointerup = () => {
    if (drawing) hit('Tu as lâché la pince : recommence.');
  };
  draw();
};
/** Réduction / Recoller : faire pivoter les fragments jusqu'à ce que toutes les flèches pointent vers le haut. */
const rotateStep = (o) => (api) => {
  const ang = Array.from({ length: o.n }, () => 90 * (1 + Math.floor(Math.random() * 3)));
  let t = 0, over = false;
  api.area.innerHTML = `<p class="op-step">${o.label}</p><div class="rot-grid">${ang.map((a, i) => `<button type="button" class="rot-piece" data-rot="${i}" aria-label="Fragment ${i + 1}"><span style="transform:rotate(${a}deg)"><b class="rot-arrow">▲</b>${o.icon}</span></button>`).join('')}</div>${o.dur ? '<div class="gauge"><i id="rot-t" style="width:100%"></i></div>' : ''}`;
  api.area.querySelector('.rot-grid').onclick = (e) => {
    const b = e.target.closest('[data-rot]');
    if (!b || over) return;
    const i = +b.dataset.rot;
    ang[i] = (ang[i] + 90) % 360;
    b.firstElementChild.style.transform = `rotate(${ang[i]}deg)`;
    b.classList.toggle('ok', ang[i] === 0);
    if (ang.every((a) => a === 0)) {
      over = true;
      api.msg(o.good || 'Tout est aligné !');
      setTimeout(() => api.next(), 500);
    }
  };
  if (o.dur) {
    api.onTick((dt) => {
      if (over) return;
      t += dt;
      $('rot-t').style.width = `${Math.max(0, 100 - (t / o.dur) * 100)}%`;
      if (t >= o.dur) {
        over = true;
        api.fail(o.slow || 'Trop lent.');
      }
    });
  }
};
/** Massage cardiaque : appuyer en rythme avec les battements. */
const rhythmStep = (o) => (api) => {
  const beat = o.beat || 0.75, win = o.win || 0.14, goal = o.goal || 12, dur = goal * beat + 8;
  let t = 0, good = 0, last = -1, over = false;
  api.area.innerHTML = `<p class="op-step">${o.label}</p><div class="beat"><span id="beat-h">${o.icon || '❤️'}</span></div>
    <div class="form-actions" style="justify-content:center"><button type="button" class="btn" id="mg-hit">${o.verb || '👐 Appuyer'}</button></div>
    <div class="gauge"><i id="beat-p" style="width:0%"></i></div><div class="gauge-cap"><span id="beat-n">0 / ${goal}</span><span></span></div>`;
  $('mg-hit').onclick = () => {
    if (over) return;
    const k = Math.round(t / beat), d = Math.abs(t - k * beat);
    if (d <= win && k !== last && k > 0) {
      last = k;
      good++;
      $('beat-p').style.width = `${(good / goal) * 100}%`;
      $('beat-n').textContent = `${good} / ${goal}`;
      if (good >= goal) {
        over = true;
        api.msg(o.good || 'Le cœur repart !');
        setTimeout(() => api.next(), 500);
      }
    } else {
      replay($('beat-h'), 'shake');
      if (o.penalty) api.hurt(o.penalty, o.bad || 'Pas en rythme !');
      else api.msg(o.bad || 'Pas en rythme !');
    }
  };
  api.onTick((dt) => {
    if (over) return;
    t += dt;
    const ph = (t % beat) / beat;
    $('beat-h').style.transform = `scale(${1 + 0.35 * Math.max(0, 1 - ph * 5)})`;
    if (t >= dur) {
      over = true;
      api.fail(o.slow || 'Trop tard.');
    }
  });
};
/** Transfusion : maintenir un niveau dans la zone verte (le niveau baisse tout seul). */
const holdStep = (o) => (api) => {
  const lo = o.lo ?? 45, hi = o.hi ?? 70, need = o.need ?? 8, dur = o.dur ?? 20, ph = mgRnd(0, 6.28);
  let lvl = 30, ok = 0, t = 0, hold = false, over = false;
  api.area.innerHTML = `<p class="op-step">${o.label}</p><div class="tank"><div class="tank-z" style="bottom:${lo}%;height:${hi - lo}%"></div><div class="tank-f" id="tk-f" style="height:30%"></div></div>
    <div class="form-actions" style="justify-content:center"><button type="button" class="btn" id="mg-hold">${o.verb || '💉 Injecter (maintenir)'}</button></div>
    <div class="gauge"><i id="tk-p" style="width:0%"></i></div><div class="gauge-cap"><span>Stabilisé</span><span id="tk-n">0 s / ${need} s</span></div>`;
  const b = $('mg-hold');
  b.onpointerdown = () => (hold = true);
  b.onpointerup = b.onpointerleave = b.onpointercancel = () => (hold = false);
  const key = (e) => {
    if (e.code !== 'Space') return;
    e.preventDefault();
    hold = e.type === 'keydown';
  };
  document.addEventListener('keydown', key);
  document.addEventListener('keyup', key);
  const end = (fn) => {
    over = true;
    document.removeEventListener('keydown', key);
    document.removeEventListener('keyup', key);
    fn();
  };
  api.onTick((dt) => {
    if (over) return;
    t += dt;
    lvl = Math.max(0, Math.min(100, lvl + ((hold ? 30 : 0) - 12 - 6 * Math.sin(t * 1.3 + ph)) * dt));
    if (lvl >= lo && lvl <= hi) ok += dt;
    else if (o.penalty) api.hurt(o.penalty * dt);
    $('tk-f').style.height = `${lvl}%`;
    $('tk-p').style.width = `${Math.min(100, (ok / need) * 100)}%`;
    $('tk-n').textContent = `${Math.floor(ok)} s / ${need} s`;
    if (ok >= need) return end(() => { api.msg(o.good || 'Stabilisé !'); setTimeout(() => api.next(), 500); });
    if (t >= dur) end(() => api.fail(o.slow || 'Pas assez stable.'));
  });
};
/** Fouiller : dégager une relique de la terre, doucement pour ne pas l'abîmer. */
const scratchStep = (o) => (api) => {
  const C = 14, R = 8, dur = o.dur ?? 20;
  const inRelic = (c, r) => ((c - (C - 1) / 2) / (C * 0.28)) ** 2 + ((r - (R - 1) / 2) / (R * 0.36)) ** 2 <= 1;
  const relic = new Set();
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) if (inRelic(c, r)) relic.add(`${c},${r}`);
  const cleared = new Set();
  let dmg = 0, t = 0, over = false, last = null;
  api.area.innerHTML = `<p class="op-step">${o.label}</p><div class="dig" id="dig" style="grid-template-columns:repeat(${C},1fr)"><span class="dig-relic" aria-hidden="true">${o.icon || '🏺'}</span>${Array.from({ length: C * R }, (_, i) => `<i data-cell="${i % C},${Math.floor(i / C)}"></i>`).join('')}</div>
    <div class="gauge"><i id="dig-p" style="width:0%"></i></div><div class="gauge-cap"><span>Dégagé : <b id="dig-n">0 %</b></span><span>Abîmé : <b id="dig-d">0 %</b></span></div>`;
  const box = $('dig');
  const end = (ok, text) => {
    over = true;
    if (ok) {
      api.msg(text);
      setTimeout(() => api.next(), 500);
    } else api.fail(text);
  };
  const scrape = (e) => {
    if (over) return;
    const now = performance.now();
    const speed = last ? Math.hypot(e.clientX - last.x, e.clientY - last.y) / Math.max(1, now - last.t) : 0; // px par ms
    last = { x: e.clientX, y: e.clientY, t: now };
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const key = el?.dataset?.cell;
    if (!key || el.classList.contains('off')) return;
    el.classList.add('off');
    if (!relic.has(key)) return;
    cleared.add(key);
    if (speed > (o.maxSpeed ?? 0.9)) {
      dmg += 7;
      api.msg('Doucement, tu abîmes la relique !');
    }
    const pct = Math.round((cleared.size / relic.size) * 100);
    $('dig-p').style.width = `${pct}%`;
    $('dig-n').textContent = `${pct} %`;
    $('dig-d').textContent = `${Math.min(100, dmg)} %`;
    if (dmg >= 100) return end(false, 'La relique est abîmée.');
    if (pct >= 90) end(true, 'Relique dégagée !');
  };
  box.onpointerdown = (e) => {
    box.setPointerCapture(e.pointerId);
    last = null;
    scrape(e);
  };
  box.onpointermove = (e) => {
    if (e.buttons || e.pointerType === 'touch') scrape(e);
  };
  box.onpointerup = () => (last = null);
  api.onTick((dt) => {
    if (over) return;
    t += dt;
    if (t >= dur) end(false, 'Le temps est écoulé.');
  });
};
/** Déchiffrer : retrouver les paires de symboles (jeu de mémoire). */
const pairsStep = (o) => (api) => {
  const glyphs = ['ᚠ', 'ᚢ', 'ᚦ', 'ᚨ', 'ᚱ', 'ᚲ', 'ᚷ', 'ᚹ'].sort(() => Math.random() - 0.5).slice(0, o.pairs ?? 6);
  const cards = [...glyphs, ...glyphs].sort(() => Math.random() - 0.5);
  let open = [], found = 0, miss = 0, lock = false, over = false;
  api.area.innerHTML = `<p class="op-step">${o.label}</p><div class="pairs">${cards.map((gl, i) => `<button type="button" class="pair" data-pair="${i}" aria-label="Pierre gravée"><span>${gl}</span></button>`).join('')}</div><p class="note" id="pair-n"></p>`;
  const info = () => ($('pair-n').textContent = `${found} / ${glyphs.length} paires${o.misses != null ? ` · ${o.misses - miss} erreur${o.misses - miss > 1 ? 's' : ''} permise${o.misses - miss > 1 ? 's' : ''}` : ''}`);
  api.area.querySelector('.pairs').onclick = (e) => {
    const b = e.target.closest('[data-pair]');
    if (!b || lock || over || b.classList.contains('up')) return;
    b.classList.add('up');
    open.push(b);
    if (open.length < 2) return;
    const [a, c] = open;
    open = [];
    if (cards[+a.dataset.pair] === cards[+c.dataset.pair]) {
      a.classList.add('done');
      c.classList.add('done');
      found++;
      info();
      if (found >= glyphs.length) {
        over = true;
        api.msg(o.good || 'Inscription déchiffrée !');
        setTimeout(() => api.next(), 500);
      }
      return;
    }
    miss++;
    info();
    if (o.misses != null && miss > o.misses) {
      over = true;
      return api.fail('Trop d’erreurs.');
    }
    lock = true;
    setTimeout(() => {
      a.classList.remove('up');
      c.classList.remove('up');
      lock = false;
    }, 700);
  };
  info();
};

/* ═══ Inventions des scientifiques ═══════════════════════════════════════ */
function inventionsHTML() {
  if (S.job.id !== 'scientifique') return '';
  const list = S.inventions || [];
  const status = (x) => (x.ok ? '<span class="status ok">Validée</span>' : x.refused ? '<span class="status refused">Refusée</span>' : '<span class="status wait">À valider</span>');
  return `<div class="sec-head" style="margin-top:22px"><h2 style="font-size:20px">🔬 Inventions</h2>${VIEW ? '' : '<button class="btn sm" id="inv-new">+ Proposer une invention</button>'}</div>
    <p class="note">Imagine une invention, décris précisément ce qu’elle fait et ajoute des images : le staff la valide, ou la refuse avec un motif.</p>
    ${list.length ? list.map((x) => `<details class="tech" ${x.refused && !x.ok ? 'open' : ''}>
      <summary>${x.images[0] ? `<span class="t-thumb"><img src="${imgSrc(x.images[0])}" alt="" loading="lazy"></span>` : ''}<span><span class="t-name">${esc(x.name)}</span>${status(x)}</span><span class="cost"><span class="chev" aria-hidden="true">▾</span></span></summary>
      ${!x.ok && x.refused ? `<p class="refused-why"><b>Motif du refus :</b> ${esc(x.refused.reason)}</p>` : ''}
      ${x.images.length ? `<div class="inv-gallery">${x.images.map((u) => `<img src="${imgSrc(u)}" alt="" loading="lazy">`).join('')}</div>` : ''}
      <p class="inv-desc">${esc(x.desc)}</p>
      ${VIEW ? '' : `<div class="t-actions"><button class="btn sm ghost" data-inv-edit="${x.id}">${!x.ok && x.refused ? 'Corriger et reproposer' : 'Modifier'}</button><button class="btn sm ghost" data-inv-del="${x.id}">Supprimer</button></div>`}
    </details>`).join('') : '<p class="note">Aucune invention pour l’instant.</p>'}`;
}
let invDraft = null;
function openInvention(x = null) {
  invDraft = { id: x?.id ?? null, images: [...(x?.images || [])] };
  $('inv-title').textContent = x ? (x.refused && !x.ok ? 'Corriger l’invention' : 'Modifier l’invention') : 'Nouvelle invention';
  $('inv-save').textContent = x?.ok ? 'Enregistrer (repassera en validation)' : x ? 'Reproposer l’invention' : 'Proposer l’invention';
  $('inv-name').value = x?.name ?? '';
  $('inv-desc').value = x?.desc ?? '';
  $('inv-url').value = '';
  $('inv-err').textContent = x && !x.ok && x.refused ? `Motif du refus : ${x.refused.reason}` : '';
  showInvImgs();
  invCount();
  openDialog('d-inv');
}
function showInvImgs() {
  $('inv-imgs').innerHTML = invDraft.images.map((u, i) => `<span class="inv-img"><img src="${imgSrc(u)}" alt=""><button type="button" class="close sm-close" data-inv-rm="${i}" aria-label="Retirer">×</button></span>`).join('') || '<span class="note">Aucune image.</span>';
  $('inv-pick').disabled = invDraft.images.length >= 5;
}
const invCount = () => ($('inv-count').textContent = `${$('inv-desc').value.trim().length} / 3 000 caractères (30 minimum)`);
$('inv-desc').addEventListener('input', invCount);
$('inv-pick').addEventListener('click', () => $('inv-file').click());
$('inv-file').addEventListener('change', async (e) => {
  const files = [...e.target.files].filter((f) => f.type.startsWith('image/'));
  e.target.value = '';
  for (const f of files) {
    if (invDraft.images.length >= 5) break;
    if (f.size > 20 * 1024 * 1024) {
      $('inv-err').textContent = 'Image trop lourde (20 Mo maximum).';
      continue;
    }
    invDraft.images.push(await readImage(f, { max: 1200, maxBytes: 700 * 1024 })); // allégée : 5 images doivent passer d'un coup
  }
  showInvImgs();
});
$('inv-url-go').addEventListener('click', () => {
  const v = $('inv-url').value.trim();
  if (!/^https?:\/\//.test(v)) return void ($('inv-err').textContent = 'Le lien doit commencer par http:// ou https://');
  if (invDraft.images.length >= 5) return;
  invDraft.images.push(v);
  $('inv-url').value = '';
  showInvImgs();
});
$('inv-imgs').addEventListener('click', (e) => {
  const i = e.target.closest('[data-inv-rm]')?.dataset.invRm;
  if (i == null) return;
  invDraft.images.splice(+i, 1);
  showInvImgs();
});
$('inv-save').addEventListener('click', async () => {
  const name = $('inv-name').value.trim(), desc = $('inv-desc').value.trim();
  if (!name) return void ($('inv-err').textContent = 'Donne un nom à ton invention.');
  if (desc.length < 30) return void ($('inv-err').textContent = 'Décris précisément ce qu’elle fait (30 caractères minimum).');
  $('inv-save').disabled = true;
  $('inv-err').textContent = invDraft.images.some((u) => u.startsWith('data:')) ? 'Envoi des images…' : '';
  const out = await run({ type: 'invention.save', id: invDraft.id ?? undefined, name, desc, images: invDraft.images });
  $('inv-save').disabled = false;
  if (out) closeDialog($('d-inv'));
  else $('inv-err').textContent = '';
});
$('v-job').addEventListener('click', async (e) => {
  if (e.target.closest('#inv-new')) return openInvention();
  const ed = e.target.closest('[data-inv-edit]')?.dataset.invEdit;
  if (ed) return openInvention(S.inventions.find((x) => x.id === Number(ed)));
  const del = e.target.closest('[data-inv-del]')?.dataset.invDel;
  if (del && (await askConfirm('L’invention sera supprimée de ta fiche.', { title: 'Supprimer cette invention ?', ok: 'Supprimer', danger: true }))) run({ type: 'invention.delete', id: Number(del) });
});

/* ═══ Navigateur : lire la mer (tenir le cap, puis la roue des vents) ════ */
const wheelSVG = () => `<circle r="40" fill="none" stroke="#7a4a1e" stroke-width="8"/><circle r="11" fill="#a8690c" stroke="#5a3a1e" stroke-width="3"/>${Array.from({ length: 8 }, (_, i) => `<g transform="rotate(${i * 45})"><line x1="0" y1="-11" x2="0" y2="-52" stroke="#7a4a1e" stroke-width="6" stroke-linecap="round"/><circle cy="-54" r="5" fill="#a8690c"/></g>`).join('')}`;
/** Tenir le cap : le vent pousse l'aiguille, la barre la ramène. Score = part du temps passée dans la zone verte. */
const helmStep = (rank, res, diff = 2) => (api) => {
  // Route difficile : vent plus fort, zone plus étroite, bon cap qui bouge plus vite et plus loin
  const dur = 12, sector = Math.max(10, 26 - diff * 3 + rank * 4), drift0 = 8 + diff * 3.5 + Math.random() * 4 - rank * 2;
  const tAmp = 12 + diff * 9, tw = [[mgRnd(0.25, 0.45) * (0.7 + diff * 0.15), mgRnd(0, 6.28)], [mgRnd(0.6, 1.1) * (0.7 + diff * 0.15), mgRnd(0, 6.28)]];
  let tgt = 0;
  const w = [[mgRnd(0.3, 0.6), mgRnd(0, 6.28)], [mgRnd(0.9, 1.6), mgRnd(0, 6.28)]];
  let t = 0, inside = 0, h = mgRnd(-30, 30), rot = 0, drag = null, hold = 0;
  api.area.innerHTML = `<p class="op-step">☸ <b>Tenir le cap</b> : tourne la barre (glisse dessus, ou ◀ ▶, ou les flèches du clavier) pour garder l’aiguille dans la zone verte : le bon cap change sans cesse, et le vent pousse.</p>
    <div class="helm-wrap">
      <svg class="compass" viewBox="-110 -110 220 120" aria-hidden="true">
        <path d="M -100 0 A 100 100 0 0 1 100 0" fill="#fffaea" stroke="#17255e" stroke-width="4"/>
        <path id="hz" fill="rgba(47,154,85,.45)" d=""/>
        <line id="hn" x1="0" y1="0" x2="0" y2="-92" stroke="#c7352c" stroke-width="5" stroke-linecap="round"/>
        <circle r="7" fill="#17255e"/>
      </svg>
      <div class="helm-row"><button type="button" class="btn sm" id="hl" aria-label="Tourner à gauche">◀</button>
        <svg class="wheel" id="hw" viewBox="-60 -60 120 120" aria-label="Barre du navire">${wheelSVG()}</svg>
        <button type="button" class="btn sm" id="hr" aria-label="Tourner à droite">▶</button></div>
      <div class="gauge" aria-label="Temps restant"><i id="htime" style="width:100%"></i></div>
      <div class="gauge-cap"><span>Au cap : <b id="hpct">0 %</b></span><span id="hleft"></span></div>
    </div>`;
  const arc = (a) => [Math.sin((a * Math.PI) / 180) * 100, -Math.cos((a * Math.PI) / 180) * 100];
  const [x0, y0] = arc(-sector / 2), [x1, y1] = arc(sector / 2);
  $('hz').setAttribute('d', `M 0 0 L ${x0} ${y0} A 100 100 0 0 1 ${x1} ${y1} Z`);
  const wheel = $('hw');
  const center = () => {
    const r = wheel.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };
  wheel.onpointerdown = (e) => {
    const c = center();
    drag = Math.atan2(e.clientY - c.y, e.clientX - c.x);
    wheel.setPointerCapture(e.pointerId);
  };
  wheel.onpointermove = (e) => {
    if (drag == null) return;
    const c = center(), a = Math.atan2(e.clientY - c.y, e.clientX - c.x);
    let d = ((a - drag) * 180) / Math.PI;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    rot = Math.max(-180, Math.min(180, rot + d));
    drag = a;
  };
  wheel.onpointerup = wheel.onpointercancel = () => (drag = null);
  for (const [id, v] of [['hl', -1], ['hr', 1]]) {
    const b = $(id);
    b.onpointerdown = () => (hold = v);
    b.onpointerup = b.onpointerleave = b.onpointercancel = () => (hold = 0);
  }
  const key = (e) => {
    if (e.key === 'ArrowLeft') hold = e.type === 'keydown' ? -1 : 0;
    if (e.key === 'ArrowRight') hold = e.type === 'keydown' ? 1 : 0;
  };
  document.addEventListener('keydown', key);
  document.addEventListener('keyup', key);
  api.onTick((dt) => {
    t += dt;
    rot = Math.max(-180, Math.min(180, rot + hold * 240 * dt));
    if (drag == null && !hold) rot *= 1 - Math.min(1, 0.8 * dt); // la barre revient doucement si on la lâche
    const wind = drift0 * (Math.sin(t * w[0][0] * 2 + w[0][1]) + 0.6 * Math.sin(t * w[1][0] * 2 + w[1][1]));
    h = Math.max(-90, Math.min(90, h + (wind + rot * 0.35) * dt));
    tgt = Math.max(-70, Math.min(70, tAmp * (0.7 * Math.sin(t * tw[0][0] * 2 + tw[0][1]) + 0.3 * Math.sin(t * tw[1][0] * 2 + tw[1][1]))));
    $('hz').setAttribute('transform', `rotate(${tgt})`); // le bon cap bouge
    if (Math.abs(h - tgt) <= sector / 2) inside += dt;
    $('hn').setAttribute('transform', `rotate(${h})`);
    wheel.style.transform = `rotate(${rot * 2}deg)`;
    $('htime').style.width = `${Math.max(0, 100 - (t / dur) * 100)}%`;
    $('hpct').textContent = `${Math.round((inside / Math.max(t, 0.001)) * 100)} %`;
    $('hleft').textContent = `${Math.max(0, Math.ceil(dur - t))} s`;
    if (t < dur) return;
    document.removeEventListener('keydown', key);
    document.removeEventListener('keyup', key);
    res.score = inside / dur;
    api.msg(`Cap tenu ${Math.round(res.score * 100)} % du temps.`);
    api.onTick(null);
    setTimeout(() => api.next(), 900);
  });
};
/** La roue des vents : on la lance, on l'arrête ; la case décide du danger du voyage. */
const WIND_SEGS = [
  { l: 'Mer d’huile', d: 1, c: '#bfe6fa' }, { l: 'Vent favorable', d: 1, c: '#9fd3ef' }, { l: 'Brise', d: 2, c: '#7fc28a' }, { l: 'Houle', d: 3, c: '#e8d38a' },
  { l: 'Brume', d: 3, c: '#d6d6d6' }, { l: 'Courants', d: 4, c: '#e6a223' }, { l: 'Tempête', d: 5, c: '#e0574d' }, { l: 'Mer déchaînée', d: 5, c: '#a46fd6' },
];
/** La roue des vents : ses cases sont les événements choisis par le staff pour ce niveau de mer. */
const windStep = (rank, res, diff = 2) => (api) => {
  const se = G.normalizeSeaEvents(SEA);
  const colors = ['#bfe6fa', '#9fd3ef', '#7fc28a', '#e8d38a', '#d6d6d6', '#e6a223', '#e0574d', '#a46fd6', '#f2c84b', '#8fd0c4'];
  const segs = Object.entries(se.levels[diff] || {}).map(([id, w], i) => ({ id, w, l: se.list.find((e) => e.id === id)?.name || id, c: colors[i % colors.length] }));
  if (!segs.length) {
    res.event = null;
    res.sea = '';
    api.area.innerHTML = '<p class="op-step">🎡 Aucun événement sur cette mer.</p>';
    return void setTimeout(() => api.next(), 900);
  }
  const n = segs.length;
  // Cases proportionnelles aux probabilités du niveau de mer
  const totW = segs.reduce((a, s) => a + s.w, 0) || 1;
  let acc = 0;
  segs.forEach((s) => {
    s.a0 = acc;
    acc += (s.w / totW) * 360;
    s.a1 = acc;
  });
  const P = (a, r) => `${(Math.sin((a * Math.PI) / 180) * r).toFixed(2)} ${(-Math.cos((a * Math.PI) / 180) * r).toFixed(2)}`;
  let rerolls = Math.max(0, rank - 1); // Confirmé : 1 relance, Maître : 2
  const fs = n > 8 ? 7 : n > 5 ? 8 : 9;
  api.area.innerHTML = `<p class="op-step">🎡 <b>La roue des vents</b> (route ${G.ROUTE_DIFFS[diff - 1].toLowerCase()}) : lance la roue, puis arrête-la. Elle décide de l’événement du voyage.${rerolls ? ` Ton expérience te permet de la relancer ${rerolls} fois.` : ''}</p>
    <div class="windwheel"><span class="ww-ptr" aria-hidden="true">▼</span><svg viewBox="-105 -105 210 210" aria-label="Roue des vents"><g id="ww">${segs.map((s) => `${n === 1 ? `<circle r="100" fill="${s.c}" stroke="#17255e" stroke-width="2"/>` : `<path d="M 0 0 L ${P(s.a0, 100)} A 100 100 0 ${s.a1 - s.a0 > 180 ? 1 : 0} 1 ${P(s.a1, 100)} Z" fill="${s.c}" stroke="#17255e" stroke-width="2"/>`}<text transform="rotate(${(s.a0 + s.a1) / 2}) translate(0 -60) rotate(90)" text-anchor="middle" dominant-baseline="middle" font-size="${fs}" font-weight="800" fill="#17255e">${esc(s.l)}</text>`).join('')}</g><circle r="12" fill="#17255e"/></svg></div>
    <div class="form-actions"><button type="button" class="btn" id="mg-hit">🎡 Lancer</button></div>`;
  let ang = 0, speed = 0, state = 'idle', decel = 0;
  const tick = (dt) => {
    if (state === 'idle') return;
    if (state === 'stop') speed = Math.max(0, speed - decel * dt);
    ang = (ang + speed * dt) % 360;
    $('ww')?.setAttribute('transform', `rotate(${ang})`);
    if (state !== 'stop' || speed > 0) return;
    state = 'done';
    api.onTick(null);
    const local = (((360 - ang) % 360) + 360) % 360;
    const s = segs.find((x) => local >= x.a0 && local < x.a1) || segs[n - 1];
    res.event = s.id;
    res.sea = s.l;
    if (rerolls > 0) {
      api.msg(`La roue tombe sur : ${s.l}. Tu peux la relancer, ou garder ce résultat.`);
      $('mg-hit').disabled = false;
      $('mg-hit').textContent = `🎡 Relancer (${rerolls})`;
      const keep = document.createElement('button');
      keep.type = 'button';
      keep.className = 'btn ghost';
      keep.id = 'mg-keep';
      keep.textContent = '✓ Garder';
      keep.onclick = () => api.next();
      $('mg-hit').after(keep);
    } else {
      api.msg(`La roue tombe sur : ${s.l}.`);
      setTimeout(() => api.next(), 1400);
    }
  };
  const spin = () => {
    state = 'spin';
    speed = mgRnd(520, 680);
    $('mg-hit').textContent = '✋ Arrêter';
    $('mg-hit').disabled = false;
    $('mg-keep')?.remove();
    api.onTick(tick);
  };
  $('mg-hit').onclick = () => {
    if (state === 'idle') return spin();
    if (state === 'spin') {
      state = 'stop';
      decel = (speed * speed) / (2 * mgRnd(300, 700)); // s'arrête après un dernier tour imprévisible
      $('mg-hit').disabled = true;
      return;
    }
    if (state === 'done' && rerolls > 0) {
      rerolls--;
      spin();
    }
  };
  api.onTick(tick);
};
const windStepOld = (rank, res, diff = 2) => (api) => {
  // Un navigateur expérimenté agrandit les cases calmes ; une route difficile agrandit les cases dangereuses
  // Seuls les états de mer possibles pour la difficulté de la route (paisible : mer d'huile ou calme…)
  const segs = WIND_SEGS.filter((s) => s.d >= Math.max(1, diff - 2) && s.d <= Math.min(5, diff + 1)).map((s) => {
    const calm = s.d <= 2, rough = s.d >= 4;
    const w = 1 + (calm ? 0.45 : rough ? -0.25 : 0) * (rank - 1) + (calm ? -0.22 : rough ? 0.35 : 0.05) * (diff - 2);
    return { ...s, w: Math.max(0.2, w) };
  });
  const total = segs.reduce((a, s) => a + s.w, 0);
  let a0 = 0;
  for (const s of segs) {
    s.a0 = a0;
    s.a1 = a0 + (s.w / total) * 360;
    a0 = s.a1;
  }
  const P = (a, r) => `${(Math.sin((a * Math.PI) / 180) * r).toFixed(2)} ${(-Math.cos((a * Math.PI) / 180) * r).toFixed(2)}`;
  api.area.innerHTML = `<p class="op-step">🎡 <b>La roue des vents</b> : lance la roue, puis arrête-la. Elle décide de l’état de la mer pendant le voyage${rank > 1 ? ' (ton expérience agrandit les cases calmes)' : ''}.</p>
    <div class="windwheel"><span class="ww-ptr" aria-hidden="true">▼</span><svg viewBox="-105 -105 210 210" aria-label="Roue des vents"><g id="ww">${segs.map((s) => `<path d="M 0 0 L ${P(s.a0, 100)} A 100 100 0 ${s.a1 - s.a0 > 180 ? 1 : 0} 1 ${P(s.a1, 100)} Z" fill="${s.c}" stroke="#17255e" stroke-width="2"/><text transform="rotate(${(s.a0 + s.a1) / 2}) translate(0 -60) rotate(90)" text-anchor="middle" dominant-baseline="middle" font-size="9" font-weight="800" fill="#17255e">${esc(s.l)}</text>`).join('')}</g><circle r="12" fill="#17255e"/></svg></div>
    <div class="form-actions"><button type="button" class="btn" id="mg-hit">🎡 Lancer</button></div>`;
  let ang = 0, speed = 0, state = 'idle', decel = 0;
  $('mg-hit').onclick = () => {
    if (state === 'idle') {
      state = 'spin';
      speed = mgRnd(520, 680);
      $('mg-hit').textContent = '✋ Arrêter';
    } else if (state === 'spin') {
      state = 'stop';
      decel = (speed * speed) / (2 * mgRnd(300, 700)); // s'arrête après un dernier tour imprévisible
      $('mg-hit').disabled = true;
    }
  };
  api.onTick((dt) => {
    if (state === 'idle') return;
    if (state === 'stop') speed = Math.max(0, speed - decel * dt);
    ang = (ang + speed * dt) % 360;
    $('ww').setAttribute('transform', `rotate(${ang})`);
    if (state !== 'stop' || speed > 0) return;
    state = 'done';
    const local = (((360 - ang) % 360) + 360) % 360;
    const s = segs.find((x) => local >= x.a0 && local < x.a1) || segs[segs.length - 1];
    res.danger = s.d;
    res.sea = s.l;
    api.msg(`La mer sera : ${s.l} (danger ${s.d}/5).`);
    api.onTick(null);
    setTimeout(() => api.next(), 1400);
  });
};
/** Mini-jeu du navigateur au départ : renvoie { score, danger, sea }, ou null s'il abandonne. */
async function navGame(rank, title, diff = 2) {
  if (!SEA) {
    const out = await run({ type: 'features.get' }); // les événements de la roue
    if (out?.seaEvents) SEA = out.seaEvents;
  }
  const res = { score: 0.5, danger: diff, sea: '', event: null };
  const ok = await miniGame({ title, help: `Route ${G.ROUTE_DIFFS[diff - 1].toLowerCase()}. Tiens le cap, puis lance la roue des vents : ta lecture de la mer décide de la durée et des dangers du voyage.`, steps: [helmStep(rank, res, diff), windStep(rank, res, diff)], doneText: 'La mer est lue !' });
  return ok ? res : null;
}
/** Le bateau d'un voyage (parmi les bateaux connus de l'app). */
function shipOfVoyage(v) {
  const all = typeof SHIPS !== 'undefined' && SHIPS ? Object.values(SHIPS) : [];
  return all.find((s) => s.voyage === v) || (NAVD?.aboard?.voyage === v ? NAVD.aboard : null);
}
/** Mer prévue et risques d'un voyage ; bouton « Lire la mer » pour un navigateur à bord pendant le vote. */
function dangerHTML(v) {
  if (!VIEW) refreshFeatures(); // événements en mer à jour (au plus une fois par minute)
  const sh = shipOfVoyage(v);
  const d = v.diff || v.danger || 2;
  const btn = v.status === 'vote' && !v.navRead && S?.job?.id === 'navigateur' && sh?.passengers?.includes(S.uid) && !VIEW
    ? `<button class="btn sm" data-navread="${esc(sh.id)}">🧭 Lire la mer</button>` : '';
  const wait = v.status === 'vote' && !v.navRead ? '<small class="note" style="display:block">Un navigateur à bord doit lire la mer avant de pouvoir accepter le départ.</small>' : '';
  return `<div class="sea-read">
    <p class="note" style="margin:2px 0 2px">Route : <b class="d${d}">${G.ROUTE_DIFFS[d - 1]}</b> ${'☠'.repeat(d)}</p>
    <p class="note" style="margin:0 0 4px">${v.event ? `Événement : <b>${esc(v.event.name)}</b> (${v.navRead ? 'lu par le navigateur' : 'tiré au hasard'})` : 'Aucun événement.'}</p>${wait}${btn}</div>`;
}
/** Rencontre en mer : un autre bateau en vue, accoster ou reprendre la mer. */
function encounterHTML(v) {
  const e = v.encounter;
  if (!e) return '';
  const sh = shipOfVoyage(v);
  const can = sh && !VIEW && G.canManageShip(S, sh, CREW);
  return `<div class="encounter"><b>⛵ ${e.alongside ? `Bord à bord avec ${esc(e.withName)}` : `Un navire est en vue : ${esc(e.withName)} !`}</b>
    <p class="note" style="margin:2px 0 6px">${e.alongside ? 'Les passagers peuvent écrire dans le salon de l’autre bateau sans quitter le leur. Le voyage reprend quand vous repartez.' : 'Le bateau est à l’arrêt : les messages RP ne font plus avancer le voyage. Accostez pour jouer la rencontre, ou reprenez la mer.'}</p>
    ${can ? `<div class="form-actions" style="justify-content:flex-start">${e.alongside ? '' : `<button class="btn sm" data-meet="${esc(sh.id)}" data-choice="accoster">⚓ Accoster</button>`}<button class="btn sm ghost" data-meet="${esc(sh.id)}" data-choice="repartir">⛵ Reprendre la mer</button></div>` : '<p class="note" style="margin:0">Le capitaine décide d’accoster ou de repartir.</p>'}
  </div>`;
}
document.addEventListener('click', async (e) => {
  const nr = e.target.closest('[data-navread]')?.dataset.navread;
  if (nr) {
    const all = typeof SHIPS !== 'undefined' && SHIPS ? Object.values(SHIPS) : [];
    const sh = all.find((s) => s.id === nr) || (NAVD?.aboard?.id === nr ? NAVD.aboard : null);
    const nav = await navGame(S.job.lvl, 'Lire la mer', sh?.voyage?.diff ?? 2);
    if (nav) run({ type: 'ship.voyage.read', shipId: nr, nav });
    return;
  }
  const m = e.target.closest('[data-meet]');
  if (m) run({ type: 'ship.meet', shipId: m.dataset.meet, choice: m.dataset.choice });
});

/* ═══ Utiliser et donner des objets ═══════════════════════════════════════ */
document.addEventListener('click', (e) => {
  const use = e.target.closest('[data-use]')?.dataset.use;
  if (use) return void run({ type: 'item.use', key: use });
  const give = e.target.closest('[data-give]')?.dataset.give;
  if (give) giveDialog(give);
});
async function giveDialog(k) {
  const out = await run({ type: 'players.here' });
  if (!out?.players) return;
  if (!out.players.length) return void toast('Personne d’autre ici : vous devez avoir écrit dans le même salon RP.');
  $('give-title').textContent = `Donner : ${itemOf(k).name}`;
  $('give-to').innerHTML = out.players.map((p) => `<option value="${esc(p.uid)}">${esc(p.name)}</option>`).join('');
  $('give-qty').max = count(k);
  $('give-qty').value = 1;
  $('give-ok').onclick = async () => {
    const to = $('give-to').value, qty = Math.max(1, Math.floor(+$('give-qty').value || 1));
    closeDialog($('d-give'));
    await run({ type: 'item.give', key: k, to, qty });
  };
  openDialog('d-give');
}

/* ═══ Cabinet médical : soigner les blessures ════════════════════════════ */
let cabinet = { patients: null };
/** Demandes de soin reçues, affichées sous l'état de santé de la fiche. */
function careInHTML() {
  const list = S.careIn || [];
  if (!list.length || VIEW) return '';
  return list.map((q) => `<div class="care-req">🩺 <b>${esc(q.doctorName)}</b> ${q.accepted ? 'va soigner' : 'propose de soigner'} « ${esc(q.label)} »${q.accepted ? '' : ` <button class="btn sm" data-care-yes="${esc(q.id)}">Accepter</button><button class="btn sm ghost" data-care-no="${esc(q.id)}">Refuser</button>`}</div>`).join('');
}
$('h-health').addEventListener('click', (e) => {
  const y = e.target.closest('[data-care-yes]')?.dataset.careYes;
  if (y) return void run({ type: 'care.answer', id: y, accept: true });
  const n = e.target.closest('[data-care-no]')?.dataset.careNo;
  if (n) run({ type: 'care.answer', id: n, accept: false });
});
/** Section « Cabinet médical » de l'onglet Métier, pour les médecins. */
function cabinetHTML() {
  if (S.job.id !== 'medecin') return '';
  const cares = Object.entries(G.RECIPES).filter(([, r]) => r.care);
  const reach = ['les blessures légères', 'les blessures jusqu’aux graves', 'toutes les blessures'][S.job.lvl - 1];
  return `<div class="sec-head" style="margin-top:22px"><h2 style="font-size:20px">🩺 Cabinet médical</h2><button class="btn sm ghost" id="cab-refresh">Voir les blessés autour de moi</button></div>
    <p class="note">${JOB_LEVELS[S.job.lvl - 1]} : tu soignes ${reach}. Le patient doit être au même endroit que toi (le dernier salon RP où vous avez écrit) et accepter.</p>
    ${cares.length ? '' : '<p class="note">Aucun soin n’existe encore : le staff les crée dans Gestion > Recettes (champ « Soin »).</p>'}
    ${S.careOut.length ? `<div class="crew-box"><h3>Mes demandes</h3>${S.careOut.map((q) => `<div class="member-row"><span class="m-name"><b>${esc(q.patientName)}</b> · ${esc(q.label)} <span class="hp-lvl-${q.level}">${G.HEALTH_LEVELS[q.level - 1]}</span></span><span class="note">${q.accepted ? 'accepté' : 'en attente'}</span><span class="m-acts">${q.accepted ? `<button class="btn sm" data-care-go="${esc(q.id)}">Soigner</button>` : ''}</span></div>`).join('')}</div>` : ''}
    ${cabinet.patients ? patientsHTML(cares) : ''}`;
}
function patientsHTML(cares) {
  const list = cabinet.patients.filter((p) => p.health.length);
  if (!list.length) return '<p class="note">Aucun blessé au même endroit que toi.</p>';
  return `<div class="crew-box"><h3>Blessés autour de toi</h3>${list.map((p) => p.health.map((h) => {
    const ok = h.healAt ? [] : cares.filter(([, r]) => r.care.level >= h.level && (!r.care.type || r.care.type === h.type));
    const self = p.uid === S.uid, key = `${p.uid}:${h.id}`;
    return `<div class="member-row care-row"><span class="m-name"><b>${esc(p.name)}</b>${self ? ' (toi)' : ''} · ${esc(h.label)} <small class="note">${esc(G.injuryName(h.type))}</small> <span class="hp-lvl-${h.level}">${G.HEALTH_LEVELS[h.level - 1]}</span>${h.healAt ? ` <small class="ok">💚 déjà soignée, guérie ${healIn(h)}</small>` : ''}</span>
      <select data-care-rec="${esc(key)}" aria-label="Soin">${ok.map(([id, r]) => `<option value="${esc(id)}">${esc(G.recipeLabel(r))} · ${Object.entries(r.needs).map(([k, q]) => `${q} ${esc(itemOf(k).name)}`).join(', ') || 'sans matériel'}${Object.keys(r.tools || {}).length ? ` · outils : ${Object.keys(r.tools).map((k) => esc(itemOf(k).name)).join(', ')}` : ''}</option>`).join('') || '<option value="">Aucun soin assez fort</option>'}</select>
      <span class="m-acts"><button class="btn sm" data-care-ask="${esc(key)}" ${ok.length ? '' : 'disabled'}>${self ? 'Me soigner' : 'Proposer le soin'}</button></span></div>`;
  }).join('')).join('')}</div>`;
}
$('v-job').addEventListener('click', async (e) => {
  if (e.target.closest('#cab-refresh')) {
    const out = await run({ type: 'care.patients' });
    if (out?.patients) {
      cabinet.patients = out.patients;
      renderJob();
    }
    return;
  }
  const ask = e.target.closest('[data-care-ask]')?.dataset.careAsk;
  if (ask) {
    const [uid, healthId] = ask.split(':');
    const recipe = document.querySelector(`[data-care-rec="${CSS.escape(ask)}"]`)?.value;
    if (!recipe) return;
    if (uid === S.uid) return void careSelf(healthId, recipe);
    return void run({ type: 'care.request', uid, healthId, recipe });
  }
  const go = e.target.closest('[data-care-go]')?.dataset.careGo;
  if (go) {
    const q = S.careOut.find((x) => x.id === go);
    if (!q) return;
    if (!(await askConfirm('Le matériel est pris tout de suite. Si tu rates, il est perdu (tu pourras réessayer).', { title: `Soigner « ${q.label} » ?`, ok: 'Commencer' }))) return;
    const success = await careGame(q.level, q.label, S.job.lvl, null, G.RECIPES[q.recipe]);
    await run({ type: 'care.do', id: go, success });
    cabinet.patients = null;
  }
});
async function careSelf(healthId, recipe) {
  const h = S.health.find((x) => x.id === healthId);
  if (!h) return;
  if (!(await askConfirm('Le matériel est pris tout de suite. Si tu rates, il est perdu.', { title: `Soigner « ${h.label} » ?`, ok: 'Commencer' }))) return;
  const success = await careGame(h.level, h.label, S.job.lvl, null, G.RECIPES[recipe]);
  await run({ type: 'care.do', self: true, healthId, recipe, success });
  cabinet.patients = null;
}
/** Bandage pour une blessure légère, opération au-delà. */
function careGame(level, label, rank = S?.job?.lvl || 1, kind = null, recipe = null) {
  if (recipe?.game) return customGame(recipe, rank, level <= 1 ? `Soin léger : ${label}` : label, level); // mini-jeux choisis par le staff
  if (level <= 1) return bandageGame(label, rank, kind);
  return opGame2(level, `Opération : ${label}`, rank);
}
/** Opération en trois étapes (anesthésie, incision, suture) pendant que les constantes baissent. */
function opGame(level, title, rank = S?.job?.lvl || 1) {
  return new Promise((resolve) => {
    const d = $('d-op'), area = $('op-area');
    $('op-title').textContent = title;
    $('op-msg').textContent = '';
    let vit = 100, step = -1, done = false, raf = 0, last = performance.now();
    const drain = Math.max(1, 1.5 + level * 1.2 - (rank - G.careRank(level)) * 0.8); // % par seconde
    let cur = 0, dir = 1, zx = 0, drawing = false, dev = [], next = 1;
    const zw = Math.max(8, 20 - level * 3), total = 3 + level;
    const hurt = (n, msg) => {
      vit -= n;
      $('op-msg').textContent = msg;
    };
    const finish = (ok) => {
      if (done) return;
      done = true;
      cancelAnimationFrame(raf);
      $('op-msg').textContent = ok ? 'Opération réussie : le patient est sauvé !' : 'Les constantes se sont effondrées : opération ratée.';
      setTimeout(() => {
        if (d.open) closeDialog(d);
        resolve(ok);
      }, 1100);
    };
    const yAt = (x) => 80 + Math.sin((x / 460) * Math.PI * (1 + level)) * 45;
    const steps = [
      () => {
        zx = 15 + Math.random() * (70 - zw);
        area.innerHTML = `<p class="op-step">1/3 · <b>Anesthésie</b> : injecte quand l’aiguille est dans la zone verte.</p>
          <div class="nail-board op-dose" id="op-board"><div class="nail-zone op-ok" style="left:${zx}%;width:${zw}%"></div><div class="nail-cursor" id="op-cur"></div></div>
          <div class="form-actions"><button type="button" class="btn" id="op-act">💉 Injecter</button></div>`;
        $('op-act').onclick = () => {
          if (cur >= zx && cur <= zx + zw) go();
          else {
            replay($('op-board'), 'shake');
            hurt(12, 'Mauvaise dose : le patient réagit mal !');
          }
        };
      },
      () => {
        area.innerHTML = `<p class="op-step">2/3 · <b>Incision</b> : pars du point vert et suis le tracé en pointillés jusqu’au bout, sans lâcher.</p><canvas id="op-cv" class="op-cv" width="460" height="160"></canvas>`;
        const cv = $('op-cv'), g = cv.getContext('2d');
        const drawPath = () => {
          g.clearRect(0, 0, 460, 160);
          g.setLineDash([6, 6]);
          g.strokeStyle = '#17255e';
          g.lineWidth = 2;
          g.beginPath();
          for (let x = 10; x <= 450; x += 5) (x === 10 ? g.moveTo(x, yAt(x)) : g.lineTo(x, yAt(x)));
          g.stroke();
          g.setLineDash([]);
          g.fillStyle = '#2f9a55';
          g.beginPath();
          g.arc(10, yAt(10), 7, 0, 7);
          g.fill();
        };
        drawPath();
        const pt = (e) => {
          const r = cv.getBoundingClientRect();
          return { x: ((e.clientX - r.left) / r.width) * 460, y: ((e.clientY - r.top) / r.height) * 160 };
        };
        cv.onpointerdown = (e) => {
          const p = pt(e);
          if (p.x > 30) return void ($('op-msg').textContent = 'Commence au point vert, à gauche.');
          drawing = true;
          dev = [];
          cv.setPointerCapture(e.pointerId);
          drawPath();
          g.strokeStyle = '#c7352c';
          g.lineWidth = 3;
          g.beginPath();
          g.moveTo(p.x, p.y);
        };
        cv.onpointermove = (e) => {
          if (!drawing) return;
          const p = pt(e);
          dev.push(Math.abs(p.y - yAt(p.x)));
          g.lineTo(p.x, p.y);
          g.stroke();
          if (p.x >= 445) {
            drawing = false;
            const avg = dev.reduce((a, b) => a + b, 0) / Math.max(1, dev.length);
            if (avg > 10) hurt(Math.min(35, (avg - 10) * 2), 'Incision imprécise…');
            else $('op-msg').textContent = 'Incision propre.';
            go();
          }
        };
        cv.onpointerup = () => {
          if (!drawing) return;
          drawing = false;
          hurt(8, 'Tu as lâché le scalpel : recommence l’incision.');
          drawPath();
        };
      },
      () => {
        area.innerHTML = `<p class="op-step">3/3 · <b>Suture</b> : clique les points dans l’ordre.</p><div class="op-sut" id="op-sut">${Array.from({ length: total }, (_, i) => `<button type="button" class="op-pt" data-pt="${i + 1}" style="left:${6 + (i * 84) / total + Math.random() * 5}%;top:${12 + Math.random() * 66}%">${i + 1}</button>`).join('')}</div>`;
        $('op-sut').onclick = (e) => {
          const b = e.target.closest('[data-pt]');
          if (!b || b.disabled) return;
          if (+b.dataset.pt === next) {
            b.classList.add('done');
            b.disabled = true;
            next++;
            if (next > total) finish(true);
          } else {
            replay(b, 'shake');
            hurt(8, 'Mauvais point !');
          }
        };
      },
    ];
    const go = () => {
      step++;
      if (step < steps.length) steps[step]();
    };
    const tick = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      vit -= drain * dt;
      if (step === 0) {
        cur += dir * (0.8 + level * 0.25) * 100 * dt;
        if (cur >= 100) { cur = 100; dir = -1; }
        if (cur <= 0) { cur = 0; dir = 1; }
        const c = $('op-cur');
        if (c) c.style.left = `${cur}%`;
      }
      const v = Math.max(0, vit);
      $('op-vit').style.width = `${v}%`;
      $('op-vit-n').textContent = `${Math.round(v)} %`;
      $('op-vit').parentElement.classList.toggle('bad', v < 30);
      if (vit <= 0) return finish(false);
      if (!done) raf = requestAnimationFrame(tick);
    };
    d.addEventListener('close', () => {
      if (done) return;
      done = true;
      cancelAnimationFrame(raf);
      resolve(false); // fenêtre fermée : opération abandonnée
    }, { once: true });
    openDialog('d-op');
    go();
    raf = requestAnimationFrame((t) => {
      last = t;
      tick(t);
    });
  });
}
/** Champ « Soin » de l'éditeur de recette. */
function careFieldsHTML(r) {
  return `<div class="wide work-box"><label for="rc-care">Soin (cabinet du médecin)</label>
    <select id="rc-care"><option value="">Aucun</option>${G.HEALTH_LEVELS.map((l, i) => `<option value="${i + 1}" ${r.care?.level === i + 1 ? 'selected' : ''}>Soigne les blessures jusqu’à : ${l}</option>`).join('')}</select>
    ${r.care ? `<select id="rc-care-type" aria-label="Catégorie soignée"><option value="">Toutes les catégories</option>${Object.entries(G.INJURIES).map(([k, c]) => `<option value="${esc(k)}" ${r.care.type === k ? 'selected' : ''}>${esc(c.name)} seulement</option>`).join('')}</select>` : ''}
    ${r.care ? '<p class="note" style="margin:0">Un soin s’utilise dans le cabinet du médecin : retire la ligne « Résultat » et choisis le métier Médecin. Le temps de fabrication devient le temps de guérison : après un soin réussi, la blessure disparaît au bout de ce délai (0 = tout de suite). Le rang nécessaire dépend de la gravité soignée (Légère : Apprenti, Sérieuse et Grave : Confirmé, Critique : Maître).</p>' : ''}
  </div>`;
}
function readCareFields(r) {
  const v = $('rc-care')?.value;
  r.care = v ? { level: +v, type: $('rc-care-type') ? $('rc-care-type').value || null : r.care?.type || null } : null;
}

/* ═══ Navigation : le port du salon ═════════════════════════════════════ */
function ownerLabel(sh) {
  if (!sh.owner) return 'Sans propriétaire';
  if (sh.owner.kind === 'crew') return `${NAVD?.crewKinds?.[sh.owner.id] === 'flotte' ? 'Escouade' : 'Équipage'} : ${esc(NAVD?.crewNames?.[sh.owner.id] ?? '?')}`;
  return sh.owner.id === S.uid ? 'À toi' : `À ${esc(NAVD?.names?.[sh.owner.id] ?? '?')}`;
}
const navName = (u) => (u === S.uid ? 'toi' : esc(NAVD?.names?.[u] ?? '?'));
/** Log Pose : sur une île de Grand Line, un navigateur à bord peut le suivre une fois rechargé. */
function logPoseHTML(sh) {
  if (sh.voyage || !sh.position || !MAP?.here) return '';
  const isl = MAP.islands[MAP.here];
  if (!isl?.grandLine) return '';
  const lp = sh.logPose?.island === MAP.here ? sh.logPose : null;
  const left = lp ? lp.ready - Date.now() : 0;
  const ready = left <= 0;
  return `<div class="crew-box voyage-box"><h3>🧭 Log Pose</h3>
    <p class="note" style="margin:0">${ready ? (isl.choose && isl.next > 1 ? `Rechargé : ${isl.next} chemins s’offrent à vous, chacun vers une île inconnue.` : 'Rechargé : il pointe vers l’île suivante de Grand Line, encore inconnue.') : `En charge : encore ${G.duree(left / 1000)} sur ${esc(isl.name)}.`}</p>
    ${ready ? (S.job.id === 'navigateur' ? `<div class="mj-row">${isl.choose && isl.next > 1 ? `<label for="voy-path">Chemin</label><select id="voy-path">${Array.from({ length: isl.next }, (_, i) => `<option value="${i}">Chemin ${i + 1} · ${G.ROUTE_DIFFS[(isl.nextDiff?.[i] ?? 3) - 1].toLowerCase()}</option>`).join('')}</select>` : ''}<button class="btn sm" data-voy-logpose="${esc(sh.id)}">${isl.choose && isl.next > 1 ? 'Prendre ce chemin' : 'Suivre le Log Pose'}</button></div>${isl.choose && isl.next > 1 ? '<p class="note" style="margin:0">Une fois engagé, pas de retour en arrière.</p>' : ''}` : '<p class="note" style="margin:0">Il faut qu’un navigateur à bord le suive.</p>') : ''}</div>`;
}
/** Encadré du voyage du bateau où l'on est à bord : départ, vote, traversée, arrivée. */
function voyageHTML(sh) {
  const v = sh.voyage ? { ...sh.voyage } : null, me = S.uid, st = G.shipStats(sh);
  if (v?.unknown && v.status !== 'arrived') v.toName = '???'; // destination du Log Pose : inconnue jusqu’à l’arrivée (affichage)
  if (!v) {
    if (!sh.position) return '';
    if (!G.canPilot(S, sh, CREW)) return '<p class="note">Seul le capitaine (ou un grade avec « Choisir la destination ») peut proposer un départ.</p>';
    if (st.damaged) return '<p class="req">⚠️ Le bateau est en avarie : fais-le réparer avant de prendre la mer.</p>';
    if (!sh.channel) return '<p class="note">Ce bateau n’a pas de salon RP : il en faut un pour naviguer (le staff peut l’indiquer dans l’éditeur de bateau).</p>';
    const dests = Object.entries(MAP?.travel || {}).filter(([id, t]) => t && MAP.islands[id]?.accessible);
    if (!MAP?.here || !dests.length) return '<p class="note">Aucune destination connue depuis ce port.</p>';
    return `<div class="crew-box voyage-box"><h3>⛵ Prendre la mer</h3>
      <div class="mj-row"><label for="voy-to">Destination</label><select id="voy-to">${dests.map(([id, t]) => `<option value="${esc(id)}">${esc(MAP.islands[id].name)} · ${G.voyageActions(t.value, st.speed, MAP.pace || 0.5)} actions${t.via?.length ? ` (via ${t.via.map(esc).join(', ')})` : ''} · route ${G.ROUTE_DIFFS[(t.diff ?? 2) - 1].toLowerCase()}</option>`).join('')}</select>
      <button class="btn sm" data-voy-propose="${esc(sh.id)}">Proposer le départ</button></div>
      <p class="note" style="margin:0">Tous les passagers à bord devront accepter.</p></div>`;
  }
  if (v.status === 'vote') {
    const pax = sh.passengers;
    return `<div class="crew-box voyage-box"><h3>⛵ Départ proposé vers ${esc(v.toName)}</h3>
      <p class="note" style="margin:0">${v.needed} actions RP de traversée · proposé par ${navName(v.by)}</p>${dangerHTML(v)}
      <div class="pax">${pax.map((u) => `<span>${v.votes[u] ? '✅' : '⏳'} ${navName(u)}</span>`).join('')}</div>
      <div class="mj-row">${pax.includes(me) && !v.votes[me] ? `<button class="btn sm" data-voy-yes="${esc(sh.id)}">Accepter</button><button class="btn sm ghost" data-voy-no="${esc(sh.id)}">Refuser</button>` : ''}${v.by === me ? `<button class="btn sm ghost danger-txt" data-voy-cancel="${esc(sh.id)}">Annuler le départ</button>` : ''}</div></div>`;
  }
  const pct = Math.round((v.done / Math.max(1, v.needed)) * 100);
  return `<div class="crew-box voyage-box"><h3>${v.status === 'arrived' ? `⚓ En vue de ${esc(v.toName)} !` : `🌊 En mer vers ${esc(v.toName)}`}</h3>
    ${encounterHTML(v)}${dangerHTML(v)}<div class="gauge"><i style="width:${pct}%"></i></div><div class="gauge-cap"><span>Traversée depuis ${esc(v.fromName)}</span><span>${v.done} / ${v.needed} actions</span></div>
    <p class="note" style="margin:0">${v.status === 'arrived' ? `Le premier passager qui écrit un message RP sur ${esc(v.toName)} met le bateau à quai à cet endroit.` : `Chaque message RP de ${G.RP_MIN_CHARS} caractères ou plus d’un passager dans ${sh.channel ? `<b>${esc(sh.channel.name)}</b>` : 'le salon du bateau'} fait avancer le bateau. Écrire ailleurs, c’est passer par-dessus bord !`}</p></div>`;
}
$('v-amap').addEventListener('change', (e) => {
  if (e.target.id === 'amap-pace') mapCall('map.pace', { pace: +e.target.value });
});
/** Cale du bateau où l'on est à bord : déposer et prendre des objets. */
let hx = { side: null, key: null, qty: 1 };
function holdHTML(sh) {
  const load = G.holdWeight(sh), cap = sh.capacity;
  const inv = {};
  S.inv.forEach((s) => s && (inv[s[0]] = G.freeCount(S, s[0])));
  for (const k of Object.keys(inv)) if (inv[k] <= 0) delete inv[k];
  const cell = (side, k, q) => `<button class="cell xcell ${hx.side === side && hx.key === k ? 'on' : ''}" data-h-side="${side}" data-h-key="${esc(k)}" title="${esc(itemOf(k).name)}" aria-label="${esc(itemOf(k).name)}, ${q}">${itemIco(k)}${q > 1 ? `<span class="qty">${q}</span>` : ''}</button>`;
  const selQ = hx.key ? (hx.side === 'inv' ? inv[hx.key] : sh.hold?.[hx.key]) || 0 : 0;
  if (hx.key && !selQ) hx = { side: null, key: null, qty: 1 };
  const it = hx.key ? itemOf(hx.key) : null;
  return `<section class="crew-box"><h3>📦 Cale de ${esc(sh.name)}</h3>
    <div class="gauge" aria-label="Chargement de la cale"><i style="width:${Math.min(100, (load / Math.max(cap, 1)) * 100)}%"></i></div>
    <div class="gauge-cap"><span>Chargement</span><span>${G.kg(load)} / ${G.kg(cap)}</span></div>
    <div class="cargo">
      <div class="cargo-side"><b>Ton inventaire <small class="note">${G.kg(G.invWeight(S))} / ${G.MAX_CARRY} kg</small></b><div class="xgrid">${Object.entries(inv).map(([k, q]) => cell('inv', k, q)).join('') || '<p class="note">Vide</p>'}</div></div>
      <div class="cargo-side"><b>Cale</b><div class="xgrid">${Object.entries(sh.hold || {}).map(([k, q]) => cell('hold', k, q)).join('') || '<p class="note">Vide</p>'}</div></div>
    </div>
    ${it ? `<div class="xbar">${itemIco(hx.key)}<span class="x-name"><b>${esc(it.name)}</b><small>${G.kg(it.weight || 0)} l’unité · ${selQ} disponible${selQ > 1 ? 's' : ''}</small></span>
      <span class="x-qty"><input id="h-qty" type="number" min="1" max="${selQ}" value="${Math.min(hx.qty, selQ)}" aria-label="Quantité"><button class="btn sm ghost" data-hq="all">Tout</button></span>
      <button class="btn" id="h-go" data-ship="${esc(sh.id)}">${hx.side === 'inv' ? 'Déposer dans la cale →' : '← Prendre'}</button></div>`
    : '<p class="note" style="margin:0">Clique sur un objet pour le déposer dans la cale ou le prendre. Tes fabrications puisent aussi dans cette cale.</p>'}
  </section>`;
}
function renderNav() {
  if (!S || ADMIN) return;
  const n = NAVD || { harbor: [], aboard: null, requests: [] };
  const manage = (sh) => G.canManageShip(S, sh, CREW);
  const family = (sh) => G.isShipFamily(S, sh, CREW);
  const passengers = (sh) => sh.passengers.length
    ? `<div class="pax">${sh.passengers.map((u) => `<span>${navName(u)}${manage(sh) && u !== S.uid ? ` <button class="linklike" data-ship-kick="${esc(sh.id)}" data-uid="${esc(u)}" title="Débarquer">✕</button>` : ''}</span>`).join('')}</div>`
    : '';
  const harbor = n.harbor.map((sh) => {
    const onThis = sh.passengers.includes(S.uid);
    const mineReq = sh.requests?.some((r) => r.uid === S.uid);
    const full = sh.passengers.length >= sh.berths;
    const act = onThis ? `<button class="btn sm ghost" data-ship-leave="${esc(sh.id)}">Descendre</button>`
      : mineReq ? `<span class="note">Demande envoyée</span> <button class="btn sm ghost" data-ship-unreq="${esc(sh.id)}">Annuler</button>`
      : family(sh) ? `<button class="btn sm" data-ship-board="${esc(sh.id)}" ${full ? 'disabled' : ''}>${full ? 'Complet' : 'Monter à bord'}</button>`
      : `<button class="btn sm" data-ship-board="${esc(sh.id)}">Demander à monter</button>`;
    return shipCard(sh, { extra: `<p class="note owner">${ownerLabel(sh)}</p>${passengers(sh)}`, actions: `<div class="mj-row">${act}</div>`, upgrade: manage(sh) });
  }).join('');
  $('v-nav').innerHTML = `
    <section class="logbook nav-port">
      <h2>Navigation</h2>
      ${n.aboard ? `<div class="aboard"><b>Tu es à bord de ${esc(n.aboard.name)}</b>${n.aboard.position ? ` (à quai dans #${esc(n.aboard.position.name || n.aboard.position.channelId)})` : ' (en mer)'} ${n.aboard.position ? `<button class="btn sm ghost" data-ship-leave="${esc(n.aboard.id)}">Descendre</button>` : ''}</div>${logPoseHTML(n.aboard)}${voyageHTML(n.aboard)}${holdHTML(n.aboard)}` : ''}
      ${n.requests.length ? `<div class="crew-box"><h3>Demandes d’embarquement</h3>${n.requests.map((r) => `<div class="member-row"><span class="m-name"><b>${navName(r.uid)}</b> veut monter sur <b>${esc(r.shipName)}</b></span><span></span><span class="m-acts"><button class="btn sm" data-req-yes="${esc(r.shipId)}" data-uid="${esc(r.uid)}">Accepter</button><button class="btn sm ghost" data-req-no="${esc(r.shipId)}" data-uid="${esc(r.uid)}">Refuser</button></span></div>`).join('')}</div>` : ''}
      <h3 class="ed-h">${POSID ? `À quai à #${esc(CHNAME || POSID)}` : 'À quai'}</h3>
      ${!POSID ? '<p class="note">Tu n’es nulle part pour l’instant : écris un message RP (400 caractères ou plus) dans un salon RP pour t’y trouver.</p>' : harbor ? `<div class="ships">${harbor}</div>` : '<p class="note">Aucun bateau à quai ici.</p>'}
    </section>`;
  paintStatic($('v-nav'));
}
$('v-nav').addEventListener('click', async (e) => {
  const hc = e.target.closest('[data-h-key]');
  if (hc) {
    const same = hx.side === hc.dataset.hSide && hx.key === hc.dataset.hKey;
    hx = same ? { side: null, key: null, qty: 1 } : { side: hc.dataset.hSide, key: hc.dataset.hKey, qty: 1 };
    return renderNav();
  }
  if (e.target.closest('[data-hq]')) return void ($('h-qty').value = $('h-qty').max);
  const hg = e.target.closest('#h-go');
  if (hg) {
    const qty = Math.max(1, Math.floor(+$('h-qty').value || 1));
    if (await run({ type: hx.side === 'inv' ? 'ship.hold.deposit' : 'ship.hold.withdraw', shipId: hg.dataset.ship, key: hx.key, qty })) hx.qty = 1;
    return;
  }
  const vl = e.target.closest('[data-voy-logpose]')?.dataset.voyLogpose;
  if (vl) {
    const choice = +($('voy-path')?.value ?? 0);
    const isl = MAP?.islands?.[MAP?.here], nd = isl?.nextDiff || [];
    const diff = isl?.choose ? nd[choice] ?? 3 : nd.length ? Math.max(...nd) : 3;
    const nav = S.job.id === 'navigateur' ? await navGame(S.job.lvl, 'Lire la mer', diff) : undefined;
    if (nav === null) return; // abandonné
    return void run({ type: 'ship.voyage.logpose', shipId: vl, choice, nav });
  }
  const vp = e.target.closest('[data-voy-propose]')?.dataset.voyPropose;
  if (vp) {
    const to = $('voy-to').value;
    // Un navigateur lit la mer avant de proposer le départ : durée et dangers du voyage
    const nav = S.job.id === 'navigateur' ? await navGame(S.job.lvl, 'Lire la mer', MAP?.travel?.[to]?.diff ?? 2) : undefined;
    if (nav === null) return; // abandonné
    return void run({ type: 'ship.voyage.propose', shipId: vp, to, nav });
  }
  const vy = e.target.closest('[data-voy-yes]')?.dataset.voyYes;
  if (vy) return void run({ type: 'ship.voyage.vote', shipId: vy, accept: true });
  const vn = e.target.closest('[data-voy-no]')?.dataset.voyNo;
  if (vn) return void run({ type: 'ship.voyage.vote', shipId: vn, accept: false });
  const vc = e.target.closest('[data-voy-cancel]')?.dataset.voyCancel;
  if (vc) return void run({ type: 'ship.voyage.cancel', shipId: vc });
  const d = (k) => e.target.closest(`[data-${k}]`);
  const id = (k) => d(k)?.getAttribute(`data-${k}`);
  if (id('ship-board')) return void run({ type: 'ship.board', shipId: id('ship-board') });
  if (id('ship-leave')) return void run({ type: 'ship.leave', shipId: id('ship-leave') });
  if (id('ship-unreq')) return void run({ type: 'ship.request.cancel', shipId: id('ship-unreq') });
  if (id('req-yes')) return void run({ type: 'ship.request', shipId: id('req-yes'), uid: d('req-yes').dataset.uid, accept: true });
  if (id('req-no')) return void run({ type: 'ship.request', shipId: id('req-no'), uid: d('req-no').dataset.uid, accept: false });
  if (id('ship-kick')) return void run({ type: 'ship.kick', shipId: id('ship-kick'), uid: d('ship-kick').dataset.uid });
  if (id('upg')) return void installUpgrade(id('upg'), e.currentTarget);
});

/* ═══ Boutique ═══════════════════════════════════════════════════════════ */
let shopMode = 'buy';
const asks = {};
let sellItem = null, sdrag = null, sJust = false;
const locked = (k) => !!S.sellLock?.[POSID]?.[k];
function askBlock(k) {
  const pct = locked(k) ? 100 : (asks[k] ?? 100), ref = G.refPrice(SHOP, k);
  return { pct, ref, price: Math.round((ref * pct) / 100), ch: G.sellChance(SHOP, pct) };
}
function sellHTML() {
  if (sellItem && !count(sellItem)) sellItem = null;
  let last = -1;
  S.inv.forEach((s, i) => s && (last = i));
  const n = Math.max(6, Math.ceil((last + 1) / 6) * 6);
  const cells = S.inv.slice(0, n).map((s, i) => {
    if (!s) return '<div class="cell empty"></div>';
    const [k, q] = s, it = itemOf(k);
    return `<button class="cell scell ${!it.value ? 'nosell' : ''} ${sellItem === k ? 'on-counter' : ''}" data-sslot="${i}" aria-label="${esc(it.name)}, quantité ${q}${!it.value ? ', invendable' : ''}">${itemIco(k)}${slotEquipped(i) ? '<span class="eq">É</span>' : ''}${q > 1 ? `<span class="qty">${q}</span>` : ''}</button>`;
  }).join('');
  let counter = `<div class="drop-hint">${ico(261)}<b>Glisse un objet ici</b><span>ou clique dessus dans ton inventaire</span></div>`;
  if (sellItem) {
    const k = sellItem, it = itemOf(k), eq = G.freeCount(S, k) < 1, a = askBlock(k);
    counter = `<div class="offer">
      <div class="offer-head"><div class="slot-ico">${itemIco(k)}</div><div><h3>${esc(it.name)}</h3><p class="note">Tu en as ${count(k)}.</p></div><button class="close sm-close" data-unsell aria-label="Reprendre l’objet">×</button></div>
      <div class="ref">Prix de référence <b>${berry(a.ref)}</b></div>
      ${eq ? '<p class="req">Objet équipé : retire-le de ton équipement pour le vendre.</p>'
        : locked(k) ? `<p class="req">${esc(SHOP.seller)} a refusé ton prix : ce sera le prix de référence.</p>`
        : `<input type="range" class="ask-range" min="100" max="${ASK_MAX}" step="5" value="${a.pct}" data-ask="${k}" aria-label="Prix demandé">`}
      <div class="ask-row">
        <span class="price" data-ask-price="${k}">${berry(a.price)}</span>
        <span class="chance ${a.ch >= 70 ? 'ok' : a.ch >= 35 ? 'mid' : 'req'}" data-ask-ch="${k}">${a.pct > 100 ? `+${a.pct - 100} % · ${a.ch} % de chances` : 'Vente assurée'}</span>
      </div>
      <button class="btn" data-sell="${k}" ${eq ? 'disabled' : ''}>Vendre 1</button>
    </div>`;
  }
  return `<div class="sell-grid">
    <section><h3 class="sg-h">Ton inventaire</h3><div class="hold shold">${cells}</div></section>
    <section><h3 class="sg-h">Comptoir</h3><div class="counter-drop ${sellItem ? 'filled' : ''}" id="drop-counter">${counter}</div></section>
  </div>`;
}
function putOnCounter(k) {
  if (!itemOf(k).value) return toast(`${esc(itemOf(k).name)} ne se vend pas`, itemIco(k));
  sellItem = k;
  renderShop();
  replay($('drop-counter'), 'bought');
  const r = $('drop-counter').getBoundingClientRect();
  if (r.top < 0 || r.bottom > innerHeight) $('drop-counter').scrollIntoView({ block: 'center', behavior: calm.matches ? 'auto' : 'smooth' });
}
/* Panneau admin : toutes les boutiques, consultables et modifiables depuis n'importe quel salon */
let adminShops = null; // { channelId: shop }
async function loadAdminShops() {
  try {
    adminShops = (await API.staff('shops')).shops;
  } catch (err) {
    adminShops = {};
    toast(esc(err.message));
  }
  renderAdminShops();
}
/** Écran Boutiques du panneau admin : toutes les boutiques, hors RP. */
let openShopRow = null;
function renderAdminShops() {
  const el = $('v-ashop');
  if (!tools()) return;
  if (!adminShops) {
    el.innerHTML = '<p class="note">Chargement des boutiques…</p>';
    return;
  }
  const list = Object.entries(adminShops).sort((a, b) => a[1].channel.localeCompare(b[1].channel));
  el.innerHTML = `
    <div class="sec-head">
      <div><h2>Boutiques</h2><p class="lede" style="margin:0">Une boutique par salon RP : les joueurs la voient quand ils ouvrent <code>/profil</code> dans ce salon.</p></div>
      <button class="btn" id="ashop-new">+ Nouvelle boutique</button>
    </div>
    ${list.length ? `<div class="ashop-list">${list.map(([ch, sh]) => {
      const items = sh.items.filter(([k]) => G.ITEMS[k]);
      const open = openShopRow === ch;
      return `<article class="ashop ${open ? 'open' : ''}">
        <button class="ashop-row" data-ashop-toggle="${esc(ch)}" aria-expanded="${open}">
          <span class="face mini-face">${sh.img ? `<img src="${imgSrc(sh.img)}" alt="">` : `<span aria-hidden="true">${esc(sh.face || '🙂')}</span>`}</span>
          <span class="ashop-main"><b>${esc(sh.name)}</b><small>${esc(sh.seller)} · ${items.length} objet${items.length > 1 ? 's' : ''} · rachat ${Math.round(sh.buyRate * 100)} %</small></span>
          <span class="chan-tag">${esc(sh.channel)}</span>
          <span class="chev" aria-hidden="true">▾</span>
        </button>
        ${open ? `<div class="ashop-body">
          <p class="note">Salon : <b>${esc(sh.channel)}</b></p>
          ${items.length ? `<table class="ashop-items"><thead><tr><th>Objet</th><th>Prix</th><th>Stock</th></tr></thead><tbody>${items.map(([k, price, left]) => `<tr><td>${itemIco(k)} ${esc(itemOf(k).name)}</td><td>${berry(price)}</td><td>${left < 0 ? 'illimité' : left}</td></tr>`).join('')}</tbody></table>` : '<p class="note">Aucun objet en vente.</p>'}
          <div class="ashop-acts">
            <button class="btn sm" data-ashop-edit="${esc(ch)}">Modifier</button>
            <button class="btn sm ghost" data-ashop-dup="${esc(ch)}">Dupliquer</button>
            <button class="btn sm ghost danger-txt" data-ashop-del="${esc(ch)}">Supprimer la boutique</button>
          </div>
        </div>` : ''}
      </article>`;
    }).join('')}</div>` : '<div class="no-shop">' + ico(265) + '<h2>Aucune boutique</h2><p class="note">Crée la première avec « + Nouvelle boutique » : il suffira de choisir son salon.</p></div>'}`;
  paintStatic(el);
}
$('v-ashop').addEventListener('click', async (e) => {

  if (e.target.closest('#ashop-new')) return openShopEdit(G.newShop(), null);
  const t = e.target.closest('[data-ashop-toggle]')?.dataset.ashopToggle;
  if (t) {
    openShopRow = openShopRow === t ? null : t;
    return renderAdminShops();
  }
  const ed = e.target.closest('[data-ashop-edit]')?.dataset.ashopEdit;
  if (ed) return openShopEdit(adminShops[ed], ed);
  // Dupliquer : mêmes objets, prix et vendeur ; il reste à choisir un autre salon
  const dup = e.target.closest('[data-ashop-dup]')?.dataset.ashopDup;
  if (dup) return openShopEdit({ ...structuredClone(adminShops[dup]), name: `${adminShops[dup].name} (copie)`.slice(0, 40) }, null, dup.split('~')[0]);
  const del = e.target.closest('[data-ashop-del]')?.dataset.ashopDel;
  if (del) {
    const sh = adminShops[del];
    if (!(await askConfirm(`La boutique « ${sh.name} » de ${sh.channel} et ses objets en vente seront supprimés. Les objets déjà achetés restent aux joueurs.`, { title: 'Supprimer cette boutique ?', ok: 'Supprimer', danger: true }))) return;
    setBusy(1);
    try {
      const out = await API.staff('shop.delete', { channelId: del });
      if (del === POSID) SHOP = null;
      shopsFor = null;
      openShopRow = null;
      toast(esc(out.toast));
      await loadAdminShops();
    } catch (err) {
      toast(esc(err.message));
    } finally {
      setBusy(-1);
    }
  }
});
/* Plusieurs boutiques par salon : la liste du salon, et le marchand choisi */
let SHOPS = null, shopsFor = null, shopPick = null;
function syncShops() {
  if (!POSID) return;
  if (shopsFor !== POSID) {
    shopsFor = POSID;
    SHOPS = null;
    shopPick = null;
    run({ type: 'shop.list' }).then((out) => {
      if (shopsFor !== POSID) return;
      SHOPS = out?.shops || [];
      renderShop();
    });
  }
  if (SHOPS?.length) {
    if (!SHOPS.some((s) => s.id === shopPick)) shopPick = SHOPS[0].id;
    SHOP = SHOPS.find((s) => s.id === shopPick);
  }
}
const shopTabsHTML = () => (SHOPS?.length > 1 ? `<div class="shop-tabs" role="tablist" aria-label="Marchands">${SHOPS.map((s) => `<button type="button" role="tab" class="shop-tab ${s.id === shopPick ? 'on' : ''}" aria-selected="${s.id === shopPick}" data-shop-pick="${esc(s.id)}"><span class="face mini-face">${s.img ? `<img src="${imgSrc(s.img)}" alt="">` : `<span aria-hidden="true">${esc(s.face || '🙂')}</span>`}</span><span class="st-txt"><b>${esc(s.name)}</b><small>${esc(s.seller)}</small></span></button>`).join('')}</div>` : '');
/** Garde la liste à jour après un achat ou une vente chez le marchand choisi. */
function keepShop(out) {
  if (!out?.shop || !SHOPS || !shopPick) return;
  const i = SHOPS.findIndex((s) => s.id === shopPick);
  if (i >= 0) SHOPS[i] = { ...out.shop, id: shopPick };
}
function renderShop() {
  if (ADMIN) return;
  if (!S) return;
  syncShops();
  const el = $('v-shop');
  if (!POSID) {
    el.innerHTML = `<div class="no-shop">${ico(265)}<h2>Tu n’es nulle part</h2><p class="note">La boutique est celle de l’endroit où tu te trouves : le dernier salon RP où tu as écrit un message RP (400 caractères ou plus).</p></div>`;
    return;
  }
  if (!SHOP) {
    el.innerHTML = `<div class="no-shop">${ico(265)}<h2>Pas de boutique ici</h2><p class="note">Aucun marchand ne tient boutique là où tu te trouves${CHNAME ? ` (#${esc(CHNAME)})` : ''}.</p>
      ${tools() ? '<button class="btn" id="shop-create">Ouvrir une boutique dans ce salon</button>' : ''}</div>`;
    return;
  }
  const rows = shopMode === 'buy'
    ? SHOP.items.filter(([k]) => G.ITEMS[k]).map(([k, price, left]) => {
        const it = itemOf(k), out = left === 0, poor = S.berry < price;
        return `<div class="ware" data-ware="${k}">
          <div class="slot-ico">${itemIco(k)}</div>
          <div>
            <h3>${esc(it.name)} <span class="tag">${KIND[it.kind]}</span></h3>
            <p>${esc(it.desc)}</p>
            <div class="stock">${left < 0 ? 'En stock' : out ? 'Épuisé' : `${left} en stock`}</div>
          </div>
          <div class="buy">
            <span class="price">${berry(price)}</span>
            <button class="btn sm" data-buy="${k}" ${out || poor || VIEW ? 'disabled' : ''}>${out ? 'Épuisé' : poor ? 'Trop cher' : 'Acheter'}</button>
          </div>
        </div>`;
      }).join('')
    : sellHTML();
  el.innerHTML = `${shopTabsHTML()}
    <div class="counter">
      <div class="face" id="seller-face">${SHOP.img ? `<img src="${imgSrc(SHOP.img)}" alt="${esc(SHOP.seller)}">` : `<span aria-hidden="true">${esc(SHOP.face || '🙂')}</span>`}</div>
      <div><h2>${esc(SHOP.name)}</h2><p>${esc(SHOP.seller)}</p></div>
      <span class="wallet" id="wallet">Ta bourse : ${berry(S.berry)}</span>
    </div>
    <div class="shop-bar">
      <span class="chan-tag" title="La boutique dépend du salon où l’Activity est lancée">${esc(SHOP.channel)}</span>
      <div class="seg" role="group" aria-label="Mode">
        <button aria-pressed="${shopMode === 'buy'}" data-mode="buy">Acheter</button>
        <button aria-pressed="${shopMode === 'sell'}" data-mode="sell">Vendre</button>
      </div>
    </div>
    <p class="note">${shopMode === 'buy' ? '' : `Fais glisser un objet de ton inventaire sur le comptoir pour le proposer à ${esc(SHOP.seller)}.`}</p>
    <div class="${shopMode === 'buy' ? 'wares' : ''}" id="shop-list">${rows}</div>`;
}
function walletFx(before, delta) {
  const w = $('wallet');
  if (!w) return;
  const amount = document.createElement('span');
  w.replaceChildren('Ta bourse : ', amount);
  countTo(amount, before, S.berry);
  replay(w, 'bump');
  floatText(w, `${delta > 0 ? '+' : '−'}${berry(Math.abs(delta))}`, delta > 0);
}
$('v-shop').addEventListener('pointerdown', (e) => {
  const c = e.target.closest('.scell');
  if (!c || e.button > 0 || VIEW) return;
  sdrag = { k: S.inv[+c.dataset.sslot][0], x: e.clientX, y: e.clientY, cell: c, on: false };
});
$('v-shop').addEventListener('input', (e) => {
  const k = e.target.dataset?.ask;
  if (!k) return;
  asks[k] = +e.target.value;
  const { pct, price, ch } = askBlock(k);
  document.querySelector(`[data-ask-price="${k}"]`).innerHTML = berry(price);
  const c = document.querySelector(`[data-ask-ch="${k}"]`);
  c.textContent = pct > 100 ? `+${pct - 100} % · ${ch} % de chances` : 'Vente assurée';
  c.className = `chance ${ch >= 70 ? 'ok' : ch >= 35 ? 'mid' : 'req'}`;
});
$('v-shop').addEventListener('click', async (e) => {
  if (sJust) return;
  const pk = e.target.closest('[data-shop-pick]')?.dataset.shopPick;
  if (pk) {
    shopPick = pk;
    sellItem = null;
    return renderShop();
  }
  if (e.target.closest('#shop-create')) return;
  const sc = e.target.closest('.scell');
  if (sc && !VIEW) return putOnCounter(S.inv[+sc.dataset.sslot][0]);
  if (e.target.closest('[data-unsell]')) {
    sellItem = null;
    return renderShop();
  }
  const mode = e.target.closest('[data-mode]')?.dataset.mode;
  if (mode) {
    shopMode = mode;
    renderShop();
    return replay($('shop-list'), 'enter');
  }
  const bk = e.target.closest('[data-buy]')?.dataset.buy;
  if (bk) {
    const before = S.berry;
    const out = await run({ type: 'shop.buy', key: bk, shopId: shopPick || undefined });
    if (!out) return;
    keepShop(out);
    walletFx(before, S.berry - before);
    const btn = document.querySelector(`[data-buy="${bk}"]`);
    if (btn && !btn.disabled) {
      btn.textContent = 'Acheté ✓';
      btn.classList.add('done');
      setTimeout(() => {
        if (btn.isConnected) {
          btn.textContent = 'Acheter';
          btn.classList.remove('done');
        }
      }, 900);
    }
    replay(btn?.closest('.ware'), 'bought');
    return;
  }
  const sk = e.target.closest('[data-sell]')?.dataset.sell;
  if (sk) {
    const before = S.berry;
    const out = await run({ type: 'shop.sell', key: sk, pct: askBlock(sk).pct, shopId: shopPick || undefined });
    if (!out) return;
    delete asks[sk];
    if (out.refused) return replay($('drop-counter'), 'shake');
    walletFx(before, S.berry - before);
  }
});

/* Éditeur de boutique : staff seulement (double-clic ou appui long sur le vendeur) */
let shopDraft = null;
let shopEditCh = null, shopDraftCh = '';
/* Salons RP proposés pour placer une boutique (posts des forums compris) */
let shopChans = null, seChanOther = false;
async function loadShopChans() {
  try {
    shopChans = (await API.staff('shop.channels')).channels;
  } catch {
    shopChans = []; // sans la liste, on garde la saisie d'un ID
  }
  if ($('d-shopedit').open) {
    readShopEdit();
    renderShopEdit();
  }
}
function openShopEdit(base, channelId = null, hint = null) {
  if (!tools() || !base) return;
  shopDraft = structuredClone(base);
  shopEditCh = channelId; // salon d'origine (null = nouvelle boutique)
  // Nouvelle boutique : on propose le salon où le panneau est ouvert, s'il n'a pas déjà de boutique.
  shopDraftCh = channelId ? channelId.split('~')[0] : hint || API.channelId || ''; // plusieurs boutiques par salon
  seChanOther = false;
  renderShopEdit();
  $('se-err').textContent = '';
  openDialog('d-shopedit');
  if (!shopChans) loadShopChans();
}
function renderShopEdit() {
  const d = shopDraft;
  // Menu des salons RP (posts rangés sous leur forum), ou un ID collé à la main
  const inList = (id) => (shopChans || []).some((c) => c.id === id || c.posts.some((p) => p.id === id));
  const other = seChanOther || (shopDraftCh && shopChans && !inList(shopDraftCh)) || (shopChans && !shopChans.length);
  const nShops = (id) => Object.keys(adminShops || {}).filter((k) => k.split('~')[0] === id).length;
  const opt = (id, label) => {
    const n = nShops(id);
    return `<option value="${esc(id)}" ${id === shopDraftCh && !other ? 'selected' : ''}>${esc(label)}${n ? ` (${n} boutique${n > 1 ? 's' : ''})` : ''}</option>`;
  };
  const idInput = `<input id="se-chan" value="${esc(shopDraftCh)}" inputmode="numeric" placeholder="ID du salon (clic droit > Copier l’identifiant)" maxlength="22" style="margin-top:6px">`;
  const chanField = shopChans == null
    ? `<p class="note" style="margin:0">Chargement des salons…</p><input id="se-chan" type="hidden" value="${esc(shopDraftCh)}">`
    : `<select id="se-chan-pick"><option value="" ${!shopDraftCh && !other ? 'selected' : ''}>Choisis un salon…</option>${shopChans.map((c) => (c.kind === 'forum' ? (c.posts.length ? `<optgroup label="🗂️ ${esc(c.name)}">${c.posts.map((p) => opt(p.id, p.name)).join('')}</optgroup>` : '') : opt(c.id, `#${c.name}`))).join('')}<option value="__id" ${other ? 'selected' : ''}>Autre salon (coller son ID)…</option></select>
      ${other ? idInput : `<input id="se-chan" type="hidden" value="${esc(shopDraftCh)}">`}`;
  const opts = (s) => Object.entries(G.ITEMS).map(([k, it]) => `<option value="${k}" ${k === s ? 'selected' : ''}>${esc(it.name)}</option>`).join('');
  $('se-body').innerHTML = `
    <div class="form">
      <div class="wide"><label for="se-chan-pick">Salon</label>${chanField}</div>
      <div><label for="se-name">Nom de la boutique</label><input id="se-name" value="${esc(d.name)}" maxlength="40"></div>
      <div><label for="se-seller">Vendeur</label><input id="se-seller" value="${esc(d.seller)}" maxlength="30"></div>
      <div><label for="se-rate">Rachat (% de la valeur)</label><input id="se-rate" type="number" min="5" max="100" value="${Math.round(d.buyRate * 100)}"></div>
    </div>
    <div class="se-face">
      <div class="face">${d.img ? `<img src="${imgSrc(d.img)}" alt="">` : `<span>${esc(d.face || '🙂')}</span>`}</div>
      <div class="se-face-ctl">
        <b>Portrait du vendeur</b>
        <div class="se-row"><button type="button" class="btn sm" id="se-pick">Choisir une image</button><input type="file" id="se-file" accept="image/*" hidden>
          ${d.img ? '<button type="button" class="btn sm ghost" id="se-noimg">Retirer l’image</button>' : ''}</div>
        <div class="se-row"><label for="se-emoji">ou un emoji</label><input id="se-emoji" value="${esc(d.face || '')}" maxlength="4" style="width:70px"></div>
      </div>
    </div>
    <h3 class="ed-h">Objets en vente</h3>
    <div class="se-items">
      <div class="se-head"><span>Objet</span><span>Prix</span><span>Stock</span><span></span></div>
      ${d.items.map(([k, price, stock], i) => `
        <div class="se-item" data-i="${i}">
          <span class="se-ico">${itemIco(k)}</span>
          <select data-f="k" aria-label="Objet">${opts(k)}</select>
          <input data-f="price" type="number" min="0" value="${price}" aria-label="Prix">
          <span class="se-stock"><input data-f="stock" type="number" min="0" value="${stock < 0 ? '' : stock}" placeholder="∞" ${stock < 0 ? 'disabled' : ''} aria-label="Stock">
            <label class="se-inf"><input type="checkbox" data-f="inf" ${stock < 0 ? 'checked' : ''}>∞</label></span>
          <button type="button" class="close sm-close" data-del="${i}" aria-label="Retirer">×</button>
        </div>`).join('')}
    </div>
    <div class="se-row"><button type="button" class="btn sm ghost" id="se-add">+ Ajouter un objet</button>
</div>`;
}
function readShopEdit() {
  const d = shopDraft;
  const pick = $('se-chan-pick')?.value;
  const raw = !pick || pick === '__id' ? $('se-chan').value.trim() : pick;
  shopDraftCh = API.mode === 'demo' ? raw : raw.replace(/\D/g, '');
  d.name = $('se-name').value.trim() || d.name;
  d.seller = $('se-seller').value.trim() || d.seller;
  d.buyRate = Math.min(100, Math.max(5, +$('se-rate').value || 40)) / 100;
  d.face = $('se-emoji').value.trim();
  document.querySelectorAll('#se-body .se-item').forEach((row) => {
    const it = d.items[+row.dataset.i];
    it[0] = row.querySelector('[data-f=k]').value;
    it[1] = Math.max(0, Math.round(+row.querySelector('[data-f=price]').value || 0));
    it[2] = row.querySelector('[data-f=inf]').checked ? -1 : Math.max(0, Math.round(+row.querySelector('[data-f=stock]').value || 0));
  });
}
$('d-shopedit').addEventListener('click', async (e) => {
  if (e.target.id === 'se-add') {
    readShopEdit();
    const first = Object.keys(G.ITEMS).find((k) => !shopDraft.items.some((x) => x[0] === k));
    if (!first) return void ($('se-err').textContent = Object.keys(G.ITEMS).length ? 'Tous les objets sont déjà en vente.' : 'Crée d’abord des objets dans Gestion.');
    shopDraft.items.push([first, G.ITEMS[first].value || 100, -1]);
    renderShopEdit();
    $('se-body').querySelector('.se-item:last-child select')?.focus();
  }
  const del = e.target.closest('[data-del]');
  if (del) {
    readShopEdit();
    shopDraft.items.splice(+del.dataset.del, 1);
    renderShopEdit();
  }
  if (e.target.id === 'se-pick') $('se-file').click();
  if (e.target.id === 'se-noimg') {
    readShopEdit();
    shopDraft.img = null;
    renderShopEdit();
  }

});
$('d-shopedit').addEventListener('change', async (e) => {
  if (e.target.id === 'se-chan-pick') {
    readShopEdit();
    seChanOther = e.target.value === '__id';
    return renderShopEdit();
  }
  if (e.target.dataset?.f === 'inf') {
    const s = e.target.closest('.se-stock').querySelector('[data-f=stock]');
    s.disabled = e.target.checked;
    if (!e.target.checked && !s.value) s.value = 5;
  }
  if (e.target.dataset?.f === 'k') {
    readShopEdit();
    renderShopEdit();
  }
  if (e.target.id === 'se-file') {
    const f = e.target.files[0];
    if (!f || !f.type.startsWith('image/')) return;
    const img = new Image();
    img.onload = () => {
      const W = 160, H = 205, c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      const s = Math.max(W / img.width, H / img.height), w = img.width * s, h = img.height * s;
      c.getContext('2d').drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
      readShopEdit();
      shopDraft.img = c.toDataURL('image/jpeg', 0.85);
      renderShopEdit();
    };
    img.src = await readAsDataUrl(f);
  }
});
$('se-save').addEventListener('click', async () => {
  readShopEdit();
  const keys = shopDraft.items.map((x) => x[0]);
  if (new Set(keys).size !== keys.length) return void ($('se-err').textContent = 'Un même objet apparaît deux fois.');
  if (API.mode === 'demo' ? !shopDraftCh : !/^\d{15,22}$/.test(shopDraftCh)) return void ($('se-err').textContent = 'Colle l’ID du salon (une suite de chiffres).');
  $('se-save').disabled = true;
  try {
    const out = await API.staff('shop.save', { channelId: shopDraftCh, from: shopEditCh, shop: shopDraft });
    if (out.channelId === POSID) SHOP = out.shop;
    else if (shopEditCh === POSID) SHOP = null;
    shopsFor = null; // la boutique du salon est rechargée
    openShopRow = out.channelId;
    closeDialog($('d-shopedit'));
    await loadAdminShops();
    toast(esc(out.toast));
  } catch (err) {
    $('se-err').textContent = err.message;
  } finally {
    $('se-save').disabled = false;
  }
});


/** Auvent : dessiné à la largeur exacte, festons tangents. */
function drawAwning() {
  const el = document.querySelector('.awning');
  const W = Math.round(el?.clientWidth || 0);
  if (!W) return;
  const sw = 3, H = 50, R = 9, x0 = sw / 2, Wi = W - sw;
  const n = Math.max(6, Math.round(Wi / 46) & ~1 || 6), w = Wi / n, r = w / 2;
  let fills = '', arcs = `M${x0 + Wi} ${H}`;
  for (let i = 0; i < n; i++) {
    const x = x0 + i * w;
    fills += `<path d="M${x} 0 H${x + w} V${H} A${r} ${r} 0 0 1 ${x} ${H} Z" fill="${i % 2 ? '#fff3e0' : 'var(--red)'}"/>`;
  }
  for (let i = n - 1; i >= 0; i--) arcs += ` A${r} ${r} 0 0 1 ${x0 + i * w} ${H}`;
  const total = H + r + sw;
  el.innerHTML = `<svg width="${W}" height="${total}" viewBox="0 0 ${W} ${total}" aria-hidden="true">
    <defs><clipPath id="aw-clip"><path d="M0 ${R} Q0 0 ${R} 0 H${W - R} Q${W} 0 ${W} ${R} V${total} H0Z"/></clipPath></defs>
    <g clip-path="url(#aw-clip)">${fills}</g>
    <path d="M${sw / 2} ${H} V${R} Q${sw / 2} ${sw / 2} ${R} ${sw / 2} H${W - R} Q${W - sw / 2} ${sw / 2} ${W - sw / 2} ${R} V${H}" fill="none" stroke="#17255e" stroke-width="${sw}"/>
    <path d="${arcs}" fill="none" stroke="#17255e" stroke-width="${sw}" stroke-linejoin="round"/>
  </svg>`;
}
new ResizeObserver(drawAwning).observe(document.querySelector('.stall'));

/* ═══ Édition de la fiche (staff) ════════════════════════════════════════ */
const FIELDS = () => [
  ['name', 'Nom (prénom et nom)', 'text'], ['epithet', 'Surnom', 'text'],
  ['faction', 'Faction', 'select', G.FACTIONS],
  ['crew', 'Équipage', 'text', null, 'nomarine'], ['crewRole', 'Rôle', 'text'],
  ['grade', 'Grade Marine', 'select', G.GRADES, 'marine'],
  ['race', 'Race', 'select', G.RACES], ['classe', 'Classe', 'select', G.CLASSES],
  ['job', 'Métier', 'select', ['', ...Object.keys(JOBS)], null, { '': { name: 'Aucun métier' }, ...JOBS }],
  ['bounty', 'Prime (berrys)', 'number', null, 'nomarine'],
  ['fruitName', 'Fruit du démon (vide = aucun)', 'text'], ['fruitType', 'Type de fruit', 'select', G.FRUIT_TYPES],
];
const fieldVal = (k) => (k === 'job' ? S.job.id ?? '' : k === 'fruitName' ? S.fruit?.name ?? '' : k === 'fruitType' ? S.fruit?.type ?? 'Paramecia' : S.id[k]);
function openEdit() {
  if (!ME.staff) return;
  $('edit-fields').innerHTML = FIELDS().map(([k, label, type, opts, show, labels]) => {
    const id = `f-${k}`, v = fieldVal(k);
    const control = type === 'select'
      ? `<select id="${id}" name="${k}">${opts.map((o) => `<option value="${o}" ${o === v ? 'selected' : ''}>${labels ? labels[o].name : o}</option>`).join('')}</select>`
      : `<input id="${id}" name="${k}" type="${type}" value="${esc(v)}" ${type === 'number' ? 'min="0" inputmode="numeric"' : `maxlength="${k === 'name' ? 60 : 40}"`}>`;
    return `<div data-show="${show || ''}" class="${k === 'name' ? 'wide' : ''}"><label for="${id}">${label}</label>${control}</div>`;
  }).join('');
  syncEditFields();
  const picker = (name, label, v, glyphHTML, zero) => `
    <div class="pick-row">
      <span class="pick-l">${glyphHTML}${label}</span>
      <div class="pick" data-name="${name}" role="radiogroup" aria-label="${label}">
        ${[1, 2, 3, 4, 5].map((n) => `<button type="button" role="radio" aria-checked="${n === v}" aria-label="${n} étoile${n > 1 ? 's' : ''}" data-v="${n}">${ico(n <= v ? 125 : 126)}</button>`).join('')}
        <button type="button" class="pick-zero" data-v="0" aria-checked="${v === 0}" aria-label="${zero}">${zero}</button>
      </div>
      <input type="hidden" name="${name}" value="${v}">
    </div>`;
  const num = (k, label, v, min, max) => `<div><label for="f-${k}">${label}</label><input id="f-${k}" name="${k}" type="number" min="${min}" max="${max}" value="${v}" inputmode="numeric"></div>`;
  $('edit-extra').innerHTML = `
    <h3 class="ed-h">Volonté et compétences</h3>
    ${picker('vol', 'Volonté', S.volonte, icon('volonte'), '0')}
    ${HAKI.map((h) => picker(`haki_${h.key}`, h.name, S.haki[h.key] ?? 0, icon(`haki-${h.key}`), h.key === 'rois' ? 'Non éveillé' : 'Non débloqué')).join('')}
    ${picker('fruitStars', 'Maîtrise du fruit', S.fruit?.stars ?? 0, icon('fruit'), '0')}
    <h3 class="ed-h">Progression</h3>
    <div class="form">
      ${num('level', 'Niveau', S.level, 1, 999)}
      ${num('xp', 'Expérience', S.xp, 0, 99999)}
      ${num('berry', 'Berrys', S.berry, 0, 99999999999)}
      ${num('statPts', 'Points de stats', S.statPts, 0, 999)}
      ${STATS.map((s) => num(`st_${s.key}`, s.name, S.stats[s.key], 0, STAT_MAX)).join('')}
      <div ${JOBS[S.job.id]?.noLevel ? 'hidden' : ''}><label for="f-jobLvl">Niveau de métier</label><select id="f-jobLvl" name="jobLvl">${JOB_LEVELS.map((l, i) => `<option value="${i + 1}" ${S.job.lvl === i + 1 ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    </div>`;
  $('edit-err').textContent = '';
  openDialog('d-edit');
}
$('edit-extra').addEventListener('click', (e) => {
  const b = e.target.closest('.pick button');
  if (!b) return;
  const pk = b.closest('.pick'), v = +b.dataset.v;
  pk.parentElement.querySelector('input[type=hidden]').value = v;
  pk.querySelectorAll('button[data-v]').forEach((x) => {
    const n = +x.dataset.v;
    x.setAttribute('aria-checked', n === v);
    if (n) x.innerHTML = ico(n <= v ? 125 : 126);
  });
  replay(b, 'bump');
});
function syncEditFields() {
  const marine = $('f-faction').value === 'Marine';
  $('edit-fields').querySelectorAll('[data-show]').forEach((el) => {
    el.hidden = (el.dataset.show === 'marine' && !marine) || (el.dataset.show === 'nomarine' && marine);
  });
}
$('edit-fields').addEventListener('change', (e) => e.target.id === 'f-faction' && syncEditFields());
$('open-edit').addEventListener('click', openEdit);
$('edit-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const d = Object.fromEntries(new FormData(e.target));
  if (!d.name.trim()) {
    $('edit-err').textContent = 'Indique un nom.';
    return $('f-name').focus();
  }
  const patch = {
    id: { name: d.name, epithet: d.epithet, faction: d.faction, crewRole: d.crewRole, race: d.race, classe: d.classe,
      ...(d.crew != null && { crew: d.crew }), ...(d.grade != null && { grade: d.grade }), ...(d.bounty != null && { bounty: +d.bounty }) },
    job: d.job || null, jobLvl: +d.jobLvl, volonte: +d.vol,
    fruit: d.fruitName.trim() ? { name: d.fruitName.trim(), type: d.fruitType, stars: +d.fruitStars } : null,
    haki: Object.fromEntries(HAKI.map((h) => [h.key, +d[`haki_${h.key}`]])),
    level: +d.level, xp: +d.xp, berry: +d.berry, statPts: +d.statPts,
    stats: Object.fromEntries(STATS.map((s) => [s.key, +d[`st_${s.key}`]])),
  };
  const out = await staffAct({ type: 'edit', patch });
  if (out) {
    pending = {};
    closeDialog($('d-edit'));
    replay($('h-name'), 'stamp-in');
  }
});

/* Outils de progression (XP, niveaux, berrys), communs à l'onglet Édition MJ et aux actions de groupe */
const itemOptions = () => Object.entries(G.ITEMS).sort((a, b) => a[1].name.localeCompare(b[1].name)).map(([k, it]) => `<option value="${esc(k)}">${esc(it.name)}</option>`).join('') || '<option value="">Aucun objet (crée-en dans Gestion)</option>';
function progressionTools(px) {
  const row = (key, label, unit, extra = '') => `
    <div class="mj-row prog-row">
      <label for="${px}-${key}">${label}</label>
      <input id="${px}-${key}" type="number" min="1" value="" placeholder="${unit}" inputmode="numeric">
      <button class="btn sm" data-prog="${key}" data-sign="1">Ajouter</button>
      <button class="btn sm ghost" data-prog="${key}" data-sign="-1">Retirer</button>
      ${extra}
    </div>`;
  return row('xp', 'Expérience', 'ex. 750')
    + row('levels', 'Niveaux', 'ex. 2', `<label class="chk"><input type="checkbox" id="${px}-points" checked> avec les points de stats</label>`)
    + row('berry', 'Berrys', 'ex. 50000');
}
/** Lit une ligne de progression cliquée ; renvoie l'action à appliquer ou null. */
function readProgression(e, px) {
  const b = e.target.closest('[data-prog]');
  if (!b) return null;
  const key = b.dataset.prog, input = $(`${px}-${key}`);
  const n = Math.round(Math.abs(Number(String(input.value).replace(/[\s.]/g, ''))));
  if (!n) {
    input.focus();
    toast('Indique une quantité.');
    return null;
  }
  const action = { type: key, amount: n * Number(b.dataset.sign) };
  if (key === 'levels') action.points = $(`${px}-points`).checked;
  return action;
}

/* ═══ Onglet Édition MJ (staff) ═══════════════════════════════════════════ */
function renderMjTab() {
  const tab = $('t-mj');
  const show = tools() && VIEW;
  tab.hidden = !show;
  if (!show) {
    if (tab.getAttribute('aria-selected') === 'true') selectTab(tabs[0]);
    return;
  }
  const wait = S.techniques.filter((t) => !t.ok && !t.refused);
  const job = S.job.id ? JOBS[S.job.id] : null;
  $('v-mj').innerHTML = `
    <div class="sec-head">
      <div><h2>Édition MJ</h2><p class="lede" style="margin:0">Fiche de <b>${esc(fullName())}</b>. Les modifications s’appliquent tout de suite.</p></div>
      <button class="btn" id="mj-edit-open">Modifier la fiche</button>
    </div>
    <div class="mj-summary">
      <span><small>Niveau</small><b>${S.level}</b></span>
      <span><small>Berrys</small><b>${berry(S.berry)}</b></span>
      <span><small>Points à répartir</small><b>${S.statPts}</b></span>
      <span><small>Métier</small><b>${job ? `${esc(job.name)}${job.noLevel ? '' : ` · ${JOB_LEVELS[S.job.lvl - 1]}`}` : 'Aucun'}</b></span>
      <span><small>Volonté</small>${stars(S.volonte)}</span>
    </div>

    <h3 class="ed-h">Techniques à valider ${wait.length ? `<span class="pill">${wait.length}</span>` : ''}</h3>
    ${wait.length ? `<div class="val-list">${wait.map((t) => `
      <article class="val-card">
        ${t.media ? `<div class="val-media"><img src="${imgSrc(t.media)}" alt="Illustration de ${esc(t.name)}" loading="lazy" onerror="this.parentElement.remove()"></div>` : ''}
        <div class="val-body">
          <h3>${esc(t.name)} <span class="tag ${SRC_CLS[t.src]}">${G.TECH_SOURCES[t.src]}</span></h3>
          <p>${esc(t.desc) || '<em>Pas de description.</em>'}</p>
          <div class="val-acts"><button class="btn sm" data-ok-tech="${t.id}">✓ Valider</button><button class="btn sm ghost" data-no-tech="${t.id}">✗ Refuser</button></div>
        </div>
      </article>`).join('')}</div>` : '<p class="note">Aucune technique en attente.</p>'}

    <h3 class="ed-h">Progression</h3>
    <div class="mj-tools">
      ${progressionTools('mjt')}
    </div>
    ${healthToolsHTML()}
    <h3 class="ed-h">Îles découvertes</h3>
    <div class="mj-tools">${discoveredHTML()}</div>
    <h3 class="ed-h">Objets</h3>
    <div class="mj-tools">
      <div class="mj-row">
        <select id="mjt-item" aria-label="Objet">${itemOptions()}</select>
        <input id="mjt-qty" type="number" min="1" value="1" style="width:76px" aria-label="Quantité">
        <button class="btn sm" data-mjt-give="give">Donner</button><button class="btn sm ghost" data-mjt-give="take">Retirer</button>
      </div>
    </div>
    <p class="note" style="margin-top:14px"><button class="linklike" id="mj-pick">← Liste des joueurs</button></p>`;
}
$('v-mj').addEventListener('click', async (e) => {
    const hdel = e.target.closest('[data-health-del]')?.dataset.healthDel;
  if (hdel) return void staffAct({ type: 'health.remove', id: hdel });
  if (e.target.closest('#mjh-add')) {
    const label = $('mjh-label').value.trim();
    if (!label) return toast('Décris la blessure ou la maladie.');
    return void staffAct({ type: 'health.add', kind: $('mjh-type').value, level: +$('mjh-level').value, label, desc: $('mjh-desc').value.trim() });
  }
  if (e.target.closest('#mjh-clear')) {
    if (await askConfirm('Toutes ses blessures et maladies seront retirées.', { title: 'Tout guérir ?', ok: 'Tout guérir' })) staffAct({ type: 'health.clear' });
    return;
  }
  if (e.target.closest('#mj-edit-open')) return openEdit();
  if (e.target.closest('#mj-pick')) return showScreen('admin');
  const ok = e.target.closest('[data-ok-tech]')?.dataset.okTech;
  if (ok) return void staffAct({ type: 'tech.validate', id: Number(ok), ok: true });
  const no = e.target.closest('[data-no-tech]')?.dataset.noTech;
  if (no) {
    const reason = await askRefuseReason();
    if (reason) staffAct({ type: 'tech.validate', id: Number(no), ok: false, reason });
    return;
  }
  const give = e.target.closest('[data-mjt-give]')?.dataset.mjtGive;
  if (give) return void staffAct({ type: give, key: $('mjt-item').value, qty: +$('mjt-qty').value || 1 });
  const act = readProgression(e, 'mjt');
  if (act) staffAct(act);
});

/* ═══ Mode MJ : ouvrir la fiche d'un joueur ══════════════════════════════ */
async function renderMJ() {
  const viewing = VIEW ? S : null;
  $('mj-body').innerHTML = `
    ${viewing ? `<div class="mj-block"><h3>Fiche ouverte : ${esc(fullName())}</h3>
      <div class="mj-row"><button class="btn sm" data-mj-xp="100">+100 XP</button><button class="btn sm" data-mj-xp="500">+500 XP</button></div>
      <div class="mj-row"><select id="mj-item">${Object.entries(G.ITEMS).map(([k, it]) => `<option value="${k}">${esc(it.name)}</option>`).join('')}</select>
        <input id="mj-qty" type="number" min="1" value="1" style="width:70px" aria-label="Quantité">
        <button class="btn sm" data-mj-give="give">Donner</button><button class="btn sm ghost" data-mj-give="take">Retirer</button></div>
      <p class="note" style="margin:8px 0 0">Le reste (identité, Haki, stats, berrys…) se modifie avec « Modifier » sur la fiche. Les techniques se valident dans l’onglet Techniques.</p>
    </div>` : ''}
    <input class="mj-search" id="mj-search" type="search" placeholder="Chercher un joueur…" aria-label="Chercher un joueur">
    <div class="mj-players" id="mj-players"><p class="note">Chargement…</p></div>`;
  try {
    players = (await API.staff('players')).players;
  } catch (err) {
    players = [];
    $('mj-players').innerHTML = `<p class="req">${esc(err.message)}</p>`;
    return;
  }
  renderPlayers('');
}
function renderPlayers(q) {
  const norm = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const list = players.filter((p) => !q || norm(`${G.fullName({ id: p.ident })} ${p.ident.epithet || ''}`).includes(norm(q)));
  $('mj-players').innerHTML = list.map((p) => `
    <button class="mj-player" data-open="${esc(p.uid)}">
      <span class="av">${photoHTML({ photo: p.photo, id: p.ident })}</span>
      <span><b>${esc(G.fullName({ id: p.ident }))}</b><small>${esc(p.ident.faction || '')} · niveau ${p.level ?? 1}${p.uid === ME.uid ? ' · toi' : ''}</small></span>
      <span class="note">Ouvrir</span>
    </button>`).join('') || '<p class="note">Aucun joueur trouvé.</p>';
}
$('mj-body').addEventListener('input', (e) => e.target.id === 'mj-search' && renderPlayers(e.target.value));
$('mj-body').addEventListener('click', async (e) => {
  const open = e.target.closest('[data-open]')?.dataset.open;
  if (open) {
    closeDialog($('d-mj'));
    return openPlayer(open);
  }
  const xp = e.target.closest('[data-mj-xp]')?.dataset.mjXp;
  if (xp) return void staffAct({ type: 'xp', amount: +xp });
  const give = e.target.closest('[data-mj-give]')?.dataset.mjGive;
  if (give) return void staffAct({ type: give, key: $('mj-item').value, qty: +$('mj-qty').value || 1 });
});
$('open-mj').addEventListener('click', () => (ADMIN ? location.reload() : enterAdmin()));

async function openPlayer(uid, { tab = null } = {}) {
  if (!ADMIN) return;
  setBusy(1);
  try {
    const st = await API.state(uid === ME.uid ? undefined : uid);
    G.setCatalog(st.catalog);
    if (!st.player) return toast('Tu n’as pas de fiche.');
    VIEW = uid;
    S = st.player;
    CREW = st.crew;
    SHIPS = st.ships || [];
    pending = {};
    sel = null;
    shown.photo = null;
    document.body.classList.add('readonly');
    updateNav();
    showScreen('fiche');
    renderAll();
    selectTab($(tab || 't-perso'));
  } catch (err) {
    toast(esc(err.message));
  } finally {
    setBusy(-1);
  }
}
function closePlayer() {
  VIEW = null;
  S = null;
  updateNav();
  showScreen('admin');
  renderAll();
  loadPlayers(); // les niveaux ou noms ont pu changer
}
$('mj-banner').addEventListener('click', (e) => e.target.id === 'mj-back' && closePlayer());

/* ═══ Panneau admin (/panel admin, /edit profil) ═════════════════════════ */
/** Boutons d'écran : vue joueur (fiche, boutique, navigation) ou panneau admin. */
/** Premier écran du panneau admin que ce membre du staff a le droit de voir. */
function firstStaffScreen() {
  return scrBtns.find((b) => !b.hidden && b.dataset.screen !== 'fiche')?.dataset.screen || 'admin';
}
function updateNav() {
  const vis = {
    fiche: !ADMIN || !!VIEW, shop: !ADMIN, crew: !ADMIN, nav: !ADMIN, map: !ADMIN,
    admin: ADMIN && staffCan('joueurs'), atech: tools() && staffCan('techniques'), ashop: tools() && staffCan('boutiques'),
    amap: tools() && staffCan('carte'), marine: tools() && (staffCan('marine') || staffCan('joueurs')),
    fleet: tools() && staffCan('equipages'), ships: tools() && staffCan('equipages'), gest: tools() && staffCan('gestion'),
    aloot: tools() && staffCan('butins'), aicons: tools() && ME?.uid === G.ICONS_OWNER, aperms: tools() && staffCan('permissions'), agames: tools(), ainv: tools() && staffCan('inventions'), afeat: tools() && staffCan('permissions'), acalc: tools() && staffCan('carte'), asea: tools() && staffCan('carte'), acook: tools() && staffCan('cuisine') && nouveautes(), ajour: tools() && staffCan('joueurs'),
  };
  scrBtns.forEach((b) => (b.hidden = !vis[b.dataset.screen]));
  document.querySelector('.scr[data-screen="fiche"] span:last-child').textContent = ADMIN ? 'Fiche ouverte' : 'Ma fiche';
  document.body.classList.toggle('admin', ADMIN);
  $('mj-banner').hidden = !ADMIN;
  $('mj-banner').innerHTML = !ADMIN ? ''
    : VIEW ? `<span>Panneau admin : fiche de <b>${esc(fullName())}</b>${VIEW === ME.uid ? ' (ta fiche)' : ''}</span><button class="btn sm" id="mj-back">← Liste des joueurs</button>`
    : '<span>Panneau admin</span>';
  document.querySelector('.wallet-chips').hidden = ADMIN && !VIEW;
}
let players = [];
const filters = { q: '', faction: '', race: '', classe: '', job: '', grade: '', min: '', max: '' };
const picked = new Set();
const normTxt = (t) => String(t ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
function filteredPlayers() {
  const f = filters, q = normTxt(f.q);
  return players.filter((p) => {
    const id = p.ident;
    if (q && !normTxt(`${G.fullName({ id })} ${id.epithet || ''} ${id.crew || ''}`).includes(q)) return false;
    if (f.faction && id.faction !== f.faction) return false;
    if (f.race && id.race !== f.race) return false;
    if (f.classe && id.classe !== f.classe) return false;
    if (f.grade && !(id.faction === 'Marine' && id.grade === f.grade)) return false;
    if (f.job && (f.job === 'aucun' ? p.job : p.job !== f.job)) return false;
    if (f.min && (p.level ?? 1) < +f.min) return false;
    if (f.max && (p.level ?? 1) > +f.max) return false;
    return true;
  });
}
function renderAdminHome() {
  if (!ADMIN) return;
  const sel = (key, label, list, labels) => `<label class="flt"><span>${label}</span><select data-flt="${key}"><option value="">Tous</option>${list.map((v) => `<option value="${esc(v)}" ${filters[key] === v ? 'selected' : ''}>${esc(labels ? labels[v] : v)}</option>`).join('')}</select></label>`;
  $('v-admin').innerHTML = `
    <div class="sec-head"><div><h2>Joueurs</h2><p class="lede" style="margin:0">Clique sur un joueur pour ouvrir sa fiche, ou coche-en plusieurs pour agir sur tout le groupe.</p></div></div>
    <div class="filters">
      <label class="flt flt-q"><span>Recherche</span><input data-flt="q" type="search" placeholder="Nom, surnom, équipage…" value="${esc(filters.q)}"></label>
      ${sel('faction', 'Faction', G.FACTIONS)}
      ${sel('grade', 'Grade', G.GRADES)}
      ${sel('race', 'Race', G.RACES)}
      ${sel('classe', 'Classe', G.CLASSES)}
      ${sel('job', 'Métier', [...Object.keys(JOBS), 'aucun'], { ...Object.fromEntries(Object.entries(JOBS).map(([k, j]) => [k, j.name])), aucun: 'Aucun' })}
      <label class="flt flt-n"><span>Niveau min</span><input data-flt="min" type="number" min="1" value="${esc(filters.min)}"></label>
      <label class="flt flt-n"><span>Niveau max</span><input data-flt="max" type="number" min="1" value="${esc(filters.max)}"></label>
      <button class="linklike" id="flt-reset">Effacer les filtres</button>
    </div>
    <div class="bulk" id="bulk"></div>
    <div class="mj-players adm-players" id="mj-players"><p class="note">Chargement…</p></div>
    <p class="note" style="margin-top:12px">Pour enregistrer un nouveau joueur : <code>/register</code> sur Discord.</p>`;
  renderPlayerList();
}
function renderPlayerList() {
  const list = filteredPlayers();
  const all = list.length && list.every((p) => picked.has(p.uid));
  $('mj-players').innerHTML = !players.length ? '<p class="note">Aucune fiche pour l’instant.</p>' : `
    <label class="pick-all"><input type="checkbox" id="pick-all" ${all ? 'checked' : ''} ${list.length ? '' : 'disabled'}> Sélectionner les ${list.length} résultat${list.length > 1 ? 's' : ''}</label>
    ${list.map((p) => `
      <div class="mj-player ${picked.has(p.uid) ? 'picked' : ''}">
        <input type="checkbox" class="pick-one" data-pick="${esc(p.uid)}" ${picked.has(p.uid) ? 'checked' : ''} aria-label="Sélectionner ${esc(G.fullName({ id: p.ident }))}">
        <button class="mj-player-open" data-open="${esc(p.uid)}">
          <span class="av">${photoHTML({ photo: p.photo, id: p.ident })}</span>
          <span><b>${esc(G.fullName({ id: p.ident }))}</b><small>${[p.ident.faction === 'Marine' ? p.ident.grade : p.ident.faction, p.ident.race, p.ident.classe, p.job ? JOBS[p.job]?.name : null, `niveau ${p.level ?? 1}`].filter(Boolean).map(esc).join(' · ')}${p.uid === ME.uid ? ' · toi' : ''}</small></span>
        </button>
      </div>`).join('') || '<p class="note">Aucun joueur ne correspond à ces filtres.</p>'}`;
  renderBulk();
}
function renderBulk() {
  const n = picked.size;
  $('bulk').hidden = !n;
  if (!n) return;
  $('bulk').innerHTML = `
    <div class="bulk-head"><b>${n} joueur${n > 1 ? 's' : ''} sélectionné${n > 1 ? 's' : ''}</b><button class="linklike" id="pick-none">Tout désélectionner</button></div>
    ${progressionTools('blk')}
    <div class="mj-row prog-row">
      <label for="blk-item">Objet</label>
      <select id="blk-item">${itemOptions()}</select>
      <input id="blk-qty" type="number" min="1" value="1" style="width:76px" aria-label="Quantité">
      <button class="btn sm" data-blk-give="give">Donner</button><button class="btn sm ghost" data-blk-give="take">Retirer</button>
    </div>
    <div class="mj-row prog-row health-row">
      <label for="blk-hlabel">Santé</label>
      <select id="blk-htype" aria-label="Catégorie">${Object.entries(G.injuryTypes()).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
      <select id="blk-hlevel" aria-label="Gravité">${G.HEALTH_LEVELS.map((l, i) => `<option value="${i + 1}">${l}</option>`).join('')}</select>
      <input id="blk-hlabel" maxlength="80" placeholder="Ex. Brûlures, Scorbut…">
      <button class="btn sm" id="blk-health">Ajouter à tous</button>
    </div>`;
}
async function loadPlayers() {
  try {
    players = (await API.staff('players')).players;
  } catch (err) {
    $('mj-players').innerHTML = `<p class="req">${esc(err.message)}</p>`;
    return;
  }
  for (const uid of [...picked]) if (!players.some((p) => p.uid === uid)) picked.delete(uid);
  renderPlayerList();
  if (screen === 'marine') renderMarine();
}
const describe = (a) => a.type === 'health.add' ? `ajouter « ${a.label} » (${G.injuryName(a.kind).toLowerCase()} ${G.HEALTH_LEVELS[a.level - 1].toLowerCase()})` :
  a.type === 'give' || a.type === 'take'
    ? `${a.type === 'give' ? 'donner' : 'retirer'} ${a.qty} × ${itemOf(a.key).name}`
    : `${a.amount > 0 ? 'ajouter' : 'retirer'} ${fmt(Math.abs(a.amount))} ${a.type === 'xp' ? 'XP' : a.type === 'levels' ? `niveau${Math.abs(a.amount) > 1 ? 'x' : ''}` : 'berrys'}`;
async function bulk(action) {
  const n = picked.size;
  const txt = describe(action);
  if (!(await askConfirm(`${txt[0].toUpperCase()}${txt.slice(1)} à ${n} joueur${n > 1 ? 's' : ''}.`, { title: 'Action en groupe', ok: 'Appliquer' }))) return;
  setBusy(1);
  try {
    const out = await API.staff('bulk', { targets: [...picked], action });
    toast(esc(out.toast));
    if (out.failed?.length) console.warn('Échecs :', out.failed);
    await loadPlayers();
  } catch (err) {
    toast(esc(err.message));
  } finally {
    setBusy(-1);
  }
}
$('v-admin').addEventListener('input', (e) => {
  const key = e.target.dataset?.flt;
  if (!key) return;
  filters[key] = e.target.value;
  renderPlayerList();
});
$('v-admin').addEventListener('change', (e) => {
  if (e.target.id === 'pick-all') {
    filteredPlayers().forEach((p) => (e.target.checked ? picked.add(p.uid) : picked.delete(p.uid)));
    return renderPlayerList();
  }
  const uid = e.target.dataset?.pick;
  if (uid) {
    e.target.checked ? picked.add(uid) : picked.delete(uid);
    renderPlayerList();
  }
});
$('v-admin').addEventListener('click', (e) => {
  if (e.target.id === 'flt-reset') {
    Object.keys(filters).forEach((k) => (filters[k] = ''));
    return renderAdminHome();
  }
  if (e.target.id === 'pick-none') {
    picked.clear();
    return renderPlayerList();
  }
  const open = e.target.closest('[data-open]')?.dataset.open;
  if (open) return void openPlayer(open, { tab: 't-mj' });
    if (e.target.closest('#blk-health')) {
    const label = $('blk-hlabel').value.trim();
    if (!label) return toast('Décris la blessure ou la maladie.');
    return void bulk({ type: 'health.add', kind: $('blk-htype').value, level: +$('blk-hlevel').value, label });
  }
  const give = e.target.closest('[data-blk-give]')?.dataset.blkGive;
  if (give) {
    if (!$('blk-item').value) return toast('Crée d’abord des objets dans Gestion.');
    return void bulk({ type: give, key: $('blk-item').value, qty: Math.max(1, +$('blk-qty').value || 1) });
  }
  const act = readProgression(e, 'blk');
  if (act) bulk(act);
});
/** Passe en panneau admin ; option : ouvrir directement la fiche d'un joueur. */
async function enterAdmin({ target = null } = {}) {
  if (!ME?.staff) return;
  ADMIN = true;
  VIEW = null;
  S = null;
  updateNav();
  showScreen(firstStaffScreen());
  renderAll();
  renderAdminHome();
  loadPlayers();
  loadAdminShops();
  loadFleet();
  if (staffCan('techniques')) loadPendingTechs();
  if (staffCan('inventions')) loadPendingInventions();
  if (staffCan('cuisine') && nouveautes()) loadCooks();
  if (target) await openPlayer(target, { tab: 't-mj' });
}

/* ═══ Équipage (vue joueur) ══════════════════════════════════════════════ */
const SHIP_ICON = 231;
let INVITES = []; // invitations reçues
let crewTab = 'crew', crewSearch = '', crewResults = [], searchTimer = null;
const openRanks = new Set(); // grades dépliés, gardés entre deux affichages
let cx = { side: null, key: null, qty: 1 }; // objet sélectionné dans la cale ou l'inventaire
function shipPic(sh) {
  if (sh.photo) return `<img src="${imgSrc(sh.photo)}" alt="${esc(sh.name)}" loading="lazy">`;
  if (sh.icon) return `<img src="${imgSrc(sh.icon)}" alt="" loading="lazy">`;
  return ico(SHIP_ICON);
}
/** Améliorations de bateau dans l'inventaire : [case, objet]. */
const upgradeSlots = () => (S ? S.inv.map((x, i) => [i, x]).filter(([, x]) => x && G.ITEMS[x[0]]?.kind === 'amelioration') : []);
function upgradeControl(sh) {
  return ''; // les améliorations passent désormais par l'atelier du charpentier
  // eslint-disable-next-line no-unreachable
  const ups = upgradeSlots();
  if (!ups.length) return '';
  return `<div class="mj-row upg-row"><select data-upg-sel="${esc(sh.id)}" aria-label="Amélioration à installer">${ups.map(([i, x]) => {
    const u = G.ITEMS[x[0]].upgrade;
    return `<option value="${i}">${esc(G.ITEMS[x[0]].name)} (+${fmt(u.amount)} ${G.UPGRADES[u.type].unit})</option>`;
  }).join('')}</select><button class="btn sm" data-upg="${esc(sh.id)}">Installer</button></div>`;
}
/** Contenu de la cale, en lecture seule (à toi ou à ton équipage) : visible de partout. */
function holdPeekHTML(sh) {
  const list = Object.entries(sh.hold || {});
  return `<details class="hold-peek"><summary>📦 Cale : ${G.kg(G.holdWeight(sh))} / ${G.kg(sh.capacity)} · ${list.length ? `${list.length} sorte${list.length > 1 ? 's' : ''} d’objets` : 'vide'}</summary>
    ${list.length ? `<div class="chest">${list.map(([k, q]) => `<span class="need">${itemIco(k)}${q} × ${esc(itemOf(k).name)}</span>`).join('')}</div>` : ''}
    <p class="note" style="margin:4px 0 0">Monte à bord (écran Navigation) pour déposer ou prendre des objets.</p></details>`;
}
function shipCard(sh, { actions = '', upgrade = false, extra = '' } = {}) {
  const aboard = sh.passengers?.length ?? 0;
  return `<article class="ship-card">
    <div class="ship-pic">${shipPic(sh)}</div>
    <div>
      <h3>${sh.icon && sh.photo ? `<span class="ico item-img"><img src="${imgSrc(sh.icon)}" alt=""></span>` : ''}${esc(sh.name)}</h3>
      ${extra}
      ${shipStatsHTML(sh)}<div class="ship-stats"><span>${esc(sh.type)}</span><span>${esc(G.WOODS[sh.wood]?.name || 'Bois standard')}</span><span>${aboard} / ${sh.berths} à bord</span><span>${sh.sail ? `Voile niv. ${sh.sail}` : 'Voile d’origine'}</span><span>Cale : ${G.kg(G.holdWeight(sh))} / ${G.kg(sh.capacity)}</span>${sh.engine ? `<span>${icon('ship-engine')} Moteur au cola</span>` : ''}${sh.granit ? `<span>${icon('ship-granit')} Granit marin</span>` : ''}${sh.plongee ? `<span>${icon('ship-plongee')} Plongée</span>` : ''}${sh.voyage && sh.voyage.status !== 'vote' ? `<span>🌊 En mer vers ${esc(sh.voyage.toName)} (${sh.voyage.done}/${sh.voyage.needed})</span>` : ''}${sh.position ? `<span>⚓ #${esc(sh.position.name || sh.position.channelId)}</span>` : ''}${sh.channel ? `<span>💬 ${esc(sh.channel.name)}</span>` : ''}</div>
      ${sh.desc ? `<p>${esc(sh.desc)}</p>` : ''}
      ${S && G.isShipFamily(S, sh, CREW) ? holdPeekHTML(sh) : ''}
      ${S && !VIEW && !sh.voyage && G.canManageShip(S, sh, CREW) ? `<div class="mj-row"><button class="btn sm ghost" data-dock="${esc(sh.id)}">⚓ Amarrer ailleurs dans le port</button></div>` : ''}
      ${!sh.position && !sh.voyage && S && G.isShipFamily(S, sh, CREW) ? '<p class="note" style="margin:4px 0">⚓ Pas encore à quai : il s’amarrera là où tu écriras ton prochain message RP (400 caractères ou plus).</p>' : ''}
      ${actions}
      ${upgrade ? upgradeControl(sh) : ''}
    </div>
  </article>`;
}
const can = (perm) => !!CREW && G.crewCan(CREW, S.uid, perm);
const nameOf = (uid) => esc(CREW?.memberNames?.[uid] || '?');
function invitesHTML() {
  if (!INVITES.length) return '';
  return `<section class="crew-box invites"><h3>Invitations reçues</h3>
    ${INVITES.map((i) => `<div class="invite">
      <span class="flag mini-flag">${i.flag ? `<img src="${imgSrc(i.flag)}" alt="">` : ico(1)}</span>
      <span><b>${esc(i.name)}</b><small>${i.members} membre${i.members > 1 ? 's' : ''}${i.byName ? ` · invité par ${esc(i.byName)}` : ''}</small></span>
      <span class="invite-acts"><button class="btn sm" data-join="${esc(i.id)}">Rejoindre</button><button class="btn sm ghost" data-decline="${esc(i.id)}">Refuser</button></span>
    </div>`).join('')}
    ${CREW ? `<p class="note" style="margin:0">En rejoindre un autre te fera quitter ${G.crewWords(CREW).le}.</p>` : ''}
  </section>`;
}
function crewTabHTML() {
  const c = CREW, me = S.uid, isCap = c.captain === me, W = G.crewWords(c);
  const order = (u) => (u === c.captain ? -1 : c.ranks.findIndex((r) => r.id === c.memberRanks[u]));
  const members = [...c.members].sort((a, b) => order(a) - order(b));
  const rankOpts = (uid) => c.ranks.map((r) => `<option value="${esc(r.id)}" ${c.memberRanks[uid] === r.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('');
  return `
    <section class="crew-box">
      <h3>Membres (${c.members.length})</h3>
      <div class="member-list">${members.map((u) => {
        const npc = G.isNpc(u);
        return `
        <div class="member-row">
          <span class="m-name">${u === c.captain ? '👑 ' : ''}<b>${nameOf(u)}</b>${npc ? '<span class="npc-badge">PNJ</span>' : ''}${u === me ? ' <small class="note">(toi)</small>' : ''}</span>
          ${u === c.captain || (npc && c.npcs?.[u]?.grade) ? `<span class="rank-badge ${u === c.captain ? 'cap' : ''}">${esc(G.rankName(c, u))}</span>`
            : can('ranks') && (isCap || u !== me) ? `<select data-rank-of="${esc(u)}" aria-label="Grade de ${nameOf(u)}">${rankOpts(u)}</select>`
            : `<span class="rank-badge">${esc(G.rankName(c, u))}</span>`}
          <span class="m-acts">
            ${isCap && u !== me && !npc ? `<button class="btn sm ghost" data-captain="${esc(u)}" title="Céder ta place de ${W.chef}">Nommer ${W.chef}</button>` : ''}
            ${can('kick') && u !== c.captain && u !== me && !npc ? `<button class="btn sm ghost danger-txt" data-kick="${esc(u)}">Exclure</button>` : ''}
          </span>
        </div>`;
      }).join('')}</div>
    </section>
    ${can('invite') ? `<section class="crew-box">
      <h3>Inviter ${c.kind === 'flotte' ? 'un Marine' : 'un joueur'}</h3>
      <input class="mj-search" id="crew-search" type="search" placeholder="Nom du joueur…" value="${esc(crewSearch)}" autocomplete="off">
      <div class="search-results" id="crew-results">${crewResults.map((x) => `<div class="member-row"><span class="m-name"><b>${esc(x.name)}</b>${x.crew ? ' <small class="note">(a déjà un équipage ou une escouade)</small>' : ''}</span><span></span><span class="m-acts"><button class="btn sm" data-invite="${esc(x.uid)}">Inviter</button></span></div>`).join('') || (crewSearch ? '<p class="note">Aucun joueur trouvé.</p>' : '')}</div>
      ${c.invites.length ? `<b>Invitations en attente</b><div class="member-list">${c.invites.map((i) => `<div class="member-row"><span class="m-name">${nameOf(i.uid)}</span><span class="rank-badge">invité</span><span class="m-acts"><button class="btn sm ghost" data-uninvite="${esc(i.uid)}">Annuler</button></span></div>`).join('')}</div>` : ''}
    </section>` : ''}
    ${isCap ? `<section class="crew-box">
      <h3>Grades</h3>
      <p class="note" style="margin:0">Du plus important au moins important. Clique sur un grade pour régler ses permissions.</p>
      <div class="rank-list">${c.ranks.map((r, i) => {
        const nb = Object.keys(G.permsFor(c)).filter((k) => r.perms[k]).length, who = c.members.filter((u) => u !== c.captain && c.memberRanks[u] === r.id).length;
        return `<details class="rank-edit" data-rank="${esc(r.id)}" ${openRanks.has(r.id) ? 'open' : ''}>
          <summary><span class="rank-order"><button class="sq" data-rank-move="${esc(r.id)}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="Monter">↑</button><button class="sq" data-rank-move="${esc(r.id)}" data-dir="1" ${i === c.ranks.length - 1 ? 'disabled' : ''} aria-label="Descendre">↓</button></span>
            <b>${esc(r.name)}</b><small class="note">${nb} permission${nb > 1 ? 's' : ''} · ${who} membre${who > 1 ? 's' : ''}${r.id === G.DEFAULT_RANK ? ' · grade de base' : ''}</small><span class="chev" aria-hidden="true">▾</span></summary>
          <div class="rank-body">
            <div class="rank-top"><input class="rank-name" value="${esc(r.name)}" maxlength="30" aria-label="Nom du grade"></div>
            <div class="perms">${Object.entries(G.permsFor(c)).map(([k, l]) => `<label><input type="checkbox" data-perm="${k}" ${r.perms[k] ? 'checked' : ''}> ${l}</label>`).join('')}</div>
            <div class="rank-top"><button class="btn sm" data-rank-save="${esc(r.id)}">Enregistrer</button>${r.id !== G.DEFAULT_RANK ? `<button class="btn sm ghost danger-txt" data-rank-del="${esc(r.id)}">Supprimer</button>` : ''}</div>
          </div>
        </details>`;
      }).join('')}</div>
      <details class="rank-edit rank-new" data-rank="" ${openRanks.has('') ? 'open' : ''}>
        <summary><b>+ Nouveau grade</b><span class="chev" aria-hidden="true">▾</span></summary>
        <div class="rank-body">
          <div class="rank-top"><input class="rank-name" placeholder="Nom (ex. Second)" maxlength="30" aria-label="Nom du nouveau grade"></div>
          <div class="perms">${Object.entries(G.permsFor(c)).map(([k, l]) => `<label><input type="checkbox" data-perm="${k}"> ${l}</label>`).join('')}</div>
          <div class="rank-top"><button class="btn sm" data-rank-save="">Créer le grade</button></div>
        </div>
      </details>
    </section>` : ''}
    ${can('edit') ? `<section class="crew-box">
      <h3>Nom et ${c.kind === 'flotte' ? 'emblème' : 'Jolly Roger'}</h3>
      <div class="form"><div class="wide"><label for="crew-name">Nom ${W.de}</label><input id="crew-name" value="${esc(c.name)}" maxlength="60"></div></div>
      <div class="img-field"><div class="prev flag-prev">${c.flag ? `<img src="${imgSrc(c.flag)}" alt="">` : ico(1)}</div>
        <div class="se-face-ctl">
          <div class="se-row"><button type="button" class="btn sm" id="flag-pick">Choisir une image</button><input type="file" id="flag-file" accept="image/*" hidden>${c.flag ? '<button type="button" class="btn sm ghost" id="flag-none">Retirer</button>' : ''}</div>
          <div class="ph-url-row"><input type="url" id="flag-url" placeholder="ou un lien https://…" autocomplete="off"><button type="button" class="btn sm" id="flag-url-go">Utiliser le lien</button></div>
        </div></div>
      <div><button class="btn" id="crew-edit-save">Enregistrer le nom</button></div>
    </section>` : ''}
    <div><button class="btn ghost danger-txt" id="crew-leave">Quitter ${W.le}</button></div>`;
}
/** Onglet « Banque » de l'équipage : la cale est maintenant celle de chaque bateau. */
function bankHTML() {
  const c = CREW, left = Object.keys(c.chest || {}).length;
  return `<section class="crew-box"><h3>Banque commune</h3><div class="bank-amount">${berry(c.bank)}</div>
      <div class="mj-row prog-row"><label for="bank-n">Montant</label><input id="bank-n" type="number" min="1" inputmode="numeric" placeholder="ex. 5000">
        ${can('bankIn') ? '<button class="btn sm" id="bank-in">Déposer</button>' : ''}${can('bankOut') ? '<button class="btn sm ghost" id="bank-out">Retirer</button>' : ''}</div></section>
    <section class="crew-box"><h3>📦 La cale</h3><p class="note" style="margin:0">Chaque bateau a maintenant sa propre cale : monte à bord, puis ouvre l’écran <b>Navigation</b> pour y déposer ou prendre des objets. Leur contenu se consulte de partout dans <b>Équipage > Bateaux</b>.${left ? ` L’ancienne cale ${G.crewWords(c).de} contient encore ${left} sorte${left > 1 ? 's' : ''} d’objets : elle sera transférée dans le bateau attitré dès qu’il y en aura un.` : ''}</p></section>`;
}
function cargoHTML() {
  const c = CREW;
  const ship = c.ship ? SHIPS.find((x) => x.id === c.ship) : null;
  const cap = G.crewCapacity(ship), load = G.chestWeight(c);
  // Côté inventaire : seulement ce qu'on peut déposer (pas les armes équipées).
  const inv = {};
  S.inv.forEach((s) => s && (inv[s[0]] = G.freeCount(S, s[0])));
  for (const k of Object.keys(inv)) if (inv[k] <= 0) delete inv[k];
  const cell = (side, k, q) => `<button class="cell xcell ${cx.side === side && cx.key === k ? 'on' : ''}" data-x-side="${side}" data-x-key="${esc(k)}" title="${esc(itemOf(k).name)}" aria-label="${esc(itemOf(k).name)}, ${q}">${itemIco(k)}${q > 1 ? `<span class="qty">${q}</span>` : ''}</button>`;
  const selQ = cx.key ? (cx.side === 'inv' ? inv[cx.key] : c.chest[cx.key]) || 0 : 0;
  if (cx.key && !selQ) cx = { side: null, key: null, qty: 1 };
  const it = cx.key ? itemOf(cx.key) : null;
  return `
    <section class="crew-box">
      <h3>Banque commune</h3>
      <div class="bank-amount">${berry(c.bank)}</div>
      <div class="mj-row prog-row"><label for="bank-n">Montant</label><input id="bank-n" type="number" min="1" inputmode="numeric" placeholder="ex. 5000">
        ${can('bankIn') ? '<button class="btn sm" id="bank-in">Déposer</button>' : ''}${can('bankOut') ? '<button class="btn sm ghost" id="bank-out">Retirer</button>' : ''}</div>
    </section>
    <section class="crew-box">
      <h3>Cale ${ship ? `du navire « ${esc(ship.name)} »` : '(sans bateau)'}</h3>
      <div class="gauge" aria-label="Chargement de la cale"><i style="width:${Math.min(100, (load / Math.max(cap, 1)) * 100)}%"></i></div>
      <div class="gauge-cap"><span>Chargement</span><span>${G.kg(load)} / ${G.kg(cap)}</span></div>
      <div class="cargo">
        <div class="cargo-side" data-x-drop="inv"><b>Ton inventaire <small class="note">${G.kg(G.invWeight(S))}</small></b>
          <div class="xgrid">${Object.entries(inv).map(([k, q]) => cell('inv', k, q)).join('') || '<p class="note">Vide</p>'}</div></div>
        <div class="cargo-side" data-x-drop="chest"><b>Cale</b>
          <div class="xgrid">${Object.entries(c.chest).map(([k, q]) => cell('chest', k, q)).join('') || '<p class="note">Vide</p>'}</div></div>
      </div>
      ${it ? `<div class="xbar">
        ${itemIco(cx.key)}<span class="x-name"><b>${esc(it.name)}</b><small>${G.kg(it.weight || 0)} l’unité · ${selQ} disponible${selQ > 1 ? 's' : ''}</small></span>
        <span class="x-qty"><button class="sq" data-xq="-1" aria-label="Moins">−</button><input id="x-qty" type="number" min="1" max="${selQ}" value="${Math.min(cx.qty, selQ)}" aria-label="Quantité"><button class="sq" data-xq="1" aria-label="Plus">+</button><button class="btn sm ghost" data-xq="all">Tout</button></span>
        <button class="btn" id="x-go">${cx.side === 'inv' ? 'Déposer dans la cale →' : '← Prendre'}</button>
      </div>` : '<p class="note" style="margin:0">Clique sur un objet pour choisir la quantité, ou fais glisser une pile entière d’un côté à l’autre.</p>'}
    </section>`;
}
/** Bateaux, classés : le bateau attitré du groupe, ses autres bateaux, puis ceux du joueur. */
function shipsTabHTML() {
  const c = CREW, W = c ? G.crewWords(c) : null;
  const mine = SHIPS.filter((x) => x.owner?.kind === 'player' && x.owner.id === S.uid);
  const crewShips = c ? SHIPS.filter((x) => x.owner?.kind === 'crew' && x.owner.id === c.id) : [];
  const main = c?.ship ? crewShips.find((x) => x.id === c.ship) || null : null;
  const others = crewShips.filter((x) => x.id !== c?.ship);
  const tag = (txt, cls = '') => `<p class="ship-tag ${cls}">${txt}</p>`;
  const editBtn = (x) => `<button class="btn sm ghost" data-ship-edit="${esc(x.id)}">Nommer, décrire, photo</button>`;
  const crewCard = (x, label, cls) => shipCard(x, { extra: tag(label, cls), actions: can('ship') ? editBtn(x) : '', upgrade: can('ship') });
  return `
    ${c ? `<section class="ship-sec">
      <h3 class="ed-h first">⭐ Bateau attitré ${W.de}</h3>
      <p class="note" style="margin:0">C’est le navire ${W.de} : sa cale sert de cale commune.</p>
      ${main ? crewCard(main, `⭐ Bateau attitré · appartient à ${W.le}`, 'main') : `<p class="note">Aucun bateau attitré : la cale commune est limitée à ${G.kg(G.CHEST_BASE)}.</p>`}
      ${can('ship') && [...crewShips, ...mine].length ? `<div class="mj-row"><label for="crew-ship">Changer de bateau attitré</label>
        <select id="crew-ship"><option value="">Aucun</option>${[...crewShips, ...mine].map((x) => `<option value="${esc(x.id)}" ${x.id === c.ship ? 'selected' : ''}>${esc(x.name)} (${x.owner?.kind === 'player' ? 'à toi' : W.le}, ${G.kg(x.capacity)})</option>`).join('')}</select>
        <button class="btn sm" id="crew-ship-go">Choisir</button></div>
        ${mine.length ? `<p class="note" style="margin:0">Choisir un de tes bateaux personnels le donne à ${W.le}.</p>` : ''}` : ''}
    </section>` : ''}
    ${others.length ? `<section class="ship-sec"><h3 class="ed-h">Autres bateaux ${W.de}</h3>
      <div class="ships">${others.map((x) => crewCard(x, `Appartient à ${W.le}`, '')).join('')}</div></section>` : ''}
    <section class="ship-sec"><h3 class="ed-h ${c ? '' : 'first'}">Mes bateaux personnels</h3>
      ${mine.length ? `<div class="ships">${mine.map((x) => shipCard(x, { extra: tag('À toi seul', 'mine'), actions: editBtn(x), upgrade: true })).join('')}</div>` : '<p class="note">Tu n’as pas de bateau à toi. On en trouve dans certaines boutiques.</p>'}
    </section>`;
}
function renderCrew() {
  if (!S || ADMIN) return;
  const c = CREW;
  // L'écran s'appelle « Escouade » pour un Marine dans une escouade
  document.querySelector('.scr[data-screen="crew"] span:last-child').textContent = c?.kind === 'flotte' ? 'Escouade' : 'Équipage';
  if (!c && crewTab !== 'ships') crewTab = 'crew';
  const head = c ? `
    <div class="crew-hero">
      <div class="flag">${c.flag ? `<img src="${imgSrc(c.flag)}" alt="${c.kind === 'flotte' ? 'Emblème' : 'Jolly Roger'}" onerror="this.replaceWith(document.createTextNode('☠'))">` : ico(1)}</div>
      <div>
        <h2>${esc(c.name)}</h2>
        <p class="lede" style="margin:4px 0 0">${c.kind === 'flotte' ? 'Escouade de la Marine · ' : ''}${c.members.length} membre${c.members.length > 1 ? 's' : ''} · ton grade : <b>${esc(G.rankName(c, S.uid))}</b></p>
      </div>
    </div>` : `<div class="no-shop">${ico(1)}<h2>${S.id.faction === 'Marine' ? 'Pas d’escouade' : 'Pas d’équipage'}</h2><p class="note">${S.id.faction === 'Marine' ? 'Tu n’es affecté à aucune escouade. Un commandant peut t’inviter.' : 'Tu ne fais partie d’aucun équipage. Un capitaine peut t’inviter.'}</p></div>`;
  const tabs = `<div class="seg crew-seg" role="group" aria-label="Section">
    ${c ? `<button aria-pressed="${crewTab === 'crew'}" data-ct="crew">${c.kind === 'flotte' ? 'Escouade' : 'Équipage'}</button><button aria-pressed="${crewTab === 'cargo'}" data-ct="cargo">Banque</button>` : ''}
    <button aria-pressed="${crewTab === 'ships'}" data-ct="ships">Bateaux</button></div>`;
  $('v-crew').innerHTML = `${head}${invitesHTML()}${tabs}
    <div class="crew-body">${crewTab === 'ships' ? shipsTabHTML() : !c ? '' : crewTab === 'cargo' ? bankHTML() : crewTabHTML()}</div>`;
  paintStatic($('v-crew'));
}
async function crewSearchNow() {
  try {
    crewResults = (await API.act({ type: 'crew.search', q: crewSearch })).results || [];
  } catch (err) {
    crewResults = [];
    toast(esc(err.message));
  }
  if (crewTab === 'crew') {
    const box = $('crew-results');
    if (box) {
      renderCrew();
      const i = $('crew-search');
      i?.focus();
      i?.setSelectionRange(i.value.length, i.value.length);
    }
  }
}
$('v-crew').addEventListener('input', (e) => {
  if (e.target.id === 'crew-search') {
    crewSearch = e.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(crewSearchNow, 300);
  }
  if (e.target.id === 'x-qty') cx.qty = Math.max(1, Math.round(+e.target.value || 1));
});
$('v-crew').addEventListener('toggle', (e) => {
  const d = e.target.closest?.('details.rank-edit');
  if (d) d.open ? openRanks.add(d.dataset.rank) : openRanks.delete(d.dataset.rank);
}, true);
$('v-crew').addEventListener('change', async (e) => {
  const u = e.target.dataset?.rankOf;
  if (u) return void run({ type: 'crew.member.rank', uid: u, rankId: e.target.value });
  if (e.target.id === 'flag-file') {
    const f = e.target.files[0];
    if (!f?.type.startsWith('image/')) return;
    if (f.size > 20 * 1024 * 1024) return toast('Image trop lourde (20 Mo maximum).');
    run({ type: 'crew.edit', flag: await readImage(f, { max: 1024 }) });
  }
});
$('v-crew').addEventListener('click', async (e) => {
  const ct = e.target.closest('[data-ct]')?.dataset.ct;
  if (ct) {
    crewTab = ct;
    return renderCrew();
  }
  const join = e.target.closest('[data-join]')?.dataset.join;
  if (join) {
    const out = await run({ type: 'crew.join', crewId: join });
    if (out) {
      INVITES = out.invites || [];
      crewTab = 'crew';
      renderCrew();
    }
    return;
  }
  const dec = e.target.closest('[data-decline]')?.dataset.decline;
  if (dec) {
    const out = await run({ type: 'crew.decline', crewId: dec });
    if (out) {
      INVITES = out.invites || INVITES.filter((i) => i.id !== dec);
      renderCrew();
    }
    return;
  }
  // Équipage
  const inv = e.target.closest('[data-invite]')?.dataset.invite;
  if (inv) {
    if (await run({ type: 'crew.invite', uid: inv })) {
      crewResults = crewResults.filter((x) => x.uid !== inv);
      renderCrew();
    }
    return;
  }
  const un = e.target.closest('[data-uninvite]')?.dataset.uninvite;
  if (un) return void run({ type: 'crew.invite.cancel', uid: un });
  const kick = e.target.closest('[data-kick]')?.dataset.kick;
  if (kick && (await askConfirm(`${CREW.memberNames?.[kick] || 'Ce membre'} ne fera plus partie de ${G.crewWords(CREW).le}.`, { title: 'Exclure ce membre ?', ok: 'Exclure', danger: true }))) return void run({ type: 'crew.kick', uid: kick });
  const cap = e.target.closest('[data-captain]')?.dataset.captain;
  if (cap && (await askConfirm(`${CREW.memberNames?.[cap] || 'Ce membre'} deviendra ${G.crewWords(CREW).chef}, et tu passeras au grade de base.`, { title: `Céder ta place de ${G.crewWords(CREW).chef} ?`, ok: 'Céder ma place', danger: true }))) return void run({ type: 'crew.transfer', uid: cap });
  const mv = e.target.closest('[data-rank-move]');
  if (mv) {
    e.preventDefault(); // ne pas replier/déplier le grade
    return void run({ type: 'crew.rank.move', id: mv.dataset.rankMove, dir: +mv.dataset.dir });
  }
  const rs = e.target.closest('[data-rank-save]');
  if (rs) {
    const box = rs.closest('.rank-edit');
    const perms = Object.fromEntries([...box.querySelectorAll('[data-perm]')].map((c) => [c.dataset.perm, c.checked]));
    const name = box.querySelector('.rank-name').value.trim();
    if (!name) return toast('Donne un nom au grade.');
    if (!rs.dataset.rankSave) openRanks.delete(''); // on replie le formulaire de création
    return void run({ type: 'crew.rank.save', id: rs.dataset.rankSave || undefined, name, perms });
  }
  const rd = e.target.closest('[data-rank-del]')?.dataset.rankDel;
  if (rd && (await askConfirm('Les membres qui l’ont repasseront au grade de base.', { title: 'Supprimer ce grade ?', ok: 'Supprimer', danger: true }))) return void run({ type: 'crew.rank.delete', id: rd });
  if (e.target.id === 'crew-edit-save') return void run({ type: 'crew.edit', name: $('crew-name').value });
  if (e.target.id === 'flag-pick') return $('flag-file').click();
  if (e.target.id === 'flag-none') return void run({ type: 'crew.edit', flag: null });
  if (e.target.id === 'flag-url-go') {
    const v = $('flag-url').value.trim();
    if (!/^https?:\/\//.test(v)) return toast('Le lien doit commencer par http:// ou https://');
    return void run({ type: 'crew.edit', flag: v });
  }
  if (e.target.id === 'crew-leave' && (await askConfirm('Tu ne pourras revenir que sur invitation.', { title: `Quitter ${CREW.name} ?`, ok: 'Quitter', danger: true }))) {
    const out = await run({ type: 'crew.leave' });
    if (out) {
      INVITES = out.invites || INVITES;
      renderCrew();
    }
    return;
  }
  // Cale et banque
  const amount = () => Math.round(Math.abs(+$('bank-n')?.value || 0));
  if (e.target.id === 'bank-in') return amount() ? void run({ type: 'crew.bank.deposit', amount: amount() }) : toast('Indique un montant.');
  if (e.target.id === 'bank-out') return amount() ? void run({ type: 'crew.bank.withdraw', amount: amount() }) : toast('Indique un montant.');
  if (xJust) return;
  const xc = e.target.closest('[data-x-key]');
  if (xc) {
    const same = cx.side === xc.dataset.xSide && cx.key === xc.dataset.xKey;
    cx = same ? { side: null, key: null, qty: 1 } : { side: xc.dataset.xSide, key: xc.dataset.xKey, qty: 1 };
    return renderCrew();
  }
  const xq = e.target.closest('[data-xq]')?.dataset.xq;
  if (xq) {
    const max = +$('x-qty').max || 1;
    cx.qty = xq === 'all' ? max : Math.min(max, Math.max(1, (+$('x-qty').value || 1) + Number(xq)));
    $('x-qty').value = cx.qty;
    return;
  }
  if (e.target.closest('#x-go')) return void cargoMove(cx.side, cx.key, Math.max(1, +$('x-qty').value || 1));
  // Bateaux
  if (e.target.id === 'crew-ship-go') return void run({ type: 'crew.ship', shipId: $('crew-ship').value || null });
  const se = e.target.closest('[data-ship-edit]')?.dataset.shipEdit;
  if (se) return openShipEdit(SHIPS.find((x) => x.id === se), { player: true });
  const up = e.target.closest('[data-upg]')?.dataset.upg;
  if (up) return void installUpgrade(up, e.currentTarget);
});
/** Installe l'amélioration choisie sur un bateau (l'objet est consommé). */
async function installUpgrade(shipId, root) {
  const sel = root.querySelector(`[data-upg-sel="${CSS.escape(shipId)}"]`);
  if (!sel) return;
  const it = G.ITEMS[S.inv[+sel.value]?.[0]];
  if (!(await askConfirm(`${it?.name ?? 'Cette amélioration'} sera installée et retirée de ton inventaire.`, { title: 'Installer l’amélioration ?', ok: 'Installer' }))) return;
  await run({ type: 'ship.upgrade', shipId, slot: +sel.value });
}
async function cargoMove(side, key, qty) {
  const out = await run({ type: side === 'inv' ? 'crew.chest.deposit' : 'crew.chest.withdraw', key, qty });
  if (out) {
    cx.qty = 1;
    renderCrew();
  }
}
/* Glisser une pile entière entre l'inventaire et la cale */
let xdrag = null, xJust = false;
$('v-crew').addEventListener('pointerdown', (e) => {
  const c = e.target.closest('[data-x-key]');
  if (!c || e.button > 0) return;
  xdrag = { side: c.dataset.xSide, k: c.dataset.xKey, x: e.clientX, y: e.clientY, cell: c, on: false };
});
window.addEventListener('pointermove', (e) => xdrag && ghostMove(xdrag, e, itemIco(xdrag.k), '[data-x-drop]'), { passive: false });
window.addEventListener('pointerup', () => {
  if (!xdrag) return;
  const d = xdrag;
  xdrag = null;
  if (!d.on) return;
  xJust = true;
  setTimeout(() => (xJust = false), 0);
  ghostEnd(d);
  const to = d.over?.dataset.xDrop;
  if (!to || to === d.side) return;
  cargoMove(d.side, d.k, d.side === 'inv' ? G.freeCount(S, d.k) : CREW.chest[d.k] || 0);
});

/* ═══ Bateau : édition (joueur : nom, description, photo ; staff : tout) ═══ */
let shipDraft = null, shipDraftId = null, shipAsPlayer = false;
function openShipEdit(ship, { player = false } = {}) {
  shipAsPlayer = player;
  shipDraftId = ship?.id ?? null;
  shipDraft = structuredClone(ship || { name: '', desc: '', photo: null, icon: null, type: G.SHIP_TYPES[0], cannons: 0, capacity: 100, berths: 4, sail: 1, owner: null, model: null });
  $('sh-title').textContent = shipDraftId ? ship.name : 'Nouveau bateau';
  if (!shipDraftId && !player && !Object.values(G.ITEMS).some((it) => it.kind === 'bateau')) return toast('Crée d’abord un modèle de bateau dans Gestion.');
  $('sh-sub').textContent = player ? 'Le type, les canons et la capacité sont fixés à la création.' : 'Bateau créé par le staff, ou modèle acheté par un joueur.';
  $('sh-del').hidden = player || !shipDraftId;
  $('sh-err').textContent = '';
  renderShipEdit();
  openDialog('d-ship');
}
function renderShipEdit() {
  const d = shipDraft;
  const models = Object.entries(G.ITEMS).filter(([, it]) => it.kind === 'bateau');
  const ownerVal = d.owner ? `${d.owner.kind}:${d.owner.id}` : '';
  const isNew = !shipDraftId;
  if (isNew && !shipAsPlayer && !d.model && models.length) Object.assign(d, { model: models[0][0], ...models[0][1].ship, icon: models[0][1].img, desc: d.desc || models[0][1].desc });
  const m = d.model ? G.ITEMS[d.model] : null;
  $('sh-body').innerHTML = `
    <div class="form">
      ${!shipAsPlayer && isNew ? `<div class="wide"><label for="sh-model">Modèle (créé dans Gestion)</label><select id="sh-model">${models.map(([k, it]) => `<option value="${esc(k)}" ${d.model === k ? 'selected' : ''}>${esc(it.name)} · cale ${G.kg(it.ship.capacity)}, vitesse ${it.ship.sail}, ${it.ship.berths} places, ${it.ship.cannons} canons</option>`).join('')}</select></div>` : ''}
      <div class="wide"><label for="sh-name">Nom du bateau</label><input id="sh-name" value="${esc(d.name)}" maxlength="60" placeholder="${esc(m?.name || d.type || '')}"></div>
      ${shipAsPlayer ? '' : `
        ${isNew ? `<p class="note wide" style="margin:0">Type, cale, vitesse, places et canons viennent du modèle. Les améliorations les feront évoluer.</p>` : `
        <div><label>Type</label><input value="${esc(d.type)}" disabled></div>
        <div><label for="sh-wood">Bois de charpente</label><select id="sh-wood">${Object.entries(G.WOODS).map(([k, w]) => `<option value="${k}" ${k === (d.wood || 'standard') ? 'selected' : ''}>${w.name}</option>`).join('')}</select></div>
        ${Object.entries(G.CANNONS).map(([k, c]) => `<div><label for="sh-gun-${k}">Canons ${c.name}s</label><input id="sh-gun-${k}" type="number" min="0" value="${d.guns?.[k] ?? (k === 'leger' ? d.cannons || 0 : 0)}"></div>`).join('')}
        <div><label for="sh-hull">Coque (sur ${G.shipStats(d).hullMax})</label><input id="sh-hull" type="number" min="0" max="${G.shipStats(d).hullMax}" value="${G.shipStats(d).hull}"></div>
        <div class="isl-flags"><label class="chk"><input type="checkbox" id="sh-engine" ${d.engine ? 'checked' : ''}> Moteur au cola</label><label class="chk"><input type="checkbox" id="sh-granit" ${d.granit ? 'checked' : ''}> Granit marin</label><label class="chk"><input type="checkbox" id="sh-plongee" ${d.plongee ? 'checked' : ''}> Plongée</label></div>
        <div><label for="sh-cap">Cale (kg)</label><input id="sh-cap" type="number" min="0" value="${d.capacity}"></div>
        <div><label for="sh-berths">Places (personnes)</label><input id="sh-berths" type="number" min="1" value="${d.berths ?? 4}"></div>
        <div><label for="sh-sail">Niveau de voile (0 à 3)</label><input id="sh-sail" type="number" min="0" max="3" value="${d.sail ?? 0}"></div>
        <div><label for="sh-space">Espace RP sur Discord</label><select id="sh-space">${Object.entries(G.SHIP_SPACES).map(([k, l]) => `<option value="${k}" ${k === (d.space || 'post') ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`}
        <div><label for="sh-owner">Propriétaire</label><select id="sh-owner"><option value="">Personne</option>
          <optgroup label="Escouades de la Marine">${Object.entries(fleet.crews || {}).filter(([, c]) => c.kind === 'flotte').map(([id, c]) => `<option value="crew:${esc(id)}" ${ownerVal === `crew:${id}` ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</optgroup>
          <optgroup label="Équipages">${Object.entries(fleet.crews || {}).filter(([, c]) => c.kind !== 'flotte').map(([id, c]) => `<option value="crew:${esc(id)}" ${ownerVal === `crew:${id}` ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</optgroup>
          <optgroup label="Joueurs">${players.map((p) => `<option value="player:${esc(p.uid)}" ${ownerVal === `player:${p.uid}` ? 'selected' : ''}>${esc(G.fullName({ id: p.ident }))}</option>`).join('')}</optgroup></select></div>
        <div><label for="sh-chan">Salon RP du bateau (ID)</label><input id="sh-chan" inputmode="numeric" value="${esc(d.channelId ?? d.channel?.id ?? '')}" placeholder="Post ou forum du bateau"><small class="note">${d.channel ? `Actuellement : ${esc(d.channel.name)}` : 'Aucun : il en faut un pour naviguer'}</small></div>
        <div><label for="sh-pos">À quai dans le salon (ID)</label><input id="sh-pos" inputmode="numeric" value="${esc(d.positionId ?? d.position?.channelId ?? '')}" placeholder="ID du salon, vide = nulle part"><small class="note">${d.position ? `Actuellement : #${esc(d.position.name || d.position.channelId)}` : 'Pas à quai'}</small></div>`}
      ${!shipAsPlayer && !isNew ? `<div class="wide upg-box">
        <b>Améliorer</b>
        ${Object.entries(G.UPGRADES).map(([k, u]) => `<div class="mj-row prog-row"><label for="shu-${k}">${u.name}</label><input id="shu-${k}" type="number" min="1" placeholder="${k === 'cale' ? 'kg' : k === 'canons' ? 'nombre' : 'niveaux'}"><button type="button" class="btn sm" data-shu="${k}" data-sign="1">Ajouter</button><button type="button" class="btn sm ghost" data-shu="${k}" data-sign="-1">Retirer</button></div>`).join('')}
        ${(d.upgrades || []).length ? `<details class="upg-hist"><summary>Historique (${d.upgrades.length})</summary><ul>${[...d.upgrades].reverse().slice(0, 15).map((u) => `<li>${u.amount > 0 ? '+' : ''}${fmt(u.amount)} ${esc(G.UPGRADES[u.type]?.unit ?? '')} (${esc(G.UPGRADES[u.type]?.name ?? u.type)})${u.item ? ` · ${esc(itemOf(u.item).name)}` : ' · staff'}${(() => { const who = players.find((p) => p.uid === u.by); return who ? ` · ${esc(G.fullName({ id: who.ident }))}` : ''; })()}</li>`).join('')}</ul></details>` : ''}
      </div>` : ''}
      <div class="wide"><label for="sh-desc">Description</label><textarea id="sh-desc" maxlength="600" rows="3" style="width:100%;font:inherit;font-size:16px;color:var(--brown);background:#fffaea;border:3px solid var(--ink);border-radius:5px;padding:7px 10px">${esc(d.desc)}</textarea></div>
    </div>
    <div class="img-field" style="margin-top:12px">
      <div class="prev">${d.photo ? `<img src="${imgSrc(d.photo)}" alt="">` : ico(SHIP_ICON)}</div>
      <div class="se-face-ctl">
        <b>Photo du bateau</b>
        <div class="se-row"><button type="button" class="btn sm" id="sh-pick">Choisir une image</button><input type="file" id="sh-file" accept="image/*" hidden>${d.photo ? '<button type="button" class="btn sm ghost" id="sh-nophoto">Retirer</button>' : ''}</div>
        <div class="ph-url-row"><input type="url" id="sh-url" placeholder="ou un lien https://…" autocomplete="off"><button type="button" class="btn sm" id="sh-url-go">Utiliser</button></div>
      </div>
    </div>`;
}
function readShipEdit() {
  const d = shipDraft;
  d.name = $('sh-name').value;
  d.desc = $('sh-desc').value;
  if (shipAsPlayer) return;
  if ($('sh-wood')) {
    d.wood = $('sh-wood').value;
    d.guns = Object.fromEntries(Object.keys(G.CANNONS).map((k) => [k, Math.max(0, Math.round(+$(`sh-gun-${k}`).value || 0))]));
    d.hull = Math.max(0, Math.round(+$('sh-hull').value || 0));
    d.engine = $('sh-engine').checked;
    d.granit = $('sh-granit').checked;
    d.plongee = $('sh-plongee').checked;
    d.capacity = Math.max(0, Math.round(+$('sh-cap').value || 0));
    d.berths = Math.max(1, Math.round(+$('sh-berths').value || 1));
    d.sail = Math.max(0, Math.min(3, Math.round(+$('sh-sail').value || 0)));
    d.space = $('sh-space').value;
  }
  d.positionId = $('sh-pos').value.trim();
  d.channelId = $('sh-chan').value.trim();
  const o = $('sh-owner').value;
  d.owner = o ? { kind: o.split(':')[0], id: o.slice(o.indexOf(':') + 1) } : null;
}
$('d-ship').addEventListener('change', async (e) => {
  if (e.target.id === 'sh-model') {
    readShipEdit();
    const m = G.ITEMS[e.target.value];
    shipDraft.model = e.target.value || null;
    if (m) Object.assign(shipDraft, { ...m.ship, desc: shipDraft.desc || m.desc, icon: m.img });
    renderShipEdit();
  }
  if (e.target.id === 'sh-file') {
    const f = e.target.files[0];
    if (!f?.type.startsWith('image/')) return;
    if (f.size > 20 * 1024 * 1024) return void ($('sh-err').textContent = 'Image trop lourde (20 Mo maximum).');
    readShipEdit();
    shipDraft.photo = await readImage(f, { max: 1600 });
    renderShipEdit();
  }
});
$('d-ship').addEventListener('click', async (e) => {
  const up = e.target.closest('[data-shu]');
  if (up) {
    const type = up.dataset.shu, n = Math.round(Math.abs(+$(`shu-${type}`).value || 0)) * Number(up.dataset.sign);
    if (!n) return toast('Indique une valeur.');
    readShipEdit();
    try {
      const out = await API.staff('ship.upgrade', { id: shipDraftId, type, amount: n });
      // on garde les champs déjà modifiés, on reprend les chiffres du serveur
      Object.assign(shipDraft, { capacity: out.ship.capacity, cannons: out.ship.cannons, guns: out.ship.guns, hull: out.ship.hull, sail: out.ship.sail, upgrades: out.ship.upgrades });
      renderShipEdit();
      toast(esc(out.toast));
      loadFleet();
    } catch (err) {
      $('sh-err').textContent = err.message;
    }
    return;
  }
  if (e.target.id === 'sh-pick') $('sh-file').click();
  if (e.target.id === 'sh-nophoto') {
    readShipEdit();
    shipDraft.photo = null;
    renderShipEdit();
  }
  if (e.target.id === 'sh-url-go') {
    const v = $('sh-url').value.trim();
    if (!/^https?:\/\//.test(v)) return void ($('sh-err').textContent = 'Le lien doit commencer par http:// ou https://');
    readShipEdit();
    shipDraft.photo = v;
    renderShipEdit();
  }
});
$('sh-save').addEventListener('click', async () => {
  readShipEdit();
  if (!shipDraft.name.trim()) shipDraft.name = shipDraft.type || G.ITEMS[shipDraft.model]?.name || ''; // sans nom : celui du type
  if (!shipDraft.name) return void ($('sh-err').textContent = 'Donne un nom au bateau.');
  $('sh-save').disabled = true;
  $('sh-err').textContent = shipDraft.photo?.startsWith('data:') ? 'Envoi de la photo…' : '';
  try {
    if (shipAsPlayer) {
      const out = await run({ type: 'ship.edit', shipId: shipDraftId, name: shipDraft.name, desc: shipDraft.desc, photo: shipDraft.photo });
      if (out) closeDialog($('d-ship'));
    } else {
      const out = await API.staff('ship.save', { id: shipDraftId, ship: shipDraft });
      closeDialog($('d-ship'));
      toast(esc(out.toast));
      await loadFleet();
    }
  } catch (err) {
    $('sh-err').textContent = err.message;
  } finally {
    $('sh-save').disabled = false;
  }
});
$('sh-del').addEventListener('click', async () => {
  if (!(await askConfirm('Le bateau sera supprimé. S’il était celui d’un équipage, l’équipage n’aura plus de bateau attitré.', { title: `Supprimer ${shipDraft.name} ?`, ok: 'Supprimer', danger: true }))) return;
  try {
    const out = await API.staff('ship.delete', { id: shipDraftId });
    closeDialog($('d-ship'));
    toast(esc(out.toast));
    await loadFleet();
  } catch (err) {
    toast(esc(err.message));
  }
});

/* ═══ Marine (panneau admin) : grades, soldes, escouades ═════════════════ */
function renderMarine() {
  if (!tools()) return;
  const marines = players.filter((p) => p.ident.faction === 'Marine').sort((a, b) => G.GRADES.indexOf(b.ident.grade) - G.GRADES.indexOf(a.ident.grade));
  const payroll = marines.reduce((a, p) => a + G.gradeOf(p.ident.grade).pay, 0);
  const squads = Object.entries(fleet.crews || {}).filter(([, c]) => c.kind === 'flotte');
  $('v-marine').innerHTML = `
    <div class="sec-head">
      <div><h2>Marine</h2><p class="lede" style="margin:0">${marines.length} Marine${marines.length > 1 ? 's' : ''} · soldes versées : <b>${berry(payroll)}</b> par semaine. Chaque Marine touche sa solde à l’ouverture de l’app, selon son grade.</p></div>
      <button class="btn" id="marine-fleet">+ Nouvelle escouade</button>
    </div>
    <div class="grade-scale">${[...G.MARINE_GRADES].reverse().map((g) => {
      const n = marines.filter((p) => p.ident.grade === g.name).length;
      return `<span><b>${g.medal} ${esc(g.name)}</b><small>${berry(g.pay)} / sem. · ${n}</small></span>`;
    }).join('')}</div>
    <h3 class="ed-h">Effectifs</h3>
    ${marines.length ? `<div class="member-list">${marines.map((p) => {
      const i = G.GRADES.indexOf(p.ident.grade);
      const sq = p.crewId && fleet.crews?.[p.crewId]?.kind === 'flotte' ? fleet.crews[p.crewId].name : null;
      return `<div class="member-row marine-row">
        <span class="m-name"><b>${esc(G.fullName({ id: p.ident }))}</b><small class="note">${sq ? ` · ${esc(sq)}` : ' · sans escouade'}</small></span>
        <span class="rank-badge">${G.gradeOf(p.ident.grade).medal} ${esc(p.ident.grade)}</span>
        <span class="m-acts">
          <button class="sq" data-promote="${esc(p.uid)}" data-dir="1" ${i >= G.GRADES.length - 1 ? 'disabled' : ''} title="Promouvoir" aria-label="Promouvoir">↑</button>
          <button class="sq" data-promote="${esc(p.uid)}" data-dir="-1" ${i <= 0 ? 'disabled' : ''} title="Rétrograder" aria-label="Rétrograder">↓</button>
          <button class="btn sm ghost" data-open="${esc(p.uid)}">Fiche</button>
        </span>
      </div>`;
    }).join('')}</div>` : '<p class="note">Aucun Marine. Un joueur devient Marine quand sa faction est « Marine » (bouton Modifier de sa fiche).</p>'}
    <h3 class="ed-h">Escouades (${squads.length})</h3>
    ${squads.length ? `<div class="fleet-list">${squads.map(([id, c]) => {
      const n = Object.values(fleet.ships || {}).filter((sh) => sh.owner?.kind === 'crew' && sh.owner.id === id).length;
      const npcs = Object.keys(c.npcs || {}).length;
      return `<button class="gest-card" data-crew="${esc(id)}">
        <span class="slot-ico">${c.flag ? `<span class="ico item-img"><img src="${imgSrc(c.flag)}" alt=""></span>` : ico(160)}</span>
        <span><b>${esc(c.name)}</b><small>${c.members.length} membre${c.members.length > 1 ? 's' : ''}${npcs ? ` (dont ${npcs} PNJ)` : ''} · ${berry(c.bank || 0)} · ${n} bateau${n > 1 ? 'x' : ''}${c.ship && fleet.ships?.[c.ship] ? ` (attitré : ${esc(fleet.ships[c.ship].name)})` : ''}</small></span>
      </button>`;
    }).join('')}</div>` : '<p class="note">Aucune escouade.</p>'}`;
  paintStatic($('v-marine'));
}
$('v-marine').addEventListener('click', async (e) => {
  const pr = e.target.closest('[data-promote]');
  if (pr) {
    const p = players.find((x) => x.uid === pr.dataset.promote);
    const i = G.GRADES.indexOf(p.ident.grade) + Number(pr.dataset.dir);
    const grade = G.GRADES[Math.max(0, Math.min(G.GRADES.length - 1, i))];
    setBusy(1);
    try {
      const out = await API.staff('act', { target: p.uid, action: { type: 'edit', patch: { id: { grade } } } });
      toast(`${esc(G.fullName(out.player))} : ${esc(grade)}`);
      await loadPlayers();
      renderMarine();
    } catch (err) {
      toast(esc(err.message));
    } finally {
      setBusy(-1);
    }
    return;
  }
  const open = e.target.closest('[data-open]')?.dataset.open;
  if (open) return void openPlayer(open, { tab: 't-mj' });
  const c = e.target.closest('[data-crew]')?.dataset.crew;
  if (c) return openCrewEdit(c);
  if (e.target.closest('#marine-fleet')) {
    fleetKindNew = 'flotte';
    openCrewEdit(null);
  }
});

/* ═══ Équipages et bateaux (panneau admin) ═══════════════════════════════ */
let fleet = { crews: null, ships: null };
async function loadFleet() {
  try {
    const out = await API.staff('crews');
    fleet = { crews: out.crews, ships: out.ships };
    if (screen === 'marine') renderMarine();
    if (screen === 'ships') renderShipsAdmin();
  } catch (err) {
    fleet = { crews: {}, ships: {} };
    toast(esc(err.message));
  }
  renderFleet();
}
const ownerName = (o) => {
  if (!o) return 'Sans propriétaire';
  if (o.kind === 'crew') {
    const c = fleet.crews?.[o.id];
    return `${c?.kind === 'flotte' ? 'Escouade' : 'Équipage'} : ${c?.name ?? '?'}`;
  }
  return `Joueur : ${G.fullName({ id: players.find((p) => p.uid === o.id)?.ident || {} })}`;
};
/** Écran Équipages (panneau admin) : équipages seulement. Les escouades sont dans l'écran Marine. */
function renderFleet() {
  if (!tools()) return;
  const el = $('v-fleet');
  if (!fleet.crews) return void (el.innerHTML = '<p class="note">Chargement…</p>');
  const crews = Object.entries(fleet.crews).filter(([, c]) => c.kind !== 'flotte').sort((a, b) => a[1].name.localeCompare(b[1].name));
  el.innerHTML = `
    <div class="sec-head">
      <div><h2>Équipages</h2><p class="lede" style="margin:0">Les équipages du RP. Les escouades de la Marine sont dans l’écran Marine.</p></div>
      <button class="btn" id="fleet-new">+ Nouvel équipage</button>
    </div>
    ${crews.length ? `<div class="fleet-list">${crews.map(([id, c]) => {
      const owned = Object.values(fleet.ships).filter((sh) => sh.owner?.kind === 'crew' && sh.owner.id === id).length;
      const npcs = Object.keys(c.npcs || {}).length;
      return `<button class="gest-card" data-crew="${esc(id)}">
        <span class="slot-ico flag-mini">${c.flag ? `<span class="ico item-img"><img src="${imgSrc(c.flag)}" alt=""></span>` : ico(1)}</span>
        <span><b>${esc(c.name)}</b><small>${c.members.length} membre${c.members.length > 1 ? 's' : ''}${npcs ? ` (dont ${npcs} PNJ)` : ''} · ${berry(c.bank || 0)} · ${owned} bateau${owned > 1 ? 'x' : ''}${c.ship && fleet.ships[c.ship] ? ` (attitré : ${esc(fleet.ships[c.ship].name)})` : ''}</small></span>
      </button>`;
    }).join('')}</div>` : '<p class="note">Aucun équipage.</p>'}`;
  paintStatic(el);
}
/** Écran Bateaux (panneau admin). */
function renderShipsAdmin() {
  if (!tools()) return;
  const el = $('v-ships');
  if (!fleet.ships) return void (el.innerHTML = '<p class="note">Chargement…</p>');
  const ships = Object.entries(fleet.ships).sort((a, b) => a[1].name.localeCompare(b[1].name));
  const models = Object.values(G.ITEMS).filter((it) => it.kind === 'bateau').length;
  el.innerHTML = `
    <div class="sec-head">
      <div><h2>Bateaux</h2><p class="lede" style="margin:0">Tous les bateaux, achetés, fabriqués ou créés ici à partir d’un modèle.</p></div>
      <button class="btn" id="ships-new" ${models ? '' : 'disabled title="Crée d’abord un modèle dans Gestion (catégorie Bateau)"'}>+ Nouveau bateau</button>
    </div>
    ${models ? '' : '<p class="note">Aucun modèle de bateau : crée-en un dans Gestion, catégorie « Bateau » (le nom est le type, ex. Voilier).</p>'}
    ${ships.length ? `<div class="fleet-list">${ships.map(([id, sh]) => {
      const main = sh.owner?.kind === 'crew' && fleet.crews?.[sh.owner.id]?.ship === id;
      return `
      <button class="gest-card" data-ship="${esc(id)}">
        <span class="slot-ico">${sh.photo || sh.icon ? `<span class="ico item-img"><img src="${imgSrc(sh.photo || sh.icon)}" alt=""></span>` : ico(SHIP_ICON)}</span>
        <span><b>${main ? '⭐ ' : ''}${esc(sh.name)}</b><small>${esc(sh.type)} · cale ${G.kg(sh.capacity)} · vitesse ${sh.sail ?? 1} · ${sh.berths ?? 4} places · ${sh.cannons} canons<br>${esc(ownerName(sh.owner))}${main ? ' · bateau attitré' : ''}${sh.position ? ` · ⚓ #${esc(sh.position.name || sh.position.channelId)}` : ''}</small></span>
      </button>`;
    }).join('')}</div>` : '<p class="note">Aucun bateau.</p>'}${shipCfgHTML()}`;
  paintStatic(el);
}
$('v-fleet').addEventListener('click', (e) => {
  if (e.target.closest('#fleet-new')) {
    fleetKindNew = 'equipage';
    return openCrewEdit(null);
  }
  const c = e.target.closest('[data-crew]')?.dataset.crew;
  if (c) return openCrewEdit(c);
});
/** Réglages des bateaux (Panneau admin > Bateaux) : tous les chiffres des statistiques. */
function shipCfgHTML() {
  const C = G.SHIPCFG;
  const f = (id, label, v, step = '0.1', hint = '') => `<div><label for="sc-${id}">${label}</label><input id="sc-${id}" type="number" step="${step}" value="${v}">${hint ? `<small class="note">${hint}</small>` : ''}</div>`;
  return `<details class="crew-box ship-cfg" style="margin-top:16px"><summary><b>⚙️ Réglages des bateaux</b> <small class="note">effets des canons, du bois, de la voile, du moteur, de la cale et de la coque</small></summary>
    <h3 class="ed-h">Vitesse</h3><div class="form">
      ${f('sailBonus', 'Vitesse par niveau de voile', C.sailBonus)}
      ${f('engineBonus', 'Vitesse du moteur au cola', C.engineBonus)}
      ${f('holdSlow', 'Vitesse perdue par kg de cale ajoutée', C.holdSlow, '0.001', '0,005 = 1 de vitesse pour 200 kg')}
    </div>
    <h3 class="ed-h">Canons</h3><div class="form">
      ${Object.entries(G.CANNONS).map(([k, c]) => f(`gun-${k}-power`, `Canon ${c.name} : puissance offensive`, C.cannons[k].power) + f(`gun-${k}-slow`, `Canon ${c.name} : vitesse perdue`, C.cannons[k].slow)).join('')}
    </div>
    <h3 class="ed-h">Robustesse et coque</h3><div class="form">
      ${Object.entries(G.WOODS).map(([k, w]) => f(`wood-${k}`, `${w.name} : multiplicateur de robustesse`, C.woods[k], '0.05')).join('')}
      ${f('granitBonus', 'Robustesse apportée par le granit marin', C.granitBonus, '1')}
      ${f('hullPerRobust', 'Points de coque par point de robustesse', C.hullPerRobust, '1')}
      ${f('damagedPct', 'Seuil d’avarie (% de la coque)', C.damagedPct, '1')}
    </div>
    <h3 class="ed-h">Bois de construction</h3>
    <p class="note" style="margin:0 0 6px">Pour les recettes de construction « bois au choix » : l’objet utilisé pour chaque bois.</p>
    <div class="form">
      ${Object.entries(G.WOODS).map(([k, w]) => `<div><label for="sc-wi-${k}">${w.name}</label><select id="sc-wi-${k}"><option value="">Aucun objet</option>${Object.entries(G.ITEMS).filter(([, it]) => it.kind !== 'bateau').sort((a, b) => a[1].name.localeCompare(b[1].name)).map(([id, it]) => `<option value="${esc(id)}" ${id === C.woodItems?.[k] ? 'selected' : ''}>${esc(it.name)}</option>`).join('')}</select></div>`).join('')}
    </div>
    <div class="form-actions"><button class="btn ghost" id="sc-reset">Valeurs par défaut</button><button class="btn" id="sc-save">Enregistrer les réglages</button></div>
  </details>`;
}
$('v-ships').addEventListener('click', (e) => {
  if (e.target.closest('#sc-save') || e.target.closest('#sc-reset')) {
    const v = (id) => $(`sc-${id}`).value;
    const cfg = e.target.closest('#sc-reset') ? {} : {
      sailBonus: v('sailBonus'), engineBonus: v('engineBonus'), holdSlow: v('holdSlow'),
      granitBonus: v('granitBonus'), hullPerRobust: v('hullPerRobust'), damagedPct: v('damagedPct'),
      woods: Object.fromEntries(Object.keys(G.WOODS).map((k) => [k, v(`wood-${k}`)])),
      cannons: Object.fromEntries(Object.keys(G.CANNONS).map((k) => [k, { power: v(`gun-${k}-power`), slow: v(`gun-${k}-slow`) }])),
      woodItems: Object.fromEntries(Object.keys(G.WOODS).map((k) => [k, $(`sc-wi-${k}`)?.value || null])),
    };
    return void gestCall('ship.cfg', { cfg });
  }
  if (e.target.closest('#ships-new')) return openShipEdit(null);
  const sh = e.target.closest('[data-ship]')?.dataset.ship;
  if (sh) return openShipEdit({ id: sh, ...fleet.ships[sh] });
});

/* Édition d'un équipage ou d'une escouade */
let crewDraft = null, crewDraftId = null, crewQuery = '', fleetKindNew = 'equipage';
function openCrewEdit(id) {
  crewDraftId = id;
  crewDraft = structuredClone(id ? fleet.crews[id] : { kind: fleetKindNew, name: '', flag: null, captain: null, members: [], npcs: {}, bank: 0, chest: {}, ship: null });
  crewDraft.npcs ??= {};
  crewQuery = '';
  $('cr-title').textContent = id ? crewDraft.name : crewDraft.kind === 'flotte' ? 'Nouvelle escouade' : 'Nouvel équipage';
  $('cr-del').hidden = !id;
  $('cr-err').textContent = '';
  renderCrewEdit();
  openDialog('d-crew');
}
function renderCrewEdit() {
  const d = crewDraft, W = G.crewWords(d);
  const q = normTxt(crewQuery);
  const list = players.filter((p) => (d.kind !== 'flotte' || p.ident.faction === 'Marine' || d.members.includes(p.uid)) && (!q || normTxt(G.fullName({ id: p.ident })).includes(q) || d.members.includes(p.uid)));
  const npcs = Object.entries(d.npcs || {});
  const realCount = d.members.filter((u) => !G.isNpc(u)).length;
  const memberName = (u) => (G.isNpc(u) ? `${d.npcs[u]?.name ?? 'PNJ'} (PNJ)` : G.fullName({ id: players.find((p) => p.uid === u)?.ident || {} }));
  $('cr-body').innerHTML = `
    <div class="form">
      <div class="wide"><label for="cr-name">Nom</label><input id="cr-name" value="${esc(d.name)}" maxlength="60"></div>
      <input type="hidden" id="cr-kind" value="${d.kind || 'equipage'}">
      <div><label for="cr-bank">Banque (berrys)</label><input id="cr-bank" type="number" min="0" value="${d.bank || 0}"></div>
      <div><label for="cr-ship">Bateau attitré</label><select id="cr-ship"><option value="">Aucun</option>${Object.entries(fleet.ships || {}).map(([sid, sh]) => `<option value="${esc(sid)}" ${d.ship === sid ? 'selected' : ''}>${esc(sh.name)} (${esc(sh.type)}, ${G.kg(sh.capacity)})</option>`).join('')}</select></div>
    </div>
    <div class="img-field" style="margin-top:12px">
      <div class="prev flag-prev">${d.flag ? `<img src="${imgSrc(d.flag)}" alt="">` : ico(1)}</div>
      <div class="se-face-ctl">
        <b>${d.kind === 'flotte' ? 'Emblème' : 'Jolly Roger'}</b>
        <div class="se-row"><button type="button" class="btn sm" id="cr-pick">Choisir une image</button><input type="file" id="cr-file" accept="image/*" hidden>${d.flag ? '<button type="button" class="btn sm ghost" id="cr-noflag">Retirer</button>' : ''}</div>
        <div class="ph-url-row"><input type="url" id="cr-url" placeholder="ou un lien https://…" autocomplete="off"><button type="button" class="btn sm" id="cr-url-go">Utiliser</button></div>
      </div>
    </div>
    <h3 class="ed-h">Membres joueurs (${realCount})${d.kind === 'flotte' ? ' <small class="note">Marines uniquement</small>' : ''}</h3>
    <input class="mj-search" id="cr-q" type="search" placeholder="Chercher un joueur…" value="${esc(crewQuery)}">
    <div class="member-pick">${list.map((p) => `<label><input type="checkbox" data-member="${esc(p.uid)}" ${d.members.includes(p.uid) ? 'checked' : ''}> ${esc(G.fullName({ id: p.ident }))}${p.crewId && p.crewId !== crewDraftId ? ` <small class="note">(dans ${esc(fleet.crews?.[p.crewId]?.name ?? 'un autre groupe')}, il le quittera)</small>` : ''}</label>`).join('') || '<p class="note">Aucun joueur.</p>'}</div>
    <h3 class="ed-h">Membres PNJ (${npcs.length})</h3>
    <div class="pax">${npcs.map(([id, n]) => `<span>🤖 ${esc(n.name)}${n.grade ? ` · ${esc(n.grade)}` : ''} <button type="button" class="linklike" data-npc-del="${esc(id)}" aria-label="Retirer ${esc(n.name)}">✕</button></span>`).join('') || '<span class="note">Aucun PNJ.</span>'}</div>
    <div class="se-row">
      <input id="cr-npc" placeholder="Nom du PNJ" maxlength="60" aria-label="Nom du PNJ">
      ${d.kind === 'flotte' ? `<select id="cr-npc-grade" aria-label="Grade du PNJ">${G.GRADES.map((g) => `<option value="${esc(g)}">${esc(g)}</option>`).join('')}</select>` : ''}
      <button type="button" class="btn sm" id="cr-npc-add">Ajouter le PNJ</button>
    </div>
    <p class="note" style="margin:4px 0 0">Un PNJ n’a pas de compte Discord : il apparaît dans la liste des membres et peut être ${W.chef}.</p>
    <div class="field"><label for="cr-cap">${W.Chef}</label><select id="cr-cap">${d.members.map((u) => `<option value="${esc(u)}" ${u === d.captain ? 'selected' : ''}>${esc(memberName(u))}</option>`).join('') || '<option value="">Ajoute d’abord des membres</option>'}</select></div>
    ${Object.keys(d.chest || {}).length ? `<h3 class="ed-h">Coffre (${G.kg(G.chestWeight(d))})</h3><div class="chest">${Object.entries(d.chest).map(([k, q]) => `<span class="need">${itemIco(k)}${q} × ${esc(itemOf(k).name)}</span>`).join('')}</div>` : ''}`;
}
function readCrewEdit() {
  const d = crewDraft;
  d.name = $('cr-name').value;
  d.kind = $('cr-kind').value;
  d.bank = Math.max(0, Math.round(+$('cr-bank').value || 0));
  d.ship = $('cr-ship').value || null;
  d.captain = $('cr-cap').value || d.members[0] || null;
}
$('d-crew').addEventListener('input', (e) => {
  if (e.target.id !== 'cr-q') return;
  readCrewEdit();
  crewQuery = e.target.value;
  renderCrewEdit();
  const i = $('cr-q');
  i.focus();
  i.setSelectionRange(i.value.length, i.value.length);
});
$('d-crew').addEventListener('change', async (e) => {
  const m = e.target.dataset?.member;
  if (m) {
    readCrewEdit();
    crewDraft.members = e.target.checked ? [...crewDraft.members, m] : crewDraft.members.filter((x) => x !== m);
    if (!crewDraft.members.includes(crewDraft.captain)) crewDraft.captain = crewDraft.members[0] ?? null;
    return renderCrewEdit();
  }
  if (e.target.id === 'cr-file') {
    const f = e.target.files[0];
    if (!f?.type.startsWith('image/')) return;
    if (f.size > 20 * 1024 * 1024) return void ($('cr-err').textContent = 'Image trop lourde (20 Mo maximum).');
    readCrewEdit();
    crewDraft.flag = await readImage(f, { max: 1024 });
    renderCrewEdit();
  }
});
$('d-crew').addEventListener('click', (e) => {
  if (e.target.id === 'cr-npc-add') {
    const name = $('cr-npc').value.trim();
    if (!name) return void ($('cr-err').textContent = 'Donne un nom au PNJ.');
    readCrewEdit();
    const id = `npc-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    crewDraft.npcs = { ...(crewDraft.npcs || {}), [id]: { name, grade: $('cr-npc-grade')?.value || null } };
    crewDraft.members = [...crewDraft.members, id];
    if (!crewDraft.captain) crewDraft.captain = id;
    $('cr-err').textContent = '';
    return renderCrewEdit();
  }
  const nd = e.target.closest('[data-npc-del]')?.dataset.npcDel;
  if (nd) {
    readCrewEdit();
    delete crewDraft.npcs[nd];
    crewDraft.members = crewDraft.members.filter((u) => u !== nd);
    if (crewDraft.captain === nd) crewDraft.captain = crewDraft.members[0] ?? null;
    return renderCrewEdit();
  }
  if (e.target.id === 'cr-pick') $('cr-file').click();
  if (e.target.id === 'cr-url-go') {
    const v = $('cr-url').value.trim();
    if (!/^https?:\/\//.test(v)) return void ($('cr-err').textContent = 'Le lien doit commencer par http:// ou https://');
    readCrewEdit();
    crewDraft.flag = v;
    renderCrewEdit();
  }
  if (e.target.id === 'cr-noflag') {
    readCrewEdit();
    crewDraft.flag = null;
    renderCrewEdit();
  }
});
$('cr-save').addEventListener('click', async () => {
  readCrewEdit();
  if (!crewDraft.name.trim()) return void ($('cr-err').textContent = `Donne un nom à ${G.crewWords(crewDraft).le}.`);
  $('cr-save').disabled = true;
  try {
    const { chest, ...crew } = crewDraft; // le coffre se gère par les joueurs
    const out = await API.staff('crew.save', { id: crewDraftId, crew });
    closeDialog($('d-crew'));
    toast(esc(out.toast));
    await Promise.all([loadFleet(), loadPlayers()]);
  } catch (err) {
    $('cr-err').textContent = err.message;
  } finally {
    $('cr-save').disabled = false;
  }
});
$('cr-del').addEventListener('click', async () => {
  const W = G.crewWords(crewDraft);
  if (!(await askConfirm(`Les membres n’auront plus ${W.un === 'une escouade' ? 'd’escouade' : 'd’équipage'}, la banque et le coffre seront perdus, et ses bateaux n’auront plus de propriétaire.`, { title: `Supprimer ${crewDraft.name} ?`, ok: 'Supprimer', danger: true }))) return;
  try {
    const out = await API.staff('crew.delete', { id: crewDraftId });
    closeDialog($('d-crew'));
    toast(esc(out.toast));
    await Promise.all([loadFleet(), loadPlayers()]);
  } catch (err) {
    toast(esc(err.message));
  }
});

/* ═══ Techniques à valider (panneau admin) ═══════════════════════════════ */
let pendingTechs = null;
async function loadPendingTechs() {
  try {
    pendingTechs = (await API.staff('techniques')).list;
  } catch (err) {
    pendingTechs = [];
    toast(esc(err.message));
  }
  renderPendingTechs();
}
function renderPendingTechs() {
  if (!tools()) return;
  const label = document.querySelector('#scr-atech span:last-child');
  if (label) label.textContent = pendingTechs?.length ? `Techniques (${pendingTechs.length})` : 'Techniques';
  const el = $('v-atech');
  if (!pendingTechs) return void (el.innerHTML = '<p class="note">Chargement…</p>');
  el.innerHTML = `
    <div class="sec-head">
      <div><h2>Techniques à valider</h2><p class="lede" style="margin:0">Toutes les techniques proposées par les joueurs. Un refus demande un motif, que le joueur verra sur sa fiche.</p></div>
      <button class="btn ghost" id="atech-reload">Actualiser</button>
    </div>
    ${pendingTechs.length ? `<div class="val-list">${pendingTechs.map(({ uid, player, tech: t }) => `
      <article class="val-card">
        ${t.media ? `<div class="val-media"><img src="${imgSrc(t.media)}" alt="Illustration de ${esc(t.name)}" loading="lazy" onerror="this.parentElement.remove()"></div>` : ''}
        <div class="val-body">
          <p class="note" style="margin:0 0 4px">Proposée par <b>${esc(player)}</b></p>
          <h3>${esc(t.name)} <span class="tag ${SRC_CLS[t.src] || ''}">${G.TECH_SOURCES[t.src] || ''}</span></h3>
          <p>${esc(t.desc) || '<em>Pas de description.</em>'}</p>
          <div class="val-acts">
            <button class="btn sm" data-tv-ok="${esc(uid)}" data-tid="${t.id}">✓ Valider</button>
            <button class="btn sm ghost" data-tv-no="${esc(uid)}" data-tid="${t.id}">✗ Refuser</button>
            <button class="btn sm ghost" data-tv-open="${esc(uid)}">Voir la fiche</button>
          </div>
        </div>
      </article>`).join('')}</div>` : '<p class="note">Aucune technique en attente. 🎉</p>'}`;
}
$('v-atech').addEventListener('click', async (e) => {
  if (e.target.closest('#atech-reload')) return void loadPendingTechs();
  const open = e.target.closest('[data-tv-open]')?.dataset.tvOpen;
  if (open) return void openPlayer(open, { tab: 't-tech' });
  const okB = e.target.closest('[data-tv-ok]'), noB = e.target.closest('[data-tv-no]');
  const b = okB || noB;
  if (!b) return;
  const uid = b.dataset.tvOk || b.dataset.tvNo, id = Number(b.dataset.tid);
  let reason = null;
  if (noB) {
    reason = await askRefuseReason();
    if (!reason) return;
  }
  setBusy(1);
  try {
    const out = await API.staff('act', { target: uid, action: { type: 'tech.validate', id, ok: !!okB, reason } });
    toast(esc(out.toast));
  } catch (err) {
    toast(esc(err.message));
  } finally {
    setBusy(-1);
  }
  loadPendingTechs();
});

/* ═══ Événements en mer par niveau de mer (panneau admin) ════════════════ */
let seaDraft = null;
async function loadSeaEvents() {
  try {
    seaDraft = G.normalizeSeaEvents((await API.staff('features')).seaEvents);
  } catch (err) {
    seaDraft = G.normalizeSeaEvents(null);
    toast(esc(err.message));
  }
  renderSeaEvents();
}
/** Total des probabilités d'un niveau de mer (en rouge s'il ne fait pas 100 %). */
function seaTotHTML(l) {
  const sum = Math.round(Object.values(seaDraft.levels[l]).reduce((a, b) => a + b, 0) * 10) / 10;
  return `<th id="sea-tot-${l}" class="${sum === 100 || sum === 0 ? '' : 'warn'}">${sum} %</th>`;
}
function renderSeaEvents() {
  const el = $('v-asea');
  if (!seaDraft) return void (el.innerHTML = '<p class="note">Chargement…</p>');
  el.innerHTML = `
    <div class="sec-head">
      <div><h2>Événements en mer</h2><p class="lede" style="margin:0">Pour chaque niveau de mer (la difficulté de la route), donne la probabilité de chaque événement, en %. Vide ou 0 : l’événement n’arrive jamais à ce niveau. Les cases de la roue des vents suivent ces probabilités, comme le tirage sans navigateur. Si une colonne ne fait pas 100 %, les chances sont prises en proportion. Leurs effets seront réglés ensuite.</p></div>
      <button class="btn" id="sea-save">Enregistrer</button>
    </div>
    <div class="sea-table"><table>
      <thead><tr><th>Événement</th>${G.ROUTE_DIFFS.map((n, i) => `<th>${i + 1}<br><small>${esc(n)}</small></th>`).join('')}<th></th></tr></thead>
      <tbody>${seaDraft.list.map((ev) => `<tr>
        <td><input data-sea-name="${esc(ev.id)}" value="${esc(ev.name)}" maxlength="50" aria-label="Nom de l’événement"></td>
        ${[1, 2, 3, 4, 5].map((l) => `<td><input type="number" min="0" max="100" step="any" data-sea-lvl="${l}" data-sea-id="${esc(ev.id)}" value="${seaDraft.levels[l][ev.id] ?? ''}" placeholder="0" aria-label="${esc(ev.name)}, niveau ${l}, en %"> %</td>`).join('')}
        <td><button type="button" class="close sm-close" data-sea-del="${esc(ev.id)}" aria-label="Supprimer ${esc(ev.name)}">×</button></td>
      </tr>`).join('')}</tbody>
      <tfoot><tr><th>Total</th>${[1, 2, 3, 4, 5].map((l) => seaTotHTML(l)).join('')}<th></th></tr></tfoot>
    </table></div>
    <button type="button" class="btn sm ghost" id="sea-add">+ Ajouter un événement</button>`;
}
$('v-asea').addEventListener('input', (e) => {
  const id = e.target.dataset?.seaName;
  if (!id) return;
  const ev = seaDraft.list.find((x) => x.id === id);
  if (ev) ev.name = e.target.value;
});
$('v-asea').addEventListener('input', (e) => {
  const l = e.target.dataset?.seaLvl, id = e.target.dataset?.seaId;
  if (!l || !id) return;
  const v = Math.max(0, Math.min(100, Number(e.target.value) || 0));
  if (v > 0) seaDraft.levels[l][id] = v;
  else delete seaDraft.levels[l][id];
  const t = $(`sea-tot-${l}`);
  if (t) t.outerHTML = seaTotHTML(l);
});
$('v-asea').addEventListener('click', async (e) => {
  const del = e.target.closest('[data-sea-del]')?.dataset.seaDel;
  if (del) {
    seaDraft.list = seaDraft.list.filter((x) => x.id !== del);
    for (const l of [1, 2, 3, 4, 5]) delete seaDraft.levels[l][del];
    return renderSeaEvents();
  }
  if (e.target.closest('#sea-add')) {
    seaDraft.list.push({ id: `ev${Date.now()}`, name: 'Nouvel événement' });
    return renderSeaEvents();
  }
  if (e.target.closest('#sea-save')) {
    setBusy(1);
    try {
      const out = await API.staff('map.seaevents', { seaEvents: seaDraft });
      toast(esc(out?.toast || 'Événements en mer enregistrés'));
      featAt = 0; // l'encadré des voyages se met à jour
    } catch (err) {
      toast(esc(err.message));
    } finally {
      setBusy(-1);
    }
  }
});

/* ═══ Calcul de trajet (panneau admin) ═══════════════════════════════════ */
let calcData = null, calcRes = null;
const calcForm = { from: null, to: null, kind: 'model', ship: null };
async function loadCalc() {
  try {
    calcData = await API.staff('calc', { list: true });
  } catch (err) {
    calcData = { islands: [], ships: [], models: [] };
    toast(esc(err.message));
  }
  renderCalc();
}
function renderCalc() {
  const el = $('v-acalc');
  if (!calcData) return void (el.innerHTML = '<p class="note">Chargement…</p>');
  const f = calcForm, list = f.kind === 'ship' ? calcData.ships : calcData.models;
  f.from ??= calcData.islands[0]?.id;
  f.to ??= calcData.islands[1]?.id ?? calcData.islands[0]?.id;
  if (!list.some((x) => x.id === f.ship)) f.ship = list[0]?.id ?? null;
  const opts = (items, sel) => items.map((x) => `<option value="${esc(x.id)}" ${x.id === sel ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
  el.innerHTML = `
    <div class="sec-head"><div><h2>Calcul de trajet</h2><p class="lede" style="margin:0">Le nombre d’actions RP entre deux îles, pour un modèle de bateau ou un bateau existant (avec ses vraies statistiques).</p></div></div>
    <section class="crew-box">
      <div class="form">
        <div><label for="cc-from">Départ</label><select id="cc-from">${opts(calcData.islands, f.from)}</select></div>
        <div><label for="cc-to">Arrivée</label><select id="cc-to">${opts(calcData.islands, f.to)}</select></div>
        <div><label for="cc-kind">Bateau</label><select id="cc-kind"><option value="model" ${f.kind === 'model' ? 'selected' : ''}>Un modèle</option><option value="ship" ${f.kind === 'ship' ? 'selected' : ''}>Un bateau existant</option></select></div>
        <div><label for="cc-ship">${f.kind === 'ship' ? 'Bateau existant' : 'Modèle'}</label><select id="cc-ship">${opts(list, f.ship) || '<option value="">Aucun</option>'}</select></div>
      </div>
      <div class="form-actions"><button class="btn" id="cc-go">Calculer</button></div>
    </section>
    ${calcRes ? calcResHTML(calcRes) : ''}`;
}
function calcResHTML(r) {
  if (r.none) return `<section class="crew-box"><h3>${esc(r.fromName)} → ${esc(r.toName)}</h3><p class="note" style="margin:0">Aucune route entre ces deux îles : vérifie les routes et leur sens sur la carte.</p></section>`;
  return `<section class="crew-box"><h3>${esc(r.ship)} : ${esc(r.fromName)} → ${esc(r.toName)}</h3>
    <p class="calc-big"><b>${r.base}</b> actions RP sans navigateur</p>
    <p class="note" style="margin:0 0 4px">Avec un navigateur : de <b>${r.best}</b> (cap parfaitement tenu) à <b>${r.worst}</b> (cap jamais tenu).</p>
    <p class="note" style="margin:0">Temps de route ${r.value}${r.via.length ? ` · via ${r.via.map(esc).join(', ')}` : ''} · route ${G.ROUTE_DIFFS[r.diff - 1].toLowerCase()} · vitesse du bateau ${r.speed} · rythme des voyages ${r.pace}</p>
  </section>`;
}
$('v-acalc').addEventListener('change', (e) => {
  const map = { 'cc-from': 'from', 'cc-to': 'to', 'cc-kind': 'kind', 'cc-ship': 'ship' };
  const k = map[e.target.id];
  if (!k) return;
  calcForm[k] = e.target.value;
  if (k === 'kind') renderCalc();
});
$('v-acalc').addEventListener('click', async (e) => {
  if (!e.target.closest('#cc-go')) return;
  const f = calcForm;
  if (!f.ship) return void toast('Choisis un bateau.');
  setBusy(1);
  try {
    calcRes = await API.staff('calc', { from: f.from, to: f.to, shipId: f.kind === 'ship' ? f.ship : null, model: f.kind === 'model' ? f.ship : null });
  } catch (err) {
    toast(esc(err.message));
  } finally {
    setBusy(-1);
  }
  renderCalc();
});

/* ═══ Fonctionnalités activées ou non pour les joueurs (panneau admin) ═══ */
let featDraft = null;
async function loadFeatures() {
  try {
    featDraft = (await API.staff('features')).features;
  } catch (err) {
    featDraft = {};
    toast(esc(err.message));
  }
  renderFeatures();
}
function renderFeatures() {
  const el = $('v-afeat');
  if (!featDraft) return void (el.innerHTML = '<p class="note">Chargement…</p>');
  el.innerHTML = `
    <div class="sec-head"><div><h2>Fonctionnalités</h2><p class="lede" style="margin:0">Désactive une fonctionnalité pour tous les joueurs, par exemple pendant un event ou une mise à jour. Le staff garde l’accès à tout depuis le panneau admin.</p></div></div>
    <div class="feat-list">${Object.entries(G.FEATURES).map(([k, f]) => {
      const on = featDraft[k] !== false;
      return `<label class="feat ${on ? '' : 'off'}"><input type="checkbox" data-feat="${k}" ${on ? 'checked' : ''}>
        <span><b>${f.icon} ${esc(f.name)}</b><small class="note">${esc(f.desc)}</small></span>
        <span class="feat-st ${on ? 'ok' : 'no'}">${on ? 'Activée' : 'Désactivée'}</span></label>`;
    }).join('')}</div>`;
}
$('v-afeat').addEventListener('change', async (e) => {
  const k = e.target.dataset?.feat;
  if (!k) return;
  featDraft[k] = e.target.checked;
  renderFeatures();
  setBusy(1);
  try {
    const out = await API.staff('map.features', { features: { [k]: featDraft[k] } });
    toast(esc(out?.toast || 'Fonctionnalités enregistrées'));
  } catch (err) {
    toast(esc(err.message));
    loadFeatures();
  } finally {
    setBusy(-1);
  }
});

/* ═══ Carnets : dernières entrées de tous les joueurs (panneau admin) ════ */
let journalList = null, journalUnread = false;
async function loadJournals() {
  try {
    journalList = (await API.staff('journals')).list;
  } catch (err) {
    journalList = [];
    toast(esc(err.message));
  }
  renderJournals();
}
function renderJournals() {
  if (!tools()) return;
  const waiting = (journalList || []).filter((x) => !x.entry.notes.length).length;
  const label = document.querySelector('#scr-ajour span:last-child');
  if (label) label.textContent = waiting ? `Carnets (${waiting})` : 'Carnets';
  const el = $('v-ajour');
  if (!journalList) return void (el.innerHTML = '<p class="note">Chargement…</p>');
  const shown = journalUnread ? journalList.filter((x) => !x.entry.notes.length) : journalList;
  el.innerHTML = `
    <div class="sec-head">
      <div><h2>Carnets</h2><p class="lede" style="margin:0">Les dernières entrées des carnets des joueurs. Ouvre un carnet pour annoter une entrée ou ajouter une note secrète.</p></div>
      <div class="mj-row"><label><input type="checkbox" id="ajour-unread" ${journalUnread ? 'checked' : ''}> Sans annotation</label><button class="btn ghost" id="ajour-reload">Actualiser</button></div>
    </div>
    ${shown.length ? shown.map(({ uid, player, entry: e }) => `
      <article class="jr-entry">
        <header><span><b>${esc(player)}</b> · ${esc(e.title || 'Sans titre')} <small class="note">${jrDate(e.at)}${e.edited ? ` · modifiée ${jrDate(e.edited)}` : ''}</small></span>
          <span class="jr-acts"><button class="btn sm" data-aj-open="${esc(uid)}">📓 Ouvrir le carnet</button><button class="btn sm ghost" data-aj-fiche="${esc(uid)}">Voir la fiche</button></span></header>
        ${e.text ? `<div class="jr-text jr-excerpt">${md(e.text)}</div>` : ''}
        ${e.image ? `<div class="inv-gallery"><img src="${imgSrc(e.image)}" alt=""></div>` : ''}
        <p class="note" style="margin:6px 0 0">${e.notes.length ? `${e.notes.map((n) => esc(n.emoji)).filter(Boolean).join(' ')} ${e.notes.length} annotation${e.notes.length > 1 ? 's' : ''} du staff` : '<span class="req">Pas encore d’annotation</span>'}</p>
      </article>`).join('') : `<p class="note">${journalUnread ? 'Toutes les entrées ont été annotées. 🎉' : 'Aucune entrée pour l’instant.'}</p>`}`;
}
/** Ouvre la fiche d'un joueur, puis son carnet. */
async function openJournalOf(uid) {
  await openPlayer(uid, { tab: 't-job' });
  for (let i = 0; i < 50 && S?.uid !== uid; i++) await new Promise((r) => setTimeout(r, 100));
  if (S?.uid === uid) journalFab.click();
}
$('v-ajour').addEventListener('change', (e) => {
  if (e.target.id !== 'ajour-unread') return;
  journalUnread = e.target.checked;
  renderJournals();
});
$('v-ajour').addEventListener('click', (e) => {
  if (e.target.closest('#ajour-reload')) return void loadJournals();
  const op = e.target.closest('[data-aj-open]')?.dataset.ajOpen;
  if (op) return void openJournalOf(op);
  const fi = e.target.closest('[data-aj-fiche]')?.dataset.ajFiche;
  if (fi) openPlayer(fi);
});

/* ═══ Recettes de cuisine (panneau admin) ════════════════════════════════ */
let cookList = null, cookFilter = 'wait';
async function loadCooks() {
  try {
    cookList = (await API.staff('cooks')).list;
  } catch (err) {
    cookList = [];
    toast(esc(err.message));
  }
  renderCooks();
}
function renderCooks() {
  if (!tools()) return;
  const st = (r) => (r.ok ? 'ok' : r.refused ? 'refused' : 'wait');
  const pend = (cookList || []).filter((x) => st(x.recipe) === 'wait').length;
  const label = document.querySelector('#scr-acook span:last-child');
  if (label) label.textContent = pend ? `Cuisine (${pend})` : 'Cuisine';
  const el = $('v-acook');
  if (!cookList) return void (el.innerHTML = '<p class="note">Chargement…</p>');
  const shown = cookList.filter((x) => cookFilter === 'all' || st(x.recipe) === cookFilter);
  el.innerHTML = `
    <div class="sec-head">
      <div><h2>Recettes de cuisine</h2><p class="lede" style="margin:0">Toutes les recettes de cuisine des joueurs. Valider ajoute le plat au catalogue (catégorie Plat), modifiable ensuite dans Gestion. Un refus demande un motif.</p></div>
      <div class="mj-row"><select id="acook-f" aria-label="Filtre">${[['wait', 'À valider'], ['ok', 'Validées'], ['refused', 'Refusées'], ['all', 'Toutes']].map(([v, l]) => `<option value="${v}" ${v === cookFilter ? 'selected' : ''}>${l}</option>`).join('')}</select><button class="btn ghost" id="acook-reload">Actualiser</button></div>
    </div>
    ${shown.length ? `<div class="val-list">${shown.map(({ uid, player, recipe: r }) => `
      <article class="val-card"><div class="val-body">
        <p class="note" style="margin:0 0 4px">Par <b>${esc(player)}</b> · ${st(r) === 'ok' ? '<span class="status ok">Validée</span>' : st(r) === 'refused' ? '<span class="status refused">Refusée</span>' : '<span class="status wait">À valider</span>'}</p>
        <h3>${esc(r.name)}</h3>
        ${r.photo ? `<div class="inv-gallery"><img src="${imgSrc(r.photo)}" alt=""></div>` : ''}
        <p class="inv-desc">${esc(r.desc)}</p>
        <p class="note" style="margin:4px 0"><b>Ingrédients :</b> ${Object.entries(r.needs).map(([k, q]) => `${q} × ${esc(itemOf(k).name)}`).join(', ')}</p>
        <p class="note" style="margin:0 0 6px"><b>Étapes :</b> ${r.steps.map((k) => G.COOK_STEPS[k] || k).join(' → ')}</p>
        ${r.refused ? `<p class="refused-why"><b>Motif du refus :</b> ${esc(r.refused.reason)}</p>` : ''}
        <div class="val-acts">${r.ok ? '' : `<button class="btn sm" data-ac-ok="${esc(uid)}" data-cid="${r.id}">✓ Valider</button>`}<button class="btn sm ghost" data-ac-no="${esc(uid)}" data-cid="${r.id}">✗ Refuser</button><button class="btn sm ghost" data-ac-open="${esc(uid)}">Voir la fiche</button></div>
      </div></article>`).join('')}</div>` : '<p class="note">Aucune recette ici.</p>'}`;
}
$('v-acook').addEventListener('change', (e) => {
  if (e.target.id !== 'acook-f') return;
  cookFilter = e.target.value;
  renderCooks();
});
$('v-acook').addEventListener('click', async (e) => {
  if (e.target.closest('#acook-reload')) return void loadCooks();
  const open = e.target.closest('[data-ac-open]')?.dataset.acOpen;
  if (open) return void openPlayer(open, { tab: 't-job' });
  const okB = e.target.closest('[data-ac-ok]'), noB = e.target.closest('[data-ac-no]');
  const b = okB || noB;
  if (!b) return;
  const target = b.dataset.acOk || b.dataset.acNo, id = Number(b.dataset.cid);
  let reason = null;
  if (noB) {
    reason = await askText('Explique au cuisinier pourquoi : il verra ce motif et pourra corriger sa recette.', { title: 'Refuser la recette', ok: 'Refuser', placeholder: 'Ex. trop d’étapes, plat incohérent…', max: 300 });
    if (!reason) return;
  }
  setBusy(1);
  try {
    const out = await API.staff('cook.validate', { target, id, ok: !!okB, reason });
    if (out.catalog) G.setCatalog(out.catalog);
    toast(esc(out.toast));
  } catch (err) {
    toast(esc(err.message));
  } finally {
    setBusy(-1);
  }
  loadCooks();
});

/* ═══ Inventions à valider (panneau admin) ═══════════════════════════════ */
let pendingInv = null;
async function loadPendingInventions() {
  try {
    pendingInv = (await API.staff('inventions')).list;
  } catch (err) {
    pendingInv = [];
    toast(esc(err.message));
  }
  renderPendingInventions();
}
function renderPendingInventions() {
  if (!tools()) return;
  const label = document.querySelector('#scr-ainv span:last-child');
  if (label) label.textContent = pendingInv?.length ? `Inventions (${pendingInv.length})` : 'Inventions';
  const el = $('v-ainv');
  if (!pendingInv) return void (el.innerHTML = '<p class="note">Chargement…</p>');
  el.innerHTML = `
    <div class="sec-head">
      <div><h2>Inventions à valider</h2><p class="lede" style="margin:0">Les inventions proposées par les scientifiques. Un refus demande un motif, que le joueur verra dans son onglet Métier.</p></div>
      <button class="btn ghost" id="ainv-reload">Actualiser</button>
    </div>
    ${pendingInv.length ? `<div class="val-list">${pendingInv.map(({ uid, player, job, jobLvl, invention: x }) => `
      <article class="val-card">
        <div class="val-body">
          <p class="note" style="margin:0 0 4px">Proposée par <b>${esc(player)}</b> · ${job ? `${esc(JOBS[job]?.name || job)} ${JOB_LEVELS[jobLvl - 1]}` : 'sans métier'}${job !== 'scientifique' ? ' <span class="req">(n’est plus scientifique)</span>' : ''}</p>
          <h3>${esc(x.name)}</h3>
          ${x.images.length ? `<div class="inv-gallery">${x.images.map((u) => `<img src="${imgSrc(u)}" alt="" loading="lazy">`).join('')}</div>` : ''}
          <p class="inv-desc">${esc(x.desc)}</p>
          <div class="val-acts">
            <button class="btn sm" data-iv-ok="${esc(uid)}" data-iid="${x.id}">✓ Valider</button>
            <button class="btn sm ghost" data-iv-no="${esc(uid)}" data-iid="${x.id}">✗ Refuser</button>
            <button class="btn sm ghost" data-iv-open="${esc(uid)}">Voir la fiche</button>
          </div>
        </div>
      </article>`).join('')}</div>` : '<p class="note">Aucune invention en attente. 🎉</p>'}`;
}
$('v-ainv').addEventListener('click', async (e) => {
  if (e.target.closest('#ainv-reload')) return void loadPendingInventions();
  const open = e.target.closest('[data-iv-open]')?.dataset.ivOpen;
  if (open) return void openPlayer(open, { tab: 't-job' });
  const okB = e.target.closest('[data-iv-ok]'), noB = e.target.closest('[data-iv-no]');
  const b = okB || noB;
  if (!b) return;
  const uid = b.dataset.ivOk || b.dataset.ivNo, id = Number(b.dataset.iid);
  let reason = null;
  if (noB) {
    reason = await askText('Explique au joueur pourquoi : il verra ce motif et pourra corriger son invention.', { title: 'Refuser l’invention', ok: 'Refuser', placeholder: 'Ex. trop puissante, pas assez précise…', max: 300 });
    if (!reason) return;
  }
  setBusy(1);
  try {
    const out = await API.staff('act', { target: uid, action: { type: 'invention.validate', id, ok: !!okB, reason } });
    toast(esc(out.toast));
  } catch (err) {
    toast(esc(err.message));
  } finally {
    setBusy(-1);
  }
  loadPendingInventions();
});

/* ═══ Mini-jeux (panneau admin) : tester sans rien dépenser ═════════════ */
const gameLog = [];
function renderGames() {
  if (!tools()) return;
  const ranks = (sel = 1) => JOB_LEVELS.map((l, i) => `<option value="${i + 1}" ${i + 1 === sel ? 'selected' : ''}>${l}</option>`).join('');
  $('v-agames').innerHTML = `
    <div class="sec-head"><div><h2>Mini-jeux</h2><p class="lede" style="margin:0">Teste les mini-jeux comme un joueur, sans matériel ni effet sur les fiches ou les bateaux. Pratique pour régler la difficulté.</p></div></div>
    <div class="games-grid">
      <section class="crew-box"><h3>🔨 Atelier du charpentier</h3>
        <div class="mj-row"><label for="tg-work">Travail</label><select id="tg-work">${Object.entries(G.SHIP_WORKS).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select></div>
        <div class="mj-row"><label for="tg-level">Niveau de voile</label><input id="tg-level" type="number" min="1" max="3" value="2"></div>
        <div class="mj-row"><label for="tg-size">Calibre</label><select id="tg-size">${Object.entries(G.CANNONS).map(([k, c]) => `<option value="${k}">${esc(c.name)}</option>`).join('')}</select>
          <label for="tg-wood">Bois</label><select id="tg-wood">${Object.entries(G.WOODS).map(([k, w]) => `<option value="${k}">${esc(w.name)}</option>`).join('')}</select></div>
        <div class="mj-row"><label for="tg-wrank">Rang</label><select id="tg-wrank">${ranks()}</select></div>
        <div class="mj-row"><label for="tg-wgame">Mini-jeu</label><select id="tg-wgame"><option value="">Au hasard</option><option value="marteau">🔨 Marteau</option><option value="scie">🪚 Sciage</option><option value="assemblage">🧩 Assemblage</option><option value="calfatage">💧 Calfatage</option></select></div>
        <p class="note" id="tg-wdiff" style="margin:0"></p>
        <div><button class="btn" id="tg-work-go">Tester le marteau</button></div>
      </section>
      <section class="crew-box"><h3>🩹 Bandage (blessure légère)</h3>
        <div class="mj-row"><label for="tg-brank">Rang</label><select id="tg-brank">${ranks()}</select></div>
        <div class="mj-row"><label for="tg-bgame">Mini-jeu</label><select id="tg-bgame"><option value="">Au hasard</option><option value="serrer">🩹 Bandage</option><option value="nettoyer">🦠 Désinfecter</option><option value="points">🧵 Points de suture</option></select></div>
        <div><button class="btn" id="tg-band-go">Tester le bandage</button></div>
      </section>
      ${nouveautes() ? `<section class="crew-box"><h3>🍳 Cuisine</h3>
        <div class="mj-row"><label for="tg-cook">Étape</label><select id="tg-cook"><option value="">Toutes les étapes, à la suite</option>${Object.entries(G.COOK_STEPS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div>
        <div><button class="btn" id="tg-cook-go">Tester</button></div>
      </section>` : ''}
      <section class="crew-box"><h3>🧭 Navigateur : lire la mer</h3>
        <div class="mj-row"><label for="tg-nrank">Rang</label><select id="tg-nrank">${ranks()}</select></div>
        <div class="mj-row"><label for="tg-ndiff">Route</label><select id="tg-ndiff">${G.ROUTE_DIFFS.map((l, i) => `<option value="${i + 1}" ${i === 1 ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div><button class="btn" id="tg-nav-go">Tester la navigation</button></div>
      </section>
      <section class="crew-box"><h3>🔪 Opération</h3>
        <div class="mj-row"><label for="tg-glvl">Gravité</label><select id="tg-glvl">${G.HEALTH_LEVELS.slice(1).map((l, i) => `<option value="${i + 2}">${l}</option>`).join('')}</select></div>
        <div class="mj-row"><label for="tg-orank">Rang</label><select id="tg-orank">${ranks(2)}</select></div>
        <div class="mj-row"><label for="tg-otime">Durée</label><input id="tg-otime" type="number" min="0" max="600" value="0" style="width:90px"><span class="note">secondes (0 = automatique)</span></div>
        <div class="mj-row"><label for="tg-ostep">Étape</label><select id="tg-ostep"><option value="">Opération complète</option>${Object.entries(OP_STEPS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div>
        <div><button class="btn" id="tg-op-go">Tester l’opération</button></div>
      </section>
    </div>
    <h3 class="ed-h">Résultats</h3>
    <div class="member-list">${gameLog.map((l) => `<div class="member-row"><span class="m-name">${l.ok ? '✅' : '❌'} ${esc(l.label)}</span><span class="note">${esc(l.at)}</span><span></span></div>`).join('') || '<p class="note">Aucun essai pour l’instant.</p>'}</div>`;
  showWorkDiff();
}
/** Travail et rang choisis dans l'encadré de l'atelier. */
function testWork() {
  const work = G.normalizeWork({ type: $('tg-work').value, level: $('tg-level').value, size: $('tg-size').value, wood: $('tg-wood').value, model: '' });
  return { work, rank: +$('tg-wrank').value };
}
function showWorkDiff() {
  const el = $('tg-wdiff');
  if (!el) return;
  const { work, rank } = testWork();
  const d = G.workDifficulty({ work }, { job: { lvl: rank } });
  el.textContent = `Curseur : ${d.speed.toFixed(2)} aller-retour par seconde · zone dorée : ${Math.round(d.zone)} % · ${d.nails} clous en ${d.strikes} coups`;
}
async function testGame(label, play) {
  const ok = await play();
  gameLog.unshift({ ok, label, at: new Date().toLocaleTimeString('fr-FR') });
  gameLog.length = Math.min(gameLog.length, 15);
  renderGames();
}
$('v-agames').addEventListener('change', () => showWorkDiff());
$('v-agames').addEventListener('click', (e) => {
  if (e.target.closest('#tg-work-go')) {
    const { work, rank } = testWork();
    const what = work.type === 'construire' ? `Construire en ${G.WOODS[work.wood].name.toLowerCase()}` : G.workLabel(work);
    const label = `${what} (${JOB_LEVELS[rank - 1]})`;
    return void testGame(label, () => workGame({ work }, rank, `Test : ${what}`, $('tg-wgame').value || null));
  }
  if (e.target.closest('#tg-band-go')) {
    const rank = +$('tg-brank').value;
    return void testGame(`Bandage (${JOB_LEVELS[rank - 1]})`, () => bandageGame('test', rank, $('tg-bgame').value || null));
  }
  if (e.target.closest('#tg-cook-go')) {
    const k = $('tg-cook').value;
    return void testGame(k ? `Cuisine : ${G.COOK_STEPS[k]}` : 'Cuisine : toutes les étapes', () => cookGame({ name: 'test', steps: k ? [k] : Object.keys(G.COOK_STEPS) }));
  }
  if (e.target.closest('#tg-nav-go')) {
    const rank = +$('tg-nrank').value;
    return void (async () => {
      const diff = +$('tg-ndiff').value;
      const r = await navGame(rank, 'Test : lire la mer', diff);
      gameLog.unshift({
        ok: !!r,
        label: r ? `Navigation (${JOB_LEVELS[rank - 1]}, route ${G.ROUTE_DIFFS[diff - 1].toLowerCase()}) : cap ${Math.round(r.score * 100)} %, traversée ×${(1.25 - 0.45 * r.score).toFixed(2)}, ${r.sea} (${r.danger}/5)` : `Navigation (${JOB_LEVELS[rank - 1]}) : abandonnée`,
        at: new Date().toLocaleTimeString('fr-FR'),
      });
      gameLog.length = Math.min(gameLog.length, 15);
      renderGames();
    })();
  }
  if (e.target.closest('#tg-op-go')) {
    const lvl = +$('tg-glvl').value, rank = +$('tg-orank').value, g = G.HEALTH_LEVELS[lvl - 1].toLowerCase();
    const only = $('tg-ostep').value || null, what = only ? OP_STEPS[only] : 'Opération';
    return void testGame(`${what} · ${g} (${JOB_LEVELS[rank - 1]})`, () => opGame2(lvl, `Test : ${what.toLowerCase()} ${g}`, rank, only, { time: +$('tg-otime').value || 0 }));
  }
});

/* ═══ Permissions (panneau admin) : ce que chaque rôle Discord peut faire ═ */
let permsData = null; // { roles, perms: { roleId: [permissions] } }
async function loadPerms() {
  try {
    permsData = await API.staff('perms.get');
  } catch (err) {
    permsData = { roles: [], perms: {} };
    toast(esc(err.message));
  }
  renderPerms();
}
function renderPerms() {
  if (!tools()) return;
  const el = $('v-aperms');
  if (!permsData) return void (el.innerHTML = '<p class="note">Chargement…</p>');
  const color = (c) => (c ? `#${c.toString(16).padStart(6, '0')}` : 'var(--muted)');
  el.innerHTML = `
    <div class="sec-head">
      <div><h2>Permissions</h2><p class="lede" style="margin:0">Coche ce que chaque rôle Discord peut faire dans le panneau admin et avec les commandes du bot. Les administrateurs du serveur, les rôles de STAFF_ROLE_IDS et les propriétaires du bot ont toujours tout.</p></div>
      <button class="btn ghost" id="perms-reload">Actualiser</button>
    </div>
    ${permsData.roles.length ? `<div class="perm-roles">${permsData.roles.map((r) => {
      const full = r.admin || r.staff;
      const mine = permsData.perms[r.id] || [];
      return `<details class="perm-role" ${mine.length ? 'open' : ''}>
        <summary><span class="perm-dot" style="background:${color(r.color)}"></span><b>${esc(r.name)}</b><small class="note">${full ? (r.admin ? 'Administrateur : tout' : 'STAFF_ROLE_IDS : tout') : mine.length ? `${mine.length} permission${mine.length > 1 ? 's' : ''}` : 'Aucune'}</small><span class="chev" aria-hidden="true">▾</span></summary>
        ${full ? '<p class="note" style="margin:6px 0 0">Ce rôle a déjà toutes les permissions.</p>' : `<div class="perms">${Object.entries(G.STAFF_PERMS).map(([k, l]) => `<label><input type="checkbox" data-perm-role="${esc(r.id)}" data-perm="${k}" ${mine.includes(k) ? 'checked' : ''}> ${esc(l)}</label>`).join('')}</div>`}
      </details>`;
    }).join('')}</div>` : '<p class="note">Aucun rôle trouvé. Vérifie GUILD_ID et DISCORD_BOT_TOKEN dans Vercel.</p>'}`;
}
$('v-aperms').addEventListener('click', (e) => {
  if (e.target.closest('#perms-reload')) loadPerms();
});
$('v-aperms').addEventListener('change', async (e) => {
  const roleId = e.target.dataset?.permRole;
  if (!roleId) return;
  const perms = [...document.querySelectorAll(`#v-aperms [data-perm-role="${CSS.escape(roleId)}"]`)].filter((c) => c.checked).map((c) => c.dataset.perm);
  setBusy(1);
  try {
    const out = await API.staff('perms.set', { roleId, perms });
    permsData.perms = out.perms;
    toast(esc(out.toast));
    renderPerms();
  } catch (err) {
    toast(esc(err.message));
    loadPerms();
  } finally {
    setBusy(-1);
  }
});

/* ═══ Butins (panneau admin) : exploration ═══════════════════════════════ */
let lootData = null, lootEdit = null; // lootEdit : table en cours de modification { id, name, entries }
async function loadLoot() {
  try {
    lootData = (await API.staff('loot.get')).loot;
  } catch (err) {
    lootData = { tables: {}, places: {} };
    toast(esc(err.message));
  }
  if (!amap) {
    try {
      amap = (await API.staff('map.get')).map; // pour choisir une île
    } catch {}
  }
  renderLoot();
  loadLootChans();
}
/** Salons RP et posts de leurs forums (pour attribuer les tables). */
async function loadLootChans() {
  try {
    lootChans = (await API.staff('loot.channels')).channels;
  } catch (err) {
    lootChans = [];
    toast(esc(err.message));
  }
  renderLoot();
}
async function lootCall(op, payload) {
  setBusy(1);
  try {
    const out = await API.staff(op, payload);
    lootData = out.loot;
    if (out.toast) toast(esc(out.toast));
    renderLoot();
    return out;
  } catch (err) {
    toast(esc(err.message));
    return null;
  } finally {
    setBusy(-1);
  }
}
const PLACE_KIND = { post: 'Post', forum: 'Forum', salon: 'Salon', ile: 'Île' };
function renderLoot() {
  if (!tools()) return;
  const el = $('v-aloot');
  if (!lootData) return void (el.innerHTML = '<p class="note">Chargement…</p>');
  const tables = Object.entries(lootData.tables);
  const places = Object.entries(lootData.places).sort((a, b) => a[1].kind.localeCompare(b[1].kind));
  const islands = Object.entries(amap?.islands || {}).filter(([, i]) => i.kind !== 'waypoint');
  const total = (t) => Math.round(t.entries.reduce((a, e) => a + e.chance, 0) * 100) / 100;
  const placeName = (k, p) => (p.kind === 'ile' ? amap?.islands?.[k.slice(4)]?.name || p.name || k.slice(4) : `${p.kind === 'post' ? '' : '#'}${p.name || k.slice(3)}`);
  el.innerHTML = `
    <div class="sec-head">
      <div><h2>Butins</h2><p class="lede" style="margin:0">Chaque message RP de 400 caractères ou plus donne un tirage dans la table de l’endroit : le post d’abord, puis son forum ou salon, puis l’île. Au plus un objet par message.</p></div>
      <button class="btn" id="loot-new">+ Nouvelle table</button>
    </div>
    ${lootEdit ? lootEditorHTML() : ''}
    <h3 class="ed-h">Tables (${tables.length})</h3>
    ${tables.length ? `<div class="fleet-list">${tables.map(([id, t]) => {
      const n = places.filter(([, p]) => p.table === id).length;
      return `<button class="gest-card" data-loot-edit="${esc(id)}"><span class="slot-ico">${t.entries[0] ? itemIco(t.entries[0].key) : icon('objet-mat')}</span><span><b>${esc(t.name)}</b><small>${t.entries.length} objet${t.entries.length > 1 ? 's' : ''} · ${total(t)} % de trouver quelque chose · ${n} lieu${n > 1 ? 'x' : ''}</small></span></button>`;
    }).join('')}</div>` : '<p class="note">Aucune table. Crée-en une, par exemple « Forêt ».</p>'}
    ${lootPlacesHTML(places, islands, placeName)}`;
}
/* Attribution des tables : liste des salons RP (forums dépliables), des îles, et des autres lieux attribués */
let lootChans = null, lootQ = '';
const lootOpen = new Set();
const islandOfChan = (id) => Object.entries(amap?.islands || {}).find(([, i]) => (i.channels || []).some((c) => String(c.id) === String(id)))?.[0];
function lootPlacesHTML(places, islands, placeName) {
  const tables = Object.entries(lootData.tables);
  if (!tables.length) return '<h3 class="ed-h">Salons RP</h3><p class="note">Crée d’abord une table pour pouvoir l’attribuer aux salons.</p>';
  const P = lootData.places;
  const tname = (id) => lootData.tables[id]?.name || '?';
  const sel = (key, own, inherit, label, extra) => `<select data-lp-key="${esc(key)}" ${extra} aria-label="Table de ${esc(label)}"><option value="">${inherit ? `Hérite : ${esc(inherit)}` : 'Aucune table'}</option>${tables.map(([id, t]) => `<option value="${esc(id)}" ${own === id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>`;
  const q = normTxt(lootQ.trim());
  const match = (s) => !q || normTxt(s).includes(q);
  const rows = (lootChans || []).map((c) => {
    const isl = islandOfChan(c.id);
    const islInh = isl && P[`isl:${isl}`] ? `${tname(P[`isl:${isl}`].table)} (île ${amap.islands[isl].name})` : '';
    const own = P[`ch:${c.id}`]?.table || '';
    const postInh = own ? `${tname(own)} (du forum)` : islInh;
    const posts = c.posts.filter((p) => match(p.name) || match(c.name));
    if (!match(c.name) && !posts.length) return '';
    const open = lootOpen.has(c.id) || (q && posts.length && !match(c.name));
    const forum = c.kind === 'forum';
    return `<div class="lp-ch">
      <div class="lp-row">${forum ? `<button type="button" class="lp-tog" data-lp-tog="${esc(c.id)}" aria-expanded="${!!open}" aria-label="${open ? 'Replier' : 'Déplier'} ${esc(c.name)}">${open ? '▾' : '▸'}</button>` : '<span class="lp-tog"></span>'}<span class="lp-name">${forum ? '🗂️' : '#'} ${esc(c.name)}${forum ? ` <small class="note">${c.posts.length} post${c.posts.length > 1 ? 's' : ''}</small>` : ''}</span>${sel(`ch:${c.id}`, own, islInh, c.name, `data-lp-name="${esc(c.name)}"`)}</div>
      ${forum && open ? `<div class="lp-posts">${posts.map((p) => `<div class="lp-row"><span class="lp-tog"></span><span class="lp-name">↳ ${esc(p.name)}</span>${sel(`ch:${p.id}`, P[`ch:${p.id}`]?.table || '', postInh, p.name, `data-lp-name="${esc(p.name)}"`)}</div>`).join('') || '<p class="note" style="margin:4px 0 4px 36px">Aucun post ouvert.</p>'}</div>` : ''}
    </div>`;
  }).join('');
  const islRows = islands.map(([id, i]) => `<div class="lp-row lp-ch"><span class="lp-tog"></span><span class="lp-name">🏝️ ${esc(i.name)}</span>${sel(`isl:${id}`, P[`isl:${id}`]?.table || '', '', i.name, `data-lp-name="${esc(i.name)}"`)}</div>`).join('');
  const shown = new Set((lootChans || []).flatMap((c) => [`ch:${c.id}`, ...c.posts.map((p) => `ch:${p.id}`)]));
  const others = lootChans ? places.filter(([k]) => k.startsWith('ch:') && !shown.has(k)) : [];
  return `
    <div class="sec-head" style="margin-top:14px"><h3 class="ed-h" style="margin:0">Salons RP</h3><button type="button" class="btn sm ghost" id="loot-export">📤 Exporter (fichier en MP)</button></div>
    <p class="note" style="margin:0 0 6px">Choisis la table de chaque salon. Déroule un forum (▸) pour régler ses posts un par un. Sans table à lui, un post utilise celle de son forum, puis celle de l’île.</p>
    <div class="mj-row"><input type="search" id="lp-q" placeholder="Rechercher un salon ou un post…" value="${esc(lootQ)}" aria-label="Rechercher un salon ou un post"></div>
    ${lootChans == null ? '<p class="note">Chargement des salons…</p>' : rows ? `<div class="lp-list">${rows}</div>` : '<p class="note">Aucun salon RP ne correspond.</p>'}
    <h3 class="ed-h">Îles</h3>
    ${islRows ? `<div class="lp-list">${islRows}</div>` : '<p class="note">Aucune île sur la carte.</p>'}
    ${others.length ? `<h3 class="ed-h">Autres lieux attribués</h3><p class="note" style="margin:0 0 6px">Posts archivés, ou salons qui ne sont plus RP.</p>
      <div class="member-list">${others.map(([k, p]) => `<div class="member-row"><span class="m-name"><span class="rank-badge">${PLACE_KIND[p.kind]}</span> <b>${esc(placeName(k, p))}</b></span><span class="note">${esc(tname(p.table))}</span><span class="m-acts"><button class="btn sm ghost danger-txt" data-loot-unplace="${esc(k)}">Retirer</button></span></div>`).join('')}</div>` : ''}`;
}
$('v-aloot').addEventListener('change', (e) => {
  const key = e.target.dataset?.lpKey;
  if (!key) return;
  readLootEdit();
  const v = e.target.value;
  if (!v) return void lootCall('loot.place.remove', { key });
  if (key.startsWith('isl:')) return void lootCall('loot.place.set', { table: v, islandId: key.slice(4), name: e.target.dataset.lpName || '' });
  lootCall('loot.place.set', { table: v, channelId: key.slice(3) });
});
$('v-aloot').addEventListener('input', (e) => {
  if (e.target.id !== 'lp-q') return;
  readLootEdit();
  lootQ = e.target.value;
  renderLoot();
  const q = $('lp-q');
  q?.focus();
  q?.setSelectionRange(q.value.length, q.value.length);
});
$('v-aloot').addEventListener('click', async (e) => {

  if (e.target.closest('#loot-export')) {
    // Tout ce qu'il faut pour revoir les butins : tables, attributions, salons, îles, objets
    const data = {
      exportedAt: new Date().toISOString(),
      tables: lootData?.tables || {},
      places: lootData?.places || {},
      channels: lootChans || [],
      islands: Object.fromEntries(Object.entries(amap?.islands || {}).map(([id, i]) => [id, { name: i.name, channels: (i.channels || []).map((c) => ({ id: c.id, name: c.name, kind: c.kind })) }])),
      items: Object.fromEntries(Object.entries(G.ITEMS).map(([k, it]) => [k, { name: it.name, kind: it.kind, rarity: it.rarity, value: it.value }])),
    };
    setBusy(1);
    try {
      const out = await API.staff('loot.export', { name: 'butins.json', content: JSON.stringify(data, null, 2) });
      toast(esc(out.toast));
    } catch (err) {
      toast(esc(err.message));
    } finally {
      setBusy(-1);
    }
    return;
  }
  const id = e.target.closest('[data-lp-tog]')?.dataset.lpTog;
  if (!id) return;
  readLootEdit();
  if (lootOpen.has(id)) lootOpen.delete(id);
  else lootOpen.add(id);
  renderLoot();
});
function lootEditorHTML() {
  const t = lootEdit;
  const opts = (sel) => Object.entries(G.ITEMS).filter(([, it]) => it.kind !== 'bateau').sort((a, b) => a[1].name.localeCompare(b[1].name))
    .map(([k, it]) => `<option value="${esc(k)}" ${k === sel ? 'selected' : ''}>${esc(it.name)} (${G.rarityOf(k).name})</option>`).join('');
  const total = Math.round(t.entries.reduce((a, e) => a + (+e.chance || 0), 0) * 100) / 100;
  return `<section class="crew-box loot-editor">
    <h3>${t.id ? 'Modifier la table' : 'Nouvelle table'}</h3>
    <div class="mj-row"><label for="le-name">Nom</label><input id="le-name" value="${esc(t.name)}" maxlength="60" placeholder="Ex. Forêt"></div>
    <div class="loot-rows">
      <div class="loot-row loot-head"><span>Objet</span><span>Chance (%)</span><span>Quantité</span><span></span></div>
      ${t.entries.map((e, i) => `<div class="loot-row" data-i="${i}"><select data-f="key" aria-label="Objet">${opts(e.key)}</select><input data-f="chance" type="number" min="0.01" max="100" step="0.01" value="${e.chance}" aria-label="Chance"><span class="loot-qty"><input data-f="min" type="number" min="1" value="${e.min}" aria-label="Minimum"> à <input data-f="max" type="number" min="1" value="${e.max}" aria-label="Maximum"></span><button class="close sm-close" data-le-del="${i}" aria-label="Retirer">×</button></div>`).join('') || '<p class="note">Aucun objet.</p>'}
    </div>
    <div class="mj-row"><button class="btn sm ghost" id="le-add">+ Ajouter un objet</button><span class="note">Total : <b>${total} %</b> de trouver quelque chose par message${total > 100 ? ' (au-delà de 100 %, les derniers objets ne sortent jamais)' : ''}.</span></div>
    <div class="mj-row"><button class="btn" id="le-save">Enregistrer</button><button class="btn ghost" id="le-cancel">Annuler</button>${t.id ? '<button class="btn ghost danger-txt" id="le-delete">Supprimer la table</button>' : ''}</div>
  </section>`;
}
function readLootEdit() {
  if (!lootEdit) return;
  lootEdit.name = $('le-name').value;
  document.querySelectorAll('#v-aloot .loot-row[data-i]').forEach((row) => {
    const e = lootEdit.entries[+row.dataset.i];
    e.key = row.querySelector('[data-f=key]').value;
    e.chance = Math.max(0, +row.querySelector('[data-f=chance]').value || 0);
    e.min = Math.max(1, Math.round(+row.querySelector('[data-f=min]').value || 1));
    e.max = Math.max(e.min, Math.round(+row.querySelector('[data-f=max]').value || e.min));
  });
}
$('v-aloot').addEventListener('change', (e) => {
  if (e.target.closest('.loot-editor')) {
    readLootEdit();
    renderLoot();
  }
});
$('v-aloot').addEventListener('click', async (e) => {
  if (e.target.closest('#loot-new')) {
    lootEdit = { id: null, name: '', entries: [] };
    return renderLoot();
  }
  const ed = e.target.closest('[data-loot-edit]')?.dataset.lootEdit;
  if (ed) {
    lootEdit = { id: ed, ...structuredClone(lootData.tables[ed]) };
    renderLoot();
    return $('le-name')?.scrollIntoView({ block: 'center' });
  }
  if (e.target.closest('#le-add')) {
    readLootEdit();
    const first = Object.keys(G.ITEMS).find((k) => G.ITEMS[k].kind !== 'bateau');
    if (!first) return toast('Crée d’abord des objets dans Gestion.');
    lootEdit.entries.push({ key: first, chance: 10, min: 1, max: 1 });
    return renderLoot();
  }
  const del = e.target.closest('[data-le-del]')?.dataset.leDel;
  if (del != null) {
    readLootEdit();
    lootEdit.entries.splice(+del, 1);
    return renderLoot();
  }
  if (e.target.closest('#le-cancel')) {
    lootEdit = null;
    return renderLoot();
  }
  if (e.target.closest('#le-save')) {
    readLootEdit();
    if (!lootEdit.name.trim()) return toast('Donne un nom à la table.');
    if (await lootCall('loot.table.save', { id: lootEdit.id, table: { name: lootEdit.name, entries: lootEdit.entries } })) {
      lootEdit = null;
      renderLoot();
    }
    return;
  }
  if (e.target.closest('#le-delete')) {
    if (!(await askConfirm('Les lieux qui l’utilisent n’auront plus de butin.', { title: `Supprimer « ${lootEdit.name} » ?`, ok: 'Supprimer', danger: true }))) return;
    if (await lootCall('loot.table.delete', { id: lootEdit.id })) {
      lootEdit = null;
      renderLoot();
    }
    return;
  }
  if (e.target.closest('#lp-add-ch')) {
    const id = $('lp-ch').value.trim().replace(/\D/g, '');
    if (!id) return toast('Colle l’ID du post, du salon ou du forum.');
    return void lootCall('loot.place.set', { table: $('lp-table').value, channelId: id });
  }
  if (e.target.closest('#lp-add-isl')) {
    const isl = $('lp-isl').value;
    return void lootCall('loot.place.set', { table: $('lp-table').value, islandId: isl, name: amap?.islands?.[isl]?.name || '' });
  }
  const un = e.target.closest('[data-loot-unplace]')?.dataset.lootUnplace;
  if (un) lootCall('loot.place.remove', { key: un });
});

/* ═══ Icônes (panneau admin) : chaque usage a sa propre icône ════════════ */
let ICONS = {}; // icônes personnalisées : { "slot:faction-marine": lien, "berry": lien… }
let iconKey = null;
function renderIcons() {
  if (!tools()) return;
  const rows = [['berry', 'Divers', 'Symbole Berry (devant les montants)', '<span class="b big-b"></span>'],
    ...Object.entries(ICON_SLOTS).map(([k, [group, label]]) => [`slot:${k}`, group, label, icon(k)])];
  const groups = [...new Set(rows.map((r) => r[1]))];
  const card = ([key, , label, prev]) => `
      <div class="icon-card ${ICONS[key] ? 'custom' : ''}">
        <span class="icon-prev">${prev}</span>
        <span class="icon-lbl"><b>${esc(label)}</b><small>${ICONS[key] ? '✓ Personnalisée' : 'Par défaut'}</small></span>
        <span class="icon-acts">
          <button class="btn sm" data-icon-lib="${esc(key)}">Bibliothèque</button>
          <button class="btn sm ghost" data-icon-file="${esc(key)}">Fichier</button>
          <button class="btn sm ghost" data-icon-link="${esc(key)}">Lien</button>
          ${ICONS[key] ? `<button class="btn sm ghost" data-icon-reset="${esc(key)}">Par défaut</button>` : ''}
        </span>
      </div>`;
  $('v-aicons').innerHTML = `
    <div class="sec-head">
      <div><h2>Icônes</h2><p class="lede" style="margin:0">Chaque usage a sa propre icône : en changer une ne touche pas les autres. Le changement s’applique à tout le monde. Conseil : une image carrée, fond transparent (PNG).</p></div>
    </div>
    ${groups.map((g) => `<h3 class="ed-h">${esc(g)}</h3><div class="icon-grid">${rows.filter((r) => r[1] === g).map(card).join('')}</div>`).join('')}`;
  paintStatic($('v-aicons'));
}
async function iconSet(key, img) {
  setBusy(1);
  try {
    const out = await API.staff('icons.set', { key, img });
    ICONS = out.icons || {};
    setIcons(ICONS, mediaSrc);
    renderAll();
    renderIcons();
    toast(esc(out.toast));
  } catch (err) {
    toast(esc(err.message));
  } finally {
    setBusy(-1);
  }
}
/* Bibliothèque : les images du dossier public/icons, servies par le site (rapide) */
let libKey = null;
function openIconLib(key) {
  if (!ICON_FILES.length) return toast('Le dossier activity/public/icons est vide : ajoute des images, puis git push.');
  libKey = key;
  $('il-q').value = '';
  renderIconLib();
  openDialog('d-iconlib');
  $('il-q').focus();
}
function renderIconLib() {
  const q = normTxt($('il-q').value);
  const files = ICON_FILES.filter((f) => !q || normTxt(f).includes(q));
  $('il-grid').innerHTML = files.map((f) => `<button class="il-item ${ICONS[libKey] === `/icons/${f}` ? 'on' : ''}" data-il="${esc(f)}" title="${esc(f)}"><img src="/icons/${esc(f)}" alt="" loading="lazy" draggable="false"><small>${esc(f.replace(/\.[^.]+$/, ''))}</small></button>`).join('') || '<p class="note">Aucune image ne correspond.</p>';
}
$('il-q').addEventListener('input', renderIconLib);
$('il-grid').addEventListener('click', (e) => {
  const f = e.target.closest('[data-il]')?.dataset.il;
  if (!f) return;
  closeDialog($('d-iconlib'));
  iconSet(libKey, `/icons/${f}`);
});
$('v-aicons').addEventListener('click', async (e) => {
  const lib = e.target.closest('[data-icon-lib]')?.dataset.iconLib;
  if (lib) return openIconLib(lib);
  const f = e.target.closest('[data-icon-file]')?.dataset.iconFile;
  if (f) {
    iconKey = f;
    return $('icon-file').click();
  }
  const l = e.target.closest('[data-icon-link]')?.dataset.iconLink;
  if (l) {
    const v = await askText('Colle le lien de l’image.', { title: 'Nouvelle icône', ok: 'Utiliser', placeholder: 'https://…', max: 2000 });
    if (!v) return;
    if (!/^https?:\/\//.test(v)) return toast('Le lien doit commencer par http:// ou https://');
    return void iconSet(l, v);
  }
  const r = e.target.closest('[data-icon-reset]')?.dataset.iconReset;
  if (r) iconSet(r, null);
});
$('icon-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file?.type.startsWith('image/') || !iconKey) return;
  if (file.size > 20 * 1024 * 1024) return toast('Image trop lourde (20 Mo maximum).');
  iconSet(iconKey, await readImage(file, { max: 256 }));
});

/* ═══ Carte du monde ═════════════════════════════════════════════════════ */
let MAP = null; // carte vue par le joueur (îles visibles, île où il est, trajets depuis là)
const LABEL_ZOOM = 1.8; // en dessous, les noms des îles sont cachés (sauf l'île choisie)
const viewState = {}; // zoom et position de chaque carte, gardés entre deux affichages
/**
 * Visionneuse de carte : zoom (molette, pincement, boutons) et déplacement
 * (glisser). En mode édition : on fait glisser les îles, on voit les routes.
 */
function mapViewer(root, map, { boat = null, editable = false, placing = false, here = null, selected = null, linkFrom = null, showLinks = false, onIsland, onBlank, onPlace, onRatio, onLink } = {}) {
  let ratio = map.ratio || 0.5625;
  // La carte garde ses proportions (la largeur maximale est réglée dans le CSS).
  const size = (r) => `--r:${r};aspect-ratio:${1 / r}`;
  const nodes = map.islands;
  const links = showLinks ? Object.keys(map.links || {}).filter((k) => k.split('|').every((x) => nodes[x])) : [];
  // Poignées de l'île choisie en mode « Placer » : carré = taille, rond = rotation
  const handles = '<span class="h-box"></span><span class="h-size" data-h="size" title="Taille"></span><span class="h-rot" data-h="rot" title="Rotation (Maj : par 15°)"></span>';
  // Nom d'une île : dans un calque AU-DESSUS de toutes les îles, placé par rapport à son centre
  // (lx, ly en multiples de la largeur de l'île).
  const labelPos = (isl) => `left:${isl.x + (isl.lx ?? 0) * isl.size}%;top:${isl.y + ((isl.ly ?? 0.45) * isl.size) / ratio}%`;
  const islandBtn = ([id, isl]) => isl.kind === 'waypoint'
    ? `<button class="island waypoint ${placing ? 'placing' : ''} ${id === selected ? 'sel' : ''} ${id === linkFrom ? 'link-from' : ''}" data-island="${esc(id)}" style="left:${isl.x}%;top:${isl.y}%" aria-label="Point de passage ${esc(isl.name)}">
        <span class="wp-dot"></span><span class="isl-name">◆ ${esc(isl.name)}</span></button>`
    : `<button class="island ${isl.visible ? '' : 'hidden-isl'} ${isl.accessible ? '' : 'closed-isl'} ${id === here ? 'here' : ''} ${id === selected ? 'sel' : ''} ${id === linkFrom ? 'link-from' : ''} ${placing ? 'placing' : ''}"
        data-island="${esc(id)}" style="left:${isl.x}%;top:${isl.y}%;width:${isl.size}%" aria-label="${esc(isl.name)}">
        <span class="isl-art" style="transform:rotate(${isl.rot || 0}deg)">${isl.img ? `<img src="${imgSrc(isl.img)}" alt="" draggable="false">` : '<span class="isl-blob"></span>'}</span>
        ${id === here ? '<span class="isl-here">📍 Tu es ici</span>' : ''}
        ${placing && id === selected ? handles : ''}
      </button>`;
  const labelsHtml = Object.entries(nodes).filter(([, isl]) => isl.kind !== 'waypoint').map(([id, isl]) => {
    const movable = placing && id === selected;
    return `<span class="isl-label ${id === selected ? 'sel' : ''} ${movable ? 'drag' : ''}" data-for="${esc(id)}" ${movable ? `data-label-of="${esc(id)}" title="Fais glisser pour placer le nom"` : ''} style="${labelPos(isl)}">${editable && !isl.visible ? '👁 ' : ''}${!isl.accessible ? '⛔ ' : ''}${esc(isl.name)}</span>`;
  }).join('');
  // Flèches des routes à sens unique, au milieu de la ligne
  const arrowsHtml = links.filter((k) => map.oneway?.[k]).map((k) => {
    const [a, b] = k.split('|'), from = map.oneway[k], to = from === a ? b : a, A = nodes[from], B = nodes[to];
    const ang = (Math.atan2((B.y - A.y) * ratio, B.x - A.x) * 180) / Math.PI;
    return `<span class="lk-arrow" style="left:${(A.x + B.x) / 2}%;top:${(A.y + B.y) / 2}%;--a:${ang}deg">➤</span>`;
  }).join('');
  root.innerHTML = `
    <div class="mapview" style="${size(ratio)}">
      <div class="map-stage">
        ${map.bg ? `<img class="map-bg" src="${imgSrc(map.bg)}" alt="" draggable="false">` : '<div class="map-bg map-empty"></div>'}
        ${links.length ? `<svg class="map-links" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${links.map((k) => {
          const [a, b] = k.split('|'), A = nodes[a], B = nodes[b];
          const xy = `x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}"`;
          return `<g class="lkg"><line class="lk-hit" data-link="${esc(k)}" ${xy}/><line class="lk ${map.oneway?.[k] ? 'oneway' : ''} d${map.diff?.[k] ?? 2}" ${xy}/></g>`;
        }).join('')}</svg>` : ''}
        ${Object.entries(nodes).map(islandBtn).join('')}
        ${arrowsHtml}
        <div class="isl-labels">${labelsHtml}</div>
        ${boat ? `<div class="boat-mark" style="left:${boat.x}%;top:${boat.y}%" aria-label="${esc(boat.ship)} en mer"><span class="boat-ico">⛵</span><span class="boat-lbl">${esc(boat.ship)} · ${boat.done}/${boat.needed}</span></div>` : ''}
      </div>
      <div class="map-ctl"><button class="sq" data-z="full" aria-label="Plein écran">⛶</button><button class="sq" data-z="1" aria-label="Zoomer">+</button><button class="sq" data-z="-1" aria-label="Dézoomer">−</button><button class="sq" data-z="0" aria-label="Recentrer">⟲</button></div>
    </div>`;
  const view = root.querySelector('.mapview'), stage = root.querySelector('.map-stage');
  // Zoom et position en PROPORTIONS de la carte (fx, fy entre 1 - zoom et 0), pas en pixels :
  // ils restent justes quand la carte se redessine ou change de taille.
  const st = (viewState[root.id] ??= { z: 1, fx: 0, fy: 0 });
  st.fx ??= 0;
  st.fy ??= 0;
  const apply = () => {
    st.z = Math.min(8, Math.max(1, st.z));
    st.fx = Math.min(0, Math.max(1 - st.z, st.fx));
    st.fy = Math.min(0, Math.max(1 - st.z, st.fy));
    stage.style.transform = `translate(${st.fx * 100}%, ${st.fy * 100}%) scale(${st.z})`;
    view.style.setProperty('--z', st.z);
    view.classList.toggle('labels-on', st.z >= LABEL_ZOOM);
  };
  // Proportions réelles de l'image (celles enregistrées peuvent être fausses)
  const bg = root.querySelector('img.map-bg');
  if (bg) {
    const fit = () => {
      if (!bg.naturalWidth) return;
      const r = bg.naturalHeight / bg.naturalWidth;
      if (Math.abs(r - ratio) > 0.005) {
        ratio = r;
        view.setAttribute('style', size(r));
        apply();
        onRatio?.(r);
      }
    };
    if (bg.complete) fit();
    else bg.addEventListener('load', fit, { once: true });
  }
  const zoomAt = (factor, cx, cy) => {
    const r = view.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const px = (cx - r.left) / r.width, py = (cy - r.top) / r.height, z0 = st.z;
    st.z = Math.min(8, Math.max(1, st.z * factor));
    st.fx = px - ((px - st.fx) * st.z) / z0;
    st.fy = py - ((py - st.fy) * st.z) / z0;
    apply();
  };
  view.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY);
  }, { passive: false });
  // Plein écran : gardé entre deux affichages
  const fullBtn = root.querySelector('[data-z="full"]');
  const setBig = (on) => {
    st.big = on;
    view.classList.toggle('big', on);
    fullBtn.textContent = on ? '✕' : '⛶';
    fullBtn.setAttribute('aria-label', on ? 'Quitter le plein écran' : 'Plein écran');
  };
  setBig(!!st.big);
  root.querySelector('.map-ctl').addEventListener('click', (e) => {
    const z = e.target.closest('[data-z]')?.dataset.z;
    if (z == null) return;
    if (z === 'full') return setBig(!st.big);
    const r = view.getBoundingClientRect();
    if (z === '0') Object.assign(st, { z: 1, fx: 0, fy: 0 });
    else zoomAt(z === '1' ? 1.4 : 1 / 1.4, r.left + r.width / 2, r.top + r.height / 2);
    apply();
  });
  // Met à jour la position d'un nom pendant qu'on déplace son île ou le nom lui-même
  const moveLabel = (id, isl) => {
    const lab = [...stage.querySelectorAll('.isl-label')].find((x) => x.dataset.for === id);
    if (lab) lab.setAttribute('style', labelPos(isl));
  };
  // Glisser : déplace la vue ; en mode « Placer », déplace, redimensionne ou tourne une île, ou déplace son nom.
  const ptrs = new Map();
  let drag = null, pinch = null;
  view.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.map-ctl')) return;
    view.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: st.z };
      drag = null;
      return;
    }
    const label = placing ? e.target.closest('[data-label-of]')?.dataset.labelOf ?? null : null;
    const target = label ? null : e.target.closest('[data-island]');
    const handle = placing && target ? e.target.closest('[data-h]')?.dataset.h ?? null : null;
    drag = { x: e.clientX, y: e.clientY, fx: st.fx, fy: st.fy, isl: placing ? target : null, label, handle, moved: false, target, link: e.target.closest('[data-link]')?.dataset.link };
    if (handle) {
      // Centre de l'île à l'écran : la taille et l'angle se mesurent depuis là
      const r = target.getBoundingClientRect(), isl = nodes[target.dataset.island];
      Object.assign(drag, { cx: r.left + r.width / 2, cy: r.top + r.height / 2, size0: isl.size, rot0: isl.rot || 0 });
      drag.d0 = Math.hypot(e.clientX - drag.cx, e.clientY - drag.cy) || 1;
      drag.a0 = Math.atan2(e.clientY - drag.cy, e.clientX - drag.cx);
    }
  });
  view.addEventListener('pointermove', (e) => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      zoomAt((pinch.z * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.d)) / st.z, (a.x + b.x) / 2, (a.y + b.y) / 2);
      return;
    }
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    drag.moved = true;
    const r = stage.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * 100, py = ((e.clientY - r.top) / r.height) * 100;
    if (drag.label) {
      // Le nom : position par rapport au centre de l'île, en multiples de sa largeur
      const isl = nodes[drag.label];
      const clamp = (v) => Math.round(Math.min(3, Math.max(-3, v)) * 100) / 100;
      drag.lx = clamp((px - isl.x) / isl.size);
      drag.ly = clamp(((py - isl.y) * ratio) / isl.size);
      moveLabel(drag.label, { ...isl, lx: drag.lx, ly: drag.ly });
    } else if (drag.isl) {
      const id = drag.isl.dataset.island, isl = nodes[id];
      drag.isl.classList.add('dragging');
      if (drag.handle === 'size') {
        const s = Math.min(60, Math.max(1, drag.size0 * (Math.hypot(e.clientX - drag.cx, e.clientY - drag.cy) / drag.d0)));
        drag.size = Math.round(s * 10) / 10;
        drag.isl.style.width = `${drag.size}%`;
        moveLabel(id, { ...isl, size: drag.size });
      } else if (drag.handle === 'rot') {
        let a = drag.rot0 + ((Math.atan2(e.clientY - drag.cy, e.clientX - drag.cx) - drag.a0) * 180) / Math.PI;
        if (e.shiftKey) a = Math.round(a / 15) * 15;
        drag.rot = ((Math.round(a) % 360) + 360) % 360;
        const art = drag.isl.querySelector('.isl-art');
        if (art) art.style.transform = `rotate(${drag.rot}deg)`;
      } else {
        const x = Math.min(100, Math.max(0, px)), y = Math.min(100, Math.max(0, py));
        drag.isl.style.left = `${x}%`;
        drag.isl.style.top = `${y}%`;
        moveLabel(id, { ...isl, x, y });
      }
    } else {
      const vr = view.getBoundingClientRect();
      if (!vr.width || !vr.height) return;
      st.fx = drag.fx + dx / vr.width;
      st.fy = drag.fy + dy / vr.height;
      apply();
    }
  });
  const end = (e) => {
    ptrs.delete(e.pointerId);
    if (ptrs.size < 2) pinch = null;
    if (!drag) return;
    const d = drag;
    drag = null;
    if (d.label && d.moved) onPlace?.(d.label, { lx: d.lx, ly: d.ly });
    else if (d.isl && d.moved) {
      d.isl.classList.remove('dragging');
      const id = d.isl.dataset.island, isl = nodes[id];
      onPlace?.(id, { x: parseFloat(d.isl.style.left), y: parseFloat(d.isl.style.top), size: d.size ?? isl.size, rot: d.rot ?? isl.rot ?? 0 });
    } else if (!d.moved && d.target) onIsland?.(d.target.dataset.island, e);
    else if (!d.moved && d.link) onLink?.(d.link);
    else if (!d.moved && !d.label) onBlank?.();
  };
  view.addEventListener('pointerup', end);
  view.addEventListener('pointercancel', end);
  new ResizeObserver(apply).observe(view);
  apply();
}

/* Vue joueur */
let mapSel = null;
function renderMap() {
  if (!S || ADMIN) return;
  const m = MAP;
  const el = $('v-map');
  if (!m || (!m.bg && !Object.keys(m.islands).length)) {
    el.innerHTML = `<div class="no-shop">${ico(231)}<h2>Carte du monde</h2><p class="note">La carte n’est pas encore dessinée.</p></div>`;
    return;
  }
  const isl = mapSel && m.islands[mapSel];
  const t = m.travel?.[mapSel];
  const trip = !isl || mapSel === m.here || !m.here ? ''
    : t ? ` · Trajet depuis ton île : <b>${t.value}</b>${t.via?.length ? ` (via ${t.via.map(esc).join(', ')})` : ''}`
    : ' · Aucune route connue depuis ton île';
  el.innerHTML = `
    <div class="sec-head"><div><h2>Carte du monde</h2><p class="lede" style="margin:0">${m.voyage ? `⛵ En mer à bord de <b>${esc(m.voyage.ship)}</b>, vers <b>${esc(m.voyage.toName)}</b> (${m.voyage.done}/${m.voyage.needed}).` : m.here ? `Tu es sur <b>${esc(m.islands[m.here].name)}</b>.` : 'Ta position n’est sur aucune île de la carte.'} Zoome avec la molette ou deux doigts, fais glisser pour te déplacer.</p></div></div>
    <div id="map-player"></div>
    <div class="isl-info" id="isl-info">${isl ? `
      <div class="isl-head">${isl.img ? `<img src="${imgSrc(isl.img)}" alt="">` : ''}<div><h3>${esc(isl.name)}</h3>
        <p class="note" style="margin:0">${mapSel === m.here ? '📍 Tu es ici · ' : ''}${isl.accessible ? 'Accessible' : '⛔ Inaccessible'}${trip}</p></div></div>
      ${isl.desc ? `<p>${esc(isl.desc)}</p>` : ''}
      ${isl.channels.length ? `<div class="pax">${isl.channels.map((c) => `<span>${c.kind === 'forum' ? '🗂️' : '#'} ${esc(c.name)}</span>`).join('')}</div>` : ''}` : '<p class="note" style="margin:0">Clique sur une île pour en savoir plus.</p>'}</div>`;
  mapViewer($('map-player'), m, { boat: m.voyage, here: m.here, selected: mapSel, onIsland: (id) => ((mapSel = id), renderMap()) });
}

/* Éditeur du staff */
let amap = null, islandDraft = null, islandDraftId = null;
// Mode de l'éditeur : 'view' (consulter : rien ne bouge), 'place' (déplacer, redimensionner, tourner), 'links' (tracer des routes)
let mapMode = 'view', linkFrom = null, placeSel = null;
const MODE_HELP = {
  view: 'Clique sur une île pour la modifier. Rien ne bouge par erreur : pour déplacer les îles, passe en mode « Placer les îles ».',
  place: 'Fais glisser une île pour la déplacer. Clique dessus pour ses poignées : le carré blanc la redimensionne, le rond la fait tourner (Maj : par pas de 15°).',
    links: 'Clique sur un point, puis sur un autre pour tracer une route. Maj + clic sur le second : route à sens unique (➤). Clique sur une route pour la supprimer.',
};
const nodeLabel = (id) => {
  const n = amap?.islands[id];
  return n ? `${n.kind === 'waypoint' ? '◆ ' : ''}${esc(n.name)}` : '?';
};
async function loadAdminMap() {
  try {
    amap = (await API.staff('map.get')).map;
  } catch (err) {
    toast(esc(err.message));
    amap = G.normalizeMap({});
  }
  renderAdminMap();
}
async function mapCall(op, payload) {
  setBusy(1);
  try {
    const out = await API.staff(op, payload);
    amap = out.map;
    if (out.toast) toast(esc(out.toast));
    renderAdminMap();
    return out;
  } catch (err) {
    toast(esc(err.message));
    return null;
  } finally {
    setBusy(-1);
  }
}
function renderAdminMap() {
  if (!tools()) return;
  const el = $('v-amap');
  if (!amap) return void (el.innerHTML = '<p class="note">Chargement de la carte…</p>');
  if (placeSel && !amap.islands[placeSel]) placeSel = null;
  const ids = Object.keys(amap.islands);
  const card = (id) => {
       const i = amap.islands[id], nb = G.linksOf(amap, id).length;
    const routes = `${nb} route${nb > 1 ? 's' : ''}`;
    return `<button class="gest-card" data-isl="${esc(id)}">
      <span class="slot-ico">${i.kind === 'waypoint' ? '<span class="wp-dot" style="--z:1"></span>' : i.img ? `<span class="ico item-img"><img src="${imgSrc(i.img)}" alt=""></span>` : ico(206)}</span>
      <span><b>${nodeLabel(id)}</b><small>${i.kind === 'waypoint' ? `Point de passage · ${routes}` : `${i.visible ? 'Visible' : '👁 Cachée'} · ${i.accessible ? 'Accessible' : '⛔ Inaccessible'} · ${i.channels.length} salon${i.channels.length > 1 ? 's' : ''} · ${routes}`}</small></span>
    </button>`;
  };
  const help = mapMode === 'links' && linkFrom ? `Clique sur le point à relier à <b>${nodeLabel(linkFrom)}</b>.` : MODE_HELP[mapMode];
  el.innerHTML = `
    <div class="sec-head">
      <div><h2>Carte</h2></div>
      <div class="se-row">
        <button class="btn ghost" id="amap-bg-file">Fond de carte (fichier)</button><button class="btn ghost" id="amap-bg-link">Fond (lien)</button>
        <button class="btn ghost" id="amap-wp">+ Point de passage</button><button class="btn" id="amap-new">+ Île</button>
      </div>
    </div>
    <div class="map-modes">
      <div class="seg" role="group" aria-label="Mode de l’éditeur">
        <button data-mm="view" aria-pressed="${mapMode === 'view'}">👆 Consulter</button>
        <button data-mm="place" aria-pressed="${mapMode === 'place'}">✋ Placer les îles</button>
        <button data-mm="links" aria-pressed="${mapMode === 'links'}">🧭 Tracer des routes</button>
      </div>
      <p class="note" style="margin:0">${help}</p>
      <label class="pace">Rythme des voyages <input id="amap-pace" type="number" min="0.1" max="10" step="0.1" value="${amap.pace ?? 0.5}" title="Actions RP par unité de distance pour un bateau de vitesse 10"></label>
    </div>
    <div id="map-admin"></div>
    ${ids.length ? `<div class="fleet-list" style="margin-top:12px">${ids.map(card).join('')}</div>` : '<p class="note">Aucune île. Ajoute un fond de carte, puis des îles (PNG transparents).</p>'}`;
  mapViewer($('map-admin'), amap, {
    editable: true,
    placing: mapMode === 'place',
    showLinks: true,
    selected: mapMode === 'place' ? placeSel : null,
    linkFrom: mapMode === 'links' ? linkFrom : null,
    onIsland: (id, ev) => {
      if (mapMode === 'view') return openIslandEdit(id);
      if (mapMode === 'place') {
        placeSel = placeSel === id ? null : id;
        return renderAdminMap();
      }
      // Tracer des routes
      if (!linkFrom || linkFrom === id) {
        linkFrom = linkFrom === id ? null : id;
        return renderAdminMap();
      }
      const a = linkFrom;
      linkFrom = null;
      if (amap.links[G.routeKey(a, id)] !== undefined) {
        toast('Ces deux points sont déjà reliés.');
        return renderAdminMap();
      }
      // Maj + clic sur le second point : route à sens unique (du premier vers le second)
      mapCall('map.link', { a, b: id, value: null, oneway: ev?.shiftKey ? a : null });
    },
    onBlank: () => {
      if (mapMode === 'place' && placeSel) {
        placeSel = null;
        renderAdminMap();
      }
    },
    onLink: async (k) => {
      if (mapMode !== 'links') return; // supprimer une route seulement dans ce mode
      const [a, b] = k.split('|');
      if (await askConfirm(`Route entre ${amap.islands[a].name} et ${amap.islands[b].name}.`, { title: 'Supprimer cette route ?', ok: 'Supprimer', danger: true })) mapCall('map.unlink', { a, b });
    },
    onPlace: (id, p) => {
      placeSel = id;
      mapCall('map.island.move', { id, ...p });
    },
    // proportions enregistrées fausses : on corrige (les temps de trajet en dépendent)
    onRatio: (r) => mapCall('map.bg', { bg: amap.bg, ratio: r }),
  });
  paintStatic(el);
}
$('v-amap').addEventListener('click', async (e) => {
  const mm = e.target.closest('[data-mm]')?.dataset.mm;
  if (mm) {
    mapMode = mm;
    linkFrom = null;
    placeSel = null;
    return renderAdminMap();
  }
  if (e.target.closest('#amap-new')) return openIslandEdit(null);
  if (e.target.closest('#amap-wp')) return void mapCall('map.island.save', { id: null, island: { kind: 'waypoint', name: 'Passage', x: 50, y: 50 } });
  const i = e.target.closest('[data-isl]')?.dataset.isl;
  if (i) return openIslandEdit(i);
  if (e.target.closest('#amap-bg-file')) return $('amap-file').click();
  if (e.target.closest('#amap-bg-link')) {
    const v = await askText('Colle le lien de l’image du fond de carte.', { title: 'Fond de carte', ok: 'Valider', placeholder: 'https://…', max: 2000 });
    if (!v) return;
    if (!/^https?:\/\//.test(v)) return toast('Le lien doit commencer par http:// ou https://');
    setMapBg(v);
  }
});
/** Fond de carte : on mesure l'image pour garder ses proportions. */
function setMapBg(src) {
  const img = new Image();
  img.onload = () => mapCall('map.bg', { bg: src, ratio: img.naturalHeight / img.naturalWidth });
  img.onerror = () => mapCall('map.bg', { bg: src });
  img.src = mediaSrc(src);
}
$('amap-file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f?.type.startsWith('image/')) return;
  if (f.size > 20 * 1024 * 1024) return toast('Image trop lourde (20 Mo maximum).');
  setMapBg(await readImage(f, { max: 3000 }));
});

function openIslandEdit(id) {
  islandDraftId = id;
  islandDraft = structuredClone(id ? amap.islands[id] : { kind: 'island', name: '', desc: '', img: null, x: 50, y: 50, size: 8, visible: true, accessible: true, channels: [] });
  $('isl-title').textContent = id ? islandDraft.name : 'Nouvelle île';
  $('isl-del').hidden = !id;
  $('isl-err').textContent = '';
  renderIslandEdit();
  openDialog('d-island');
}
function renderIslandEdit() {
  const d = islandDraft, wp = d.kind === 'waypoint';
  const nb = islandDraftId ? G.linksOf(amap, islandDraftId) : [];
  const free = Object.keys(amap.islands).filter((o) => o !== islandDraftId && !nb.some((n) => n.id === o));
  const dests = Object.keys(amap.islands).filter((o) => o !== islandDraftId && amap.islands[o].kind !== 'waypoint');
  $('isl-body').innerHTML = `
    <div class="form">
      <div class="wide"><label for="isl-name">${wp ? 'Nom du point de passage (vu par le staff seulement)' : 'Nom de l’île'}</label><input id="isl-name" value="${esc(d.name)}" maxlength="60"></div>
      ${wp ? `<div class="isl-flags"><label class="chk"><input type="checkbox" id="isl-access" ${d.accessible ? 'checked' : ''}> Praticable (les routes peuvent y passer)</label></div>` : `
      <div class="wide"><label for="isl-desc">Description</label><input id="isl-desc" value="${esc(d.desc)}" maxlength="600"></div>
            <div><label for="isl-size">Taille sur la carte : <b id="isl-size-v">${d.size}</b> %</label><input id="isl-size" type="range" min="1" max="60" step="0.5" value="${d.size}"></div>
      <div><label for="isl-rot">Rotation : <b id="isl-rot-v">${d.rot || 0}</b>°</label><input id="isl-rot" type="range" min="0" max="359" step="1" value="${d.rot || 0}"></div>
      <div class="isl-flags">
        <label class="chk"><input type="checkbox" id="isl-visible" ${d.visible ? 'checked' : ''}> Visible par tous</label>
        <label class="chk"><input type="checkbox" id="isl-access" ${d.accessible ? 'checked' : ''}> Accessible</label>
      </div>
      ${glFieldsHTML(d)}`}
    </div>
    ${wp ? '<p class="note">Invisible pour les joueurs : il sert à forcer le chemin des routes (entrée de Reverse Mountain, traversée de la Calm Belt…). Pour que les joueurs voient « via Reverse Mountain », fais-en plutôt une île.</p>' : `
    <div class="img-field" style="margin-top:12px">
      <div class="prev isl-prev">${d.img ? `<img src="${imgSrc(d.img)}" alt="">` : ico(206)}</div>
      <div class="se-face-ctl">
        <b>Image de l’île (PNG transparent)</b>
        <div class="se-row"><button type="button" class="btn sm" id="isl-pick">Choisir une image</button><input type="file" id="isl-file" accept="image/png,image/webp,image/gif" hidden>${d.img ? '<button type="button" class="btn sm ghost" id="isl-noimg">Retirer</button>' : ''}</div>
        <div class="ph-url-row"><input type="url" id="isl-url" placeholder="ou un lien https://…" autocomplete="off"><button type="button" class="btn sm" id="isl-url-go">Utiliser</button></div>
      </div>
    </div>
    <h3 class="ed-h">Salons de l’île</h3>
    <div class="pax">${d.channels.map((c, i) => `<span>${c.kind === 'forum' ? '🗂️' : '#'} ${esc(c.name || c.id)} <button class="linklike" data-chdel="${i}" aria-label="Retirer">✕</button></span>`).join('') || '<span class="note">Aucun salon.</span>'}</div>
    <div class="ph-url-row"><input id="isl-ch" inputmode="numeric" placeholder="ID d’un salon ou d’un forum"><button type="button" class="btn sm" id="isl-ch-add">Ajouter</button></div>
    <p class="note" style="margin:4px 0 0">Un forum entier peut appartenir à l’île : chacun de ses posts compte alors comme étant sur l’île. Le nom des salons est retrouvé à l’enregistrement.</p>`}
    ${islandDraftId ? `
      <h3 class="ed-h">Routes maritimes</h3>
      <div class="routes">${nb.map((n) => `<div class="route-row route-dir"><span>${nodeLabel(n.id)}</span><select data-dir="${esc(n.id)}" aria-label="Sens de la route"><option value="both" ${n.dir === 'both' ? 'selected' : ''}>↔ Les deux sens</option><option value="out" ${n.dir === 'out' ? 'selected' : ''}>→ Vers ${esc(amap.islands[n.id].name)} seulement</option><option value="in" ${n.dir === 'in' ? 'selected' : ''}>← Depuis ${esc(amap.islands[n.id].name)} seulement</option></select><select data-rdiff="${esc(n.id)}" aria-label="Difficulté de la route">${G.ROUTE_DIFFS.map((l, i) => `<option value="${i + 1}" ${G.linkDiff(amap, islandDraftId, n.id) === i + 1 ? 'selected' : ''}>${l}</option>`).join('')}</select><input type="number" min="0" data-seg="${esc(n.id)}" value="${n.auto ? '' : n.value}" placeholder="auto : ${n.value}" aria-label="Temps du tronçon vers ${esc(amap.islands[n.id].name)}"><button type="button" class="linklike" data-unseg="${esc(n.id)}" aria-label="Supprimer cette route">✕</button></div>`).join('') || '<p class="note" style="margin:0">Aucune route : ce point est isolé, on ne peut pas y aller.</p>'}</div>
      ${free.length ? `<div class="mj-row" style="margin-top:6px"><select id="isl-seg-to" aria-label="Relier à">${free.map((o) => `<option value="${esc(o)}">${nodeLabel(o)}</option>`).join('')}</select><button type="button" class="btn sm" id="isl-seg-add">Relier</button></div>` : ''}
      <p class="note">Temps d’un tronçon : vide = selon sa longueur sur la carte. Tu peux aussi tracer les routes directement sur la carte (« Tracer des routes »).</p>
      ${!wp && dests.length ? `<h3 class="ed-h">Temps de trajet depuis cette île</h3>
      <div class="routes">${dests.map((o) => {
        const t = G.travelTime(amap, islandDraftId, o);
        const via = t ? t.path.slice(1, -1).map(nodeLabel).join(', ') : '';
        return `<div class="route-row trip-row"><span>${esc(amap.islands[o].name)}</span><b>${t ? t.value : '—'}</b><small class="note">${t ? (via ? `via ${via}` : 'route directe') : 'aucune route'}</small></div>`;
      }).join('')}</div>` : ''}`
    : '<p class="note">Enregistre d’abord, puis trace ses routes.</p>'}`;
}
/** Réglages Grand Line d'une île : Log Pose, recharge, île(s) suivante(s). */
function glFieldsHTML(d) {
  const others = Object.entries(amap.islands).filter(([id, i]) => id !== islandDraftId && i.kind !== 'waypoint');
  return `<div class="wide work-box"><label class="chk"><input type="checkbox" id="isl-gl" ${d.grandLine ? 'checked' : ''}> 🧭 Île de Grand Line (Log Pose)</label>
    ${d.grandLine ? `<div class="mj-row"><label for="isl-recharge">Recharge du Log Pose (heures)</label><input id="isl-recharge" type="number" min="0" max="720" value="${d.recharge ?? 12}"></div>
    <label class="chk"><input type="checkbox" id="isl-choose" ${d.choose ? 'checked' : ''}> Embranchement : le navigateur choisit son chemin (ex. Reverse Mountain)</label>
    <b style="font-size:14px">Île(s) suivante(s) indiquée(s) par le Log Pose</b>
    <div class="perms">${others.map(([id, i]) => `<label><input type="checkbox" data-gl-next="${esc(id)}" ${(d.next || []).includes(id) ? 'checked' : ''}> ${esc(i.name)}</label>`).join('') || '<span class="note">Aucune autre île.</span>'}</div>
    <p class="note" style="margin:0">Plusieurs îles cochées : le Log Pose en choisit une au hasard à chaque escale. Décoche « Visible par tous » sur les îles à découvrir.</p>` : ''}</div>`;
}
function readIslandEdit() {
  const d = islandDraft;
  d.name = $('isl-name').value;
  if ($('isl-access')) d.accessible = $('isl-access').checked;
  if (d.kind === 'waypoint') return;
  d.desc = $('isl-desc').value;
  d.size = +$('isl-size').value;
  d.rot = +$('isl-rot').value;
  d.visible = $('isl-visible').checked;
  d.grandLine = !!$('isl-gl')?.checked;
  if ($('isl-choose')) d.choose = $('isl-choose').checked;
  if ($('isl-recharge')) d.recharge = Math.max(0, Math.round(+$('isl-recharge').value || 0));
  if (document.querySelector('#isl-body [data-gl-next]')) d.next = [...document.querySelectorAll('#isl-body [data-gl-next]')].filter((c) => c.checked).map((c) => c.dataset.glNext);
}
/** Change une route depuis la fiche d'une île, puis réaffiche la fiche. */
async function segCall(op, payload) {
  readIslandEdit();
  if (await mapCall(op, payload)) renderIslandEdit();
}
$('d-island').addEventListener('input', (e) => {
  if (e.target.id === 'isl-size') $('isl-size-v').textContent = e.target.value;
    if (e.target.id === 'isl-rot') $('isl-rot-v').textContent = e.target.value;
});
$('d-island').addEventListener('change', async (e) => {
  const rd = e.target.dataset?.rdiff;
  if (rd) return segCall('map.diff', { a: islandDraftId, b: rd, diff: +e.target.value });
  if (e.target.id === 'isl-gl') {
    readIslandEdit();
    return renderIslandEdit();
  }
  const dirTo = e.target.dataset?.dir;
  if (dirTo) {
    const v = e.target.value;
    return segCall('map.dir', { a: islandDraftId, b: dirTo, from: v === 'both' ? null : v === 'out' ? islandDraftId : dirTo });
  }
  const o = e.target.dataset?.seg;
  if (o) {
    const v = e.target.value.trim();
    return segCall('map.link', { a: islandDraftId, b: o, value: v === '' ? null : Math.max(0, Math.round(+v)) });
  }
  if (e.target.id === 'isl-file') {
    const f = e.target.files[0];
    if (!f?.type.startsWith('image/')) return;
    if (f.size > 20 * 1024 * 1024) return void ($('isl-err').textContent = 'Image trop lourde (20 Mo maximum).');
    readIslandEdit();
    islandDraft.img = await readImage(f, { max: 1200 });
    renderIslandEdit();
  }
});
$('d-island').addEventListener('click', (e) => {
  const un = e.target.closest('[data-unseg]')?.dataset.unseg;
  if (un) return void segCall('map.unlink', { a: islandDraftId, b: un });
  if (e.target.id === 'isl-seg-add') return void segCall('map.link', { a: islandDraftId, b: $('isl-seg-to').value, value: null });
  if (e.target.id === 'isl-pick') return $('isl-file').click();
  if (e.target.id === 'isl-noimg') {
    readIslandEdit();
    islandDraft.img = null;
    return renderIslandEdit();
  }
  if (e.target.id === 'isl-url-go') {
    const v = $('isl-url').value.trim();
    if (!/^https?:\/\//.test(v)) return void ($('isl-err').textContent = 'Le lien doit commencer par http:// ou https://');
    readIslandEdit();
    islandDraft.img = v;
    return renderIslandEdit();
  }
  if (e.target.id === 'isl-ch-add') {
    const v = $('isl-ch').value.trim();
    if (!v) return;
    readIslandEdit();
    if (!islandDraft.channels.some((c) => c.id === v)) islandDraft.channels.push({ id: v, name: '' });
    return renderIslandEdit();
  }
  const del = e.target.closest('[data-chdel]')?.dataset.chdel;
  if (del != null) {
    readIslandEdit();
    islandDraft.channels.splice(+del, 1);
    renderIslandEdit();
  }
});
$('isl-save').addEventListener('click', async () => {
  readIslandEdit();
  if (!islandDraft.name.trim()) return void ($('isl-err').textContent = 'Donne un nom.');
  $('isl-save').disabled = true;
  $('isl-err').textContent = islandDraft.img?.startsWith('data:') ? 'Envoi de l’image…' : '';
  const { x, y, ...rest } = islandDraft;
  const out = await mapCall('map.island.save', { id: islandDraftId, island: islandDraftId ? rest : islandDraft });
  $('isl-save').disabled = false;
  if (out) closeDialog($('d-island'));
  else $('isl-err').textContent = '';
});
$('isl-del').addEventListener('click', async () => {
  if (!(await askConfirm('Ce point et ses routes seront supprimés. Les salons restent des salons RP.', { title: `Supprimer ${islandDraft.name} ?`, ok: 'Supprimer', danger: true }))) return;
  if (await mapCall('map.island.delete', { id: islandDraftId })) closeDialog($('d-island'));
});
/* ═══ Gestion (staff) : base d'objets et recettes ════════════════════════ */
let gestTab = 'items', gestQuery = '';
let itemDraft = null, itemDraftId = null, recipeDraft = null, recipeDraftId = null;
function renderGestion() {
  if (!tools()) return;
  const q = gestQuery.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const match = (s) => !q || s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().includes(q);
  // Filtres et tri (barre sous la recherche)
  const rIdx = (id) => G.RARITIES.findIndex((r) => r.key === G.rarityOf(id).key);
  const kindIdx = (k) => Object.keys(KIND).indexOf(k);
  const items = Object.entries(G.ITEMS)
    .filter(([id, it]) => match(it.name) && (!gestF.kind || it.kind === gestF.kind) && (!gestF.rarity || G.rarityOf(id).key === gestF.rarity))
    .sort((a, b) => {
      const byName = a[1].name.localeCompare(b[1].name);
      if (gestF.sort === 'kind') return kindIdx(a[1].kind) - kindIdx(b[1].kind) || byName;
      if (gestF.sort === 'rarity') return rIdx(b[0]) - rIdx(a[0]) || byName;
      if (gestF.sort === 'value') return (b[1].value || 0) - (a[1].value || 0) || byName;
      if (gestF.sort === 'weight') return (b[1].weight || 0) - (a[1].weight || 0) || byName;
      return byName;
    });
  const rType = (r) => (r.work ? 'work' : r.care ? 'care' : 'craft');
  const jobIdx = (j) => (j ? Object.keys(JOBS).indexOf(j) : 99);
  const recs = Object.entries(G.RECIPES)
    .filter(([, r]) => match(G.recipeLabel(r)) && (!gestF.job || (gestF.job === 'none' ? !r.job : r.job === gestF.job)) && (!gestF.rtype || rType(r) === gestF.rtype))
    .sort((a, b) => {
      const byName = G.recipeLabel(a[1]).localeCompare(G.recipeLabel(b[1]));
      if (gestF.rsort === 'job') return jobIdx(a[1].job) - jobIdx(b[1].job) || byName;
      if (gestF.rsort === 'time') return (a[1].seconds || 0) - (b[1].seconds || 0) || byName;
      return byName;
    });
  $('v-gest').innerHTML = `
    <div class="sec-head">
      <div><h2>Gestion</h2><p class="lede" style="margin:0">Les objets et les recettes du RP. La boutique de ce salon se gère dans l’écran Boutique.</p></div>
    </div>
    <div class="shop-bar">
      <div class="seg" role="group" aria-label="Section">
        <button aria-pressed="${gestTab === 'items'}" data-gt="items">Objets (${Object.keys(G.ITEMS).length})</button>
        <button aria-pressed="${gestTab === 'recipes'}" data-gt="recipes">Recettes (${Object.keys(G.RECIPES).length})</button>
        <button aria-pressed="${gestTab === 'injuries'}" data-gt="injuries">Blessures (${Object.keys(G.INJURIES).length})</button>
      </div>
      <input class="mj-search gest-search" id="gest-q" type="search" placeholder="Chercher…" value="${esc(gestQuery)}" aria-label="Chercher">
      <button class="btn" id="gest-new">${gestTab === 'items' ? '+ Nouvel objet' : gestTab === 'injuries' ? '+ Nouvelle catégorie' : '+ Nouvelle recette'}</button>
    </div>
    ${gestFiltersHTML()}
    ${gestTab === 'injuries' ? injuriesHTML() : gestTab === 'items'
      ? items.length ? `<div class="gest-grid">${items.map(([id, it], i) => `${gestF.sort === 'kind' && (i === 0 || items[i - 1][1].kind !== it.kind) ? `<h3 class="ed-h gest-group">${KIND[it.kind]}</h3>` : ''}
          <button class="gest-card" data-item="${esc(id)}">
            <span class="slot-ico">${itemIco(id)}</span>
            <span><b ${G.rarityOf(id).key !== 'commun' ? `style="color:${G.rarityOf(id).color}"` : ''}>${esc(it.name)}</b><small>${KIND[it.kind]} · ${G.rarityOf(id).name} · ${it.value ? berry(it.value) : 'invendable'}${it.kind === 'bateau' ? ` · cale ${G.kg(it.ship.capacity)}, vitesse ${it.ship.sail}, ${it.ship.berths} places${it.ship.cannons ? `, ${it.ship.cannons} canons` : ''}` : ` · ${G.kg(it.weight || 0)}`}${it.kind === 'amelioration' ? ` · +${fmt(it.upgrade.amount)} ${G.UPGRADES[it.upgrade.type].unit}` : ''}</small></span>
          </button>`).join('')}</div>` : '<p class="note">Aucun objet. Crée le premier avec « + Nouvel objet ».</p>'
      : recs.length ? `<div class="gest-grid">${recs.map(([id, r], i) => `${gestF.rsort === 'job' && (i === 0 || recs[i - 1][1].job !== r.job) ? `<h3 class="ed-h gest-group">${r.job ? JOBS[r.job].name : 'Tous métiers'}</h3>` : ''}
          <button class="gest-card" data-recipe="${esc(id)}">
            <span class="slot-ico">${recipeIco(r)}</span>
            <span><b>${esc(G.recipeLabel(r))}</b><small>${r.job ? `${JOBS[r.job].name}${JOBS[r.job].noLevel ? '' : ` · ${JOB_LEVELS[r.lvl - 1]}`}` : 'Tous métiers'} · ${r.seconds ? G.duree(r.seconds) : 'immédiat'} · ${Object.entries(r.needs).map(([k, q]) => `${q} ${esc(itemOf(k).name)}`).join(', ') || 'sans ingrédient'}</small></span>
          </button>`).join('')}</div>` : `<p class="note">${Object.keys(G.ITEMS).length ? 'Aucune recette. Crée la première avec « + Nouvelle recette ».' : 'Crée d’abord des objets : une recette transforme des objets en d’autres objets.'}</p>`}`;
}
$('v-gest').addEventListener('input', (e) => {
  if (e.target.id !== 'gest-q') return;
  gestQuery = e.target.value;
  const pos = e.target.selectionStart;
  renderGestion();
  const inp = $('gest-q');
  inp.focus();
  inp.setSelectionRange(pos, pos);
});
$('v-gest').addEventListener('click', (e) => {
  const gt = e.target.closest('[data-gt]')?.dataset.gt;
  if (gt) {
    gestTab = gt;
    return renderGestion();
  }
  const ren = e.target.closest('[data-inj-ren]')?.dataset.injRen;
  if (ren) {
    return void askText('Nouveau nom de la catégorie.', { title: 'Renommer', ok: 'Renommer', value: G.INJURIES[ren]?.name || '', max: 40 })
      .then((name) => name && gestCall('injury.save', { id: ren, name }));
  }
  const del = e.target.closest('[data-inj-del]')?.dataset.injDel;
  if (del) {
    return void askConfirm('Les blessures et les soins de cette catégorie redeviendront de simples « Blessures ».', { title: `Supprimer « ${G.INJURIES[del]?.name} » ?`, ok: 'Supprimer', danger: true })
      .then((ok) => ok && gestCall('injury.delete', { id: del }));
  }
  if (e.target.closest('#gest-new') && gestTab === 'injuries') {
    return void askText('Nom de la catégorie de blessure.', { title: 'Nouvelle catégorie', ok: 'Créer', placeholder: 'Ex. Fracture, Brûlure, Plaie…', max: 40 })
      .then((name) => name && gestCall('injury.save', { name }));
  }
  if (e.target.closest('#gest-new')) return gestTab === 'items' ? openItemEdit() : openRecipeEdit();
  const it = e.target.closest('[data-item]')?.dataset.item;
  if (it) return openItemEdit(it);
  const rc = e.target.closest('[data-recipe]')?.dataset.recipe;
  if (rc) return openRecipeEdit(rc);
});
/** Filtres et tri de Gestion (objets et recettes). */
let gestF = { kind: '', rarity: '', sort: 'name', job: '', rtype: '', rsort: 'name' };
function gestFiltersHTML() {
  const sel = (key, label, opts) => `<label class="flt"><span>${label}</span><select data-gf="${key}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${gestF[key] === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
  if (gestTab === 'items') {
    return `<div class="filters">
      ${sel('kind', 'Catégorie', [['', 'Toutes'], ...Object.entries(KIND)])}
      ${sel('rarity', 'Rareté', [['', 'Toutes'], ...G.RARITIES.map((r) => [r.key, r.name])])}
      ${sel('sort', 'Trier par', [['name', 'Nom'], ['kind', 'Catégorie'], ['rarity', 'Rareté'], ['value', 'Valeur'], ['weight', 'Poids']])}
    </div>`;
  }
  if (gestTab === 'recipes') {
    return `<div class="filters">
      ${sel('job', 'Métier', [['', 'Tous'], ...Object.entries(JOBS).map(([k, j]) => [k, j.name]), ['none', 'Tous métiers (sans métier)']])}
      ${sel('rtype', 'Type', [['', 'Toutes'], ['craft', 'Fabrication'], ['work', 'Travail sur bateau'], ['care', 'Soin']])}
      ${sel('rsort', 'Trier par', [['name', 'Nom'], ['job', 'Métier'], ['time', 'Durée']])}
    </div>`;
  }
  return '';
}
$('v-gest').addEventListener('change', (e) => {
  const k = e.target.dataset?.gf;
  if (!k) return;
  gestF[k] = e.target.value;
  renderGestion();
});
/** Onglet « Blessures » de Gestion : catégories de blessures. */
function injuriesHTML() {
  const list = Object.entries(G.INJURIES).sort((a, b) => a[1].name.localeCompare(b[1].name));
  return `<p class="note">Les catégories de blessures (fracture, brûlure, plaie…). Chaque soin du médecin peut viser une catégorie précise : une brûlure ne se soigne pas avec une attelle.</p>
    ${list.length ? `<div class="gest-grid">${list.map(([id, c]) => {
      const n = Object.values(G.RECIPES).filter((r) => r.care?.type === id).length;
      return `<div class="gest-card inj-card"><span class="slot-ico">${icon('stat-resistance')}</span><span><b>${esc(c.name)}</b><small>${n} soin${n > 1 ? 's' : ''} dédié${n > 1 ? 's' : ''}</small></span><span class="m-acts"><button class="btn sm ghost" data-inj-ren="${esc(id)}">Renommer</button><button class="btn sm ghost danger-txt" data-inj-del="${esc(id)}">Supprimer</button></span></div>`;
    }).join('')}</div>` : '<p class="note">Aucune catégorie : toutes les blessures sont de simples « Blessures ». Crée-en avec « + Nouvelle catégorie ».</p>'}`;
}
async function gestCall(op, payload, dialog) {
  setBusy(1);
  try {
    const out = await API.staff(op, payload);
    if (out.catalog) G.setCatalog(out.catalog);
    if (dialog) closeDialog(dialog);
    renderAll();
    toast(esc(out.toast));
    return out;
  } catch (err) {
    toast(esc(err.message));
    return null;
  } finally {
    setBusy(-1);
  }
}

/* Objet */
function openItemEdit(id = null) {
  itemDraftId = id;
  itemDraft = structuredClone(id ? G.itemOf(id) : { name: '', kind: 'mat', value: 0, desc: '', img: null });
  $('it-title').textContent = id ? 'Modifier l’objet' : 'Nouvel objet';
  $('it-name').value = itemDraft.name;
  $('it-kind').innerHTML = Object.entries(KIND).map(([k, l]) => `<option value="${k}" ${k === itemDraft.kind ? 'selected' : ''}>${l}</option>`).join('');
  $('it-heal').innerHTML = `<option value="">Non</option>${G.HEALTH_LEVELS.map((l, i) => `<option value="${i + 1}" ${itemDraft.heal?.level === i + 1 ? 'selected' : ''}>Oui, jusqu’à : ${l}</option>`).join('')}`;
  $('it-heal-type').innerHTML = `<option value="">Toutes les catégories</option>${Object.entries(G.INJURIES).map(([k, c]) => `<option value="${esc(k)}" ${itemDraft.heal?.type === k ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}`;
  $('it-rarity').innerHTML = G.RARITIES.map((r) => `<option value="${r.key}" ${r.key === (itemDraft.rarity || 'commun') ? 'selected' : ''}>${r.name}</option>`).join('');
  $('it-value').value = itemDraft.value;
  $('it-weight').value = itemDraft.weight ?? 0;
  const sh = itemDraft.ship || { cannons: 0, capacity: 100, berths: 4, sail: 1 };
  $('it-cannons').value = sh.cannons;
  $('it-cap').value = sh.capacity;
  $('it-berths').value = sh.berths ?? 4;
  $('it-sail').value = sh.sail ?? 0;
  $('it-speed').value = sh.speed ?? 10;
  $('it-robust').value = sh.robust ?? 10;
  $('it-space').innerHTML = Object.entries(G.SHIP_SPACES).map(([k, l]) => `<option value="${k}" ${k === (sh.space || 'post') ? 'selected' : ''}>${l}</option>`).join('');
  syncItemKind(itemDraft.kind);
  const up = itemDraft.upgrade || { type: 'cale', amount: 100 };
  $('it-utype').innerHTML = Object.entries(G.UPGRADES).map(([k, u]) => `<option value="${k}" ${k === up.type ? 'selected' : ''}>${u.name} (+ ${u.unit})</option>`).join('');
  $('it-uamount').value = up.amount;
  $('it-upg').hidden = itemDraft.kind !== 'amelioration';
  $('it-desc').value = itemDraft.desc;
  $('it-url').value = '';
  $('it-del').hidden = !id;
  $('it-err').textContent = '';
  showItemImg();
  openDialog('d-item');
}
function showItemImg() {
  $('it-preview').innerHTML = itemDraft.img ? `<img src="${imgSrc(itemDraft.img)}" alt="">` : icon(`objet-${$('it-kind').value}`);
  $('it-noimg').hidden = !itemDraft.img;
}
/** Champs propres à la catégorie : pour un bateau, le nom est le type et il n'y a pas de poids. */
function syncItemKind(kind) {
  const ship = kind === 'bateau';
  $('it-ship').hidden = !ship;
  $('it-upg').hidden = kind !== 'amelioration';
  $('it-weight-box').hidden = ship;
  $('it-name-label').textContent = ship ? 'Type de bateau (sert de nom, ex. Voilier)' : 'Nom';
  $('it-name').setAttribute('list', ship ? 'ship-types' : '');
}
$('it-kind').addEventListener('change', () => {
  syncItemKind($('it-kind').value);
  showItemImg();
});
$('it-pick').addEventListener('click', () => $('it-file').click());
$('it-file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f?.type.startsWith('image/')) return;
  if (f.size > 20 * 1024 * 1024) return void ($('it-err').textContent = 'Image trop lourde (20 Mo maximum).');
  itemDraft.img = await readImage(f, { max: 512 });
  showItemImg();
});
$('it-url-go').addEventListener('click', () => {
  const v = $('it-url').value.trim();
  if (!/^https?:\/\//.test(v)) return void ($('it-err').textContent = 'Le lien doit commencer par http:// ou https://');
  itemDraft.img = v;
  showItemImg();
});
$('it-noimg').addEventListener('click', () => {
  itemDraft.img = null;
  showItemImg();
});
$('it-save').addEventListener('click', () => {
  const item = {
    name: $('it-name').value, kind: $('it-kind').value, rarity: $('it-rarity').value, heal: $('it-heal').value ? { level: +$('it-heal').value, type: $('it-heal-type').value || null } : null, value: +$('it-value').value || 0, weight: $('it-weight').value || 0, desc: $('it-desc').value, img: itemDraft.img,
    ship: { speed: +$('it-speed').value || 10, robust: +$('it-robust').value || 10, space: $('it-space').value, cannons: +$('it-cannons').value || 0, capacity: +$('it-cap').value || 0, berths: +$('it-berths').value || 1, sail: Math.max(0, Math.min(3, Math.round(+$('it-sail').value || 0))) },
    upgrade: { type: $('it-utype').value, amount: +$('it-uamount').value || 1 },
  };
  if (!item.name.trim()) return void ($('it-err').textContent = 'Donne un nom à l’objet.');
  gestCall('item.save', { id: itemDraftId, item }, $('d-item'));
});
$('it-del').addEventListener('click', async () => {
  if (await askConfirm(`Les joueurs qui l’ont le verront comme « Objet supprimé ».`, { title: `Supprimer « ${G.itemOf(itemDraftId).name} » ?`, ok: 'Supprimer', danger: true })) gestCall('item.delete', { id: itemDraftId }, $('d-item'));
});

/* Recette */
const UNITS = { 1: 'secondes', 60: 'minutes', 3600: 'heures', 86400: 'jours' };
function openRecipeEdit(id = null) {
  if (!Object.keys(G.ITEMS).length) return toast('Crée d’abord des objets.');
  recipeDraftId = id;
  const first = Object.keys(G.ITEMS)[0];
  recipeDraft = structuredClone(id ? G.RECIPES[id] : { job: null, lvl: 1, seconds: 3600, needs: {}, gives: { [first]: 1 }, desc: '' });
  $('rc-title').textContent = id ? G.recipeLabel(recipeDraft) : 'Nouvelle recette';
  $('rc-del').hidden = !id;
  $('rc-err').textContent = '';
  renderRecipeEdit();
  openDialog('d-recipe');
}
function renderRecipeEdit() {
  const r = recipeDraft;
  const unit = [86400, 3600, 60, 1].find((u) => r.seconds && r.seconds % u === 0) || 60;
  const opts = (sel) => Object.entries(G.ITEMS).sort((a, b) => a[1].name.localeCompare(b[1].name)).map(([k, it]) => `<option value="${esc(k)}" ${k === sel ? 'selected' : ''}>${esc(it.name)}</option>`).join('');
  const rows = (list, kind) => Object.entries(list).map(([k, q], i) => `
    <div class="rc-row" data-kind="${kind}" data-i="${i}">
      <span class="se-ico">${itemIco(k)}</span>
      <select data-f="k" aria-label="Objet">${opts(k)}</select>
      <input data-f="q" type="number" min="1" value="${q}" aria-label="Quantité">
      <button type="button" class="close sm-close" data-rc-del="${kind}:${esc(k)}" aria-label="Retirer">×</button>
    </div>`).join('');
  $('rc-body').innerHTML = `
    <div class="form">
      <div><label for="rc-job">Métier</label><select id="rc-job"><option value="">Tous les métiers</option>${Object.entries(JOBS).map(([k, j]) => `<option value="${k}" ${r.job === k ? 'selected' : ''}>${j.name}</option>`).join('')}</select></div>
      <div><label for="rc-lvl">Maîtrise requise</label><select id="rc-lvl" ${r.job && !JOBS[r.job]?.noLevel ? '' : 'disabled'}>${JOB_LEVELS.map((l, i) => `<option value="${i + 1}" ${r.lvl === i + 1 ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div><label for="rc-time">Temps de fabrication</label><div class="rc-time"><input id="rc-time" type="number" min="0" value="${r.seconds / unit}"><select id="rc-unit">${Object.entries(UNITS).map(([u, l]) => `<option value="${u}" ${+u === unit ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
      <div class="wide"><label for="rc-desc">Description (facultative)</label><input id="rc-desc" value="${esc(r.desc)}" maxlength="400"></div>
      ${workFieldsHTML(r)}
      ${careFieldsHTML(r)}
      ${gameFieldsHTML(r)}
    </div>
    <h3 class="ed-h">Résultat</h3>
    <div class="se-items">${rows(r.gives, 'gives')}</div>
    <button type="button" class="btn sm ghost" data-rc-add="gives">+ Ajouter un objet produit</button>
    <h3 class="ed-h">Ingrédients</h3>
    <div class="se-items">${rows(r.needs, 'needs') || '<p class="note">Aucun ingrédient.</p>'}</div>
    <button type="button" class="btn sm ghost" data-rc-add="needs">+ Ajouter un ingrédient</button>
    <h3 class="ed-h">Outils</h3>
    <div class="se-items">${rows(r.tools || {}, 'tools') || '<p class="note">Aucun outil : il faut seulement les ingrédients.</p>'}</div>
    <button type="button" class="btn sm ghost" data-rc-add="tools">+ Ajouter un outil</button>`;
}
function readRecipeEdit() {
  const r = recipeDraft;
  r.job = $('rc-job').value || null;
  r.lvl = +$('rc-lvl').value || 1;
  r.seconds = Math.round((+$('rc-time').value || 0) * +$('rc-unit').value);
  r.desc = $('rc-desc').value;
  readWorkFields(r);
  readCareFields(r);
  readGameFields(r);
  for (const kind of ['needs', 'gives', 'tools']) {
    const next = {};
    document.querySelectorAll(`#rc-body .rc-row[data-kind="${kind}"]`).forEach((row) => {
      const k = row.querySelector('[data-f=k]').value, q = Math.max(1, Math.round(+row.querySelector('[data-f=q]').value || 1));
      next[k] = (next[k] || 0) + q;
    });
    r[kind] = next;
  }
}
$('d-recipe').addEventListener('change', (e) => {
  if (e.target.closest('#rc-body')) {
    readRecipeEdit();
    renderRecipeEdit();
  }
});
$('d-recipe').addEventListener('click', (e) => {
  const add = e.target.closest('[data-rc-add]')?.dataset.rcAdd;
  if (add) {
    readRecipeEdit();
    recipeDraft[add] ??= {};
    const free = Object.keys(G.ITEMS).find((k) => !recipeDraft[add][k]) || Object.keys(G.ITEMS)[0];
    recipeDraft[add][free] = (recipeDraft[add][free] || 0) + 1;
    return renderRecipeEdit();
  }
  const del = e.target.closest('[data-rc-del]')?.dataset.rcDel;
  if (del) {
    readRecipeEdit();
    const [kind, k] = del.split(':');
    delete recipeDraft[kind][k];
    renderRecipeEdit();
  }
});
/* Tester le mini-jeu d'une recette, avec les réglages en cours (rien n'est consommé ni enregistré) */
$('d-recipe').addEventListener('click', async (e) => {
  if (!e.target.closest('#rc-test')) return;
  readRecipeEdit();
  const r = recipeDraft, rank = rcTest.rank;
  const withGame = { ...r, game: r.game || { list: [], diff: 0 } };
  let ok;
  if (r.care) ok = await careGame(Math.min(rcTest.lvl, r.care.level), 'test', rank, null, withGame);
  else if (r.work) ok = r.game ? await customGame(r, rank, 'Test') : await workGame(r, rank, 'Test');
  else ok = await customGame(withGame, rank, 'Test');
  toast(ok ? '✅ Mini-jeu réussi' : '❌ Mini-jeu raté');
});
$('rc-save').addEventListener('click', () => {
  readRecipeEdit();
  if (!Object.keys(recipeDraft.gives).length && !recipeDraft.work && !recipeDraft.care) return void ($('rc-err').textContent = 'La recette doit produire au moins un objet, ou être un travail sur bateau, ou un soin.');
  gestCall('recipe.save', { id: recipeDraftId, recipe: recipeDraft }, $('d-recipe'));
});
$('rc-del').addEventListener('click', async () => {
  if (await askConfirm('Les fabrications déjà lancées avec cette recette restent récupérables.', { title: `Supprimer la recette « ${G.recipeLabel(G.RECIPES[recipeDraftId])} » ?`, ok: 'Supprimer', danger: true })) gestCall('recipe.delete', { id: recipeDraftId }, $('d-recipe'));
});

/* ═══ Onglets, écrans, rendu ═════════════════════════════════════════════ */
const RENDER = [renderPerso, renderTech, renderInv, renderJob, renderMjTab, renderNav, renderShop, renderGestion, renderCrew];
const tabs = [...document.querySelectorAll('.tab')];
function selectTab(tab) {
  tabs.forEach((t) => {
    const on = t === tab;
    t.setAttribute('aria-selected', on);
    t.tabIndex = on ? 0 : -1;
    const panel = $(t.getAttribute('aria-controls'));
    const was = panel.hidden;
    panel.hidden = !on;
    if (on && was) {
      replay(panel, 'enter');
      fillGauges(panel);
    }
  });
}
tabs.forEach((t, i) => {
  t.addEventListener('click', () => selectTab(t));
  t.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    selectTab(n);
    n.focus();
  });
});
function renderAll() {
  const has = !!S;
  $('no-fiche').hidden = has || ADMIN;
  document.querySelector('#s-fiche .hero').hidden = !has;
  document.querySelector('#s-fiche .log').hidden = !has;
  if (ADMIN) {
    renderGestion();
    renderAdminShops();
    renderFleet();
    renderShipsAdmin();
    if (has) {
      renderHero();
      [renderPerso, renderTech, renderInv, renderJob, renderMjTab].forEach((f) => f());
    }
    paintStatic();
    return;
  }
  if (!has) {
    $('no-fiche').innerHTML = `<div class="no-shop">${ico(233)}<h2>Pas encore de fiche</h2>
      <p class="note">Un MJ doit d’abord t’enregistrer avec la commande <code>/register</code>.</p>
      ${ME?.staff ? '<p class="note">Tu fais partie du staff : les outils sont dans <code>/panel admin</code>.</p>' : ''}</div>`;
    $('purse').innerHTML = '';
    renderNav();
    if (!S) $('v-shop').innerHTML = `<div class="no-shop">${ico(265)}<h2>Boutique fermée pour toi</h2><p class="note">Il faut une fiche pour acheter et vendre.</p></div>`;
    paintStatic();
    return;
  }
  renderHero();
  RENDER.forEach((f) => f());
  paintStatic();
}
const scrBtns = [...document.querySelectorAll('.scr')];
let screen = 'fiche';
function showScreen(name) {
  screen = name;
  scrBtns.forEach((b) => {
    const on = b.dataset.screen === name;
    b.setAttribute('aria-selected', on);
    const el = $(b.getAttribute('aria-controls'));
    const was = el.hidden;
    el.hidden = !on;
    if (on && was) {
      replay(el, 'enter');
      fillGauges(el);
    }
  });
  if (name === 'aicons') renderIcons();
  if (name === 'aloot') (lootData ? renderLoot() : loadLoot());
  if (name === 'aperms') loadPerms();
  if (name === 'agames') renderGames();
  if (name === 'ainv') loadPendingInventions();
  if (name === 'afeat') loadFeatures();
  if (name === 'acalc') loadCalc();
  if (name === 'asea') loadSeaEvents();
  if (name === 'acook') loadCooks();
  if (name === 'ajour') loadJournals();
  if (name === 'map') renderMap();
  if (name === 'amap') (amap ? renderAdminMap() : loadAdminMap());
  if (name === 'fleet') renderFleet();
  if (name === 'ships') renderShipsAdmin();
  if (name === 'marine') renderMarine();
  if (name === 'crew') renderCrew();
  if (name === 'shop') {
    renderShop();
    paintStatic();
    drawAwning();
  }
  if (name === 'nav') {
    const log = $('sea-log');
    if (log) log.scrollTop = log.scrollHeight;
  }
}
scrBtns.forEach((b) => b.addEventListener('click', () => showScreen(b.dataset.screen)));

/**
 * Rafraîchit la boutique et la navigation du salon (achats et événements des autres joueurs).
 * Pour le staff, vérifie aussi si /edit profil a demandé d'ouvrir une fiche : l'Activity
 * peut être déjà ouverte, et Discord ne la relance pas dans ce cas.
 */
let refreshing = false;
async function refresh() {
  if (API.mode !== 'discord' || busy || refreshing || document.hidden) return;
  refreshing = true;
  try {
    const st = await API.state();
    G.setCatalog(st.catalog);
    // Icônes changées par le staff entre-temps : on les applique
    if (JSON.stringify(st.icons || {}) !== JSON.stringify(ICONS)) {
      ICONS = st.icons || {};
      setIcons(ICONS, mediaSrc);
      renderAll();
    }
    if (st.openDenied) toast(OPEN_DENIED);
    if (st.open && ME.staff) return void (await enterAdmin(st.open));
    if (ADMIN) return;
    if (busy || VIEW) return;
    S = st.player;
    SHOP = st.shop;
    CREW = st.crew;
    SHIPS = st.ships || [];
    INVITES = st.invites || [];
    NAVD = st.nav;
    CHNAME = st.channelName || '';
    POSID = st.channelId || null;
    MAP = st.map || null;
    if (screen === 'crew' && !document.activeElement?.closest('#v-crew')) renderCrew();
    if (screen === 'nav') renderNav();
    if (screen === 'map') renderMap(); // le bateau avance pendant qu'on regarde la carte
    if (screen === 'shop' && !document.querySelector('#v-shop .ask-range:active')) renderShop();
    renderHero();
    renderJob(); // demandes de soin acceptées, fabrications terminées
    renderMjTab();
    paintStatic();
  } catch {
  } finally {
    refreshing = false;
  }
}

/* Le glisser-déposer natif du navigateur (sur les images) prendrait l'image au lieu de l'objet. */
document.addEventListener('dragstart', (e) => {
  if (e.target.closest?.('.cell, .xcell, .eslot, .scell, .ico')) e.preventDefault();
});

/** Fin du chargement : le centre s'efface, puis l'écran s'ouvre vers le haut et vers le bas. */
function openBoot() {
  const b = $('boot');
  if (calm.matches) return void (b.hidden = true);
  b.classList.add('open');
  setTimeout(() => (b.hidden = true), 1300);
}

/* ═══ Démarrage ══════════════════════════════════════════════════════════ */
(async () => {
  paintStatic();
  $('ship-types').innerHTML = G.SHIP_TYPES.map((t) => `<option value="${esc(t)}">`).join('');
  // Écran de chargement : l'icône qui tourne est le fichier /assets/loading-icon.png (chargé avec la page)
  let st;
  try {
    st = await API.boot();
    G.setCatalog(st.catalog);
    ICONS = st.icons || {};
    setIcons(ICONS, mediaSrc);
    try {
      localStorage.setItem('op_icons', JSON.stringify(ICONS));
    } catch {}
    ME = st.me;
    S = st.player;
    SHOP = st.shop;
    CREW = st.crew;
    SHIPS = st.ships || [];
    INVITES = st.invites || [];
    NAVD = st.nav;
    CHNAME = st.channelName || '';
    POSID = st.channelId || null;
    MAP = st.map || null;
  } catch (err) {
    console.error(err);
    $('boot').classList.add('error');
    $('boot-msg').textContent = `Impossible de charger ta fiche : ${err.message || err}. Ferme puis relance l’Activity.`;
    return;
  }
  $('open-mj').hidden = API.mode !== 'demo';
  $('reset').hidden = API.mode !== 'demo';
  $('foot-note').textContent = API.mode === 'demo' ? 'Démo : les données restent dans ce navigateur.' : `Connecté en tant que ${ME.name}.`;
  updateNav();
  renderAll();
  selectTab(tabs[0]);
  showScreen('fiche');
  fillGauges(document.querySelector('.hero'));
  openBoot();
  // Ouverte avec /panel admin ou /edit profil : panneau admin (et fiche du joueur pour /edit profil)
  if (st.open && ME.staff) await enterAdmin(st.open);
  if (st.openDenied) toast(OPEN_DENIED);
  if (st.salary?.amount) toast(`💰 Solde de la Marine versée : ${berry(st.salary.amount)} (${st.salary.weeks} semaine${st.salary.weeks > 1 ? 's' : ''})`);
  // Boutique et navigation : toutes les 10 s. Staff : toutes les 5 s (pour /edit profil).
  let tick = 0;
  setInterval(() => {
    tick++;
    if (ME.staff || tick % 2 === 0) refresh(); // toutes les 10 s : demandes de soin, voyages, boutique…
  }, 5_000);
  document.addEventListener('visibilitychange', () => !document.hidden && refresh());
})();

$('reset').addEventListener('click', () => {
  API.resetDemo();
  location.reload();
});