/**
 * petasan.js — manajer petasan: spawn, sumbu, ledakan, knockback, efek visual.
 */
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { getWorld, createRigidBody, createCollider } from './physics.js';
import { ARENA } from './arena.js';
import { PHYSICS_TUNING } from './tuning.js';
import { buildPetasanMockup } from './assetsMockup.js';

const DEFAULT_FUSE = 2.2;
const FAST_FLICKER_BELOW = 0.6;

let nextId = 1;

function makePetasanMesh(type = 'normal') {
  const variant = ['normal', 'banting', 'renteng'].includes(type) ? type : 'normal';
  const mockup = buildPetasanMockup(variant);
  const group = mockup.group;
  group.name = `petasan-${variant}`;

  // Spark dari mockup diganti material agar bisa animasi kedip
  const spark = mockup.spark;
  const sparkMat = new THREE.MeshStandardMaterial({
    color: 0xfff3c4,
    emissive: 0xff7a18,
    emissiveIntensity: 1.2,
    roughness: 0.2,
    toneMapped: false,
  });
  spark.material = sparkMat;

  const sparkLight = new THREE.PointLight(0xff7a18, 1.2, 2.5);
  sparkLight.position.copy(spark.position);
  group.add(sparkLight);

  group.traverse((obj) => { if (obj.isMesh) { obj.castShadow = true; obj.receiveShadow = true; } });
  return { group, spark, sparkMat, sparkLight };
}

function makeExplosionEffect(position, opts = {}) {
  const group = new THREE.Group();
  group.position.copy(position);
  const s = opts.visualScale ?? 1;
  const colorA = opts.colorA ?? 0xfff2b0;
  const colorB = opts.colorB ?? 0xff5a00;
  const lightColor = opts.lightColor ?? 0xff7a1a;

  const flashMat = new THREE.MeshBasicMaterial({ color: colorA, transparent: true, opacity: 0.95, depthWrite: false });
  const flash = new THREE.Mesh(new THREE.SphereGeometry(0.35 * s, 16, 16), flashMat);
  group.add(flash);

  const fireMat = new THREE.MeshBasicMaterial({ color: colorB, transparent: true, opacity: 0.8, depthWrite: false });
  const fire = new THREE.Mesh(new THREE.SphereGeometry(0.28 * s, 16, 16), fireMat);
  group.add(fire);

  const light = new THREE.PointLight(lightColor, 18 * s, 10 * s);
  group.add(light);

  const debris = [];
  const debrisGeom = new THREE.BoxGeometry(0.08 * s, 0.08 * s, 0.08 * s);
  const count = Math.max(6, Math.round(18 * s));
  for (let i = 0; i < count; i += 1) {
    const mat = new THREE.MeshStandardMaterial({
      color: i % 2 === 0 ? colorB : 0x333333,
      emissive: colorB,
      emissiveIntensity: 0.7,
      transparent: true,
      opacity: 1,
      roughness: 0.8,
    });
    const m = new THREE.Mesh(debrisGeom, mat);
    const dir = new THREE.Vector3(
      (Math.random() - 0.5) * 2,
      Math.random() * 1.6 + 0.2,
      (Math.random() - 0.5) * 2,
    ).normalize();
    const speed = (2.5 + Math.random() * 5) * s;
    m.userData.velocity = dir.multiplyScalar(speed);
    m.userData.rotVel = new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8);
    m.position.copy(dir.clone().multiplyScalar(0.1 * s));
    group.add(m);
    debris.push(m);
  }

  return {
    group,
    flash,
    flashMat,
    fire,
    fireMat,
    light,
    debris,
    age: 0,
    duration: 0.7 + 0.2 * s,
    maxScale: 4.8 * s,
  };
}

