/**
 * Kurva level & unlock skill. Nama `MOBA_BALANCE` dipertahankan karena dipakai
 * kontrak lama, tetapi angka gameplay sekarang ada di `ARENA_BALANCE`.
 */
import type { TeamId } from './types.js';
import type { MobaSkillKey } from './mobaTypes.js';

/** Balancing arena PvP: menang dari skor kill saat timer habis. */
export const ARENA_BALANCE = {
  matchSeconds: 300,
  scoreLimit: 40,

  heroGold: 140,
  heroXp: 160,
  assistXp: 70,

  respawnBaseMs: 2400,
  respawnPerLevelMs: 180,
  spawnProtectionMs: 1200,

  projectileSpeed: 32,
  effectTtlMs: 420,
} as const;

export const MOBA_BALANCE = {
  matchSeconds: 600,
  scoreLimit: 60,

  minionWaveMs: 25_000,
  minionHp: 240,
  minionHpPerMinute: 55,
  minionDamage: 20,
  minionDamagePerMinute: 4,
  minionSpeed: 4.4,
  minionRange: 2.4,
  minionGold: 28,
  minionXp: 32,
  minionGroupSize: 3,

  turretHp: 1700,
  turretDamage: 72,
  turretRange: 15,
  turretCooldownMs: 1100,
  turretGold: 220,
  turretXp: 90,

  baseHp: 4200,
  baseDamage: 62,
  baseRange: 13,
  baseCooldownMs: 1200,

  heroGold: 160,
  heroXp: 130,
  respawnBaseMs: 6000,
  respawnPerLevelMs: 450,

  bossSpawnMs: 90_000,
  bossRespawnMs: 180_000,
  bossHp: 3400,
  bossDamage: 95,
  bossRange: 6,
  bossCooldownMs: 1400,
  bossGold: 300,
  bossXp: 240,
  bossTeamDamageBuff: 0.15,

  maxLevel: 15,
  xpBase: 90,
  xpGrowth: 1.26,
  skillUnlockLevel: { skill1: 1, skill2: 2, ultimate: 4 } as Record<MobaSkillKey, number>,

  projectileSpeed: 28,
  effectTtlMs: 420,
} as const;

/** XP kumulatif yang dibutuhkan untuk mencapai level tertentu (1-based). */
export function xpForLevel(level: number): number {
  if (level <= 1) return 0;
  let total = 0;
  for (let l = 2; l <= level; l += 1) {
    total += Math.round(MOBA_BALANCE.xpBase * Math.pow(MOBA_BALANCE.xpGrowth, l - 2));
  }
  return total;
}

export function levelForXp(xp: number): number {
  let level = 1;
  while (level < MOBA_BALANCE.maxLevel && xp >= xpForLevel(level + 1)) level += 1;
  return level;
}

/** Progress 0..1 menuju level berikutnya (dipakai HUD). */
export function levelProgress(xp: number): number {
  const level = levelForXp(xp);
  if (level >= MOBA_BALANCE.maxLevel) return 1;
  const from = xpForLevel(level);
  const to = xpForLevel(level + 1);
  return Math.max(0, Math.min(1, (xp - from) / Math.max(1, to - from)));
}

export function otherTeam(team: TeamId): TeamId {
  return team === 'team_merah' ? 'team_putih' : 'team_merah';
}

export function scoreKey(team: TeamId): 'scoreMerah' | 'scorePutih' {
  return team === 'team_merah' ? 'scoreMerah' : 'scorePutih';
}

export function baseHpKey(team: TeamId): 'baseHpMerah' | 'baseHpPutih' {
  return team === 'team_merah' ? 'baseHpMerah' : 'baseHpPutih';
}

export function formatMatchTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}
