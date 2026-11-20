/** Kontrak bersama client <-> server untuk arena PvP 2D top-down. Tanpa dependensi engine. */
import type { RoomMode, TeamId } from './types.js';

export type MobaSkillKey = 'basic' | 'skill1' | 'skill2' | 'ultimate';
export type MobaUnitKind = 'hero' | 'minion' | 'turret' | 'base' | 'boss';
export type MobaLane = 'top' | 'mid' | 'bottom';
export type MobaAnim = 'idle' | 'walk' | 'attack' | 'cast' | 'dead';
export type MobaEffectKind =
  | 'explosion' | 'hit' | 'ko' | 'levelup' | 'gold' | 'turret_fire' | 'boss_spawn' | 'heal';

/* ------------------------------------------------------------------ catalog */

export interface MobaSkillDefinition {
  name: string;
  type: string;
  damage: number;
  range: number;
  radius: number;
  cooldownMs: number;
  stunMs: number;
  slowPercent: number;
  durationMs: number;
  speedBoost: number;
  knockback: number;
}

export interface HeroDefinition {
  id: string;
  name: string;
  role: string;
  portrait: string;
  colorTheme: string;
  baseStats: {
    maxHp: number;
    moveSpeed: number;
    attackDamage: number;
    attackRange: number;
    attackCooldownMs: number;
  };
  skills: {
    skill1: MobaSkillDefinition;
    skill2: MobaSkillDefinition;
    ultimate: MobaSkillDefinition;
  };
  thrUpgradeScaling: {
    maxLevel: number;
    baseCost: number;
    costMultiplier: number;
    hpBonusPerLevel: number;
    damageBonusPerLevel: number;
  };
}

export interface ItemStats {
  moveSpeed: number;
  cdrPercent: number;
  bonusDamage: number;
  bonusHp: number;
  damageReduction: number;
  attackSpeedPercent: number;
  hpRegen: number;
  aoeMultiplier: number;
}

export interface ItemDefinition {
  id: string;
  name: string;
  cost: number;
  description: string;
  stats: ItemStats;
}

export type HeroCatalog = Record<string, HeroDefinition>;
export type ItemCatalog = Record<string, ItemDefinition>;

/** Loadout permanen dari lobby (dibawa ke dalam match). */
export interface MobaLoadout {
  heroId: string;
  thrLevel: number;
}

/* ------------------------------------------------------------- runtime view */

export interface MobaUnitView {
  id: string;
  kind: MobaUnitKind;
  team: TeamId;
  x: number;
  z: number;
  facing: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  level: number;
  anim: MobaAnim;
  lane?: MobaLane;
  tier?: number;
}

export interface MobaHeroView extends MobaUnitView {
  kind: 'hero';
  heroId: string;
  name: string;
  isBot: boolean;
  gold: number;
  kills: number;
  deaths: number;
  assists: number;
  xp: number;
  items: string[];
  cdBasic: number;
  cdSkill1: number;
  cdSkill2: number;
  cdUltimate: number;
  respawnIn: number;
  /** Timestamp server (ms elapsed) untuk efek sementara. */
  speedBoostUntil: number;
  slowUntil: number;
  stunUntil: number;
}

export interface MobaMinionView extends MobaUnitView {
  kind: 'minion';
  lane: MobaLane;
}

export interface MobaTurretView extends MobaUnitView {
  kind: 'turret';
  lane: MobaLane;
  tier: number;
}

export interface MobaBossView extends MobaUnitView {
  kind: 'boss';
  respawnIn: number;
}

export interface MobaProjectileView {
  id: string;
  team: TeamId;
  x: number;
  z: number;
  vx: number;
  vz: number;
  radius: number;
  damage: number;
  ttlMs: number;
  color: string;
  aoeRadius: number;
  stunMs: number;
  slowPercent: number;
  slowMs: number;
  ownerId: string;
}

export interface MobaEffectView {
  id: string;
  kind: MobaEffectKind;
  x: number;
  z: number;
  radius: number;
  ttlMs: number;
  color: string;
}

/** Bentuk state yang dikonsumsi renderer/HUD (turunan dari schema Colyseus). */
export interface ClientMobaState {
  mode: RoomMode;
  phase: 'waiting' | 'playing' | 'finished';
  elapsedMs: number;
  timeLeft: number;
  scoreMerah: number;
  scorePutih: number;
  baseHpMerah: number;
  baseHpPutih: number;
  bossSpawnIn: number;
  heroes: Record<string, MobaHeroView>;
  minions: Record<string, MobaMinionView>;
  turrets: Record<string, MobaTurretView>;
  bases: Record<string, MobaUnitView>;
  boss: MobaBossView | null;
  projectiles: Record<string, MobaProjectileView>;
  effects: Record<string, MobaEffectView>;
}

/* ------------------------------------------------------------------ messages */

export const MOBA_MESSAGES = {
  MOVE: 'move',
  SKILL: 'skill',
  BUY: 'buy',
  MATCH_END: 'match_end',
  WELCOME: 'welcome',
  KO: 'ko',
} as const;

export interface MobaMoveMessage {
  dx: number;
  dz: number;
  aimX: number;
  aimZ: number;
}

export interface MobaSkillMessage {
  key: MobaSkillKey;
  aimX: number;
  aimZ: number;
}

export interface MobaBuyMessage {
  itemId: string;
}

export interface MobaJoinOptions {
  mode: RoomMode;
  name?: string;
  loadout?: MobaLoadout;
  fillBots?: boolean;
}

export interface MobaMatchEndMessage {
  winner: TeamId | 'draw';
  scoreMerah: number;
  scorePutih: number;
  rewards: Record<string, number>;
  reason: 'timeout' | 'scorelimit';
}

export interface MobaKoMessage {
  x: number;
  z: number;
  attackerId?: string;
  victimId?: string;
  amount?: number;
}
