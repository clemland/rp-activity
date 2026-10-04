/**
 * Le bot envoie parfois des valeurs tapées à la main (« forgeron », « gigot de mer »…).
 * On les fait correspondre aux valeurs du jeu, sans tenir compte des accents ni des
 * majuscules, et on signale celles qu'on n'a pas reconnues.
 */
import { ITEMS, JOBS, FACTIONS, RACES, CLASSES, GRADES, FRUIT_TYPES } from '../../shared/game.js';

const norm = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[-'’\s]+/g, ' ').trim();
const inList = (list, v) => list.find((x) => norm(x) === norm(v));

function byKeyOrName(table, v) {
  const n = norm(v);
  if (table[v]) return v;
  const exact = Object.keys(table).find((k) => norm(table[k].name) === n || norm(k) === n);
  if (exact) return exact;
  const partial = Object.keys(table).filter((k) => norm(table[k].name).includes(n));
  return partial.length === 1 ? partial[0] : null;
}

export function resolveStaffAction(input) {
  const action = structuredClone(input || {});
  const ignored = [];
  if (action.type === 'edit' && action.patch) {
    const p = action.patch;
    const lists = { faction: FACTIONS, race: RACES, classe: CLASSES, grade: GRADES };
    for (const [field, list] of Object.entries(lists)) {
      if (!p.id || !(field in p.id)) continue;
      const v = inList(list, p.id[field]);
      if (v) p.id[field] = v;
      else {
        ignored.push(`${field} « ${p.id[field]} »`);
        delete p.id[field];
      }
    }
    if ('job' in p) {
      const k = byKeyOrName(JOBS, p.job);
      if (k) p.job = k;
      else {
        ignored.push(`métier « ${p.job} »`);
        delete p.job;
      }
    }
    if (p.fruit?.type) {
      const t = inList(FRUIT_TYPES, p.fruit.type);
      if (t) p.fruit.type = t;
      else ignored.push(`type de fruit « ${p.fruit.type} »`);
    }
  }
  if ((action.type === 'give' || action.type === 'take') && action.key) {
    const k = byKeyOrName(ITEMS, action.key);
    if (!k) ignored.push(`objet « ${action.key} »`);
    action.key = k || action.key;
  }
  return { action, ignored };
}

/** Listes de valeurs, pour les menus du bot. */
export const choiceLists = () => ({
  factions: FACTIONS, races: RACES, classes: CLASSES, grades: GRADES, fruitTypes: FRUIT_TYPES,
  jobs: Object.entries(JOBS).map(([key, j]) => ({ key, name: j.name })),
});
