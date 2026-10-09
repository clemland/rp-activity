/**
 * GET /api/state?channel=ID[&player=ID]
 * Tout ce qu'il faut pour afficher l'Activity : la fiche (ou null si le joueur
 * n'est pas enregistré), la boutique du salon, le catalogue, et si
 * l'utilisateur fait partie du staff. Le staff peut demander la fiche d'un
 * autre joueur (&player=ID).
 */
import { handler, need } from './_lib/http.js';
import { userFromRequest, isStaff } from './_lib/discord.js';
import { findPlayer, loadShop, loadCatalog, loadCrewAndShips, publicCrew, shipList, invitesFor, loadHarbor } from './_lib/context.js';
import { read, remove, write } from './_lib/db.js';
import { paySalary } from '../shared/game.js';

export default handler(['GET'], async (req) => {
  const me = await userFromRequest(req);
  const staff = await isStaff(me.uid);
  const catalog = await loadCatalog({ fresh: true });

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
  // Solde de la Marine : versée à l'ouverture de sa propre fiche.
  let salary = null;
  if (found && target === me.uid) {
    const before = found.player.salaryAt;
    salary = paySalary(found.player);
    if (salary.amount || found.player.salaryAt !== before) {
      await write('players', me.uid, found.player, found.version).catch(() => {}); // une autre requête l'a fait : sans gravité
    }
  }
  // Boutique et port : ceux de la POSITION du joueur (dernier salon RP où il a écrit).
  const pos = found?.player.position || null;
  const channel = pos?.channelId || null;
  const { shop } = await loadShop(channel);
  const info = { channelId: channel, channelName: pos?.name || '', position: pos };
  const cs = found ? await loadCrewAndShips(found.player) : null;
  return {
    me: { uid: me.uid, name: me.name, staff }, player: found?.player ?? null, shop, catalog, open, openDenied, salary,
    crew: cs ? publicCrew(cs.crew, cs.memberNames) : null, ships: cs ? shipList(cs.ships) : [],
    invites: found ? await invitesFor(target) : [],
    nav: found ? await loadHarbor(found.player, cs.crew, channel) : null, ...info,
  };
});
