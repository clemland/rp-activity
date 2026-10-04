/**
 * GET /api/state?channel=ID[&player=ID]
 * Tout ce qu'il faut pour afficher l'Activity : la fiche, la boutique et la
 * navigation du salon, et si l'utilisateur fait partie du staff.
 * Le staff peut demander la fiche d'un autre joueur (&player=ID).
 */
import { handler, need } from './_lib/http.js';
import { userFromRequest, isStaff } from './_lib/discord.js';
import { loadPlayer, loadShop, loadNav, channelInfo, publicPlayer } from './_lib/context.js';
import { read } from './_lib/db.js';
import { normalize } from '../shared/game.js';

export default handler(['GET'], async (req) => {
  const me = await userFromRequest(req);
  const staff = await isStaff(me.uid);
  const channel = req.query.channel || null;
  let player;
  if (req.query.player && req.query.player !== me.uid) {
    need(staff, 403, 'Réservé au staff.');
    const row = await read('players', req.query.player);
    need(row, 404, 'Fiche introuvable.');
    player = normalize(row.data);
  } else player = (await loadPlayer(me.uid, me.name)).player;
  const [{ shop }, { nav }, info] = await Promise.all([loadShop(channel), loadNav(channel), channelInfo(channel)]);
  return { me: { uid: me.uid, name: me.name, staff }, player: publicPlayer(player), shop, nav, ...info };
});
