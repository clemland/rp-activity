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
      return { features: map.features || {} };
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
      if (!old && !ship.channel && ship.space !== 'none') {
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
      return { id, ship, toast: old ? `Bateau modifié : ${ship.name}` : `Bateau créé : ${ship.name}${ship.channel ? ` · salon ${ship.channel.name} créé` : chanNote}` };
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
      if (from) need(!(await read('shops', channelId)), 409, `Il y a déjà une boutique dans #${ch.name}.`);
      return retry(async () => {
        const row = await read('shops', channelId);
        await write('shops', channelId, shop, row?.version ?? null);
        if (from) await remove('shops', from);
        return { channelId, shop, toast: from ? `Boutique déplacée vers #${ch.name}` : `Boutique de #${ch.name} enregistrée` };
      });
    }

    case 'shop.delete':
      need(body.channelId, 400, 'Salon manquant.');
      await remove('shops', body.channelId);
      return { shop: null, toast: 'Boutique fermée' };

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
