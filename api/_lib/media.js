/**
 * Images (photo de profil, GIF de technique, portrait de vendeur) : on les
 * stocke dans le bucket Supabase « media », jamais dans la base.
 * Accepte une image envoyée (data URL) ou un lien http(s), qu'on recopie chez
 * nous pour qu'elle reste disponible et passe le filtre de Discord.
 * Renvoie un chemin relatif « /media/... » (voir l'URL Mapping /media).
 */
import { db } from './db.js';
import { HttpError } from './http.js';

const MAX = 4 * 1024 * 1024;
const TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

async function fromUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new HttpError(400, 'Lien invalide.');
  }
  if (!/^https?:$/.test(u.protocol)) throw new HttpError(400, 'Le lien doit commencer par http:// ou https://');
  const r = await fetch(u, { signal: AbortSignal.timeout(8000), redirect: 'follow' }).catch(() => null);
  if (!r?.ok) throw new HttpError(400, 'Impossible de récupérer cette image.');
  const type = (r.headers.get('content-type') || '').split(';')[0];
  if (!TYPES[type]) throw new HttpError(400, 'Ce lien ne mène pas à une image (PNG, JPG, GIF ou WebP).');
  if (+r.headers.get('content-length') > MAX) throw new HttpError(400, 'Image trop lourde (4 Mo maximum).');
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > MAX) throw new HttpError(400, 'Image trop lourde (4 Mo maximum).');
  return { buf, type };
}

function fromDataUrl(s) {
  const m = /^data:(image\/[a-z]+);base64,(.+)$/i.exec(s);
  if (!m || !TYPES[m[1].toLowerCase()]) throw new HttpError(400, 'Format d’image non pris en charge.');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > MAX) throw new HttpError(400, 'Image trop lourde (4 Mo maximum).');
  return { buf, type: m[1].toLowerCase() };
}

/** Rien, un chemin déjà chez nous, une data URL ou un lien → chemin /media/... */
export async function ingest(input, folder, owner) {
  if (!input) return null;
  if (typeof input !== 'string') throw new HttpError(400, 'Image invalide.');
  if (input.startsWith('/media/')) return input;
  const { buf, type } = input.startsWith('data:') ? fromDataUrl(input) : await fromUrl(input);
  const path = `${folder}/${owner}-${Date.now().toString(36)}.${TYPES[type]}`;
  const { error } = await db().storage.from('media').upload(path, buf, { contentType: type, upsert: false });
  if (error) throw new HttpError(500, 'Envoi de l’image impossible.');
  return `/media/${path}`;
}