export function createPetasanManager(scene, physics, options = {}) {
  const world = physics?.world || physics?.getWorld?.() || getWorld();
  let ringOutY = options.ringOutY ?? ARENA.fallY;
  const getPlayers = options.getPlayers || (() => []);
  const onExplodeCb = typeof options.onExplode === 'function' ? options.onExplode : null;

  const petasans = [];
  const effects = [];
  const pendingExplosions = []; // { at, origin, radius, damageMul, impulseMul, visualScale }

  function resolveWorld() {
    return world || getWorld();
  }

  function spawnPetasan(position = { x: 0, y: 2, z: 0 }, opts = {}) {
    const w = resolveWorld();
    const type = opts.type || 'normal';
    const { group, spark, sparkMat, sparkLight } = makePetasanMesh(type);
    group.position.set(position.x, position.y, position.z);
    scene.add(group);

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(position.x, position.y, position.z)
      .setLinearDamping(0.25)
      .setAngularDamping(0.25);
    const body = w.createRigidBody(bodyDesc);

    const collDesc = RAPIER.ColliderDesc.cylinder(0.35, 0.2)
      .setFriction(0.8)
      .setRestitution(0.25);
    const collider = w.createCollider(collDesc, body);

    const p = {
      id: nextId++,
      type,
      group,
      spark,
      sparkMat,
      sparkLight,
      body,
      collider,
      fuse: opts.fuse ?? DEFAULT_FUSE,
      maxFuse: opts.fuse ?? DEFAULT_FUSE,
      exploded: false,
      held: false,
      holder: null,
      carried: false,
      carrier: null,
      cleaned: false,
      throwGrace: 0, // untuk banting: waktu sisa grace period setelah dilempar
      hasBeenThrown: false,
    };
    petasans.push(p);
    return p;
  }

  function cleanupPetasan(p) {
    if (!p || p.cleaned) return;
    p.cleaned = true;
    p.held = false;
    p.holder = null;
    p.carried = false;
    p.carrier = null;
    const w = resolveWorld();
    try {
      if (p.body && w.getRigidBody(p.body.handle)) {
        w.removeRigidBody(p.body);
      }
    } catch (_) {
      // aman jika sudah terhapus
    }
    if (p.group?.parent) p.group.parent.remove(p.group);
    p.group?.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose?.();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose?.());
        else obj.material.dispose?.();
      }
    });
  }

  function removeFromList(p) {
    const idx = petasans.indexOf(p);
    if (idx >= 0) petasans.splice(idx, 1);
  }

  function applyExplosionImpulse(body, origin, radius) {
    if (!body) return { applied: false, impulse: new THREE.Vector3(), magnitude: 0 };
    let t;
    try {
      t = body.translation();
    } catch (_) {
      return { applied: false, impulse: new THREE.Vector3(), magnitude: 0 };
    }
    const pos = new THREE.Vector3(t.x, t.y, t.z);
    const delta = pos.clone().sub(origin);
    const d = delta.length();
    if (d > radius) return { applied: false, impulse: new THREE.Vector3(), magnitude: 0 };

    const falloff = Math.pow(Math.max(0, 1 - d / radius), PHYSICS_TUNING.explosionFalloffPower);
    const dir = d > 0.0001 ? delta.clone().normalize() : new THREE.Vector3((Math.random() - 0.5) * 2, 0, (Math.random() - 0.5) * 2).normalize();
    // Dorongan horizontal menjauh dari pusat + lift ke atas.
    const horizontal = new THREE.Vector3(dir.x, 0, dir.z);
    if (horizontal.lengthSq() < 1e-6) horizontal.set(1, 0, 0); else horizontal.normalize();
    const impulse = horizontal.multiplyScalar(PHYSICS_TUNING.explosionImpulseMax * falloff);
    impulse.y += PHYSICS_TUNING.explosionLiftMax * falloff;
    try {
      body.applyImpulse({ x: impulse.x, y: impulse.y, z: impulse.z }, true);
    } catch (_) {
      return { applied: false, impulse: new THREE.Vector3(), magnitude: 0 };
    }
    return { applied: true, impulse, falloff, closeness: falloff, magnitude: impulse.length() };
  }

  function applyExplosionAt(origin, opts = {}) {
    const radius = opts.radius ?? PHYSICS_TUNING.explosionRadius;
    const damageMul = opts.damageMul ?? 1;
    const impulseMul = opts.impulseMul ?? 1;
    const visualScale = opts.visualScale ?? 1;
    const fxOpts = opts.fxOpts || {};
    const fx = makeExplosionEffect(origin, { visualScale, ...fxOpts });
    scene.add(fx.group);
    effects.push(fx);
    try { onExplodeCb?.({ origin: origin.clone(), radius, visualScale, damageMul, impulseMul }); } catch (_) {}

    const impacts = [];
    const players = getPlayers() || [];
    for (const player of players) {
      if (!player?.body) continue;
      const result = applyExplosionImpulse(player.body, origin, radius);
      if (result.applied) {
        const impulse = result.impulse.clone().multiplyScalar(impulseMul);
        if (impulseMul !== 1) {
          const extra = impulse.clone().sub(result.impulse);
          try { player.body.applyImpulse({ x: extra.x, y: extra.y, z: extra.z }, true); } catch (_) {}
        }
        const damage = Math.max(5, Math.round(60 * result.closeness * damageMul));
        impacts.push({ player, damage, impulse, closeness: result.closeness, magnitude: impulse.length() });
      }
    }

    for (const other of petasans) {
      if (!other || other.cleaned || other.exploded || other.held) continue;
      const result = applyExplosionImpulse(other.body, origin, radius);
      if (result.applied && impulseMul !== 1) {
        const extra = result.impulse.clone().multiplyScalar(impulseMul - 1);
        try { other.body.applyImpulse({ x: extra.x, y: extra.y, z: extra.z }, true); } catch (_) {}
      }
    }
    return impacts;
  }

  function explode(p, cause = 'fuse', opts = {}) {
    if (!p || p.exploded || p.cleaned) return [];
    p.exploded = true;

    let origin;
    try {
      const t = p.body.translation();
      origin = new THREE.Vector3(t.x, t.y, t.z);
    } catch (_) {
      origin = p.group.position.clone();
    }

    if (p.holder && p.holder.heldPetasan === p) p.holder.heldPetasan = null;
    if (p.carrier && p.carrier.carriedEntity === p) p.carrier.carriedEntity = null;
    p.held = false; p.holder = null; p.carried = false; p.carrier = null;

    const type = p.type || 'normal';
    cleanupPetasan(p);
    removeFromList(p);

    const impacts = [];
    if (type === 'renteng' && !opts._pop) {
      // Renteng: beberapa ledakan kecil beruntun (pop-pop-pop) di area sempit
      const pops = [
        { delay: 0, ox: 0, oz: 0 },
        { delay: 0.16, ox: 0.35, oz: -0.2 },
        { delay: 0.32, ox: -0.3, oz: 0.35 },
        { delay: 0.48, ox: 0.15, oz: 0.25 },
      ];
      for (const pop of pops) {
        const o = origin.clone().add(new THREE.Vector3(pop.ox, 0, pop.oz));
        if (pop.delay <= 0) {
          impacts.push(...applyExplosionAt(o, { radius: 2.2, damageMul: 0.45, impulseMul: 0.7, visualScale: 0.55, fxOpts: { colorA: 0xfff59d, colorB: 0xff5252, lightColor: 0xff1744 } }));
        } else {
          pendingExplosions.push({ at: performance.now() / 1000 + pop.delay, origin: o, radius: 2.2, damageMul: 0.45, impulseMul: 0.7, visualScale: 0.55, fxOpts: { colorA: 0xfff59d, colorB: 0xff5252, lightColor: 0xff1744 } });
        }
      }
    } else {
      impacts.push(...applyExplosionAt(origin, { radius: opts.radius ?? PHYSICS_TUNING.explosionRadius, damageMul: opts.damageMul ?? 1, impulseMul: opts.impulseMul ?? 1, visualScale: opts.visualScale ?? 1, fxOpts: opts.fxOpts }));
    }

    return impacts;
  }

  function setHeld(p, held, holder = null) {
    if (!p || p.cleaned || p.exploded) return;
    if (held) {
      if (p.holder && p.holder.heldPetasan === p) p.holder.heldPetasan = null;
      if (p.carrier && p.carrier.carriedEntity === p) p.carrier.carriedEntity = null;
      p.carried = false;
      p.carrier = null;
    }
    p.held = held;
    p.holder = held ? holder : null;
    try {
      if (held) {
        p.body.setGravityScale?.(1, true);
        p.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
        p.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        p.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      } else if (!p.carried) {
        p.body.setGravityScale?.(1, true);
        p.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
        p.body.wakeUp?.();
      }
    } catch (_) {
      // fallback
    }
  }

  function setCarried(p, carried, carrier = null) {
    if (!p || p.cleaned || p.exploded) return;
    if (carried) {
      if (p.holder && p.holder.heldPetasan === p) p.holder.heldPetasan = null;
      if (p.carrier && p.carrier.carriedEntity === p) p.carrier.carriedEntity = null;
      p.held = false;
      p.holder = null;
    }
    p.carried = carried;
    p.carrier = carried ? carrier : null;
    try {
      if (carried) {
        p.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
        p.body.setGravityScale?.(0, true);
        p.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        p.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      } else {
        p.body.setGravityScale?.(1, true);
        if (!p.held) {
          p.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
          p.body.wakeUp?.();
        }
      }
    } catch (_) {
      // fallback
    }
  }

  function throwPetasan(p, origin, direction, speed = 12, upwardBoost = 5.5) {
    if (!p || p.cleaned || p.exploded) return false;
    const dir = direction.clone();
    dir.y = 0;
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
    dir.normalize();

    p.held = false;
    p.holder = null;
    p.carried = false;
    p.carrier = null;
    p.hasBeenThrown = true;
    p.throwGrace = p.type === 'banting' ? 0.15 : 0;
    try {
      p.body.setGravityScale?.(1, true);
      p.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
      p.body.setTranslation({ x: origin.x, y: origin.y, z: origin.z }, true);
      p.body.setLinvel({ x: dir.x * speed, y: upwardBoost, z: dir.z * speed }, true);
      p.body.setAngvel({ x: (Math.random() - 0.5) * 4, y: (Math.random() - 0.5) * 4, z: (Math.random() - 0.5) * 4 }, true);
      p.body.wakeUp?.();
    } catch (_) {
      return false;
    }
    return true;
  }

  function discard(p) {
    if (!p || p.cleaned) return;
    // Lepas dari holder/carrier dan bersihkan aman tanpa ledakan.
    if (p.holder && p.holder.heldPetasan === p) p.holder.heldPetasan = null;
    if (p.carrier && p.carrier.carriedEntity === p) p.carrier.carriedEntity = null;
    p.held = false;
    p.holder = null;
    p.carried = false;
    p.carrier = null;
    cleanupPetasan(p);
    removeFromList(p);
  }

  function updateEffects(dt) {
    for (let i = effects.length - 1; i >= 0; i -= 1) {
      const fx = effects[i];
      fx.age += dt;
      const t = Math.min(fx.age / fx.duration, 1);
      const easeOut = 1 - Math.pow(1 - t, 3);

      const maxScale = fx.maxScale ?? 4.8;
      const scale = 0.4 + easeOut * maxScale;
      fx.flash.scale.setScalar(scale);
      fx.fire.scale.setScalar(scale * 0.75);
      fx.flashMat.opacity = (1 - t) * 0.95;
      fx.fireMat.opacity = (1 - t) * 0.8;
      fx.light.intensity = (1 - t) * 18 * ((fx.maxScale ?? 4.8) / 4.8);

      for (const d of fx.debris) {
        d.userData.velocity.y -= 9.8 * dt;
        d.position.addScaledVector(d.userData.velocity, dt);
        d.rotation.x += d.userData.rotVel.x * dt;
        d.rotation.y += d.userData.rotVel.y * dt;
        d.rotation.z += d.userData.rotVel.z * dt;
        if (d.material) d.material.opacity = Math.max(0, 1 - t * 1.2);
      }

      if (t >= 1) {
        if (fx.group.parent) fx.group.parent.remove(fx.group);
        fx.group.traverse((obj) => {
          if (obj.geometry) obj.geometry.dispose?.();
          if (obj.material) {
            if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose?.());
            else obj.material.dispose?.();
          }
        });
        effects.splice(i, 1);
      }
    }
  }

  function update(dt, players = getPlayers()) {
    const impacts = [];
    // Update petasan aktif. Iterate over copy because explode mutates array.
    for (const p of [...petasans]) {
      if (p.cleaned || p.exploded) continue;

      // Sinkronisasi visual dengan body fisika
      try {
        const t = p.body.translation();
        const r = p.body.rotation();
        p.group.position.set(t.x, t.y, t.z);
        p.group.quaternion.set(r.x, r.y, r.z, r.w);
      } catch (_) {
        // body mungkin sudah invalid
      }

      // Ring-out: bersihkan tanpa error
      if (p.group.position.y < ringOutY) {
        if (p.holder && p.holder.heldPetasan === p) p.holder.heldPetasan = null;
        cleanupPetasan(p);
        removeFromList(p);
        continue;
      }

      // Banting: meledak saat kontak setelah grace period
      if (p.type === 'banting' && p.hasBeenThrown && !p.held && !p.carried && !p.exploded) {
        p.throwGrace = Math.max(0, (p.throwGrace || 0) - dt);
        if (p.throwGrace <= 0) {
          let shouldExplode = p.group.position.y <= 1.15; // kontak lantai/permukaan arena
          if (!shouldExplode) {
            for (const pl of (players || [])) {
              if (!pl?.body || pl.hp <= 0) continue;
              let pt;
              try { pt = pl.body.translation(); } catch (_) { continue; }
              const dx = pt.x - p.group.position.x;
              const dy = pt.y - p.group.position.y;
              const dz = pt.z - p.group.position.z;
              if ((dx * dx + dy * dy + dz * dz) < 1.0) { shouldExplode = true; break; }
            }
          }
          if (shouldExplode) {
            const hit = explode(p, 'impact');
            if (hit.length) impacts.push(...hit);
            continue;
          }
        }
      }

      // Timer sumbu
      p.fuse -= dt;
      const flickerFast = p.fuse < FAST_FLICKER_BELOW;
      const flickerRate = flickerFast ? 28 : 8;
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.001 * flickerRate * Math.PI * 2);
      const intensity = flickerFast ? 1.4 + pulse * 2.6 : 0.8 + pulse * 1.4;
      p.sparkMat.emissiveIntensity = intensity;
      p.spark.scale.setScalar(flickerFast ? 0.8 + pulse * 0.55 : 0.9 + pulse * 0.25);
      p.sparkLight.intensity = intensity * 0.8;

      if (p.fuse <= 0) {
        const hit = explode(p, 'fuse');
        if (hit.length) impacts.push(...hit);
      }
    }

    // Pending pop explosions (renteng)
    if (pendingExplosions.length) {
      const now = performance.now() / 1000;
      for (let i = pendingExplosions.length - 1; i >= 0; i -= 1) {
        const pe = pendingExplosions[i];
        if (now >= pe.at) {
          pendingExplosions.splice(i, 1);
          impacts.push(...applyExplosionAt(pe.origin, pe));
        }
      }
    }

    updateEffects(dt);
    return impacts;
  }

  function clearAll() {
    for (const p of [...petasans]) discard(p);
    petasans.length = 0;
    for (const fx of [...effects]) {
      if (fx.group?.parent) fx.group.parent.remove(fx.group);
      fx.group.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose?.();
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose?.());
          else obj.material.dispose?.();
        }
      });
    }
    effects.length = 0;
    pendingExplosions.length = 0;
  }

  return {
    spawn: spawnPetasan,
    update,
    explode,
    discard,
    clearAll,
    setHeld,
    setCarried,
    throwPetasan,
    setRingOutY(y) { if (Number.isFinite(y)) ringOutY = y; },
    get petasans() {
      return petasans;
    },
    get effects() {
      return effects;
    },
  };
}
