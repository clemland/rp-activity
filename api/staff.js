/**
 * POST /api/staff { op, ... } : outils réservés au staff.
 *  - players                              : liste des fiches
 *  - act { target, action }                : modifier la fiche d'un joueur
 *  - bulk { targets, action }              : la même action sur plusieurs joueurs (XP, niveaux, berrys, objets)
 *  - shops                                    : toutes les boutiques
 *  - shop.save { channelId, from?, shop }      : enregistre la boutique du salon channelId (déplacée depuis « from » si l'ID a changé)
 *  - shop.delete { channelId }
 *  - item.save { id?, item } / item.delete { id }        : base d'objets
 *  - recipe.save { id?, recipe } / recipe.delete { id }  : recettes de fabrication
 */
import { handler, need } from './_lib/http.js';
import { userFromRequest, isStaff, channelById } from './_lib/discord.js';
import { env } from './_lib/env.js';
import { read, readAll, write, remove, retry, listPlayers } from './_lib/db.js';
import { ingest } from './_lib/media.js';
import { loadCatalog } from './_lib/context.js';
import { normalize, normalizeShop, normalizeItem, normalizeRecipe, staffAction, slug, ITEMS } from '../shared/game.js';

/** Identifiant libre à partir du nom (« planche-de-chene », « planche-de-chene-2 »…). */
function freeId(base, taken) {
  let id = slug(base), n = 2;
  while (taken[id]) id = `${slug(base)}-${n++}`;
  return id;
}

export default handler(['POST'], async (req, body) => {
  const me = await userFromRequest(req);
  need(await isStaff(me.uid), 403, 'Réservé au staff.');
  const catalog = await loadCatalog();

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
      const used = Object.values(catalog.recipes).filter((r) => r.needs[body.id] || r.gives[body.id]).map((r) => r.name);
      need(!used.length, 400, `Utilisé par la recette : ${used.join(', ')}. Modifie-la d’abord.`);
      await remove('items', body.id);
      delete catalog.items[body.id];
      return { catalog, toast: 'Objet supprimé. Les joueurs qui le possèdent le verront comme « Objet supprimé ».' };
    }

    case 'recipe.save': {
      const recipe = normalizeRecipe(body.recipe || {});
      const id = body.id && catalog.recipes[body.id] ? body.id : freeId(recipe.name, catalog.recipes);
      return retry(async () => {
        const row = await read('recipes', id);
        await write('recipes', id, recipe, row?.version ?? null);
        catalog.recipes[id] = recipe;
        return { id, catalog, toast: row ? `Recette modifiée : ${recipe.name}` : `Recette créée : ${recipe.name}` };
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
