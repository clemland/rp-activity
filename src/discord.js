/**
 * Connexion à Discord quand le site tourne dans une Activity.
 * Hors Discord (navigateur classique), on passe en mode démo.
 */
import { DiscordSDK } from '@discord/embedded-app-sdk';

export const inDiscord = () => new URLSearchParams(location.search).has('frame_id');

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