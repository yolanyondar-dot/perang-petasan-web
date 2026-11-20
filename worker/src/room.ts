import {
  FIGHT_BALANCE,
  MOBA_BALANCE,
  MOBA_MESSAGES,
  PATCH_RATE_MS,
  ROOM_MODES,
  clampFightX,
  fightSpawnPoint,
  heroStatsAtThr,
  itemStatTotals,
  landingPlatform,
  levelForXp,
  otherTeam,
  scoreKey,
  standingPlatform,
  type HeroDefinition,
  type ItemStats,
  type MobaAnim,
  type MobaBuyMessage,
  type MobaEffectKind,
  type MobaJoinOptions,
  type MobaKoMessage,
  type MobaMatchEndMessage,
  type MobaMoveMessage,
  type MobaSkillKey,
  type MobaSkillMessage,
  type RoomMode,
  type TeamId,
} from '@pp/shared';
import { json } from './http.js';
import { FIGHT_HERO_IDS, FIGHT_HERO_LIST, HEROES, ITEMS } from './catalog.js';
import { decideArenaBot, randomBotHeroId, randomBotName } from './bot.js';
import {
  createEffectState,
  createHeroState,
  createProjectileState,
  MobaState,
  type HeroState,
  type ProjectileState,
} from './state.js';
import type { WorkerEnv } from './types.js';

const TEAM_IDS: readonly TeamId[] = ['team_merah', 'team_putih'];
const SKILL_KEYS: readonly MobaSkillKey[] = ['basic', 'skill1', 'skill2', 'ultimate'];
const MAX_ITEMS = 6;
const HERO_RADIUS = 1.1;
const LEVEL_HP_BONUS = 28;
const LEVEL_DAMAGE_BONUS = 5;
const ASSIST_WINDOW_MS = 8000;

type ProjectileKind = 'basic' | 'skill';

interface MoveInput {
  dx: number;
  dz: number;
  jump: boolean;
  dash: boolean;
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
  prevJump: boolean;
  prevDash: boolean;
  readyAt: Record<MobaSkillKey, number>;
  respawnAt: number;
  protectedUntil: number;
  speedBoostMultiplier: number;
  slowPercent: number;
  damagers: Map<string, number>;
  animUntil: number;
  disconnected: boolean;
  lastBasicAt: number;
  comboResetAt: number;
  dashReadyAt: number;
}

interface ProjectileRuntime {
  kind: ProjectileKind;
  knockback: number;
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
  knockback?: number;
  skillType?: string;
}

interface DamageOptions {
  stunMs?: number;
  slowPercent?: number;
  slowMs?: number;
  knockback?: number;
  dirX?: number;
}

