import { normalizeHeroes, normalizeItems, type HeroCatalog, type ItemCatalog } from '@pp/shared';
import heroesRaw from '../../shared/heroes.json';
import itemsRaw from '../../shared/items.json';

export const HEROES: HeroCatalog = normalizeHeroes(heroesRaw as unknown);
export const ITEMS: ItemCatalog = normalizeItems(itemsRaw as unknown);

export const HERO_LIST = Object.values(HEROES);
export const ITEM_LIST = Object.values(ITEMS);

/** Sama dengan server Colyseus: beta fighting hanya memakai 4 hero ini. */
export const FIGHT_HERO_IDS = [
  'bocil_sarung',
  'abang_ronda',
  'tukang_lodong',
  'emak_daster',
] as const;

export const FIGHT_HERO_LIST = FIGHT_HERO_IDS.map((id) => HEROES[id]).filter(
  (hero): hero is NonNullable<typeof hero> => Boolean(hero),
);

export function isFightHeroId(value: unknown): value is (typeof FIGHT_HERO_IDS)[number] {
  return typeof value === 'string' && (FIGHT_HERO_IDS as readonly string[]).includes(value);
}

export function pickRandom<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}
