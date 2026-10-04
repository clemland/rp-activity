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

const { ITEMS, JOBS, STATS, HAKI, SLOTS, KIND, JOB_LEVELS, JOB_NEED, XP_NEED, STAT_MAX, ASK_MAX, BAG } = G;

/* ═══ État ═══════════════════════════════════════════════════════════════ */
let ME = null; // { uid, name, staff }
let S = null; // fiche affichée
let SHOP = null; // boutique du salon (ou null)
let NAV = null; // navigation du salon
let CHNAME = ''; // nom du salon
let VIEW = null; // uid d'un autre joueur ouvert par le staff (lecture seule pour lui)
const shown = {};
const fullName = () => G.fullName(S);
const count = (k) => G.count(S, k);
const isEquipped = (k) => G.isEquipped(S, k);
const equippedCount = (k) => G.equippedCount(S, k);

/* ═══ Actions : optimistes quand le résultat ne dépend pas du hasard ═════ */
const OPTIMISTIC = new Set(['stats', 'inv.move', 'inv.drop', 'equip', 'unequip', 'job.do', 'job.up', 'shop.buy', 'tech.delete', 'nav.toggle', 'photo.remove']);
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
  if (out.nav) NAV = out.nav;
  renderAll();
  if (!quiet && out.toast) toast(esc(out.toast), out.icon);
  if (!noUps) showLevelUp(out.ups);
}

