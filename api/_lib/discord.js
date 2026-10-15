/** Appels à l'API Discord : identité du joueur, droits staff, nom des salons. */
import { env } from './env.js';
import { HttpError } from './http.js';
import { read } from './db.js';

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

/** Rôles du serveur principal, tels que Discord les donne. */
export async function guildRoles() {
  if (!env.guildId || !env.botToken) return [];
  return (await cached('roles', 5 * 60_000, () => bot(`/guilds/${env.guildId}/roles`))) || [];
}
/**
 * Permissions staff d'un membre. ['*'] (tout) pour les propriétaires du bot, le propriétaire et
 * les administrateurs du serveur principal et les rôles STAFF_ROLE_IDS ; sinon les permissions
 * cochées pour ses rôles dans l'écran Permissions. [] = pas staff.
 */
export async function staffPerms(uid) {
  if (env.owners.includes(uid)) return ['*'];
  if (!env.guildId || !env.botToken) return [];
  const [member, guild, roles, conf] = await Promise.all([
    cached(`member:${uid}`, 60_000, () => bot(`/guilds/${env.guildId}/members/${uid}`)),
    cached('guild', 30 * 60_000, () => bot(`/guilds/${env.guildId}`)),
    guildRoles(),
    cached('staffperms', 30_000, async () => (await read('meta', 'staff:perms'))?.data || {}),
  ]);
  if (!member) return [];
  if (guild?.owner_id === uid) return ['*'];
  if (member.roles.some((r) => env.staffRoles.includes(r))) return ['*'];
  const ADMIN = 0x8n;
  if (roles.some((r) => member.roles.includes(r.id) && (BigInt(r.permissions) & ADMIN) === ADMIN)) return ['*'];
  return [...new Set(member.roles.flatMap((r) => conf[r] || []))];
}
/** Fait partie du staff (au moins une permission) ? */
export async function isStaff(uid) {
  return (await staffPerms(uid)).length > 0;
}
/** Après un changement dans l'écran Permissions : on relit tout de suite. */
export const clearPermsCache = () => cache.delete('staffperms');

/** Salon Discord par son ID : { name, guildId } ou null s'il n'existe pas / n'est pas visible par le bot. */
export async function channelById(channelId) {
  if (!/^\d{15,22}$/.test(String(channelId || '')) || !env.botToken) return null;
  return cached(`chi:${channelId}`, 10 * 60_000, async () => {
    const c = await bot(`/channels/${channelId}`);
    return c?.id ? { name: c.name || '', guildId: c.guild_id || null, forum: c.type === 15, thread: c.type === 11 || c.type === 12 } : null;
  });
}

export async function channelName(channelId) {
  if (!channelId || !env.botToken) return '';
  return cached(`ch:${channelId}`, 30 * 60_000, async () => (await bot(`/channels/${channelId}`))?.name || '');
}
