/**
 * Connexion à Discord quand le site tourne dans une Activity.
 * Hors Discord (navigateur classique) : un simple message, la démo est désactivée.
 */
import { DiscordSDK } from '@discord/embedded-app-sdk';

export const inDiscord = () => new URLSearchParams(location.search).has('frame_id');

// Erreur de l’app : affichée à l’écran (sinon le chargement tourne sans fin, sans rien dire)
function showFatal(msg) {
  let box = document.getElementById('fatal-err');
  if (!box) {
    box = document.createElement('div');
    box.id = 'fatal-err';
    box.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:99999;background:#fff3f0;color:#8e130d;border:3px solid #8e130d;border-radius:10px;padding:10px 14px;font:14px/1.4 monospace;white-space:pre-wrap;max-height:45vh;overflow:auto';
    document.body.appendChild(box);
  }
  box.textContent = `⚠️ Erreur de l’app (envoie ce message) :\n${msg}`.slice(0, 2000);
}
window.addEventListener('error', (e) => showFatal(`${e.message}\n${e.filename?.split('/').pop() || ''}:${e.lineno || ''}\n${e.error?.stack || ''}`));
window.addEventListener('unhandledrejection', (e) => showFatal(`${e.reason?.message || e.reason}\n${e.reason?.stack || ''}`));

// Hors Discord : plus de démo, on invite simplement à ouvrir l'app depuis Discord
if (!inDiscord()) {
  document.body.innerHTML = `<main style="min-height:100vh;display:grid;place-items:center;padding:24px;font-family:Georgia,'Times New Roman',serif;background:#17255e">
    <div style="max-width:420px;text-align:center;background:#f3e3bb;border:4px solid #0d1640;border-radius:16px;padding:28px 24px;color:#3d2614;box-shadow:0 8px 0 rgba(0,0,0,.35)">
      <div style="font-size:52px;line-height:1">🏴‍☠️</div>
      <h1 style="margin:12px 0 8px;font-size:26px">Ouvre l’app depuis Discord</h1>
      <p style="margin:0;font-size:17px">Tape <b>/profil</b> dans le serveur pour accéder à ta fiche.</p>
    </div>
  </main>`;
  throw new Error('Hors Discord : ouvre l’app depuis Discord avec /profil.'); // arrête le chargement de l'app
}

export async function connect() {
  const clientId = import.meta.env.VITE_DISCORD_CLIENT_ID;
  if (!clientId) throw new Error('VITE_DISCORD_CLIENT_ID manquant.');
  const sdk = new DiscordSDK(clientId);
  await sdk.ready();
  const { code } = await sdk.commands.authorize({
    client_id: clientId,
    response_type: 'code',
    state: '',
    prompt: 'none',
    scope: ['identify'],
  });
  const r = await fetch('/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  if (!r.ok) throw new Error('Connexion refusée par le serveur.');
  const { access_token } = await r.json();
  await sdk.commands.authenticate({ access_token });
  return { sdk, token: access_token, channelId: sdk.channelId, guildId: sdk.guildId };
}

/**
 * Adresse utilisable pour une image. Dans Discord, les images d'autres sites
 * sont bloquées : celles d'ImgBB passent par le chemin /ibb (URL Mapping
 * « /ibb → i.ibb.co » du Developer Portal), que Discord va chercher directement.
 */
const IBB = /^https:\/\/i\.ibb\.co\//;
export const mediaSrc = (u) => (inDiscord() && typeof u === 'string' && IBB.test(u) ? u.replace(IBB, '/ibb/') : u);

// Secours : si une image ne passe pas par /ibb (mapping absent, ImgBB lent…),
// on la redemande une fois par notre relais /api/img avant de la déclarer introuvable.
if (inDiscord()) {
  document.addEventListener(
    'error',
    (e) => {
      const img = e.target;
      if (!(img instanceof HTMLImageElement) || img.dataset.relay) return;
      const m = /\/ibb\/(.+)$/.exec(img.getAttribute('src') || '');
      if (!m) return;
      e.stopPropagation(); // pas encore « introuvable » : on réessaie d'abord par le relais
      img.dataset.relay = '1';
      img.src = `/api/img?u=${encodeURIComponent(`https://i.ibb.co/${m[1]}`)}`;
    },
    true,
  );
}