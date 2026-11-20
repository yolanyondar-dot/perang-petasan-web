import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  normalizeHeroes,
  normalizeItems,
  type HeroCatalog,
  type ItemCatalog,
} from '@pp/shared';

const currentDir = dirname(fileURLToPath(import.meta.url));

function loadCatalog<T>(fileName: string): T {
  // Berjalan baik dari src/ (tsx watch) maupun dist/ (node).
  const filePath = resolve(currentDir, '../../shared', fileName);
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as T;
  } catch (error) {
    throw new Error(`Gagal memuat ${filePath}: ${String(error)}`);
  }
}

export const HEROES: HeroCatalog = normalizeHeroes(loadCatalog<unknown>('heroes.json'));
export const ITEMS: ItemCatalog = normalizeItems(loadCatalog<unknown>('items.json'));

export const HERO_LIST = Object.values(HEROES);
export const ITEM_LIST = Object.values(ITEMS);

/** Beta fighting memakai 4 hero pertama; bot dan join tunduk pada batas ini. */
export const FIGHT_HERO_IDS = [
  'bocil_sarung',
  'abang_ronda',
  'tukang_lodong',
  'emak_daster',
] as const;
export const FIGHT_HERO_LIST = FIGHT_HERO_IDS.map((id) => HEROES[id]).filter(
  (hero): hero is NonNullable<typeof hero> => Boolean(hero),
);

export function pickRandom<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}
