/** Chargement commun : fiche, boutique du salon, catalogue d'objets et de recettes. */
import { normalize, normalizeShop, normalizeCrew, normalizeShip, normalizeMap, setCatalog, fullName, canManageShip } from '../../shared/game.js';
import { read, readAll, readMany, db } from './db.js';
import { channelName } from './discord.js';
import { HttpError } from './http.js';

/** Fiche du joueur, ou null s'il n'est pas encore enregistré (/register). */
export async function findPlayer(uid) {
  const row = await read('players', uid);
  return row ? { player: normalize(row.data), version: row.version } : null;
}
export async function loadPlayer(uid) {
  const found = await findPlayer(uid);
  if (!found) throw new HttpError(404, 'Pas encore de fiche : demande à un MJ de t’enregistrer avec /register.');
  return found;
}

export async function loadShop(channelId) {
  if (!channelId) return { shop: null, version: null };
  const row = await read('shops', channelId);
  return row ? { shop: normalizeShop(row.data), version: row.version } : { shop: null, version: null };
}

/**
 * Objets et recettes du staff ; à charger avant d'appliquer une règle du jeu.
 * Gardé 20 s en mémoire pour les actions des joueurs (une modif du staff met
 * donc jusqu'à 20 s à s'appliquer aux règles) ; le staff et l'affichage lisent
 * toujours la version fraîche (fresh: true).
 */
let catalogCache = null;
export async function loadCatalog({ fresh = false } = {}) {
  if (!fresh && catalogCache && Date.now() - catalogCache.at < 20_000) {
    setCatalog(catalogCache.catalog);
    return catalogCache.catalog;
  }
  const [items, recipes] = await Promise.all([readAll('items'), readAll('recipes')]);
  const catalog = { items, recipes };
  catalogCache = { at: Date.now(), catalog };
  setCatalog(catalog);
  return catalog;
}

export async function channelInfo(channelId) {
  return { channelId: channelId || null, channelName: channelId ? await channelName(channelId) : '' };
}

/** Ce que voit le site : on ne renvoie pas les champs internes. */
export const publicPlayer = (p) => p;

/**
 * Équipage du joueur et bateaux qu'il peut voir (les siens et ceux de son équipage).
 * Renvoie { crew, crewVersion, ships: { id: ship }, shipVersions, memberNames }.
 */
export async function loadCrewAndShips(player) {
  const out = { crew: null, crewVersion: null, ships: {}, shipVersions: {}, memberNames: {} };
  const shipsQuery = db().from('ships').select('id, data, version'); // lancée tout de suite, en parallèle
  if (player.crewId) {
    const row = await read('crews', player.crewId);
    if (row) {
      out.crew = { id: player.crewId, ...normalizeCrew(row.data) };
      out.crewVersion = row.version;
      const uids = [...out.crew.members, ...out.crew.invites.map((i) => i.uid)];
      const members = await readMany('players', uids);
      for (const uid of uids) out.memberNames[uid] = members[uid] ? fullName(members[uid].data) : 'Fiche supprimée';
    }
  }
  const { data, error } = await shipsQuery;
  if (error) throw error;
  for (const r of data) {
    const o = r.data.owner;
    if ((o?.kind === 'player' && o.id === player.uid) || (o?.kind === 'crew' && out.crew && o.id === out.crew.id)) {
      out.ships[r.id] = normalizeShip(r.data);
      out.shipVersions[r.id] = r.version;
    }
  }
  return out;
}

/** Invitations reçues par un joueur : [{ id, name, flag, members, by }]. */
export async function invitesFor(uid) {
  const crews = await readAll('crews');
  const out = [];
  for (const [id, raw] of Object.entries(crews)) {
    const c = normalizeCrew(structuredClone(raw));
    const inv = c.invites.find((i) => i.uid === uid);
    if (inv) out.push({ id, name: c.name, flag: c.flag, members: c.members.length, by: inv.by });
  }
  if (!out.length) return out;
  const names = await readMany('players', [...new Set(out.map((i) => i.by))]);
  return out.map((i) => ({ ...i, byName: names[i.by] ? fullName(names[i.by].data) : '' }));
}

/** Ce que voit le site d'un équipage et de ses bateaux. */
export const publicCrew = (c, names) => (c ? { ...c, memberNames: names } : null);
export const shipList = (ships) => Object.entries(ships).map(([id, s]) => ({ id, ...s }));

/**
 * Écran Navigation : bateaux à quai dans ce salon, bateau où le joueur est à
 * bord, et demandes d'embarquement sur les bateaux qu'il gère.
 * Renvoie { harbor, aboard, requests, names, crewNames }.
 */
export async function loadHarbor(player, crew, channelId) {
  const all = Object.entries(await readAll('ships')).map(([id, sh]) => ({ id, ...normalizeShip(sh) }));
  const harbor = channelId ? all.filter((sh) => sh.position?.channelId === channelId) : [];
  const aboard = all.find((sh) => sh.passengers.includes(player.uid)) || null;
  const managed = all.filter((sh) => canManageShip(player, sh, crew) && sh.requests.length);
  const requests = managed.flatMap((sh) => sh.requests.map((r) => ({ shipId: sh.id, shipName: sh.name, uid: r.uid, at: r.at })));
  // Noms à afficher : propriétaires, passagers, demandeurs, équipages propriétaires
  const shown = [...harbor, ...(aboard ? [aboard] : [])];
  const uids = new Set(), crewIds = new Set();
  for (const sh of shown) {
    if (sh.owner?.kind === 'player') uids.add(sh.owner.id);
    if (sh.owner?.kind === 'crew') crewIds.add(sh.owner.id);
    sh.passengers.forEach((u) => uids.add(u));
  }
  requests.forEach((r) => uids.add(r.uid));
  const [players, crews] = await Promise.all([readMany('players', [...uids]), readMany('crews', [...crewIds])]);
  const names = Object.fromEntries([...uids].map((u) => [u, players[u] ? fullName(players[u].data) : '?']));
  const crewNames = Object.fromEntries([...crewIds].map((c) => [c, crews[c]?.data.name ?? '?']));
  const crewKinds = Object.fromEntries([...crewIds].map((c) => [c, crews[c]?.data.kind === 'flotte' ? 'flotte' : 'equipage']));
  // Les demandes des autres ne regardent que le propriétaire : on ne garde que la sienne.
  const hide = (sh) => ({ ...sh, requests: canManageShip(player, sh, crew) ? sh.requests : sh.requests.filter((r) => r.uid === player.uid) });
  return { harbor: harbor.map(hide), aboard: aboard ? hide(aboard) : null, requests, names, crewNames, crewKinds };
}

/** Carte du monde (fond, îles, temps de trajet), stockée dans meta. */
export async function loadMap() {
  const row = await read('meta', 'map');
  return { map: normalizeMap(row?.data || {}), version: row?.version ?? null };
}
