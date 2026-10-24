/**
 * POST /api/staff { op, ... } : outils réservés au staff.
 *  - players                              : liste des fiches
 *  - act { target, action }                : modifier la fiche d'un joueur
 *  - bulk { targets, action }              : la même action sur plusieurs joueurs (XP, niveaux, berrys, objets)
 *  - shops                                    : toutes les boutiques
 *  - shop.save { channelId, from?, shop }      : enregistre la boutique du salon channelId (déplacée depuis « from » si l'ID a changé)
 *  - shop.delete { channelId }
 *  - crews / crew.save { id?, crew } / crew.delete { id }  : équipages (membres, capitaine, banque, coffre, bateau)
 *  - ships / ship.save { id?, ship } / ship.delete { id }  : bateaux (créés par le staff ou achetés)
 *  - ship.upgrade { id, type, amount }                     : améliorer un bateau (cale, canons, voile)
 *  - map.get / map.bg { bg, ratio } / map.island.save { id?, island } / map.island.move { id, x, y }
 *    map.island.delete { id } / map.route { a, b, value|null } : carte du monde
 *  - item.save { id?, item } / item.delete { id }        : base d'objets
 *  - recipe.save { id?, recipe } / recipe.delete { id }  : recettes de fabrication
 */
import { handler, need } from './_lib/http.js';
import { userFromRequest, staffPerms, guildRoles, clearPermsCache, botPost, channelById } from './_lib/discord.js';
import { env } from './_lib/env.js';
import { createShipChannel, addRpChannel, renameShipChannel } from './_lib/shipchan.js';
import { read, readAll, write, remove, retry, listPlayers } from './_lib/db.js';
import { ingest } from './_lib/media.js';
import { loadCatalog, loadMap } from './_lib/context.js';
import {
  normalizeShipCfg, ICONS_OWNER, normalizeIsland, normalizeMap, routeKey, upgradeShip, recipeLabel, normalize, normalizeShop, normalizeItem, normalizeRecipe,
  normalizeCrew, normalizeShip, newShip, staffAction, slug, ITEMS, isNpc, fullName, normalizeLoot, STAFF_PERMS, staffCan,
} from '../shared/game.js';


/** Identifiant libre à partir du nom (« planche-de-chene », « planche-de-chene-2 »…). */
function freeId(base, taken) {
  let id = slug(base), n = 2;
  while (taken[id]) id = `${slug(base)}-${n++}`;
  return id;
}