function finite(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function damp(current: number, target: number, lambda: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

function sign(value: number): number {
  return value >= 0 ? 1 : -1;
}

function sanitizeMode(value: unknown): RoomMode {
  return typeof value === 'string' && value in ROOM_MODES ? (value as RoomMode) : '5v5';
}

/**
 * Durable Object otoritatif—port langsung dari Colyseus MobaRoom.
 * Kolom state, physics, combat, bot, economy, dan round tetap sama.
 */
export class FightRoom implements DurableObject {
  private readonly env: WorkerEnv;
  private state: MobaState = new MobaState();
  private mode: RoomMode = '5v5';
  private teamSize = 5;
  private roomId = '';
  private humans = new Map<string, HeroState>();
  private clients = new Map<string, WebSocket>();
  private heroRuntime = new Map<string, HeroRuntime>();
  private projectileRuntime = new Map<string, ProjectileRuntime>();
  private elapsedMs = 0;
  private roundElapsedMs = 0;
  private intermissionLeftMs = 0;
  private ending = false;
  private entitySequence = 0;
  private botSequence = 0;
  private tickTimer: number | null = null;

  constructor(_state: DurableObjectState, env: WorkerEnv) {
    this.env = env;
    this.resetForNewMatch();
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      if (url.pathname === '/state') return json(this.state.toClient());
      return json({ ok: true, mode: this.mode, roomId: this.roomId });
    }

    const sessionId = url.searchParams.get('session') || crypto.randomUUID();
    const options: MobaJoinOptions = {
      mode: sanitizeMode(request.headers.get('x-pp-mode') ?? url.searchParams.get('mode')),
      name: request.headers.get('x-pp-name') ?? url.searchParams.get('name') ?? undefined,
      loadout: {
        heroId: request.headers.get('x-pp-hero') ?? url.searchParams.get('heroId') ?? 'bocil_sarung',
        thrLevel: finite(
          request.headers.get('x-pp-thr') ?? url.searchParams.get('thrLevel'),
          0,
        ),
      },
      fillBots: true,
    };
    this.roomId = request.headers.get('x-pp-room') ?? url.searchParams.get('roomId') ?? this.roomId;

    // Mode harus di-set SEBELUM reset, karena reset ikut mengisi state.mode.
    this.mode = options.mode;
    this.teamSize = ROOM_MODES[this.mode]!.teamSize;

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();

    if (this.clients.size === 0) this.resetForNewMatch();
    this.clients.set(sessionId, server);
    server.addEventListener('message', (event) => {
      this.onMessage(sessionId, String(event.data));
    });
    server.addEventListener('close', () => this.onClose(sessionId));

    this.startTick();
    this.join(sessionId, options, server);
    this.broadcastState();

    return new Response(null, { status: 101, webSocket: client });
  }

  // ------------------------------------------------------------- setup / join

  private resetForNewMatch(): void {
    this.state = new MobaState();
    this.state.mode = this.mode;
    this.state.phase = 'playing';
    this.state.round = 1;
    this.state.timeLeft = FIGHT_BALANCE.roundSeconds;
    this.state.bossSpawnIn = 0;
    this.humans.clear();
    this.heroRuntime.clear();
    this.projectileRuntime.clear();
    this.elapsedMs = 0;
    this.roundElapsedMs = 0;
    this.intermissionLeftMs = 0;
    this.ending = false;
    this.entitySequence = 0;
  }

  private startTick(): void {
    if (this.tickTimer !== null) return;
    this.tickTimer = setInterval(() => this.tick(PATCH_RATE_MS), PATCH_RATE_MS);
  }

  private stopTick(): void {
    if (this.tickTimer === null) return;
    clearInterval(this.tickTimer);
    this.tickTimer = null;
  }

  private join(sessionId: string, options: MobaJoinOptions, socket: WebSocket): void {
    const team = this.pickHumanTeam();
    const requestedHeroId = options.loadout?.heroId;
    const heroId =
      typeof requestedHeroId === 'string' &&
      FIGHT_HERO_IDS.includes(requestedHeroId as (typeof FIGHT_HERO_IDS)[number]) &&
      HEROES[requestedHeroId]
        ? requestedHeroId
        : FIGHT_HERO_LIST[0]!.id;
    const thrLevel = Math.max(0, Math.floor(finite(options.loadout?.thrLevel)));
    const hero = this.createHero(
      sessionId,
      this.safeName(options.name, sessionId),
      team,
      heroId,
      thrLevel,
      false,
    );

    this.humans.set(sessionId, hero);
    this.syncBots();
    this.sendTo(sessionId, MOBA_MESSAGES.WELCOME, {
      id: hero.id,
      team: hero.team,
      heroId: hero.heroId,
      roomId: this.roomId,
      mode: this.mode,
    });
    if (socket.readyState === WebSocket.OPEN) {
      // Welcome dikirim sebelum state pertama; tunggu sampai socket benar-benar siap.
    }
  }

  private async onClose(sessionId: string): Promise<void> {
    this.clients.delete(sessionId);
    const hero = this.humans.get(sessionId);
    if (hero) {
      const runtime = this.heroRuntime.get(hero.id);
      if (runtime) runtime.disconnected = true;
      this.humans.delete(sessionId);
      this.state.heroes.delete(hero.id);
      this.heroRuntime.delete(hero.id);
      this.clearOwnerReferences(hero.id);
    }
    this.syncBots();
    await this.notifyLeave();
    if (this.clients.size === 0) this.stopTick();
  }

  private async notifyLeave(): Promise<void> {
    if (!this.roomId) return;
    try {
      const matchmaker = this.env.MATCHMAKER.get(this.env.MATCHMAKER.idFromName('global'));
      await matchmaker.fetch('https://matchmaker.internal/room-update', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ roomId: this.roomId, mode: this.mode, delta: -1 }),
      });
    } catch {
      // Best effort: matchmaking tetap bisa dibersihkan lewat TTL sesi.
    }
  }

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
    return team === 'team_merah' ? 1 : -1;
  }

  private createHero(
    id: string,
    name: string,
    team: TeamId,
    heroId: string,
    thrLevel: number,
    isBot: boolean,
  ): HeroState {
    const definition = HEROES[heroId] ?? FIGHT_HERO_LIST[0]!;
    const thrStats = heroStatsAtThr(definition, thrLevel);
    let existing = 0;
    for (const hero of this.state.heroes.values()) if (hero.team === team) existing += 1;
    const spawn = fightSpawnPoint(team, existing, this.teamSize);

    const hero = createHeroState();
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
    hero.items.length = 0;
    hero.vx = 0;
    hero.vz = 0;
    hero.stocks = FIGHT_BALANCE.stocksPerHero;
    hero.maxStocks = FIGHT_BALANCE.stocksPerHero;
    hero.grounded = true;
    hero.jumpCount = 0;
    hero.combo = 0;
    hero.hitstunUntil = 0;
    hero.dashUntil = 0;

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
        jump: false,
        dash: false,
        aimX: spawn.x + this.teamFacing(team) * 4,
        aimZ: spawn.z + 1,
      },
      prevJump: false,
      prevDash: false,
      readyAt: { basic: 0, skill1: 0, skill2: 0, ultimate: 0 },
      respawnAt: 0,
      protectedUntil: this.elapsedMs + FIGHT_BALANCE.spawnProtectionMs,
      speedBoostMultiplier: 1,
      slowPercent: 0,
      damagers: new Map(),
      animUntil: 0,
      disconnected: false,
      lastBasicAt: -9999,
      comboResetAt: 0,
      dashReadyAt: 0,
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

    const bots: Record<TeamId, HeroState[]> = { team_merah: [], team_putih: [] };
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

  // ------------------------------------------------------------------ socket

  private sendTo(sessionId: string, type: string, data: unknown): void {
    const socket = this.clients.get(sessionId);
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    try {
      socket.send(JSON.stringify({ t: 'message', type, data }));
    } catch {
      // Socket bisa tertutup tepat saat broadcast; abaikan.
    }
  }

  private broadcast(type: string, data: unknown): void {
    for (const sessionId of this.clients.keys()) this.sendTo(sessionId, type, data);
  }

  private broadcastState(): void {
    const payload = JSON.stringify({ t: 'state', s: this.state.toClient() });
    for (const socket of this.clients.values()) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      try {
        socket.send(payload);
      } catch {
        // Abaikan socket yang baru saja terputus.
      }
    }
  }

  private onMessage(sessionId: string, raw: string): void {
    let envelope: { t?: string; data?: unknown };
    try {
      envelope = JSON.parse(raw) as { t?: string; data?: unknown };
    } catch {
      return;
    }
    switch (envelope.t) {
      case MOBA_MESSAGES.MOVE:
        this.onMove(sessionId, (envelope.data ?? {}) as MobaMoveMessage);
        break;
      case MOBA_MESSAGES.SKILL:
        this.onSkill(sessionId, (envelope.data ?? {}) as MobaSkillMessage);
        break;
      case MOBA_MESSAGES.BUY:
        this.onBuy(sessionId, (envelope.data ?? {}) as MobaBuyMessage);
        break;
      default:
        break;
    }
  }

  private onMove(sessionId: string, message: MobaMoveMessage): void {
    const hero = this.state.heroes.get(sessionId);
    const runtime = this.heroRuntime.get(sessionId);
    if (!hero || !runtime) return;

    const msg = message as Partial<MobaMoveMessage> | undefined;
    const rawDx = finite(msg?.dx);
    const dx = Math.abs(rawDx) < 0.15 ? 0 : sign(rawDx);
    const jump = msg?.jump === true || finite(msg?.dz) > 0.5;
    runtime.move = {
      dx,
      dz: finite(msg?.dz),
      jump,
      dash: msg?.dash === true,
      aimX: finite(msg?.aimX, hero.x + hero.facing * 4),
      aimZ: finite(msg?.aimZ, hero.z + 1),
    };
  }

  private onSkill(sessionId: string, message: MobaSkillMessage): void {
    const hero = this.state.heroes.get(sessionId);
    if (!hero || !hero.alive) return;
    const msg = message as Partial<MobaSkillMessage> | undefined;
    const key = msg?.key;
    if (!key || !SKILL_KEYS.includes(key)) return;
    this.castSkill(
      hero,
      key,
      finite(msg?.aimX, hero.x + hero.facing * 5),
      finite(msg?.aimZ, hero.z + 1),
    );
  }

  private onBuy(sessionId: string, message: MobaBuyMessage): void {
    const hero = this.state.heroes.get(sessionId);
    if (!hero) return;
    const msg = message as Partial<MobaBuyMessage> | undefined;
    if (msg?.itemId) this.buyItem(hero, msg.itemId);
  }

  // -------------------------------------------------------------- simulation

  private tick(deltaMs: number): void {
    if (this.state.phase === 'finished') {
      this.broadcastState();
      return;
    }
    this.elapsedMs += deltaMs;
    this.state.elapsedMs = this.elapsedMs;
    const dt = Math.min(deltaMs, 100) / 1000;

    if (this.state.phase === 'intermission') {
      this.intermissionLeftMs -= deltaMs;
      this.state.intermissionMs = Math.max(0, this.intermissionLeftMs);
      this.updateEffects(deltaMs);
      this.broadcastState();
      if (this.intermissionLeftMs <= 0) this.advanceRound();
      return;
    }

    if (this.state.phase !== 'playing') return;
    this.roundElapsedMs += deltaMs;
    this.state.timeLeft = Math.max(
      0,
      Math.ceil(FIGHT_BALANCE.roundSeconds - this.roundElapsedMs / 1000),
    );

    this.updateHeroes(dt);
    this.updateProjectiles(deltaMs, dt);
    this.updateEffects(deltaMs);
    this.evaluateRound();
    this.broadcastState();
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
          jump: intent.jump,
          dash: intent.dash,
          aimX: finite(intent.aimX, hero.x + hero.facing * 4),
          aimZ: finite(intent.aimZ, hero.z + 1),
        };
        if (intent.skill) this.castSkill(hero, intent.skill, intent.aimX, intent.aimZ);
        if (intent.buyItemId) this.buyItem(hero, intent.buyItemId);
      }

      hero.cdBasic = Math.max(0, runtime.readyAt.basic - this.elapsedMs);
      hero.cdSkill1 = Math.max(0, runtime.readyAt.skill1 - this.elapsedMs);
      hero.cdSkill2 = Math.max(0, runtime.readyAt.skill2 - this.elapsedMs);
      hero.cdUltimate = Math.max(0, runtime.readyAt.ultimate - this.elapsedMs);

      if (!hero.alive) {
        hero.respawnIn = Math.max(0, runtime.respawnAt - this.elapsedMs);
        if (runtime.respawnAt > 0 && hero.respawnIn <= 0 && hero.stocks > 0) {
          this.respawnHero(hero, runtime);
        }
        continue;
      }

      const disabled = hero.hitstunUntil > this.elapsedMs || hero.stunUntil > this.elapsedMs;
      const dashing = hero.dashUntil > this.elapsedMs;

      if (runtime.move.jump && !runtime.prevJump && !disabled) this.tryJump(hero);
      if (runtime.move.dash && !runtime.prevDash && !disabled) this.tryDash(hero, runtime);

      const aimDx = runtime.move.aimX - hero.x;
      if (Math.abs(aimDx) > 0.2) hero.facing = sign(aimDx);
      else if (runtime.move.dx !== 0) hero.facing = sign(runtime.move.dx);

      let speed = runtime.moveSpeed + runtime.itemStats.moveSpeed;
      if (hero.speedBoostUntil > this.elapsedMs) speed *= runtime.speedBoostMultiplier;
      if (hero.slowUntil > this.elapsedMs) speed *= Math.max(0.2, 1 - runtime.slowPercent);

      if (dashing) {
        hero.vx = hero.facing * FIGHT_BALANCE.dashSpeed;
      } else if (disabled) {
        hero.vx = damp(hero.vx, 0, 4, dt);
      } else {
        const target = runtime.move.dx * speed;
        hero.vx = damp(hero.vx, target, hero.grounded ? 14 : 5, dt);
      }
      hero.vx = Math.max(-FIGHT_BALANCE.dashSpeed, Math.min(FIGHT_BALANCE.dashSpeed, hero.vx));

      if (!hero.grounded || hero.vz > 0) {
        hero.vz = Math.max(-FIGHT_BALANCE.maxFallSpeed, hero.vz - FIGHT_BALANCE.gravity * dt);
      }

      const previousZ = hero.z;
      hero.x = clampFightX(hero.x + hero.vx * dt, HERO_RADIUS);
      hero.z += hero.vz * dt;

      if (hero.z <= 0) {
        hero.z = 0;
        hero.vz = 0;
        hero.grounded = true;
        hero.jumpCount = 0;
      } else {
        const platform = landingPlatform(hero.x, previousZ, hero.z, HERO_RADIUS);
        if (platform && hero.vz <= 0) {
          hero.z = platform.z;
          hero.vz = 0;
          hero.grounded = true;
          hero.jumpCount = 0;
        } else {
          hero.grounded = standingPlatform(hero.x, hero.z, HERO_RADIUS) !== null;
        }
      }

      runtime.prevJump = runtime.move.jump;
      runtime.prevDash = runtime.move.dash;
      hero.vx = Math.round(hero.vx * 1000) / 1000;
      hero.vz = Math.round(hero.vz * 1000) / 1000;

      if (runtime.itemStats.hpRegen > 0 && hero.hp < hero.maxHp) {
        hero.hp = Math.min(hero.maxHp, hero.hp + runtime.itemStats.hpRegen * dt);
      }

      if (this.elapsedMs >= runtime.animUntil) {
        hero.anim = disabled
          ? 'hurt'
          : dashing
            ? 'dash'
            : !hero.grounded
              ? 'jump'
              : Math.abs(hero.vx) > 0.6
                ? 'walk'
                : 'idle';
      }
    }
  }

  private tryJump(hero: HeroState): void {
    if (hero.grounded && hero.jumpCount === 0) {
      hero.vz = FIGHT_BALANCE.jumpSpeed;
      hero.grounded = false;
      hero.jumpCount = 1;
      return;
    }
    if (!hero.grounded && hero.jumpCount === 1) {
      hero.vz = FIGHT_BALANCE.doubleJumpSpeed;
      hero.jumpCount = 2;
    }
  }

  private tryDash(hero: HeroState, runtime: HeroRuntime): void {
    if (this.elapsedMs < runtime.dashReadyAt) return;
    runtime.dashReadyAt = this.elapsedMs + FIGHT_BALANCE.dashCooldownMs;
    hero.dashUntil = this.elapsedMs + FIGHT_BALANCE.dashMs;
    hero.vx = hero.facing * FIGHT_BALANCE.dashSpeed;
    if (hero.grounded) hero.vz = Math.max(hero.vz, 2);
    this.addEffect('dash', hero.x, hero.z, 2.4, FIGHT_BALANCE.effectTtlMs, '#8d6e63');
  }

  private respawnHero(hero: HeroState, runtime: HeroRuntime): void {
    let existing = 0;
    for (const other of this.state.heroes.values()) if (other.team === hero.team) existing += 1;
    const spawn = fightSpawnPoint(hero.team, existing % this.teamSize, this.teamSize);
    hero.x = spawn.x;
    hero.z = spawn.z;
    hero.vx = 0;
    hero.vz = 0;
    hero.facing = this.teamFacing(hero.team);
    hero.hp = this.maxHpFor(hero, runtime);
    hero.maxHp = hero.hp;
    hero.alive = true;
    hero.grounded = true;
    hero.jumpCount = 0;
    hero.combo = 0;
    hero.anim = 'idle';
    hero.respawnIn = 0;
    hero.hitstunUntil = 0;
    hero.dashUntil = 0;
    runtime.respawnAt = 0;
    runtime.protectedUntil = this.elapsedMs + FIGHT_BALANCE.spawnProtectionMs;
    runtime.damagers.clear();
    runtime.animUntil = 0;
    runtime.prevJump = true;
    runtime.prevDash = true;
    runtime.move = {
      dx: 0,
      dz: 0,
      jump: false,
      dash: false,
      aimX: spawn.x + this.teamFacing(hero.team) * 4,
      aimZ: spawn.z + 1,
    };
  }

  // ------------------------------------------------------------------ combat

  private castSkill(hero: HeroState, key: MobaSkillKey, aimX: number, aimZ: number): void {
    const runtime = this.heroRuntime.get(hero.id);
    if (!runtime || !hero.alive || this.state.phase !== 'playing') return;
    if (hero.hitstunUntil > this.elapsedMs) return;
    if (hero.level < (MOBA_BALANCE.skillUnlockLevel[key] ?? 1)) return;
    if (this.elapsedMs < runtime.readyAt[key]) return;

    const targetX = finite(aimX, hero.x + hero.facing * 5);
    const targetZ = finite(aimZ, hero.z + 1);
    const dx = targetX - hero.x;
    const dz = targetZ - hero.z;
    if (Math.abs(dx) > 0.2) hero.facing = sign(dx);
    const dirX = hero.facing;
    const horizontalLength = Math.abs(dx) > 0.001 ? Math.abs(dx) : 1;
    const dirZ = Math.max(-1, Math.min(1, dz / horizontalLength));

    if (key === 'basic') {
      const speedFactor = 1 + Math.max(0, runtime.itemStats.attackSpeedPercent);
      runtime.readyAt.basic = this.elapsedMs + runtime.attackCooldownMs / speedFactor;
      this.setHeroAnim(hero, 'attack', 180);

      if (this.elapsedMs - runtime.lastBasicAt <= FIGHT_BALANCE.comboWindowMs) {
        hero.combo = Math.min(3, hero.combo + 1);
      } else {
        hero.combo = 1;
      }
      runtime.lastBasicAt = this.elapsedMs;
      runtime.comboResetAt = this.elapsedMs + FIGHT_BALANCE.comboResetMs;

      const comboScale = 1 + (hero.combo - 1) * FIGHT_BALANCE.comboDamageStep;
      const damage = (this.attackDamageFor(hero, runtime) + runtime.itemStats.bonusDamage) * comboScale;
      const hitX = hero.x + dirX * Math.min(runtime.attackRange, 7) * 0.6;
      this.addEffect('hit', hitX, hero.z + 1.2, 2, FIGHT_BALANCE.effectTtlMs, runtime.definition.colorTheme);

      if (runtime.attackRange > 4) {
        this.spawnProjectile({
          ownerId: hero.id,
          team: hero.team,
          x: hero.x,
          z: hero.z + 1.3,
          aimX: hero.x + dirX * runtime.attackRange,
          aimZ: hero.z + 1.3 + dirZ * 2,
          damage,
          radius: 0.8,
          aoeRadius: 0.9,
          color: runtime.definition.colorTheme,
          kind: 'basic',
          ttlMs: Math.max(260, (runtime.attackRange / FIGHT_BALANCE.projectileSpeed) * 1000),
          offset: 1,
          knockback: 0.8 * comboScale,
        });
      } else {
        for (const target of this.enemiesInRadius(
          hitX,
          hero.z + 1.2,
          runtime.attackRange * 0.6 + HERO_RADIUS,
          hero.team,
        )) {
          this.applyDamage(target, damage, hero.id, { knockback: 0.9 * comboScale });
        }
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
        const range = Math.max(skill.range, 3.5);
        for (const target of this.enemiesInRadius(hero.x, hero.z + 1, range, hero.team)) {
          if (sign(target.x - hero.x) !== dirX) continue;
          if (Math.abs(target.z - hero.z) > 5) continue;
          this.applyDamage(target, damage, hero.id, { knockback: 1.1 });
        }
        this.addEffect('hit', hero.x + dirX * range * 0.5, hero.z + 1.5, range * 0.6, FIGHT_BALANCE.effectTtlMs, color);
        break;
      }
      case 'dash_buff': {
        hero.dashUntil = this.elapsedMs + Math.max(FIGHT_BALANCE.dashMs, skill.durationMs * 0.25);
        hero.vx = dirX * FIGHT_BALANCE.dashSpeed * 1.15;
        hero.speedBoostUntil = this.elapsedMs + Math.max(500, skill.durationMs);
        runtime.speedBoostMultiplier = skill.speedBoost > 0 ? skill.speedBoost : 1.5;
        this.addEffect('dash', hero.x, hero.z, 3, FIGHT_BALANCE.effectTtlMs, color);
        break;
      }
      case 'aoe_spin': {
        for (const target of this.enemiesInRadius(hero.x, hero.z + 1, Math.max(radius, 3), hero.team)) {
          this.applyDamage(target, damage, hero.id, { knockback: 1.6 });
        }
        this.addEffect('explosion', hero.x, hero.z + 1, Math.max(radius, 3), FIGHT_BALANCE.effectTtlMs, color);
        break;
      }
      case 'aoe_stun': {
        const center = this.skillCenter(hero, targetX, targetZ, skill.range);
        for (const target of this.enemiesInRadius(center.x, center.z, Math.max(radius, 2), hero.team)) {
          this.applyDamage(target, damage, hero.id, { stunMs: skill.stunMs, knockback: 1.2 });
        }
        this.addEffect('explosion', center.x, center.z, Math.max(radius, 2), FIGHT_BALANCE.effectTtlMs, color);
        break;
      }
      case 'aoe_slow': {
        const center = this.skillCenter(hero, targetX, targetZ, skill.range);
        for (const target of this.enemiesInRadius(center.x, center.z, Math.max(radius, 2), hero.team)) {
          this.applyDamage(target, damage, hero.id, {
            slowPercent: skill.slowPercent,
            slowMs: skill.durationMs,
            knockback: 0.6,
          });
        }
        this.addEffect('explosion', center.x, center.z, Math.max(radius, 2), FIGHT_BALANCE.effectTtlMs, color);
        break;
      }
      case 'shockwave_knockback': {
        const center = this.skillCenter(hero, targetX, targetZ, skill.range);
        for (const target of this.enemiesInRadius(center.x, center.z, Math.max(radius, 2), hero.team)) {
          this.applyDamage(target, damage, hero.id, {
            knockback: skill.knockback > 0 ? skill.knockback : 2.5,
          });
        }
        this.addEffect('explosion', center.x, center.z, radius, FIGHT_BALANCE.effectTtlMs, color);
        break;
      }
      case 'line_skillshot':
      case 'long_range_artillery': {
        const reach = Math.max(skill.range, 8);
        this.spawnProjectile({
          ownerId: hero.id,
          team: hero.team,
          x: hero.x,
          z: hero.z + 1.3,
          aimX: hero.x + dirX * reach,
          aimZ: hero.z + 1.3 + dirZ * reach * 0.35,
          damage,
          radius: Math.max(0.8, skill.radius * 0.5),
          aoeRadius: Math.max(1.2, radius),
          color,
          kind: 'skill',
          skillType: skill.type,
          ttlMs: Math.max(320, (reach / FIGHT_BALANCE.projectileSpeed) * 1000),
          offset: 1.2,
          stunMs: skill.stunMs,
          slowPercent: skill.slowPercent,
          slowMs: skill.durationMs,
          knockback: 1.4,
        });
        break;
      }
      default: {
        const center = this.skillCenter(hero, targetX, targetZ, skill.range);
        for (const target of this.enemiesInRadius(center.x, center.z, Math.max(radius, 2), hero.team)) {
          this.applyDamage(target, damage, hero.id);
        }
        this.addEffect('explosion', center.x, center.z, Math.max(radius, 2), FIGHT_BALANCE.effectTtlMs, color);
        break;
      }
    }
  }

  private skillCenter(
    hero: HeroState,
    aimX: number,
    aimZ: number,
    range: number,
  ): { x: number; z: number } {
    if (range <= 0) return { x: hero.x, z: hero.z + 1 };
    const dx = aimX - hero.x;
    const dz = aimZ - (hero.z + 1);
    const length = Math.hypot(dx, dz);
    if (length < 0.001) return { x: hero.x + hero.facing * range, z: hero.z + 1 };
    const reach = Math.min(length, range);
    return {
      x: hero.x + (dx / length) * reach,
      z: hero.z + 1 + (dz / length) * reach * 0.5,
    };
  }

  private maxHpFor(hero: HeroState, runtime: HeroRuntime): number {
    return runtime.thrMaxHp + (hero.level - 1) * LEVEL_HP_BONUS + runtime.itemStats.bonusHp;
  }

  private attackDamageFor(hero: HeroState, runtime: HeroRuntime): number {
    return runtime.thrAttackDamage + (hero.level - 1) * LEVEL_DAMAGE_BONUS;
  }

  private skillDamage(hero: HeroState, runtime: HeroRuntime, base: number): number {
    return base + this.attackDamageFor(hero, runtime) * 0.35 + runtime.itemStats.bonusDamage;
  }

  private buyItem(hero: HeroState, itemId: unknown): void {
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
    this.addEffect('gold', hero.x, hero.z + 1, 3, FIGHT_BALANCE.effectTtlMs, '#ffd54f');
  }

  private grantXp(hero: HeroState, amount: number): void {
    const runtime = this.heroRuntime.get(hero.id);
    if (!runtime || amount <= 0) return;
    hero.xp += amount;
    const nextLevel = Math.min(MOBA_BALANCE.maxLevel, levelForXp(hero.xp));
    if (nextLevel <= hero.level) return;
    const gained = nextLevel - hero.level;
    hero.level = nextLevel;
    hero.maxHp = this.maxHpFor(hero, runtime);
    hero.hp = Math.min(hero.maxHp, hero.hp + 60 * gained);
    this.addEffect('levelup', hero.x, hero.z + 1, 4, FIGHT_BALANCE.effectTtlMs, '#fff176');
  }

  // -------------------------------------------------------------- projectiles

  private spawnProjectile(input: SpawnProjectileInput): void {
    const dx = input.aimX - input.x;
    const dz = input.aimZ - input.z;
    const length = Math.hypot(dx, dz);
    const dirX = length > 0.001 ? dx / length : 1;
    const dirZ = length > 0.001 ? dz / length : 0;
    const offset = input.offset ?? 0.5;

    const projectile = createProjectileState();
    projectile.id = `prj-${++this.entitySequence}`;
    projectile.team = input.team;
    projectile.x = input.x + dirX * offset;
    projectile.z = input.z + dirZ * offset;
    projectile.vx = dirX * FIGHT_BALANCE.projectileSpeed;
    projectile.vz = dirZ * FIGHT_BALANCE.projectileSpeed;
    projectile.radius = input.radius;
    projectile.damage = input.damage;
    projectile.ttlMs =
      input.ttlMs ?? Math.max(250, (length / FIGHT_BALANCE.projectileSpeed) * 1000 + 100);
    projectile.color = input.color;
    projectile.aoeRadius = input.aoeRadius;
    projectile.stunMs = input.stunMs ?? 0;
    projectile.slowPercent = input.slowPercent ?? 0;
    projectile.slowMs = input.slowMs ?? 0;
    projectile.ownerId = input.ownerId;
    this.state.projectiles.set(projectile.id, projectile);
    this.projectileRuntime.set(projectile.id, {
      kind: input.kind,
      knockback: input.knockback ?? 1,
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
      const outside = Math.abs(projectile.x) > 70 || projectile.z < -2 || projectile.z > 34;
      const impact =
        projectile.ttlMs <= 0 ||
        outside ||
        this.projectileTargets(projectile, projectile.x, projectile.z, projectile.radius).length > 0;
      if (impact) {
        this.explodeProjectile(projectile, runtime);
        expired.push(projectile.id);
      }
    }
    for (const id of expired) {
      this.state.projectiles.delete(id);
      this.projectileRuntime.delete(id);
    }
  }

  private explodeProjectile(projectile: ProjectileState, runtime: ProjectileRuntime): void {
    const radius = Math.max(projectile.aoeRadius, projectile.radius, 1);
    const dirX = sign(projectile.vx || 1);
    for (const victim of this.projectileTargets(projectile, projectile.x, projectile.z, radius)) {
      this.applyDamage(victim, projectile.damage, projectile.ownerId, {
        stunMs: projectile.stunMs,
        slowPercent: projectile.slowPercent,
        slowMs: projectile.slowMs,
        knockback: runtime.knockback,
        dirX,
      });
    }
    this.addEffect(
      'explosion',
      projectile.x,
      projectile.z,
      radius,
      FIGHT_BALANCE.effectTtlMs,
      projectile.color,
    );
  }

  private projectileTargets(
    projectile: ProjectileState,
    x: number,
    z: number,
    radius: number,
  ): HeroState[] {
    const result: HeroState[] = [];
    for (const hero of this.state.heroes.values()) {
      if (!hero.alive || hero.team === projectile.team) continue;
      if (Math.hypot(x - hero.x, z - (hero.z + 1.2)) <= radius + HERO_RADIUS) result.push(hero);
    }
    return result;
  }

  // ---------------------------------------------------------------- targeting

  private enemiesInRadius(x: number, z: number, radius: number, team: TeamId): HeroState[] {
    const result: HeroState[] = [];
    for (const hero of this.state.heroes.values()) {
      if (!hero.alive || hero.team === team) continue;
      if (Math.hypot(x - hero.x, z - (hero.z + 1.2)) <= radius + HERO_RADIUS) result.push(hero);
    }
    return result;
  }

  // ------------------------------------------------------------ damage / xp

  private applyDamage(
    target: HeroState,
    amount: number,
    attackerId?: string,
    options: DamageOptions = {},
  ): void {
    if (!target.alive || amount <= 0 || this.state.phase !== 'playing') return;
    if (
      attackerId &&
      attackerId !== target.id &&
      this.elapsedMs < (this.heroRuntime.get(target.id)?.protectedUntil ?? 0)
    ) {
      return;
    }

    let final = amount;
    const runtime = this.heroRuntime.get(target.id);
    if (runtime) {
      final *= Math.max(0.05, 1 - Math.min(0.8, Math.max(0, runtime.itemStats.damageReduction)));
      if (attackerId && attackerId !== target.id) runtime.damagers.set(attackerId, this.elapsedMs);
    }

    target.hp = Math.max(0, target.hp - final);
    this.addEffect('hit', target.x, target.z + 1.4, 1.6, FIGHT_BALANCE.effectTtlMs, '#fff176');

    const attacker = attackerId ? this.state.heroes.get(attackerId) : undefined;
    const knockback = Math.max(0, options.knockback ?? 0);
    if (knockback > 0) {
      const dir = options.dirX ?? (attacker ? sign(target.x - attacker.x) : target.facing);
      target.vx += dir * FIGHT_BALANCE.knockbackBase * knockback;
      target.vz = Math.max(target.vz, FIGHT_BALANCE.knockbackUp * Math.min(2, knockback));
      target.grounded = false;
      target.hitstunUntil = Math.max(target.hitstunUntil, this.elapsedMs + FIGHT_BALANCE.hitstunMs);
      if (target.hp > 0) this.setHeroAnim(target, 'hurt', FIGHT_BALANCE.hitstunMs);
    }

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

  private handleDeath(target: HeroState, attackerId: string | undefined, amount: number): void {
    const runtime = this.heroRuntime.get(target.id);
    if (!runtime) return;
    const winnerTeam = otherTeam(target.team);

    target.alive = false;
    target.hp = 0;
    target.anim = 'dead';
    target.deaths += 1;
    target.stocks = Math.max(0, target.stocks - 1);
    runtime.respawnAt = target.stocks > 0 ? this.elapsedMs + FIGHT_BALANCE.respawnMs : 0;
    target.respawnIn = runtime.respawnAt - this.elapsedMs;

    const killer = attackerId ? this.state.heroes.get(attackerId) : undefined;
    if (killer && killer.team === winnerTeam) {
      killer.kills += 1;
      killer.gold += 35;
      this.grantXp(killer, 55);
    }

    for (const [helperId, hitAt] of runtime.damagers) {
      if (helperId === attackerId || this.elapsedMs - hitAt > ASSIST_WINDOW_MS) continue;
      const helper = this.state.heroes.get(helperId);
      if (!helper || helper.team !== winnerTeam) continue;
      helper.assists += 1;
      helper.gold += 14;
      this.grantXp(helper, 25);
    }
    runtime.damagers.clear();

    const ko: MobaKoMessage = {
      x: target.x,
      z: target.z,
      attackerId,
      victimId: target.id,
      amount,
    };
    this.broadcast(MOBA_MESSAGES.KO, ko);
    this.addEffect('ko', target.x, target.z + 1, 3.4, FIGHT_BALANCE.effectTtlMs, '#d32f2f');
  }

  private setHeroAnim(hero: HeroState, anim: MobaAnim, durationMs: number): void {
    hero.anim = anim;
    const runtime = this.heroRuntime.get(hero.id);
    if (runtime) runtime.animUntil = this.elapsedMs + durationMs;
  }

  private addEffect(
    kind: MobaEffectKind,
    x: number,
    z: number,
    radius: number,
    ttlMs: number,
    color: string,
  ): void {
    const effect = createEffectState();
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

  // ------------------------------------------------------------------- round

  private evaluateRound(): void {
    let merah = 0;
    let putih = 0;
    for (const hero of this.state.heroes.values()) {
      if (hero.team === 'team_merah') merah += hero.stocks;
      else putih += hero.stocks;
    }

    let winner: TeamId | 'draw' | null = null;
    if (merah <= 0 && putih <= 0) winner = 'draw';
    else if (putih <= 0) winner = 'team_merah';
    else if (merah <= 0) winner = 'team_putih';
    else if (this.state.timeLeft <= 0) {
      winner = merah > putih ? 'team_merah' : putih > merah ? 'team_putih' : 'draw';
    }

    if (winner) this.endRound(winner);
  }

  private endRound(winner: TeamId | 'draw'): void {
    this.state.roundWinner = winner;
    if (winner !== 'draw') {
      this.state[scoreKey(winner)] += 1;
      if (this.state[scoreKey(winner)] >= FIGHT_BALANCE.roundsToWin) {
        this.finishMatch('rounds');
        return;
      }
    }
    this.state.phase = 'intermission';
    this.intermissionLeftMs = FIGHT_BALANCE.intermissionMs;
    this.state.intermissionMs = FIGHT_BALANCE.intermissionMs;
  }

  private advanceRound(): void {
    if (this.state.round >= FIGHT_BALANCE.maxRounds) {
      this.finishMatch('timeout');
      return;
    }
    this.state.round += 1;
    this.resetRound();
  }

  private resetRound(): void {
    this.roundElapsedMs = 0;
    this.state.timeLeft = FIGHT_BALANCE.roundSeconds;
    this.state.phase = 'playing';
    this.state.roundWinner = '';
    this.state.intermissionMs = 0;
    this.state.projectiles.clear();
    this.projectileRuntime.clear();

    const perTeam: Record<TeamId, number> = { team_merah: 0, team_putih: 0 };
    for (const hero of this.state.heroes.values()) {
      const runtime = this.heroRuntime.get(hero.id);
      if (!runtime) continue;
      const spawn = fightSpawnPoint(hero.team, perTeam[hero.team]++, this.teamSize);
      hero.x = spawn.x;
      hero.z = spawn.z;
      hero.vx = 0;
      hero.vz = 0;
      hero.facing = this.teamFacing(hero.team);
      hero.maxHp = this.maxHpFor(hero, runtime);
      hero.hp = hero.maxHp;
      hero.alive = true;
      hero.stocks = FIGHT_BALANCE.stocksPerHero;
      hero.maxStocks = FIGHT_BALANCE.stocksPerHero;
      hero.grounded = true;
      hero.jumpCount = 0;
      hero.combo = 0;
      hero.anim = 'idle';
      hero.respawnIn = 0;
      hero.hitstunUntil = 0;
      hero.dashUntil = 0;
      hero.stunUntil = 0;
      hero.slowUntil = 0;
      hero.speedBoostUntil = 0;
      runtime.respawnAt = 0;
      runtime.readyAt = { basic: 0, skill1: 0, skill2: 0, ultimate: 0 };
      runtime.protectedUntil = this.elapsedMs + FIGHT_BALANCE.spawnProtectionMs;
      runtime.damagers.clear();
      runtime.animUntil = 0;
      runtime.prevJump = false;
      runtime.prevDash = false;
      runtime.lastBasicAt = -9999;
      runtime.comboResetAt = 0;
      runtime.dashReadyAt = 0;
      runtime.move = {
        dx: 0,
        dz: 0,
        jump: false,
        dash: false,
        aimX: spawn.x + this.teamFacing(hero.team) * 4,
        aimZ: spawn.z + 1,
      };
    }
  }

  private finishMatch(reason: 'rounds' | 'timeout'): void {
    if (this.ending) return;
    this.ending = true;
    this.state.phase = 'finished';
    const winner =
      this.state.scoreMerah === this.state.scorePutih
        ? 'draw'
        : this.state.scoreMerah > this.state.scorePutih
          ? 'team_merah'
          : 'team_putih';
    this.state.winner = winner;

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
      round: this.state.round,
    };
    this.broadcast(MOBA_MESSAGES.MATCH_END, message);
    this.broadcastState();
  }
}
