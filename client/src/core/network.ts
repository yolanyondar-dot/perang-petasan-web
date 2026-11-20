import { Client, type Room } from '@colyseus/sdk';
import {
  MOBA_MESSAGES,
  type ClientMobaState,
  type MobaBossView,
  type MobaBuyMessage,
  type MobaEffectView,
  type MobaHeroView,
  type MobaJoinOptions,
  type MobaKoMessage,
  type MobaMatchEndMessage,
  type MobaMinionView,
  type MobaMoveMessage,
  type MobaProjectileView,
  type MobaSkillKey,
  type MobaSkillMessage,
  type MobaTurretView,
  type MobaUnitView,
} from '@pp/shared';
import type { MobaLoadout, RoomMode } from '@pp/shared';

/** Baris schema Colyseus yang sudah diserialisasi. */
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function toRecord<T>(map: Row | undefined, convert: (row: Row) => T): Record<string, T> {
  const result: Record<string, T> = {};
  if (!map || typeof map.forEach !== 'function') return result;
  map.forEach((row: Row, key: string) => {
    result[key] = convert(row);
  });
  return result;
}

function unit(row: Row): MobaUnitView {
  return {
    id: row.id,
    kind: row.kind ?? 'hero',
    team: row.team,
    x: row.x,
    z: row.z,
    facing: row.facing,
    hp: row.hp,
    maxHp: row.maxHp,
    alive: row.alive,
    level: row.level ?? 1,
    anim: row.anim ?? 'idle',
    lane: row.lane,
    tier: row.tier,
  };
}

function hero(row: Row): MobaHeroView {
  return {
    ...unit(row),
    kind: 'hero',
    heroId: row.heroId,
    name: row.name,
    isBot: row.isBot,
    gold: row.gold,
    kills: row.kills,
    deaths: row.deaths,
    assists: row.assists,
    xp: row.xp,
    items: row.items ? Array.from(row.items as Iterable<string>) : [],
    cdBasic: row.cdBasic,
    cdSkill1: row.cdSkill1,
    cdSkill2: row.cdSkill2,
    cdUltimate: row.cdUltimate,
    respawnIn: row.respawnIn,
    speedBoostUntil: row.speedBoostUntil,
    slowUntil: row.slowUntil,
    stunUntil: row.stunUntil,
  };
}

function minion(row: Row): MobaMinionView {
  return { ...unit(row), kind: 'minion', lane: row.lane };
}

function turret(row: Row): MobaTurretView {
  return { ...unit(row), kind: 'turret', lane: row.lane, tier: row.tier };
}

function boss(row: Row): MobaBossView {
  return { ...unit(row), kind: 'boss', respawnIn: row.respawnIn };
}

function projectile(row: Row): MobaProjectileView {
  return {
    id: row.id,
    team: row.team,
    x: row.x,
    z: row.z,
    vx: row.vx,
    vz: row.vz,
    radius: row.radius,
    damage: row.damage,
    ttlMs: row.ttlMs,
    color: row.color,
    aoeRadius: row.aoeRadius,
    stunMs: row.stunMs,
    slowPercent: row.slowPercent,
    slowMs: row.slowMs,
    ownerId: row.ownerId,
  };
}

function effect(row: Row): MobaEffectView {
  return {
    id: row.id,
    kind: row.kind,
    x: row.x,
    z: row.z,
    radius: row.radius,
    ttlMs: row.ttlMs,
    color: row.color,
  };
}

function resolveEndpoint(): string {
  const configured = import.meta.env.VITE_SERVER_URL;
  if (typeof configured === 'string' && configured.trim()) return configured.trim();

  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    return 'ws://localhost:2567';
  }
  // Produksi: Nginx meneruskan /ws/ ke Colyseus di port 2567.
  return `${protocol}://${location.host}/ws`;
}

class NetworkManager {
  private readonly client = new Client(resolveEndpoint());
  room: Room<any, Row> | null = null;
  sessionId = '';
  onMatchEnd: ((message: MobaMatchEndMessage) => void) | null = null;
  onKo: ((message: MobaKoMessage) => void) | null = null;
  onDisconnect: (() => void) | null = null;

  async join(mode: RoomMode, loadout: MobaLoadout, name: string): Promise<void> {
    await this.leave();
    const options: MobaJoinOptions = { mode, loadout, name, fillBots: true };
    const room = await this.client.joinOrCreate<Row>('moba', options);
    this.room = room;
    this.sessionId = room.sessionId;

    room.onMessage(MOBA_MESSAGES.WELCOME, () => undefined);
    room.onMessage<MobaMatchEndMessage>(MOBA_MESSAGES.MATCH_END, (message) => this.onMatchEnd?.(message));
    room.onMessage<MobaKoMessage>(MOBA_MESSAGES.KO, (message) => this.onKo?.(message));
    room.onLeave(() => {
      if (this.room === room) {
        this.room = null;
        this.onDisconnect?.();
      }
    });
  }

  async leave(): Promise<void> {
    const room = this.room;
    this.room = null;
    if (room) await room.leave();
  }

  get state(): ClientMobaState | null {
    const s = this.room?.state as Row | undefined;
    if (!s) return null;
    return {
      mode: s.mode,
      phase: s.phase,
      elapsedMs: s.elapsedMs,
      timeLeft: s.timeLeft,
      scoreMerah: s.scoreMerah,
      scorePutih: s.scorePutih,
      baseHpMerah: s.baseHpMerah,
      baseHpPutih: s.baseHpPutih,
      bossSpawnIn: s.bossSpawnIn,
      heroes: toRecord(s.heroes, hero),
      minions: toRecord(s.minions, minion),
      turrets: toRecord(s.turrets, turret),
      bases: toRecord(s.bases, unit),
      boss: s.boss && s.boss.id ? boss(s.boss) : null,
      projectiles: toRecord(s.projectiles, projectile),
      effects: toRecord(s.effects, effect),
    };
  }

  sendMove(message: MobaMoveMessage): void {
    this.room?.send(MOBA_MESSAGES.MOVE, message);
  }

  sendSkill(key: MobaSkillKey, aimX: number, aimZ: number): void {
    const message: MobaSkillMessage = { key, aimX, aimZ };
    this.room?.send(MOBA_MESSAGES.SKILL, message);
  }

  sendBuy(itemId: string): void {
    const message: MobaBuyMessage = { itemId };
    this.room?.send(MOBA_MESSAGES.BUY, message);
  }
}

export const network = new NetworkManager();
