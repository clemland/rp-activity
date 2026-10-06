/**
 * POST /api/action { channelId, action }
 * Une action du joueur sur SA fiche (stats, inventaire, fabrication, boutique...).
 * Toutes les règles sont appliquées ici, côté serveur.
 */
import { handler, need } from './_lib/http.js';
import { userFromRequest } from './_lib/discord.js';
import { loadPlayer, loadShop, loadCatalog, loadCrewAndShips, publicCrew, shipList } from './_lib/context.js';
import { read, write, retry } from './_lib/db.js';
import { ingest } from './_lib/media.js';
import { playerAction, crewAction, slug } from '../shared/game.js';

export default handler(['POST'], async (req, body) => {
  const me = await userFromRequest(req);
  const action = body.action || {};
  const channelId = body.channelId || null;
  need(typeof action.type === 'string', 400, 'Action manquante.');

  // Images : on les envoie dans le stockage avant d'appliquer l'action.
  if (action.type === 'photo.set') {
    const ph = action.photo;
    if (typeof ph === 'string') action.photo = await ingest(ph, 'photos', me.uid);
    else if (ph?.url) action.photo = { ...ph, url: await ingest(ph.url, 'photos', me.uid) };
  }
  if (action.type === 'tech.save' && action.media !== undefined) action.media = await ingest(action.media, 'techniques', me.uid);
  if (action.type === 'ship.edit' && action.photo) action.photo = await ingest(action.photo, 'bateaux', me.uid);

  await loadCatalog();
  return retry(async () => {
    const { player, version } = await loadPlayer(me.uid);
    const ctx = { channelId, now: Date.now() };
    const cs = await loadCrewAndShips(player);
    const reply = (out, extra = {}) => ({
      ...out, ...extra,
      crew: publicCrew(extra.crew ?? cs.crew, cs.memberNames),
      ships: shipList({ ...cs.ships, ...(extra.ships || {}) }),
    });

    // Équipage : banque, coffre, bateau attitré
    if (action.type.startsWith('crew.')) {
      need(cs.crew, 400, 'Tu n’as pas d’équipage.');
      const out = crewAction(player, action, { crew: cs.crew, ships: cs.ships });
      const { id, ...crewData } = out.crew;
      await write('crews', id, crewData, cs.crewVersion);
      for (const [sid, ship] of Object.entries(out.ships || {})) await write('ships', sid, ship, cs.shipVersions[sid] ?? null);
      await write('players', me.uid, out.player, version);
      return reply(out, { crew: out.crew, ships: out.ships });
    }

    // Bateau : nom, description, photo
    if (action.type === 'ship.edit') {
      const ship = cs.ships[action.shipId];
      need(ship, 404, 'Bateau introuvable.');
      const out = playerAction(player, action, { ...ctx, ship, crew: cs.crew });
      await write('ships', action.shipId, out.ship, cs.shipVersions[action.shipId]);
      return reply(out, { ships: { [action.shipId]: out.ship } });
    }

    let shopV = null;
    if (action.type.startsWith('shop.')) {
      need(channelId, 400, 'Salon inconnu.');
      const s = await loadShop(channelId);
      ctx.shop = s.shop;
      shopV = s.version;
    }
    const out = playerAction(player, action, ctx);
    if (out.shop) await write('shops', channelId, out.shop, shopV);
    const extra = {};
    if (out.newShip) {
      // Bateau acheté : il apparaît dans « Mes bateaux », pas dans l'inventaire.
      let id = slug(out.newShip.name), n = 2;
      while (await read('ships', id)) id = `${slug(out.newShip.name)}-${n++}`;
      await write('ships', id, out.newShip, null);
      extra.ships = { [id]: out.newShip };
      out.toast = `${out.newShip.name} est à toi ! Donne-lui un nom dans « Équipage ».`;
    }
    await write('players', me.uid, out.player, version);
    return reply(out, extra);
  });
});
