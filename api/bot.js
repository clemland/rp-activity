/**
 * POST /api/bot { op, ... } : appels du bot Discord (protégés par BOT_API_SECRET).
 * Le bot vérifie lui-même que l'auteur de la commande fait partie du staff.
 *  - register { userId, name, race, job, classe, by } : /register, crée la fiche d'un joueur
 *  - open { userId, mode, target? }                  : /panel admin (mode « admin ») ou /edit profil (mode « edit », fiche « target »)
 *  - delete { userId, by }                           : /delete profil, supprime la fiche d'un joueur
 */
import { handler, need } from './_lib/http.js';
import { env } from './_lib/env.js';
import { read, write, remove, retry } from './_lib/db.js';
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

    default:
      need(false, 400, 'Opération inconnue.');
  }
});
