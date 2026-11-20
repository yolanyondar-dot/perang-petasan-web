/** Peta arena PvP 160x160 world unit. Dipakai server (authoritative) & client (visual). */
import type { TeamId } from './types.js';
import type { MobaLane } from './mobaTypes.js';

export interface Vec2 {
  x: number;
  z: number;
}

export const MOBA_WORLD_SIZE = 160;
export const MOBA_HALF = MOBA_WORLD_SIZE / 2;
/** Hero/minion tidak boleh keluar dari batas ini. */
export const MOBA_BOUNDS = 76;
export const MOBA_BASE_RADIUS = 8;
export const MOBA_TURRET_RADIUS = 3.2;

export const MOBA_BASES: Record<TeamId, Vec2> = {
  team_merah: { x: -68, z: -68 },
  team_putih: { x: 68, z: 68 },
};

export const MOBA_SPAWNS: Record<TeamId, Vec2> = {
  team_merah: { x: -58, z: -58 },
  team_putih: { x: 58, z: 58 },
};

/* ------------------------------------------------------------- arena PvP */

/** Zona respawn tim: kiri (merah) dan kanan (putih). */
export const ARENA_SPAWNS: Record<TeamId, Vec2> = {
  team_merah: { x: -54, z: 0 },
  team_putih: { x: 54, z: 0 },
};

export const ARENA_SPAWN_RADIUS = 9;
export const ARENA_CENTER: Vec2 = { x: 0, z: 0 };
export const ARENA_CENTER_RADIUS = 12;

export interface ArenaCover {
  id: string;
  x: number;
  z: number;
  w: number;
  h: number;
  label: string;
}

/** Props arena yang jadi cover tembakan sekaligus dekorasi festival. */
export const ARENA_COVER: readonly ArenaCover[] = [
  { id: 'kiosk_utara', x: -24, z: -26, w: 10, h: 6, label: 'Kiosk' },
  { id: 'kiosk_selatan', x: 24, z: 26, w: 10, h: 6, label: 'Kiosk' },
  { id: 'bak_utara', x: 16, z: -30, w: 7, h: 7, label: 'Bak Air' },
  { id: 'bak_selatan', x: -16, z: 30, w: 7, h: 7, label: 'Bak Air' },
  { id: 'pos_utara', x: 0, z: -38, w: 9, h: 5, label: 'Pos Ronda' },
  { id: 'pos_selatan', x: 0, z: 38, w: 9, h: 5, label: 'Pos Ronda' },
];

/** Titik lahir di dalam zona tim, disebar supaya tidak tumpang tindih. */
export function arenaSpawnPoint(team: TeamId, index: number, count: number): Vec2 {
  const base = ARENA_SPAWNS[team];
  const total = Math.max(1, count);
  const offset = (index - (total - 1) / 2) * Math.min(3.4, (ARENA_SPAWN_RADIUS * 1.4) / total);
  const inward = team === 'team_merah' ? 1 : -1;
  return { x: base.x + inward * Math.abs(offset) * 0.12, z: base.z + offset };
}

/** Geser titik keluar dari prop cover, lalu clamp ke batas arena. */
export function resolveArenaCollision(x: number, z: number, radius: number): Vec2 {
  let resultX = x;
  let resultZ = z;

  for (const cover of ARENA_COVER) {
    const left = cover.x - cover.w / 2;
    const right = cover.x + cover.w / 2;
    const top = cover.z - cover.h / 2;
    const bottom = cover.z + cover.h / 2;
    const closestX = Math.max(left, Math.min(right, resultX));
    const closestZ = Math.max(top, Math.min(bottom, resultZ));
    const dx = resultX - closestX;
    const dz = resultZ - closestZ;
    const dist = Math.hypot(dx, dz);

    if (dist >= radius) continue;
    if (dist > 0.0001) {
      resultX = closestX + (dx / dist) * radius;
      resultZ = closestZ + (dz / dist) * radius;
      continue;
    }

    // Titik berada di dalam kotak: dorong ke sisi terdekat.
    const edges = [
      { value: resultX - left, axis: 'x' as const, target: left - radius },
      { value: right - resultX, axis: 'x' as const, target: right + radius },
      { value: resultZ - top, axis: 'z' as const, target: top - radius },
      { value: bottom - resultZ, axis: 'z' as const, target: bottom + radius },
    ];
    edges.sort((a, b) => a.value - b.value);
    const nearest = edges[0]!;
    if (nearest.axis === 'x') resultX = nearest.target;
    else resultZ = nearest.target;
  }

  return clampToMap(resultX, resultZ);
}

