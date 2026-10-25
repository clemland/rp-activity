/**
 * POST /api/bot { op, ... } : appels du bot Discord (protégés par BOT_API_SECRET).
 * Le bot vérifie lui-même que l'auteur d'une commande staff fait partie du staff.
 *  - register { userId, name, race, job, classe, by } : /register, crée la fiche d'un joueur
 *  - open { userId, mode, target? }                  : /panel admin ou /edit profil
 *  - delete { userId, by }                           : /delete profil
 *  - rp.channels / rp.channel.add / rp.channel.remove : salons RP
 *  - rp.message { userId, channelId, parentId, name, length } : un message dans un salon RP
 *  - ships.config / ships.config.set { forumId?, categoryId? } : /bateau config
 *  - ships.mine { userId }                           : bateaux dont il gère les salons (/bateau salon, /bateau post)
 *  - ship.channel.set { userId, shipId, channelId, kind, name } : enregistre le salon créé pour un bateau
 */
import { handler, need } from './_lib/http.js';
import { env } from './_lib/env.js';
import { staffPerms } from './_lib/discord.js';
import { shipEmbed } from './_lib/shipchan.js';
import { read, readAll, write, remove, retry } from './_lib/db.js';
import { newPlayer, fullName, normalize, normalizeCrew, normalizeShip, rpMessage, canManageShipChannels, RP_DAILY, RP_MIN_CHARS, normalizeLoot, lootTableAt, rollLoot, islandOf, addItem, itemOf, rarityOf, voyageStep, dockShip, rankName, shipStats, crossing } from '../shared/game.js';
import { loadCatalog, loadMap } from './_lib/context.js';

const RP_KEY = 'rp:channels';
const SHIPS_KEY = 'ships:config';

async function rpChannels() {
  const row = await read('meta', RP_KEY);
  return { list: row?.data.list || [], version: row?.version ?? null };
}
/** Modifie la liste des salons RP (avec réessai en cas d'écriture simultanée). */
const rpSet = (fn) =>
  retry(async () => {
    const { list, version } = await rpChannels();
    const next = fn(list);
    await write('meta', RP_KEY, { list: next }, version);
    return next;
  });

/** Bateaux dont ce joueur peut gérer les salons : les siens, et ceux de son équipage s'il en a le droit. */
async function shipsOf(userId) {
  const row = await read('players', userId);
  need(row, 404, 'Tu n’as pas de fiche : demande à un MJ de t’enregistrer avec /register.');
  const player = normalize(row.data);
  let crew = null;
  if (player.crewId) {
    const c = await read('crews', player.crewId);
    if (c) crew = { id: player.crewId, ...normalizeCrew(c.data) };
  }
  return Object.entries(await readAll('ships'))
    .map(([id, s]) => ({ id, ...normalizeShip(s) }))
    .filter((s) => canManageShipChannels(player, s, crew))
    .map((s) => ({ ...s, ownerLabel: s.owner?.kind === 'crew' ? crew?.name : fullName(player) }));
}

