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

export function pickRandom<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}
