/**
 * POST /api/bot { op, ... } : appels du bot Discord (protégés par BOT_API_SECRET).
 * Le bot vérifie lui-même que l'auteur de la commande fait partie du staff.
 *  - register { userId, name, race, job, classe, by } : /register, crée la fiche d'un joueur
 *  - open { userId, target }                         : /edit profil, l'app s'ouvrira sur la fiche de « target »
 */
import { handler, need } from './_lib/http.js';
import { env } from './_lib/env.js';
import { read, write, retry } from './_lib/db.js';
import { newPlayer, fullName } from '../shared/game.js';

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
      need(body.userId && body.target, 400, 'Demande incomplète.');
      need(await read('players', body.target), 404, 'Ce joueur n’a pas de fiche : enregistre-le d’abord avec /register.');
      return retry(async () => {
        const row = await read('meta', `open:${body.userId}`);
        await write('meta', `open:${body.userId}`, { target: body.target, at: Date.now() }, row?.version ?? null);
        return { ok: true };
      });
    }

    default:
      need(false, 400, 'Opération inconnue.');
  }
});
