import {
  ARENA_BALANCE,
  ARENA_COVER,
  MOBA_BALANCE,
  MOBA_BOUNDS,
  MOBA_MESSAGES,
  PATCH_RATE_MS,
  ROOM_MODES,
  arenaSpawnPoint,
  distance,
  heroStatsAtThr,
  itemStatTotals,
  levelForXp,
  otherTeam,
  resolveArenaCollision,
  scoreKey,
  type HeroDefinition,
  type ItemStats,
  type MobaBuyMessage,
  type MobaJoinOptions,
  type MobaKoMessage,
  type MobaMatchEndMessage,
  type MobaMoveMessage,
  type MobaSkillKey,
  type MobaSkillMessage,
  type RoomMode,
  type TeamId,
} from '@pp/shared';
import { Room, type Client } from 'colyseus';
import { decideArenaBot, randomBotHeroId, randomBotName } from '../bot.js';
import { HEROES, HERO_LIST, ITEMS } from '../config.js';
import { EffectSchema, HeroSchema, MobaState, ProjectileSchema } from '../schema.js';

const TEAM_IDS: readonly TeamId[] = ['team_merah', 'team_putih'];
const SKILL_KEYS: readonly MobaSkillKey[] = ['basic', 'skill1', 'skill2', 'ultimate'];
const MAX_ITEMS = 6;
const HERO_COLLISION_RADIUS = 1.2;
const LEVEL_HP_BONUS = 28;
const LEVEL_DAMAGE_BONUS = 5;
const ASSIST_WINDOW_MS = 8000;

type ProjectileKind = 'basic' | 'skill';

interface MoveInput {
  dx: number;
  dz: number;
  aimX: number;
  aimZ: number;
}

interface HeroRuntime {
  definition: HeroDefinition;
  thrMaxHp: number;
  thrAttackDamage: number;
  moveSpeed: number;
  attackRange: number;
  attackCooldownMs: number;
  itemStats: ItemStats;
  move: MoveInput;
  readyAt: Record<MobaSkillKey, number>;
  respawnAt: number;
  protectedUntil: number;
  speedBoostMultiplier: number;
  slowPercent: number;
  damagers: Map<string, number>;
  animUntil: number;
  disconnected: boolean;
}

interface ProjectileRuntime {
  kind: ProjectileKind;
  skillType?: string;
}

interface SpawnProjectileInput {
  ownerId: string;
  team: TeamId;
  x: number;
  z: number;
  aimX: number;
  aimZ: number;
  damage: number;
  radius: number;
  aoeRadius: number;
  color: string;
  kind: ProjectileKind;
  ttlMs?: number;
  offset?: number;
  stunMs?: number;
  slowPercent?: number;
  slowMs?: number;
  skillType?: string;
}

interface DamageOptions {
  stunMs?: number;
  slowPercent?: number;
  slowMs?: number;
}

