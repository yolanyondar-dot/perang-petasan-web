import {
  ARENA_CENTER,
  ARENA_SPAWNS,
  MOBA_BALANCE,
  distance,
  otherTeam,
  type MobaSkillKey,
  type TeamId,
} from '@pp/shared';
import { HEROES, HERO_LIST, ITEM_LIST, pickRandom } from './config.js';
import type { HeroSchema, MobaState } from './schema.js';

const BOT_NAMES = [
  'Bot Ucup',
  'Bot Juki',
  'Bot Kompor',
  'Bot Kacang',
  'Bot Bobok',
  'Bot Sapi',
  'Bot Kentang',
  'Bot Minyak',
  'Bot Kuku',
  'Bot Bedug',
];

export interface ArenaBotWorld {
  state: MobaState;
}

export interface MobaBotIntent {
  dx: number;
  dz: number;
  aimX: number;
  aimZ: number;
  skill?: MobaSkillKey;
  buyItemId?: string;
}

export function randomBotName(sequence: number): string {
  return `${BOT_NAMES[sequence % BOT_NAMES.length]!} ${Math.floor(sequence / BOT_NAMES.length) + 1}`;
}

export function randomBotHeroId(): string {
  return pickRandom(HERO_LIST).id;
}

function hashId(id: string): number {
  let value = 0;
  for (let i = 0; i < id.length; i += 1) value = (value * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(value);
}

function nearestEnemy(bot: HeroSchema, state: MobaState): HeroSchema | undefined {
  const enemy = otherTeam(bot.team as TeamId);
  let best: HeroSchema | undefined;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const hero of state.heroes.values()) {
    if (!hero.alive || hero.id === bot.id || hero.team !== enemy) continue;
    const d = distance(bot, hero);
    const lowHpBonus = (1 - hero.hp / Math.max(1, hero.maxHp)) * 7;
    const score = d - lowHpBonus;
    if (score < bestScore) {
      bestScore = score;
      best = hero;
    }
  }
  return best;
}

function roamPoint(bot: HeroSchema): { x: number; z: number } {
  const angle = (hashId(bot.id) % 360) * (Math.PI / 180);
  return {
    x: ARENA_CENTER.x + Math.cos(angle) * 9,
    z: ARENA_CENTER.z + Math.sin(angle) * 9,
  };
}

function cooldownFor(bot: HeroSchema, key: MobaSkillKey): number {
  if (key === 'basic') return bot.cdBasic;
  if (key === 'skill1') return bot.cdSkill1;
  if (key === 'skill2') return bot.cdSkill2;
  return bot.cdUltimate;
}

function chooseSkill(bot: HeroSchema, key: MobaSkillKey, targetDistance: number): boolean {
  const hero = HEROES[bot.heroId];
  if (!hero) return false;
  if (bot.level < (MOBA_BALANCE.skillUnlockLevel[key] ?? 1)) return false;
  if (cooldownFor(bot, key) > 0) return false;

  if (key === 'basic') return targetDistance <= hero.baseStats.attackRange + 1.2;

  const def = hero.skills[key];
  if (def.type === 'dash_buff') {
    // Dash dipakai untuk menutup jarak, bukan saat sudah berhimpitan.
    return targetDistance >= Math.max(5, hero.baseStats.attackRange * 1.4);
  }
  const reach = Math.max(def.range, def.radius, hero.baseStats.attackRange, 3) + 1;
  return targetDistance <= reach;
}

function choosePurchase(bot: HeroSchema): string | undefined {
  if (bot.items.length >= 6 || bot.gold < 300) return undefined;
  const affordable = ITEM_LIST.filter(
    (item) => item.cost <= bot.gold && !bot.items.includes(item.id),
  );
  if (affordable.length === 0) return undefined;
  affordable.sort((a, b) => b.cost - a.cost);
  return affordable[0]!.id;
}

/** Bot arena: memburu hero musuh, strafe, mundur saat low HP, tetap beli item. */
export function decideArenaBot(bot: HeroSchema, world: ArenaBotWorld): MobaBotIntent {
  const travel = (x: number, z: number): { dx: number; dz: number } => {
    const dx = x - bot.x;
    const dz = z - bot.z;
    const length = Math.hypot(dx, dz) || 1;
    return { dx: dx / length, dz: dz / length };
  };

  if (!bot.alive || world.state.phase !== 'playing') {
    return { dx: 0, dz: 0, aimX: bot.x + 1, aimZ: bot.z };
  }

  const buyItemId = choosePurchase(bot);
  const target = nearestEnemy(bot, world.state);
  const aimX = target?.x ?? roamPoint(bot).x;
  const aimZ = target?.z ?? roamPoint(bot).z;
  const lowHp = bot.hp <= Math.max(1, bot.maxHp) * 0.32;

  if (lowHp) {
    const spawn = ARENA_SPAWNS[bot.team as TeamId];
    const away = travel(spawn.x, spawn.z);
    const dash = cooldownFor(bot, 'skill2') <= 0 && HEROES[bot.heroId]?.skills.skill2.type === 'dash_buff';
    return { ...away, aimX, aimZ, skill: dash ? 'skill2' : undefined, buyItemId };
  }

  if (!target) {
    const point = roamPoint(bot);
    return { ...travel(point.x, point.z), aimX, aimZ, buyItemId };
  }

  const d = distance(bot, target);
  const attackRange = HEROES[bot.heroId]?.baseStats.attackRange ?? 2.5;
  let movement: { dx: number; dz: number };
  if (d > attackRange * 0.85) {
    movement = travel(target.x, target.z);
  } else if (d < attackRange * 0.4) {
    movement = travel(bot.x - (target.x - bot.x), bot.z - (target.z - bot.z));
  } else {
    const side = Math.sin(world.state.elapsedMs / 900 + hashId(bot.id)) >= 0 ? 1 : -1;
    const sx = -(target.z - bot.z) * side;
    const sz = (target.x - bot.x) * side;
    const length = Math.hypot(sx, sz) || 1;
    movement = { dx: sx / length, dz: sz / length };
  }

  let skill: MobaSkillKey | undefined;
  for (const key of ['ultimate', 'skill1', 'skill2'] as const) {
    if (chooseSkill(bot, key, d)) {
      skill = key;
      break;
    }
  }
  if (!skill && chooseSkill(bot, 'basic', d)) skill = 'basic';

  // Menjaga nyawa menjelang akhir match: bot agresif tapi tidak bunuh diri.
  if (world.state.timeLeft <= 8 && bot.hp < bot.maxHp * 0.5) {
    const spawn = ARENA_SPAWNS[bot.team as TeamId];
    return { ...travel(spawn.x, spawn.z), aimX, aimZ, buyItemId };
  }

  return { ...movement, aimX, aimZ, skill, buyItemId };
}
