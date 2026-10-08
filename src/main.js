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
  openDialog, closeDialog, readAsDataUrl, askConfirm, askText,
} from './ui.js';

const { JOBS, STATS, HAKI, SLOTS, KIND, JOB_LEVELS, XP_NEED, STAT_MAX, ASK_MAX, BAG } = G;
const itemOf = (k) => G.itemOf(k);
/** Icône d'un objet : son image si le staff en a mis une, sinon une icône selon sa catégorie. */
const KIND_ICON = { arme: 147, conso: 192, mat: 331, tresor: 270, objet: 237, bateau: 231, amelioration: 266 };
const itemIco = (k) => {
  const it = itemOf(k);
  return it.img ? `<span class="ico item-img" aria-hidden="true"><img src="${imgSrc(it.img)}" alt="" loading="lazy" draggable="false"></span>` : ico(KIND_ICON[it.kind] ?? 237);
};

/* ═══ État ═══════════════════════════════════════════════════════════════ */
let ME = null; // { uid, name, staff }
let S = null; // fiche affichée
let SHOP = null; // boutique du salon (ou null)
let CHNAME = ''; // nom du salon
let CREW = null; // équipage du joueur affiché
let SHIPS = []; // ses bateaux et ceux de son équipage
let NAVD = null; // port du salon : bateaux à quai, bateau à bord, demandes d'embarquement
let ADMIN = false; // panneau admin (/panel admin, /edit profil) ; /profil = vue joueur pure, même pour le staff
const tools = () => ADMIN && !!ME?.staff;
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
      local = G.playerAction(S, action, { shop: SHOP, channelId: API.channelId });
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
  Pirate: { cls: 'f-pirate', icon: 1 },
  Marine: { cls: 'f-marine', icon: 160 },
  Révolutionnaire: { cls: 'f-revo', icon: 96 },
  'Chasseur de primes': { cls: 'f-chasseur', icon: 153 },
  Civil: { cls: 'f-civil', icon: 121 },
};
const CLASS_ICON = { Fighter: { icon: 128 }, Sabreur: { icon: 147 }, Tireur: { icon: 153 } };