/** Action du joueur sur sa fiche. Renvoie le résultat, ou null en cas d'erreur. */
async function run(action) {
  if (VIEW) return null;
  const before = { S, SHOP, NAV };
  let local = null;
  if (OPTIMISTIC.has(action.type)) {
    try {
      local = G.playerAction(S, action, { shop: SHOP, nav: NAV, channelId: API.channelId });
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
      ({ S, SHOP, NAV } = before);
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
const CLASS_ICON = { Épéiste: { icon: 147 }, Combattant: { icon: 128 }, Tireur: { icon: 153 }, Stratège: { icon: 231 }, Soigneur: { icon: 192 }, Voleur: { icon: 240 } };

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
  const job = JOBS[S.job.id];
  $('h-traits').innerHTML = [
    ['Race', S.id.race, 121],
    ['Classe', S.id.classe, CLASS_ICON[S.id.classe]?.icon ?? 147],
    ['Métier', job.name, job.pic],
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
  $('open-edit').hidden = !ME.staff;
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
          ${ME.staff && !t.ok ? `<button class="btn sm" data-ok-tech="${t.id}">Valider</button><button class="btn sm ghost" data-no-tech="${t.id}">Refuser</button>` : ''}
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
    const [k, q] = selItem, it = ITEMS[k], eq = isEquipped(k);
    det = `<div class="detail" id="inv-detail">
      <div class="slot-ico">${ico(it.icon)}</div>
      <div><h3>${esc(it.name)} <span class="tag">${KIND[it.kind]}</span></h3><p>${esc(it.desc)} Quantité : ${q}. Valeur : ${it.value ? berry(it.value) : 'aucune'}.</p></div>
      <div class="acts">
        ${it.slot ? `<button class="btn sm" data-equip="${k}">${eq && equippedCount(k) >= count(k) ? 'Retirer' : 'Équiper'}</button>` : ''}
        <button class="btn sm ghost" data-drop="${sel}" ${eq && equippedCount(k) >= count(k) ? 'disabled title="Retire-le d’abord"' : ''}>Jeter un</button>
      </div>
    </div>`;
  }
  $('v-inv').innerHTML = `
    <div class="sec-head"><h2>Inventaire</h2><span class="pill">${ico(261)}<b>${berry(S.berry)}</b></span></div>
    <p class="lede">${used} / ${BAG} emplacements · ${n} objet${n > 1 ? 's' : ''}.</p>
    <div class="equip">
      ${Object.entries(SLOTS).map(([sl, label]) => {
        const k = S.equip[sl], it = k && ITEMS[k];
        return `<button class="eslot ${it ? 'filled' : ''}" data-eslot="${sl}" aria-label="${label}${it ? ' : ' + esc(it.name) + ', cliquer pour retirer' : ' vide'}">
          <span class="frame">${it ? ico(it.icon) : ''}</span>
          <span><b>${label}</b><span class="n">${it ? esc(it.name) : 'Glisse une arme ici'}</span></span>
        </button>`;
      }).join('')}
    </div>
    <div class="hold" id="hold">
      ${S.inv.map((s, i) => {
        if (!s) return `<div class="cell empty" data-slot="${i}"></div>`;
        const [k, q] = s, it = ITEMS[k];
        return `<button class="cell" data-slot="${i}" aria-pressed="${sel === i}" aria-label="${esc(it.name)}, quantité ${q}${isEquipped(k) ? ', équipé' : ''}">${ico(it.icon)}${isEquipped(k) ? '<span class="eq">É</span>' : ''}${q > 1 ? `<span class="qty">${q}</span>` : ''}</button>`;
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
    d.ghost.innerHTML = ico(icon);
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
  if (drag) ghostMove(drag, e, ITEMS[S.inv[drag.from]?.[0]]?.icon, '#v-inv .cell, #v-inv .eslot');
  if (sdrag) ghostMove(sdrag, e, ITEMS[sdrag.k].icon, '#drop-counter');
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
      if (ITEMS[k].slot !== 'arme') {
        replay(t, 'shake');
        return toast(`${esc(ITEMS[k].name)} n’est pas une arme`);
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

/* ═══ Métier ═════════════════════════════════════════════════════════════ */
let jobAction = null;
function renderJob() {
  const job = JOBS[S.job.id], lvl = S.job.lvl, need = JOB_NEED[lvl - 1];
  const full = need != null && S.job.xp >= need;
  const acts = job.actions;
  if (!jobAction || !acts.find((a) => a.id === jobAction)) jobAction = acts.find((a) => a.lvl <= lvl)?.id ?? acts[0].id;
  const a = acts.find((x) => x.id === jobAction);
  const needs = Object.entries(a.needs), tools = Object.entries(a.tools || {});
  const missing = [...needs, ...tools].some(([k, q]) => count(k) < q);
  const chip = ([k, q], showQty = true) => {
    const h = count(k);
    return `<span class="need ${h >= q ? 'have' : 'miss'}">${ico(ITEMS[k].icon)}${ITEMS[k].name}${showQty ? ` ${h}/${q}` : ''}</span>`;
  };
  $('v-job').innerHTML = `
    <div class="job-head">
      <div class="badge">${pic(job.pic)}</div>
      <div>
        <h2>${job.name} <span class="pips" aria-label="Niveau ${lvl} sur 3">${[1, 2, 3].map((i) => `<i class="${i <= lvl ? 'on' : ''}"></i>`).join('')}</span></h2>
        <p class="lede" style="margin:0">${JOB_LEVELS[lvl - 1]}. ${job.desc}</p>
      </div>
    </div>
    <div style="margin-top:14px">
      ${need != null ? `
        <div class="gauge ${full ? 'full' : ''}" role="progressbar" aria-label="Expérience de métier" aria-valuenow="${Math.min(S.job.xp, need)}" aria-valuemax="${need}"><i style="width:${Math.min(100, (S.job.xp / need) * 100)}%"></i></div>
        <div class="gauge-cap"><span>Vers ${JOB_LEVELS[lvl]}</span><span>${Math.min(S.job.xp, need)} / ${need}</span></div>
        ${full ? `<div style="margin-top:10px"><button class="btn" id="job-up">Passer ${JOB_LEVELS[lvl]}</button></div>` : ''}`
      : '<p class="note">Niveau maximal atteint : tu es Maître dans ton métier.</p>'}
    </div>
    <div class="field">
      <label for="job-select">Réaliser une action</label>
      <select class="menu" id="job-select">
        ${acts.map((x) => `<option value="${x.id}" ${x.id === jobAction ? 'selected' : ''}>${x.lvl > lvl ? '🔒 ' : ''}${x.name} (${JOB_LEVELS[x.lvl - 1]})</option>`).join('')}
      </select>
    </div>
    <div class="recipe" id="recipe">
      <h3>${a.name}</h3>
      <p>${a.desc}</p>
      <b>Objets requis</b>
      <div class="needs">${needs.length ? needs.map((x) => chip(x)).join('') : '<span class="note">Aucun objet nécessaire.</span>'}</div>
      ${tools.length ? `<b>Outils (non consommés)</b><div class="needs">${tools.map((x) => chip(x, false)).join('')}</div>` : ''}
      ${Object.keys(a.gives).length ? `<b>Résultat</b><div class="needs">${Object.entries(a.gives).map(([k, q]) => `<span class="need">${ico(ITEMS[k].icon)}${q} × ${ITEMS[k].name}</span>`).join('')}</div>` : ''}
      <div class="recipe-foot">
        <span class="note">+${a.xp} XP${a.jxp && need != null ? ` · +${a.jxp} XP de métier` : ''}</span>
        ${a.lvl > lvl ? `<span class="req">Demande le niveau ${JOB_LEVELS[a.lvl - 1]}</span>`
          : `<button class="btn" id="job-do" ${missing ? 'disabled' : ''}>${missing ? 'Objets manquants' : 'Réaliser l’action'}</button>`}
      </div>
    </div>`;
}
$('v-job').addEventListener('change', (e) => {
  if (e.target.id !== 'job-select') return;
  jobAction = e.target.value;
  renderJob();
  replay($('recipe'), 'in');
});
$('v-job').addEventListener('click', async (e) => {
  if (e.target.id === 'job-up' && (await run({ type: 'job.up' }))) replay(document.querySelector('#v-job .badge'), 'bought');
  if (e.target.id === 'job-do' && (await run({ type: 'job.do', id: jobAction }))) replay($('recipe'), 'bought');
});

/* ═══ Navigation ═════════════════════════════════════════════════════════ */
const WHEEL = `<svg class="wheel" viewBox="0 0 100 100" aria-hidden="true"><g stroke="#17255e" stroke-width="3" stroke-linecap="round">
  ${[0, 45, 90, 135].map((a) => `<g transform="rotate(${a} 50 50)"><line x1="50" y1="4" x2="50" y2="96" stroke-width="7"/><line x1="50" y1="4" x2="50" y2="96" stroke="#b9772f" stroke-width="3"/><circle cx="50" cy="5" r="4.5" fill="#b9772f"/><circle cx="50" cy="95" r="4.5" fill="#b9772f"/></g>`).join('')}
  <circle cx="50" cy="50" r="31" fill="none" stroke-width="10"/><circle cx="50" cy="50" r="31" fill="none" stroke="#8a5320" stroke-width="5"/>
  <circle cx="50" cy="50" r="10" fill="#e6a223"/></g></svg>`;
let navSeen = Infinity;
function logHTML(entry, i) {
  const nw = i >= navSeen ? ' new' : '';
  if (entry.t === 'msg') return `<div class="msg${nw}"><small>${esc(entry.name || '')}</small>${esc(entry.text)}</div>`;
  if (entry.t === 'sys') return `<div class="sys${nw}">${esc(entry.text)}</div>`;
  const mine = entry.uid === S.uid && !VIEW;
  const v = G.eventView(entry, mine ? S : null);
  if (!v) return '';
  const res = entry.result ? `${entry.ok === true ? '<span class="ok">Réussi.</span> ' : entry.ok === false ? '<span class="req">Raté.</span> ' : ''}${esc(entry.result)}` : '';
  return `<div class="event ${v.tone}${nw}">
    <h3>${ico(v.icon)}${esc(v.title)}</h3>
    ${entry.name ? `<small class="note">Pour ${esc(entry.name)}</small>` : ''}
    <p>${esc(v.text)}</p>
    ${res ? `<div class="result">${entry.roll ? `<span class="roll">${esc(entry.roll)}</span>` : ''}${res}</div>`
      : v.choices.length ? (mine ? `<div class="choices">${v.choices.map((c) => `<button class="btn sm" data-choice="${c.i}" data-entry="${esc(entry.id)}">${esc(c.label)} <small>(${esc(c.hint)})</small></button>`).join('')}</div>` : '<p class="note">En attente du choix du joueur.</p>') : ''}
  </div>`;
}
function renderNav() {
  if (!NAV) NAV = G.newNav();
  const active = NAV.active, demo = API.mode === 'demo';
  $('v-nav').innerHTML = `
    <aside class="helm ${active ? 'sailing' : ''}">
      <h2>Navigation</h2>
      <p class="note" style="margin:0">Dans ce salon RP, chaque message peut déclencher un événement en mer.</p>
      ${WHEEL}
      <div class="state">${active ? 'En mer' : 'Au port'}</div>
      <div class="chance">${active ? `<b>${G.NAV_CHANCE} %</b> de chances d’événement par message RP` : 'La navigation est arrêtée.'}</div>
      <button class="btn" id="nav-toggle" ${VIEW ? 'disabled' : ''}>${active ? 'Jeter l’ancre' : 'Lever l’ancre'}</button>
      <ul>
        <li>Chaque message RP rapporte ${G.NAV_XP} XP (au plus un toutes les ${G.NAV_COOLDOWN_MS / 1000} s).</li>
        <li>Les choix se jouent au d20 + ta stat, ton Haki ou ta Volonté.</li>
        ${S.effects.meteo > 0 ? `<li class="ok">Météo lue : mauvaises rencontres divisées par deux (${S.effects.meteo} événement${S.effects.meteo > 1 ? 's' : ''}).</li>` : '<li>Un navigateur qui lit la météo réduit les mauvaises rencontres.</li>'}
        ${S.effects.coque > 0 ? `<li class="ok">Coque renforcée : mauvaises rencontres divisées par deux (${S.effects.coque} événement${S.effects.coque > 1 ? 's' : ''}).</li>` : ''}
      </ul>
    </aside>
    <section class="logbook">
      <h2>Journal de bord</h2>
      <div class="sea-log" id="sea-log" aria-live="polite">
        ${NAV.log.length ? NAV.log.map(logHTML).join('') : `<p class="empty">${active ? 'Écris tes actions RP dans le salon : les événements apparaîtront ici.' : 'Lève l’ancre pour commencer la navigation dans ce salon.'}</p>`}
      </div>
      ${demo ? `<form class="composer" id="nav-form">
        <label for="nav-input" style="position:absolute;left:-9999px">Ton action RP</label>
        <textarea id="nav-input" placeholder="${active ? 'Démo : écris une action RP comme dans le salon…' : 'Lève l’ancre pour commencer'}" ${active ? '' : 'disabled'} maxlength="400"></textarea>
        <button class="btn" type="submit" ${active ? '' : 'disabled'}>Envoyer</button>
      </form>` : `<p class="discord-hint">Écris tes actions RP directement dans le salon Discord. Le bot y annonce les événements, et tu peux faire tes choix ici ou avec ses boutons.</p>`}
    </section>`;
  navSeen = NAV.log.length;
  const log = $('sea-log');
  log.scrollTop = log.scrollHeight;
}
$('v-nav').addEventListener('click', async (e) => {
  if (e.target.closest('#nav-toggle')) {
    if (await run({ type: 'nav.toggle' })) {
      replay(document.querySelector('.helm .wheel'), 'turn');
      $('nav-input')?.focus();
    }
    return;
  }
  const ch = e.target.closest('[data-choice]');
  if (ch) {
    ch.disabled = true;
    await run({ type: 'nav.choose', entryId: ch.dataset.entry, choice: +ch.dataset.choice });
  }
});
$('v-nav').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('nav-input');
  const text = input.value.trim();
  if (!text) return input.focus();
  const out = API.demoMessage(text);
  applyOut({ ...out, toast: null });
  $('nav-input')?.focus();
});
$('v-nav').addEventListener('keydown', (e) => {
  if (e.target.id === 'nav-input' && e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    $('nav-form').requestSubmit();
  }
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
    const [k, q] = s, it = ITEMS[k];
    return `<button class="cell scell ${!it.value ? 'nosell' : ''} ${sellItem === k ? 'on-counter' : ''}" data-sslot="${i}" aria-label="${esc(it.name)}, quantité ${q}${!it.value ? ', invendable' : ''}">${ico(it.icon)}${isEquipped(k) ? '<span class="eq">É</span>' : ''}${q > 1 ? `<span class="qty">${q}</span>` : ''}</button>`;
  }).join('');
  let counter = `<div class="drop-hint">${ico(261)}<b>Glisse un objet ici</b><span>ou clique dessus dans ton inventaire</span></div>`;
  if (sellItem) {
    const k = sellItem, it = ITEMS[k], eq = isEquipped(k) && equippedCount(k) >= count(k), a = askBlock(k);
    counter = `<div class="offer">
      <div class="offer-head"><div class="slot-ico">${ico(it.icon)}</div><div><h3>${esc(it.name)}</h3><p class="note">Tu en as ${count(k)}.</p></div><button class="close sm-close" data-unsell aria-label="Reprendre l’objet">×</button></div>
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
  if (!ITEMS[k].value) return toast(`${esc(ITEMS[k].name)} ne se vend pas`, ITEMS[k].icon);
  sellItem = k;
  renderShop();
  replay($('drop-counter'), 'bought');
  const r = $('drop-counter').getBoundingClientRect();
  if (r.top < 0 || r.bottom > innerHeight) $('drop-counter').scrollIntoView({ block: 'center', behavior: calm.matches ? 'auto' : 'smooth' });
}
function renderShop() {
  const el = $('v-shop');
  if (!SHOP) {
    el.innerHTML = `<div class="no-shop">${ico(265)}<h2>Pas de boutique ici</h2><p class="note">Aucun marchand ne tient boutique dans ce salon${CHNAME ? ` (#${esc(CHNAME)})` : ''}.</p>
      ${ME.staff && !VIEW ? '<button class="btn" id="shop-create">Ouvrir une boutique dans ce salon</button>' : ''}</div>`;
    return;
  }
  const rows = shopMode === 'buy'
    ? SHOP.items.map(([k, price, left]) => {
        const it = ITEMS[k], out = left === 0, poor = S.berry < price;
        return `<div class="ware" data-ware="${k}">
          <div class="slot-ico">${ico(it.icon)}</div>
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
  if (!ME.staff || VIEW || !base) return;
  shopDraft = structuredClone(base);
  renderShopEdit();
  $('se-err').textContent = '';
  openDialog('d-shopedit');
}
function renderShopEdit() {
  const d = shopDraft;
  const opts = (s) => Object.entries(ITEMS).map(([k, it]) => `<option value="${k}" ${k === s ? 'selected' : ''}>${esc(it.name)}</option>`).join('');
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
          <span class="se-ico">${ico(ITEMS[k].icon)}</span>
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
    shopDraft.items.push(['gigot', 1000, -1]);
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
  if (!shopDraft.items.length) return void ($('se-err').textContent = 'La boutique doit vendre au moins un objet.');
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
  ['first', 'Prénom', 'text'], ['last', 'Nom', 'text'], ['epithet', 'Surnom', 'text'],
  ['faction', 'Faction', 'select', G.FACTIONS],
  ['crew', 'Équipage', 'text', null, 'nomarine'], ['crewRole', 'Rôle', 'text'],
  ['grade', 'Grade Marine', 'select', G.GRADES, 'marine'],
  ['race', 'Race', 'select', G.RACES], ['classe', 'Classe', 'select', G.CLASSES],
  ['job', 'Métier', 'select', Object.keys(JOBS), null, JOBS],
  ['bounty', 'Prime (berrys)', 'number', null, 'nomarine'],
  ['fruitName', 'Fruit du démon (vide = aucun)', 'text'], ['fruitType', 'Type de fruit', 'select', G.FRUIT_TYPES],
];
const fieldVal = (k) => (k === 'job' ? S.job.id : k === 'fruitName' ? S.fruit?.name ?? '' : k === 'fruitType' ? S.fruit?.type ?? 'Paramecia' : S.id[k]);
function openEdit() {
  if (!ME.staff) return;
  $('edit-fields').innerHTML = FIELDS().map(([k, label, type, opts, show, labels]) => {
    const id = `f-${k}`, v = fieldVal(k);
    const control = type === 'select'
      ? `<select id="${id}" name="${k}">${opts.map((o) => `<option value="${o}" ${o === v ? 'selected' : ''}>${labels ? labels[o].name : o}</option>`).join('')}</select>`
      : `<input id="${id}" name="${k}" type="${type}" value="${esc(v)}" ${type === 'number' ? 'min="0" inputmode="numeric"' : 'maxlength="40"'}>`;
    return `<div data-show="${show || ''}"><label for="${id}">${label}</label>${control}${k === 'job' ? '<small class="note">Changer de métier remet son niveau à Apprenti.</small>' : ''}</div>`;
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
  if (!d.first.trim() && !d.last.trim()) {
    $('edit-err').textContent = 'Indique au moins un prénom ou un nom.';
    return $('f-first').focus();
  }
  const patch = {
    id: { first: d.first, last: d.last, epithet: d.epithet, faction: d.faction, crewRole: d.crewRole, race: d.race, classe: d.classe,
      ...(d.crew != null && { crew: d.crew }), ...(d.grade != null && { grade: d.grade }), ...(d.bounty != null && { bounty: +d.bounty }) },
    job: d.job, jobLvl: +d.jobLvl, volonte: +d.vol,
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

/* ═══ Mode MJ : ouvrir la fiche d'un joueur ══════════════════════════════ */
let players = [];
async function renderMJ() {
  const viewing = VIEW ? S : null;
  $('mj-body').innerHTML = `
    ${viewing ? `<div class="mj-block"><h3>Fiche ouverte : ${esc(fullName())}</h3>
      <div class="mj-row"><button class="btn sm" data-mj-xp="100">+100 XP</button><button class="btn sm" data-mj-xp="500">+500 XP</button></div>
      <div class="mj-row"><select id="mj-item">${Object.entries(ITEMS).map(([k, it]) => `<option value="${k}">${esc(it.name)}</option>`).join('')}</select>
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
  const list = players.filter((p) => !q || norm(`${p.ident.first || ''} ${p.ident.last || ''} ${p.ident.epithet || ''}`).includes(norm(q)));
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
$('open-mj').addEventListener('click', () => {
  openDialog('d-mj');
  renderMJ();
});

async function openPlayer(uid) {
  setBusy(1);
  try {
    const st = await API.state(uid === ME.uid ? undefined : uid);
    VIEW = uid === ME.uid ? null : uid;
    S = st.player;
    pending = {};
    sel = null;
    shown.photo = null;
    document.body.classList.toggle('readonly', !!VIEW);
    $('mj-banner').hidden = !VIEW;
    $('mj-banner').innerHTML = VIEW ? `<span>Mode MJ : fiche de <b>${esc(fullName())}</b></span><button class="btn sm" id="mj-back">Revenir à ma fiche</button>` : '';
    document.querySelectorAll('.scr[data-screen="shop"], .scr[data-screen="nav"]').forEach((b) => (b.hidden = !!VIEW));
    if (VIEW) showScreen('fiche');
    renderAll();
  } catch (err) {
    toast(esc(err.message));
  } finally {
    setBusy(-1);
  }
}
$('mj-banner').addEventListener('click', (e) => e.target.id === 'mj-back' && openPlayer(ME.uid));

/* ═══ Onglets, écrans, rendu ═════════════════════════════════════════════ */
const RENDER = [renderPerso, renderTech, renderInv, renderJob, renderNav, renderShop];
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

/** Rafraîchit la boutique et la navigation du salon (achats et événements des autres joueurs). */
async function refresh() {
  if (API.mode !== 'discord' || VIEW || busy || document.hidden) return;
  try {
    const st = await API.state();
    if (busy || VIEW) return;
    S = st.player;
    SHOP = st.shop;
    NAV = st.nav;
    if (screen === 'nav') renderNav();
    if (screen === 'shop' && !document.querySelector('#v-shop .ask-range:active')) renderShop();
    renderHero();
    paintStatic();
  } catch {}
}

/* ═══ Démarrage ══════════════════════════════════════════════════════════ */
(async () => {
  paintStatic();
  try {
    const st = await API.boot();
    ME = st.me;
    S = st.player;
    SHOP = st.shop;
    NAV = st.nav;
    CHNAME = st.channelName || '';
  } catch (err) {
    console.error(err);
    $('boot').classList.add('error');
    $('boot-msg').textContent = `Impossible de charger ta fiche : ${err.message || err}. Ferme puis relance l’Activity.`;
    return;
  }
  $('open-mj').hidden = !ME.staff;
  $('reset').hidden = API.mode !== 'demo';
  $('foot-note').textContent = API.mode === 'demo' ? 'Démo : les données restent dans ce navigateur.' : `Connecté en tant que ${ME.name}.`;
  renderAll();
  selectTab(tabs[0]);
  showScreen('fiche');
  fillGauges(document.querySelector('.hero'));
  $('boot').hidden = true;
  setInterval(() => screen !== 'fiche' && refresh(), 10_000);
  document.addEventListener('visibilitychange', () => !document.hidden && refresh());
})();

$('reset').addEventListener('click', () => {
  API.resetDemo();
  location.reload();
});
