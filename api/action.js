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
import { ensureShipChannel, renameShipChannel } from './_lib/shipchan.js';
import { invitesFor, loadHarbor, loadMap } from './_lib/context.js';
import { normalize, careBlock, newWid, removeItem, RECIPES, playerAction, crewAction, inviteAction, shipAction, normalizeCrew, normalizeShip, crewCan, slug, fullName, ITEMS } from '../shared/game.js';

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
    const needsCrew = action.type.startsWith('crew.') || action.type.startsWith('ship.') || (action.type === 'shop.buy' && ITEMS[action.key]?.kind === 'bateau') || action.type.startsWith('craft.');
    const cs = needsCrew ? await loadCrewAndShips(player) : null;
    const reply = (out, extra = {}) =>
      cs
        ? { ...out, ...extra, crew: publicCrew(extra.crew ?? cs.crew, cs.memberNames), ships: shipList({ ...cs.ships, ...(extra.ships || {}) }) }
        : { ...out, ...extra };

    // Médecin : soins des blessures (le patient doit être au même endroit et accepter)
    if (action.type.startsWith('care.')) {
      const now = Date.now();
      if (action.type === 'care.patients') {
        need(player.job.id === 'medecin', 403, 'Réservé aux médecins.');
        need(player.position?.channelId, 400, 'Tu n’es nulle part : écris d’abord un message RP.');
        const all = await readAll('players');
        const patients = Object.entries(all)
          .filter(([, d]) => d.position?.channelId === player.position.channelId)
          .map(([uid, d]) => ({ uid, name: fullName(d), health: normalize(structuredClone(d)).health }));
        return { patients };
      }
      if (action.type === 'care.request') {
        need(String(action.uid) !== me.uid, 400, 'Pour toi-même, pas besoin de demande : soigne-toi directement.');
        const prow = await read('players', String(action.uid || ''));
        need(prow, 404, 'Patient introuvable.');
        const patient = normalize(prow.data);
        const h = patient.health.find((x) => x.id === action.healthId);
        const why = careBlock(player, patient, h, RECIPES[action.recipe]);
        need(!why, 400, why);
        const req = { id: newWid(), doctor: me.uid, doctorName: fullName(player), patient: patient.uid, patientName: fullName(patient), healthId: h.id, label: h.label, level: h.level, recipe: action.recipe, accepted: false, at: now };
        patient.careIn = [...patient.careIn.filter((x) => !(x.doctor === me.uid && x.healthId === h.id)), req].slice(-10);
        player.careOut = [...player.careOut.filter((x) => !(x.patient === patient.uid && x.healthId === h.id)), req].slice(-10);
        await write('players', patient.uid, patient, prow.version);
        await write('players', me.uid, player, version);
        return { player, toast: `Demande de soin envoyée à ${req.patientName} : il doit accepter sur sa fiche.` };
      }
      if (action.type === 'care.answer') {
        const req = player.careIn.find((x) => x.id === action.id);
        need(req, 404, 'Cette demande n’existe plus.');
        player.careIn = action.accept ? player.careIn.map((x) => (x.id === req.id ? { ...x, accepted: true } : x)) : player.careIn.filter((x) => x.id !== req.id);
        const drow = await read('players', req.doctor);
        if (drow) {
          const doctor = normalize(drow.data);
          doctor.careOut = action.accept ? doctor.careOut.map((x) => (x.id === req.id ? { ...x, accepted: true } : x)) : doctor.careOut.filter((x) => x.id !== req.id);
          await write('players', req.doctor, doctor, drow.version);
        }
        await write('players', me.uid, player, version);
        return { player, toast: action.accept ? `Tu acceptes les soins de ${req.doctorName}.` : 'Soin refusé.' };
      }
      if (action.type === 'care.do') {
        // Le médecin a joué le mini-jeu : le matériel est pris ; si c'est réussi, la blessure est soignée
        const self = action.self === true;
        let req, prow = null, patient;
        if (self) {
          patient = player;
          req = { healthId: action.healthId, recipe: action.recipe };
        } else {
          req = player.careOut.find((x) => x.id === action.id);
          need(req?.accepted, 400, 'Le patient n’a pas (encore) accepté.');
          prow = await read('players', req.patient);
          need(prow, 404, 'Patient introuvable.');
          patient = normalize(prow.data);
        }
        const r = RECIPES[req.recipe];
        const h = patient.health.find((x) => x.id === req.healthId);
        const why = careBlock(player, patient, h, r);
        need(!why, 400, why);
        for (const [k, q] of Object.entries(r.needs)) removeItem(player, k, q);
        let toast = `Soin raté : « ${h.label} » n’est pas soigné. Le matériel est perdu.`;
        if (action.success) {
          patient.health = patient.health.filter((x) => x.id !== h.id);
          toast = `Blessure soignée : « ${h.label} »${self ? '' : ` (${fullName(patient)})`} !`;
          if (!self) {
            player.careOut = player.careOut.filter((x) => x.id !== req.id);
            patient.careIn = patient.careIn.filter((x) => x.id !== req.id);
          }
        }
        if (prow) await write('players', patient.uid, patient, prow.version);
        await write('players', me.uid, player, version);
        return { player, toast };
      }
      need(false, 400, 'Action inconnue.');
    }

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

    // Atelier du charpentier : travail sur un bateau (à lui ou à son équipage), ou construction
    if (action.type === 'ship.work') {
      const r = RECIPES[action.id];
      const sid = r?.work?.type === 'construire' ? null : String(action.shipId || '');
      const ship = sid ? cs.ships[sid] : null;
      if (sid) need(ship, 404, 'Bateau introuvable : il doit être à toi ou à ton équipage.');
      const out = playerAction(player, action, { ...ctx, ship, shipId: sid, crew: cs.crew, channelName: player.position?.name || '' });
      const extra = { ships: {} };
      if (out.crew && cs.crew) {
        // matériaux pris dans la cale de l'équipage (atelier)
        const { id: cid, memberNames: _names, ...crewData } = out.crew;
        await write('crews', cid, normalizeCrew(crewData), cs.crewVersion);
        extra.crew = out.crew;
      }
      if (out.ship) {
        await write('ships', sid, out.ship, cs.shipVersions[sid]);
        extra.ships[sid] = out.ship;
      }
      for (const s of out.newShips || []) {
        let id = slug(s.name), n = 2;
        while (await read('ships', id)) id = `${slug(s.name)}-${n++}`;
        await write('ships', id, s, null);
        extra.ships[id] = s;
      }
      await write('players', me.uid, out.player, version);
      return reply(out, extra);
    }

    // Bateau : embarquer, débarquer, demandes, améliorations
    if (action.type.startsWith('ship.') && action.type !== 'ship.edit') {
      const row = await read('ships', String(action.shipId || ''));
      need(row, 404, 'Bateau introuvable.');
      // Départ : un bateau sans salon RP en reçoit un automatiquement (post ou forum, selon son modèle)
      if ((action.type === 'ship.voyage.propose' || action.type === 'ship.voyage.logpose') && !row.data.channel) {
        const ch = await ensureShipChannel(normalizeShip(structuredClone(row.data)), me.uid).catch(() => null);
        if (ch) row.data.channel = ch;
      }
      // Port dans un post de forum (anciens bateaux) : on retrouve le forum grâce à la position du joueur, au même endroit
      if (row.data.position && !row.data.position.parentId && player.position?.channelId === row.data.position.channelId) row.data.position.parentId = player.position.parentId || null;
      const out = shipAction(player, row.data, action, { crew: cs.crew, channelId, now: Date.now(), map: action.type.startsWith('ship.voyage') ? (await loadMap()).map : null });
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
      if (out.ship.channel && out.ship.name !== ship.name) await renameShipChannel(out.ship).catch(() => {}); // le salon suit le nom du bateau
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
    // Travail d'atelier terminé : il faut le bateau concerné (à lui ou à son équipage)
    if (action.type === 'craft.collect' && player.craft?.work?.shipId) ctx.ship = cs.ships[player.craft.work.shipId] || null;
    if (cs) ctx.crew = cs.crew; // les fabrications peuvent puiser dans la cale de l'équipage
    const out = playerAction(player, action, ctx);
    if (out.shop) await write('shops', channelId, out.shop, shopV);
    if (out.crew && cs?.crew) {
      const { id: cid, memberNames: _names, ...crewData } = out.crew;
      await write('crews', cid, normalizeCrew(crewData), cs.crewVersion);
    }
    const extra = {};
    if (out.crew) extra.crew = out.crew;
    if (out.ship && out.shipId) {
      await write('ships', out.shipId, out.ship, cs.shipVersions[out.shipId]);
      extra.ships = { [out.shipId]: out.ship };
    }
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
