import {
  FIGHT_BALANCE,
  type ClientMobaState,
  type MobaBossView,
  type MobaEffectView,
  type MobaHeroView,
  type MobaMinionView,
  type MobaProjectileView,
  type MobaTurretView,
  type MobaUnitView,
  type RoomMode,
  type TeamId,
} from '@pp/shared';

export type HeroState = MobaHeroView;
export type ProjectileState = MobaProjectileView;
export type EffectState = MobaEffectView;
export type BossState = MobaBossView;

export function createHeroState(): HeroState {
  return {
    id: '',
    kind: 'hero',
    name: '',
    heroId: '',
    team: 'team_merah',
    isBot: false,
    x: 0,
    z: 0,
    facing: 1,
    hp: 0,
    maxHp: 0,
    alive: true,
    level: 1,
    anim: 'idle',
    gold: 0,
    kills: 0,
    deaths: 0,
    assists: 0,
    xp: 0,
    items: [],
    cdBasic: 0,
    cdSkill1: 0,
    cdSkill2: 0,
    cdUltimate: 0,
    respawnIn: 0,
    vx: 0,
    vz: 0,
    stocks: FIGHT_BALANCE.stocksPerHero,
    maxStocks: FIGHT_BALANCE.stocksPerHero,
    grounded: true,
    jumpCount: 0,
    combo: 0,
    hitstunUntil: 0,
    dashUntil: 0,
    speedBoostUntil: 0,
    slowUntil: 0,
    stunUntil: 0,
  };
}

export function createProjectileState(): ProjectileState {
  return {
    id: '',
    team: 'team_merah',
    x: 0,
    z: 0,
    vx: 0,
    vz: 0,
    radius: 0.5,
    damage: 0,
    ttlMs: 0,
    color: '#ffffff',
    aoeRadius: 0,
    stunMs: 0,
    slowPercent: 0,
    slowMs: 0,
    ownerId: '',
  };
}

export function createEffectState(): EffectState {
  return {
    id: '',
    kind: 'hit',
    x: 0,
    z: 0,
    radius: 0,
    ttlMs: 0,
    color: '#ffffff',
  };
}

/**
 * State internal memakai Map supaya logika port dari MobaRoom tetap sama.
 * `toClient()` mengubahnya menjadi Record agar sesuai ClientMobaState (kontrak lama).
 */
export class MobaState {
  mode: RoomMode = '5v5';
  phase: ClientMobaState['phase'] = 'waiting';
  elapsedMs = 0;
  timeLeft = 0;
  scoreMerah = 0;
  scorePutih = 0;
  baseHpMerah = 0;
  baseHpPutih = 0;
  bossSpawnIn = 0;
  round = 1;
  intermissionMs = 0;
  roundWinner: TeamId | 'draw' | '' = '';
  winner: TeamId | 'draw' | '' = '';

  readonly heroes = new Map<string, HeroState>();
  readonly minions = new Map<string, MobaMinionView>();
  readonly turrets = new Map<string, MobaTurretView>();
  readonly bases = new Map<string, MobaUnitView>();
  readonly projectiles = new Map<string, ProjectileState>();
  readonly effects = new Map<string, EffectState>();
  boss: BossState | null = null;

  toClient(): ClientMobaState {
    return {
      mode: this.mode,
      phase: this.phase,
      elapsedMs: this.elapsedMs,
      timeLeft: this.timeLeft,
      scoreMerah: this.scoreMerah,
      scorePutih: this.scorePutih,
      baseHpMerah: this.baseHpMerah,
      baseHpPutih: this.baseHpPutih,
      bossSpawnIn: this.bossSpawnIn,
      round: this.round,
      intermissionMs: this.intermissionMs,
      roundWinner: this.roundWinner,
      winner: this.winner,
      heroes: Object.fromEntries(this.heroes),
      minions: Object.fromEntries(this.minions),
      turrets: Object.fromEntries(this.turrets),
      bases: Object.fromEntries(this.bases),
      boss: this.boss && this.boss.alive ? { ...this.boss, kind: 'boss' } : null,
      projectiles: Object.fromEntries(this.projectiles),
      effects: Object.fromEntries(this.effects),
    };
  }
}
