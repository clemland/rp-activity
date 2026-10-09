/**
 * Images (photos, GIF de techniques, Jolly Roger, bateaux, objets, vendeurs).
 * Avec IMGBB_API_KEY : envoyées sur ImgBB, on garde le lien https://i.ibb.co/...
 * Sinon : stockées dans le bucket Supabase « media » (chemin /media/...).
 * Accepte une image envoyée (data URL) ou un lien http(s), recopié chez nous
 * pour qu'il reste disponible même si le site d'origine l'efface.
 */
import { db } from './db.js';
import { env } from './env.js';
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

const IBB = /^https:\/\/i\.ibb\.co\//;
const RELAY_MAX = 4 * 1024 * 1024; // au-delà, le relais /api/img ne peut pas la renvoyer

/** Envoi sur ImgBB : data URL (base64) ou lien, qu'ImgBB va chercher lui-même. */
async function toImgbb(input, name) {
  let image;
  if (input.startsWith('data:')) image = fromDataUrl(input).buf.toString('base64');
  else {
    let u;
    try {
      u = new URL(input);
    } catch {
      throw new HttpError(400, 'Lien invalide.');
    }
    if (!/^https?:$/.test(u.protocol)) throw new HttpError(400, 'Le lien doit commencer par http:// ou https://');
    image = u.href;
  }
  const r = await fetch('https://api.imgbb.com/1/upload', {
    method: 'POST',
    body: new URLSearchParams({ key: env.imgbbKey, image, name: name.slice(0, 80) }),
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  const j = await r?.json().catch(() => null);
  if (!r?.ok || !j?.success || !j.data?.url) {
    throw new HttpError(400, `ImgBB n’a pas accepté l’image${j?.error?.message ? ` : ${j.error.message}` : ''}.`);
  }
  // Trop lourde pour le relais d'images de Discord (~4 Mo) : on prend la version allégée d'ImgBB.
  if (Number(j.data.size) > RELAY_MAX) {
    const lighter = j.data.medium?.url || j.data.thumb?.url;
    if (!lighter) throw new HttpError(400, 'Image trop lourde (plus de 4 Mo) : réduis-la avant de l’envoyer.');
    return lighter;
  }
  return j.data.url;
}

/** Rien, une image déjà chez nous, une data URL ou un lien → lien ImgBB (ou chemin /media/...). */
export async function ingest(input, folder, owner) {
  if (!input) return null;
  if (typeof input !== 'string') throw new HttpError(400, 'Image invalide.');
  if (input.startsWith('/media/') || IBB.test(input)) return input;
  if (env.imgbbKey) return toImgbb(input, `${folder}-${owner}-${Date.now().toString(36)}`);
  const { buf, type } = input.startsWith('data:') ? fromDataUrl(input) : await fromUrl(input);
  const path = `${folder}/${owner}-${Date.now().toString(36)}.${TYPES[type]}`;
  const { error } = await db().storage.from('media').upload(path, buf, { contentType: type, upsert: false });
  if (error) throw new HttpError(500, 'Envoi de l’image impossible.');
  return `/media/${path}`;
}
