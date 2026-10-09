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
export const ico = (id) => `<span class="ico" aria-hidden="true" style="background-position:${pos(id)}"></span>`;
export const pic = (key) => `<span class="ico pic pic-${key}" aria-hidden="true"></span>`;
export const glyph = (g) => (typeof g === 'string' ? (g.startsWith('<') ? g : pic(g)) : ico(g));
export const paintStatic = (root = document) =>
  root.querySelectorAll('.ico[data-i]').forEach((el) => {
    el.style.backgroundPosition = pos(el.dataset.i);
  });
export const berry = (n) => `<span class="b" role="img" aria-label="berrys"></span>${fmt(n)}`;
export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const stars = (n, max = 5, big = false) =>
  `<span class="stars${big ? ' big' : ''}" role="img" aria-label="${n} étoile${n > 1 ? 's' : ''} sur ${max}">${Array.from({ length: max }, (_, i) => ico(i < n ? 125 : 126)).join('')}</span>`;

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
