/**
 * Accès à Supabase. Chaque ligne contient un document JSON (`data`) et un
 * numéro de version : une écriture n'est acceptée que si personne n'a modifié
 * la ligne entre-temps, sinon on relit et on recommence.
 */
import { createClient } from '@supabase/supabase-js';
import { env } from './env.js';
import { HttpError } from './http.js';

let client;
export function db() {
  if (!client) {
    if (!env.supabaseUrl || !env.supabaseKey) throw new HttpError(500, 'Supabase non configuré (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).');
    client = createClient(env.supabaseUrl, env.supabaseKey, { auth: { persistSession: false } });
  }
  return client;
}

const TABLES = { players: 'id', shops: 'channel_id', items: 'id', recipes: 'id', meta: 'key' };

export async function read(table, id) {
  const { data, error } = await db().from(table).select('data, version').eq(TABLES[table], id).maybeSingle();
  if (error) throw error;
  return data; // { data, version } ou null
}

export class Conflict extends Error {}

/** Écrit si la version n'a pas bougé. version null = création. */
export async function write(table, id, data, version, extra = {}) {
  const key = TABLES[table];
  if (version == null) {
    const { error } = await db().from(table).insert({ [key]: id, data, version: 1, ...extra });
    if (error?.code === '23505') throw new Conflict();
    if (error) throw error;
    return 1;
  }
  const { data: rows, error } = await db()
    .from(table)
    .update({ data, version: version + 1, updated_at: new Date().toISOString(), ...extra })
    .eq(key, id)
    .eq('version', version)
    .select('version');
  if (error) throw error;
  if (!rows?.length) throw new Conflict();
  return version + 1;
}

export async function remove(table, id) {
  const { error } = await db().from(table).delete().eq(TABLES[table], id);
  if (error) throw error;
}

/** Relance une opération en cas d'écriture concurrente (3 essais). */
export async function retry(fn) {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof Conflict) || i >= 2) {
        if (err instanceof Conflict) throw new HttpError(409, 'Quelqu’un a modifié ces données en même temps. Réessaie.');
        throw err;
      }
    }
  }
}

export async function listPlayers() {
  const { data, error } = await db()
    .from('players')
    .select('id, ident:data->id, level:data->level, photo:data->photo, job:data->job')
    .order('updated_at', { ascending: false })
    .limit(1000);
  if (error) throw error;
  return data.map((r) => ({ uid: r.id, ident: r.ident || {}, level: r.level, photo: r.photo, job: r.job?.id ?? null }));
}

/** Toute une table sous forme { id: data } (objets, recettes). */
export async function readAll(table) {
  const key = TABLES[table];
  const { data, error } = await db().from(table).select(`${key}, data`).limit(5000);
  if (error) throw error;
  return Object.fromEntries(data.map((r) => [r[key], r.data]));
}
