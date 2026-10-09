/**
 * POST /api/bot { op, ... } : appels du bot Discord (protégés par BOT_API_SECRET).
 * Le bot vérifie lui-même que l'auteur de la commande fait partie du staff.
 *  - register { userId, name, race, job, classe, by } : /register, crée la fiche d'un joueur
 *  - open { userId, mode, target? }                  : /panel admin (mode « admin ») ou /edit profil (mode « edit », fiche « target »)
 *  - delete { userId, by }                           : /delete profil, supprime la fiche d'un joueur
 *  - rp.channels                                     : salons RP (et forums) déclarés
 *  - rp.channel.add { channelId, name, kind, by } / rp.channel.remove { channelId } : /rp ajouter, /rp retirer
 *  - rp.message { userId, channelId, parentId, name, length } : un message dans un salon RP (XP, position)
 */
import { handler, need } from './_lib/http.js';
import { env } from './_lib/env.js';
import { read, write, remove, retry } from './_lib/db.js';
import { newPlayer, fullName, normalize, rpMessage, RP_DAILY } from '../shared/game.js';

const RP_KEY = 'rp:channels';
async function rpChannels() {
  const row = await read('meta', RP_KEY);
  return { list: row?.data.list || [], version: row?.version ?? null };
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
      return retry(async () => {
        const { list, version } = await rpChannels();
        const rest = list.filter((c) => c.id !== body.channelId);
        const next = body.op === 'rp.channel.add'
          ? [...rest, { id: String(body.channelId), name: String(body.name || '').slice(0, 100), kind: body.kind === 'forum' ? 'forum' : 'salon', by: body.by || null, at: Date.now() }]
          : rest;
        await write('meta', RP_KEY, { list: next }, version);
        return { channels: next, changed: next.length !== list.length || body.op === 'rp.channel.add' };
      });
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

    default:
      need(false, 400, 'Opération inconnue.');
  }
});
