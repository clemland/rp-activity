/**
 * POST /api/staff { op, ... } : outils réservés au staff.
 *  - players               : liste des fiches
 *  - act { target, action } : modifier la fiche d'un joueur (édition, objets, XP, techniques)
 *  - shop.save { channelId, shop } / shop.delete { channelId }
 */
import { handler, need } from './_lib/http.js';
import { userFromRequest, isStaff, channelName } from './_lib/discord.js';
import { read, write, remove, retry, listPlayers } from './_lib/db.js';
import { ingest } from './_lib/media.js';
import { normalize, normalizeShop, staffAction } from '../shared/game.js';
import { publicPlayer } from './_lib/context.js';

export default handler(['POST'], async (req, body) => {
  const me = await userFromRequest(req);
  need(await isStaff(me.uid), 403, 'Réservé au staff.');

  switch (body.op) {
    case 'players':
      return { players: await listPlayers() };

    case 'act': {
      need(typeof body.target === 'string', 400, 'Joueur manquant.');
      return retry(async () => {
        const row = await read('players', body.target);
        need(row, 404, 'Fiche introuvable.');
        const out = staffAction(normalize(row.data), body.action);
        await write('players', body.target, out.player, row.version);
        return { ...out, player: publicPlayer(out.player) };
      });
    }

    case 'shop.save': {
      need(body.channelId && body.shop, 400, 'Boutique manquante.');
      const shop = normalizeShop({ ...body.shop });
      need(shop.items.length, 400, 'La boutique doit vendre au moins un objet.');
      need(new Set(shop.items.map((x) => x[0])).size === shop.items.length, 400, 'Un même objet apparaît deux fois.');
      shop.name = String(shop.name || 'Comptoir').slice(0, 60);
      shop.seller = String(shop.seller || 'Le marchand').slice(0, 40);
      shop.face = String(shop.face || '').slice(0, 8);
      shop.channel = String(shop.channel || `#${await channelName(body.channelId)}`).slice(0, 60);
      shop.img = shop.img ? await ingest(shop.img, 'vendeurs', body.channelId) : null;
      return retry(async () => {
        const row = await read('shops', body.channelId);
        await write('shops', body.channelId, shop, row?.version ?? null);
        return { shop, toast: 'Boutique mise à jour' };
      });
    }

    case 'shop.delete':
      need(body.channelId, 400, 'Salon manquant.');
      await remove('shops', body.channelId);
      return { shop: null, toast: 'Boutique fermée' };

    default:
      need(false, 400, 'Opération inconnue.');
  }
});
