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
 *  - item.save { id?, item } / item.delete { id }        : base d'objets
 *  - recipe.save { id?, recipe } / recipe.delete { id }  : recettes de fabrication
 */
import { handler, need } from './_lib/http.js';
import { userFromRequest, isStaff, channelById } from './_lib/discord.js';
import { env } from './_lib/env.js';
import { read, readAll, write, remove, retry, listPlayers } from './_lib/db.js';
import { ingest } from './_lib/media.js';
import { loadCatalog } from './_lib/context.js';
import { recipeLabel, normalize, normalizeShop, normalizeItem, normalizeRecipe, normalizeCrew, normalizeShip, newShip, staffAction, slug, ITEMS } from '../shared/game.js';

/** Identifiant libre à partir du nom (« planche-de-chene », « planche-de-chene-2 »…). */
function freeId(base, taken) {
  let id = slug(base), n = 2;
  while (taken[id]) id = `${slug(base)}-${n++}`;
  return id;
}

export default handler(['POST'], async (req, body) => {
  const me = await userFromRequest(req);
  need(await isStaff(me.uid), 403, 'Réservé au staff.');
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
      need(['xp', 'levels', 'berry', 'give', 'take'].includes(body.action?.type), 400, 'Action non disponible en groupe.');
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
        if (before.has(uid)) continue;
        await retry(async () => {
          const row = await read('players', uid);
          need(row, 404, `Le joueur ${uid} n’a pas de fiche.`);
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
        if (after.has(uid)) continue;
        await retry(async () => {
          const row = await read('players', uid);
          if (row && row.data.crewId === id) await write('players', uid, { ...row.data, crewId: null }, row.version);
        });
      }
      await retry(async () => {
        const row = await read('crews', id);
        await write('crews', id, crew, row?.version ?? null);
      });
      return { id, crew, toast: old ? `Équipage modifié : ${crew.name}` : `Équipage créé : ${crew.name}` };
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
          input.position = { channelId: pid, name: ch.name };
        } else input.position = null;
        delete input.positionId;
      }
      const ships = await readAll('ships');
      const id = body.id && ships[body.id] ? body.id : freeId(input.name || 'bateau', ships);
      const old = ships[id] || null;
      const ship = old ? normalizeShip({ ...old, ...input }) : newShip(input);
      if (input.photo !== undefined) ship.photo = input.photo ? await ingest(input.photo, 'bateaux', id) : null;
      // Si le bateau quitte un équipage, celui-ci n'a plus de bateau attitré.
      if (old?.owner?.kind === 'crew' && (ship.owner?.kind !== 'crew' || ship.owner.id !== old.owner.id)) {
        const c = await read('crews', old.owner.id);
        if (c && c.data.ship === id) await write('crews', old.owner.id, { ...c.data, ship: null }, c.version);
      }
      await retry(async () => {
        const row = await read('ships', id);
        await write('ships', id, ship, row?.version ?? null);
      });
      return { id, ship, toast: old ? `Bateau modifié : ${ship.name}` : `Bateau créé : ${ship.name}` };
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
