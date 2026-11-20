import { FIGHT_BALANCE, MOBA_BALANCE, distance, otherTeam, type MobaSkillKey } from '@pp/shared';
import { FIGHT_HERO_LIST, HEROES, ITEM_LIST, pickRandom } from './config.js';
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
  jump: boolean;
  dash: boolean;
  aimX: number;
  aimZ: number;
  skill?: MobaSkillKey;
  buyItemId?: string;
}

export function randomBotName(sequence: number): string {
  return `${BOT_NAMES[sequence % BOT_NAMES.length]!} ${Math.floor(sequence / BOT_NAMES.length) + 1}`;
}

export function randomBotHeroId(): string {
  return pickRandom(FIGHT_HERO_LIST).id;
}

function nearestEnemy(bot: HeroSchema, state: MobaState): HeroSchema | undefined {
  const enemy = otherTeam(bot.team);
  let best: HeroSchema | undefined;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const hero of state.heroes.values()) {
    if (!hero.alive || hero.id === bot.id || hero.team !== enemy) continue;
    const d = Math.abs(hero.x - bot.x) + Math.abs(hero.z - bot.z) * 0.6;
    const lowHpBonus = (1 - hero.hp / Math.max(1, hero.maxHp)) * 4;
    if (d - lowHpBonus < bestScore) {
      bestScore = d - lowHpBonus;
      best = hero;
    }
  }
  return best;
}

function cooldownFor(bot: HeroSchema, key: MobaSkillKey): number {
  if (key === 'basic') return bot.cdBasic;
  if (key === 'skill1') return bot.cdSkill1;
  if (key === 'skill2') return bot.cdSkill2;
  return bot.cdUltimate;
}

function choosePurchase(bot: HeroSchema): string | undefined {
  if (bot.items.length >= 6 || bot.gold < 300) return undefined;
  const affordable = ITEM_LIST.filter(
    (item) => item.cost <= bot.gold && !bot.items.includes(item.id),
  );
  affordable.sort((a, b) => b.cost - a.cost);
  return affordable[0]?.id;
}

function chooseSkill(
  bot: HeroSchema,
  key: MobaSkillKey,
  horizontal: number,
  vertical: number,
): boolean {
  const hero = HEROES[bot.heroId];
  if (!hero) return false;
  if (bot.level < (MOBA_BALANCE.skillUnlockLevel[key] ?? 1)) return false;
  if (cooldownFor(bot, key) > 0) return false;

  if (key === 'basic') {
    return horizontal <= hero.baseStats.attackRange + 1 && vertical <= 3.5;
  }

  const def = hero.skills[key];
  if (def.type === 'dash_buff') return horizontal >= 5;
  const reach = Math.max(def.range, def.radius, 2.5) + 2;
  return horizontal <= reach && vertical <= Math.max(6, def.radius + 2);
}

/** Bot side-view: mendekat, lompat mengejar, menyerang, dan sesekali dash. */
export function decideArenaBot(bot: HeroSchema, world: ArenaBotWorld): MobaBotIntent {
  const idle: MobaBotIntent = {
    dx: 0,
    dz: 0,
    jump: false,
    dash: false,
    aimX: bot.x + (bot.facing >= 0 ? 4 : -4),
    aimZ: bot.z + 1,
  };
  if (!bot.alive || world.state.phase !== 'playing') return idle;

  const target = nearestEnemy(bot, world.state);
  const buyItemId = choosePurchase(bot);
  if (!target) return { ...idle, buyItemId };

  const horizontal = target.x - bot.x;
  const vertical = target.z - bot.z;
  const absHorizontal = Math.abs(horizontal);
  const sign = horizontal >= 0 ? 1 : -1;
  const aimX = target.x;
  const aimZ = target.z + Math.min(2, vertical * 0.4);
  const attackRange = HEROES[bot.heroId]?.baseStats.attackRange ?? 2.5;

  let dx = 0;
  if (absHorizontal > attackRange * 0.8) dx = sign;
  else if (absHorizontal < attackRange * 0.35) dx = -sign * 0.6;

  const jump =
    bot.grounded &&
    (vertical > 2.2 || (vertical < -2.2 && absHorizontal <= attackRange + 2)) &&
    bot.jumpCount === 0;
  const dash =
    cooldownFor(bot, 'skill2') <= 0 &&
    HEROES[bot.heroId]?.skills.skill2.type === 'dash_buff' &&
    absHorizontal >= FIGHT_BALANCE.dashSpeed * 0.3;

  let skill: MobaSkillKey | undefined;
  for (const key of ['ultimate', 'skill1', 'skill2', 'basic'] as const) {
    if (chooseSkill(bot, key, absHorizontal, Math.abs(vertical))) {
      skill = key;
      break;
    }
  }

  // Mundur sebentar saat nyawa terakhir dan HP rendah, tapi tetap menyerang jarak jauh.
  const desperate = bot.stocks <= 1 && bot.hp <= bot.maxHp * 0.28;
  if (desperate && absHorizontal < attackRange + 2) dx = -sign;

  return {
    dx,
    dz: jump ? 1 : 0,
    jump,
    dash,
    aimX,
    aimZ,
    skill,
    buyItemId,
  };
}

export function botDistance(a: HeroSchema, b: HeroSchema): number {
  return distance(a, b);
}
