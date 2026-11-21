/**
 * arena.js — multi-arena builder untuk perang-petasan.
 * Mendukung: alun_alun, tangga_tinggi, jembatan_chaos.
 */
import * as THREE from 'three';
import { createRigidBody, createCollider } from './physics.js';
import { PHYSICS_TUNING } from './tuning.js';

const ARENA_DEFS = {
  alun_alun: {
    id: 'alun_alun',
    label: 'Alun-Alun',
    width: 20,
    depth: 20,
    thickness: 1.5,
    topY: 0,
    fallY: -12,
    spawnPoints: [
      new THREE.Vector3(-5, 4, -5), new THREE.Vector3(5, 4, -5),
      new THREE.Vector3(-5, 4, 5), new THREE.Vector3(5, 4, 5),
      new THREE.Vector3(0, 4, -6), new THREE.Vector3(0, 4, 6),
      new THREE.Vector3(-6, 4, 0), new THREE.Vector3(6, 4, 0),
    ],
    hillZone: { center: new THREE.Vector3(0, 0, 0), radius: 2.8 },
    flagSpawns: { A: new THREE.Vector3(-7.5, 0.8, 0), B: new THREE.Vector3(7.5, 0.8, 0) },
  },
  tangga_tinggi: {
    id: 'tangga_tinggi',
    label: 'Tangga Tinggi',
    width: 20,
    depth: 20,
    thickness: 1.5,
    topY: 0,
    fallY: -12,
    spawnPoints: [
      new THREE.Vector3(-6, 4, -5), new THREE.Vector3(6, 4, -5),
      new THREE.Vector3(-6, 4, 5), new THREE.Vector3(6, 4, 5),
      new THREE.Vector3(-2, 7, 0), new THREE.Vector3(2, 7, 0),
      new THREE.Vector3(0, 4, -7), new THREE.Vector3(0, 4, 7),
    ],
    hillZone: { center: new THREE.Vector3(0, 3.05, 0), radius: 2.2 },
    flagSpawns: { A: new THREE.Vector3(-7.5, 0.8, -6), B: new THREE.Vector3(7.5, 0.8, 6) },
  },
  jembatan_chaos: {
    id: 'jembatan_chaos',
    label: 'Jembatan Chaos',
    width: 12,
    depth: 28,
    thickness: 1.5,
    topY: 0,
    fallY: -12,
    spawnPoints: [
      new THREE.Vector3(-2, 4, -9), new THREE.Vector3(2, 4, -9),
      new THREE.Vector3(-2, 4, 9), new THREE.Vector3(2, 4, 9),
      new THREE.Vector3(0, 4, -4), new THREE.Vector3(0, 4, 4),
      new THREE.Vector3(-2, 4, 0), new THREE.Vector3(2, 4, 0),
    ],
    hillZone: { center: new THREE.Vector3(0, 0, 0), radius: 2.3 },
    flagSpawns: { A: new THREE.Vector3(0, 0.8, -11), B: new THREE.Vector3(0, 0.8, 11) },
  },
};

export const ARENA_TYPES = Object.keys(ARENA_DEFS);

/** Live arena config (mutated on createArena) for backward compatibility. */
export const ARENA = {
  type: 'alun_alun',
  width: 20,
  depth: 20,
  halfWidth: 10,
  halfDepth: 10,
  halfSize: 10,
  thickness: 1.5,
  topY: 0,
  fallY: -12,
  spawn: new THREE.Vector3(0, 4, 0),
  spawnPoints: ARENA_DEFS.alun_alun.spawnPoints.map((p) => p.clone()),
  hillZone: { center: ARENA_DEFS.alun_alun.hillZone.center.clone(), radius: ARENA_DEFS.alun_alun.hillZone.radius },
  flagSpawns: {
    A: ARENA_DEFS.alun_alun.flagSpawns.A.clone(),
    B: ARENA_DEFS.alun_alun.flagSpawns.B.clone(),
  },
};

export function isRingOut(y) {
  return y < ARENA.fallY;
}

export function getArenaDef(type) {
  return ARENA_DEFS[type] || ARENA_DEFS.alun_alun;
}

function makeGridTexture(colorA = '#7bc96f', colorB = '#9be28b', line = '#dff5d8') {
  const size = 512;
  const cells = 8;
  const cell = size / cells;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  for (let y = 0; y < cells; y += 1) {
    for (let x = 0; x < cells; x += 1) {
      ctx.fillStyle = (x + y) % 2 === 0 ? colorA : colorB;
      ctx.fillRect(x * cell, y * cell, cell, cell);
    }
  }
  ctx.strokeStyle = line;
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, size - 6, size - 6);
  ctx.lineWidth = 2;
  for (let i = 1; i < cells; i += 1) {
    const p = i * cell;
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(size, p); ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  return tex;
}

function disposeMesh(obj) {
  if (!obj) return;
  obj.traverse?.((n) => {
    if (n.geometry) n.geometry.dispose?.();
    if (n.material) {
      if (Array.isArray(n.material)) n.material.forEach((m) => { m.map?.dispose?.(); m.dispose?.(); });
      else { n.material.map?.dispose?.(); n.material.dispose?.(); }
    }
  });
}

