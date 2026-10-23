/** Petits outils d'affichage et d'animation, sans logique de jeu. */
import { ICONMAP, COLS, ROWS } from './icons.js';
import { fmt } from '../shared/game.js';

document.documentElement.style.setProperty('--iconset', 'url(/assets/iconset.png)');
document.documentElement.style.setProperty('--cols', String(COLS));
document.documentElement.style.setProperty('--rows', String(ROWS));

export { fmt };
export const $ = (id) => document.getElementById(id);
const pos = (id) => {
  const k = ICONMAP[id] ?? 0;
  return `calc(var(--s) * -${k % COLS}) calc(var(--s) * -${Math.floor(k / COLS)})`;
};
/* Icônes personnalisées par le staff : { "slot:faction-marine": lien, "berry": lien… } */
let OVR = {};
let srcOf = (u) => u;
export function setIcons(map = {}, toSrc) {
  OVR = map || {};
  if (toSrc) srcOf = toSrc;
  document.documentElement.style.setProperty('--berry-img', OVR.berry ? `url("${srcOf(OVR.berry)}")` : 'url(/assets/berry.png)');
}
/**
 * Emplacements d'icônes : chaque usage a le sien, réglable séparément dans le panneau admin.
 * [groupe, libellé, icône par défaut (numéro dans la planche, ou nom d'image)]
 */
