/**
 * POST /api/bot { op, ... } : appels du bot Discord (protégés par BOT_API_SECRET).
 * Le bot vérifie lui-même que l'auteur d'une commande staff fait partie du staff.
 *  - register { userId, name, race, job, classe, by } : /register, crée la fiche d'un joueur
 *  - open { userId, mode, target? }                  : /panel admin ou /edit profil
 *  - delete { userId, by }                           : /delete profil
 *  - rp.channels / rp.channel.add / rp.channel.remove : salons RP
 *  - rp.message { userId, channelId, parentId, name, length } : un message dans un salon RP
 *  - ships.config / ships.config.set { forumId?, categoryId? } : /bateau config
 *  - ships.mine { userId }                           : bateaux dont il gère les salons (/bateau salon, /bateau post)
 *  - ship.channel.set { userId, shipId, channelId, kind, name } : enregistre le salon créé pour un bateau
 */
import { handler, need } from './_lib/http.js';
import { env } from './_lib/env.js';
import { read, readAll, write, remove, retry } from './_lib/db.js';
import { newPlayer, fullName, normalize, normalizeCrew, normalizeShip, rpMessage, canManageShipChannels, RP_DAILY } from '../shared/game.js';

const RP_KEY = 'rp:channels';
const SHIPS_KEY = 'ships:config';

async function rpChannels() {
  const row = await read('meta', RP_KEY);
  return { list: row?.data.list || [], version: row?.version ?? null };
}
/** Modifie la liste des salons RP (avec réessai en cas d'écriture simultanée). */
const rpSet = (fn) =>
  retry(async () => {
    const { list, version } = await rpChannels();
    const next = fn(list);
    await write('meta', RP_KEY, { list: next }, version);
    return next;
  });

/** Bateaux dont ce joueur peut gérer les salons : les siens, et ceux de son équipage s'il en a le droit. */
async function shipsOf(userId) {
  const row = await read('players', userId);
  need(row, 404, 'Tu n’as pas de fiche : demande à un MJ de t’enregistrer avec /register.');
  const player = normalize(row.data);
  let crew = null;
  if (player.crewId) {
    const c = await read('crews', player.crewId);
    if (c) crew = { id: player.crewId, ...normalizeCrew(c.data) };
  }
  return Object.entries(await readAll('ships'))
    .map(([id, s]) => ({ id, ...normalizeShip(s) }))
    .filter((s) => canManageShipChannels(player, s, crew))
    .map((s) => ({ ...s, ownerLabel: s.owner?.kind === 'crew' ? crew?.name : fullName(player) }));
}

export default handler(['POST'], async (req, body) => {
  need(env.botSecret && req.headers['x-bot-secret'] === env.botSecret, 401, 'Secret du bot invalide.');

  switch (body.op) {
    case 'register': {
      need(body.userId, 400, 'Joueur manquant.');
      const exists = await read('players', body.userId);
      need(!exists, 409, `Ce joueur a déjà une fiche (${fullName(exists?.data)}).`);
      const player = newPlayer(body.userId, body);
      await write('players', body.userId, player, null);
      if (body.by) console.log(`[staff] ${body.by} a enregistré ${body.userId}`);
      return { player };
    }

    case 'open': {
      const mode = body.mode === 'admin' ? 'admin' : 'edit';
      need(body.userId && (mode === 'admin' || body.target), 400, 'Demande incomplète.');
      if (mode === 'edit') need(await read('players', body.target), 404, 'Ce joueur n’a pas de fiche : enregistre-le d’abord avec /register.');
      return retry(async () => {
        const row = await read('meta', `open:${body.userId}`);
        await write('meta', `open:${body.userId}`, { mode, target: body.target || null, at: Date.now() }, row?.version ?? null);
        return { ok: true };
      });
    }

    case 'delete': {
      need(body.userId, 400, 'Joueur manquant.');
      const row = await read('players', body.userId);
      need(row, 404, 'Ce joueur n’a pas de fiche.');
      await remove('players', body.userId);
      if (body.by) console.log(`[staff] ${body.by} a supprimé la fiche de ${body.userId} (${fullName(row.data)})`);
      return { name: fullName(row.data) };
    }

    case 'rp.channels':
      return { channels: (await rpChannels()).list };

    case 'rp.channel.add':
    case 'rp.channel.remove': {
      need(body.channelId, 400, 'Salon manquant.');
      const id = String(body.channelId);
      const next = await rpSet((list) => {
        const rest = list.filter((c) => c.id !== id);
        return body.op === 'rp.channel.add'
          ? [...rest, { id, name: String(body.name || '').slice(0, 100), kind: body.kind === 'forum' ? 'forum' : 'salon', by: body.by || null, at: Date.now() }]
          : rest;
      });
      return { channels: next };
    }

    case 'rp.message': {
      need(body.userId && body.channelId, 400, 'Message incomplet.');
      const row = await read('players', body.userId);
      if (!row) return { noProfile: true }; // pas de fiche : rien à compter
      return retry(async () => {
        const fresh = await read('players', body.userId);
        const r = rpMessage(normalize(fresh.data), { channelId: body.channelId, parentId: body.parentId || null, name: body.name, length: Number(body.length) || 0 });
        if (r.player.position?.channelId !== fresh.data.position?.channelId || r.counted) await write('players', body.userId, r.player, fresh.version);
        return { counted: r.counted, xp: r.xp, count: r.count, max: RP_DAILY, limit: r.limit, ups: r.ups, level: r.player.level, name: fullName(r.player) };
      });
    }

    case 'ships.config':
      return { config: (await read('meta', SHIPS_KEY))?.data || {} };

    case 'ships.config.set':
      return retry(async () => {
        const row = await read('meta', SHIPS_KEY);
        const config = { ...(row?.data || {}) };
        if (body.forumId !== undefined) config.forumId = body.forumId || null;
        if (body.categoryId !== undefined) config.categoryId = body.categoryId || null;
        await write('meta', SHIPS_KEY, config, row?.version ?? null);
        return { config };
      });

    case 'ships.mine': {
      need(body.userId, 400, 'Joueur manquant.');
      const [ships, cfg] = await Promise.all([shipsOf(body.userId), read('meta', SHIPS_KEY)]);
      return { ships, config: cfg?.data || {} };
    }

    case 'ship.channel.set': {
      need(body.userId && body.shipId && body.channelId, 400, 'Demande incomplète.');
      const mine = await shipsOf(body.userId);
      need(mine.some((s) => s.id === body.shipId), 403, 'Tu ne gères pas les salons de ce bateau.');
      const kind = body.kind === 'forum' ? 'forum' : 'post';
      const ship = await retry(async () => {
        const r = await read('ships', body.shipId);
        need(r, 404, 'Bateau introuvable.');
        const s = normalizeShip(r.data);
        s.channel = { id: String(body.channelId), kind, name: String(body.name || s.name).slice(0, 100) };
        await write('ships', body.shipId, s, r.version);
        return s;
      });
      // Le salon du bateau devient un salon RP (un forum : chacun de ses posts compte)
      await rpSet((list) => [
        ...list.filter((c) => c.id !== ship.channel.id),
        { id: ship.channel.id, name: ship.channel.name, kind: kind === 'forum' ? 'forum' : 'salon', by: body.userId, at: Date.now() },
      ]);
      return { ship: { id: body.shipId, ...ship } };
    }

    default:
      need(false, 400, 'Opération inconnue.');
  }
});