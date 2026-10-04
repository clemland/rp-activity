/** Chargement commun : fiche du joueur, boutique et navigation du salon. */
import { newPlayer, normalize, normalizeShop, newNav } from '../../shared/game.js';
import { read, write } from './db.js';
import { channelName } from './discord.js';

/** Fiche du joueur ; créée (vierge) au premier passage. */
export async function loadPlayer(uid, name) {
  const row = await read('players', uid);
  if (row) return { player: normalize(row.data), version: row.version };
  const player = newPlayer(uid, name);
  await write('players', uid, player, null).catch(() => {}); // déjà créée par une autre requête : sans gravité
  const again = await read('players', uid);
  return { player: normalize(again?.data || player), version: again?.version ?? 1 };
}

export async function loadShop(channelId) {
  if (!channelId) return { shop: null, version: null };
  const row = await read('shops', channelId);
  return row ? { shop: normalizeShop(row.data), version: row.version } : { shop: null, version: null };
}

export async function loadNav(channelId) {
  if (!channelId) return { nav: null, version: null };
  const row = await read('navs', channelId);
  return row ? { nav: row.data, version: row.version } : { nav: newNav(), version: null };
}

export async function channelInfo(channelId) {
  return { channelId: channelId || null, channelName: channelId ? await channelName(channelId) : '' };
}

/** Ce que voit le site : on ne renvoie pas les champs internes. */
export const publicPlayer = (p) => {
  const { navCd, pendingOpen, ...rest } = p;
  return rest;
};
