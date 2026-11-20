/** Normalisasi heroes.json / items.json menjadi kontrak yang dipakai client & server. */
import type {
  HeroCatalog,
  HeroDefinition,
  ItemCatalog,
  ItemDefinition,
  ItemStats,
  MobaSkillDefinition,
} from './mobaTypes.js';

type Raw = Record<string, unknown>;

const isRecord = (value: unknown): value is Raw =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function num(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function rawList(raw: unknown, key: string): Raw[] {
  if (Array.isArray(raw)) return raw.filter(isRecord);
  if (isRecord(raw) && Array.isArray(raw[key])) return (raw[key] as unknown[]).filter(isRecord);
  if (isRecord(raw)) return Object.values(raw).filter(isRecord);
  return [];
}

const EMPTY_STATS: ItemStats = {
  moveSpeed: 0,
  cdrPercent: 0,
  bonusDamage: 0,
  bonusHp: 0,
  damageReduction: 0,
  attackSpeedPercent: 0,
  hpRegen: 0,
  aoeMultiplier: 0,
};

function skill(raw: unknown, fallbackName: string): MobaSkillDefinition {
  const data = isRecord(raw) ? raw : {};
  return {
    name: text(data.name, fallbackName),
    type: text(data.type, 'aoe_damage'),
    damage: num(data.damage, 0),
    range: num(data.range, 0),
    radius: num(data.radius, 0),
    cooldownMs: num(data.cooldownMs, 6000),
    stunMs: num(data.stunMs, 0),
    slowPercent: num(data.slowPercent, 0),
    durationMs: num(data.durationMs, 0),
    speedBoost: num(data.speedBoost, 0),
    knockback: num(data.knockback, 0),
  };
}

export function normalizeHeroes(raw: unknown): HeroCatalog {
  const result: HeroCatalog = {};
  for (const item of rawList(raw, 'heroes')) {
    const id = text(item.id, '');
    if (!id) continue;
    const base = isRecord(item.baseStats) ? item.baseStats : isRecord(item.base) ? item.base : {};
    const skills = isRecord(item.skills) ? item.skills : {};
    const scaling = isRecord(item.thrUpgradeScaling) ? item.thrUpgradeScaling : {};

    result[id] = {
      id,
      name: text(item.name, id),
      role: text(item.role, 'Fighter'),
      portrait: text(item.portrait, `characters/${id}.png`),
      colorTheme: text(item.colorTheme, '#e63946'),
      baseStats: {
        maxHp: num(base.maxHp, 700),
        moveSpeed: num(base.moveSpeed, 6.5),
        attackDamage: num(base.attackDamage, 50),
        attackRange: num(base.attackRange, 2.5),
        attackCooldownMs: num(base.attackCooldownMs, 750),
      },
      skills: {
        skill1: skill(skills.skill1, 'Skill 1'),
        skill2: skill(skills.skill2, 'Skill 2'),
        ultimate: skill(skills.ultimate, 'Ultimate'),
      },
      thrUpgradeScaling: {
        maxLevel: num(scaling.maxLevel, 10),
        baseCost: num(scaling.baseCost, 100),
        costMultiplier: num(scaling.costMultiplier, 1.35),
        hpBonusPerLevel: num(scaling.hpBonusPerLevel, 45),
        damageBonusPerLevel: num(scaling.damageBonusPerLevel, 8),
      },
    } satisfies HeroDefinition;
  }
  return result;
}

export function normalizeItems(raw: unknown): ItemCatalog {
  const result: ItemCatalog = {};
  for (const item of rawList(raw, 'inMatchItems')) {
    const id = text(item.id, '');
    if (!id) continue;
    const stats = isRecord(item.stats) ? item.stats : {};
    result[id] = {
      id,
      name: text(item.name, id),
      cost: num(item.cost, 300),
      description: text(item.description, ''),
      stats: {
        moveSpeed: num(stats.moveSpeed, EMPTY_STATS.moveSpeed),
        cdrPercent: num(stats.cdrPercent, EMPTY_STATS.cdrPercent),
        bonusDamage: num(stats.bonusDamage, EMPTY_STATS.bonusDamage),
        bonusHp: num(stats.bonusHp, EMPTY_STATS.bonusHp),
        damageReduction: num(stats.damageReduction, EMPTY_STATS.damageReduction),
        attackSpeedPercent: num(stats.attackSpeedPercent, EMPTY_STATS.attackSpeedPercent),
        hpRegen: num(stats.hpRegen, EMPTY_STATS.hpRegen),
        aoeMultiplier: num(stats.aoeMultiplier, EMPTY_STATS.aoeMultiplier),
      },
    } satisfies ItemDefinition;
  }
  return result;
}

/** Biaya upgrade permanen (Koin THR) untuk level berikutnya. */
export function thrCostFor(hero: HeroDefinition, currentLevel: number): number {
  const scaling = hero.thrUpgradeScaling;
  return Math.round(scaling.baseCost * Math.pow(scaling.costMultiplier, Math.max(0, currentLevel)));
}

/** Stat dasar hero setelah bonus upgrade THR permanen. */
export function heroStatsAtThr(hero: HeroDefinition, thrLevel: number): {
  maxHp: number;
  attackDamage: number;
} {
  const level = Math.max(0, Math.min(hero.thrUpgradeScaling.maxLevel, Math.floor(thrLevel)));
  return {
    maxHp: hero.baseStats.maxHp + level * hero.thrUpgradeScaling.hpBonusPerLevel,
    attackDamage: hero.baseStats.attackDamage + level * hero.thrUpgradeScaling.damageBonusPerLevel,
  };
}

/** Akumulasi semua item yang dibeli hero di dalam match. */
export function itemStatTotals(ids: readonly string[], catalog: ItemCatalog): ItemStats {
  const total = { ...EMPTY_STATS };
  for (const id of ids) {
    const item = catalog[id];
    if (!item) continue;
    total.moveSpeed += item.stats.moveSpeed;
    total.cdrPercent += item.stats.cdrPercent;
    total.bonusDamage += item.stats.bonusDamage;
    total.bonusHp += item.stats.bonusHp;
    total.damageReduction += item.stats.damageReduction;
    total.attackSpeedPercent += item.stats.attackSpeedPercent;
    total.hpRegen += item.stats.hpRegen;
    total.aoeMultiplier = Math.max(total.aoeMultiplier, item.stats.aoeMultiplier);
  }
  return total;
}
