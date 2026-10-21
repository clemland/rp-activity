/**
 * Salons RP des bateaux : création (comme /bateau salon), renommage, ajout aux salons RP,
 * et fiche du bateau envoyée en premier message.
 */
import { env } from './env.js';
import { read, write, retry } from './db.js';
import { botPost, botPatch } from './discord.js';
import { loadCatalog } from './context.js';
import { shipStats, fullName, WOODS } from '../../shared/game.js';

/** Adresse publique d'une image (Discord a besoin d'une adresse complète). */
function absUrl(u) {
  if (!u) return null;
  if (/^https?:\/\//.test(u)) return u;
  if (u.startsWith('/')) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL || 'mon-rp.vercel.app'}${u}`;
  return null;
}

/** Nom du propriétaire : le personnage du joueur, ou l'équipage. */
async function ownerLabel(ship) {
  const o = ship.owner;
  if (!o) return 'Personne';
  if (o.kind === 'player') {
    const r = await read('players', o.id);
    return r ? `${fullName(r.data)} (<@${o.id}>)` : `<@${o.id}>`;
  }
  if (o.kind === 'crew') return (await read('crews', o.id))?.data?.name || 'Équipage';
  return '?';
}

/** Fiche du bateau (embed Discord) : image, nom, propriétaire, statistiques. */
export async function shipEmbed(ship) {
  await loadCatalog(); // réglages des bateaux à jour pour les statistiques
  const st = shipStats(ship);
  const img = absUrl(ship.photo || ship.icon);
  return {
    color: 0x1f58b3,
    title: `⚓ ${ship.name}`.slice(0, 256),
    description: `${ship.type || 'Bateau'}${ship.desc ? `\n\n${ship.desc}` : ''}`.slice(0, 1500),
    fields: [
      { name: 'Propriétaire', value: (await ownerLabel(ship)).slice(0, 1024), inline: true },
      { name: 'Places', value: String(ship.berths ?? '?'), inline: true },
      { name: 'Bois', value: WOODS[ship.wood]?.name || 'Bois standard', inline: true },
      { name: 'Vitesse', value: String(st.speed), inline: true },
      { name: 'Robustesse', value: String(st.robust), inline: true },
      { name: 'Puissance', value: String(st.power), inline: true },
    ],
    ...(img ? { image: { url: img } } : {}),
    footer: { text: 'Pendant un voyage, chaque message RP de 400 caractères ou plus écrit ici fait avancer le bateau.' },
  };
}

/** Crée le salon : un post dans le forum commun (petit bateau) ou un forum dans la catégorie (grand bateau). */
export async function createShipChannel(ship, cfg) {
  const message = { embeds: [await shipEmbed(ship)], allowed_mentions: { parse: [] } };
  if (ship.space === 'forum' && cfg.categoryId) {
    const f = await botPost(`/guilds/${env.guildId}/channels`, { name: ship.name.slice(0, 100), type: 15, parent_id: cfg.categoryId });
    await botPost(`/channels/${f.id}/threads`, { name: 'Le pont', message }).catch(() => null);
    return { id: f.id, kind: 'forum', name: f.name };
  }
  if (ship.space === 'post' && cfg.forumId) {
    const t = await botPost(`/channels/${cfg.forumId}/threads`, { name: ship.name.slice(0, 100), message });
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
  const ch = await createShipChannel(ship, cfg);
  if (ch) await addRpChannel(ch.id, ch.name, ch.kind === 'forum' ? 'forum' : 'salon', by);
  return ch;
}

/** Le salon prend le nouveau nom du bateau (Discord limite à 2 renommages par 10 minutes). */
export async function renameShipChannel(ship) {
  if (!ship.channel?.id) return;
  await botPatch(`/channels/${ship.channel.id}`, { name: ship.name.slice(0, 100) });
}
