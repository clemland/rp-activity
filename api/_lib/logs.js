/**
 * Journal : chaque requête réussie (joueurs, staff, bot) est postée dans le salon de logs.
 * Salon choisi avec la variable LOG_CHANNEL_ID (réglages Vercel). Sans elle, rien n'est journalisé.
 */
import { env } from './env.js';

const QUIET_ACTIONS = new Set(['features.get', 'players.here', 'shop.list', 'ship.dock.options', 'inv.move', 'poll.get']);
const BOT_OPS = ['register', 'delete', 'rp.channel.add', 'rp.channel.remove', 'ships.config.set', 'ship.channel.set', 'ship.channel.deleted'];
const clean = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 300);

function lineFor(req, body, out) {
  const me = req.me;
  const who = me ? `**${clean(me.name || me.uid)}** (<@${me.uid}>)` : '';
  const toast = out?.toast ? ` · ${clean(out.toast)}` : '';
  if (req.logKind === 'action') {
    const t = String(body.action?.type || '?');
    if (QUIET_ACTIONS.has(t)) return null;
    return `🟢 ${who} · \`${t}\`${toast}`;
  }
  if (req.logKind === 'staff') {
    const op = String(body.op || '');
    // Lectures (listes, .get, .channels) : pas de log
    if ((!op.includes('.') && !['act', 'bulk'].includes(op)) || /\.(get|channels)$/.test(op) || op === 'loot.export') return null;
    const sub = body.action?.type ? ` › \`${clean(body.action.type)}\`` : '';
    const target = body.target ? ` · cible <@${body.target}>` : Array.isArray(body.targets) ? ` · ${body.targets.length} joueurs` : '';
    return `🔵 Staff ${who} · \`${op}\`${sub}${target}${toast}`;
  }
  if (req.logKind === 'bot') {
    const op = String(body.op || '');
    const u = body.userId ? `<@${body.userId}>` : '';
    if (op === 'rp.message') {
      const bits = [];
      if (out?.found) bits.push(`🎁 trouve ${out.found.qty} × ${clean(out.found.name)} (${clean(out.found.rarity)})`);
      if (out?.docked) bits.push(`⚓ ${clean(out.docked.ship)} à quai à ${clean(out.docked.where)}`);
      if (out?.voyage?.arrived) bits.push(`⛵ ${clean(out.voyage.ship)} arrive à destination`);
      if (out?.encounter) bits.push(`🔭 rencontre : ${clean(out.encounter.ship)} et ${clean(out.encounter.other)}`);
      return bits.length ? `🟣 ${u} · ${bits.join(' · ')}` : null;
    }
    if (!BOT_OPS.includes(op)) return null;
    return `🟠 Bot · \`${op}\`${u ? ` · ${u}` : ''}${body.by ? ` · par <@${body.by}>` : ''}${toast}`;
  }
  return null;
}

export async function logRequest(req, body, out) {
  const channel = process.env.LOG_CHANNEL_ID;
  if (!channel || !env.botToken) return;
  const line = lineFor(req, body, out);
  if (!line) return;
  try {
    await fetch(`https://discord.com/api/v10/channels/${channel}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bot ${env.botToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: `<t:${Math.floor(Date.now() / 1000)}:T> ${line}`.slice(0, 1900), allowed_mentions: { parse: [] } }),
      signal: AbortSignal.timeout(3000),
    });
  } catch {}
}
