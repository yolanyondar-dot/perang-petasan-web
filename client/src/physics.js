/**
 * physics.js — pembungkus Rapier3D (compat) untuk perang-petasan.
 *
 * Menyediakan:
 * - initPhysics(): RAPIER.init() async + World dengan gravitasi arcade.
 * - stepPhysics(dt): satu langkah simulasi dengan dt di-clamp.
 * - createRigidBody() / createCollider(): helper pembuatan fisika.
 * - castRayDown(): ray vertikal untuk deteksi tanah (ground check).
 */
import RAPIER from '@dimforge/rapier3d-compat';
import { PHYSICS_TUNING } from './tuning.js';

/** Gravitasi arcade (diambil dari tuning). */
export const GRAVITY = { x: 0.0, y: PHYSICS_TUNING.gravityY, z: 0.0 };

/** Batas atas delta time fisika (detik) agar simulasi tidak meledak. */
export const MAX_PHYSICS_DT = 0.05;

let world = null;

/**
 * Inisialisasi Rapier secara async dan buat dunia fisika.
 * Harus dipanggil dan di-await sebelum memakai helper lain.
 */
export async function initPhysics() {
  await RAPIER.init();
  GRAVITY.y = PHYSICS_TUNING.gravityY;
  world = new RAPIER.World({ x: GRAVITY.x, y: GRAVITY.y, z: GRAVITY.z });
  world.timestep = 1 / 60;
  return world;
}

/** Ambil world yang sudah diinisialisasi (throw bila belum). */
export function getWorld() {
  if (!world) throw new Error('Fisika belum diinisialisasi: panggil await initPhysics() dulu.');
  return world;
}

/**
 * Satu langkah simulasi. dt di-clamp ke [0, MAX_PHYSICS_DT]
 * supaya tab yang kehilangan fokus tidak membuat fisika melompat jauh.
 */
export function stepPhysics(dt) {
  const w = getWorld();
  const clamped = Math.min(Math.max(Number.isFinite(dt) ? dt : 0, 0), MAX_PHYSICS_DT);
  w.timestep = clamped;
  w.step();
}

/**
 * Buat rigid body.
 * @param {object} options
 * @param {number} [options.x] @param {number} [options.y] @param {number} [options.z]
 * @param {'dynamic'|'fixed'|'kinematic'} [options.type]
 */
export function createRigidBody({
  x = 0,
  y = 0,
  z = 0,
  rot = null,
  rotation = null,
  type = 'dynamic',
  linearDamping = 0.05,
  angularDamping = 0.2,
} = {}) {
  const w = getWorld();
  const desc =
    type === 'fixed'
      ? RAPIER.RigidBodyDesc.fixed()
      : type === 'kinematic'
        ? RAPIER.RigidBodyDesc.kinematicPositionBased()
        : RAPIER.RigidBodyDesc.dynamic();

  desc.setTranslation(x, y, z);
  const q = rotation || rot;
  if (q && typeof q === 'object') {
    const qx = Number(q.x) || 0;
    const qy = Number(q.y) || 0;
    const qz = Number(q.z) || 0;
    const qw = Number(q.w) === 0 ? 0 : (Number(q.w) || 1);
    desc.setRotation({ x: qx, y: qy, z: qz, w: qw });
  }
  desc.setLinearDamping(linearDamping);
  desc.setAngularDamping(angularDamping);
  return w.createRigidBody(desc);
}

/**
 * Buat collider untuk sebuah rigid body.
 * @param {object} body rigid body Rapier
 * @param {object} options
 * @param {'cuboid'|'ball'|'capsule'} [options.shape]
 * @param {number[]} [options.halfExtents] setengah ukuran cuboid (hx, hy, hz)
 * @param {number} [options.radius] radius ball/capsule
 * @param {number} [options.halfHeight] setengah tinggi batang capsule
 */
export function createCollider(
  body,
  {
    shape = 'cuboid',
    halfExtents = [1, 1, 1],
    radius = 0.5,
    halfHeight = 0.5,
    friction = 0.8,
    restitution = 0,
  } = {},
) {
  const w = getWorld();
  let desc;
  if (shape === 'ball') {
    desc = RAPIER.ColliderDesc.ball(radius);
  } else if (shape === 'capsule') {
    desc = RAPIER.ColliderDesc.capsule(halfHeight, radius);
  } else {
    desc = RAPIER.ColliderDesc.cuboid(halfExtents[0], halfExtents[1], halfExtents[2]);
  }
  desc.setFriction(friction);
  desc.setRestitution(restitution);
  return w.createCollider(desc, body);
}

/**
 * Ray vertikal ke bawah dari titik (x, y, z).
 * `excludeCollider` dipakai agar ray tidak mengenai collider pemilik
 * (mis. capsule pemain saat ground check).
 * @returns {import('@dimforge/rapier3d-compat').RayColliderHit|null}
 */
export function castRayDown(worldRef, x, y, z, maxDistance, excludeCollider = undefined) {
  const ray = new RAPIER.Ray({ x, y, z }, { x: 0, y: -1, z: 0 });
  return worldRef.castRay(ray, maxDistance, true, undefined, undefined, excludeCollider);
}
