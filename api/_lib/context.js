/** Chargement commun : fiche, boutique du salon, catalogue d'objets et de recettes. */
import { normalize, normalizeShop, setCatalog } from '../../shared/game.js';
import { read, readAll } from './db.js';
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

/** Objets et recettes du staff ; à charger avant d'appliquer une règle du jeu. */
export async function loadCatalog() {
  const [items, recipes] = await Promise.all([readAll('items'), readAll('recipes')]);
  const catalog = { items, recipes };
  setCatalog(catalog);
  return catalog;
}

export async function channelInfo(channelId) {
  return { channelId: channelId || null, channelName: channelId ? await channelName(channelId) : '' };
}

/** Ce que voit le site : on ne renvoie pas les champs internes. */
export const publicPlayer = (p) => p;
