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
import {
  $, ico, pic, glyph, paintStatic, berry, esc, stars, fmt, calm, replay, countTo, floatText, fillGauges, toast,
  openDialog, closeDialog, readAsDataUrl,
} from './ui.js';

const { JOBS, STATS, HAKI, SLOTS, KIND, JOB_LEVELS, XP_NEED, STAT_MAX, ASK_MAX, BAG } = G;
const itemOf = (k) => G.itemOf(k);
/** Icône d'un objet : son image si le staff en a mis une, sinon une icône selon sa catégorie. */
const KIND_ICON = { arme: 147, conso: 192, mat: 331, tresor: 270, objet: 237 };
const itemIco = (k) => {
  const it = itemOf(k);
  return it.img ? `<span class="ico item-img" aria-hidden="true"><img src="${esc(it.img)}" alt="" loading="lazy"></span>` : ico(KIND_ICON[it.kind] ?? 237);
};

/* ═══ État ═══════════════════════════════════════════════════════════════ */
let ME = null; // { uid, name, staff }
let S = null; // fiche affichée
let SHOP = null; // boutique du salon (ou null)
let CHNAME = ''; // nom du salon
let ADMIN = false; // panneau admin (/panel admin, /edit profil) ; /profil = vue joueur pure, même pour le staff
const tools = () => ADMIN && !!ME?.staff;
let VIEW = null; // uid d'un autre joueur ouvert par le staff (lecture seule pour lui)
const shown = {};
const fullName = () => G.fullName(S);
const count = (k) => G.count(S, k);
const isEquipped = (k) => G.isEquipped(S, k);
const equippedCount = (k) => G.equippedCount(S, k);

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
  renderAll();
  if (!quiet && out.toast) toast(esc(out.toast), out.item ? itemIco(out.item) : out.icon);
  if (!noUps) showLevelUp(out.ups);
}

const OPEN_DENIED = 'Le site ne te reconnaît pas comme staff : /edit profil est refusé. Mets les mêmes OWNER_IDS / STAFF_ROLE_IDS que le bot dans les variables Vercel, puis redéploie.';

