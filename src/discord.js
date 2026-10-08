/**
 * Connexion à Discord quand le site tourne dans une Activity.
 * Hors Discord (navigateur classique), on passe en mode démo.
 */
import { DiscordSDK, patchUrlMappings } from '@discord/embedded-app-sdk';

export const inDiscord = () => new URLSearchParams(location.search).has('frame_id');

export async function connect() {
  const clientId = import.meta.env.VITE_DISCORD_CLIENT_ID;
  if (!clientId) throw new Error('VITE_DISCORD_CLIENT_ID manquant.');
  // Les images ImgBB passent par l'URL Mapping /ibb (Discord bloque les autres sites).
  patchUrlMappings([{ prefix: '/ibb', target: 'i.ibb.co' }], { patchFetch: false, patchWebSocket: false, patchXhr: false, patchSrcAttributes: true });
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

/** Adresse utilisable pour une image : dans Discord, i.ibb.co passe par /ibb. */
export const mediaSrc = (u) => (inDiscord() && typeof u === 'string' ? u.replace(/^https:\/\/i\.ibb\.co\//, '/ibb/') : u);
