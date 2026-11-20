import { ArraySchema, MapSchema, Schema, type } from '@colyseus/schema';
import type { RoomMode, TeamId } from '@pp/shared';

export class HeroSchema extends Schema {
  @type('string') id = '';
  @type('string') name = '';
  @type('string') heroId = '';
  @type('string') team: TeamId = 'team_merah';
  @type('boolean') isBot = false;
  @type('number') x = 0;
  @type('number') z = 0;
  @type('number') facing = 0;
  @type('number') hp = 0;
  @type('number') maxHp = 0;
  @type('boolean') alive = true;
  @type('number') level = 1;
  @type('string') anim = 'idle';
  @type('number') gold = 0;
  @type('number') kills = 0;
  @type('number') deaths = 0;
  @type('number') assists = 0;
  @type('number') xp = 0;
  @type('number') respawnIn = 0;
  @type('number') cdBasic = 0;
  @type('number') cdSkill1 = 0;
  @type('number') cdSkill2 = 0;
  @type('number') cdUltimate = 0;
  @type('number') speedBoostUntil = 0;
  @type('number') slowUntil = 0;
  @type('number') stunUntil = 0;
  @type(['string']) items = new ArraySchema<string>();
}

export class MinionSchema extends Schema {
  @type('string') id = '';
  @type('string') team: TeamId = 'team_merah';
  @type('number') x = 0;
  @type('number') z = 0;
  @type('number') facing = 0;
  @type('number') hp = 0;
  @type('number') maxHp = 0;
  @type('boolean') alive = true;
  @type('number') level = 1;
  @type('string') anim = 'walk';
  @type('string') lane = 'mid';
}

export class TurretSchema extends Schema {
  @type('string') id = '';
  @type('string') team: TeamId = 'team_merah';
  @type('number') x = 0;
  @type('number') z = 0;
  @type('number') facing = 0;
  @type('number') hp = 0;
  @type('number') maxHp = 0;
  @type('boolean') alive = true;
  @type('number') level = 1;
  @type('string') anim = 'idle';
  @type('string') lane = 'mid';
  @type('number') tier = 1;
}

export class BossSchema extends Schema {
  @type('string') id = 'boss';
  @type('number') x = 0;
  @type('number') z = 0;
  @type('number') facing = 0;
  @type('number') hp = 0;
  @type('number') maxHp = 0;
  @type('boolean') alive = false;
  @type('number') level = 1;
  @type('string') anim = 'idle';
  @type('number') respawnIn = 0;
}

export class BaseSchema extends Schema {
  @type('string') id = '';
  @type('string') team: TeamId = 'team_merah';
  @type('number') x = 0;
  @type('number') z = 0;
  @type('number') hp = 0;
  @type('number') maxHp = 0;
  @type('boolean') alive = true;
  @type('string') anim = 'idle';
}

export class ProjectileSchema extends Schema {
  @type('string') id = '';
  @type('string') team: TeamId = 'team_merah';
  @type('number') x = 0;
  @type('number') z = 0;
  @type('number') vx = 0;
  @type('number') vz = 0;
  @type('number') radius = 0.5;
  @type('number') damage = 0;
  @type('number') ttlMs = 0;
  @type('string') color = '#ffffff';
  @type('number') aoeRadius = 0;
  @type('number') stunMs = 0;
  @type('number') slowPercent = 0;
  @type('number') slowMs = 0;
  @type('string') ownerId = '';
}

export class EffectSchema extends Schema {
  @type('string') id = '';
  @type('string') kind = 'hit';
  @type('number') x = 0;
  @type('number') z = 0;
  @type('number') radius = 0;
  @type('number') ttlMs = 0;
  @type('string') color = '#ffffff';
}

export class MobaState extends Schema {
  @type('string') mode: RoomMode = '5v5';
  @type('string') phase: 'waiting' | 'playing' | 'finished' = 'waiting';
  @type('number') elapsedMs = 0;
  @type('number') timeLeft = 0;
  @type('number') scoreMerah = 0;
  @type('number') scorePutih = 0;
  @type('number') baseHpMerah = 0;
  @type('number') baseHpPutih = 0;
  @type('number') bossSpawnIn = 0;
  @type({ map: HeroSchema }) heroes = new MapSchema<HeroSchema>();
  @type({ map: MinionSchema }) minions = new MapSchema<MinionSchema>();
  @type({ map: TurretSchema }) turrets = new MapSchema<TurretSchema>();
  @type({ map: BaseSchema }) bases = new MapSchema<BaseSchema>();
  @type(BossSchema) boss = new BossSchema();
  @type({ map: ProjectileSchema }) projectiles = new MapSchema<ProjectileSchema>();
  @type({ map: EffectSchema }) effects = new MapSchema<EffectSchema>();
}
