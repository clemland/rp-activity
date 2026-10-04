/** POST /api/token { code } : l'Activity échange son code OAuth2 contre un jeton. */
import { handler, need } from './_lib/http.js';
import { exchangeCode } from './_lib/discord.js';

export default handler(['POST'], async (req, body) => {
  need(typeof body.code === 'string' && body.code, 400, 'Code manquant.');
  return { access_token: await exchangeCode(body.code) };
});
