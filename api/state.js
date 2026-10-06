/**
 * GET /api/state?channel=ID[&player=ID]
 * Tout ce qu'il faut pour afficher l'Activity : la fiche (ou null si le joueur
 * n'est pas enregistré), la boutique du salon, le catalogue, et si
 * l'utilisateur fait partie du staff. Le staff peut demander la fiche d'un
 * autre joueur (&player=ID).
 */
import { handler, need } from './_lib/http.js';
import { userFromRequest, isStaff } from './_lib/discord.js';
import { findPlayer, loadShop, loadCatalog, channelInfo, loadCrewAndShips, publicCrew, shipList } from './_lib/context.js';
import { read, remove } from './_lib/db.js';

export default handler(['GET'], async (req) => {
  const me = await userFromRequest(req);
  const staff = await isStaff(me.uid);
  const channel = req.query.channel || null;
  const [catalog, { shop }, info] = await Promise.all([loadCatalog(), loadShop(channel), channelInfo(channel)]);

  let target = me.uid, open = null, openDenied = false;
  if (req.query.player && req.query.player !== me.uid) {
    need(staff, 403, 'Réservé au staff.');
    target = req.query.player;
  } else {
    // /panel admin ou /edit profil : le bot a demandé d'ouvrir le panneau admin (valable 2 minutes, une seule fois)
    const pending = await read('meta', `open:${me.uid}`);
    if (pending) {
      await remove('meta', `open:${me.uid}`);
      if (Date.now() - pending.data.at < 120_000) {
        if (staff) open = { mode: pending.data.mode || 'edit', target: pending.data.target || null };
        else openDenied = true; // le bot l'a accepté mais le site ne reconnaît pas ce membre comme staff
      }
    }
  }
  const found = await findPlayer(target);
  need(found || target === me.uid, 404, 'Ce joueur n’a pas de fiche.');
  const cs = found ? await loadCrewAndShips(found.player) : null;
  return {
    me: { uid: me.uid, name: me.name, staff }, player: found?.player ?? null, shop, catalog, open, openDenied,
    crew: cs ? publicCrew(cs.crew, cs.memberNames) : null, ships: cs ? shipList(cs.ships) : [], ...info,
  };
});
