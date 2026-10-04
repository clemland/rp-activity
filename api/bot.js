/**
 * POST /api/bot { op, ... } : appels du bot Discord (protégés par BOT_API_SECRET).
 *  - channels                                   : salons où la navigation est active
 *  - message { channelId, userId, name }        : un message RP en navigation
 *  - choose  { channelId, userId, entryId, choice } : un choix sur un événement
 *  - open { userId, target, name, targetName }  : /edit profil, l'app s'ouvrira sur la fiche de « target »
 *  - player.get { userId, name }                : fiche d'un joueur (le bot vérifie lui-même que c'est le staff)
 *  - player.act { userId, action, by }          : modification par le staff (/edit profil)
 * Toute la logique de jeu reste ici : le bot ne fait qu'afficher.
 */
import { handler, need } from './_lib/http.js';
import { env } from './_lib/env.js';
import { write, retry, activeNavChannels } from './_lib/db.js';
import { loadPlayer, loadNav } from './_lib/context.js';
import { navMessage, navChoose, eventView, fullName, staffAction, XP_NEED } from '../shared/game.js';
import { publicPlayer } from './_lib/context.js';
import { resolveStaffAction, choiceLists } from './_lib/resolve.js';

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

    case 'open': {
      need(body.userId && body.target, 400, 'Demande incomplète.');
      await loadPlayer(body.target, body.targetName); // crée la fiche du joueur si besoin
      return retry(async () => {
        const { player, version } = await loadPlayer(body.userId, body.name);
        player.pendingOpen = { target: body.target, at: Date.now() };
        await write('players', body.userId, player, version);
        return { ok: true };
      });
    }

    case 'player.get': {
      need(body.userId, 400, 'Joueur manquant.');
      const { player } = await loadPlayer(body.userId, body.name);
      return { player: publicPlayer(player), xpNeed: XP_NEED(player.level), lists: choiceLists() };
    }

    case 'player.act': {
      need(body.userId && body.action, 400, 'Action incomplète.');
      const { action, ignored } = resolveStaffAction(body.action);
      return retry(async () => {
        const { player, version } = await loadPlayer(body.userId, body.name);
        const out = staffAction(player, action);
        await write('players', body.userId, out.player, version);
        if (body.by) console.log(`[staff] ${body.by} a modifié ${body.userId} : ${action.type}`);
        return { ...out, player: publicPlayer(out.player), xpNeed: XP_NEED(out.player.level), ignored };
      });
    }

    default:
      need(false, 400, 'Opération inconnue.');
  }
});
