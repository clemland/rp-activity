/**
 * POST /api/action { action }
 * Le salon utilisé (boutique, port) est la POSITION du joueur : le dernier
 * salon RP où il a écrit, pas celui où l'Activity est ouverte.
 * Une action du joueur sur SA fiche (stats, inventaire, fabrication, boutique...).
 * Toutes les règles sont appliquées ici, côté serveur.
 */
import { handler, need } from './_lib/http.js';
import { userFromRequest, channelName } from './_lib/discord.js';
import { loadPlayer, loadShop, loadCatalog, loadCrewAndShips, publicCrew, shipList } from './_lib/context.js';
import { read, readAll, write, retry, listPlayers } from './_lib/db.js';
import { ingest } from './_lib/media.js';
import { invitesFor, loadHarbor } from './_lib/context.js';
import { playerAction, crewAction, inviteAction, shipAction, normalizeCrew, normalizeShip, crewCan, slug, fullName, ITEMS } from '../shared/game.js';

export default handler(['POST'], async (req, body) => {
  const me = await userFromRequest(req);
  const action = body.action || {};
  let channelId = null; // position du joueur, connue une fois sa fiche chargée
  need(typeof action.type === 'string', 400, 'Action manquante.');

  // Images : on les envoie dans le stockage avant d'appliquer l'action.
  if (action.type === 'photo.set') {
    const ph = action.photo;
    if (typeof ph === 'string') action.photo = await ingest(ph, 'photos', me.uid);
    else if (ph?.url) action.photo = { ...ph, url: await ingest(ph.url, 'photos', me.uid) };
  }
  if (action.type === 'tech.save' && action.media !== undefined) action.media = await ingest(action.media, 'techniques', me.uid);
  if (action.type === 'ship.edit' && action.photo) action.photo = await ingest(action.photo, 'bateaux', me.uid);
  if (action.type === 'crew.edit' && action.flag) action.flag = await ingest(action.flag, 'pavillons', me.uid);

  // Équipage et bateaux : chargés seulement pour les actions qui en ont besoin.
  const [, first] = await Promise.all([loadCatalog(), loadPlayer(me.uid)]);
  let firstTry = true;
  return retry(async () => {
    const { player, version } = firstTry ? first : await loadPlayer(me.uid);
    firstTry = false;
    channelId = player.position?.channelId || null;
    const ctx = { channelId, now: Date.now() };
    const needsCrew = action.type.startsWith('crew.') || action.type.startsWith('ship.') || (action.type === 'shop.buy' && ITEMS[action.key]?.kind === 'bateau') || action.type === 'craft.collect';
    const cs = needsCrew ? await loadCrewAndShips(player) : null;
    const reply = (out, extra = {}) =>
      cs
        ? { ...out, ...extra, crew: publicCrew(extra.crew ?? cs.crew, cs.memberNames), ships: shipList({ ...cs.ships, ...(extra.ships || {}) }) }
        : { ...out, ...extra };

    // Recherche de joueurs à inviter (lecture seule)
    if (action.type === 'crew.search') {
      need(cs.crew && crewCan(cs.crew, me.uid, 'invite'), 403, 'Ton grade ne permet pas d’inviter.');
      const q = String(action.q || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
      const all = await listPlayers();
      const results = all
        .filter((x) => !cs.crew.members.includes(x.uid))
        .map((x) => ({ uid: x.uid, name: fullName({ id: x.ident }), crew: x.crewId }))
        .filter((x) => !q || x.name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().includes(q))
        .slice(0, 20);
      return { results };
    }

    // Réponse à une invitation (l'équipage qui invite n'est pas forcément le sien)
    if (action.type === 'crew.join' || action.type === 'crew.decline') {
      const row = await read('crews', action.crewId);
      need(row, 404, 'Cet équipage n’existe plus.');
      const out = inviteAction(player, action, { crew: { id: action.crewId, ...row.data } });
      if (out.previous) {
        // Il quitte son ancien équipage (sauf s'il en est le capitaine avec d'autres membres)
        const old = await read('crews', out.previous);
        if (old) {
          const o = normalizeCrew(old.data);
          need(!(o.captain === me.uid && o.members.length > 1), 400, `Tu es capitaine de ${o.name} : cède d’abord ta place.`);
          o.members = o.members.filter((u) => u !== me.uid);
          delete o.memberRanks[me.uid];
          if (o.captain === me.uid) o.captain = null;
          await write('crews', out.previous, normalizeCrew(o), old.version);
        }
      }
      const { id, ...crewData } = out.crew;
      await write('crews', action.crewId, crewData, row.version);
      await write('players', me.uid, out.player, version);
      const fresh = await loadCrewAndShips(out.player);
      return { ...out, crew: publicCrew(fresh.crew, fresh.memberNames), ships: shipList(fresh.ships), invites: await invitesFor(me.uid) };
    }

    // Équipage : banque, cale, bateau, grades, invitations, membres
    if (action.type.startsWith('crew.')) {
      need(cs.crew, 400, 'Tu n’as pas d’équipage.');
      if (action.type === 'crew.invite') {
        need(action.uid !== me.uid, 400, 'Tu fais déjà partie de l’équipage.');
        const target = await read('players', String(action.uid || ''));
        need(target, 404, 'Ce joueur n’a pas de fiche.');
        action.name = fullName(target.data);
        action.faction = target.data.id?.faction; // une flotte n'accepte que des Marines
      }
      const out = crewAction(player, action, { crew: cs.crew, ships: cs.ships, now: Date.now() });
      const { id, memberNames, ...crewData } = out.crew;
      await write('crews', id, crewData, cs.crewVersion);
      for (const [sid, ship] of Object.entries(out.ships || {})) await write('ships', sid, ship, cs.shipVersions[sid] ?? null);
      if (out.kicked) {
        await retry(async () => {
          const k = await read('players', out.kicked);
          if (k && k.data.crewId === id) await write('players', out.kicked, { ...k.data, crewId: null }, k.version);
        });
      }
      await write('players', me.uid, out.player, version);
      if (out.left) return { ...out, crew: null, ships: shipList(Object.fromEntries(Object.entries(cs.ships).filter(([, sh]) => sh.owner?.kind === 'player'))), invites: await invitesFor(me.uid) };
      const names = { ...cs.memberNames };
      return reply(out, { crew: { ...out.crew, memberNames: names }, ships: out.ships });
    }

    // Bateau : embarquer, débarquer, demandes, améliorations
    if (action.type.startsWith('ship.') && action.type !== 'ship.edit') {
      const row = await read('ships', String(action.shipId || ''));
      need(row, 404, 'Bateau introuvable.');
      const out = shipAction(player, row.data, action, { crew: cs.crew, channelId, now: Date.now() });
      await write('ships', action.shipId, out.ship, row.version);
      // On n'est à bord que d'un bateau à la fois : on descend des autres.
      const boarder = out.boarded ? me.uid : out.accepted;
      if (boarder) {
        for (const [sid, sh] of Object.entries(await readAll('ships'))) {
          if (sid === action.shipId || !(sh.passengers || []).includes(boarder)) continue;
          await retry(async () => {
            const r = await read('ships', sid);
            await write('ships', sid, { ...r.data, passengers: r.data.passengers.filter((u) => u !== boarder) }, r.version);
          });
        }
      }
      if (out.item) await write('players', me.uid, out.player, version); // amélioration consommée
      const nav = await loadHarbor(out.player, cs.crew, channelId);
      return { ...reply(out, { ships: { [action.shipId]: normalizeShip(out.ship) } }), nav };
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
      need(channelId, 400, 'Tu n’es nulle part : écris d’abord un message RP dans un salon RP.');
      const s = await loadShop(channelId);
      ctx.shop = s.shop;
      shopV = s.version;
    }
    if (action.type === 'craft.collect' && channelId) ctx.channelName = player.position?.name || (await channelName(channelId));
    const out = playerAction(player, action, ctx);
    if (out.shop) await write('shops', channelId, out.shop, shopV);
    const extra = {};
    // Bateaux fabriqués : ils apparaissent dans « Mes bateaux », à quai dans ce salon.
    for (const ship of out.newShips || []) {
      let id = slug(ship.name), n = 2;
      while (await read('ships', id)) id = `${slug(ship.name)}-${n++}`;
      await write('ships', id, ship, null);
      (extra.ships ??= {})[id] = ship;
    }
    if (out.newShip) {
      // Bateau acheté : il apparaît dans « Mes bateaux », pas dans l'inventaire.
      let id = slug(out.newShip.name), n = 2;
      while (await read('ships', id)) id = `${slug(out.newShip.name)}-${n++}`;
      await write('ships', id, out.newShip, null);
      extra.ships = { [id]: out.newShip };
      out.toast = `${out.newShip.type} acheté ! Donne-lui un nom dans Équipage > Bateaux.`;
    }
    await write('players', me.uid, out.player, version);
    return reply(out, extra);
  });
});