export default handler(['POST'], async (req, body) => {
  need(env.botSecret && req.headers['x-bot-secret'] === env.botSecret, 401, 'Secret du bot invalide.');

  switch (body.op) {
    case 'register': {
      need(body.userId, 400, 'Joueur manquant.');
      const exists = await read('players', body.userId);
      need(!exists, 409, `Ce joueur a déjà une fiche (${fullName(exists?.data)}).`);
      const player = newPlayer(body.userId, body);
      await write('players', body.userId, player, null);
      if (body.by) console.log(`[staff] ${body.by} a enregistré ${body.userId}`);
      return { player };
    }

    case 'open': {
      const mode = body.mode === 'admin' ? 'admin' : 'edit';
      need(body.userId && (mode === 'admin' || body.target), 400, 'Demande incomplète.');
      if (mode === 'edit') need(await read('players', body.target), 404, 'Ce joueur n’a pas de fiche : enregistre-le d’abord avec /register.');
      return retry(async () => {
        const row = await read('meta', `open:${body.userId}`);
        await write('meta', `open:${body.userId}`, { mode, target: body.target || null, at: Date.now() }, row?.version ?? null);
        return { ok: true };
      });
    }

    case 'delete': {
      need(body.userId, 400, 'Joueur manquant.');
      const row = await read('players', body.userId);
      need(row, 404, 'Ce joueur n’a pas de fiche.');
      await remove('players', body.userId);
      if (body.by) console.log(`[staff] ${body.by} a supprimé la fiche de ${body.userId} (${fullName(row.data)})`);
      return { name: fullName(row.data) };
    }

    case 'export.economy': {
      // /export economie : tout ce qui touche à l'économie, sans les images
      const GMe = await import('../shared/game.js');
      const { loadCatalog } = await import('./_lib/context.js');
      await loadCatalog();
      const light = (o) => Object.fromEntries(Object.entries(o || {}).filter(([k]) => !['img', 'icon', 'photo'].includes(k)).map(([k, v]) => [k, k === 'desc' ? String(v || '').slice(0, 120) : v]));
      const players = Object.values(await readAll('players'));
      const b = players.map((p) => Number(p.berry) || 0).sort((x, y) => x - y);
      const grades = Object.entries(GMe).filter(([, v]) => Array.isArray(v) && v.length && v[0] && typeof v[0] === 'object' && 'pay' in v[0]);
      return {
        exportedAt: new Date().toISOString(),
        items: Object.fromEntries(Object.entries(GMe.ITEMS).map(([k, it]) => [k, light(it)])),
        recipes: GMe.RECIPES,
        shops: Object.fromEntries(Object.entries(await readAll('shops')).map(([k, s]) => [k, light(s)])),
        salaries: Object.fromEntries(grades),
        shipCfg: GMe.SHIPCFG,
        economy: { players: players.length, berries: { min: b[0] ?? 0, median: b[Math.floor(b.length / 2)] ?? 0, max: b[b.length - 1] ?? 0, total: b.reduce((s, x) => s + x, 0) } },
      };
    }

    case 'shops.list': {
      // /boutiques annoncer : toutes les boutiques regroupées par salon, avec leurs objets en vente
      const GMs = await import('../shared/game.js');
      const { loadCatalog } = await import('./_lib/context.js');
      await loadCatalog();
      const by = {};
      for (const [key, s0] of Object.entries(await readAll('shops'))) {
        const s = GMs.normalizeShop({ ...s0 });
        (by[key.split('~')[0]] ??= []).push({
          name: s.name, seller: s.seller, face: s.face || '', img: s.img || null,
          items: s.items.filter(([k]) => GMs.ITEMS[k]).map(([k, price, stock]) => ({ name: GMs.ITEMS[k].name, price, stock })),
        });
      }
      return { channels: Object.entries(by).map(([id, shops]) => ({ id, shops })) };
    }

    case 'group': {
      // /fiche groupe : équipage ou escouade d'un joueur (logo, banque commune, bateau attribué, membres et grades)
      need(body.userId, 400, 'Joueur manquant.');
      const row = await read('players', String(body.userId));
      need(row, 404, 'Ce joueur n’a pas de fiche.');
      need(row.data.crewId, 404, 'Ce joueur ne fait partie d’aucun équipage ni d’aucune escouade.');
      const c = await read('crews', row.data.crewId);
      need(c, 404, 'Équipage introuvable.');
      const cr = normalizeCrew(c.data);
      const members = [];
      for (const uid of cr.members) {
        const npc = cr.npcs?.[uid];
        const prow = npc ? null : await read('players', uid);
        members.push({ name: npc ? `${npc.name} (PNJ)` : prow?.data?.id?.name || 'Fiche supprimée', rank: rankName(cr, uid), captain: uid === cr.captain });
      }
      members.sort((a, b) => b.captain - a.captain);
      let ship = null;
      if (cr.ship) {
        const s = await read('ships', cr.ship);
        if (s) ship = { name: s.data.name, type: s.data.type || '', photo: s.data.photo || s.data.icon || null };
      }
      return { crew: { name: cr.name, kind: cr.kind, flag: cr.flag || null, bank: cr.bank ?? cr.berry ?? 0, members, ship } };
    }

    case 'profile': {
      // /fiche : la fiche d'un joueur et son équipage (nom, type, grade), pour dessiner l'image
      need(body.userId, 400, 'Joueur manquant.');
      const row = await read('players', String(body.userId));
      need(row, 404, 'Ce joueur n’a pas de fiche.');
      const p = normalize(row.data);
      let crew = null;
      if (p.crewId) {
        const c = await read('crews', p.crewId);
        if (c) {
          const cr = normalizeCrew(c.data);
          crew = { name: cr.name, kind: cr.kind, rank: rankName(cr, p.uid) };
        }
      }
      return { player: p, crew };
    }

    case 'ship.channel.deleted': {
      // Le salon d'un bateau a été supprimé : on l'oublie, et un voyage en cours est annulé (retour au port de départ)
      need(body.channelId, 400, 'Salon manquant.');
      const cid = String(body.channelId), names = [];
      for (const [sid, raw] of Object.entries(await readAll('ships'))) {
        if (String(raw.channel?.id || '') !== cid) continue;
        await retry(async () => {
          const r = await read('ships', sid);
          const sh = normalizeShip(r.data);
          if (sh.voyage) {
            if (!sh.position && sh.voyage.port) sh.position = sh.voyage.port;
            sh.voyage = null;
          }
          sh.channel = null;
          await write('ships', sid, sh, r.version);
        });
        names.push(raw.name);
      }
      return { ships: names };
    }

    case 'ship.embed': {
      // Fiche du bateau pour le premier message de son salon (/bateau salon)
      const row = await read('ships', String(body.shipId || ''));
      need(row, 404, 'Bateau introuvable.');
      return { embed: await shipEmbed(normalizeShip(row.data)) };
    }

    case 'perms':
      // Permissions staff d'un membre, pour les commandes du bot
      need(body.userId, 400, 'Membre manquant.');
      return { perms: await staffPerms(String(body.userId)) };

    case 'rp.channels':
      return { channels: (await rpChannels()).list };

    case 'rp.channel.add':
    case 'rp.channel.remove': {
      need(body.channelId, 400, 'Salon manquant.');
      const id = String(body.channelId);
      const next = await rpSet((list) => {
        const rest = list.filter((c) => c.id !== id);
        return body.op === 'rp.channel.add'
          ? [...rest, { id, name: String(body.name || '').slice(0, 100), kind: body.kind === 'forum' ? 'forum' : 'salon', by: body.by || null, at: Date.now() }]
          : rest;
      });
      return { channels: next };
    }

      case 'rp.message': {
      need(body.userId && body.channelId, 400, 'Message incomplet.');
      const row = await read('players', body.userId);
      if (!row) return { noProfile: true }; // pas de fiche : rien à compter
      // Exploration : un tirage par message RP assez long, selon le butin du post, du salon ou de l'île
      let drop = null;
      if ((Number(body.length) || 0) >= RP_MIN_CHARS) {
        const loot = normalizeLoot((await read('meta', 'loot'))?.data || {});
        // En mer : les messages RP écrits à bord d'un bateau en voyage pêchent dans la table « Pleine mer »
        const here = [String(body.channelId), body.parentId ? String(body.parentId) : null].filter(Boolean);
        const atSea = loot.tables.mer && Object.values(await readAll('ships')).some((s) => s.voyage?.status === 'sea' && s.channel?.id && here.includes(String(s.channel.id)));
        if (atSea) {
          await loadCatalog();
          drop = rollLoot(loot.tables.mer);
        } else if (Object.keys(loot.places).length) {
          await loadCatalog();
          const pos = { channelId: String(body.channelId), parentId: body.parentId ? String(body.parentId) : null };
          const islandId = Object.keys(loot.places).some((k) => k.startsWith('isl:')) ? islandOf((await loadMap()).map, pos) : null;
          drop = rollLoot(lootTableAt(loot, { ...pos, islandId }));
        }
      }
      const res = await retry(async () => {
        const fresh = await read('players', body.userId);
        const r = rpMessage(normalize(fresh.data), { channelId: body.channelId, parentId: body.parentId || null, name: body.name, length: Number(body.length) || 0 });
        const added = drop ? addItem(r.player, drop.key, drop.qty) : false;
        if (r.player.position?.channelId !== fresh.data.position?.channelId || r.counted || added) await write('players', body.userId, r.player, fresh.version);
        const found = drop ? { key: drop.key, qty: drop.qty, name: itemOf(drop.key).name, rarity: rarityOf(drop.key).name, color: rarityOf(drop.key).color, full: !added } : null;
        return { counted: r.counted, xp: r.xp, count: r.count, max: RP_DAILY, limit: r.limit, ups: r.ups, level: r.player.level, name: fullName(r.player), found };
      });
      // Découverte : écrire un message RP sur une île la fait découvrir (elle reste sur la carte du joueur)
      if ((Number(body.length) || 0) >= RP_MIN_CHARS) {
        const isl = islandOf((await loadMap()).map, { channelId: String(body.channelId), parentId: body.parentId ? String(body.parentId) : null });
        if (isl) {
          await retry(async () => {
            const r = await read('players', body.userId);
            if (!r || (r.data.discovered || []).includes(isl)) return;
            await write('players', body.userId, { ...r.data, discovered: [...(r.data.discovered || []), isl] }, r.version);
          });
        }
      }
      // Écrire en RP dans le salon d'un bateau (ou un de ses posts) fait monter à bord automatiquement
      if ((Number(body.length) || 0) >= RP_MIN_CHARS) {
        const hereIds = [String(body.channelId), body.parentId ? String(body.parentId) : null].filter(Boolean);
        const all = await readAll('ships');
        const target = Object.entries(all).find(([, s]) => s.channel?.id && hereIds.includes(String(s.channel.id)));
        const atSeaElsewhere = Object.entries(all).some(([id, s]) => id !== target?.[0] && s.voyage?.status === 'sea' && (s.passengers || []).includes(body.userId));
        if (target && !atSeaElsewhere && !(target[1].passengers || []).includes(body.userId)) {
          const [sid] = target;
          // On descend d'abord des autres bateaux (à quai)
          for (const [oid, o] of Object.entries(all)) {
            if (oid === sid || !(o.passengers || []).includes(body.userId)) continue;
            await retry(async () => {
              const r = await read('ships', oid);
              if (!r) return;
              await write('ships', oid, { ...r.data, passengers: (r.data.passengers || []).filter((u) => u !== body.userId) }, r.version);
            });
          }
          await retry(async () => {
            const r = await read('ships', sid);
            if (!r) return;
            const sh = normalizeShip(r.data);
            if (sh.passengers.includes(body.userId)) return;
            const max = Number(sh.berths ?? r.data.berths) || 0;
            if (max && sh.passengers.length >= max) return; // plus de place
            sh.passengers = [...sh.passengers, body.userId];
            await write('ships', sid, sh, r.version);
            res.boarded = sh.name;
          });
        }
      }
      // Bateau à quai nulle part (acheté ou fabriqué avant d'avoir écrit en RP, ou créé par le staff) :
      // il se met à quai là où son propriétaire écrit son prochain message RP (jamais dans le salon d'un bateau)
      if ((Number(body.length) || 0) >= RP_MIN_CHARS) {
        const here = { channelId: String(body.channelId), parentId: body.parentId ? String(body.parentId) : null, name: String(body.name || '').slice(0, 60) };
        const all = await readAll('ships');
        const shipChans = new Set(Object.values(all).map((s) => s.channel?.id && String(s.channel.id)).filter(Boolean));
        const inShipChannel = shipChans.has(here.channelId) || (here.parentId && shipChans.has(here.parentId));
        const crewId = row.data.crewId || null;
        if (!inShipChannel) {
          for (const [sid, raw] of Object.entries(all)) {
            if (raw.position?.channelId || raw.voyage) continue;
            const mine = raw.owner?.kind === 'player' ? raw.owner.id === body.userId : raw.owner?.kind === 'crew' && !!crewId && raw.owner.id === crewId;
            if (!mine) continue;
            await retry(async () => {
              const r = await read('ships', sid);
              if (!r || r.data.position?.channelId || r.data.voyage) return;
              await write('ships', sid, { ...r.data, position: here }, r.version);
            });
            res.docked = { ship: raw.name, where: here.name };
          }
        }
      }
      res.name = row.data?.id?.name || null; // nom du personnage (annonce des scènes par le bot)
      // Navigation : une action RP d'un passager dans le salon du bateau fait avancer le voyage ;
      // à l'arrivée, le premier passager qui écrit sur l'île de destination met le bateau à quai.
      if ((Number(body.length) || 0) >= RP_MIN_CHARS) {
        const here = { channelId: String(body.channelId), parentId: body.parentId ? String(body.parentId) : null, name: String(body.name || '').slice(0, 60) };
        let carte = null;
        for (const [sid, raw] of Object.entries(await readAll('ships'))) {
          const v = raw.voyage;
          if (!v || !(raw.passengers || []).includes(body.userId)) continue;
          const inShip = !!raw.channel?.id && [here.channelId, here.parentId].includes(String(raw.channel.id));
          if (v.status === 'sea' && inShip) {
            const s = await retry(async () => {
              const r = await read('ships', sid);
              const sh = normalizeShip(r.data);
              if (sh.voyage?.status !== 'sea') return null;
              voyageStep(sh);
              await write('ships', sid, sh, r.version);
              return sh;
            });
            if (s) res.voyage = { ship: s.name, done: s.voyage.done, needed: s.voyage.needed, to: s.voyage.unknown && s.voyage.status !== 'arrived' ? '???' : s.voyage.toName, arrived: s.voyage.status === 'arrived' };
            // Rencontre en mer : deux bateaux sur la même route, au même endroit, s'arrêtent tous les deux
            if (s && s.voyage.status === 'sea' && !s.voyage.encounter) {
              for (const [oid, o0] of Object.entries(await readAll('ships'))) {
                if (oid === sid) continue;
                const o = normalizeShip(o0);
                if (!crossing(s, sid, o, oid)) continue;
                const meet = (id, otherId, other) => retry(async () => {
                  const r = await read('ships', id);
                  const sh = normalizeShip(r.data);
                  if (sh.voyage?.status !== 'sea' || sh.voyage.encounter) return false;
                  sh.voyage.encounter = { with: otherId, withName: other.name, withChannel: other.channel?.id || null, alongside: false, at: Date.now() };
                  sh.voyage.met = [...(sh.voyage.met || []), otherId];
                  await write('ships', id, sh, r.version);
                  return true;
                });
                if (!(await meet(sid, oid, o))) break;
                await meet(oid, sid, s);
                res.encounter = { ship: s.name, other: o.name };
                const { postMessage } = await import('./_lib/discord.js');
                const txt = (mine, other) => `⛵ **Un navire est en vue : ${other} !** ${mine} s’arrête. Ouvrez l’app (écran Navigation) pour accoster ou reprendre la mer.`;
                if (s.channel?.id) await postMessage(s.channel.id, txt(s.name, o.name));
                if (o.channel?.id) await postMessage(o.channel.id, txt(o.name, s.name));
                break;
              }
            }
          } else if (v.status === 'arrived' && !inShip) {
            carte ??= (await loadMap()).map;
            if (islandOf(carte, here) !== v.to) continue;
            let wear = 0;
            const s = await retry(async () => {
              const r = await read('ships', sid);
              const sh = normalizeShip(r.data);
              if (sh.voyage?.status !== 'arrived') return null;
              dockShip(sh, here, carte, Date.now());
              // Usure du voyage : la coque perd 1 à 3 % de sa vie maximale
              const st = shipStats(sh);
              wear = 1 + Math.floor(Math.random() * 3);
              sh.hull = Math.max(0, st.hull - Math.ceil((st.hullMax * wear) / 100));
              await write('ships', sid, sh, r.version);
              return sh;
            });
            if (s) {
              res.docked = { ship: s.name, where: wear ? `${here.name} (la coque a souffert : −${wear} %)` : here.name, wear };
              // Les passagers découvrent l'île : elle apparaît sur leur carte
              for (const uid of s.passengers) {
                await retry(async () => {
                  const r = await read('players', uid);
                  if (!r || (r.data.discovered || []).includes(v.to)) return;
                  await write('players', uid, { ...r.data, discovered: [...(r.data.discovered || []), v.to] }, r.version);
                });
              }
            }
          }
        }
      }
      // Désactivé : on ne descend plus du bord en écrivant ailleurs (bouton « Descendre » seulement)
      if (false) {
        const here = [String(body.channelId), body.parentId ? String(body.parentId) : null];
        for (const [sid, sh] of Object.entries(await readAll('ships'))) {
          if (!(sh.passengers || []).includes(body.userId)) continue;
          // Bord à bord avec un autre bateau : écrire dans son salon ne fait pas passer par-dessus bord
          const stays = [sh.channel?.id, sh.position?.channelId, sh.voyage?.encounter?.withChannel].some((c) => c && here.includes(String(c)));
          if (stays) continue;
          await retry(async () => {
            const r = await read('ships', sid);
            if (r) await write('ships', sid, { ...r.data, passengers: (r.data.passengers || []).filter((u) => u !== body.userId) }, r.version);
          });
          res.leftShip = sh.name;
        }
      }
      return res;
    }

    case 'ships.config':
      return { config: (await read('meta', SHIPS_KEY))?.data || {} };

    case 'ships.config.set':
      return retry(async () => {
        const row = await read('meta', SHIPS_KEY);
        const config = { ...(row?.data || {}) };
        if (body.forumId !== undefined) config.forumId = body.forumId || null;
        if (body.categoryId !== undefined) config.categoryId = body.categoryId || null;
        await write('meta', SHIPS_KEY, config, row?.version ?? null);
        return { config };
      });

    case 'ships.mine': {
      need(body.userId, 400, 'Joueur manquant.');
      const [ships, cfg] = await Promise.all([shipsOf(body.userId), read('meta', SHIPS_KEY)]);
      return { ships, config: cfg?.data || {} };
    }

    case 'ship.channel.set': {
      need(body.userId && body.shipId && body.channelId, 400, 'Demande incomplète.');
      const mine = await shipsOf(body.userId);
      need(mine.some((s) => s.id === body.shipId), 403, 'Tu ne gères pas les salons de ce bateau.');
      const kind = body.kind === 'forum' ? 'forum' : 'post';
      const ship = await retry(async () => {
        const r = await read('ships', body.shipId);
        need(r, 404, 'Bateau introuvable.');
        const s = normalizeShip(r.data);
        s.channel = { id: String(body.channelId), kind, name: String(body.name || s.name).slice(0, 100) };
        await write('ships', body.shipId, s, r.version);
        return s;
      });
      // Le salon du bateau devient un salon RP (un forum : chacun de ses posts compte)
      await rpSet((list) => [
        ...list.filter((c) => c.id !== ship.channel.id),
        { id: ship.channel.id, name: ship.channel.name, kind: kind === 'forum' ? 'forum' : 'salon', by: body.userId, at: Date.now() },
      ]);
      return { ship: { id: body.shipId, ...ship } };
    }

    default:
      need(false, 400, 'Opération inconnue.');
  }
});