/** Action du joueur sur sa fiche. Renvoie le résultat, ou null en cas d'erreur. */
async function run(action) {
  if (VIEW) return null;
  if (!S) return null;
  const before = { S, SHOP };
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
  setBusy(1);
  try {
    const out = await API.act(action);
    applyOut(out, { quiet: !!local, noUps: !!local });
    return out;
  } catch (e) {
    if (local) {
      ({ S, SHOP } = before);
      renderAll();
    }
    toast(esc(e.message || 'Erreur.'));
    return null;
  } finally {
    setBusy(-1);
  }
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
const PORTRAIT = `
<svg viewBox="0 0 200 230" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Portrait du personnage">
  <rect width="200" height="230" fill="#9fd3ef"/>
  <path d="M0 150 Q25 142 50 150 T100 150 T150 150 T200 150 V230 H0Z" fill="#3a78c9"/>
  <path d="M0 150 Q25 142 50 150 T100 150 T150 150 T200 150" fill="none" stroke="#fff" stroke-width="3"/>
  <g stroke="#17255e" stroke-width="4" stroke-linejoin="round" stroke-linecap="round">
    <path d="M14 232 C22 188 52 172 100 172 C148 172 178 188 186 232Z" fill="#26306e"/>
    <path d="M60 178 L82 232 M140 178 L118 232" fill="none" stroke-width="3"/>
    <path d="M78 174 L100 214 L122 174Z" fill="#f4ecd8"/>
    <path d="M84 150 L84 178 Q100 190 116 178 L116 150Z" fill="#e9b07c"/>
    <path d="M52 92 L44 60 L64 72 L66 44 L82 64 L92 38 L104 60 L120 40 L126 66 L144 50 L140 78 L158 74 L148 98Z" fill="#3a2418"/>
    <ellipse cx="100" cy="112" rx="42" ry="47" fill="#f1bf8c"/>
    <path d="M58 116 Q50 112 52 124 Q54 136 64 134" fill="#f1bf8c"/>
    <path d="M142 116 Q150 112 148 124 Q146 136 136 134" fill="#f1bf8c"/>
    <path d="M58 92 Q100 64 142 92 L140 104 Q100 82 60 104Z" fill="#2a9d8f"/>
    <path d="M140 96 L166 88 L158 104 L170 116 L146 106Z" fill="#2a9d8f"/>
    <path d="M72 104 L66 96 L74 98 L72 88 L82 100 L90 94 L88 104" fill="#3a2418" stroke-width="3"/>
    <path d="M70 116 L90 120 M130 116 L110 120" stroke-width="5"/>
    <path d="M76 128 Q82 124 88 128" fill="none" stroke-width="5"/>
    <path d="M112 128 Q118 124 124 128" fill="none" stroke-width="5"/>
    <path d="M100 128 L96 142 L103 143" fill="none" stroke-width="3"/>
    <path d="M78 150 Q100 166 124 148 Q118 140 100 146 Q86 148 78 150Z" fill="#fff"/>
    <path d="M86 150 L86 156 M100 147 L100 158 M113 146 L113 155" stroke-width="2"/>
    <path d="M122 132 L134 142 M132 130 L124 144" stroke="#b5523a" stroke-width="3"/>
  </g>
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
  if (typeof p.photo === 'string') return `<img src="${esc(p.photo)}" alt="Portrait de ${name}" ${broken}>`;
  const f = p.photo;
  return `<img class="ph-link" src="${esc(f.url)}" alt="Portrait de ${name}" style="left:${f.l}%;top:${f.t}%;width:${f.w}%" ${broken}>`;
}
function affiliation() {
  const { faction, crew, crewRole, grade } = S.id;
  if (faction === 'Marine') return `<b>${esc(grade)}</b> de la Marine${crewRole ? `, ${esc(crewRole)}` : ''}`;
  return [crewRole && `<b>${esc(crewRole)}</b>`, crew && esc(crew)].filter(Boolean).join(', ');
}
function badgeHTML() {
  const { faction, grade, bounty } = S.id;
  if (faction === 'Marine') {
    const i = G.GRADES.indexOf(grade);
    const marks = i >= 7 ? '<i class="star"></i>'.repeat(i - 6) : '<i></i>'.repeat(Math.max(0, Math.min(i, 4)));
    return `<div class="plaque blue"><span class="pl-label">Grade</span><div class="chev">${marks}</div><span class="pl-value">${esc(grade)}</span></div>`;
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
  $('open-edit').hidden = !(tools() && VIEW && VIEW !== ME.uid);
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
    $('ph-img').src = src;
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
  img.src = src;
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
const SRC_CLS = { physique: 'src-physique', arme: 'src-lame', haki: 'src-haki', fruit: 'src-fruit' };
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
          ${t.media ? `<span class="t-thumb"><img src="${esc(t.media)}" alt="" loading="lazy"></span>` : ''}
          <span><span class="t-name">${esc(t.name)}</span>${t.ok ? '' : '<span class="status wait">À valider</span>'}<br><span class="t-meta"><span class="${SRC_CLS[t.src]}">${G.TECH_SOURCES[t.src]}</span></span></span>
          <span class="cost"><span class="chev" aria-hidden="true">▾</span></span>
        </summary>
        ${t.media ? `<div class="t-media"><img src="${esc(t.media)}" alt="Illustration de ${esc(t.name)}" loading="lazy" onerror="this.parentElement.classList.add('broken');this.remove()"></div>` : ''}
        <p>${esc(t.desc) || '<em>Pas de description.</em>'}</p>
        <div class="t-actions">
          <button class="btn sm ghost" data-edit-tech="${t.id}">Modifier</button><button class="btn sm ghost" data-del-tech="${t.id}">Supprimer</button>
          ${tools() && VIEW && VIEW !== ME.uid && !t.ok ? `<button class="btn sm" data-ok-tech="${t.id}">Valider</button><button class="btn sm ghost" data-no-tech="${t.id}">Refuser</button>` : ''}
        </div>
      </details>`).join('') || '<p class="note">Aucune technique pour l’instant.</p>'}`;
}
function showTechMedia() {
  const box = $('tf-preview');
  box.innerHTML = techMedia
    ? `<img src="${esc(techMedia)}" alt="Aperçu" onerror="this.parentElement.innerHTML='<span class=&quot;note&quot;>Aperçu impossible. Le serveur récupérera l’image à l’enregistrement.</span>'">`
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
    const [k, q] = selItem, it = itemOf(k), eq = isEquipped(k);
    det = `<div class="detail" id="inv-detail">
      <div class="slot-ico">${itemIco(k)}</div>
      <div><h3>${esc(it.name)} <span class="tag">${KIND[it.kind]}</span></h3><p>${esc(it.desc)} Quantité : ${q}. Valeur : ${it.value ? berry(it.value) : 'aucune'}.</p></div>
      <div class="acts">
        ${G.isWeapon(k) ? `<button class="btn sm" data-equip="${k}">${eq && equippedCount(k) >= count(k) ? 'Retirer' : 'Équiper'}</button>` : ''}
        <button class="btn sm ghost" data-drop="${sel}" ${eq && equippedCount(k) >= count(k) ? 'disabled title="Retire-le d’abord"' : ''}>Jeter un</button>
      </div>
    </div>`;
  }
  $('v-inv').innerHTML = `
    <div class="sec-head"><h2>Inventaire</h2><span class="pill">${ico(261)}<b>${berry(S.berry)}</b></span></div>
    <p class="lede">${used} / ${BAG} emplacements · ${n} objet${n > 1 ? 's' : ''}.</p>
    <div class="equip">
      ${Object.entries(SLOTS).map(([sl, label]) => {
        const k = S.equip[sl], it = k && itemOf(k);
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
        return `<button class="cell" data-slot="${i}" aria-pressed="${sel === i}" aria-label="${esc(it.name)}, quantité ${q}${isEquipped(k) ? ', équipé' : ''}">${itemIco(k)}${isEquipped(k) ? '<span class="eq">É</span>' : ''}${q > 1 ? `<span class="qty">${q}</span>` : ''}</button>`;
      }).join('')}
    </div>
    ${det}`;
}
async function equip(k, slot) {
  const out = await run({ type: 'equip', key: k, slot });
  if (out?.slot || slot) replay(document.querySelector(`#v-inv [data-eslot="${out?.slot || slot}"]`), 'bought');
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
      return void equip(k, t.dataset.eslot);
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
  const eqk = e.target.closest('[data-equip]')?.dataset.equip;
  if (eqk) return void equip(eqk);
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
        <p class="lede" style="margin:0">${job ? `${JOB_LEVELS[S.job.lvl - 1]}. Ta maîtrise débloque de nouvelles recettes.` : 'Tu peux réaliser les recettes ouvertes à tous.'}</p>
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
        ${tools() && VIEW && VIEW !== ME.uid && !ready ? '<button class="btn sm ghost" id="craft-finish" title="Outil MJ">Terminer (MJ)</button>' : ''}
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
        <h3>${esc(r.name)}</h3>
        <p class="note">${r.job ? `${JOBS[r.job].name} · ${JOB_LEVELS[r.lvl - 1]}` : 'Tous métiers'} · ${r.seconds ? `⏳ ${G.duree(r.seconds)}` : 'immédiat'}</p>
        ${r.desc ? `<p>${esc(r.desc)}</p>` : ''}
        <b>Il faut</b>
        <div class="needs">${Object.entries(r.needs).map((x) => needChip(x)).join('') || '<span class="note">Rien</span>'}</div>
        <b>Donne</b>
        <div class="needs">${Object.entries(r.gives).map((x) => needChip(x, false)).join('')}</div>
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
  if (e.target.id === 'craft-cancel' && confirm('Annuler la fabrication ? Les ingrédients te seront rendus.')) run({ type: 'craft.cancel' });
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

