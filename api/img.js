/**
 * GET /api/img?u=https://i.ibb.co/...
 * Relais d'images : dans Discord, les images d'autres sites sont bloquées.
 * L'Activity les demande donc à notre propre site, qui va les chercher sur
 * ImgBB. La réponse est mise en cache par Vercel (un an) : chaque image n'est
 * récupérée qu'une seule fois. Seules les images ImgBB sont acceptées.
 */
const ALLOWED = /^https:\/\/i\.ibb\.co\/[\w\-./%]+$/;
const MAX = 4 * 1024 * 1024; // limite de taille d'une réponse Vercel

export default async function handler(req, res) {
  const u = String(req.query.u || '');
  if (req.method !== 'GET' || !ALLOWED.test(u)) return res.status(400).send('Image non autorisée.');
  const r = await fetch(u, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
  if (!r?.ok) return res.status(r?.status === 404 ? 404 : 502).send('Image introuvable.');
  const type = (r.headers.get('content-type') || '').split(';')[0];
  if (!type.startsWith('image/')) return res.status(415).send('Ce n’est pas une image.');
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > MAX) return res.status(413).send('Image trop lourde.');
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', 'public, max-age=31536000, s-maxage=31536000, immutable');
  return res.status(200).send(buf);
}