function makeBox(scene, world, bodies, colliders, meshes, opts) {
  const { w, h, d, x, y, z, color = 0x90a4ae, roughness = 0.85, tex = null, fixed = true, friction } = opts;
  const mat = new THREE.MeshStandardMaterial({ color, roughness, map: tex || null });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  meshes.push(mesh);

  const body = createRigidBody({ x, y, z, type: fixed ? 'fixed' : 'dynamic' });
  bodies.push(body);
  const col = createCollider(body, {
    shape: 'cuboid',
    halfExtents: [w / 2, h / 2, d / 2],
    friction: friction ?? PHYSICS_TUNING.arenaFriction,
    restitution: 0,
  });
  colliders.push(col);
  return { mesh, body, collider: col };
}

function makeRamp(scene, world, bodies, colliders, meshes, opts) {
  // Ramp approximated as rotated thin box for visual + physics.
  const { w, h, d, x, y, z, rotX = 0, rotZ = 0, color = 0xb0bec5 } = opts;
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.8 });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  mesh.rotation.x = rotX;
  mesh.rotation.z = rotZ;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  meshes.push(mesh);

  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rotX, 0, rotZ));
  const body = createRigidBody({ x, y, z, rot: { x: q.x, y: q.y, z: q.z, w: q.w }, type: 'fixed' });
  bodies.push(body);
  const col = createCollider(body, {
    shape: 'cuboid',
    halfExtents: [w / 2, h / 2, d / 2],
    friction: PHYSICS_TUNING.arenaFriction,
    restitution: 0,
  });
  colliders.push(col);
  return { mesh, body, collider: col };
}

function addLights(group) {
  const hemi = new THREE.HemisphereLight(0xcfefff, 0x4a5a35, 0.95);
  group.add(hemi);
  const dir = new THREE.DirectionalLight(0xfff2cc, 1.15);
  dir.position.set(12, 24, 10);
  dir.castShadow = true;
  dir.shadow.mapSize.set(2048, 2048);
  const d = 26;
  dir.shadow.camera.left = -d; dir.shadow.camera.right = d;
  dir.shadow.camera.top = d; dir.shadow.camera.bottom = -d;
  dir.shadow.camera.near = 0.5; dir.shadow.camera.far = 80;
  dir.shadow.bias = -0.0005;
  group.add(dir);
  group.add(dir.target);
  const fill = new THREE.DirectionalLight(0x9ecbff, 0.35);
  fill.position.set(-14, 10, -12);
  group.add(fill);
}