/* ═══ Navigation (à venir) ═══════════════════════════════════════════════ */
function renderNav() {
  $('v-nav').innerHTML = `<section class="logbook nav-soon">
    <h2>Navigation</h2>
    <p class="lede">La navigation arrive bientôt.</p>
  </section>`;
}


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
    return `<button class="cell scell ${!it.value ? 'nosell' : ''} ${sellItem === k ? 'on-counter' : ''}" data-sslot="${i}" aria-label="${esc(it.name)}, quantité ${q}${!it.value ? ', invendable' : ''}">${itemIco(k)}${isEquipped(k) ? '<span class="eq">É</span>' : ''}${q > 1 ? `<span class="qty">${q}</span>` : ''}</button>`;
  }).join('');
  let counter = `<div class="drop-hint">${ico(261)}<b>Glisse un objet ici</b><span>ou clique dessus dans ton inventaire</span></div>`;
  if (sellItem) {
    const k = sellItem, it = itemOf(k), eq = isEquipped(k) && equippedCount(k) >= count(k), a = askBlock(k);
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
function renderShopAdmin() {
  const el = $('v-shop');
  if (!SHOP) {
    el.innerHTML = `<div class="no-shop">${ico(265)}<h2>Pas de boutique ici</h2><p class="note">Aucun marchand ne tient boutique dans ce salon${CHNAME ? ` (#${esc(CHNAME)})` : ''}.</p>
      <button class="btn" id="shop-create">Ouvrir une boutique dans ce salon</button></div>`;
    return;
  }
  const rows = SHOP.items.map(([k, price, left]) => {
    const it = itemOf(k);
    return `<div class="ware">
      <div class="slot-ico">${itemIco(k)}</div>
      <div><h3>${esc(it.name)} <span class="tag">${KIND[it.kind]}</span></h3><div class="stock">${left < 0 ? 'Stock illimité' : left === 0 ? 'Épuisé' : `${left} en stock`}</div></div>
      <div class="buy"><span class="price">${berry(price)}</span></div>
    </div>`;
  }).join('');
  el.innerHTML = `
    <div class="counter">
      <div class="face" id="seller-face">${SHOP.img ? `<img src="${esc(SHOP.img)}" alt="${esc(SHOP.seller)}">` : `<span aria-hidden="true">${esc(SHOP.face || '🙂')}</span>`}</div>
      <div><h2>${esc(SHOP.name)}</h2><p>${esc(SHOP.seller)} · rachat à ${Math.round(SHOP.buyRate * 100)} %</p></div>
      <button class="btn" id="shop-edit">Modifier la boutique</button>
    </div>
    <div class="shop-bar"><span class="chan-tag">${esc(SHOP.channel)}</span><span class="note">Vue admin : ce que vend la boutique de ce salon.</span></div>
    <div class="wares">${rows || '<p class="note">Aucun objet en vente.</p>'}</div>`;
}
function renderShop() {
  if (ADMIN) return renderShopAdmin();
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
      <div class="face" id="seller-face">${SHOP.img ? `<img src="${esc(SHOP.img)}" alt="${esc(SHOP.seller)}">` : `<span aria-hidden="true">${esc(SHOP.face || '🙂')}</span>`}</div>
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
  if (e.target.closest('#shop-create')) return openShopEdit(G.newShop(CHNAME));
  if (e.target.closest('#shop-edit')) return openShopEdit();
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
function openShopEdit(base = SHOP) {
  if (!tools() || !base) return;
  shopDraft = structuredClone(base);
  renderShopEdit();
  $('se-err').textContent = '';
  openDialog('d-shopedit');
}
function renderShopEdit() {
  const d = shopDraft;
  const opts = (s) => Object.entries(G.ITEMS).map(([k, it]) => `<option value="${k}" ${k === s ? 'selected' : ''}>${esc(it.name)}</option>`).join('');
  $('se-body').innerHTML = `
    <div class="form">
      <div><label for="se-chan">Salon</label><input id="se-chan" value="${esc(d.channel)}" maxlength="40"></div>
      <div><label for="se-name">Nom de la boutique</label><input id="se-name" value="${esc(d.name)}" maxlength="40"></div>
      <div><label for="se-seller">Vendeur</label><input id="se-seller" value="${esc(d.seller)}" maxlength="30"></div>
      <div><label for="se-rate">Rachat (% de la valeur)</label><input id="se-rate" type="number" min="5" max="100" value="${Math.round(d.buyRate * 100)}"></div>
    </div>
    <div class="se-face">
      <div class="face">${d.img ? `<img src="${esc(d.img)}" alt="">` : `<span>${esc(d.face || '🙂')}</span>`}</div>
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
      ${SHOP ? '<button type="button" class="btn sm ghost" id="se-close-shop">Fermer la boutique</button>' : ''}</div>`;
}
function readShopEdit() {
  const d = shopDraft;
  d.channel = $('se-chan').value.trim() || d.channel;
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
  if (e.target.id === 'se-close-shop' && confirm('Fermer la boutique de ce salon ? Ses objets en vente seront supprimés.')) {
    const out = await API.staff('shop.delete').catch((err) => toast(esc(err.message)));
    if (out) {
      SHOP = null;
      closeDialog($('d-shopedit'));
      renderShop();
      toast(out.toast);
    }
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
  $('se-save').disabled = true;
  try {
    const out = await API.staff('shop.save', { shop: shopDraft });
    SHOP = out.shop;
    closeDialog($('d-shopedit'));
    renderShop();
    toast(esc(out.toast));
  } catch (err) {
    $('se-err').textContent = err.message;
  } finally {
    $('se-save').disabled = false;
  }
});
let faceTimer = null;
$('v-shop').addEventListener('dblclick', (e) => e.target.closest('#seller-face') && openShopEdit());
$('v-shop').addEventListener('pointerdown', (e) => {
  if (!e.target.closest('#seller-face') || e.pointerType === 'mouse') return;
  faceTimer = setTimeout(() => openShopEdit(), 650);
});
['pointerup', 'pointerleave', 'pointercancel'].forEach((t) => $('v-shop').addEventListener(t, () => clearTimeout(faceTimer)));

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

/* ═══ Onglet Édition MJ (staff) ═══════════════════════════════════════════ */
function renderMjTab() {
  const tab = $('t-mj');
  const show = tools() && VIEW && VIEW !== ME.uid;
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
        ${t.media ? `<div class="val-media"><img src="${esc(t.media)}" alt="Illustration de ${esc(t.name)}" loading="lazy" onerror="this.parentElement.remove()"></div>` : ''}
        <div class="val-body">
          <h3>${esc(t.name)} <span class="tag ${SRC_CLS[t.src]}">${G.TECH_SOURCES[t.src]}</span></h3>
          <p>${esc(t.desc) || '<em>Pas de description.</em>'}</p>
          <div class="val-acts"><button class="btn sm" data-ok-tech="${t.id}">✓ Valider</button><button class="btn sm ghost" data-no-tech="${t.id}">✗ Refuser</button></div>
        </div>
      </article>`).join('')}</div>` : '<p class="note">Aucune technique en attente.</p>'}

    <h3 class="ed-h">Objets et expérience</h3>
    <div class="mj-tools">
      <div class="mj-row">
        <select id="mjt-item" aria-label="Objet">${Object.entries(G.ITEMS).map(([k, it]) => `<option value="${k}">${esc(it.name)}</option>`).join('')}</select>
        <input id="mjt-qty" type="number" min="1" value="1" style="width:76px" aria-label="Quantité">
        <button class="btn sm" data-mjt-give="give">Donner</button><button class="btn sm ghost" data-mjt-give="take">Retirer</button>
      </div>
      <div class="mj-row">
        <span class="note">Expérience :</span>
        <button class="btn sm" data-mjt-xp="50">+50 XP</button><button class="btn sm" data-mjt-xp="250">+250 XP</button><button class="btn sm" data-mjt-xp="1000">+1000 XP</button>
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
  const xp = e.target.closest('[data-mjt-xp]')?.dataset.mjtXp;
  if (xp) return void staffAct({ type: 'xp', amount: +xp });
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
    pending = {};
    sel = null;
    shown.photo = null;
    document.body.classList.add('readonly');
    updateNav();
    showScreen('fiche');
    renderAll();
    selectTab($(tab && VIEW !== ME.uid ? tab : 't-perso'));
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
}
$('mj-banner').addEventListener('click', (e) => e.target.id === 'mj-back' && closePlayer());

/* ═══ Panneau admin (/panel admin, /edit profil) ═════════════════════════ */
/** Boutons d'écran : vue joueur (fiche, boutique, navigation) ou panneau admin. */
function updateNav() {
  const vis = { fiche: !ADMIN || !!VIEW, shop: true, nav: !ADMIN, admin: ADMIN, gest: tools() };
  scrBtns.forEach((b) => (b.hidden = !vis[b.dataset.screen]));
  document.querySelector('.scr[data-screen="fiche"] span:last-child').textContent = ADMIN ? 'Fiche ouverte' : 'Ma fiche';
  document.body.classList.toggle('admin', ADMIN);
  $('mj-banner').hidden = !ADMIN;
  $('mj-banner').innerHTML = !ADMIN ? ''
    : VIEW ? `<span>Panneau admin : fiche de <b>${esc(fullName())}</b>${VIEW === ME.uid ? ' (ta fiche : lecture seule)' : ''}</span><button class="btn sm" id="mj-back">← Liste des joueurs</button>`
    : '<span>Panneau admin</span>';
  document.querySelector('.wallet-chips').hidden = ADMIN && !VIEW;
}
let players = [], playersLoaded = false;
async function renderAdminHome() {
  if (!ADMIN) return;
  $('v-admin').innerHTML = `
    <div class="sec-head"><div><h2>Joueurs</h2><p class="lede" style="margin:0">Ouvre une fiche pour la modifier, valider ses techniques ou lui donner des objets.</p></div></div>
    <input class="mj-search" id="adm-search" type="search" placeholder="Chercher un joueur…" aria-label="Chercher un joueur">
    <div class="mj-players adm-players" id="mj-players"><p class="note">Chargement…</p></div>
    <p class="note" style="margin-top:12px">Pour enregistrer un nouveau joueur : <code>/register</code> sur Discord.</p>`;
  try {
    players = (await API.staff('players')).players;
    playersLoaded = true;
  } catch (err) {
    $('mj-players').innerHTML = `<p class="req">${esc(err.message)}</p>`;
    return;
  }
  renderPlayers('');
}
$('v-admin').addEventListener('input', (e) => e.target.id === 'adm-search' && renderPlayers(e.target.value));
$('v-admin').addEventListener('click', (e) => {
  const open = e.target.closest('[data-open]')?.dataset.open;
  if (open) openPlayer(open, { tab: 't-mj' });
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
  if (target) await openPlayer(target, { tab: 't-mj' });
}

/* ═══ Gestion (staff) : base d'objets et recettes ════════════════════════ */
let gestTab = 'items', gestQuery = '';
let itemDraft = null, itemDraftId = null, recipeDraft = null, recipeDraftId = null;
function renderGestion() {
  if (!tools()) return;
  const q = gestQuery.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const match = (s) => !q || s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().includes(q);
  const items = Object.entries(G.ITEMS).filter(([, it]) => match(it.name)).sort((a, b) => a[1].name.localeCompare(b[1].name));
  const recs = Object.entries(G.RECIPES).filter(([, r]) => match(r.name)).sort((a, b) => a[1].name.localeCompare(b[1].name));
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
            <span><b>${esc(it.name)}</b><small>${KIND[it.kind]} · ${it.value ? berry(it.value) : 'invendable'}</small></span>
          </button>`).join('')}</div>` : '<p class="note">Aucun objet. Crée le premier avec « + Nouvel objet ».</p>'
      : recs.length ? `<div class="gest-grid">${recs.map(([id, r]) => `
          <button class="gest-card" data-recipe="${esc(id)}">
            <span class="slot-ico">${itemIco(Object.keys(r.gives)[0])}</span>
            <span><b>${esc(r.name)}</b><small>${r.job ? `${JOBS[r.job].name} · ${JOB_LEVELS[r.lvl - 1]}` : 'Tous métiers'} · ${r.seconds ? G.duree(r.seconds) : 'immédiat'}</small></span>
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
  $('it-desc').value = itemDraft.desc;
  $('it-url').value = '';
  $('it-del').hidden = !id;
  $('it-err').textContent = '';
  showItemImg();
  openDialog('d-item');
}
function showItemImg() {
  $('it-preview').innerHTML = itemDraft.img ? `<img src="${esc(itemDraft.img)}" alt="">` : ico(KIND_ICON[$('it-kind').value] ?? 237);
  $('it-noimg').hidden = !itemDraft.img;
}
$('it-kind').addEventListener('change', showItemImg);
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
  const item = { name: $('it-name').value, kind: $('it-kind').value, value: +$('it-value').value || 0, desc: $('it-desc').value, img: itemDraft.img };
  if (!item.name.trim()) return void ($('it-err').textContent = 'Donne un nom à l’objet.');
  gestCall('item.save', { id: itemDraftId, item }, $('d-item'));
});
$('it-del').addEventListener('click', () => {
  if (confirm(`Supprimer « ${G.itemOf(itemDraftId).name} » ? Les joueurs qui l’ont le verront comme « Objet supprimé ».`)) gestCall('item.delete', { id: itemDraftId }, $('d-item'));
});

/* Recette */
const UNITS = { 1: 'secondes', 60: 'minutes', 3600: 'heures', 86400: 'jours' };
function openRecipeEdit(id = null) {
  if (!Object.keys(G.ITEMS).length) return toast('Crée d’abord des objets.');
  recipeDraftId = id;
  const first = Object.keys(G.ITEMS)[0];
  recipeDraft = structuredClone(id ? G.RECIPES[id] : { name: '', job: null, lvl: 1, seconds: 3600, needs: {}, gives: { [first]: 1 }, desc: '' });
  $('rc-title').textContent = id ? 'Modifier la recette' : 'Nouvelle recette';
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
      <div class="wide"><label for="rc-name">Nom de la recette</label><input id="rc-name" value="${esc(r.name)}" maxlength="60"></div>
      <div><label for="rc-job">Métier</label><select id="rc-job"><option value="">Tous les métiers</option>${Object.entries(JOBS).map(([k, j]) => `<option value="${k}" ${r.job === k ? 'selected' : ''}>${j.name}</option>`).join('')}</select></div>
      <div><label for="rc-lvl">Maîtrise requise</label><select id="rc-lvl" ${r.job ? '' : 'disabled'}>${JOB_LEVELS.map((l, i) => `<option value="${i + 1}" ${r.lvl === i + 1 ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div><label for="rc-time">Temps de fabrication</label><div class="rc-time"><input id="rc-time" type="number" min="0" value="${r.seconds / unit}"><select id="rc-unit">${Object.entries(UNITS).map(([u, l]) => `<option value="${u}" ${+u === unit ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
      <div class="wide"><label for="rc-desc">Description (facultative)</label><input id="rc-desc" value="${esc(r.desc)}" maxlength="400"></div>
    </div>
    <h3 class="ed-h">Ingrédients</h3>
    <div class="se-items">${rows(r.needs, 'needs') || '<p class="note">Aucun ingrédient.</p>'}</div>
    <button type="button" class="btn sm ghost" data-rc-add="needs">+ Ajouter un ingrédient</button>
    <h3 class="ed-h">Résultat</h3>
    <div class="se-items">${rows(r.gives, 'gives')}</div>
    <button type="button" class="btn sm ghost" data-rc-add="gives">+ Ajouter un objet produit</button>`;
}
function readRecipeEdit() {
  const r = recipeDraft;
  r.name = $('rc-name').value;
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
  if (!recipeDraft.name.trim()) return void ($('rc-err').textContent = 'Donne un nom à la recette.');
  if (!Object.keys(recipeDraft.gives).length) return void ($('rc-err').textContent = 'La recette doit produire au moins un objet.');
  gestCall('recipe.save', { id: recipeDraftId, recipe: recipeDraft }, $('d-recipe'));
});
$('rc-del').addEventListener('click', () => {
  if (confirm(`Supprimer la recette « ${G.RECIPES[recipeDraftId].name} » ?`)) gestCall('recipe.delete', { id: recipeDraftId }, $('d-recipe'));
});

/* ═══ Onglets, écrans, rendu ═════════════════════════════════════════════ */
const RENDER = [renderPerso, renderTech, renderInv, renderJob, renderMjTab, renderNav, renderShop, renderGestion];
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
    renderShop();
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
  if (name === 'shop') drawAwning();
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
    if (ADMIN) {
      SHOP = st.shop;
      if (screen === 'shop') renderShop();
      return;
    }
    if (busy || VIEW) return;
    S = st.player;
    SHOP = st.shop;
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

/* ═══ Démarrage ══════════════════════════════════════════════════════════ */
(async () => {
  paintStatic();
  let st;
  try {
    st = await API.boot();
    G.setCatalog(st.catalog);
    ME = st.me;
    S = st.player;
    SHOP = st.shop;
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
