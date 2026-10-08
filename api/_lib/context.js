/** Chargement commun : fiche, boutique du salon, catalogue d'objets et de recettes. */
import { normalize, normalizeShop, normalizeCrew, normalizeShip, setCatalog, fullName } from '../../shared/game.js';
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