function finite(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function angleDifference(a: number, b: number): number {
  const diff = Math.abs(a - b);
  return diff > Math.PI ? Math.PI * 2 - diff : diff;
}

/** Arena PvP 2D: semua mode memakai satu arena terbuka, kemenangan dari skor kill. */
export class MobaRoom extends Room<{
  state: MobaState;
  metadata: { mode: RoomMode; humans: number };
}> {
  private mode: RoomMode = '5v5';
  private teamSize = 5;
  private humans = new Map<string, HeroSchema>();
  private heroRuntime = new Map<string, HeroRuntime>();
  private projectileRuntime = new Map<string, ProjectileRuntime>();
  private elapsedMs = 0;
  private ending = false;
  private entitySequence = 0;
  private botSequence = 0;
  private tickTimer?: { clear(): void };

  maxClients = 10;
  patchRate = PATCH_RATE_MS;
  autoDispose = true;

  onCreate(options: Partial<MobaJoinOptions> = {}): void {
    this.mode = options.mode && ROOM_MODES[options.mode] ? options.mode : '5v5';
    this.teamSize = ROOM_MODES[this.mode]!.teamSize;
    this.maxClients = this.teamSize * 2;

    this.state = new MobaState();
    this.state.mode = this.mode;
    this.state.phase = 'playing';
    this.state.timeLeft = ARENA_BALANCE.matchSeconds;
    this.state.bossSpawnIn = 0;
    this.metadata = { mode: this.mode, humans: 0 };

    this.onMessage<MobaMoveMessage>(MOBA_MESSAGES.MOVE, (client, message) =>
      this.onMove(client, message),
    );
    this.onMessage<MobaSkillMessage>(MOBA_MESSAGES.SKILL, (client, message) =>
      this.onSkill(client, message),
    );
    this.onMessage<MobaBuyMessage>(MOBA_MESSAGES.BUY, (client, message) =>
      this.onBuy(client, message),
    );

    this.tickTimer = this.clock.setInterval(() => this.tick(PATCH_RATE_MS), PATCH_RATE_MS);
    this.syncBots();
  }

  onJoin(client: Client, options: Partial<MobaJoinOptions> = {}): void {
    const team = this.pickHumanTeam();
    const requestedHeroId = options.loadout?.heroId;
    const heroId =
      typeof requestedHeroId === 'string' && HEROES[requestedHeroId]
        ? requestedHeroId
        : HERO_LIST[0]!.id;
    const thrLevel = Math.max(0, Math.floor(finite(options.loadout?.thrLevel)));
    const hero = this.createHero(
      client.sessionId,
      this.safeName(options.name, client.sessionId),
      team,
      heroId,
      thrLevel,
      false,
    );

    this.humans.set(client.sessionId, hero);
    this.syncBots();
    void this.setMatchmaking({ metadata: { mode: this.mode, humans: this.humans.size } });

    client.send(MOBA_MESSAGES.WELCOME, {
      id: hero.id,
      team: hero.team,
      heroId: hero.heroId,
      roomId: this.roomId,
      mode: this.mode,
    });
  }

  onLeave(client: Client): void {
    const hero = this.humans.get(client.sessionId);
    if (hero) {
      const runtime = this.heroRuntime.get(hero.id);
      if (runtime) runtime.disconnected = true;
      this.humans.delete(client.sessionId);
      this.state.heroes.delete(hero.id);
      this.heroRuntime.delete(hero.id);
      this.clearOwnerReferences(hero.id);
    }
    void this.setMatchmaking({ metadata: { mode: this.mode, humans: this.humans.size } });
    this.syncBots();
  }

  onDispose(): void {
    this.tickTimer?.clear();
    this.clock.clear();
    this.humans.clear();
    this.heroRuntime.clear();
    this.projectileRuntime.clear();
  }

  // ------------------------------------------------------------- setup / join

  private safeName(name: unknown, fallback: string): string {
    const cleaned = typeof name === 'string' ? name.trim().slice(0, 16) : '';
    return cleaned || `Warga ${fallback.slice(0, 4)}`;
  }

  private pickHumanTeam(): TeamId {
    let merah = 0;
    let putih = 0;
    for (const hero of this.humans.values()) {
      if (hero.team === 'team_merah') merah += 1;
      else putih += 1;
    }
    if (merah < putih) return 'team_merah';
    if (putih < merah) return 'team_putih';
    return merah % 2 === 0 ? 'team_merah' : 'team_putih';
  }

  private teamFacing(team: TeamId): number {
    return team === 'team_merah' ? 0 : Math.PI;
  }

  private createHero(
    id: string,
    name: string,
    team: TeamId,
    heroId: string,
    thrLevel: number,
    isBot: boolean,
  ): HeroSchema {
    const definition = HEROES[heroId] ?? HERO_LIST[0]!;
    const thrStats = heroStatsAtThr(definition, thrLevel);
    let existing = 0;
    for (const hero of this.state.heroes.values()) if (hero.team === team) existing += 1;
    const spawn = arenaSpawnPoint(team, existing, this.teamSize);

    const hero = new HeroSchema();
    hero.id = id;
    hero.name = name;
    hero.heroId = definition.id;
    hero.team = team;
    hero.isBot = isBot;
    hero.x = spawn.x;
    hero.z = spawn.z;
    hero.facing = this.teamFacing(team);
    hero.maxHp = thrStats.maxHp;
    hero.hp = thrStats.maxHp;
    hero.alive = true;
    hero.level = 1;
    hero.anim = 'idle';
    hero.items.clear();

    const runtime: HeroRuntime = {
      definition,
      thrMaxHp: thrStats.maxHp,
      thrAttackDamage: thrStats.attackDamage,
      moveSpeed: definition.baseStats.moveSpeed,
      attackRange: definition.baseStats.attackRange,
      attackCooldownMs: definition.baseStats.attackCooldownMs,
      itemStats: itemStatTotals([], ITEMS),
      move: {
        dx: 0,
        dz: 0,
        aimX: spawn.x + Math.cos(hero.facing),
        aimZ: spawn.z + Math.sin(hero.facing),
      },
      readyAt: { basic: 0, skill1: 0, skill2: 0, ultimate: 0 },
      respawnAt: 0,
      protectedUntil: this.elapsedMs + ARENA_BALANCE.spawnProtectionMs,
      speedBoostMultiplier: 1,
      slowPercent: 0,
      damagers: new Map(),
      animUntil: 0,
      disconnected: false,
    };

    this.heroRuntime.set(id, runtime);
    this.state.heroes.set(id, hero);
    return hero;
  }

  private syncBots(): void {
    const needed: Record<TeamId, number> = { team_merah: 0, team_putih: 0 };
    for (const hero of this.humans.values()) needed[hero.team] += 1;
    needed.team_merah = Math.max(0, this.teamSize - needed.team_merah);
    needed.team_putih = Math.max(0, this.teamSize - needed.team_putih);

    const bots: Record<TeamId, HeroSchema[]> = { team_merah: [], team_putih: [] };
    for (const hero of this.state.heroes.values()) {
      if (hero.isBot) bots[hero.team].push(hero);
    }

    for (const team of TEAM_IDS) {
      const excess = bots[team].length - needed[team];
      for (let i = 0; i < excess; i += 1) {
        const bot = bots[team].pop()!;
        this.state.heroes.delete(bot.id);
        this.heroRuntime.delete(bot.id);
      }
    }

    for (const team of TEAM_IDS) {
      for (let i = bots[team].length; i < needed[team]; i += 1) {
        const sequence = ++this.botSequence;
        this.createHero(
          `bot-${sequence}`,
          randomBotName(sequence - 1),
          team,
          randomBotHeroId(),
          Math.floor(Math.random() * 4),
          true,
        );
      }
    }
  }

  private clearOwnerReferences(ownerId: string): void {
    for (const runtime of this.heroRuntime.values()) runtime.damagers.delete(ownerId);
  }

  // ------------------------------------------------------------------ input

  private onMove(client: Client, message: MobaMoveMessage): void {
    const hero = this.state.heroes.get(client.sessionId);
    const runtime = this.heroRuntime.get(client.sessionId);
    if (!hero || !runtime || !hero.alive) return;

    const msg = message as Partial<MobaMoveMessage> | undefined;
    const rawDx = finite(msg?.dx);
    const rawDz = finite(msg?.dz);
    const length = Math.hypot(rawDx, rawDz);
    runtime.move = {
      dx: length > 0.001 ? rawDx / length : 0,
      dz: length > 0.001 ? rawDz / length : 0,
      aimX: finite(msg?.aimX, hero.x + Math.cos(hero.facing)),
      aimZ: finite(msg?.aimZ, hero.z + Math.sin(hero.facing)),
    };
  }

  private onSkill(client: Client, message: MobaSkillMessage): void {
    const hero = this.state.heroes.get(client.sessionId);
    if (!hero || !hero.alive) return;
    const msg = message as Partial<MobaSkillMessage> | undefined;
    const key = msg?.key;
    if (!key || !SKILL_KEYS.includes(key)) return;
    this.castSkill(
      hero,
      key,
      finite(msg?.aimX, hero.x + Math.cos(hero.facing) * 4),
      finite(msg?.aimZ, hero.z + Math.sin(hero.facing) * 4),
    );
  }

  private onBuy(client: Client, message: MobaBuyMessage): void {
    const hero = this.state.heroes.get(client.sessionId);
    if (!hero) return;
    const msg = message as Partial<MobaBuyMessage> | undefined;
    if (msg?.itemId) this.buyItem(hero, msg.itemId);
  }

  // -------------------------------------------------------------- simulation

  private tick(deltaMs: number): void {
    if (this.state.phase !== 'playing') return;
    this.elapsedMs += deltaMs;
    this.state.elapsedMs = this.elapsedMs;
    this.state.timeLeft = Math.max(
      0,
      Math.ceil(ARENA_BALANCE.matchSeconds - this.elapsedMs / 1000),
    );
    const dt = Math.min(deltaMs, 100) / 1000;

    this.updateHeroes(dt);
    this.updateProjectiles(deltaMs, dt);
    this.updateEffects(deltaMs);

    if (this.state.timeLeft <= 0) this.finishMatch('timeout');
    else if (
      this.state.scoreMerah >= ARENA_BALANCE.scoreLimit ||
      this.state.scorePutih >= ARENA_BALANCE.scoreLimit
    ) {
      this.finishMatch('scorelimit');
    }
  }

  private updateHeroes(dt: number): void {
    for (const hero of this.state.heroes.values()) {
      const runtime = this.heroRuntime.get(hero.id);
      if (!runtime) continue;

      if (hero.isBot) {
        const intent = decideArenaBot(hero, { state: this.state });
        runtime.move = {
          dx: finite(intent.dx),
          dz: finite(intent.dz),
          aimX: finite(intent.aimX, hero.x + Math.cos(hero.facing)),
          aimZ: finite(intent.aimZ, hero.z + Math.sin(hero.facing)),
        };
        if (intent.skill) this.castSkill(hero, intent.skill, intent.aimX, intent.aimZ);
        if (intent.buyItemId) this.buyItem(hero, intent.buyItemId);
      }

      hero.cdBasic = Math.max(0, runtime.readyAt.basic - this.elapsedMs);
      hero.cdSkill1 = Math.max(0, runtime.readyAt.skill1 - this.elapsedMs);
      hero.cdSkill2 = Math.max(0, runtime.readyAt.skill2 - this.elapsedMs);
      hero.cdUltimate = Math.max(0, runtime.readyAt.ultimate - this.elapsedMs);

      if (!hero.alive) {
        const remaining = Math.max(0, runtime.respawnAt - this.elapsedMs);
        hero.respawnIn = remaining;
        if (remaining <= 0) this.respawnHero(hero, runtime);
        continue;
      }

      let moving = false;
      const stunned = hero.stunUntil > this.elapsedMs;
      if (!stunned) {
        let speed = runtime.moveSpeed + runtime.itemStats.moveSpeed;
        if (hero.speedBoostUntil > this.elapsedMs) speed *= runtime.speedBoostMultiplier;
        if (hero.slowUntil > this.elapsedMs) speed *= Math.max(0.2, 1 - runtime.slowPercent);
        const length = Math.hypot(runtime.move.dx, runtime.move.dz);
        if (length > 0.001) {
          const step = speed * dt;
          const next = resolveArenaCollision(
            hero.x + (runtime.move.dx / length) * step,
            hero.z + (runtime.move.dz / length) * step,
            HERO_COLLISION_RADIUS,
          );
          hero.x = next.x;
          hero.z = next.z;
          const aimX = runtime.move.aimX - hero.x;
          const aimZ = runtime.move.aimZ - hero.z;
          if (Math.hypot(aimX, aimZ) > 0.1) hero.facing = Math.atan2(aimZ, aimX);
          else hero.facing = Math.atan2(runtime.move.dz, runtime.move.dx);
          moving = true;
        }
      }

      if (runtime.itemStats.hpRegen > 0 && hero.hp < hero.maxHp) {
        hero.hp = Math.min(hero.maxHp, hero.hp + runtime.itemStats.hpRegen * dt);
      }
      if (this.elapsedMs >= runtime.animUntil) hero.anim = moving ? 'walk' : 'idle';
    }
  }

  private respawnHero(hero: HeroSchema, runtime: HeroRuntime): void {
    let existing = 0;
    for (const other of this.state.heroes.values()) if (other.team === hero.team) existing += 1;
    const spawn = arenaSpawnPoint(hero.team, existing % this.teamSize, this.teamSize);
    hero.x = spawn.x;
    hero.z = spawn.z;
    hero.facing = this.teamFacing(hero.team);
    hero.hp = this.maxHpFor(hero, runtime);
    hero.maxHp = hero.hp;
    hero.alive = true;
    hero.anim = 'idle';
    hero.respawnIn = 0;
    runtime.respawnAt = 0;
    runtime.protectedUntil = this.elapsedMs + ARENA_BALANCE.spawnProtectionMs;
    runtime.damagers.clear();
    runtime.animUntil = 0;
    runtime.move = {
      dx: 0,
      dz: 0,
      aimX: spawn.x + Math.cos(hero.facing),
      aimZ: spawn.z + Math.sin(hero.facing),
    };
  }

  // ------------------------------------------------------------------ combat

  private castSkill(hero: HeroSchema, key: MobaSkillKey, aimX: number, aimZ: number): void {
    const runtime = this.heroRuntime.get(hero.id);
    if (!runtime || !hero.alive || this.state.phase !== 'playing') return;
    if (hero.level < (MOBA_BALANCE.skillUnlockLevel[key] ?? 1)) return;
    if (this.elapsedMs < runtime.readyAt[key]) return;

    const targetX = finite(aimX, hero.x + Math.cos(hero.facing) * 4);
    const targetZ = finite(aimZ, hero.z + Math.sin(hero.facing) * 4);
    const dx = targetX - hero.x;
    const dz = targetZ - hero.z;
    const length = Math.hypot(dx, dz);
    const dirX = length > 0.001 ? dx / length : Math.cos(hero.facing);
    const dirZ = length > 0.001 ? dz / length : Math.sin(hero.facing);
    hero.facing = Math.atan2(dirZ, dirX);

    if (key === 'basic') {
      const speedFactor = 1 + Math.max(0, runtime.itemStats.attackSpeedPercent);
      runtime.readyAt.basic = this.elapsedMs + runtime.attackCooldownMs / speedFactor;
      this.setHeroAnim(hero, 'attack', 220);
      const damage = this.attackDamageFor(hero, runtime) + runtime.itemStats.bonusDamage;
      this.addEffect(
        'hit',
        hero.x + dirX * 1.5,
        hero.z + dirZ * 1.5,
        2,
        ARENA_BALANCE.effectTtlMs,
        runtime.definition.colorTheme,
      );
      if (runtime.attackRange > 4) {
        this.spawnProjectile({
          ownerId: hero.id,
          team: hero.team,
          x: hero.x,
          z: hero.z,
          aimX: hero.x + dirX * runtime.attackRange,
          aimZ: hero.z + dirZ * runtime.attackRange,
          damage,
          radius: 0.9,
          aoeRadius: 0.9,
          color: runtime.definition.colorTheme,
          kind: 'basic',
          ttlMs: Math.max(250, (runtime.attackRange / ARENA_BALANCE.projectileSpeed) * 1000),
          offset: 1.2,
        });
      } else {
        const target = this.findNearestEnemyHero(
          hero.x + dirX * runtime.attackRange * 0.5,
          hero.z + dirZ * runtime.attackRange * 0.5,
          runtime.attackRange + 1,
          hero.team,
        );
        if (target) this.applyDamage(target, damage, hero.id);
      }
      return;
    }

    const skill = runtime.definition.skills[key];
    const cdr = Math.min(0.75, Math.max(0, runtime.itemStats.cdrPercent));
    runtime.readyAt[key] = this.elapsedMs + Math.max(200, skill.cooldownMs * (1 - cdr));
    this.setHeroAnim(hero, 'cast', 260);
    const damage = this.skillDamage(hero, runtime, skill.damage);
    const aoeFactor = runtime.itemStats.aoeMultiplier > 0 ? runtime.itemStats.aoeMultiplier : 1;
    const radius = skill.radius * Math.max(1, aoeFactor);
    const color = runtime.definition.colorTheme;

    switch (skill.type) {
      case 'cone_damage': {
        const range = Math.max(skill.range, 4);
        for (const target of this.enemiesInRadius(hero.x, hero.z, range, hero.team)) {
          const angle = Math.atan2(target.z - hero.z, target.x - hero.x);
          if (angleDifference(angle, hero.facing) <= Math.PI / 3) {
            this.applyDamage(target, damage, hero.id);
          }
        }
        this.addEffect(
          'hit',
          hero.x + dirX * range * 0.5,
          hero.z + dirZ * range * 0.5,
          range * 0.7,
          ARENA_BALANCE.effectTtlMs,
          color,
        );
        break;
      }
      case 'dash_buff': {
        const dash = Math.max(skill.range, 8);
        const destination = resolveArenaCollision(
          hero.x + dirX * dash,
          hero.z + dirZ * dash,
          HERO_COLLISION_RADIUS,
        );
        hero.x = destination.x;
        hero.z = destination.z;
        hero.speedBoostUntil = this.elapsedMs + Math.max(500, skill.durationMs);
        runtime.speedBoostMultiplier = skill.speedBoost > 0 ? skill.speedBoost : 1.5;
        this.addEffect('heal', hero.x, hero.z, 3, ARENA_BALANCE.effectTtlMs, color);
        break;
      }
      case 'aoe_spin': {
        for (const target of this.enemiesInRadius(hero.x, hero.z, Math.max(radius, 3), hero.team)) {
          this.applyDamage(target, damage, hero.id);
        }
        this.addEffect(
          'explosion',
          hero.x,
          hero.z,
          Math.max(radius, 3),
          ARENA_BALANCE.effectTtlMs,
          color,
        );
        break;
      }
      case 'aoe_stun': {
        const center = this.skillCenter(hero, targetX, targetZ, skill.range);
        for (const target of this.enemiesInRadius(center.x, center.z, radius, hero.team)) {
          this.applyDamage(target, damage, hero.id, { stunMs: skill.stunMs });
        }
        this.addEffect(
          'explosion',
          center.x,
          center.z,
          Math.max(radius, 2),
          ARENA_BALANCE.effectTtlMs,
          color,
        );
        break;
      }
      case 'aoe_slow': {
        const center = this.skillCenter(hero, targetX, targetZ, skill.range);
        for (const target of this.enemiesInRadius(center.x, center.z, radius, hero.team)) {
          this.applyDamage(target, damage, hero.id, {
            slowPercent: skill.slowPercent,
            slowMs: skill.durationMs,
          });
        }
        this.addEffect(
          'explosion',
          center.x,
          center.z,
          Math.max(radius, 2),
          ARENA_BALANCE.effectTtlMs,
          color,
        );
        break;
      }
      case 'shockwave_knockback': {
        const center = this.skillCenter(hero, targetX, targetZ, skill.range);
        const knockback = skill.knockback > 0 ? skill.knockback : 3;
        for (const target of this.enemiesInRadius(center.x, center.z, radius, hero.team)) {
          this.applyDamage(target, damage, hero.id);
          const kx = target.x - center.x;
          const kz = target.z - center.z;
          const kLen = Math.hypot(kx, kz) || 1;
          const pushed = resolveArenaCollision(
            target.x + (kx / kLen) * knockback,
            target.z + (kz / kLen) * knockback,
            HERO_COLLISION_RADIUS,
          );
          target.x = pushed.x;
          target.z = pushed.z;
        }
        this.addEffect('explosion', center.x, center.z, radius, ARENA_BALANCE.effectTtlMs, color);
        break;
      }
      case 'line_skillshot': {
        const reach = Math.max(skill.range, 8);
        this.spawnProjectile({
          ownerId: hero.id,
          team: hero.team,
          x: hero.x,
          z: hero.z,
          aimX: hero.x + dirX * reach,
          aimZ: hero.z + dirZ * reach,
          damage,
          radius: Math.max(0.8, skill.radius),
          aoeRadius: Math.max(1, radius),
          color,
          kind: 'skill',
          skillType: skill.type,
          ttlMs: Math.max(300, (reach / ARENA_BALANCE.projectileSpeed) * 1000),
          offset: 1.2,
          stunMs: skill.stunMs,
          slowPercent: skill.slowPercent,
          slowMs: skill.durationMs,
        });
        break;
      }
      case 'long_range_artillery': {
        const reach = Math.min(length || skill.range, skill.range);
        this.spawnProjectile({
          ownerId: hero.id,
          team: hero.team,
          x: hero.x,
          z: hero.z,
          aimX: hero.x + dirX * reach,
          aimZ: hero.z + dirZ * reach,
          damage,
          radius: 1.4,
          aoeRadius: Math.max(2, radius),
          color,
          kind: 'skill',
          skillType: skill.type,
          ttlMs: Math.max(400, (reach / ARENA_BALANCE.projectileSpeed) * 1000 + 120),
          offset: 1.5,
          stunMs: skill.stunMs,
          slowPercent: skill.slowPercent,
          slowMs: skill.durationMs,
        });
        break;
      }
      default: {
        const center = this.skillCenter(hero, targetX, targetZ, skill.range);
        for (const target of this.enemiesInRadius(center.x, center.z, Math.max(radius, 2), hero.team)) {
          this.applyDamage(target, damage, hero.id);
        }
        this.addEffect(
          'explosion',
          center.x,
          center.z,
          Math.max(radius, 2),
          ARENA_BALANCE.effectTtlMs,
          color,
        );
        break;
      }
    }
  }

  private skillCenter(
    hero: HeroSchema,
    aimX: number,
    aimZ: number,
    range: number,
  ): { x: number; z: number } {
    if (range <= 0) return { x: hero.x, z: hero.z };
    const dx = aimX - hero.x;
    const dz = aimZ - hero.z;
    const length = Math.hypot(dx, dz);
    if (length < 0.001) return { x: hero.x + range, z: hero.z };
    const reach = Math.min(length, range);
    return { x: hero.x + (dx / length) * reach, z: hero.z + (dz / length) * reach };
  }

  private maxHpFor(hero: HeroSchema, runtime: HeroRuntime): number {
    return runtime.thrMaxHp + (hero.level - 1) * LEVEL_HP_BONUS + runtime.itemStats.bonusHp;
  }

  private attackDamageFor(hero: HeroSchema, runtime: HeroRuntime): number {
    return runtime.thrAttackDamage + (hero.level - 1) * LEVEL_DAMAGE_BONUS;
  }

  private skillDamage(hero: HeroSchema, runtime: HeroRuntime, base: number): number {
    return base + this.attackDamageFor(hero, runtime) * 0.35 + runtime.itemStats.bonusDamage;
  }

  private buyItem(hero: HeroSchema, itemId: unknown): void {
    if (typeof itemId !== 'string') return;
    const item = ITEMS[itemId];
    if (!item || hero.items.length >= MAX_ITEMS || hero.gold < item.cost) return;
    const runtime = this.heroRuntime.get(hero.id);
    if (!runtime) return;

    const ratio = hero.hp / Math.max(1, hero.maxHp);
    hero.gold -= item.cost;
    hero.items.push(item.id);
    runtime.itemStats = itemStatTotals([...hero.items], ITEMS);
    hero.maxHp = this.maxHpFor(hero, runtime);
    hero.hp = Math.max(1, Math.min(hero.maxHp, hero.maxHp * ratio));
    this.addEffect('gold', hero.x, hero.z, 3, ARENA_BALANCE.effectTtlMs, '#ffd54f');
  }

  private grantXp(hero: HeroSchema, amount: number): void {
    const runtime = this.heroRuntime.get(hero.id);
    if (!runtime || amount <= 0) return;
    hero.xp += amount;
    const nextLevel = Math.min(MOBA_BALANCE.maxLevel, levelForXp(hero.xp));
    if (nextLevel <= hero.level) return;
    const gained = nextLevel - hero.level;
    hero.level = nextLevel;
    hero.maxHp = this.maxHpFor(hero, runtime);
    hero.hp = Math.min(hero.maxHp, hero.hp + 60 * gained);
    this.addEffect('levelup', hero.x, hero.z, 4, ARENA_BALANCE.effectTtlMs, '#fff176');
  }

  // -------------------------------------------------------------- projectiles

  private spawnProjectile(input: SpawnProjectileInput): void {
    const dx = input.aimX - input.x;
    const dz = input.aimZ - input.z;
    const length = Math.hypot(dx, dz);
    const dirX = length > 0.001 ? dx / length : 1;
    const dirZ = length > 0.001 ? dz / length : 0;
    const offset = input.offset ?? 0.5;
    const projectile = new ProjectileSchema();
    projectile.id = `prj-${++this.entitySequence}`;
    projectile.team = input.team;
    projectile.x = input.x + dirX * offset;
    projectile.z = input.z + dirZ * offset;
    projectile.vx = dirX * ARENA_BALANCE.projectileSpeed;
    projectile.vz = dirZ * ARENA_BALANCE.projectileSpeed;
    projectile.radius = input.radius;
    projectile.damage = input.damage;
    projectile.ttlMs =
      input.ttlMs ?? Math.max(250, (length / ARENA_BALANCE.projectileSpeed) * 1000 + 100);
    projectile.color = input.color;
    projectile.aoeRadius = input.aoeRadius;
    projectile.stunMs = input.stunMs ?? 0;
    projectile.slowPercent = input.slowPercent ?? 0;
    projectile.slowMs = input.slowMs ?? 0;
    projectile.ownerId = input.ownerId;
    this.state.projectiles.set(projectile.id, projectile);
    this.projectileRuntime.set(projectile.id, {
      kind: input.kind,
      skillType: input.skillType,
    });
  }

  private updateProjectiles(deltaMs: number, dt: number): void {
    const expired: string[] = [];
    for (const projectile of this.state.projectiles.values()) {
      const runtime = this.projectileRuntime.get(projectile.id);
      if (!runtime) {
        expired.push(projectile.id);
        continue;
      }
      projectile.x += projectile.vx * dt;
      projectile.z += projectile.vz * dt;
      projectile.ttlMs -= deltaMs;
      const outside =
        Math.abs(projectile.x) > MOBA_BOUNDS + 8 || Math.abs(projectile.z) > MOBA_BOUNDS + 8;
      const impact =
        projectile.ttlMs <= 0 ||
        outside ||
        this.insideCover(projectile.x, projectile.z, projectile.radius) ||
        this.projectileTargets(projectile, projectile.x, projectile.z, projectile.radius).length > 0;
      if (impact) {
        this.explodeProjectile(projectile);
        expired.push(projectile.id);
      }
    }
    for (const id of expired) {
      this.state.projectiles.delete(id);
      this.projectileRuntime.delete(id);
    }
  }

  private insideCover(x: number, z: number, radius: number): boolean {
    return ARENA_COVER.some(
      (cover) =>
        x >= cover.x - cover.w / 2 - radius &&
        x <= cover.x + cover.w / 2 + radius &&
        z >= cover.z - cover.h / 2 - radius &&
        z <= cover.z + cover.h / 2 + radius,
    );
  }

  private explodeProjectile(projectile: ProjectileSchema): void {
    const radius = Math.max(projectile.aoeRadius, projectile.radius, 1);
    for (const victim of this.projectileTargets(projectile, projectile.x, projectile.z, radius)) {
      this.applyDamage(victim, projectile.damage, projectile.ownerId, {
        stunMs: projectile.stunMs,
        slowPercent: projectile.slowPercent,
        slowMs: projectile.slowMs,
      });
    }
    this.addEffect(
      'explosion',
      projectile.x,
      projectile.z,
      radius,
      ARENA_BALANCE.effectTtlMs,
      projectile.color,
    );
  }

  private projectileTargets(
    projectile: ProjectileSchema,
    x: number,
    z: number,
    radius: number,
  ): HeroSchema[] {
    const result: HeroSchema[] = [];
    for (const hero of this.state.heroes.values()) {
      if (!hero.alive || hero.team === projectile.team) continue;
      if (distance({ x, z }, hero) <= radius + HERO_COLLISION_RADIUS) result.push(hero);
    }
    return result;
  }

  // ---------------------------------------------------------------- targeting

  private enemiesInRadius(
    x: number,
    z: number,
    radius: number,
    team: TeamId,
  ): HeroSchema[] {
    const result: HeroSchema[] = [];
    for (const hero of this.state.heroes.values()) {
      if (!hero.alive || hero.team === team) continue;
      if (distance({ x, z }, hero) <= radius + HERO_COLLISION_RADIUS) result.push(hero);
    }
    return result;
  }

  private findNearestEnemyHero(
    x: number,
    z: number,
    range: number,
    team: TeamId,
  ): HeroSchema | undefined {
    let best: HeroSchema | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const hero of this.state.heroes.values()) {
      if (!hero.alive || hero.team === team) continue;
      const d = distance({ x, z }, hero);
      if (d <= range + HERO_COLLISION_RADIUS && d < bestDistance) {
        bestDistance = d;
        best = hero;
      }
    }
    return best;
  }

  // ------------------------------------------------------------ damage / xp

  private applyDamage(
    target: HeroSchema,
    amount: number,
    attackerId?: string,
    options: DamageOptions = {},
  ): void {
    if (!target.alive || amount <= 0 || this.state.phase !== 'playing') return;
    if (attackerId && attackerId !== target.id && this.elapsedMs < (this.heroRuntime.get(target.id)?.protectedUntil ?? 0)) {
      return;
    }

    let final = amount;
    const runtime = this.heroRuntime.get(target.id);
    if (runtime) {
      final *= Math.max(0.05, 1 - Math.min(0.8, Math.max(0, runtime.itemStats.damageReduction)));
      if (attackerId && attackerId !== target.id) runtime.damagers.set(attackerId, this.elapsedMs);
    }

    target.hp = Math.max(0, target.hp - final);
    this.addEffect('hit', target.x, target.z, 2, ARENA_BALANCE.effectTtlMs, '#fff176');

    if (final > 0) {
      if (options.stunMs && options.stunMs > 0) {
        target.stunUntil = Math.max(target.stunUntil, this.elapsedMs + options.stunMs);
      }
      if (options.slowMs && options.slowMs > 0 && options.slowPercent && options.slowPercent > 0) {
        target.slowUntil = Math.max(target.slowUntil, this.elapsedMs + options.slowMs);
        if (runtime) runtime.slowPercent = Math.max(runtime.slowPercent, options.slowPercent);
      }
    }
    if (target.hp <= 0) this.handleDeath(target, attackerId, final);
  }

  private handleDeath(target: HeroSchema, attackerId: string | undefined, amount: number): void {
    const runtime = this.heroRuntime.get(target.id);
    if (!runtime) return;
    const winnerTeam = otherTeam(target.team);

    target.alive = false;
    target.hp = 0;
    target.anim = 'dead';
    target.deaths += 1;
    runtime.respawnAt =
      this.elapsedMs + ARENA_BALANCE.respawnBaseMs + target.level * ARENA_BALANCE.respawnPerLevelMs;
    target.respawnIn = runtime.respawnAt - this.elapsedMs;

    const killer = attackerId ? this.state.heroes.get(attackerId) : undefined;
    if (killer && killer.team === winnerTeam) {
      killer.kills += 1;
      killer.gold += ARENA_BALANCE.heroGold;
      this.grantXp(killer, ARENA_BALANCE.heroXp);
    }

    for (const [helperId, hitAt] of runtime.damagers) {
      if (helperId === attackerId || this.elapsedMs - hitAt > ASSIST_WINDOW_MS) continue;
      const helper = this.state.heroes.get(helperId);
      if (!helper || helper.team !== winnerTeam) continue;
      helper.assists += 1;
      helper.gold += Math.round(ARENA_BALANCE.heroGold * 0.4);
      this.grantXp(helper, ARENA_BALANCE.assistXp);
    }
    runtime.damagers.clear();

    this.state[scoreKey(winnerTeam)] += 1;
    const ko: MobaKoMessage = {
      x: target.x,
      z: target.z,
      attackerId,
      victimId: target.id,
      amount,
    };
    this.broadcast(MOBA_MESSAGES.KO, ko);
    this.addEffect('ko', target.x, target.z, 4, ARENA_BALANCE.effectTtlMs, '#d32f2f');
  }

  private setHeroAnim(hero: HeroSchema, anim: string, durationMs: number): void {
    hero.anim = anim;
    const runtime = this.heroRuntime.get(hero.id);
    if (runtime) runtime.animUntil = this.elapsedMs + durationMs;
  }

  private addEffect(
    kind: string,
    x: number,
    z: number,
    radius: number,
    ttlMs: number,
    color: string,
  ): void {
    const effect = new EffectSchema();
    effect.id = `fx-${++this.entitySequence}`;
    effect.kind = kind;
    effect.x = x;
    effect.z = z;
    effect.radius = radius;
    effect.ttlMs = ttlMs;
    effect.color = color;
    this.state.effects.set(effect.id, effect);
    if (this.state.effects.size > 80) {
      const oldest = this.state.effects.values().next().value;
      if (oldest) this.state.effects.delete(oldest.id);
    }
  }

  private updateEffects(deltaMs: number): void {
    const expired: string[] = [];
    for (const effect of this.state.effects.values()) {
      effect.ttlMs -= deltaMs;
      if (effect.ttlMs <= 0) expired.push(effect.id);
    }
    for (const id of expired) this.state.effects.delete(id);
  }

  // ------------------------------------------------------------------- match

  private finishMatch(reason: 'timeout' | 'scorelimit'): void {
    if (this.ending) return;
    this.ending = true;
    this.state.phase = 'finished';

    const winner =
      this.state.scoreMerah === this.state.scorePutih
        ? 'draw'
        : this.state.scoreMerah > this.state.scorePutih
          ? 'team_merah'
          : 'team_putih';

    const rewards: Record<string, number> = {};
    for (const hero of this.humans.values()) {
      let reward = 60 + hero.kills * 8 + hero.assists * 3;
      if (winner === hero.team) reward += 120;
      rewards[hero.id] = reward;
    }

    const message: MobaMatchEndMessage = {
      winner,
      scoreMerah: this.state.scoreMerah,
      scorePutih: this.state.scorePutih,
      rewards,
      reason,
    };
    this.broadcast(MOBA_MESSAGES.MATCH_END, message);
  }
}
