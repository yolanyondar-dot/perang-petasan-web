/**
 * pickup.js — power-up item jatuh ke arena, diambil pemain, aktifkan efek.
 */
import * as THREE from 'three';
import { ARENA } from './arena.js';

const TYPES = ['banting', 'renteng', 'sarung_tinju'];
const LABELS = {
  banting: 'BANTING',
  renteng: 'RENTENG',
  sarung_tinju: 'TINJU+',
};
const COLORS = {
  banting: { main: 0xff9800, emissive: 0xff5722, glow: 0xffb74d },
  renteng: { main: 0x66bb6a, emissive: 0x2e7d32, glow: 0xa5d6a7 },
  sarung_tinju: { main: 0xff5252, emissive: 0xff1744, glow: 0xff8a80 },
};

const DROP_INTERVAL = 10;
const MAX_ACTIVE = 3;
const DROP_Y = 12;
const LAND_Y = 0.95; // di atas lantai arena
const FALL_SPEED = 5.5;
const PICKUP_RADIUS = 1.15;
const EFFECT_DURATION = 12;
const ARENA_MARGIN = 1.6;

function randomLandingPos() {
  const hx = (ARENA.halfWidth ?? ARENA.halfSize ?? 8) - ARENA_MARGIN;
  const hz = (ARENA.halfDepth ?? ARENA.halfSize ?? 8) - ARENA_MARGIN;
  return new THREE.Vector3(
    (Math.random() * 2 - 1) * hx,
    LAND_Y,
    (Math.random() * 2 - 1) * hz,
  );
}

function makePickupMesh(type) {
  const c = COLORS[type] || COLORS.banting;
  const group = new THREE.Group();
  group.name = `pickup-${type}`;

  const box = new THREE.Mesh(
    new THREE.BoxGeometry(0.72, 0.72, 0.72),
    new THREE.MeshStandardMaterial({ color: c.main, roughness: 0.35, metalness: 0.15, emissive: c.emissive, emissiveIntensity: 0.25 }),
  );
  box.castShadow = true;
  box.receiveShadow = true;
  group.add(box);

  const rim = new THREE.Mesh(
    new THREE.BoxGeometry(0.78, 0.12, 0.78),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, emissive: c.glow, emissiveIntensity: 0.15 }),
  );
  rim.position.y = 0.32;
  group.add(rim);

  // Icon sederhana per tipe
  const iconMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: c.glow, emissiveIntensity: 0.6, roughness: 0.4 });
  if (type === 'banting') {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.34, 12), iconMat);
    cone.position.y = 0.52;
    group.add(cone);
  } else if (type === 'renteng') {
    for (let i = -1; i <= 1; i += 1) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.085, 10, 10), iconMat);
      s.position.set(i * 0.16, 0.52, 0);
      group.add(s);
    }
  } else {
    // sarung tinju - dua sphere seperti sarung
    const g = new THREE.SphereGeometry(0.13, 12, 12);
    const l = new THREE.Mesh(g, iconMat); l.position.set(-0.14, 0.52, 0); group.add(l);
    const r = new THREE.Mesh(g, iconMat); r.position.set(0.14, 0.52, 0); group.add(r);
  }

  const light = new THREE.PointLight(c.glow, 0.8, 4);
  light.position.y = 0.8;
  group.add(light);

  // Label billboard
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, 256, 64);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(18, 10, 220, 44);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 30px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(LABELS[type] || type, 128, 32);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const label = new THREE.Mesh(
    new THREE.PlaneGeometry(1.1, 0.28),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
  label.position.y = 1.05;
  group.add(label);

  return { group, box, label, light };
}

function makeMarker(type) {
  const c = COLORS[type] || COLORS.banting;
  const g = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.35, 0.55, 32),
    new THREE.MeshBasicMaterial({ color: c.glow, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  g.add(ring);
  const dot = new THREE.Mesh(
    new THREE.CircleGeometry(0.18, 24),
    new THREE.MeshBasicMaterial({ color: c.main, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }),
  );
  dot.rotation.x = -Math.PI / 2;
  dot.position.y = 0.031;
  g.add(dot);
  return g;
}

export function createPickupManager(scene, options = {}) {
  const getPlayers = options.getPlayers || (() => []);
  const pickups = [];
  let spawnTimer = 2; // drop pertama cepat

  function disposeObject(obj) {
    if (!obj) return;
    if (obj.parent) obj.parent.remove(obj);
    obj.traverse?.((n) => {
      if (n.geometry) n.geometry.dispose?.();
      if (n.material) {
        if (Array.isArray(n.material)) n.material.forEach((m) => { m.map?.dispose?.(); m.dispose?.(); });
        else { n.material.map?.dispose?.(); n.material.dispose?.(); }
      }
    });
  }

  function removePickup(p) {
    const idx = pickups.indexOf(p);
    if (idx >= 0) pickups.splice(idx, 1);
    disposeObject(p.group);
    disposeObject(p.marker);
  }

  function spawnOne() {
    if (pickups.length >= MAX_ACTIVE) return null;
    const type = TYPES[Math.floor(Math.random() * TYPES.length)];
    const land = randomLandingPos();
    const { group, label, light } = makePickupMesh(type);
    group.position.set(land.x, DROP_Y, land.z);
    scene.add(group);

    const marker = makeMarker(type);
    marker.position.set(land.x, 0, land.z);
    scene.add(marker);

    const p = {
      type,
      group,
      label,
      light,
      marker,
      landY: land.y,
      falling: true,
      age: 0,
    };
    pickups.push(p);
    return p;
  }

  function collectPickup(p, player) {
    if (!p || !player) return;
    try { player.applyPowerUp?.(p.type, EFFECT_DURATION); } catch (_) {}
    removePickup(p);
  }

  function update(dt, camera) {
    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawnTimer = DROP_INTERVAL;
      spawnOne();
    }

    const players = getPlayers() || [];
    for (let i = pickups.length - 1; i >= 0; i -= 1) {
      const p = pickups[i];
      p.age += dt;

      if (p.falling) {
        p.group.position.y -= FALL_SPEED * dt;
        // marker pulse
        const pulse = 0.5 + 0.5 * Math.sin(p.age * 6);
        p.marker.scale.setScalar(0.9 + pulse * 0.2);
        p.marker.children.forEach((c) => { if (c.material) c.material.opacity = (c.geometry?.type === 'RingGeometry' ? 0.35 : 0.2) + pulse * 0.25; });
        if (p.group.position.y <= p.landY) {
          p.group.position.y = p.landY;
          p.falling = false;
          disposeObject(p.marker);
          p.marker = null;
        }
      }

      // Idle animation
      p.group.rotation.y += dt * 1.6;
      p.group.position.y = (p.falling ? p.group.position.y : p.landY) + Math.sin(p.age * 2.4) * (p.falling ? 0 : 0.08);
      if (p.light) p.light.intensity = 0.6 + 0.3 * Math.sin(p.age * 3.5);
      if (p.label && camera) p.label.quaternion.copy(camera.quaternion);

      // Pickup check
      const pp = p.group.position;
      for (const player of players) {
        if (!player || player.hp <= 0) continue;
        let t;
        try { t = player.body.translation(); } catch (_) { continue; }
        const dx = t.x - pp.x;
        const dy = (t.y - pp.y);
        const dz = t.z - pp.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist < PICKUP_RADIUS) {
          collectPickup(p, player);
          break;
        }
      }
    }
  }

  function clear() {
    for (const p of [...pickups]) removePickup(p);
    pickups.length = 0;
  }

  return {
    update,
    spawnOne,
    clear,
    get pickups() { return pickups; },
  };
}