import type {
  CharacterCatalog,
  CharacterDefinition,
  UpgradeCost,
  WeaponCatalog,
  WeaponDefinition,
  WeaponType,
} from './types.js';

/**
 * JSON balancing bisa datang dalam dua bentuk:
 * - object keyed by id dengan field `base`/`perLevel`/`upgradeCost`
 * - array dengan field `baseStats`/`upgradeScaling` (format pipeline aset)
 * Normalizer ini menyatukan keduanya tanpa mengubah file JSON.
 */
type RawRecord = Record<string, unknown>;

function isRecord(value: unknown): value is RawRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function num(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function rawList(raw: unknown, key: string): RawRecord[] {
  if (Array.isArray(raw)) return raw.filter(isRecord);
  if (isRecord(raw) && Array.isArray(raw[key])) return (raw[key] as unknown[]).filter(isRecord);
  if (isRecord(raw)) return Object.values(raw).filter(isRecord);
  return [];
}

function cost(value: unknown, fallback: UpgradeCost): UpgradeCost {
  if (!isRecord(value)) return fallback;
  return { base: num(value.base ?? value.baseCost, fallback.base), growth: num(value.growth ?? value.costMultiplier, fallback.growth) };
}

const WEAPON_COLORS: Record<string, string> = {
  sarung_pecut: '#26a69a',
  sandal_jepit: '#8d6e63',
  petasan_banting: '#ef5350',
  mercon_sreng: '#ff7043',
  meriam_bambu: '#66bb6a',
};

const WEAPON_STAMINA: Record<string, number> = {
  sarung_pecut: 10,
  sandal_jepit: 12,
  petasan_banting: 18,
  mercon_sreng: 24,
  meriam_bambu: 38,
};

function weaponType(raw: unknown): WeaponType {
  if (raw === 'melee') return 'melee';
  return 'thrown'; // ranged_projectile / ranged_aoe / ranged_rocket / heavy_artillery
}

export function normalizeCharacters(raw: unknown): CharacterCatalog {
  const result: CharacterCatalog = {};
  for (const item of rawList(raw, 'characters')) {
    const id = text(item.id, '');
    if (!id) continue;
    const base = isRecord(item.base) ? item.base : isRecord(item.baseStats) ? item.baseStats : {};
    const costs = isRecord(item.upgradeCost) ? item.upgradeCost : {};
    const scaling = isRecord(item.upgradeScaling) ? item.upgradeScaling : {};

    result[id] = {
      id,
      name: text(item.name, id),
      description: text(item.description, ''),
      assetKey: text(item.assetKey, `char_${id}`),
      color: text(item.color, '#f6c28b'),
      base: {
        maxHp: num(base.maxHp, 100),
        moveSpeed: num(base.moveSpeed, 185),
        staminaMax: num(base.staminaMax, 100),
        staminaRegen: num(base.staminaRegen, 18),
      },
      upgradeCost: {
        hp: cost(costs.hp, { base: num(scaling.hpCost ?? scaling.baseCost, 40), growth: num(scaling.costMultiplier, 1.32) }),
        speed: cost(costs.speed, { base: num(scaling.speedCost ?? scaling.baseCost, 45), growth: num(scaling.costMultiplier, 1.35) }),
        staminaRegen: cost(costs.staminaRegen, { base: num(scaling.staminaCost ?? scaling.baseCost, 35), growth: num(scaling.costMultiplier, 1.3) }),
      },
    } satisfies CharacterDefinition;
  }
  return result;
}

export function normalizeWeapons(raw: unknown): WeaponCatalog {
  const result: WeaponCatalog = {};
  for (const item of rawList(raw, 'weapons')) {
    const id = text(item.id, '');
    if (!id) continue;
    const base = isRecord(item.base) ? item.base : isRecord(item.baseStats) ? item.baseStats : {};
    const perLevel = isRecord(item.perLevel) ? item.perLevel : {};
    const costs = isRecord(item.upgradeCost) ? item.upgradeCost : {};
    const scaling = isRecord(item.upgradeScaling) ? item.upgradeScaling : {};
    const cooldownMs = num(base.cooldownMs, 600);
    const projectileSpeed = num(base.projectileSpeed, 0);
    const range = num(base.range, 0);
    const fuseMs = num(base.fuseMs, projectileSpeed > 0 && range > 0 ? (range / projectileSpeed) * 1000 : 0);
    const type = weaponType(item.type);
    const cooldownReductionMs = num(scaling.cooldownReductionMs, 0);

    result[id] = {
      id,
      name: text(item.name, id),
      description: text(item.description, ''),
      type,
      assetKey: text(item.assetKey, `weap_${id}`),
      color: text(item.color, WEAPON_COLORS[id] ?? '#ffffff'),
      unlockCost: num(item.unlockCost, 0),
      maxLevel: num(item.maxLevel ?? scaling.maxLevel, 10),
      base: {
        damage: num(base.damage, 20),
        cooldownMs,
        staminaCost: num(base.staminaCost, WEAPON_STAMINA[id] ?? 12),
        range,
        radius: num(base.radius ?? base.aoeRadius, 0),
        projectileSpeed,
        fuseMs,
        arcDegrees: num(base.arcDegrees, type === 'melee' ? 110 : 0),
      },
      perLevel: {
        damage: num(perLevel.damage ?? scaling.damagePerLevel, 3),
        radius: num(perLevel.radius ?? scaling.radiusPerLevel, 0),
        cooldownReduction: num(perLevel.cooldownReduction, cooldownMs > 0 ? cooldownReductionMs / cooldownMs : 0),
      },
      upgradeCost: cost(costs, {
        base: num(scaling.baseCost, 40),
        growth: num(scaling.costMultiplier, 1.35),
      }),
    } satisfies WeaponDefinition;
  }
  return result;
}
