import heroesRaw from '../../../shared/heroes.json';
import itemsRaw from '../../../shared/items.json';
import { normalizeHeroes, normalizeItems } from '@pp/shared';

export const HEROES = normalizeHeroes(heroesRaw);
export const ITEMS = normalizeItems(itemsRaw);

export const HERO_LIST = Object.values(HEROES);
export const ITEM_LIST = Object.values(ITEMS);

export function heroPortrait(heroId: string): string {
  return `/assets/${HEROES[heroId]?.portrait ?? 'characters/bocil_sarung.png'}`;
}
