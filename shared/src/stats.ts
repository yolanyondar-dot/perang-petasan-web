import { UPGRADES, nextUpgradeCost } from './constants.js';
import type {
  CharacterDefinition,
  DerivedStats,
  Loadout,
  UpgradeKind,
  WeaponDefinition,
} from './types.js';

export const DEFAULT_LOADOUT: Loadout = {
  characterId: 'bocil_sarung',
  weaponId: 'sarung_pecut',
  upgrades: { hp: 0, speed: 0, staminaRegen: 0 },
  weaponLevel: 1,
};

function clampLevel(value: unknown, max: number): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : 0;
  return Math.max(0, Math.min(max, numeric));
}

export function sanitizeLoadout(loadout: Loadout | undefined, weapon: WeaponDefinition): Loadout {
  const source = loadout ?? DEFAULT_LOADOUT;
  return {
    characterId: source.characterId || DEFAULT_LOADOUT.characterId,
    weaponId: source.weaponId || DEFAULT_LOADOUT.weaponId,
    upgrades: {
      hp: clampLevel(source.upgrades?.hp, UPGRADES.maxCharacterLevel),
      speed: clampLevel(source.upgrades?.speed, UPGRADES.maxCharacterLevel),
      staminaRegen: clampLevel(source.upgrades?.staminaRegen, UPGRADES.maxCharacterLevel),
    },
    weaponLevel: Math.max(1, clampLevel(source.weaponLevel, weapon.maxLevel)),
  };
}

export function levelFor(loadout: Loadout, kind: UpgradeKind): number {
  if (kind === 'weapon') return loadout.weaponLevel;
  return loadout.upgrades[kind];
}

/** Level maksimal diambil dari weapons.json (senjata) / konstanta karakter. */
export function maxUpgradeLevel(
  _character: CharacterDefinition,
  weapon: WeaponDefinition,
  kind: UpgradeKind,
): number {
  return kind === 'weapon' ? weapon.maxLevel : UPGRADES.maxCharacterLevel;
}

/**
 * Biaya Koin THR selalu dihitung dari definisi yang berasal dari
 * characters.json / weapons.json — satu sumber kebenaran untuk client & server.
 */
export function upgradeCostFor(
  character: CharacterDefinition,
  weapon: WeaponDefinition,
  kind: UpgradeKind,
  currentLevel: number,
): number {
  const definition = kind === 'weapon' ? weapon.upgradeCost : character.upgradeCost[kind];
  return nextUpgradeCost(definition, currentLevel);
}

export function withLevel(loadout: Loadout, kind: UpgradeKind, level: number): Loadout {
  if (kind === 'weapon') return { ...loadout, weaponLevel: level };
  return {
    ...loadout,
    upgrades: { ...loadout.upgrades, [kind]: level },
  };
}

/** Satu sumber kebenaran untuk perhitungan statistik, dipakai server dan client. */
export function deriveStats(
  character: CharacterDefinition,
  weapon: WeaponDefinition,
  loadout: Loadout,
): DerivedStats {
  const safe = sanitizeLoadout(loadout, weapon);
  const weaponSteps = safe.weaponLevel - 1;

  return {
    maxHp: character.base.maxHp + safe.upgrades.hp * UPGRADES.perLevelHp,
    moveSpeed: character.base.moveSpeed + safe.upgrades.speed * UPGRADES.perLevelSpeed,
    staminaMax: character.base.staminaMax,
    staminaRegen: character.base.staminaRegen + safe.upgrades.staminaRegen * UPGRADES.perLevelStaminaRegen,
    damage: weapon.base.damage + weaponSteps * weapon.perLevel.damage,
    attackRadius: weapon.base.radius + weaponSteps * weapon.perLevel.radius,
    cooldownMs: Math.max(
      weapon.base.cooldownMs * 0.45,
      weapon.base.cooldownMs * (1 - weaponSteps * weapon.perLevel.cooldownReduction),
    ),
    staminaCost: weapon.base.staminaCost,
    range: weapon.base.range,
    projectileSpeed: weapon.base.projectileSpeed,
    fuseMs: weapon.base.fuseMs,
    arcDegrees: weapon.base.arcDegrees,
  };
}