export const ICON_SLOTS = {
  'nav-fiche': ['Écrans', 'Ma fiche', 121], 'nav-shop': ['Écrans', 'Boutique', 265], 'nav-crew': ['Écrans', 'Équipage / Escouade', 1],
  'nav-map': ['Écrans', 'Carte', 231], 'nav-nav': ['Écrans', 'Navigation', 188],
  'nav-admin': ['Écrans', 'Joueurs (admin)', 125], 'nav-atech': ['Écrans', 'Techniques (admin)', 131], 'nav-ashop': ['Écrans', 'Boutiques (admin)', 265],
  'nav-amap': ['Écrans', 'Carte (admin)', 231], 'nav-marine': ['Écrans', 'Marine (admin)', 160], 'nav-fleet': ['Écrans', 'Équipages (admin)', 1],
  'nav-ships': ['Écrans', 'Bateaux (admin)', 231], 'nav-gest': ['Écrans', 'Gestion (admin)', 270], 'nav-aicons': ['Écrans', 'Icônes (admin)', 237], 'nav-aloot': ['Écrans', 'Butins (admin)', 331], 'nav-aperms': ['Écrans', 'Permissions (admin)', 125], 'nav-agames': ['Écrans', 'Mini-jeux (admin)', 279], 'nav-ainv': ['Écrans', 'Inventions (admin)', 'potion'], 'nav-afeat': ['Écrans', 'Fonctionnalités (admin)', 279], 'nav-acalc': ['Écrans', 'Calcul de trajet (admin)', 279], 'nav-asea': ['Écrans', 'Événements en mer (admin)', 279], 'nav-acook': ['Écrans', 'Cuisine (admin)', 192],
  'tab-t-perso': ['Onglets de la fiche', 'Stats & compétences', 96], 'tab-t-tech': ['Onglets de la fiche', 'Techniques', 131],
  'tab-t-inv': ['Onglets de la fiche', 'Inventaire', 270], 'tab-t-job': ['Onglets de la fiche', 'Métier', 279], 'tab-t-mj': ['Onglets de la fiche', 'Édition MJ', 125],
  'faction-pirate': ['Factions', 'Pirate', 1], 'faction-marine': ['Factions', 'Marine', 160], 'faction-revolutionnaire': ['Factions', 'Révolutionnaire', 96],
  'faction-chasseur': ['Factions', 'Chasseur de primes', 153], 'faction-civil': ['Factions', 'Civil', 121],
  'classe-fighter': ['Classes', 'Fighter', 128], 'classe-sabreur': ['Classes', 'Sabreur', 147], 'classe-tireur': ['Classes', 'Tireur', 153],
  'race-humain': ['Races', 'Humain', 121], 'race-mink': ['Races', 'Mink', 121], 'race-geant': ['Races', 'Géant', 121],
  'race-shandia': ['Races', 'Shandia', 121], 'race-homme-poisson': ['Races', 'Homme-poisson', 121], 'race-buccaneer': ['Races', 'Buccaneer', 121],
  'metier-navigateur': ['Métiers', 'Navigateur', 'compass'], 'metier-archeologue': ['Métiers', 'Archéologue', 'tmap'], 'metier-charpentier': ['Métiers', 'Charpentier', 'hammer'],
  'metier-scientifique': ['Métiers', 'Scientifique', 'potion'], 'metier-medecin': ['Métiers', 'Médecin', 'stetho'], 'metier-cuisinier': ['Métiers', 'Cuisinier', 'potion'], 'metier-aucun': ['Métiers', 'Aucun métier', 121],
  'stat-force': ['Statistiques', 'Force', 'st_swords'], 'stat-rapidite': ['Statistiques', 'Rapidité', 'st_leg'], 'stat-resistance': ['Statistiques', 'Résistance', 'st_shield'],
  'stat-sdc': ['Statistiques', 'Technique', 'st_sparkle'], volonte: ['Statistiques', 'Volonté', 'st_angry'],
  fruit: ['Fruit du démon et Haki', 'Fruit du démon', 'fruit'], 'haki-observation': ['Fruit du démon et Haki', 'Haki de l’observation', 12],
  'haki-armement': ['Fruit du démon et Haki', 'Haki de l’armement', 13], 'haki-rois': ['Fruit du démon et Haki', 'Haki des rois', 14],
  'objet-arme': ['Catégories d’objets (sans image)', 'Arme', 147], 'objet-conso': ['Catégories d’objets (sans image)', 'Consommable', 192],
  'objet-mat': ['Catégories d’objets (sans image)', 'Matériau', 331], 'objet-tresor': ['Catégories d’objets (sans image)', 'Trésor', 270],
  'objet-objet': ['Catégories d’objets (sans image)', 'Objet', 237], 'objet-bateau': ['Catégories d’objets (sans image)', 'Bateau', 231],
  'objet-amelioration': ['Catégories d’objets (sans image)', 'Amélioration de bateau', 266],
  'star-on': ['Divers', 'Étoile pleine', 125], 'star-off': ['Divers', 'Étoile vide', 126], 'ship-speed': ['Bateaux', 'Vitesse', 188], 'ship-robust': ['Bateaux', 'Robustesse', 'st_shield'], 'ship-power': ['Bateaux', 'Puissance offensive', 'st_swords'],
  'ship-engine': ['Bateaux', 'Moteur au cola', 266], 'ship-granit': ['Bateaux', 'Granit marin', 331], 'ship-plongee': ['Bateaux', 'Revêtement de plongée', 231],
  bourse: ['Divers', 'Bourse', 261],
};
const custom = (key) => (OVR[key] ? `<span class="ico item-img" aria-hidden="true"><img src="${esc(srcOf(OVR[key]))}" alt="" draggable="false"></span>` : null);
export const ico = (id) => custom(`ico:${id}`) ?? `<span class="ico" aria-hidden="true" style="background-position:${pos(id)}"></span>`;
export const pic = (key) => custom(`pic:${key}`) ?? `<span class="ico pic pic-${key}" aria-hidden="true"></span>`;
/** Icône d'un emplacement : celle choisie par le staff, sinon celle par défaut. */
export function icon(key) {
  const own = custom(`slot:${key}`);
  if (own) return own;
  const d = ICON_SLOTS[key]?.[2] ?? 237;
  return typeof d === 'number' ? ico(d) : pic(d);
}
/** Nombre = icône de la planche ; « @emplacement » = emplacement ; texte = image ; « <… » = HTML tout fait. */
export const glyph = (g) => (typeof g === 'string' ? (g.startsWith('<') ? g : g.startsWith('@') ? icon(g.slice(1)) : pic(g)) : ico(g));
/** Icônes écrites dans la page (boutons d'écran, onglets, bourse) : leur emplacement se déduit de leur place. */
export const paintStatic = (root = document) =>
  root.querySelectorAll('.ico[data-i]').forEach((el) => {
    const scr = el.closest('.scr')?.dataset.screen, tab = el.closest('.tab')?.id;
    const slot = scr ? `nav-${scr}` : tab ? `tab-${tab}` : el.closest('.purse') ? 'bourse' : null;
    const url = (slot && OVR[`slot:${slot}`]) || OVR[`ico:${el.dataset.i}`];
    if (url) {
      el.classList.add('item-img');
      el.style.backgroundPosition = '';
      el.innerHTML = `<img src="${esc(srcOf(url))}" alt="" draggable="false">`;
    } else {
      el.classList.remove('item-img');
      el.innerHTML = '';
      el.style.backgroundPosition = pos(el.dataset.i);
    }
  });
export const berry = (n) => `<span class="b" role="img" aria-label="berrys"></span>${fmt(n)}`;
export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const stars = (n, max = 5, big = false) =>
  `<span class="stars${big ? ' big' : ''}" role="img" aria-label="${n} étoile${n > 1 ? 's' : ''} sur ${max}">${Array.from({ length: max }, (_, i) => icon(i < n ? 'star-on' : 'star-off')).join('')}</span>`;

