/** Petites aides pour les fonctions Vercel (réponses JSON, erreurs). */
import { GameError } from '../../shared/game.js';
import { logRequest } from './logs.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Enveloppe un handler : JSON en sortie, erreurs propres, méthodes autorisées. */
export function handler(methods, fn) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!methods.includes(req.method)) return res.status(405).json({ error: 'Méthode non autorisée.' });
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
      const out = await fn(req, body);
      // Journal des actions réussies (salon de logs)
      if (!req.logKind && String(req.url || '').includes('/api/bot')) req.logKind = 'bot';
      if (req.logKind) await logRequest(req, body, out).catch(() => {});
      return res.status(200).json(out ?? {});
    } catch (err) {
      if (err instanceof GameError) return res.status(400).json({ error: err.message });
      if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
      console.error(err);
      // On renvoie le vrai message : bien plus simple à corriger qu'une erreur muette
      return res.status(500).json({ error: `Erreur interne du serveur : ${err?.message || err}` });
    }
  };
}

export const need = (cond, status, message) => {
  if (!cond) throw new HttpError(status, message);
};
