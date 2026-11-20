/** Kontrak bersama client <-> server. Tidak boleh mengimpor kode Phaser/Colyseus. */

export type RoomMode = '3v3' | '5v5' | '10v10';
export type TeamId = 'team_merah' | 'team_putih';
export type WeaponType = 'melee' | 'thrown';
export type UpgradeKind = 'hp' | 'speed' | 'staminaRegen' | 'weapon';

export interface CharacterDefinition {
  id: string;
  name: string;
  description: string;
  assetKey: string;
  color: string;
  base: {
    maxHp: number;
    moveSpeed: number;
    staminaMax: number;
    staminaRegen: number;
  };
  upgradeCost: Record<'hp' | 'speed' | 'staminaRegen', UpgradeCost>;
}

export interface WeaponDefinition {
  id: string;
  name: string;
  description: string;
  type: WeaponType;
  assetKey: string;
  color: string;
  unlockCost: number;
  maxLevel: number;
  base: {
    damage: number;
    cooldownMs: number;
    staminaCost: number;
    range: number;
    radius: number;
    projectileSpeed: number;
    fuseMs: number;
    arcDegrees: number;
  };
  perLevel: {
    damage: number;
    radius: number;
    cooldownReduction: number;
  };
  upgradeCost: UpgradeCost;
}

export interface UpgradeCost {
  base: number;
  growth: number;
}

export interface CharacterCatalog {
  [id: string]: CharacterDefinition;
}

export interface WeaponCatalog {
  [id: string]: WeaponDefinition;
}

export interface CharacterUpgrades {
  hp: number;
  speed: number;
  staminaRegen: number;
}

export interface Loadout {
  characterId: string;
  weaponId: string;
  upgrades: CharacterUpgrades;
  weaponLevel: number;
}

export interface DerivedStats {
  maxHp: number;
  moveSpeed: number;
  staminaMax: number;
  staminaRegen: number;
  damage: number;
  attackRadius: number;
  cooldownMs: number;
  staminaCost: number;
  range: number;
  projectileSpeed: number;
  fuseMs: number;
  arcDegrees: number;
}

export interface PlayerView {
  id: string;
  name: string;
  team: TeamId;
  characterId: string;
  weaponId: string;
  weaponLevel: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: number;
  hp: number;
  maxHp: number;
  stamina: number;
  maxStamina: number;
  alive: boolean;
  soot: boolean;
  isBot: boolean;
  kills: number;
  koin: number;
}

export interface ProjectileView {
  id: string;
  ownerId: string;
  team: TeamId;
  weaponId: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  damage: number;
  fuseMs: number;
}

export type EffectKind = 'slash' | 'explosion' | 'hit' | 'ko';

export interface EffectView {
  id: string;
  kind: EffectKind;
  x: number;
  y: number;
  radius: number;
  ttlMs: number;
  color: string;
}

export interface BattleStateView {
  mode: RoomMode;
  phase: 'waiting' | 'playing' | 'finished';
  timeLeft: number;
  scoreMerah: number;
  scorePutih: number;
  players: Record<string, PlayerView>;
  projectiles: Record<string, ProjectileView>;
  effects: Record<string, EffectView>;
}

export interface MoveMessage {
  dx: number;
  dy: number;
  aimX: number;
  aimY: number;
}

export interface AttackMessage {
  aimX: number;
  aimY: number;
}

export interface JoinOptions {
  mode: RoomMode;
  name?: string;
  loadout?: Loadout;
  fillBots?: boolean;
}

export interface MatchEndMessage {
  winner: TeamId | 'draw';
  scoreMerah: number;
  scorePutih: number;
  rewards: Record<string, number>;
}

export interface EffectMessage {
  kind: 'ko' | 'hit' | 'explosion';
  x: number;
  y: number;
  attackerId?: string;
  victimId?: string;
  amount?: number;
}
