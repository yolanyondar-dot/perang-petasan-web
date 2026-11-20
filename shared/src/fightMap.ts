/** Peta side-view fighting: lantai + platform kampung, koordinat z = ketinggian. */
import type { TeamId } from './types.js';

export interface FightVec {
  x: number;
  z: number;
}

export interface FightPlatform {
  id: string;
  x: number;
  z: number;
  w: number;
  label: string;
}

export const FIGHT_WORLD_WIDTH = 120;
export const FIGHT_WORLD_HEIGHT = 30;
export const FIGHT_HALF_WIDTH = FIGHT_WORLD_WIDTH / 2;
export const FIGHT_GROUND_Z = 0;

/** Platform tempat hero bisa berdiri. z adalah permukaan atas platform. */
export const FIGHT_PLATFORMS: readonly FightPlatform[] = [
  { id: 'kiosk_kiri', x: -34, z: 6, w: 18, label: 'Kiosk Kiri' },
  { id: 'kiosk_kanan', x: 34, z: 6, w: 18, label: 'Kiosk Kanan' },
  { id: 'gapura_tengah', x: 0, z: 10, w: 22, label: 'Gapura Tengah' },
  { id: 'atap_kiri', x: -20, z: 15, w: 12, label: 'Atap Kiri' },
  { id: 'atap_kanan', x: 20, z: 15, w: 12, label: 'Atap Kanan' },
];

export const FIGHT_SPAWNS: Record<TeamId, FightVec> = {
  team_merah: { x: -48, z: FIGHT_GROUND_Z },
  team_putih: { x: 48, z: FIGHT_GROUND_Z },
};

/** Titik lahir per round, disebar supaya tim tidak bertumpuk. */
export function fightSpawnPoint(team: TeamId, index: number, count: number): FightVec {
  const base = FIGHT_SPAWNS[team];
  const total = Math.max(1, count);
  const spread = (index - (total - 1) / 2) * Math.min(1.6, 12 / total);
  const inward = team === 'team_merah' ? 1 : -1;
  return {
    x: base.x + inward * spread * 0.35,
    z: FIGHT_GROUND_Z + (index % 3) * 0.9,
  };
}

export function clampFightX(x: number, radius = 1.2): number {
  const limit = FIGHT_HALF_WIDTH - radius;
  return Math.max(-limit, Math.min(limit, x));
}

export function clampFightZ(z: number): number {
  return Math.max(FIGHT_GROUND_Z, Math.min(FIGHT_WORLD_HEIGHT, z));
}

/** Platform yang dilewati kaki saat jatuh dari `fromZ` ke `toZ`. */
export function landingPlatform(
  x: number,
  fromZ: number,
  toZ: number,
  radius = 1.2,
): FightPlatform | null {
  if (toZ > fromZ) return null;
  let best: FightPlatform | null = null;
  for (const platform of FIGHT_PLATFORMS) {
    if (x < platform.x - platform.w / 2 - radius) continue;
    if (x > platform.x + platform.w / 2 + radius) continue;
    if (fromZ < platform.z - 0.01) continue;
    if (toZ > platform.z) continue;
    if (!best || platform.z > best.z) best = platform;
  }
  return best;
}

/** Permukaan tempat hero berdiri diam di posisi x, z tertentu. */
export function standingPlatform(x: number, z: number, radius = 1.2): FightPlatform | null {
  let best: FightPlatform | null = null;
  for (const platform of FIGHT_PLATFORMS) {
    if (x < platform.x - platform.w / 2 - radius) continue;
    if (x > platform.x + platform.w / 2 + radius) continue;
    if (Math.abs(z - platform.z) > 0.12) continue;
    if (!best || platform.z > best.z) best = platform;
  }
  return best;
}

export function isOverPlatform(x: number, platform: FightPlatform, radius = 1.2): boolean {
  return x >= platform.x - platform.w / 2 - radius && x <= platform.x + platform.w / 2 + radius;
}