export default handler(['POST'], async (req, body) => {
  const me = await userFromRequest(req);
  const perms = await staffPerms(me.uid);
  need(perms.length, 403, 'Réservé au staff.');
  // Permission nécessaire selon l'opération (les listes en lecture seule sont ouvertes à tout le staff)
  const op = String(body.op || '');
  const gradeOnly = body.action?.type === 'edit' && Object.keys(body.action.patch || {}).join() === 'id' && Object.keys(body.action.patch.id || {}).join() === 'grade';
  const required =
    ['players', 'shops', 'crews', 'ships', 'map.get'].includes(op) ? null
    : op === 'act' ? (body.action?.type === 'tech.validate' ? ['techniques', 'joueurs'] : body.action?.type === 'invention.validate' ? ['inventions', 'joueurs'] : gradeOnly ? ['joueurs', 'marine'] : ['joueurs'])
    : op === 'bulk' ? ['joueurs']
    : op === 'techniques' ? ['techniques']
    : op === 'inventions' ? ['inventions']
    : op === 'cooks' || op === 'cook.validate' ? ['cuisine']
    : op === 'crew.save' ? [body.crew?.kind === 'flotte' ? 'marine' : 'equipages']
    : op.startsWith('crew.') ? ['equipages', 'marine']
    : op.startsWith('ship.') ? ['equipages']
    : op.startsWith('map.') ? ['carte']
    : op.startsWith('shop.') ? ['boutiques']
    : op.startsWith('item.') || op.startsWith('recipe.') || op.startsWith('injury.') ? ['gestion']
    : op.startsWith('loot.') ? ['butins']
    : op.startsWith('icons.') ? ['icones']
    : op.startsWith('perms.') ? ['permissions']
    : null;
  need(!op.startsWith('icons.') || me.uid === ICONS_OWNER, 403, 'Seul le propriétaire du RP peut changer les icônes.');
  need(!required || required.some((p) => staffCan(perms, p)), 403, `Ton rôle ne permet pas ça (permission « ${STAFF_PERMS[required?.[0]] ?? '?'} »).`);
  const catalog = await loadCatalog({ fresh: true });

  switch (body.op) {
    case 'players':
      return { players: await listPlayers() };

    case 'act': {
      need(typeof body.target === 'string', 400, 'Joueur manquant.');
      return retry(async () => {
        const row = await read('players', body.target);
        need(row, 404, 'Ce joueur n’a pas de fiche.');
        const out = staffAction(normalize(row.data), body.action);
        await write('players', body.target, out.player, row.version);
        return out;
      });
    }

    case 'bulk': {
      const targets = [...new Set(Array.isArray(body.targets) ? body.targets : [])].filter((t) => typeof t === 'string');
      need(targets.length, 400, 'Aucun joueur sélectionné.');
      need(targets.length <= 500, 400, '500 joueurs maximum à la fois.');
      need(['xp', 'levels', 'berry', 'give', 'take', 'health.add'].includes(body.action?.type), 400, 'Action non disponible en groupe.');
      let ok = 0;
      const failed = [];
      // Une fiche à la fois : si l'une échoue (inventaire plein...), les autres passent quand même.
      for (const uid of targets) {
        try {
          await retry(async () => {
            const row = await read('players', uid);
            need(row, 404, 'pas de fiche');
            const out = staffAction(normalize(row.data), body.action);
            await write('players', uid, out.player, row.version);
          });
          ok++;
        } catch (err) {
          failed.push({ uid, error: err.message });
        }
      }
      console.log(`[staff] ${me.uid} : ${body.action.type} sur ${ok} joueur(s)`);
      return { ok, failed, toast: `Appliqué à ${ok} joueur${ok > 1 ? 's' : ''}${failed.length ? `, ${failed.length} échec${failed.length > 1 ? 's' : ''}` : ''}` };
    }
    case 'injury.save':
    case 'injury.delete':
      // Catégories de blessures (fracture, brûlure…) : chaque soin du médecin peut en viser une
      return retry(async () => {
        const row = await read('meta', 'injuries');
        const categories = { ...(row?.data?.categories || {}) };
        let toast;
        if (body.op === 'injury.save') {
          const name = String(body.name || '').trim().slice(0, 40);
          need(name, 400, 'Donne un nom à la catégorie.');
          const id = body.id && categories[body.id] ? body.id : freeId(name, categories);
          categories[id] = { name };
          toast = `Catégorie enregistrée : ${name}`;
        } else {
          need(categories[body.id], 404, 'Catégorie introuvable.');
          toast = `Catégorie supprimée : ${categories[body.id].name}`;
          delete categories[body.id];
        }
        await write('meta', 'injuries', { categories }, row?.version ?? null);
        catalog.injuries = categories;
        return { catalog, toast };
      });

    case 'perms.get': {
      const roles = (await guildRoles())
        .filter((r) => r.id !== env.guildId && !r.managed) // pas @everyone ni les rôles des bots
        .sort((a, b) => b.position - a.position)
        .map((r) => ({ id: r.id, name: r.name, color: r.color, admin: (BigInt(r.permissions) & 0x8n) === 0x8n, staff: env.staffRoles.includes(r.id) }));
      return { roles, perms: (await read('meta', 'staff:perms'))?.data || {} };
    }

    case 'perms.set': {
      const roleId = String(body.roleId || '');
      need(/^\d{5,25}$/.test(roleId), 400, 'Rôle invalide.');
      const list = (Array.isArray(body.perms) ? body.perms : []).filter((p) => STAFF_PERMS[p]);
      const data = await retry(async () => {
        const row = await read('meta', 'staff:perms');
        const next = { ...(row?.data || {}) };
        if (list.length) next[roleId] = list;
        else delete next[roleId];
        await write('meta', 'staff:perms', next, row?.version ?? null);
        return next;
      });
      clearPermsCache();
      return { perms: data, toast: 'Permissions enregistrées' };
    }

    case 'loot.preset': {
      // Répartition des butins du 24/10/2026 : 9 tables par type de lieu, butins seulement dans les lieux qu'on explore
      const e = (key, chance, min = 1, max = min) => ({ key, chance, min, max });
      const tables = {
        ville: { name: '🏙️ Ville', entries: [e('agrumes', 5, 1, 3), e('rhum', 4), e('sucre', 4, 1, 2), e('tissu', 3), e('cuir', 3), e('clous', 3, 1, 3), e('oeufs', 3, 1, 4), e('cola', 3), e('pieces-oxydees', 3, 1, 2), e('piece-d-or-ancienne', 1), e('lanterne', 1)] },
        campagne: { name: '🌾 Campagne', entries: [e('legumes-varies', 8, 1, 2), e('pommes-de-terre', 6, 1, 3), e('riz', 5, 1, 2), e('farine', 5, 1, 2), e('oeufs', 5, 1, 4), e('produit-laitier', 4), e('tomates', 4, 1, 2), e('chanvre', 4, 1, 3), e('viande-crue', 3)] },
        foret: { name: '🌲 Forêt', entries: [e('bout-de-bois', 8, 1, 3), e('champignons', 8, 1, 2), e('herbes-medicinales', 7, 1, 2), e('chanvre', 6, 1, 3), e('bois-robuste', 3), e('viande-crue', 3), e('relique-abimee', 1), e('bois-de-deul', 1)] },
        port: { name: '⚓ Port', entries: [e('poisson-cru', 10, 1, 2), e('crustaces', 6, 1, 2), e('sel-marin', 6, 1, 3), e('corde', 5), e('chanvre', 4, 1, 3), e('bout-de-bois', 4, 1, 2), e('tissu', 2), e('pieces-oxydees', 2, 1, 3), e('rhum', 2), e('perle', 1)] },
        'eau-douce': { name: '💧 Eau douce', entries: [e('poisson-cru', 10, 1, 2), e('crustaces', 4), e('herbes-medicinales', 3, 1, 2), e('pieces-oxydees', 2, 1, 2), e('perle', 1)] },
        montagne: { name: '⛰️ Montagne', entries: [e('bout-de-bois', 5, 1, 2), e('herbes-medicinales', 5, 1, 2), e('bois-robuste', 4), e('fer', 4), e('champignons', 3), e('viande-crue', 3), e('relique-abimee', 1)] },
        ruines: { name: '🏚️ Ruines', entries: [e('pieces-oxydees', 8, 1, 3), e('relique-abimee', 4), e('piece-d-or-ancienne', 3, 1, 2), e('herbes-medicinales', 3), e('fer', 2), e('lanterne', 1), e('perle', 1), e('lingot-d-or', 1)] },
        'bas-fonds': { name: '🐀 Bas-fonds', entries: [e('pieces-oxydees', 5, 1, 3), e('clous', 4, 1, 3), e('fer', 3), e('corde', 3), e('rhum', 3), e('lance-pierre', 2), e('poudre-a-canon', 2), e('piece-d-or-ancienne', 2), e('cuir', 2), e('bombe', 1)] },
        mer: { name: '🌊 Pleine mer', entries: [e('poisson-cru', 8, 1, 3), e('crustaces', 4, 1, 2), e('corde', 2), e('bout-de-bois', 2), e('pieces-oxydees', 2, 1, 2), e('perle', 1)] },
      };
      const A = {
        ville: ['1555279229904748706', '1555279491473870879', '1555280366477115534', '1555281500973309962', '1555024138559557654', '1555024756510826586', '1555024561777545368', '1556314800844447774', '1562494833912975513', '1562497747976855595', '1562497093434740827', '1555011540132954153', '1555012130246361168', '1555012326321688632', '1555015275777101965'],
        port: ['1555278709148356638', '1555025639235518506', '1555025977820848300', '1563221260505452654', '1562533958195875912', '1555011827858145360', '1556369483189194782'],
        'eau-douce': ['1555284384926535690', '1556314359221854259', '1556325782652059658', '1562495601659093083', '1562556477581824040', '1555011187610230794', '1555010626668208158', '1555016032148791408', '1556370921164382360', '1556368427885793343'],
        montagne: ['1556366436081860660', '1562496269035774073', '1555017248312397994', '1555017458753212566', '1556370279201247273', '1556368635100921896', '1556369188967161956', '1556400290654326784'],
        foret: ['1556366236101644288', '1562495864407068724', '1555010133241757818', '1555009931059527760', '1555016589110284359', '1556369768863506592', '1556368958331027496', '1556371819118731314', '1556370024174715031'],
        campagne: ['1555026735068880947', '1555026549739102368', '1556329419998494721', '1562495428501569578', '1562496510019764294', '1555009108866760814', '1555013848413769882', '1556371197208559816'],
        ruines: ['1555027085905494026', '1555027205246156910', '1556330488640180476', '1556330711412383815', '1562501951269109820', '1562502348729745580', '1562501606967349318', '1562502587599560825', '1562503513823641700', '1562502146631409724', '1562503680534650960', '1555014592411729970', '1555010361252647054', '1555015812853538876', '1555017046599667782', '1555009430620217354', '1556370496944218234', '1556399855641960518', '1556371555364118549'],
        'bas-fonds': ['1555024974341865553', '1556335574460272650', '1556334825042870372', '1556336755743924235', '1556336510696034404', '1556335161434570892', '1556320399153828032', '1556315229669949461', '1556320099575537745', '1556315010752577676', '1555012784666972191'],
        mer: ['1563192192527376475', '1563194834351558666', '1563192754136289451', '1563191971856646254'], // ponts du Baratie (le Grand Océan n'est pas utilisé)
      };
      const places = {};
      for (const [table, ids] of Object.entries(A)) for (const id of ids) places[`ch:${id}`] = { table, name: '', kind: 'post' };
      const loot = normalizeLoot({ tables, places });
      await retry(async () => {
        const row = await read('meta', 'loot');
        await write('meta', 'loot', loot, row?.version ?? null);
      });
      return { loot, toast: `Butins remplacés : ${Object.keys(loot.tables).length} tables, ${Object.keys(loot.places).length} lieux.` };
    }

    case 'loot.export': {
      // Export des butins : envoyé en message privé par le bot, sous forme de fichier
      const name = String(body.name || 'export.json').replace(/[^\w.-]/g, '').slice(0, 60) || 'export.json';
      const content = String(body.content || '');
      need(content.length < 3_000_000, 413, 'Export trop gros.');
      const H = { Authorization: `Bot ${env.botToken}` };
      const dm = await (await fetch('https://discord.com/api/v10/users/@me/channels', { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ recipient_id: me.uid }) })).json().catch(() => null);
      need(dm?.id, 502, 'Impossible d’ouvrir un message privé avec le bot.');
      const form = new FormData();
      form.append('payload_json', JSON.stringify({ content: '📦 Voici ton export des butins.' }));
      form.append('files[0]', new Blob([content], { type: 'application/json' }), name);
      const r = await fetch(`https://discord.com/api/v10/channels/${dm.id}/messages`, { method: 'POST', headers: H, body: form });
      need(r.ok, 502, 'Envoi du fichier impossible : vérifie que tu acceptes les messages privés des membres du serveur.');
      return { toast: 'Export envoyé : regarde tes messages privés avec le bot.' };
    }

    case 'loot.channels': {
      // Salons RP (déclarés et salons des bateaux) et posts ouverts de leurs forums, pour attribuer les tables de butin
      const list = (await read('meta', 'rp:channels'))?.data?.list || [];
      const { activeThreads } = await import('./_lib/discord.js');
      const threads = list.some((c) => c.kind === 'forum') ? await activeThreads() : [];
      return {
        channels: list
          .map((c) => ({
            id: String(c.id),
            name: c.name || String(c.id),
            kind: c.kind === 'forum' ? 'forum' : 'salon',
            posts: c.kind === 'forum' ? threads.filter((t) => t.parent_id === String(c.id)).map((t) => ({ id: t.id, name: t.name })).sort((a, b) => a.name.localeCompare(b.name)) : [],
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      };
    }

    case 'loot.get':
      return { loot: normalizeLoot((await read('meta', 'loot'))?.data || {}) };

    case 'loot.table.save':
    case 'loot.table.delete':
    case 'loot.place.set':
    case 'loot.place.remove': {
      // Lieu donné par un ID de salon (post, salon ou forum) : on vérifie qu'il existe et on retrouve son nom
      let ch = null;
      if (body.op === 'loot.place.set' && body.channelId) {
        ch = await channelById(String(body.channelId).trim());
        need(ch, 400, 'Salon introuvable : vérifie l’ID (clic droit > Copier l’identifiant).');
      }
      return retry(async () => {
        const row = await read('meta', 'loot');
        const loot = normalizeLoot(row?.data || {});
        let id = body.id, toast = 'Butins mis à jour';
        if (body.op === 'loot.table.save') {
          const name = String(body.table?.name || '').trim().slice(0, 60);
          need(name, 400, 'Donne un nom à la table.');
          id = body.id && loot.tables[body.id] ? body.id : freeId(name, loot.tables);
          loot.tables[id] = { name, entries: body.table.entries || [] };
          toast = `Table enregistrée : ${name}`;
        }
        if (body.op === 'loot.table.delete') {
          need(loot.tables[body.id], 404, 'Table introuvable.');
          toast = `Table supprimée : ${loot.tables[body.id].name}`;
          delete loot.tables[body.id]; // les lieux qui l'utilisaient n'ont plus de butin
        }
        if (body.op === 'loot.place.set') {
          need(loot.tables[body.table], 404, 'Table introuvable.');
          if (ch) loot.places[`ch:${String(body.channelId).trim()}`] = { table: body.table, name: ch.name, kind: ch.thread ? 'post' : ch.forum ? 'forum' : 'salon' };
          else {
            need(body.islandId, 400, 'Choisis une île ou un salon.');
            loot.places[`isl:${body.islandId}`] = { table: body.table, name: String(body.name || '').slice(0, 100), kind: 'ile' };
          }
          toast = 'Lieu ajouté';
        }
        if (body.op === 'loot.place.remove') {
          delete loot.places[body.key];
          toast = 'Lieu retiré';
        }
        const clean = normalizeLoot(loot);
        await write('meta', 'loot', clean, row?.version ?? null);
        return { loot: clean, id, toast };
      });
    }

    case 'icons.set': {
      // Icône de l'app remplacée par une image (ou remise par défaut si img est vide)
      const key = String(body.key || '');
      need(/^(ico:\d{1,4}|pic:[a-z_]{1,30}|slot:[a-z0-9-]{1,40}|berry)$/.test(key), 400, 'Icône inconnue.');
      const url = body.img ? await ingest(body.img, 'icones', key.replace(/\W/g, '-')) : null;
      return retry(async () => {
        const row = await read('meta', 'icons');
        const icons = { ...(row?.data || {}) };
        if (url) icons[key] = url;
        else delete icons[key];
        await write('meta', 'icons', icons, row?.version ?? null);
        return { icons, toast: url ? 'Icône changée pour tout le monde' : 'Icône remise par défaut' };
      });
    }
    case 'calc': {
      // Calcul de trajet : actions RP entre deux îles pour un bateau (existant ou modèle)
      const GM = await import('../shared/game.js');
      const { map } = await loadMap();
      const byName = (a, b) => a.name.localeCompare(b.name);
      if (body.list) {
        return {
          islands: Object.entries(map.islands).map(([id, i]) => ({ id, name: i.name })).sort(byName),
          ships: Object.entries(await readAll('ships')).map(([id, s]) => ({ id, name: s.name || id })).sort(byName),
          models: Object.entries(GM.ITEMS).filter(([, it]) => it.kind === 'bateau').map(([id, it]) => ({ id, name: it.name })).sort(byName),
        };
      }
      need(map.islands[body.from] && map.islands[body.to], 400, 'Choisis deux îles.');
      let ship;
      if (body.shipId) {
        const r = await read('ships', String(body.shipId));
        need(r, 404, 'Bateau introuvable.');
        ship = GM.normalizeShip(r.data);
      } else {
        const it = GM.ITEMS[body.model];
        need(it?.kind === 'bateau', 404, 'Modèle introuvable.');
        ship = GM.normalizeShip({ ...(it.ship || {}), name: it.name });
      }
      const st = GM.shipStats(ship);
      const head = { ship: ship.name, fromName: map.islands[body.from].name, toName: map.islands[body.to].name, speed: st.speed, pace: map.pace };
      const t = body.from === body.to ? null : GM.travelTime(map, body.from, body.to);
      if (!t) return { ...head, none: true };
      const base = GM.voyageActions(t.value, st.speed, map.pace);
      return {
        ...head,
        value: t.value,
        via: t.path.slice(1, -1).map((s) => map.islands[s]?.name).filter(Boolean),
        diff: GM.pathDifficulty(map, t.path),
        base,
        best: Math.max(2, Math.ceil(base * 0.8)),
        worst: Math.max(2, Math.ceil(base * 1.25)),
      };
    }
    case 'features': {
      // Fonctionnalités activées ou non pour les joueurs
      const { map } = await loadMap();
      return { features: map.features || {}, seaEvents: map.seaEvents || null };
    }
    case 'inventions': {
      // Toutes les inventions en attente de validation, avec le niveau de métier de leur auteur
      const list = [];
      for (const [uid, p] of Object.entries(await readAll('players'))) {
        for (const inv of p.inventions || []) if (!inv.ok && !inv.refused) list.push({ uid, player: fullName(p), job: p.job?.id || null, jobLvl: p.job?.lvl || 1, invention: inv });
      }
      list.sort((a, b) => (a.invention.at || 0) - (b.invention.at || 0));
      return { list };
    }
        case 'techniques': {
      // Toutes les techniques en attente de validation, tous joueurs confondus
      const list = [];
      for (const [uid, p] of Object.entries(await readAll('players'))) {
        for (const t of p.techniques || []) if (!t.ok && !t.refused) list.push({ uid, player: fullName(p), tech: t });
      }
      list.sort((a, b) => (a.tech.id || 0) - (b.tech.id || 0));
      return { list };
    }

    case 'crews':
      return { crews: await readAll('crews'), ships: await readAll('ships') };

    case 'crew.save': {
      const input = body.crew || {};
      const crews = await readAll('crews');
      const id = body.id && crews[body.id] ? body.id : freeId(input.name || 'equipage', crews);
      const old = crews[id] ? normalizeCrew(structuredClone(crews[id])) : null;
      const crew = normalizeCrew({ ...(old || {}), ...input, chest: input.chest ?? old?.chest ?? {} });
      if (input.flag !== undefined) crew.flag = input.flag ? await ingest(input.flag, 'pavillons', id) : null;
      // Bateau d'équipage : il doit exister, et devient la propriété de l'équipage.
      if (crew.ship) {
        const ship = await read('ships', crew.ship);
        need(ship, 404, 'Bateau introuvable.');
        if (ship.data.owner?.kind !== 'crew' || ship.data.owner.id !== id) {
          await write('ships', crew.ship, { ...ship.data, owner: { kind: 'crew', id } }, ship.version);
        }
      }
      // Un joueur n'est que dans un équipage : on met à jour les fiches concernées.
      const before = new Set(old?.members || []), after = new Set(crew.members);
      for (const uid of after) {
        if (before.has(uid) || isNpc(uid)) continue; // les PNJ n'ont pas de fiche
        await retry(async () => {
          const row = await read('players', uid);
          need(row, 404, `Le joueur ${uid} n’a pas de fiche.`);
          need(crew.kind !== 'flotte' || row.data.id?.faction === 'Marine', 400, `${row.data.id?.name || uid} n’est pas Marine : il ne peut pas rejoindre une flotte.`);
          const prev = row.data.crewId;
          if (prev && prev !== id && crews[prev]) {
            const other = await read('crews', prev);
            if (other) {
              const o = normalizeCrew(other.data);
              o.members = o.members.filter((m) => m !== uid);
              await write('crews', prev, normalizeCrew(o), other.version);
            }
          }
          await write('players', uid, { ...row.data, crewId: id }, row.version);
        });
      }
      for (const uid of before) {
        if (after.has(uid) || isNpc(uid)) continue;
        await retry(async () => {
          const row = await read('players', uid);
          if (row && row.data.crewId === id) await write('players', uid, { ...row.data, crewId: null }, row.version);
        });
      }
      await retry(async () => {
        const row = await read('crews', id);
        await write('crews', id, crew, row?.version ?? null);
      });
      return { id, crew, toast: `${crew.kind === 'flotte' ? 'Escouade' : 'Équipage'} ${old ? 'modifié' : 'créé'}${crew.kind === 'flotte' ? 'e' : ''} : ${crew.name}` };
    }

    case 'crew.delete': {
      const row = await read('crews', body.id);
      need(row, 404, 'Équipage introuvable.');
      for (const uid of row.data.members || []) {
        await retry(async () => {
          const p = await read('players', uid);
          if (p && p.data.crewId === body.id) await write('players', uid, { ...p.data, crewId: null }, p.version);
        });
      }
      const ships = await readAll('ships');
      for (const [sid, sh] of Object.entries(ships)) {
        if (sh.owner?.kind === 'crew' && sh.owner.id === body.id) {
          const r = await read('ships', sid);
          await write('ships', sid, { ...r.data, owner: null }, r.version);
        }
      }
      await remove('crews', body.id);
      return { toast: `Équipage supprimé : ${row.data.name}. Ses bateaux sont maintenant sans propriétaire.` };
    }

    case 'ships':
      return { ships: await readAll('ships') };

    case 'ship.save': {
      const input = { ...(body.ship || {}) };
      // Position : le salon où le bateau est à quai, donné par son ID.
      if ('positionId' in input) {
        const pid = String(input.positionId || '').trim();
        if (pid) {
          const ch = await channelById(pid);
          need(ch, 400, 'Salon introuvable pour la position : vérifie l’ID du salon.');
          input.position = { channelId: pid, name: ch.name, parentId: ch.thread ? ch.parentId : null };
          input.voyage = null; // remis à quai par le staff
        } else input.position = null;
        delete input.positionId;
      }
      // Salon RP du bateau, donné par son ID (post ou forum) : il devient aussi un salon RP
      if ('channelId' in input) {
        const cid = String(input.channelId || '').trim();
        if (cid) {
          const ch = await channelById(cid);
          need(ch, 400, 'Salon du bateau introuvable : vérifie l’ID.');
          input.channel = { id: cid, kind: ch.forum ? 'forum' : 'post', name: ch.name };
          await retry(async () => {
            const row = await read('meta', 'rp:channels');
            const list = (row?.data.list || []).filter((c) => c.id !== cid);
            list.push({ id: cid, name: ch.name, kind: ch.forum ? 'forum' : 'salon', by: me.uid, at: Date.now() });
            await write('meta', 'rp:channels', { list }, row?.version ?? null);
          });
        } else input.channel = null;
        delete input.channelId;
      }
      const ships = await readAll('ships');
      const existing = body.id && ships[body.id] ? body.id : null;
      if (!existing) {
        // Un nouveau bateau vient toujours d'un modèle créé dans Gestion (catégorie Bateau).
        need(input.model && catalog.items[input.model]?.kind === 'bateau', 400, 'Choisis un modèle de bateau (à créer dans Gestion, catégorie « Bateau »).');
        for (const k of ['type', 'cannons', 'capacity', 'berths', 'sail', 'space']) delete input[k]; // tout vient du modèle
      }
      const id = existing || freeId(input.name || catalog.items[input.model].name, ships);
      const old = ships[id] || null;
      const ship = old ? normalizeShip({ ...old, ...input }) : newShip(input);
      if (input.photo !== undefined) ship.photo = input.photo ? await ingest(input.photo, 'bateaux', id) : null;
      // Nouveau bateau : son salon RP est créé tout seul (sauf espace « aucun » ou salon déjà indiqué)
      let chanNote = '';
      // Le salon du bateau est créé à son premier départ, pas à sa création
      if (false) {
        const cfg = (await read('meta', 'ships:config'))?.data || {};
        if (!(ship.space === 'forum' ? cfg.categoryId : cfg.forumId)) chanNote = ' · salon non créé : fais d’abord /bateau config';
        else {
          try {
            ship.channel = await createShipChannel(ship, cfg);
            if (ship.channel) await addRpChannel(ship.channel.id, ship.channel.name, ship.channel.kind === 'forum' ? 'forum' : 'salon', me.uid);
          } catch (err) {
            chanNote = ` · salon non créé : ${err.message}`;
          }
        }
      }
      // Si le bateau quitte un équipage, celui-ci n'a plus de bateau attitré.
      if (old?.owner?.kind === 'crew' && (ship.owner?.kind !== 'crew' || ship.owner.id !== old.owner.id)) {
        const c = await read('crews', old.owner.id);
        if (c && c.data.ship === id) await write('crews', old.owner.id, { ...c.data, ship: null }, c.version);
      }
      await retry(async () => {
        const row = await read('ships', id);
        await write('ships', id, ship, row?.version ?? null);
      });
      // Donné à un équipage ou une flotte sans bateau attitré : il le devient.
      if (ship.owner?.kind === 'crew') {
        await retry(async () => {
          const c = await read('crews', ship.owner.id);
          if (c && !c.data.ship) await write('crews', ship.owner.id, { ...c.data, ship: id }, c.version);
        });
      }
      if (old && old.name !== ship.name && ship.channel) await renameShipChannel(ship).catch(() => {}); // le salon suit le nom du bateau
      return { id, ship, toast: old ? `Bateau modifié : ${ship.name}` : `Bateau créé : ${ship.name}${ship.channel ? ` · salon ${ship.channel.name}` : ' · son salon sera créé à son premier départ'}` };
    }

    case 'ship.upgrade': {
      return retry(async () => {
        const row = await read('ships', body.id);
        need(row, 404, 'Bateau introuvable.');
        const ship = upgradeShip(normalizeShip(row.data), body.type, body.amount, { by: me.uid });
        await write('ships', body.id, ship, row.version);
        const n = Number(body.amount);
        return { id: body.id, ship, toast: `${ship.name} : ${n > 0 ? '+' : ''}${n} ${body.type === 'cale' ? 'kg de cale' : body.type === 'canons' ? 'canon(s)' : 'niveau(x) de voile'}` };
      });
    }

    case 'ship.cfg': {
      // Réglages des bateaux : effets des canons, bois, voile, moteur, cale, coque
      const cfg = normalizeShipCfg(body.cfg || {});
      return retry(async () => {
        const row = await read('meta', 'shipcfg');
        await write('meta', 'shipcfg', cfg, row?.version ?? null);
        catalog.shipcfg = cfg;
        return { catalog, toast: 'Réglages des bateaux enregistrés' };
      });
    }

    case 'ship.delete': {
      const row = await read('ships', body.id);
      need(row, 404, 'Bateau introuvable.');
      if (row.data.owner?.kind === 'crew') {
        const c = await read('crews', row.data.owner.id);
        if (c && c.data.ship === body.id) await write('crews', row.data.owner.id, { ...c.data, ship: null }, c.version);
      }
      await remove('ships', body.id);
      return { toast: `Bateau supprimé : ${row.data.name}` };
    }

    case 'map.get':
      return { map: (await loadMap()).map };

    case 'map.bg':
    case 'map.island.save':
    case 'map.island.move':
    case 'map.island.delete':
        case 'map.link':
    case 'map.unlink':
    case 'map.dir':
    case 'map.pace':
    case 'map.features':
    case 'map.seaevents':
    case 'map.diff': {
      // Images d'abord (hors de la boucle de réessai)
      let bg, img;
      if (body.op === 'map.bg') bg = body.bg ? await ingest(body.bg, 'carte', 'fond') : null;
      if (body.op === 'map.island.save' && body.island?.img) img = await ingest(body.island.img, 'iles', slug(body.island.name || 'ile'));
      // Salons de l'île : on vérifie chaque ID et on retrouve son nom (et si c'est un forum)
      let channels;
      if (body.op === 'map.island.save') {
        channels = [];
        for (const c of body.island?.channels || []) {
          const id = String(c.id || c).trim();
          if (!id) continue;
          const ch = await channelById(id);
          need(ch, 400, `Salon introuvable : ${id}. Vérifie l’ID.`);
          need(!env.guildId || !ch.guildId || ch.guildId === env.guildId, 400, `Le salon ${ch.name} n’est pas sur le serveur principal.`);
          channels.push({ id, name: ch.name, kind: ch.forum ? 'forum' : 'salon' });
        }
      }
      // Les salons d'une île deviennent des salons RP (un forum : chacun de ses posts compte)
      if (channels?.length) {
        await retry(async () => {
          const row = await read('meta', 'rp:channels');
          const list = row?.data.list || [];
          const missing = channels.filter((c) => !list.some((x) => x.id === c.id));
          if (!missing.length) return;
          const added = missing.map((c) => ({ id: c.id, name: c.name, kind: c.kind, by: me.uid, at: Date.now() }));
          await write('meta', 'rp:channels', { list: [...list, ...added] }, row?.version ?? null);
        });
      }
      return retry(async () => {
        const { map, version } = await loadMap();
        let toast = 'Carte mise à jour', id = body.id;
        if (body.op === 'map.seaevents') {
          map.seaEvents = body.seaEvents || null;
          toast = 'Événements en mer enregistrés';
        }
        if (body.op === 'map.features') {
          map.features = { ...(map.features || {}), ...Object.fromEntries(Object.entries(body.features || {}).map(([k, v]) => [k, !!v])) };
          toast = 'Fonctionnalités enregistrées';
        }
        if (body.op === 'map.diff') {
          const k = routeKey(body.a, body.b);
          need(map.links[k] !== undefined, 404, 'Cette route n’existe pas.');
          map.diff ??= {};
          map.diff[k] = Math.max(1, Math.min(5, Math.round(Number(body.diff) || 2)));
          toast = null;
        }
        if (body.op === 'map.pace') {
          map.pace = Number(body.pace) > 0 ? Math.min(10, Number(body.pace)) : 0.5;
          toast = `Rythme des voyages : ${map.pace}`;
        }
        if (body.op === 'map.bg') {
          map.bg = bg;
          if (Number(body.ratio) > 0) map.ratio = Number(body.ratio);
          toast = bg ? 'Fond de carte enregistré' : 'Fond de carte retiré';
        }
        if (body.op === 'map.island.save') {
          const old = body.id && map.islands[body.id];
          const isl = normalizeIsland({ ...(old || {}), ...body.island, img: img ?? (body.island.img === null ? null : old?.img ?? null), channels });
          // Un salon n'appartient qu'à une île : on le retire des autres
          for (const [oid, o] of Object.entries(map.islands)) if (oid !== body.id) o.channels = o.channels.filter((c) => !isl.channels.some((n) => n.id === c.id));
          if (!old) {
            id = slug(isl.name);
            for (let n = 2; map.islands[id]; n++) id = `${slug(isl.name)}-${n}`;
          }
          map.islands[id] = isl;
          const what = isl.kind === 'waypoint' ? 'Point de passage' : 'Île';
          toast = old ? `${what} modifié${isl.kind === 'waypoint' ? '' : 'e'} : ${isl.name}` : `${what} ajouté${isl.kind === 'waypoint' ? '' : 'e'} : ${isl.name}`;
        }
        if (body.op === 'map.island.move') {
          need(map.islands[body.id], 404, 'Île introuvable.');
                    const cur = map.islands[body.id];
                    map.islands[body.id] = normalizeIsland({ ...cur, x: body.x ?? cur.x, y: body.y ?? cur.y, size: body.size ?? cur.size, rot: body.rot ?? cur.rot, lx: body.lx ?? cur.lx, ly: body.ly ?? cur.ly });
          toast = null;
        }
        if (body.op === 'map.island.delete') {
          need(map.islands[body.id], 404, 'Île introuvable.');
          toast = `Supprimé : ${map.islands[body.id].name}`;
          delete map.islands[body.id]; // ses routes disparaissent avec elle
        }
                if (body.op === 'map.link' || body.op === 'map.unlink' || body.op === 'map.dir') {
          map.oneway ??= {};
          need(map.islands[body.a] && map.islands[body.b] && body.a !== body.b, 400, 'Route invalide.');
          const k = routeKey(body.a, body.b);
          if (body.op === 'map.unlink') {
            delete map.links[k];
            delete map.oneway[k];
          } else if (body.op === 'map.dir') {
            need(map.links[k] !== undefined, 404, 'Cette route n’existe pas.');
            if (body.from === body.a || body.from === body.b) map.oneway[k] = body.from;
            else delete map.oneway[k];
          } else {
            map.links[k] = body.value === null || body.value === '' || body.value === undefined ? null : Math.max(0, Math.round(Number(body.value) || 0));
            if (body.oneway === body.a || body.oneway === body.b) map.oneway[k] = body.oneway; // route tracée à sens unique
          }
          toast = null;
        }
        const clean = normalizeMap(map);
        await write('meta', 'map', clean, version);
        return { map: clean, id, toast };
      });
    }

    case 'shop.economy': {
      // Grille économique du 24/10/2026 : valeurs et poids des objets, recettes corrigées, prix des boutiques (rachat 40 %)
      const V = {
        arc: [15000, 1], revolver: [30000, 1], 'sabre-courbe': [35000, 1.5], katana: [45000, 1.2], 'epee-longue': [45000, 3], fusil: [50000, 4], massue: [60000, 8], 'tromblon-a-6-canons': [120000, 2.5],
        'log-pose': [80000, 0.3], jumelles: [20000, 0.8], 'mortier-et-pilon': [12000, 2], 'trousse-de-medecine': [30000, 3], 'kit-d-archeologue': [30000, 4], 'kit-de-scientifique': [35000, 5], 'kit-de-charpentier': [18000, 6],
        'bout-de-bois': [300, 2], 'bois-robuste': [2500, 2], 'bois-de-deul': [25000, 2], 'bois-d-adam': [150000, 2.5], chanvre: [150, 0.1], tissu: [800, 0.4],
        bandage: [800, 0.1], antidote: [3000, 0.2], attelle: [3000, 0.5],
        'sel-marin': [50, 0.5], riz: [80, 1], farine: [80, 1], 'pommes-de-terre': [80, 1], sucre: [100, 0.5], tomates: [100, 0.5], piment: [100, 0.1], 'legumes-varies': [120, 1], oeufs: [120, 0.6],
        'produit-laitier': [150, 1], agrumes: [150, 0.5], champignons: [150, 0.3], 'poisson-cru': [300, 1], 'viande-crue': [400, 1], crustaces: [500, 0.8],
        barque: [60000, 0], caravelle: [800000, 0], goelette: [1500000, 0], gallion: [5000000, 0], striker: [10000000, 0], cuirasse: [15000000, 0],
      };
      // Descriptions : seulement pour les objets qui n'en ont pas (ou presque pas)
      const D = {
        arc: 'Arc en bois souple et corde tressée. Silencieux et léger, il demande un œil sûr : l’arme des chasseurs et des tireurs discrets.',
        revolver: 'Revolver à barillet de six coups, compact et fiable. Il se dégaine en un éclair, idéal pour les duels rapprochés.',
        massue: 'Énorme gourdin de bois cerclé de fer. Lent à manier, mais chaque coup peut briser des os et des boucliers.',
        caravelle: 'Navire léger à deux mâts, maniable et rapide. Parfait pour un jeune équipage qui veut quitter East Blue.',
        goelette: 'Voilier élancé, plus spacieux qu’une caravelle et rapide par vent de travers. Les contrebandiers l’adorent.',
        gallion: 'Imposant navire de haute mer à plusieurs ponts. Lent mais robuste, sa cale immense peut transporter de véritables trésors.',
        cuirasse: 'Bâtiment de guerre blindé, capable d’embarquer une trentaine de marins. Une forteresse flottante, lourde à manœuvrer.',
        'bout-de-bois': 'Planche de bois ordinaire, taillée dans les forêts d’East Blue. La base de toute coque et de toute réparation.',
        'bois-robuste': 'Planche de chêne dense et traitée. Elle encaisse les tempêtes et les boulets : deux fois plus solide que le bois ordinaire.',
        'bois-de-deul': 'Bois rare et sombre, d’une résistance exceptionnelle. On dit qu’il ne pourrit jamais, même après des années en mer.',
        'bois-d-adam': 'Bois légendaire de l’arbre d’Adam, presque indestructible. Seuls les plus grands charpentiers savent le travailler.',
        'poisson-cru': 'Poisson frais pêché du matin. À cuisiner vite, avant que le soleil ne s’en charge.',
        'viande-crue': 'Belle pièce de viande crue. De quoi rassasier même le plus affamé des capitaines.',
        crustaces: 'Crabes, crevettes et homards fraîchement pêchés. Un délice, pour qui sait les cuisiner.',
        agrumes: 'Oranges, citrons et mandarines. Indispensables en mer pour éloigner le scorbut.',
        riz: 'Sac de riz blanc. Nourrissant et facile à conserver, la base de nombreux plats.',
        farine: 'Sac de farine de blé, pour le pain, les pâtes et les pâtisseries.',
        'pommes-de-terre': 'Sac de pommes de terre. Elles se conservent longtemps en cale et se cuisinent de mille façons.',
        'legumes-varies': 'Panier de légumes de saison : carottes, choux, oignons…',
        tomates: 'Tomates bien mûres, pour les sauces et les salades.',
        champignons: 'Champignons des bois cueillis à la main. Savoureux, à condition de savoir lesquels ne sont pas toxiques.',
        piment: 'Petits piments rouges. Une pincée réveille un plat, deux réveillent l’équipage.',
        sucre: 'Sachet de sucre de canne, pour les desserts et les boissons.',
        'sel-marin': 'Sel récolté dans les marais salants. Il assaisonne et conserve les aliments.',
        oeufs: 'Une douzaine d’œufs frais, à transporter avec précaution.',
        'produit-laitier': 'Lait frais, beurre ou fromage, selon l’arrivage. À consommer avant le prochain long voyage.',
      };
      const R = {
        '1-antidote': { needs: { champignons: 3, agrumes: 2, 'sel-marin': 1 }, tools: { 'mortier-et-pilon': 1 } },
        'soin-plaie-critique-au-plus-2': { needs: { bandage: 8, antidote: 1 }, tools: { 'trousse-de-medecine': 1 } },
        'soin-fracture-serieuse-au-plus': { gives: {} },
        '1-barque': { needs: { tissu: 2, chanvre: 5 }, work: { woodQty: 15 }, seconds: 7200 },
        'construire-caravelle-bois-stan': { needs: { tissu: 8, chanvre: 10 }, work: { woodQty: 30 }, seconds: 86400, lvl: 2 },
        'reparer-la-coque-23': { needs: { 'bout-de-bois': 3 } },
        'reparer-la-coque-20': { needs: { 'bout-de-bois': 5 } },
        'reparer-la-coque-30': { needs: { 'bout-de-bois': 7 } },
        '1-tissu': { job: null, lvl: 1, gives: { tissu: 1 }, needs: { chanvre: 4 }, tools: {}, seconds: 600 },
        '1-attelle': { job: 'medecin', lvl: 1, gives: { attelle: 1 }, needs: { 'bout-de-bois': 1, tissu: 2 }, tools: { 'trousse-de-medecine': 1 }, seconds: 1800 },
        // Nouvelles recettes
        '1-corde': { job: null, lvl: 1, gives: { corde: 1 }, needs: { chanvre: 3 }, tools: {}, seconds: 300 },
        '5-clous': { job: 'charpentier', lvl: 1, gives: { clous: 5 }, needs: { fer: 1 }, tools: { 'kit-de-charpentier': 1 }, seconds: 600 },
        '1-poudre-a-canon': { job: 'scientifique', lvl: 1, gives: { 'poudre-a-canon': 1 }, needs: { 'sel-marin': 2, 'bout-de-bois': 1 }, tools: { 'kit-de-scientifique': 1 }, seconds: 900 },
        '1-bombe': { job: 'scientifique', lvl: 2, gives: { bombe: 1 }, needs: { 'poudre-a-canon': 1, corde: 1, fer: 1 }, tools: { 'kit-de-scientifique': 1 }, seconds: 1800 },
        '1-fumigene': { job: 'scientifique', lvl: 1, gives: { fumigene: 1 }, needs: { 'poudre-a-canon': 1, 'herbes-medicinales': 2 }, tools: { 'kit-de-scientifique': 1 }, seconds: 1200 },
        '2-cola': { job: null, lvl: 1, kitchen: true, gives: { cola: 2 }, needs: { sucre: 2, agrumes: 1, 'sel-marin': 1 }, tools: {}, seconds: 300 },
        '3-fils-de-suture': { job: 'medecin', lvl: 1, gives: { 'fil-de-suture': 3 }, needs: { chanvre: 1, 'alcool-medical': 1 }, tools: { 'trousse-de-medecine': 1 }, seconds: 600 },
        '1-pommade': { job: 'medecin', lvl: 1, gives: { pommade: 1 }, needs: { 'herbes-medicinales': 3, 'produit-laitier': 1 }, tools: { 'mortier-et-pilon': 1 }, seconds: 900 },
        '1-platre': { job: 'medecin', lvl: 1, gives: { platre: 1 }, needs: { tissu: 2, farine: 1 }, tools: { 'trousse-de-medecine': 1 }, seconds: 900 },
        '1-morphine': { job: 'medecin', lvl: 2, gives: { morphine: 1 }, needs: { 'herbes-medicinales': 4, 'alcool-medical': 2 }, tools: { 'mortier-et-pilon': 1 }, seconds: 3600 },
        'restaurer-relique': { job: 'archeologue', lvl: 1, gives: { 'relique-ancienne': 1 }, needs: { 'relique-abimee': 1 }, tools: { 'kit-d-archeologue': 1 }, seconds: 14400, game: { list: ['fouiller', 'recoller', 'dechiffrer'], diff: 0 } },
        'nettoyer-pieces': { job: 'archeologue', lvl: 1, gives: { 'piece-d-or-ancienne': 5 }, needs: { 'pieces-oxydees': 5 }, tools: { 'kit-d-archeologue': 1 }, seconds: 3600, game: { list: ['fouiller'], diff: 0 } },
        // Nouvelles opérations
        'soin-brulure-legere': { job: 'medecin', lvl: 1, care: { type: 'brulure', level: 1 }, needs: { pommade: 1 }, tools: {}, seconds: 1800, game: { list: ['desinfecter'], diff: 0 } },
        'greffe-de-peau': { job: 'medecin', lvl: 3, care: { type: 'brulure', level: 4 }, needs: { 'fil-de-suture': 2, 'alcool-medical': 1 }, tools: { 'trousse-de-medecine': 1 }, seconds: 172800, game: { list: ['incision', 'suture', 'desinfecter'], diff: 0, time: 150 } },
        'lavage-d-estomac': { job: 'medecin', lvl: 2, care: { type: 'empoisonnement', level: 3 }, needs: { 'alcool-medical': 1, antidote: 1 }, tools: { 'trousse-de-medecine': 1 }, seconds: 43200, game: { list: ['hemorragie', 'desinfecter'], diff: 0 } },
        'extraction-du-venin': { job: 'medecin', lvl: 3, care: { type: 'empoisonnement', level: 4 }, needs: { antidote: 2, 'fil-de-suture': 1 }, tools: { 'trousse-de-medecine': 1 }, seconds: 86400, game: { list: ['incision', 'extraction', 'suture'], diff: 0, time: 150 } },
        'pose-d-un-platre': { job: 'medecin', lvl: 2, care: { type: 'fracture', level: 3 }, needs: { platre: 1 }, tools: { 'trousse-de-medecine': 1 }, seconds: 172800, game: { list: ['bandage', 'reduction'], diff: 0 } },
        'reduction-de-fracture': { job: 'medecin', lvl: 3, care: { type: 'fracture', level: 4 }, needs: { platre: 1, morphine: 1, 'fil-de-suture': 1 }, tools: { 'trousse-de-medecine': 1 }, seconds: 259200, game: { list: ['incision', 'reduction', 'suture'], diff: 0, time: 150 } },
        'extraction-de-balle': { job: 'medecin', lvl: 2, care: { type: 'balle-logee', level: 4 }, needs: { 'fil-de-suture': 1, 'alcool-medical': 1 }, tools: { 'trousse-de-medecine': 1 }, seconds: 86400, game: { list: ['incision', 'extraction', 'suture'], diff: 0, time: 150 } },
      };
      const F = {
        '1555026549739102368': 0.9, '1555280961833275422': 0.95,
        '1555024561777545368': 1.05, '1555279229904748706': 1.05, '1562497093434740827~2': 1.05, '1562497584973611098': 1.05,
        '1562533958195875912': 1.1, '1562497093434740827': 1.1, '1555012326321688632': 1.1, '1555011827858145360': 1.15,
      };
      const WEAPONS = ['lance-pierre', 'arc', 'revolver', 'sabre-courbe', 'katana', 'lance', 'epee-longue', 'fusil', 'massue', 'tromblon-a-6-canons', 'poudre-a-canon'];
      const nice = (n) => (n >= 10000 ? Math.round(n / 500) * 500 : n >= 1000 ? Math.round(n / 50) * 50 : Math.max(5, Math.round(n / 5) * 5));
      // Nouveaux objets (créés s'ils n'existent pas) : [nom, catégorie, rareté, valeur, poids, description, soin]
      const N = {
        corde: ['Corde', 'mat', 'commun', 600, 0.6, 'Cordage tressé en fibres de chanvre. Gréement, amarrage, réparations : un navire en consomme des kilomètres.'],
        clous: ['Clous', 'mat', 'commun', 300, 0.5, 'Petit sac de clous forgés. Indispensables à toute construction et réparation.'],
        cuir: ['Cuir', 'mat', 'commun', 1200, 1, 'Peau tannée, souple et résistante. Pour les fourreaux, les sacs et les sangles.'],
        fer: ['Lingot de fer', 'mat', 'commun', 3000, 2, 'Lingot de fer brut, prêt à être forgé en clous, en lames ou en pièces de navire.'],
        'poudre-a-canon': ['Poudre à canon', 'mat', 'peu-commun', 2000, 0.5, 'Poudre noire très inflammable. À garder au sec, et loin du cuisinier qui fume.'],
        'herbes-medicinales': ['Herbes médicinales', 'mat', 'commun', 300, 0.1, 'Bouquet de plantes séchées aux vertus apaisantes et cicatrisantes.'],
        'alcool-medical': ['Alcool médical', 'mat', 'commun', 1000, 0.5, 'Flacon d’alcool pur pour désinfecter les plaies et les instruments. Ne se boit pas, même pour fêter une victoire.'],
        'fil-de-suture': ['Fil de suture', 'mat', 'commun', 500, 0.05, 'Fil fin et stérilisé, pour refermer les plaies proprement.'],
        platre: ['Plâtre', 'mat', 'commun', 2500, 1, 'Bandes plâtrées qui durcissent en séchant, pour immobiliser une fracture grave.'],
        pommade: ['Pommade cicatrisante', 'conso', 'commun', 2000, 0.2, 'Onguent à base d’herbes qui apaise les brûlures légères.', { type: 'brulure', level: 1 }],
        morphine: ['Morphine', 'conso', 'peu-commun', 6000, 0.1, 'Puissant antidouleur. À manier avec précaution : la dose fait le remède, ou le poison.'],
        'baby-den-den-mushi': ['Baby Den Den Mushi', 'objet', 'peu-commun', 50000, 0.5, 'Petit escargophone de poche. Sa portée est courte, mais il tient dans la main.'],
        'den-den-mushi': ['Den Den Mushi', 'objet', 'rare', 150000, 2, 'Escargophone capable de joindre un autre Den Den Mushi à l’autre bout de la mer.'],
        'vivre-card': ['Vivre Card', 'objet', 'rare', 50000, 0, 'Morceau de papier qui se déplace vers son propriétaire, et brûle quand sa vie s’éteint.'],
        lanterne: ['Lanterne', 'objet', 'commun', 3000, 1, 'Lanterne à huile, pour les grottes, les cales sombres et les fouilles de nuit.'],
        'lance-pierre': ['Lance-pierre', 'arme', 'commun', 5000, 0.3, 'Fronde en bois et caoutchouc. Ridicule en apparence, redoutable entre de bonnes mains.'],
        lance: ['Lance', 'arme', 'commun', 40000, 3, 'Longue hampe à pointe d’acier. Elle garde l’ennemi à distance.'],
        cola: ['Cola', 'conso', 'commun', 300, 1, 'Boisson pétillante et sucrée. Délicieuse, et carburant du moteur au cola.'],
        rhum: ['Rhum', 'conso', 'commun', 500, 1, 'Bouteille de rhum ambré. Indispensable à tout pirate qui se respecte.'],
        bombe: ['Bombe', 'conso', 'peu-commun', 8000, 0.8, 'Boule de fonte bourrée de poudre, avec sa mèche. Allumer, lancer, courir.'],
        fumigene: ['Fumigène', 'conso', 'commun', 4000, 0.3, 'Dégage un épais nuage de fumée. Parfait pour fuir, ou pour surprendre.'],
        'pieces-oxydees': ['Pièces oxydées', 'tresor', 'commun', 600, 0.05, 'Pièces anciennes couvertes de vert-de-gris. Un archéologue saurait leur rendre leur éclat.'],
        'piece-d-or-ancienne': ['Pièce d’or ancienne', 'tresor', 'commun', 5000, 0.05, 'Pièce frappée par un royaume disparu. Les collectionneurs se l’arrachent.'],
        perle: ['Perle', 'tresor', 'peu-commun', 20000, 0.02, 'Perle nacrée d’un éclat parfait, pêchée dans les eaux chaudes.'],
        'relique-abimee': ['Relique abîmée', 'tresor', 'peu-commun', 15000, 2, 'Objet ancien brisé et couvert de terre. Restauré, il vaudrait une fortune.'],
        'relique-ancienne': ['Relique ancienne', 'tresor', 'rare', 80000, 2, 'Objet d’une civilisation oubliée, soigneusement restauré.'],
        'lingot-d-or': ['Lingot d’or', 'tresor', 'rare', 100000, 1, 'Lingot d’or pur, frappé du sceau d’une banque de Grand Line.'],
        'collier-de-diamants': ['Collier de diamants', 'tresor', 'epique', 1000000, 0.1, 'Rivière de diamants digne d’une reine. De quoi attirer bien des convoitises.'],
      };
      await Promise.all(Object.entries(N).map(async ([id, [name, kind, rarity, value, weight, desc, heal]]) => {
        V[id] = [value, weight];
        if (catalog.items[id]) return;
        const item = normalizeItem({ name, kind, rarity, value, weight, desc, heal: heal || null });
        await write('items', id, item, null);
        catalog.items[id] = item;
      }));
      // Objets (en parallèle, pour rester sous la limite de temps de Vercel)
      const itemsDone = await Promise.all(Object.entries(V).map(async ([id, [value, weight]]) => {
        const row = await read('items', id);
        if (!row) return 0;
        const desc = D[id] && String(row.data.desc || '').trim().length < 30 ? D[id] : row.data.desc; // on garde les descriptions déjà écrites
        await write('items', id, { ...row.data, value, weight, desc }, row.version);
        return 1;
      }));
      // Recettes
      const blank = { job: null, lvl: 1, care: null, desc: '', game: null, work: null, gives: {}, needs: {}, tools: {}, seconds: 0 };
      const recDone = await Promise.all(Object.entries(R).map(async ([id, patch]) => {
        const row = await read('recipes', id);
        const base = row?.data || blank;
        const next = { ...base, ...patch, work: patch.work ? { ...(base.work || {}), ...patch.work } : base.work };
        await write('recipes', id, next, row?.version ?? null);
        return 1;
      }));
      // Boutiques : prix = valeur × variation de la ville, rachat 40 %, toutes les armes dans les armureries
      const shops = await readAll('shops');
      await Promise.all(Object.entries(shops).map(async ([key, s]) => {
        const f = F[key] ?? 1;
        const items = [...(s.items || [])];
        const has = (k) => items.some((x) => x[0] === k);
        const add = (k) => { if (!has(k)) items.push([k, 0, -1]); };
        if (items.some(([k]) => catalog.items[k]?.kind === 'arme')) WEAPONS.forEach(add);
        if (has('log-pose') || has('barque')) { add('chanvre'); add('tissu'); add('corde'); }
        if (has('log-pose')) ['cuir', 'herbes-medicinales', 'alcool-medical', 'fil-de-suture', 'lanterne', 'baby-den-den-mushi', 'den-den-mushi'].forEach(add); // marchés
        if (has('barque')) ['clous', 'fer'].forEach(add); // ports
        if (has('riz')) ['rhum', 'cola'].forEach(add); // nourriture
        const priced = items.filter(([k]) => catalog.items[k]).map(([k, , stock]) => [k, nice((V[k]?.[0] ?? catalog.items[k].value) * f), stock]);
        const row = await read('shops', key);
        await write('shops', key, { ...s, items: priced, buyRate: 0.4 }, row?.version ?? null);
      }));
      return { toast: `Grille appliquée : ${itemsDone.reduce((a, b) => a + b, 0)} objets, ${recDone.length} recettes, ${Object.keys(shops).length} boutiques. Rouvre l’app pour voir les nouveaux prix.` };
    }

    case 'shop.channels': {
      // Salons RP (déclarés et salons des bateaux) et posts ouverts de leurs forums, pour placer une boutique
      const list = (await read('meta', 'rp:channels'))?.data?.list || [];
      const { activeThreads } = await import('./_lib/discord.js');
      const threads = list.some((c) => c.kind === 'forum') ? await activeThreads() : [];
      return {
        channels: list
          .map((c) => ({
            id: String(c.id),
            name: c.name || String(c.id),
            kind: c.kind === 'forum' ? 'forum' : 'salon',
            posts: c.kind === 'forum' ? threads.filter((t) => t.parent_id === String(c.id)).map((t) => ({ id: t.id, name: t.name })).sort((a, b) => a.name.localeCompare(b.name)) : [],
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      };
    }

    case 'shops':
      return { shops: await readAll('shops') };

    case 'shop.save': {
      need(body.channelId && body.shop, 400, 'Boutique manquante.');
      const channelId = String(body.channelId).trim();
      // On retrouve le vrai salon à partir de son ID : pas besoin de taper son nom.
      const ch = await channelById(channelId);
      need(ch, 400, 'Salon introuvable : vérifie l’ID (clic droit sur le salon > Copier l’identifiant) et que le bot voit ce salon.');
      need(!env.guildId || !ch.guildId || ch.guildId === env.guildId, 400, 'Ce salon n’est pas sur le serveur principal.');
      const shop = normalizeShop({ ...body.shop });
      shop.items = shop.items.filter(([k]) => ITEMS[k]);
      need(new Set(shop.items.map((x) => x[0])).size === shop.items.length, 400, 'Un même objet apparaît deux fois.');
      shop.name = String(shop.name || 'Comptoir').slice(0, 60);
      shop.seller = String(shop.seller || 'Le marchand').slice(0, 40);
      shop.face = String(shop.face || '').slice(0, 8);
      shop.channel = `#${ch.name}`;
      shop.img = shop.img ? await ingest(shop.img, 'vendeurs', channelId) : null;
      const from = body.from && body.from !== channelId ? String(body.from) : null;
      if (from) void 0; // plusieurs boutiques par salon : plus de blocage
      // Plusieurs boutiques par salon : clés « salon », « salon~2 », « salon~3 »…
      const prev = body.from ? String(body.from) : null;
      const same = prev && prev.split('~')[0] === channelId;
      return retry(async () => {
        let key = same ? prev : channelId;
        if (!same) for (let n = 2; await read('shops', key); n++) key = `${channelId}~${n}`;
        const row = await read('shops', key);
        await write('shops', key, shop, row?.version ?? null);
        if (prev && !same) await remove('shops', prev);
        return { channelId: key, shop, toast: prev && !same ? `Boutique déplacée vers #${ch.name}` : `Boutique de #${ch.name} enregistrée` };
      });
    }

    case 'shop.delete':
      need(body.channelId, 400, 'Salon manquant.');
      await remove('shops', body.channelId);
      return { shop: null, toast: 'Boutique fermée' };

    case 'cooks': {
      // Toutes les recettes de cuisine des joueurs
      const list = [];
      for (const [uid, p] of Object.entries(await readAll('players'))) for (const r of p.cook || []) list.push({ uid, player: fullName(p), recipe: r });
      list.sort((a, b) => (b.recipe.at || 0) - (a.recipe.at || 0));
      return { list };
    }
    case 'cook.validate': {
      // Recette de cuisine validée (son plat devient un objet du catalogue) ou refusée avec un motif
      need(body.target && body.id != null, 400, 'Recette manquante.');
      return retry(async () => {
        const row = await read('players', String(body.target));
        need(row, 404, 'Joueur introuvable.');
        const p = row.data;
        const r = (p.cook || []).find((x) => Number(x.id) === Number(body.id));
        need(r, 404, 'Recette introuvable.');
        if (body.ok) {
          const old = r.item && catalog.items[r.item] ? catalog.items[r.item] : { value: 0, weight: 0.5 };
          const item = normalizeItem({ ...old, name: r.name, kind: 'plat', desc: String(r.desc || '').slice(0, 400), img: r.photo || old.img || null });
          const id = r.item && catalog.items[r.item] ? r.item : freeId(r.name, catalog.items);
          const irow = await read('items', id);
          await write('items', id, item, irow?.version ?? null);
          catalog.items[id] = item;
          Object.assign(r, { item: id, ok: true, refused: null });
        } else {
          Object.assign(r, { ok: false, refused: { reason: String(body.reason || 'Sans motif précisé.').slice(0, 300), at: Date.now() } });
        }
        await write('players', String(body.target), p, row.version);
        return { catalog, toast: body.ok ? `Recette validée : ${r.name} (le plat est ajouté au catalogue)` : `Recette refusée : ${r.name}` };
      });
    }

    case 'item.save': {
      const item = normalizeItem(body.item || {});
      const id = body.id && catalog.items[body.id] ? body.id : freeId(item.name, catalog.items);
      item.img = item.img ? await ingest(item.img, 'objets', id) : null;
      return retry(async () => {
        const row = await read('items', id);
        await write('items', id, item, row?.version ?? null);
        catalog.items[id] = item;
        return { id, catalog, toast: row ? `Objet modifié : ${item.name}` : `Objet créé : ${item.name}` };
      });
    }

    case 'item.delete': {
      need(catalog.items[body.id], 404, 'Objet introuvable.');
      const used = Object.values(catalog.recipes).filter((r) => r.needs[body.id] || r.gives[body.id]).map(recipeLabel);
      need(!used.length, 400, `Utilisé par la recette : ${used.join(', ')}. Modifie-la d’abord.`);
      await remove('items', body.id);
      delete catalog.items[body.id];
      return { catalog, toast: 'Objet supprimé. Les joueurs qui le possèdent le verront comme « Objet supprimé ».' };
    }

    case 'recipe.save': {
      const recipe = normalizeRecipe(body.recipe || {});
      const id = body.id && catalog.recipes[body.id] ? body.id : freeId(recipeLabel(recipe), catalog.recipes);
      return retry(async () => {
        const row = await read('recipes', id);
        await write('recipes', id, recipe, row?.version ?? null);
        catalog.recipes[id] = recipe;
        return { id, catalog, toast: row ? `Recette modifiée : ${recipeLabel(recipe)}` : `Recette créée : ${recipeLabel(recipe)}` };
      });
    }

    case 'recipe.delete': {
      need(catalog.recipes[body.id], 404, 'Recette introuvable.');
      await remove('recipes', body.id);
      delete catalog.recipes[body.id];
      return { catalog, toast: 'Recette supprimée' };
    }

    default:
      need(false, 400, 'Opération inconnue.');
  }
});
