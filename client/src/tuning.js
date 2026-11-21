/**
 * tuning.js — parameter fisika terpusat untuk perang-petasan.
 * Nilai dapat diubah runtime lewat panel HUD.
 */

export const TUNING_DEFAULTS = Object.freeze({
  gravityY: -21.0,
  arenaFriction: 0.6,
  normalLinearDamping: 0.5,
  knockoutLinearDamping: 0.18,
  knockoutAngularDamping: 0.45,
  throwSpeedMin: 10.5,
  throwSpeedMax: 15.5,
  throwUpward: 5.5,
  explosionRadius: 4.5,
  explosionImpulseMax: 16.5,
  explosionLiftMax: 8.5,
  explosionFalloffPower: 1.25,
  knockoutImpulseThreshold: 8.5,
  knockoutDuration: 1.8,
  standUpHopVelocity: 4.0,
  punchKnockback: 7.5,
  punchUpward: 3.5,
});

export const PHYSICS_TUNING = { ...TUNING_DEFAULTS };

export function resetTuning() {
  Object.assign(PHYSICS_TUNING, TUNING_DEFAULTS);
  return PHYSICS_TUNING;
}

export function applyTuning(worldOrOpts = {}, maybeOpts = {}) {
  const opts = worldOrOpts && typeof worldOrOpts === 'object' && ('world' in worldOrOpts || 'arenaCollider' in worldOrOpts || 'players' in worldOrOpts)
    ? worldOrOpts
    : { world: worldOrOpts, ...maybeOpts };
  const { world, arenaCollider, players } = opts;
  if (world) {
    try {
      world.gravity = { x: 0, y: PHYSICS_TUNING.gravityY, z: 0 };
    } catch (_) {
      try { world.gravity.y = PHYSICS_TUNING.gravityY; } catch (_) {}
    }
  }
  if (arenaCollider) {
    try { arenaCollider.setFriction(PHYSICS_TUNING.arenaFriction); } catch (_) {}
  }
  if (Array.isArray(players)) {
    for (const p of players) {
      try { p.applyTuning?.(PHYSICS_TUNING); } catch (_) {}
    }
  }
  return PHYSICS_TUNING;
}