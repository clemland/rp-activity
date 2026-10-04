/**
 * POST /api/bot { op, ... } : appels du bot Discord (protégés par BOT_API_SECRET).
 *  - channels                                   : salons où la navigation est active
 *  - message { channelId, userId, name }        : un message RP en navigation
 *  - choose  { channelId, userId, entryId, choice } : un choix sur un événement
 * Toute la logique de jeu reste ici : le bot ne fait qu'afficher.
 */
import { handler, need } from './_lib/http.js';
import { env } from './_lib/env.js';
import { write, retry, activeNavChannels } from './_lib/db.js';
import { loadPlayer, loadNav } from './_lib/context.js';
import { navMessage, navChoose, eventView, fullName } from '../shared/game.js';

export default handler(['POST'], async (req, body) => {
  need(env.botSecret && req.headers['x-bot-secret'] === env.botSecret, 401, 'Secret du bot invalide.');

  switch (body.op) {
    case 'channels':
      return { channels: await activeNavChannels() };

    case 'message': {
      need(body.channelId && body.userId, 400, 'Message incomplet.');
      return retry(async () => {
        const { nav, version: navV } = await loadNav(body.channelId);
        if (!nav.active) return { active: false };
        const { player, version } = await loadPlayer(body.userId, body.name);
        const r = navMessage(player, nav, { now: Date.now() });
        if (!r.counted) return { active: true, counted: false };
        if (r.entry) await write('navs', body.channelId, r.nav, navV, { active: true });
        await write('players', body.userId, r.player, version);
        return {
          active: true, counted: true, ups: r.ups, level: r.player.level, name: fullName(r.player),
          event: r.entry ? eventView(r.entry, r.player) : null,
        };
      });
    }

    case 'choose': {
      need(body.channelId && body.userId && body.entryId, 400, 'Choix incomplet.');
      return retry(async () => {
        const { nav, version: navV } = await loadNav(body.channelId);
        const { player, version } = await loadPlayer(body.userId, body.name);
        const r = navChoose(player, nav, body.entryId, Number(body.choice));
        await write('navs', body.channelId, r.nav, navV, { active: !!r.nav.active });
        await write('players', body.userId, r.player, version);
        return { ups: r.ups, level: r.player.level, name: fullName(r.player), event: eventView(r.entry, r.player) };
      });
    }

    default:
      need(false, 400, 'Opération inconnue.');
  }
});
