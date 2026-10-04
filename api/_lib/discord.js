/** Appels à l'API Discord : identité du joueur, droits staff, nom des salons. */
import { env } from './env.js';
import { HttpError } from './http.js';

const API = 'https://discord.com/api/v10';
const cache = new Map(); // vit tant que l'instance Vercel reste chaude
const cached = async (key, ttl, fn) => {
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.value;
  const value = await fn();
  cache.set(key, { value, exp: Date.now() + ttl });
  return value;
};
const bot = (path) =>
  fetch(API + path, { headers: { Authorization: `Bot ${env.botToken}` } }).then((r) => (r.ok ? r.json() : null));

/** Échange le code OAuth2 de l'Activity contre un jeton. */
export async function exchangeCode(code) {
  const r = await fetch(`${API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.clientId, client_secret: env.clientSecret, grant_type: 'authorization_code', code }),
  });
  if (!r.ok) throw new HttpError(401, 'Connexion Discord refusée.');
  return (await r.json()).access_token;
}

/** Utilisateur Discord derrière le jeton envoyé par l'Activity. */
export async function userFromRequest(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) throw new HttpError(401, 'Non connecté.');
  return cached(`u:${token}`, 10 * 60_000, async () => {
    const r = await fetch(`${API}/users/@me`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new HttpError(401, 'Session Discord expirée. Relance l’Activity.');
    const u = await r.json();
    return { uid: u.id, name: u.global_name || u.username };
  });
}

/** Propriétaire du bot, propriétaire/admin du serveur principal ou rôle staff. */
export async function isStaff(uid) {
  if (env.owners.includes(uid)) return true;
  if (!env.guildId || !env.botToken) return false;
  return cached(`staff:${uid}`, 5 * 60_000, async () => {
    const [member, guild, roles] = await Promise.all([
      bot(`/guilds/${env.guildId}/members/${uid}`),
      cached('guild', 30 * 60_000, () => bot(`/guilds/${env.guildId}`)),
      cached('roles', 5 * 60_000, () => bot(`/guilds/${env.guildId}/roles`)),
    ]);
    if (!member) return false;
    if (guild?.owner_id === uid) return true;
    if (member.roles.some((r) => env.staffRoles.includes(r))) return true;
    const ADMIN = 0x8n;
    return (roles || []).some((r) => member.roles.includes(r.id) && (BigInt(r.permissions) & ADMIN) === ADMIN);
  });
}

export async function channelName(channelId) {
  if (!channelId || !env.botToken) return '';
  return cached(`ch:${channelId}`, 30 * 60_000, async () => (await bot(`/channels/${channelId}`))?.name || '');
}
