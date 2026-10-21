/**
 * Salons RP des bateaux : création (comme /bateau salon), renommage, ajout aux salons RP.
 * Utilisé par le panneau admin (nouveau bateau) et au moment de proposer un départ.
 */
import { env } from './env.js';
import { read, write, retry } from './db.js';
import { botPost, botPatch } from './discord.js';

/** Crée le salon : un post dans le forum commun (petit bateau) ou un forum dans la catégorie (grand bateau). */
export async function createShipChannel(name, space, cfg) {
  const intro = `⚓ **${name}**\nC’est ici que l’équipage vit à bord : pendant un voyage, chaque message RP de 400 caractères ou plus fait avancer le bateau.`;
  if (space === 'forum' && cfg.categoryId) {
    const f = await botPost(`/guilds/${env.guildId}/channels`, { name: name.slice(0, 100), type: 15, parent_id: cfg.categoryId });
    await botPost(`/channels/${f.id}/threads`, { name: 'Le pont', message: { content: intro } }).catch(() => null);
    return { id: f.id, kind: 'forum', name: f.name };
  }
  if (space === 'post' && cfg.forumId) {
    const t = await botPost(`/channels/${cfg.forumId}/threads`, { name: name.slice(0, 100), message: { content: intro } });
    return { id: t.id, kind: 'post', name: t.name };
  }
  return null;
}

/** Ajoute un salon à la liste des salons RP (un forum : chacun de ses posts compte). */
export async function addRpChannel(id, name, kind, by) {
  await retry(async () => {
    const row = await read('meta', 'rp:channels');
    const list = (row?.data.list || []).filter((c) => c.id !== id);
    list.push({ id, name, kind, by, at: Date.now() });
    await write('meta', 'rp:channels', { list }, row?.version ?? null);
  });
}

/** Donne un salon à un bateau qui n'en a pas, selon son espace et /bateau config. Renvoie le salon, ou null. */
export async function ensureShipChannel(ship, by) {
  if (ship.channel) return ship.channel;
  if (ship.space === 'none') return null;
  const cfg = (await read('meta', 'ships:config'))?.data || {};
  if (!(ship.space === 'forum' ? cfg.categoryId : cfg.forumId)) return null;
  const ch = await createShipChannel(ship.name, ship.space, cfg);
  if (ch) await addRpChannel(ch.id, ch.name, ch.kind === 'forum' ? 'forum' : 'salon', by);
  return ch;
}

/** Le salon prend le nouveau nom du bateau (Discord limite à 2 renommages par 10 minutes). */
export async function renameShipChannel(ship) {
  if (!ship.channel?.id) return;
  await botPatch(`/channels/${ship.channel.id}`, { name: ship.name.slice(0, 100) });
}