export function createArena(scene, world, options = {}) {
  const type = options.type && ARENA_DEFS[options.type] ? options.type : (ARENA.type || 'alun_alun');
  const def = ARENA_DEFS[type];
  const { width, depth, thickness, topY, fallY } = def;
  const halfWidth = width / 2;
  const halfDepth = depth / 2;
  const halfSize = Math.max(halfWidth, halfDepth);

  // Update live ARENA for compatibility
  ARENA.type = type;
  ARENA.width = width; ARENA.depth = depth;
  ARENA.halfWidth = halfWidth; ARENA.halfDepth = halfDepth; ARENA.halfSize = halfSize;
  ARENA.thickness = thickness; ARENA.topY = topY; ARENA.fallY = fallY;
  ARENA.spawn = new THREE.Vector3(0, 4, 0);
  ARENA.spawnPoints = def.spawnPoints.map((p) => p.clone());
  ARENA.hillZone = { center: def.hillZone.center.clone(), radius: def.hillZone.radius };
  ARENA.flagSpawns = { A: def.flagSpawns.A.clone(), B: def.flagSpawns.B.clone() };

  const group = new THREE.Group();
  group.name = `arena-${type}`;
  const bodies = [];
  const colliders = [];
  const meshes = [];

  addLights(group);

  // Main platform
  const centerY = topY - thickness / 2;
  const tex = makeGridTexture(type === 'jembatan_chaos' ? '#5d7f66' : '#7bc96f', type === 'jembatan_chaos' ? '#739c7d' : '#9be28b', '#dff5d8');
  if (tex) { tex.repeat.set(Math.max(1, width / 8), Math.max(1, depth / 8)); }
  const main = makeBox(scene, world, bodies, colliders, meshes, {
    w: width, h: thickness, d: depth, x: 0, y: centerY, z: 0, color: 0xffffff, roughness: 0.9, tex, friction: PHYSICS_TUNING.arenaFriction,
  });
  group.add(main.mesh);
  main.mesh.material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, map: tex || null });
  // The box was added to scene by makeBox; move into group for easy cleanup
  scene.remove(main.mesh); group.add(main.mesh);

  // Edge rim
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xf6f0cf, roughness: 0.6 });
  const rimH = 0.2, rimT = 0.35, rimY = topY + rimH / 2;
  const rimDefs = [
    { w: width + rimT * 2, h: rimH, d: rimT, x: 0, z: halfDepth + rimT / 2 },
    { w: width + rimT * 2, h: rimH, d: rimT, x: 0, z: -halfDepth - rimT / 2 },
    { w: rimT, h: rimH, d: depth, x: halfWidth + rimT / 2, z: 0 },
    { w: rimT, h: rimH, d: depth, x: -halfWidth - rimT / 2, z: 0 },
  ];
  for (const r of rimDefs) {
    const rim = new THREE.Mesh(new THREE.BoxGeometry(r.w, r.h, r.d), rimMat);
    rim.position.set(r.x, rimY, r.z);
    rim.castShadow = true; rim.receiveShadow = true;
    group.add(rim); meshes.push(rim);
  }

  // Arena-specific obstacles
  if (type === 'alun_alun') {
    const pillarPositions = [[-4, -4], [4, -4], [-4, 4], [4, 4], [0, 0]];
    for (const [px, pz] of pillarPositions) {
      const p = makeBox(scene, world, bodies, colliders, meshes, { w: 1.2, h: 1.8, d: 1.2, x: px, y: topY + 0.9, z: pz, color: 0xd7ccc8, roughness: 0.7 });
      scene.remove(p.mesh); group.add(p.mesh);
    }
  } else if (type === 'tangga_tinggi') {
    // Upper deck
    const deck = makeBox(scene, world, bodies, colliders, meshes, { w: 8, h: 0.8, d: 8, x: 0, y: topY + 2.65, z: 0, color: 0x90caf9, roughness: 0.8 });
    scene.remove(deck.mesh); group.add(deck.mesh);
    // Pillars under deck
    for (const [px, pz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) {
      const p = makeBox(scene, world, bodies, colliders, meshes, { w: 0.8, h: 2.3, d: 0.8, x: px, y: topY + 1.15, z: pz, color: 0xb0bec5 });
      scene.remove(p.mesh); group.add(p.mesh);
    }
    // Ramps/stairs (approx ramps)
    const rampY = topY + 1.25;
    const rampLen = 5.2;
    const rampAngle = Math.atan2(3.05, rampLen);
    const ramp1 = makeRamp(scene, world, bodies, colliders, meshes, { w: 2.4, h: 0.35, d: rampLen, x: 0, y: rampY, z: 6.2, rotX: -rampAngle, color: 0xffcc80 });
    scene.remove(ramp1.mesh); group.add(ramp1.mesh);
    const ramp2 = makeRamp(scene, world, bodies, colliders, meshes, { w: 2.4, h: 0.35, d: rampLen, x: 0, y: rampY, z: -6.2, rotX: rampAngle, color: 0xffcc80 });
    scene.remove(ramp2.mesh); group.add(ramp2.mesh);
    // Low obstacles on main
    for (const [px, pz] of [[-6, -6], [6, 6]]) {
      const b = makeBox(scene, world, bodies, colliders, meshes, { w: 1.4, h: 1.0, d: 1.4, x: px, y: topY + 0.5, z: pz, color: 0xd7ccc8 });
      scene.remove(b.mesh); group.add(b.mesh);
    }
  } else if (type === 'jembatan_chaos') {
    // Small obstacles along bridge
    const obs = [[-2.5, -7], [2.5, -3], [-2.5, 2], [2.5, 6], [0, -10], [0, 10]];
    for (const [ox, oz] of obs) {
      const b = makeBox(scene, world, bodies, colliders, meshes, { w: 1.2, h: 1.2, d: 1.2, x: ox, y: topY + 0.6, z: oz, color: 0xffab91 });
      scene.remove(b.mesh); group.add(b.mesh);
    }
    // Side rails visual only
    const railMat = new THREE.MeshStandardMaterial({ color: 0xefebe9, roughness: 0.7 });
    for (const sx of [-halfWidth - 0.15, halfWidth + 0.15]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.6, depth), railMat);
      rail.position.set(sx, topY + 0.3, 0);
      rail.castShadow = true; rail.receiveShadow = true;
      group.add(rail); meshes.push(rail);
    }
  }

  scene.add(group);

  function dispose() {
    for (const b of bodies) { try { world.removeRigidBody(b); } catch (_) {} }
    if (group.parent) group.parent.remove(group);
    for (const m of meshes) disposeMesh(m);
    bodies.length = 0; colliders.length = 0; meshes.length = 0;
  }

  function applyFriction(friction) {
    for (const c of colliders) { try { c.setFriction(friction); } catch (_) {} }
  }

  return {
    type,
    group,
    body: main.body,
    collider: main.collider,
    colliders,
    bodies,
    meshes,
    spawn: ARENA.spawn.clone(),
    spawnPoints: ARENA.spawnPoints.map((p) => p.clone()),
    hillZone: { center: ARENA.hillZone.center.clone(), radius: ARENA.hillZone.radius },
    flagSpawns: { A: ARENA.flagSpawns.A.clone(), B: ARENA.flagSpawns.B.clone() },
    fallY,
    isRingOut,
    applyFriction,
    dispose,
  };
}