/**
 * POST /api/action { channelId, action }
 * Une action du joueur sur SA fiche (stats, inventaire, métier, boutique,
 * navigation...). Toutes les règles sont appliquées ici, côté serveur.
 */
import { handler, need } from './_lib/http.js';
import { userFromRequest } from './_lib/discord.js';
import { loadPlayer, loadShop, loadNav, publicPlayer } from './_lib/context.js';
import { write, retry } from './_lib/db.js';
import { ingest } from './_lib/media.js';
import { playerAction } from '../shared/game.js';

const SHOP = ['shop.buy', 'shop.sell'];
const NAV = ['nav.toggle', 'nav.choose'];

export default handler(['POST'], async (req, body) => {
  const me = await userFromRequest(req);
  const action = body.action || {};
  const channelId = body.channelId || null;
  need(typeof action.type === 'string', 400, 'Action manquante.');

  // Images : on les envoie dans le stockage avant d'appliquer l'action.
  if (action.type === 'photo.set') {
    const ph = action.photo;
    if (typeof ph === 'string') action.photo = await ingest(ph, 'photos', me.uid);
    else if (ph?.url) action.photo = { ...ph, url: await ingest(ph.url, 'photos', me.uid) };
  }
  if (action.type === 'tech.save' && action.media !== undefined) action.media = await ingest(action.media, 'techniques', me.uid);

  return retry(async () => {
    const { player, version } = await loadPlayer(me.uid, me.name);
    const ctx = { channelId, now: Date.now() };
    let shopV = null, navV = null;
    if (SHOP.includes(action.type)) {
      need(channelId, 400, 'Salon inconnu.');
      const s = await loadShop(channelId);
      ctx.shop = s.shop; shopV = s.version;
    }
    if (NAV.includes(action.type)) {
      need(channelId, 400, 'Salon inconnu.');
      const n = await loadNav(channelId);
      ctx.nav = n.nav; navV = n.version;
    }
    const out = playerAction(player, action, ctx);
    if (out.shop) await write('shops', channelId, out.shop, shopV);
    if (out.nav) await write('navs', channelId, out.nav, navV, { active: !!out.nav.active });
    await write('players', me.uid, out.player, version);
    return { ...out, player: publicPlayer(out.player) };
  });
});
