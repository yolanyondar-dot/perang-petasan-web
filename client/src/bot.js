/**
 * bot.js — AI sederhana untuk bot perang-petasan.
 * Bot mengontrol player melalui remoteInput dan aksi langsung.
 */
import * as THREE from 'three';
import { ARENA } from './arena.js';

const EDGE_MARGIN = 2.0; // jarak dari tepi untuk mulai menghindar

function safeHalfX() { return (ARENA.halfWidth ?? ARENA.halfSize ?? 8) - EDGE_MARGIN; }
function safeHalfZ() { return (ARENA.halfDepth ?? ARENA.halfSize ?? 8) - EDGE_MARGIN; }

function clampArenaX(v) { return Math.max(-safeHalfX(), Math.min(safeHalfX(), v)); }
function clampArenaZ(v) { return Math.max(-safeHalfZ(), Math.min(safeHalfZ(), v)); }

export function createBotController(player, ctx = {}) {
  const getPlayers = ctx.getPlayers || (() => []);
  const getPetasanManager = ctx.getPetasanManager || (() => null);
  const random = (a, b) => a + Math.random() * (b - a);

  const state = {
    mode: 'chase', // chase | prepare | retreat | center
    modeTimer: 0,
    thinkTimer: 0,
    target: null,
    throwCooldown: 0,
    bombCooldown: random(1.5, 3.5),
    jumpCooldown: 0,
    strafeDir: Math.random() < 0.5 ? -1 : 1,
    retreatDir: new THREE.Vector3(),
  };

  function pickTarget() {
    let best = null;
    let bestDist = Infinity;
    const my = player.group.position;
    for (const p of (getPlayers() || [])) {
      if (!p || p === player || p.hp <= 0) continue;
      const d = my.distanceTo(p.group.position);
      if (d < bestDist) { bestDist = d; best = p; }
    }
    state.target = best;
    return best;
  }

  function setMoveToward(targetPos, speedScale = 1, strafe = 0) {
    const my = player.group.position;
    const to = new THREE.Vector3().subVectors(targetPos, my);
    to.y = 0;
    const dist = to.length();
    if (dist < 0.001) {
      player.setRemoteInput({ moveX: 0, moveZ: 0 });
      return { dist: 0, dir: new THREE.Vector3() };
    }
    to.normalize();
    // Convert world dir to camera-relative? player.readMovement expects camera-relative moveX/moveZ
    // but remoteInput is interpreted in readMovement as added to x/z in camera space:
    // x += rx; z += rz; then move.addScaledVector(forward,z)+addScaledVector(right,x)
    // So remote moveZ is forward/back in camera space, moveX right/left. We need camera-aware.
    // Easier: compute in world space and convert using camera passed? We don't have camera here.
    // Alternative: set keys? no. Better: set remoteInput in world-space by faking camera forward along -Z.
    // But readMovement uses actual camera. We'll handle by providing camera in ctx.
    const camera = ctx.getCamera?.();
    let moveX = 0, moveZ = 0;
    if (camera) {
      const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
      const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
      moveZ = to.dot(fwd);
      moveX = to.dot(right);
      if (strafe) {
        moveX += strafe * 0.6;
      }
      const len = Math.hypot(moveX, moveZ) || 1;
      moveX = (moveX / len) * speedScale;
      moveZ = (moveZ / len) * speedScale;
    } else {
      // fallback: assume camera looking -Z
      moveX = to.x * speedScale + strafe * 0.6;
      moveZ = -to.z * speedScale;
    }
    player.setRemoteInput({ moveX: THREE.MathUtils.clamp(moveX, -1, 1), moveZ: THREE.MathUtils.clamp(moveZ, -1, 1) });
    return { dist, dir: to };
  }

  function stopMove() {
    player.setRemoteInput({ moveX: 0, moveZ: 0 });
  }

  function trySpawnAndHold() {
    const mgr = getPetasanManager();
    if (!mgr) return false;
    if (player.heldPetasan || player.carriedEntity) return false;
    if (player.knockoutTimer > 0 || player.carriedBy) return false;
    if (state.throwCooldown > 0) return false;
    const spawnPos = player.group.position.clone();
    spawnPos.y += 0.5;
    const type = player.powerUp?.type === 'banting' || player.powerUp?.type === 'renteng' ? player.powerUp.type : 'normal';
    const petasan = mgr.spawn(spawnPos, { fuse: 2.2, type });
    const held = player.holdPetasan(petasan);
    if (!held) { mgr.discard(petasan); return false; }
    return true;
  }

  function tryThrow() {
    if (!player.heldPetasan) return false;
    const threw = player.throwPetasan();
    if (threw) state.throwCooldown = 0.8;
    return threw;
  }

  function isNearEdge(pos, margin = EDGE_MARGIN) {
    const hx = (ARENA.halfWidth ?? ARENA.halfSize ?? 8) - margin;
    const hz = (ARENA.halfDepth ?? ARENA.halfSize ?? 8) - margin;
    return Math.abs(pos.x) > hx || Math.abs(pos.z) > hz;
  }

  function update(dt) {
    state.thinkTimer -= dt;
    state.modeTimer -= dt;
    state.throwCooldown = Math.max(0, state.throwCooldown - dt);
    state.bombCooldown = Math.max(0, state.bombCooldown - dt);
    state.jumpCooldown = Math.max(0, state.jumpCooldown - dt);

    // reset inputs each tick; actions may set them
    player.setRemoteInput({ jump: false, punch: false, grabThrow: false, bombHeld: false });

    if (player.hp <= 0) { stopMove(); return; }
    if (player.knockoutTimer > 0 || player.carriedBy) { stopMove(); return; }

    const myPos = player.group.position.clone();

    // Edge avoidance: prioritize returning to center
    if (isNearEdge(myPos, EDGE_MARGIN)) {
      const center = new THREE.Vector3(0, myPos.y, 0);
      setMoveToward(center, 1);
      if (state.jumpCooldown <= 0 && Math.random() < 0.02) { player.setRemoteInput({ jump: true }); state.jumpCooldown = 1.2; }
      // if holding bomb while fleeing edge, throw it
      if (player.heldPetasan) tryThrow();
      return;
    }

    if (state.thinkTimer <= 0) {
      state.thinkTimer = random(0.15, 0.35);
      pickTarget();
    }
    const target = state.target && state.target.hp > 0 ? state.target : pickTarget();

    if (!target) {
      setMoveToward(new THREE.Vector3(0, 0, 0), 0.4);
      return;
    }

    const dist = myPos.distanceTo(target.group.position);
    const toTarget = new THREE.Vector3().subVectors(target.group.position, myPos);
    toTarget.y = 0; if (toTarget.lengthSq() > 1e-6) toTarget.normalize();

    // Occasionally jump over obstacles/players
    if (state.jumpCooldown <= 0 && dist < 2.2 && Math.random() < 0.01) {
      player.setRemoteInput({ jump: true });
      state.jumpCooldown = random(1.5, 3.0);
    }

    // If carrying something, throw toward target
    if (player.carriedEntity) {
      setMoveToward(target.group.position, 0.8);
      if (dist < 6) {
        player.toggleCarryOrThrow(getPlayers(), getPetasanManager()?.petasans || []);
        state.mode = 'retreat'; state.modeTimer = random(0.6, 1.0);
        state.retreatDir.copy(toTarget).multiplyScalar(-1);
      }
      return;
    }

    // If holding petasan, prepare throw
    if (player.heldPetasan) {
      state.mode = 'prepare';
      // stop briefly / aim
      if (dist > 3.5) {
        setMoveToward(target.group.position, 0.5);
      } else {
        setMoveToward(target.group.position, 0.15);
      }
      // throw when fuse is getting low-ish or good distance, then retreat
      const fuse = player.heldPetasan.fuse ?? 2.2;
      const goodRange = dist >= 2.5 && dist <= 7.5;
      if (fuse < 1.1 || (goodRange && fuse < 1.8)) {
        tryThrow();
        state.mode = 'retreat';
        state.modeTimer = random(0.8, 1.4);
        state.retreatDir.copy(toTarget).multiplyScalar(-1);
      }
      return;
    }

    // Retreat mode
    if (state.mode === 'retreat' && state.modeTimer > 0) {
      const retreatPos = myPos.clone().add(state.retreatDir.clone().multiplyScalar(4));
      retreatPos.x = clampArenaX(retreatPos.x);
      retreatPos.z = clampArenaZ(retreatPos.z);
      setMoveToward(retreatPos, 0.9);
      return;
    }

    // Close range: punch or grab knockout
    if (dist < 1.9) {
      setMoveToward(target.group.position, 0.7);
      if (target.knockoutTimer > 0 && !target.carriedBy) {
        player.toggleCarryOrThrow(getPlayers(), getPetasanManager()?.petasans || []);
      } else {
        player.punch(getPlayers());
      }
      if (state.jumpCooldown <= 0 && Math.random() < 0.03) { player.setRemoteInput({ jump: true }); state.jumpCooldown = 2.0; }
      return;
    }

    // Mid range: chase and occasionally throw petasan
    if (dist < 8.5) {
      const strafe = Math.sin(performance.now() * 0.001 + player.group.id) > 0.6 ? state.strafeDir : 0;
      setMoveToward(target.group.position, dist > 4 ? 0.85 : 0.55, strafe);

      if (state.bombCooldown <= 0 && state.throwCooldown <= 0 && dist > 2.8 && dist < 7.5) {
        if (trySpawnAndHold()) {
          state.bombCooldown = random(2.5, 4.5);
          state.mode = 'prepare';
        }
      }
      return;
    }

    // Far: chase
    setMoveToward(target.group.position, 1.0);
  }

  return { player, update, state };
}