export const calm = matchMedia('(prefers-reduced-motion: reduce)');
export function replay(el, cls) {
  if (!el || calm.matches) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
  el.addEventListener('animationend', () => el.classList.remove(cls), { once: true });
}
export function countTo(el, from, to, suffix = '') {
  if (!el) return;
  if (calm.matches || from === to) {
    el.innerHTML = berry(to) + suffix;
    return;
  }
  const t0 = performance.now(), dur = 650;
  cancelAnimationFrame(el._raf);
  const step = (now) => {
    const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
    el.innerHTML = berry(Math.round(from + (to - from) * e)) + suffix;
    if (k < 1) el._raf = requestAnimationFrame(step);
  };
  el._raf = requestAnimationFrame(step);
}
export function floatText(host, html, gain = false) {
  if (!host || calm.matches) return;
  const f = document.createElement('span');
  f.className = 'float' + (gain ? ' gain' : '');
  f.innerHTML = html;
  host.appendChild(f);
  f.addEventListener('animationend', () => f.remove());
}
export function fillGauges(root) {
  if (calm.matches || !root) return;
  root.querySelectorAll('.gauge i').forEach((i) => {
    const w = i.style.width;
    i.style.width = '0%';
    requestAnimationFrame(() => requestAnimationFrame(() => (i.style.width = w)));
  });
}
let toastTimer;
export function toast(html, icon) {
  const el = $('toast');
  el.innerHTML = (icon != null ? glyph(icon) : '') + `<span>${html}</span>`;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}
export function openDialog(id) {
  const d = $(id);
  d.classList.remove('closing');
  d.showModal();
}
export function closeDialog(d) {
  if (calm.matches) return d.close();
  d.classList.add('closing');
  d.querySelector('.panel').addEventListener(
    'animationend',
    () => {
      d.classList.remove('closing');
      d.close();
    },
    { once: true },
  );
}
document.querySelectorAll('dialog:not(.levelup)').forEach((d) => {
  d.addEventListener('click', (e) => {
    if (e.target === d || e.target.closest('[data-close]')) closeDialog(d);
  });
  d.addEventListener('cancel', (e) => {
    e.preventDefault();
    closeDialog(d);
  });
});

/** Lit un fichier image en data URL. */
export const readAsDataUrl = (file) =>
  new Promise((ok, ko) => {
    const r = new FileReader();
    r.onload = () => ok(r.result);
    r.onerror = ko;
    r.readAsDataURL(file);
  });

/**
 * Confirmation dans l'app. Les fenêtres du navigateur (confirm, alert) sont
 * bloquées dans les Activities Discord : on utilise la nôtre.
 */
export function askConfirm(message, { title = 'Confirmer', ok = 'Confirmer', danger = false } = {}) {
  const d = $('d-confirm');
  $('cf-title').textContent = title;
  $('cf-text').textContent = message;
  const btn = $('cf-ok');
  btn.textContent = ok;
  btn.classList.toggle('danger', danger);
  return new Promise((resolve) => {
    const done = (v) => {
      btn.removeEventListener('click', yes);
      d.removeEventListener('close', no);
      resolve(v);
    };
    const yes = () => {
      done(true);
      closeDialog(d);
    };
    const no = () => done(false);
    btn.addEventListener('click', yes);
    d.addEventListener('close', no);
    openDialog('d-confirm');
    btn.focus();
  });
}

/** Petite saisie de texte dans l'app (prompt est bloqué dans Discord). Renvoie le texte, ou null si annulé. */
export function askText(message, { title = 'Saisie', ok = 'Valider', placeholder = '', value = '', max = 60 } = {}) {
  const d = $('d-prompt');
  $('pr-title').textContent = title;
  $('pr-text').textContent = message;
  const input = $('pr-input');
  input.value = value;
  input.placeholder = placeholder;
  input.maxLength = max;
  $('pr-ok').textContent = ok;
  $('pr-err').textContent = '';
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      $('pr-form').removeEventListener('submit', submit);
      d.removeEventListener('close', cancel);
      resolve(v);
    };
    const submit = (e) => {
      e.preventDefault();
      const v = input.value.trim();
      if (!v) return void ($('pr-err').textContent = 'Ce champ est obligatoire.');
      finish(v);
      closeDialog(d);
    };
    const cancel = () => finish(null);
    $('pr-form').addEventListener('submit', submit);
    d.addEventListener('close', cancel);
    openDialog('d-prompt');
    input.focus();
  });
}

/**
 * Lit une image en la réduisant si elle est trop grande (côté le plus long ≤ max)
 * ou trop lourde (> 3 Mo), en gardant la transparence. Les GIF ne sont pas touchés
 * (on perdrait l'animation). Renvoie une data URL prête à envoyer.
 */
export async function readImage(file, { max = 2048, maxBytes = 3 * 1024 * 1024 } = {}) {
  const raw = await readAsDataUrl(file);
  if (file.type === 'image/gif') return raw;
  const img = await new Promise((ok) => {
    const i = new Image();
    i.onload = () => ok(i);
    i.onerror = () => ok(null);
    i.src = raw;
  });
  if (!img) return raw;
  const big = Math.max(img.naturalWidth, img.naturalHeight);
  if (big <= max && file.size <= maxBytes) return raw;
  let scale = Math.min(1, max / big), out = raw;
  for (let tries = 0; tries < 6; tries++) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * scale));
    c.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, c.width, c.height);
    // WebP garde la transparence et pèse peu ; si le navigateur ne sait pas en faire, PNG.
    out = c.toDataURL('image/webp', 0.9);
    if (!out.startsWith('data:image/webp')) out = c.toDataURL('image/png');
    if (out.length * 0.75 <= maxBytes) return out;
    scale *= 0.75;
  }
  return out;
}