function photoHTML(p = S) {
  if (!p.photo) return PORTRAIT;
  const name = esc(G.fullName(p));
  const broken = `onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'ph-broken',textContent:'Image introuvable'}))"`;
  if (typeof p.photo === 'string') return `<img src="${imgSrc(p.photo)}" alt="Portrait de ${name}" ${broken}>`;
  const f = p.photo;
  return `<img class="ph-link" src="${imgSrc(f.url)}" alt="Portrait de ${name}" style="left:${f.l}%;top:${f.t}%;width:${f.w}%" ${broken}>`;
}
function affiliation() {
  const { faction, crew, crewRole, grade } = S.id;
  if (faction === 'Marine') return `<b>${esc(grade)}</b> de la Marine${crewRole ? `, ${esc(crewRole)}` : ''}`;
  return [crewRole && `<b>${esc(crewRole)}</b>`, crew && esc(crew)].filter(Boolean).join(', ');
}
function badgeHTML() {
  const { faction, grade, bounty } = S.id;
  if (faction === 'Marine') {
    const i = G.GRADES.indexOf(grade), g = G.gradeOf(grade);
    // Officiers généraux : étoiles ; en dessous : galons
    const marks = i >= 5 ? '<i class="star"></i>'.repeat(i - 4) : '<i></i>'.repeat(Math.min(i + 1, 4));
    return `<div class="plaque blue"><span class="pl-label">${g.medal} Grade</span><div class="chev">${marks}</div><span class="pl-value">${esc(grade)}</span><span class="pl-foot">Solde : ${berry(g.pay)} / semaine</span></div>`;
  }
  if (bounty > 0) return `<div class="plaque"><span class="pl-label">Prime</span><span class="pl-value" id="h-bounty">${berry(bounty)}</span><span class="pl-foot">Dead or alive</span></div>`;
  return '';
}
function renderHero() {
  const f = FACTION[S.id.faction] || FACTION.Pirate;
  const key = JSON.stringify(S.photo || '') + (S.uid || '');
  if (shown.photo !== key) {
    $('portrait').innerHTML = photoHTML() + (VIEW ? '' : '<span class="cam" aria-hidden="true">📷</span>');
    shown.photo = key;
  }
  $('h-faction').innerHTML = `<span class="stamp ${f.cls}">${ico(f.icon)}${esc(S.id.faction)}</span>`;
  $('h-name').textContent = fullName();
  $('h-epithet').textContent = S.id.epithet ? `« ${S.id.epithet} »` : '';
  const aff = affiliation();
  $('h-aff').innerHTML = aff;
  $('h-aff').hidden = !aff;
  const job = S.job.id ? JOBS[S.job.id] : { name: 'Aucun', pic: null };
  $('h-traits').innerHTML = [
    ['Race', S.id.race, 121],
    ['Classe', S.id.classe, CLASS_ICON[S.id.classe]?.icon ?? 147],
    ['Métier', job.name, job.pic ?? 121],
    ...(S.fruit ? [['Fruit', S.fruit.name, 'fruit']] : []),
  ].map(([k, v, i]) => `<li>${glyph(i)}<span><small>${k}</small>${esc(v)}</span></li>`).join('');

  const prevBounty = shown.bounty;
  $('badge-slot').innerHTML = badgeHTML();
  $('h-will').innerHTML = `${pic('st_angry')}<span class="will-l">Volonté</span>${stars(S.volonte)}`;
  $('h-will').setAttribute('aria-label', `Volonté : ${S.volonte} sur 5`);
  const bt = $('h-bounty');
  if (bt && prevBounty != null && prevBounty !== S.id.bounty) {
    countTo(bt, prevBounty, S.id.bounty);
    replay(bt.parentElement, 'bump');
  }
  shown.bounty = bt ? S.id.bounty : null;

  const need = XP_NEED(S.level), lvEl = $('id-lv');
  if (shown.level != null && shown.level !== S.level) replay(lvEl.parentElement, 'bump');
  shown.level = S.level;
  lvEl.textContent = S.level;
  $('xp-gauge').querySelector('i').style.width = `${(S.xp / need) * 100}%`;
  $('xp-gauge').setAttribute('aria-valuenow', S.xp);
  $('xp-gauge').setAttribute('aria-valuemax', need);
  $('xp-cap').textContent = `${S.xp} / ${need}`;

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
  loadCrop(await readAsDataUrl(file));
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
    if (v) rows.push(skillRow({ glyphHTML: ico(h.icon), name: h.name, v }));
  });
  if (S.fruit) rows.push(skillRow({ glyphHTML: pic('fruit'), name: esc(S.fruit.name), sub: esc(S.fruit.type), v: S.fruit.stars, req: S.fruit.stars >= 5 ? 'Éveillé' : '' }));
  $('v-perso').innerHTML = `
    <div class="perso-grid">
      <section>
        <div class="sec-head"><h2>Statistiques</h2><span class="pill">Points <b>${left}</b></span></div>
        ${STATS.map((s) => {
          const add = pending[s.key] || 0, v = S.stats[s.key] + add;
          return `<div class="stat">
            ${pic(s.pic)}
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
function renderTech() {
  const wait = S.techniques.filter((t) => !t.ok).length;
  $('v-tech').innerHTML = `
    <div class="tech-tools">
      <div><h2>Techniques</h2><p class="lede" style="margin:0">Crée tes propres techniques. Un MJ les valide avant qu'elles soient utilisables en RP.</p></div>
      <button class="btn" id="new-tech">${ico(131)}Nouvelle technique</button>
    </div>
    ${wait ? `<p class="note">${wait} technique${wait > 1 ? 's' : ''} en attente de validation.</p>` : ''}
    ${S.techniques.map((t) => `
      <details class="tech">
        <summary>
          ${t.media ? `<span class="t-thumb"><img src="${imgSrc(t.media)}" alt="" loading="lazy"></span>` : ''}
          <span><span class="t-name">${esc(t.name)}</span>${t.ok ? '' : '<span class="status wait">À valider</span>'}<br><span class="t-meta"><span class="${SRC_CLS[t.src]}">${G.TECH_SOURCES[t.src]}</span></span></span>
          <span class="cost"><span class="chev" aria-hidden="true">▾</span></span>
        </summary>
        ${t.media ? `<div class="t-media"><img src="${imgSrc(t.media)}" alt="Illustration de ${esc(t.name)}" loading="lazy" onerror="this.parentElement.classList.add('broken');this.remove()"></div>` : ''}
        <p>${esc(t.desc) || '<em>Pas de description.</em>'}</p>
        <div class="t-actions">
          <button class="btn sm ghost" data-edit-tech="${t.id}">Modifier</button><button class="btn sm ghost" data-del-tech="${t.id}">Supprimer</button>
          ${tools() && VIEW && !t.ok ? `<button class="btn sm" data-ok-tech="${t.id}">Valider</button><button class="btn sm ghost" data-no-tech="${t.id}">Refuser</button>` : ''}
        </div>
      </details>`).join('') || '<p class="note">Aucune technique pour l’instant.</p>'}`;
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
  $('tech-title').textContent = t ? 'Modifier la technique' : 'Nouvelle technique';
  $('tech-submit').textContent = t ? 'Enregistrer' : 'Proposer la technique';
  $('tf-src').innerHTML = Object.entries(G.TECH_SOURCES).map(([k, l]) => `<option value="${k}" ${t?.src === k ? 'selected' : ''}>${l}</option>`).join('');
  $('tf-name').value = t?.name ?? '';
  $('tf-desc').value = t?.desc ?? '';
  techMedia = t?.media ?? null;
  $('tf-url').value = '';
  showTechMedia();
  $('tech-err').textContent = '';
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
  if (no != null) return staffAct({ type: 'tech.validate', id: no, ok: false });
});
$('tf-pick').addEventListener('click', () => $('tf-file').click());
$('tf-file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  if (!f.type.startsWith('image/')) return void ($('tech-err').textContent = 'Ce fichier n’est pas une image.');
  if (f.size > 2 * 1024 * 1024) return void ($('tech-err').textContent = 'Fichier trop lourd (2 Mo maximum). Pour un gros GIF, utilise plutôt un lien.');
  techMedia = await readAsDataUrl(f);
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
  $('tech-err').textContent = techMedia && !techMedia.startsWith('/media/') ? 'Envoi de l’image…' : '';
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
      <div><h3>${esc(it.name)} <span class="tag">${KIND[it.kind]}</span></h3><p>${esc(it.desc)} Quantité : ${q}. Poids : ${G.kg((it.weight || 0) * q)}. Valeur : ${it.value ? berry(it.value) : 'aucune'}.</p></div>
      <div class="acts">
        ${G.isWeapon(k) ? `<button class="btn sm" data-equip="${sel}">${eq ? 'Retirer' : 'Équiper'}</button>` : ''}
        <button class="btn sm ghost" data-drop="${sel}" ${eq ? 'disabled title="Retire-la d’abord"' : ''}>Jeter un</button>
      </div>
    </div>`;
  }
  // Une seule arme équipée sur trois identiques : seule la première case porte la marque.
  $('v-inv').innerHTML = `
    <div class="sec-head"><h2>Inventaire</h2><span class="pill">${ico(261)}<b>${berry(S.berry)}</b></span></div>
    <p class="lede">${used} / ${BAG} emplacements · ${n} objet${n > 1 ? 's' : ''} · <span class="weight">${G.kg(G.invWeight(S))}</span></p>
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
        return `<button class="cell" data-slot="${i}" aria-pressed="${sel === i}" aria-label="${esc(it.name)}, quantité ${q}${eq ? ', équipé' : ''}">${itemIco(k)}${eq ? '<span class="eq">É</span>' : ''}${q > 1 ? `<span class="qty">${q}</span>` : ''}</button>`;
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
function needChip([k, q], have = true) {
  const h = count(k), it = itemOf(k);
  return `<span class="need ${have ? (h >= q ? 'have' : 'miss') : ''}">${itemIco(k)}${esc(it.name)} ${have ? `${h}/${q}` : `× ${q}`}</span>`;
}
function renderJob() {
  if (!S) return;
  const job = S.job.id ? JOBS[S.job.id] : null;
  const recs = Object.entries(G.RECIPES).filter(([, r]) => !r.job || r.job === S.job.id);
  const shownRecs = craftFilter === 'dispo' ? recs.filter(([, r]) => !G.craftBlock(S, r)) : recs;
  const c = S.craft;
  const ready = c && Date.now() >= c.end;
  $('v-job').innerHTML = `
    <div class="job-head">
      <div class="badge">${job ? pic(job.pic) : ico(121)}</div>
      <div>
        <h2>${job ? esc(job.name) : 'Aucun métier'} ${job ? `<span class="pips" aria-label="Niveau ${S.job.lvl} sur 3">${[1, 2, 3].map((i) => `<i class="${i <= S.job.lvl ? 'on' : ''}"></i>`).join('')}</span>` : ''}</h2>
        ${job ? `<p class="lede" style="margin:0">${JOB_LEVELS[S.job.lvl - 1]}</p>` : ''}
      </div>
    </div>

    ${c ? `<div class="craft-now ${ready ? 'ready' : ''}">
      <div class="craft-gives">${Object.entries(c.gives).map(([k, q]) => `<span class="need">${itemIco(k)}${q} × ${esc(itemOf(k).name)}</span>`).join('')}</div>
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
      const why = G.craftBlock(S, r);
      return `<article class="recipe ${why ? 'locked' : ''}">
        <h3 class="rc-title">${Object.keys(r.gives).slice(0, 1).map((k) => itemIco(k)).join('')}${esc(G.recipeLabel(r))}</h3>
        <p class="note">${r.job ? `${JOBS[r.job].name} · ${JOB_LEVELS[r.lvl - 1]}` : 'Tous métiers'} · ${r.seconds ? `⏳ ${G.duree(r.seconds)}` : 'immédiat'}</p>
        ${r.desc ? `<p>${esc(r.desc)}</p>` : ''}
        <b>Il faut</b>
        <div class="needs">${Object.entries(r.needs).map((x) => needChip(x)).join('') || '<span class="note">Rien</span>'}</div>

        <div class="recipe-foot">
          ${why ? `<span class="req">${esc(why)}</span>` : '<span></span>'}
          <button class="btn sm" data-craft="${esc(id)}" ${why || c ? 'disabled' : ''}>${c ? 'Atelier occupé' : 'Fabriquer'}</button>
        </div>
      </article>`;
    }).join('')}</div>` : `<p class="note">${recs.length ? 'Aucune recette réalisable pour l’instant : il te manque des objets. Affiche « Toutes » pour voir ce qu’il faut.' : 'Aucune recette pour ton métier pour l’instant.'}</p>`}`;
}
$('v-job').addEventListener('click', async (e) => {
  const cf = e.target.closest('[data-cf]')?.dataset.cf;
  if (cf) {
    craftFilter = cf;
    return renderJob();
  }
  const id = e.target.closest('[data-craft]')?.dataset.craft;
  if (id) return void run({ type: 'craft.start', id });
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

/* ═══ Navigation : le port du salon ═════════════════════════════════════ */
function ownerLabel(sh) {
  if (!sh.owner) return 'Sans propriétaire';
  if (sh.owner.kind === 'crew') return `${NAVD?.crewKinds?.[sh.owner.id] === 'flotte' ? 'Flotte' : 'Équipage'} : ${esc(NAVD?.crewNames?.[sh.owner.id] ?? '?')}`;
  return sh.owner.id === S.uid ? 'À toi' : `À ${esc(NAVD?.names?.[sh.owner.id] ?? '?')}`;
}
const navName = (u) => (u === S.uid ? 'toi' : esc(NAVD?.names?.[u] ?? '?'));
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
      ${n.aboard ? `<div class="aboard"><b>Tu es à bord de ${esc(n.aboard.name)}</b>${n.aboard.position ? ` (à quai dans #${esc(n.aboard.position.name || n.aboard.position.channelId)})` : ''} <button class="btn sm ghost" data-ship-leave="${esc(n.aboard.id)}">Descendre</button></div>` : ''}
      ${n.requests.length ? `<div class="crew-box"><h3>Demandes d’embarquement</h3>${n.requests.map((r) => `<div class="member-row"><span class="m-name"><b>${navName(r.uid)}</b> veut monter sur <b>${esc(r.shipName)}</b></span><span></span><span class="m-acts"><button class="btn sm" data-req-yes="${esc(r.shipId)}" data-uid="${esc(r.uid)}">Accepter</button><button class="btn sm ghost" data-req-no="${esc(r.shipId)}" data-uid="${esc(r.uid)}">Refuser</button></span></div>`).join('')}</div>` : ''}
      <h3 class="ed-h">À quai${CHNAME ? ` dans #${esc(CHNAME)}` : ' ici'}</h3>
      ${harbor ? `<div class="ships">${harbor}</div>` : '<p class="note">Aucun bateau à quai dans ce salon.</p>'}
      <p class="note">La navigation en mer arrive bientôt : le niveau de voile servira de vitesse.</p>
    </section>`;
  paintStatic($('v-nav'));
}
$('v-nav').addEventListener('click', async (e) => {
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
const locked = (k) => !!S.sellLock?.[API.channelId]?.[k];
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
          <p class="note">ID du salon : <code>${esc(ch)}</code></p>
          ${items.length ? `<table class="ashop-items"><thead><tr><th>Objet</th><th>Prix</th><th>Stock</th></tr></thead><tbody>${items.map(([k, price, left]) => `<tr><td>${itemIco(k)} ${esc(itemOf(k).name)}</td><td>${berry(price)}</td><td>${left < 0 ? 'illimité' : left}</td></tr>`).join('')}</tbody></table>` : '<p class="note">Aucun objet en vente.</p>'}
          <div class="ashop-acts">
            <button class="btn sm" data-ashop-edit="${esc(ch)}">Modifier</button>
            <button class="btn sm ghost danger-txt" data-ashop-del="${esc(ch)}">Supprimer la boutique</button>
          </div>
        </div>` : ''}
      </article>`;
    }).join('')}</div>` : '<div class="no-shop">' + ico(265) + '<h2>Aucune boutique</h2><p class="note">Crée la première avec « + Nouvelle boutique » : il suffira de coller l’ID du salon.</p></div>'}`;
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
  const del = e.target.closest('[data-ashop-del]')?.dataset.ashopDel;
  if (del) {
    const sh = adminShops[del];
    if (!(await askConfirm(`La boutique « ${sh.name} » de ${sh.channel} et ses objets en vente seront supprimés. Les objets déjà achetés restent aux joueurs.`, { title: 'Supprimer cette boutique ?', ok: 'Supprimer', danger: true }))) return;
    setBusy(1);
    try {
      const out = await API.staff('shop.delete', { channelId: del });
      if (del === API.channelId) SHOP = null;
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
function renderShop() {
  if (ADMIN) return;
  if (!S) return;
  const el = $('v-shop');
  if (!SHOP) {
    el.innerHTML = `<div class="no-shop">${ico(265)}<h2>Pas de boutique ici</h2><p class="note">Aucun marchand ne tient boutique dans ce salon${CHNAME ? ` (#${esc(CHNAME)})` : ''}.</p>
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
  el.innerHTML = `
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
    const out = await run({ type: 'shop.buy', key: bk });
    if (!out) return;
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
    const out = await run({ type: 'shop.sell', key: sk, pct: askBlock(sk).pct });
    if (!out) return;
    delete asks[sk];
    if (out.refused) return replay($('drop-counter'), 'shake');
    walletFx(before, S.berry - before);
  }
});

/* Éditeur de boutique : staff seulement (double-clic ou appui long sur le vendeur) */
let shopDraft = null;
let shopEditCh = null, shopDraftCh = '';
function openShopEdit(base, channelId = null) {
  if (!tools() || !base) return;
  shopDraft = structuredClone(base);
  shopEditCh = channelId; // salon d'origine (null = nouvelle boutique)
  // Nouvelle boutique : on propose le salon où le panneau est ouvert, s'il n'a pas déjà de boutique.
  shopDraftCh = channelId ?? (API.channelId && !adminShops?.[API.channelId] ? API.channelId : '');
  renderShopEdit();
  $('se-err').textContent = '';
  openDialog('d-shopedit');
}
function renderShopEdit() {
  const d = shopDraft;
  const opts = (s) => Object.entries(G.ITEMS).map(([k, it]) => `<option value="${k}" ${k === s ? 'selected' : ''}>${esc(it.name)}</option>`).join('');
  $('se-body').innerHTML = `
    <div class="form">
      <div class="wide"><label for="se-chan">ID du salon</label><input id="se-chan" value="${esc(shopDraftCh)}" inputmode="numeric" placeholder="ex. 1234567890123456789" maxlength="22">
        <small class="note">Dans Discord : clic droit sur le salon > Copier l’identifiant (mode développeur activé). Le nom du salon est retrouvé tout seul.</small></div>
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
  const raw = $('se-chan').value.trim();
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
    if (out.channelId === API.channelId) SHOP = out.shop;
    else if (shopEditCh === API.channelId) SHOP = null;
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
    ${picker('vol', 'Volonté', S.volonte, pic('st_angry'), '0')}
    ${HAKI.map((h) => picker(`haki_${h.key}`, h.name, S.haki[h.key] ?? 0, ico(h.icon), h.key === 'rois' ? 'Non éveillé' : 'Non débloqué')).join('')}
    ${picker('fruitStars', 'Maîtrise du fruit', S.fruit?.stars ?? 0, pic('fruit'), '0')}
    <h3 class="ed-h">Progression</h3>
    <div class="form">
      ${num('level', 'Niveau', S.level, 1, 999)}
      ${num('xp', 'Expérience', S.xp, 0, 99999)}
      ${num('berry', 'Berrys', S.berry, 0, 99999999999)}
      ${num('statPts', 'Points de stats', S.statPts, 0, 999)}
      ${STATS.map((s) => num(`st_${s.key}`, s.name, S.stats[s.key], 0, STAT_MAX)).join('')}
      <div><label for="f-jobLvl">Niveau de métier</label><select id="f-jobLvl" name="jobLvl">${JOB_LEVELS.map((l, i) => `<option value="${i + 1}" ${S.job.lvl === i + 1 ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
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
  const wait = S.techniques.filter((t) => !t.ok);
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
      <span><small>Métier</small><b>${job ? `${esc(job.name)} · ${JOB_LEVELS[S.job.lvl - 1]}` : 'Aucun'}</b></span>
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
  if (e.target.closest('#mj-edit-open')) return openEdit();
  if (e.target.closest('#mj-pick')) return showScreen('admin');
  const ok = e.target.closest('[data-ok-tech]')?.dataset.okTech;
  if (ok) return void staffAct({ type: 'tech.validate', id: Number(ok), ok: true });
  const no = e.target.closest('[data-no-tech]')?.dataset.noTech;
  if (no) return void staffAct({ type: 'tech.validate', id: Number(no), ok: false });
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
function updateNav() {
  const vis = { fiche: !ADMIN || !!VIEW, shop: !ADMIN, crew: !ADMIN, nav: !ADMIN, admin: ADMIN, marine: tools(), fleet: tools(), ships: tools(), ashop: tools(), gest: tools() };
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
const describe = (a) =>
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
  showScreen('admin');
  renderAll();
  renderAdminHome();
  loadPlayers();
  loadAdminShops();
  loadFleet();
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
  const ups = upgradeSlots();
  if (!ups.length) return '';
  return `<div class="mj-row upg-row"><select data-upg-sel="${esc(sh.id)}" aria-label="Amélioration à installer">${ups.map(([i, x]) => {
    const u = G.ITEMS[x[0]].upgrade;
    return `<option value="${i}">${esc(G.ITEMS[x[0]].name)} (+${fmt(u.amount)} ${G.UPGRADES[u.type].unit})</option>`;
  }).join('')}</select><button class="btn sm" data-upg="${esc(sh.id)}">Installer</button></div>`;
}
function shipCard(sh, { actions = '', upgrade = false, extra = '' } = {}) {
  const aboard = sh.passengers?.length ?? 0;
  return `<article class="ship-card">
    <div class="ship-pic">${shipPic(sh)}</div>
    <div>
      <h3>${sh.icon && sh.photo ? `<span class="ico item-img"><img src="${imgSrc(sh.icon)}" alt=""></span>` : ''}${esc(sh.name)}</h3>
      <div class="ship-stats"><span>${esc(sh.type)}</span><span>${aboard} / ${sh.berths} à bord</span><span>Voile niv. ${sh.sail}</span><span>${sh.cannons} canon${sh.cannons > 1 ? 's' : ''}</span><span>Cale : ${G.kg(sh.capacity)}</span>${sh.position ? `<span>⚓ #${esc(sh.position.name || sh.position.channelId)}</span>` : ''}</div>
      ${sh.desc ? `<p>${esc(sh.desc)}</p>` : ''}
      ${extra}
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
    ${CREW ? '<p class="note" style="margin:0">En rejoindre un autre te fera quitter ${G.crewWords(CREW).le}.</p>' : ''}
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
      <div class="member-list">${members.map((u) => `
        <div class="member-row">
          <span class="m-name">${u === c.captain ? '👑 ' : ''}<b>${nameOf(u)}</b>${u === me ? ' <small class="note">(toi)</small>' : ''}</span>
          ${u === c.captain ? `<span class="rank-badge cap">${esc(G.rankName(c, u))}</span>`
            : can('ranks') && (isCap || u !== me) ? `<select data-rank-of="${esc(u)}" aria-label="Grade de ${nameOf(u)}">${rankOpts(u)}</select>`
            : `<span class="rank-badge">${esc(G.rankName(c, u))}</span>`}
          <span class="m-acts">
            ${isCap && u !== me ? `<button class="btn sm ghost" data-captain="${esc(u)}" title="Céder ta place de ${W.chef}">Nommer ${W.chef}</button>` : ''}
            ${can('kick') && u !== c.captain && u !== me ? `<button class="btn sm ghost danger-txt" data-kick="${esc(u)}">Exclure</button>` : ''}
          </span>
        </div>`).join('')}</div>
    </section>
    ${can('invite') ? `<section class="crew-box">
      <h3>Inviter ${c.kind === 'flotte' ? 'un Marine' : 'un joueur'}</h3>
      <input class="mj-search" id="crew-search" type="search" placeholder="Nom du joueur…" value="${esc(crewSearch)}" autocomplete="off">
      <div class="search-results" id="crew-results">${crewResults.map((x) => `<div class="member-row"><span class="m-name"><b>${esc(x.name)}</b>${x.crew ? ' <small class="note">(a déjà un équipage ou une flotte)</small>' : ''}</span><span></span><span class="m-acts"><button class="btn sm" data-invite="${esc(x.uid)}">Inviter</button></span></div>`).join('') || (crewSearch ? '<p class="note">Aucun joueur trouvé.</p>' : '')}</div>
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
  const okPerm = true; // tous les membres utilisent la cale
  return `
    ${c.kind === 'flotte' ? '' : `<section class="crew-box">
      <h3>Banque commune</h3>
      <div class="bank-amount">${berry(c.bank)}</div>
      <div class="mj-row prog-row"><label for="bank-n">Montant</label><input id="bank-n" type="number" min="1" inputmode="numeric" placeholder="ex. 5000">
        ${can('bankIn') ? '<button class="btn sm" id="bank-in">Déposer</button>' : ''}${can('bankOut') ? '<button class="btn sm ghost" id="bank-out">Retirer</button>' : ''}</div>
    </section>`}
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
        <button class="btn" id="x-go" ${okPerm ? '' : 'disabled title="Ton grade ne le permet pas"'}>${cx.side === 'inv' ? 'Déposer dans la cale →' : '← Prendre'}</button>
      </div>` : '<p class="note" style="margin:0">Clique sur un objet pour choisir la quantité, ou fais glisser une pile entière d’un côté à l’autre.</p>'}
    </section>`;
}
function shipsTabHTML() {
  const c = CREW;
  const ship = c?.ship ? SHIPS.find((x) => x.id === c.ship) : null;
  const mine = SHIPS.filter((x) => x.owner?.kind === 'player' && x.owner.id === S.uid);
  const crewShips = c ? SHIPS.filter((x) => x.owner?.kind === 'crew' && x.owner.id === c.id) : [];
  return `
    ${c ? `<h3 class="ed-h" style="margin-top:0;border:none;padding-top:0">Bateaux ${G.crewWords(c).de}</h3>
      ${crewShips.length ? `<div class="ships">${crewShips.map((x) => shipCard(x, { extra: x.id === c.ship ? '<p class="note owner">⭐ Bateau attitré (sa cale sert de cale commune)</p>' : '', actions: can('ship') ? `<button class="btn sm ghost" data-ship-edit="${esc(x.id)}">Modifier</button>` : '', upgrade: can('ship') })).join('')}</div>` : `<p class="note">${G.crewWords(c).Nom === 'Flotte' ? 'La flotte' : 'L’équipage'} n’a pas encore de bateau.</p>`}
      ${can('ship') && [...mine, ...crewShips].length ? `<div class="mj-row" style="margin-top:10px"><label for="crew-ship">Bateau attitré</label>
        <select id="crew-ship"><option value="">Aucun</option>${[...crewShips, ...mine].map((x) => `<option value="${esc(x.id)}" ${x.id === c.ship ? 'selected' : ''}>${esc(x.name)} (${esc(x.type)}, ${G.kg(x.capacity)})</option>`).join('')}</select>
        <button class="btn sm" id="crew-ship-go">Choisir</button></div>
        <p class="note">Le bateau attitré donne sa cale à ${G.crewWords(c).le}. Un de tes bateaux choisi ici devient celui ${G.crewWords(c).de}.</p>` : ''}` : ''}
    <h3 class="ed-h">Mes bateaux</h3>
    ${mine.length ? `<div class="ships">${mine.map((x) => shipCard(x, { actions: `<button class="btn sm ghost" data-ship-edit="${esc(x.id)}">Nommer, décrire, photo</button>`, upgrade: true })).join('')}</div>` : '<p class="note">Tu n’as pas de bateau à toi. On en trouve dans certaines boutiques.</p>'}`;
}
function renderCrew() {
  if (!S || ADMIN) return;
  const c = CREW;
  // L'écran s'appelle « Flotte » pour un Marine dans une flotte
  document.querySelector('.scr[data-screen="crew"] span:last-child').textContent = c?.kind === 'flotte' ? 'Flotte' : 'Équipage';
  if (!c && crewTab !== 'ships') crewTab = 'crew';
  const head = c ? `
    <div class="crew-hero">
      <div class="flag">${c.flag ? `<img src="${imgSrc(c.flag)}" alt="${c.kind === 'flotte' ? 'Emblème' : 'Jolly Roger'}" onerror="this.replaceWith(document.createTextNode('☠'))">` : ico(1)}</div>
      <div>
        <h2>${esc(c.name)}</h2>
        <p class="lede" style="margin:4px 0 0">${c.kind === 'flotte' ? 'Flotte de la Marine · ' : ''}${c.members.length} membre${c.members.length > 1 ? 's' : ''} · ton grade : <b>${esc(G.rankName(c, S.uid))}</b></p>
      </div>
    </div>` : `<div class="no-shop">${ico(1)}<h2>${S.id.faction === 'Marine' ? 'Pas de flotte' : 'Pas d’équipage'}</h2><p class="note">${S.id.faction === 'Marine' ? 'Tu n’es affecté à aucune flotte. Un commandant peut t’inviter.' : 'Tu ne fais partie d’aucun équipage. Un capitaine peut t’inviter.'}</p></div>`;
  const tabs = `<div class="seg crew-seg" role="group" aria-label="Section">
    ${c ? `<button aria-pressed="${crewTab === 'crew'}" data-ct="crew">${c.kind === 'flotte' ? 'Flotte' : 'Équipage'}</button><button aria-pressed="${crewTab === 'cargo'}" data-ct="cargo">${c.kind === 'flotte' ? 'Cale' : 'Cale et banque'}</button>` : ''}
    <button aria-pressed="${crewTab === 'ships'}" data-ct="ships">Bateaux</button></div>`;
  $('v-crew').innerHTML = `${head}${invitesHTML()}${tabs}
    <div class="crew-body">${crewTab === 'ships' ? shipsTabHTML() : !c ? '' : crewTab === 'cargo' ? cargoHTML() : crewTabHTML()}</div>`;
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
    if (f.size > 4 * 1024 * 1024) return toast('Image trop lourde (4 Mo maximum).');
    run({ type: 'crew.edit', flag: await readAsDataUrl(f) });
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
        <div><label for="sh-cannons">Canons</label><input id="sh-cannons" type="number" min="0" value="${d.cannons}"></div>
        <div><label for="sh-cap">Cale (kg)</label><input id="sh-cap" type="number" min="0" value="${d.capacity}"></div>
        <div><label for="sh-berths">Places (personnes)</label><input id="sh-berths" type="number" min="1" value="${d.berths ?? 4}"></div>
        <div><label for="sh-sail">Vitesse (niveau de voile)</label><input id="sh-sail" type="number" min="1" value="${d.sail ?? 1}"></div>`}
        <div><label for="sh-owner">Propriétaire</label><select id="sh-owner"><option value="">Personne</option>
          <optgroup label="Flottes de la Marine">${Object.entries(fleet.crews || {}).filter(([, c]) => c.kind === 'flotte').map(([id, c]) => `<option value="crew:${esc(id)}" ${ownerVal === `crew:${id}` ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</optgroup>
          <optgroup label="Équipages">${Object.entries(fleet.crews || {}).filter(([, c]) => c.kind !== 'flotte').map(([id, c]) => `<option value="crew:${esc(id)}" ${ownerVal === `crew:${id}` ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</optgroup>
          <optgroup label="Joueurs">${players.map((p) => `<option value="player:${esc(p.uid)}" ${ownerVal === `player:${p.uid}` ? 'selected' : ''}>${esc(G.fullName({ id: p.ident }))}</option>`).join('')}</optgroup></select></div>
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
  if ($('sh-cannons')) {
    d.cannons = Math.max(0, Math.round(+$('sh-cannons').value || 0));
    d.capacity = Math.max(0, Math.round(+$('sh-cap').value || 0));
    d.berths = Math.max(1, Math.round(+$('sh-berths').value || 1));
    d.sail = Math.max(1, Math.round(+$('sh-sail').value || 1));
  }
  d.positionId = $('sh-pos').value.trim();
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
    if (f.size > 4 * 1024 * 1024) return void ($('sh-err').textContent = 'Image trop lourde (4 Mo maximum).');
    readShipEdit();
    shipDraft.photo = await readAsDataUrl(f);
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
      Object.assign(shipDraft, { capacity: out.ship.capacity, cannons: out.ship.cannons, sail: out.ship.sail, upgrades: out.ship.upgrades });
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

/* ═══ Marine (panneau admin) : grades, soldes, flottes ═══════════════════ */
function renderMarine() {
  if (!tools()) return;
  const marines = players.filter((p) => p.ident.faction === 'Marine').sort((a, b) => G.GRADES.indexOf(b.ident.grade) - G.GRADES.indexOf(a.ident.grade));
  const payroll = marines.reduce((a, p) => a + G.gradeOf(p.ident.grade).pay, 0);
  const fleets = Object.entries(fleet.crews || {}).filter(([, c]) => c.kind === 'flotte');
  $('v-marine').innerHTML = `
    <div class="sec-head">
      <div><h2>Marine</h2><p class="lede" style="margin:0">${marines.length} Marine${marines.length > 1 ? 's' : ''} · soldes versées : <b>${berry(payroll)}</b> par semaine. Chaque Marine touche sa solde à l’ouverture de l’app, selon son grade.</p></div>
      <button class="btn" id="marine-fleet">+ Nouvelle flotte</button>
    </div>
    <div class="grade-scale">${[...G.MARINE_GRADES].reverse().map((g) => {
      const n = marines.filter((p) => p.ident.grade === g.name).length;
      return `<span><b>${g.medal} ${esc(g.name)}</b><small>${berry(g.pay)} / sem. · ${n}</small></span>`;
    }).join('')}</div>
    <h3 class="ed-h">Effectifs</h3>
    ${marines.length ? `<div class="member-list">${marines.map((p) => {
      const i = G.GRADES.indexOf(p.ident.grade);
      const fl = p.crewId && fleet.crews?.[p.crewId]?.kind === 'flotte' ? fleet.crews[p.crewId].name : null;
      return `<div class="member-row marine-row">
        <span class="m-name"><b>${esc(G.fullName({ id: p.ident }))}</b><small class="note">${fl ? ` · ${esc(fl)}` : ' · sans flotte'}</small></span>
        <span class="rank-badge">${G.gradeOf(p.ident.grade).medal} ${esc(p.ident.grade)}</span>
        <span class="m-acts">
          <button class="sq" data-promote="${esc(p.uid)}" data-dir="1" ${i >= G.GRADES.length - 1 ? 'disabled' : ''} title="Promouvoir" aria-label="Promouvoir">↑</button>
          <button class="sq" data-promote="${esc(p.uid)}" data-dir="-1" ${i <= 0 ? 'disabled' : ''} title="Rétrograder" aria-label="Rétrograder">↓</button>
          <button class="btn sm ghost" data-open="${esc(p.uid)}">Fiche</button>
        </span>
      </div>`;
    }).join('')}</div>` : '<p class="note">Aucun Marine. Un joueur devient Marine quand sa faction est « Marine » (bouton Modifier de sa fiche).</p>'}
    <h3 class="ed-h">Flottes (${fleets.length})</h3>
    ${fleets.length ? `<div class="fleet-list">${fleets.map(([id, c]) => `
      <button class="gest-card" data-crew="${esc(id)}">
        <span class="slot-ico">${c.flag ? `<span class="ico item-img"><img src="${imgSrc(c.flag)}" alt=""></span>` : ico(160)}</span>
        <span><b>${esc(c.name)}</b><small>${c.members.length} membre${c.members.length > 1 ? 's' : ''}${(() => { const n = Object.values(fleet.ships || {}).filter((sh) => sh.owner?.kind === 'crew' && sh.owner.id === id).length; return ` · ${n} bateau${n > 1 ? 'x' : ''}`; })()}${c.ship && fleet.ships?.[c.ship] ? ` (attitré : ${esc(fleet.ships[c.ship].name)})` : ''}</small></span>
      </button>`).join('')}</div>` : '<p class="note">Aucune flotte.</p>'}`;
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

/* ═══ Flotte (panneau admin) : équipages et bateaux ══════════════════════ */
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
    return `${c?.kind === 'flotte' ? 'Flotte' : 'Équipage'} : ${c?.name ?? '?'}`;
  }
  return `Joueur : ${G.fullName({ id: players.find((p) => p.uid === o.id)?.ident || {} })}`;
};
/** Écran Équipages (panneau admin) : équipages pirates seulement. Les flottes sont dans l'écran Marine. */
function renderFleet() {
  if (!tools()) return;
  const el = $('v-fleet');
  if (!fleet.crews) return void (el.innerHTML = '<p class="note">Chargement…</p>');
  const crews = Object.entries(fleet.crews).filter(([, c]) => c.kind !== 'flotte').sort((a, b) => a[1].name.localeCompare(b[1].name));
  el.innerHTML = `
    <div class="sec-head">
      <div><h2>Équipages</h2><p class="lede" style="margin:0">Les équipages du RP. Les flottes de la Marine sont dans l’écran Marine.</p></div>
      <button class="btn" id="fleet-new">+ Nouvel équipage</button>
    </div>
    ${crews.length ? `<div class="fleet-list">${crews.map(([id, c]) => {
      const owned = Object.values(fleet.ships).filter((sh) => sh.owner?.kind === 'crew' && sh.owner.id === id).length;
      return `<button class="gest-card" data-crew="${esc(id)}">
        <span class="slot-ico flag-mini">${c.flag ? `<span class="ico item-img"><img src="${imgSrc(c.flag)}" alt=""></span>` : ico(1)}</span>
        <span><b>${esc(c.name)}</b><small>${c.members.length} membre${c.members.length > 1 ? 's' : ''} · ${berry(c.bank || 0)} · ${owned} bateau${owned > 1 ? 'x' : ''}${c.ship && fleet.ships[c.ship] ? ` (attitré : ${esc(fleet.ships[c.ship].name)})` : ''}</small></span>
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
    ${ships.length ? `<div class="fleet-list">${ships.map(([id, sh]) => `
      <button class="gest-card" data-ship="${esc(id)}">
        <span class="slot-ico">${sh.photo || sh.icon ? `<span class="ico item-img"><img src="${imgSrc(sh.photo || sh.icon)}" alt=""></span>` : ico(SHIP_ICON)}</span>
        <span><b>${esc(sh.name)}</b><small>${esc(sh.type)} · cale ${G.kg(sh.capacity)} · vitesse ${sh.sail ?? 1} · ${sh.berths ?? 4} places · ${sh.cannons} canons<br>${esc(ownerName(sh.owner))}${sh.position ? ` · ⚓ #${esc(sh.position.name || sh.position.channelId)}` : ''}</small></span>
      </button>`).join('')}</div>` : '<p class="note">Aucun bateau.</p>'}`;
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
$('v-ships').addEventListener('click', (e) => {
  if (e.target.closest('#ships-new')) return openShipEdit(null);
  const sh = e.target.closest('[data-ship]')?.dataset.ship;
  if (sh) return openShipEdit({ id: sh, ...fleet.ships[sh] });
});

/* Édition d'un équipage */
let crewDraft = null, crewDraftId = null, crewQuery = '', fleetKindNew = 'equipage';
function openCrewEdit(id) {
  crewDraftId = id;
  crewDraft = structuredClone(id ? fleet.crews[id] : { kind: fleetKindNew, name: '', flag: null, captain: null, members: [], bank: 0, chest: {}, ship: null });
  crewQuery = '';
  $('cr-title').textContent = id ? crewDraft.name : crewDraft.kind === 'flotte' ? 'Nouvelle flotte' : 'Nouvel équipage';
  $('cr-del').hidden = !id;
  $('cr-err').textContent = '';
  renderCrewEdit();
  openDialog('d-crew');
}
function renderCrewEdit() {
  const d = crewDraft;
  const q = normTxt(crewQuery);
  const list = players.filter((p) => (d.kind !== 'flotte' || p.ident.faction === 'Marine' || d.members.includes(p.uid)) && (!q || normTxt(G.fullName({ id: p.ident })).includes(q) || d.members.includes(p.uid)));
  $('cr-body').innerHTML = `
    <div class="form">
      <div class="wide"><label for="cr-name">Nom</label><input id="cr-name" value="${esc(d.name)}" maxlength="60"></div>
      <input type="hidden" id="cr-kind" value="${d.kind || 'equipage'}">
      ${d.kind === 'flotte' ? '<input type="hidden" id="cr-bank" value="0">' : `<div><label for="cr-bank">Banque (berrys)</label><input id="cr-bank" type="number" min="0" value="${d.bank || 0}"></div>`}
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
    <h3 class="ed-h">Membres (${d.members.length})${d.kind === 'flotte' ? ' <small class="note">Marines uniquement</small>' : ''}</h3>
    <input class="mj-search" id="cr-q" type="search" placeholder="Chercher un joueur…" value="${esc(crewQuery)}">
    <div class="member-pick">${list.map((p) => `<label><input type="checkbox" data-member="${esc(p.uid)}" ${d.members.includes(p.uid) ? 'checked' : ''}> ${esc(G.fullName({ id: p.ident }))}${p.crewId && p.crewId !== crewDraftId ? ` <small class="note">(dans ${esc(fleet.crews?.[p.crewId]?.name ?? 'un autre groupe')}, il le quittera)</small>` : ''}</label>`).join('') || '<p class="note">Aucun joueur.</p>'}</div>
    <div class="field"><label for="cr-cap">${d.kind === 'flotte' ? 'Commandant' : 'Capitaine'}</label><select id="cr-cap">${d.members.map((u) => `<option value="${esc(u)}" ${u === d.captain ? 'selected' : ''}>${esc(G.fullName({ id: players.find((p) => p.uid === u)?.ident || {} }))}</option>`).join('') || '<option value="">Ajoute d’abord des membres</option>'}</select></div>
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
    if (f.size > 4 * 1024 * 1024) return void ($('cr-err').textContent = 'Image trop lourde (4 Mo maximum).');
    readCrewEdit();
    crewDraft.flag = await readAsDataUrl(f);
    renderCrewEdit();
  }
});
$('d-crew').addEventListener('click', (e) => {
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
  if (!crewDraft.name.trim()) return void ($('cr-err').textContent = 'Donne un nom à l’équipage.');
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
  if (!(await askConfirm('Les membres n’auront plus d’équipage, la banque et le coffre seront perdus, et ses bateaux n’auront plus de propriétaire.', { title: `Supprimer ${crewDraft.name} ?`, ok: 'Supprimer', danger: true }))) return;
  try {
    const out = await API.staff('crew.delete', { id: crewDraftId });
    closeDialog($('d-crew'));
    toast(esc(out.toast));
    await Promise.all([loadFleet(), loadPlayers()]);
  } catch (err) {
    toast(esc(err.message));
  }
});

/* ═══ Gestion (staff) : base d'objets et recettes ════════════════════════ */
let gestTab = 'items', gestQuery = '';
let itemDraft = null, itemDraftId = null, recipeDraft = null, recipeDraftId = null;
function renderGestion() {
  if (!tools()) return;
  const q = gestQuery.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const match = (s) => !q || s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().includes(q);
  const items = Object.entries(G.ITEMS).filter(([, it]) => match(it.name)).sort((a, b) => a[1].name.localeCompare(b[1].name));
  const recs = Object.entries(G.RECIPES).filter(([, r]) => match(G.recipeLabel(r))).sort((a, b) => G.recipeLabel(a[1]).localeCompare(G.recipeLabel(b[1])));
  $('v-gest').innerHTML = `
    <div class="sec-head">
      <div><h2>Gestion</h2><p class="lede" style="margin:0">Les objets et les recettes du RP. La boutique de ce salon se gère dans l’écran Boutique.</p></div>
    </div>
    <div class="shop-bar">
      <div class="seg" role="group" aria-label="Section">
        <button aria-pressed="${gestTab === 'items'}" data-gt="items">Objets (${Object.keys(G.ITEMS).length})</button>
        <button aria-pressed="${gestTab === 'recipes'}" data-gt="recipes">Recettes (${Object.keys(G.RECIPES).length})</button>
      </div>
      <input class="mj-search gest-search" id="gest-q" type="search" placeholder="Chercher…" value="${esc(gestQuery)}" aria-label="Chercher">
      <button class="btn" id="gest-new">${gestTab === 'items' ? '+ Nouvel objet' : '+ Nouvelle recette'}</button>
    </div>
    ${gestTab === 'items'
      ? items.length ? `<div class="gest-grid">${items.map(([id, it]) => `
          <button class="gest-card" data-item="${esc(id)}">
            <span class="slot-ico">${itemIco(id)}</span>
            <span><b>${esc(it.name)}</b><small>${KIND[it.kind]} · ${it.value ? berry(it.value) : 'invendable'}${it.kind === 'bateau' ? ` · cale ${G.kg(it.ship.capacity)}, vitesse ${it.ship.sail}, ${it.ship.berths} places${it.ship.cannons ? `, ${it.ship.cannons} canons` : ''}` : ` · ${G.kg(it.weight || 0)}`}${it.kind === 'amelioration' ? ` · +${fmt(it.upgrade.amount)} ${G.UPGRADES[it.upgrade.type].unit}` : ''}</small></span>
          </button>`).join('')}</div>` : '<p class="note">Aucun objet. Crée le premier avec « + Nouvel objet ».</p>'
      : recs.length ? `<div class="gest-grid">${recs.map(([id, r]) => `
          <button class="gest-card" data-recipe="${esc(id)}">
            <span class="slot-ico">${itemIco(Object.keys(r.gives)[0])}</span>
            <span><b>${esc(G.recipeLabel(r))}</b><small>${r.job ? `${JOBS[r.job].name} · ${JOB_LEVELS[r.lvl - 1]}` : 'Tous métiers'} · ${r.seconds ? G.duree(r.seconds) : 'immédiat'} · ${Object.entries(r.needs).map(([k, q]) => `${q} ${esc(itemOf(k).name)}`).join(', ') || 'sans ingrédient'}</small></span>
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
  if (e.target.closest('#gest-new')) return gestTab === 'items' ? openItemEdit() : openRecipeEdit();
  const it = e.target.closest('[data-item]')?.dataset.item;
  if (it) return openItemEdit(it);
  const rc = e.target.closest('[data-recipe]')?.dataset.recipe;
  if (rc) return openRecipeEdit(rc);
});
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
  $('it-value').value = itemDraft.value;
  $('it-weight').value = itemDraft.weight ?? 0;
  const sh = itemDraft.ship || { cannons: 0, capacity: 100, berths: 4, sail: 1 };
  $('it-cannons').value = sh.cannons;
  $('it-cap').value = sh.capacity;
  $('it-berths').value = sh.berths ?? 4;
  $('it-sail').value = sh.sail ?? 1;
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
  $('it-preview').innerHTML = itemDraft.img ? `<img src="${imgSrc(itemDraft.img)}" alt="">` : ico(KIND_ICON[$('it-kind').value] ?? 237);
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
  if (f.size > 2 * 1024 * 1024) return void ($('it-err').textContent = 'Image trop lourde (2 Mo maximum).');
  itemDraft.img = await readAsDataUrl(f);
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
    name: $('it-name').value, kind: $('it-kind').value, value: +$('it-value').value || 0, weight: $('it-weight').value || 0, desc: $('it-desc').value, img: itemDraft.img,
    ship: { cannons: +$('it-cannons').value || 0, capacity: +$('it-cap').value || 0, berths: +$('it-berths').value || 1, sail: +$('it-sail').value || 1 },
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
      <div><label for="rc-lvl">Maîtrise requise</label><select id="rc-lvl" ${r.job ? '' : 'disabled'}>${JOB_LEVELS.map((l, i) => `<option value="${i + 1}" ${r.lvl === i + 1 ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div><label for="rc-time">Temps de fabrication</label><div class="rc-time"><input id="rc-time" type="number" min="0" value="${r.seconds / unit}"><select id="rc-unit">${Object.entries(UNITS).map(([u, l]) => `<option value="${u}" ${+u === unit ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
      <div class="wide"><label for="rc-desc">Description (facultative)</label><input id="rc-desc" value="${esc(r.desc)}" maxlength="400"></div>
    </div>
    <h3 class="ed-h">Résultat</h3>
    <div class="se-items">${rows(r.gives, 'gives')}</div>
    <button type="button" class="btn sm ghost" data-rc-add="gives">+ Ajouter un objet produit</button>
    <h3 class="ed-h">Ingrédients</h3>
    <div class="se-items">${rows(r.needs, 'needs') || '<p class="note">Aucun ingrédient.</p>'}</div>
    <button type="button" class="btn sm ghost" data-rc-add="needs">+ Ajouter un ingrédient</button>`;
}
function readRecipeEdit() {
  const r = recipeDraft;
  r.job = $('rc-job').value || null;
  r.lvl = +$('rc-lvl').value || 1;
  r.seconds = Math.round((+$('rc-time').value || 0) * +$('rc-unit').value);
  r.desc = $('rc-desc').value;
  for (const kind of ['needs', 'gives']) {
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
$('rc-save').addEventListener('click', () => {
  readRecipeEdit();
  if (!Object.keys(recipeDraft.gives).length) return void ($('rc-err').textContent = 'La recette doit produire au moins un objet.');
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
  if (name === 'ashop') renderAdminShops();
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
    if (screen === 'crew' && !document.activeElement?.closest('#v-crew')) renderCrew();
    if (screen === 'nav') renderNav();
    if (screen === 'shop' && !document.querySelector('#v-shop .ask-range:active')) renderShop();
    renderHero();
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

/* ═══ Démarrage ══════════════════════════════════════════════════════════ */
(async () => {
  paintStatic();
  $('ship-types').innerHTML = G.SHIP_TYPES.map((t) => `<option value="${esc(t)}">`).join('');
  let st;
  try {
    st = await API.boot();
    G.setCatalog(st.catalog);
    ME = st.me;
    S = st.player;
    SHOP = st.shop;
    CREW = st.crew;
    SHIPS = st.ships || [];
    INVITES = st.invites || [];
    NAVD = st.nav;
    CHNAME = st.channelName || '';
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
  $('boot').hidden = true;
  // Ouverte avec /panel admin ou /edit profil : panneau admin (et fiche du joueur pour /edit profil)
  if (st.open && ME.staff) await enterAdmin(st.open);
  if (st.openDenied) toast(OPEN_DENIED);
  if (st.salary?.amount) toast(`💰 Solde de la Marine versée : ${berry(st.salary.amount)} (${st.salary.weeks} semaine${st.salary.weeks > 1 ? 's' : ''})`);
  // Boutique et navigation : toutes les 10 s. Staff : toutes les 5 s (pour /edit profil).
  let tick = 0;
  setInterval(() => {
    tick++;
    if (ME.staff || (screen !== 'fiche' && tick % 2 === 0)) refresh();
  }, 5_000);
  document.addEventListener('visibilitychange', () => !document.hidden && refresh());
})();

$('reset').addEventListener('click', () => {
  API.resetDemo();
  location.reload();
});