const LANE_PATHS: Record<MobaLane, Vec2[]> = {
  top: [
    { x: -58, z: -58 },
    { x: -70, z: -26 },
    { x: -66, z: 20 },
    { x: -38, z: 58 },
    { x: 10, z: 70 },
    { x: 58, z: 58 },
  ],
  mid: [
    { x: -58, z: -58 },
    { x: -30, z: -30 },
    { x: 0, z: 0 },
    { x: 30, z: 30 },
    { x: 58, z: 58 },
  ],
  bottom: [
    { x: -58, z: -58 },
    { x: -26, z: -70 },
    { x: 20, z: -66 },
    { x: 58, z: -38 },
    { x: 70, z: 10 },
    { x: 58, z: 58 },
  ],
};

export const MOBA_LANES: readonly MobaLane[] = ['top', 'mid', 'bottom'];
export const MOBA_LANE_LABELS: Record<MobaLane, string> = {
  top: 'Gang Utara',
  mid: 'Jalan Utama',
  bottom: 'Gang Selatan',
};

export function lanePoints(lane: MobaLane): readonly Vec2[] {
  return LANE_PATHS[lane];
}

export function laneLength(lane: MobaLane): number {
  const points = LANE_PATHS[lane];
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.z - points[i - 1]!.z);
  }
  return total;
}

/** Posisi pada jalur lane pada fraksi t (0 = base merah, 1 = base putih). */
export function pointOnLane(lane: MobaLane, t: number): Vec2 {
  const points = LANE_PATHS[lane];
  const target = Math.max(0, Math.min(1, t)) * laneLength(lane);
  let walked = 0;
  for (let i = 1; i < points.length; i += 1) {
    const from = points[i - 1]!;
    const to = points[i]!;
    const segment = Math.hypot(to.x - from.x, to.z - from.z);
    if (walked + segment >= target || i === points.length - 1) {
      const local = segment === 0 ? 0 : Math.min(1, (target - walked) / segment);
      return { x: from.x + (to.x - from.x) * local, z: from.z + (to.z - from.z) * local };
    }
    walked += segment;
  }
  return points[points.length - 1]!;
}

export interface MobaTurretSpot {
  id: string;
  team: TeamId;
  lane: MobaLane;
  tier: number;
  x: number;
  z: number;
}

/** 2 Gardu Ronda per lane per tim: tier 1 di depan, tier 2 dekat base. */
export const MOBA_TURRET_SPOTS: readonly MobaTurretSpot[] = (() => {
  const spots: MobaTurretSpot[] = [];
  for (const lane of MOBA_LANES) {
    const frontMerah = pointOnLane(lane, 0.36);
    const backMerah = pointOnLane(lane, 0.16);
    const frontPutih = pointOnLane(lane, 0.64);
    const backPutih = pointOnLane(lane, 0.84);
    spots.push(
      { id: `turret_merah_${lane}_1`, team: 'team_merah', lane, tier: 1, ...frontMerah },
      { id: `turret_putih_${lane}_1`, team: 'team_putih', lane, tier: 1, ...frontPutih },
      { id: `turret_merah_${lane}_2`, team: 'team_merah', lane, tier: 2, ...backMerah },
      { id: `turret_putih_${lane}_2`, team: 'team_putih', lane, tier: 2, ...backPutih },
    );
  }
  return spots;
})();

/** Semak persembunyian: hero di dalam tidak terlihat musuh (disembunyikan client). */
export const MOBA_BUSHES: ReadonlyArray<Vec2 & { r: number }> = [
  { x: -60, z: -8, r: 7 },
  { x: -30, z: 46, r: 6 },
  { x: 18, z: 66, r: 6 },
  { x: -20, z: -40, r: 7 },
  { x: 20, z: -18, r: 6 },
  { x: 40, z: 22, r: 7 },
  { x: -8, z: -60, r: 6 },
  { x: 46, z: -32, r: 6 },
  { x: 66, z: 20, r: 7 },
  { x: -46, z: 28, r: 6 },
];

/** Kali/sungai tengah: pita diagonal dari kiri-atas ke kanan-bawah. */
export const MOBA_RIVER = {
  from: { x: -MOBA_HALF, z: MOBA_HALF } as Vec2,
  to: { x: MOBA_HALF, z: -MOBA_HALF } as Vec2,
  width: 16,
};

export const MOBA_BOSS_SPAWN: Vec2 = { x: 0, z: 0 };

export function activeLanes(mode: '3v3' | '5v5' | '10v10'): MobaLane[] {
  return mode === '3v3' ? ['mid'] : [...MOBA_LANES];
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function inBush(x: number, z: number): boolean {
  return MOBA_BUSHES.some((bush) => Math.hypot(x - bush.x, z - bush.z) <= bush.r);
}

export function clampToMap(x: number, z: number): Vec2 {
  return {
    x: Math.max(-MOBA_BOUNDS, Math.min(MOBA_BOUNDS, x)),
    z: Math.max(-MOBA_BOUNDS, Math.min(MOBA_BOUNDS, z)),
  };
}
