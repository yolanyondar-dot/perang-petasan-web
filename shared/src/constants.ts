import type { RoomMode, TeamId, UpgradeCost } from './types.js';

export const TICK_RATE = 20;
export const PATCH_RATE_MS = 50;

export const ARENA = {
  width: 1600,
  height: 1000,
  wall: 32,
  playerRadius: 18,
} as const;

/** Rintangan statis (top-left x,y). Dipakai server untuk collision dan client untuk gambar. */
export const OBSTACLES: ReadonlyArray<{ x: number; y: number; w: number; h: number }> = [
  { x: 720, y: 450, w: 160, h: 100 }, // pos ronda
  { x: 320, y: 220, w: 120, h: 64 }, // tumpukan karung
  { x: 1160, y: 700, w: 120, h: 64 }, // tumpukan karung
  { x: 520, y: 760, w: 90, h: 90 }, // bak air
  { x: 1000, y: 190, w: 90, h: 90 }, // bak air
];

export const TEAM: Record<'MERAH' | 'PUTIH', TeamId> = {
  MERAH: 'team_merah',
  PUTIH: 'team_putih',
} as const;

export const TEAM_COLORS: Record<TeamId, number> = {
  team_merah: 0xef5350,
  team_putih: 0xf5f5f5,
};

export const TEAM_LABELS: Record<TeamId, string> = {
  team_merah: 'Tim Merah',
  team_putih: 'Tim Putih',
};

export const ROOM_MODES: Record<RoomMode, { teamSize: number; label: string }> = {
  '3v3': { teamSize: 3, label: '3v3 - Brawl Cepat' },
  '5v5': { teamSize: 5, label: '5v5 - Arena Kampung' },
  '10v10': { teamSize: 10, label: '10v10 - Perang Ramai' },
};

export const MESSAGES = {
  MOVE: 'move',
  ATTACK: 'attack',
  MATCH_END: 'match_end',
  BUY_UPGRADE: 'buy_upgrade',
  KO: 'ko',
  WELCOME: 'welcome',
  PING: 'ping',
} as const;

export const UPGRADES = {
  maxCharacterLevel: 10,
  perLevelHp: 12,
  perLevelSpeed: 9,
  perLevelStaminaRegen: 2.5,
  respawnMs: 3000,
  matchSeconds: 300,
  scoreLimit: 20,
} as const;

/** Biaya naik level berikutnya: base * growth^level (level mulai dari 0). */
export function nextUpgradeCost(cost: UpgradeCost, currentLevel: number): number {
  return Math.round(cost.base * Math.pow(cost.growth, Math.max(0, currentLevel)));
}
