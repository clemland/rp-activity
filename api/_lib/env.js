/** Variables d'environnement (à définir dans Vercel > Settings > Environment Variables). */
const list = (v) => (v || '').split(',').map((s) => s.trim()).filter(Boolean);

export const env = {
  clientId: process.env.VITE_DISCORD_CLIENT_ID,
  clientSecret: process.env.DISCORD_CLIENT_SECRET,
  botToken: process.env.DISCORD_BOT_TOKEN,
  guildId: process.env.GUILD_ID, // serveur principal : les droits staff y sont vérifiés
  owners: list(process.env.OWNER_IDS),
  staffRoles: list(process.env.STAFF_ROLE_IDS),
  botSecret: process.env.BOT_API_SECRET, // secret partagé avec le bot
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  imgbbKey: process.env.IMGBB_API_KEY, // images hébergées sur ImgBB (sinon : stockage Supabase)
};
