import { HEROES } from './catalog.js';

/** Progres permanen di lobby (Koin THR), berbeda dengan Koin Receh dalam match. */
export interface PlayerProfile {
  name: string;
  koin: number;
  heroId: string;
  heroLevels: Record<string, number>;
}

const STORAGE_KEY = 'perang-petasan-moba-v1';

function defaultProfile(): PlayerProfile {
  return {
    name: 'Warga Kampung',
    koin: 250,
    heroId: Object.keys(HEROES)[0] ?? 'bocil_sarung',
    heroLevels: {},
  };
}

export function loadProfile(): PlayerProfile {
  const fallback = defaultProfile();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<PlayerProfile>;
    const heroId = parsed.heroId && HEROES[parsed.heroId] ? parsed.heroId : fallback.heroId;
    const heroLevels: Record<string, number> = {};
    for (const [id, level] of Object.entries(parsed.heroLevels ?? {})) {
      if (HEROES[id] && Number.isFinite(level)) {
        heroLevels[id] = Math.max(0, Math.min(HEROES[id]!.thrUpgradeScaling.maxLevel, Math.floor(level)));
      }
    }
    return {
      name: typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name : fallback.name,
      koin: Number.isFinite(parsed.koin) ? Math.max(0, Math.floor(parsed.koin!)) : fallback.koin,
      heroId,
      heroLevels,
    };
  } catch {
    return fallback;
  }
}

export function saveProfile(profile: PlayerProfile): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // LocalStorage bisa diblokir; permainan tetap berjalan.
  }
}

export function heroLevel(profile: PlayerProfile, heroId: string): number {
  return profile.heroLevels[heroId] ?? 0;
}

export function selectHero(profile: PlayerProfile, heroId: string): void {
  if (HEROES[heroId]) {
    profile.heroId = heroId;
    saveProfile(profile);
  }
}

export function buyHeroUpgrade(profile: PlayerProfile, heroId: string): boolean {
  const hero = HEROES[heroId];
  if (!hero) return false;
  const level = heroLevel(profile, heroId);
  if (level >= hero.thrUpgradeScaling.maxLevel) return false;
  const cost = Math.round(
    hero.thrUpgradeScaling.baseCost * Math.pow(hero.thrUpgradeScaling.costMultiplier, level),
  );
  if (profile.koin < cost) return false;
  profile.koin -= cost;
  profile.heroLevels[heroId] = level + 1;
  saveProfile(profile);
  return true;
}

export function addThrKoin(profile: PlayerProfile, amount: number): void {
  profile.koin = Math.max(0, profile.koin + Math.max(0, Math.round(amount)));
  saveProfile(profile);
}
