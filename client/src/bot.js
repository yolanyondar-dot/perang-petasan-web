/**
 * bot.js — AI bot untuk perang-petasan.
 * Menghasilkan input pemain (moveX, moveZ, jump, punch, grabThrow, bombHeld)
 * dan menerapkan aksi edge-trigger seperti pemain remote.
 */
import * as THREE from 'three';
import { ARENA } from './arena.js';

const EDGE_MARGIN = 1.8;
const BOMB_DANGER_RADIUS = 3.2;
const BOMB_DANGER_FUSE = 1.35;
const PICKUP_BOMB_RADIUS = 1.7;

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function rand(a, b) { return a + Math.random() * (b - a); }

function safeHalfX() { return (ARENA.halfWidth ?? ARENA.halfSize ?? 8) - EDGE_MARGIN; }
function safeHalfZ() { return (ARENA.halfDepth ?? ARENA.halfSize ?? 8) - EDGE_MARGIN; }
function inSafeArea(pos, margin = EDGE_MARGIN) {
  const hx = (ARENA.halfWidth ?? ARENA.halfSize ?? 8) - margin;
  const hz = (ARENA.halfDepth ?? ARENA.halfSize ?? 8) - margin;
  return Math.abs(pos.x) <= hx && Math.abs(pos.z) <= hz;
}
function isNearEdge(pos, margin = EDGE_MARGIN) { return !inSafeArea(pos, margin); }

function getPos(obj) {
  if (!obj) return new THREE.Vector3();
  if (obj.isPlayer || obj.group) {
    try { const t = obj.body?.translation?.(); if (t) return new THREE.Vector3(t.x, t.y, t.z); } catch (_) {}
    const p = obj.group?.position;
    if (p) return new THREE.Vector3(p.x, p.y, p.z);
  }
  if (obj.body?.translation) {
    try { const t = obj.body.translation(); return new THREE.Vector3(t.x, t.y, t.z); } catch (_) {}
  }
  if (obj.position) return new THREE.Vector3(obj.position.x, obj.position.y ?? 0, obj.position.z);
  if (obj.mesh?.position) return new THREE.Vector3(obj.mesh.position.x, obj.mesh.position.y ?? 0, obj.mesh.position.z);
  return new THREE.Vector3();
}

function distXZ(a, b) {
  const dx = (a.x ?? 0) - (b.x ?? 0);
  const dz = (a.z ?? 0) - (b.z ?? 0);
  return Math.sqrt(dx * dx + dz * dz);
}

function toWorldXZ(dir, camera) {
  // dir: world direction {x,z} normalized; convert to camera-relative moveX/moveZ used by player
  let moveX = 0, moveZ = 0;
  if (camera) {
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    fwd.normalize();
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
    moveZ = dir.x * fwd.x + dir.z * fwd.z;
    moveX = dir.x * right.x + dir.z * right.z;
  } else {
    moveX = dir.x;
    moveZ = -dir.z;
  }
  const len = Math.hypot(moveX, moveZ) || 1;
  return { moveX: clamp(moveX / len, -1, 1), moveZ: clamp(moveZ / len, -1, 1) };
}

function getAliveEnemies(player, players) {
  const out = [];
  for (const p of players || []) {
    if (!p || p === player) continue;
    if (p.eliminated || p.respawning) continue;
    if ((p.hp ?? 0) <= 0) continue;
    // in ctf, same team not enemy target
    if (player.team && p.team && player.team === p.team) continue;
    out.push(p);
  }
  return out;
}

function getNearest(player, list, posOf = getPos) {
  const my = getPos(player);
  let best = null, bestD = Infinity;
  for (const it of list || []) {
    const p = posOf(it);
    const d = distXZ(my, p);
    if (d < bestD) { bestD = d; best = it; }
  }
  return { item: best, dist: bestD };
}

export function createBotController(player, ctx = {}) {
  const getPlayers = ctx.getPlayers || (() => []);
  const getPetasanManager = ctx.getPetasanManager || (() => null);
  const getCamera = ctx.getCamera || (() => null);

  const state = {
    thinkTimer: 0,
    decisionInterval: 0.2,
    mode: 'chase',
    modeTimer: 0,
    target: null,
    moveTarget: new THREE.Vector3(0, 0, 0),
    strafeDir: Math.random() < 0.5 ? -1 : 1,
    strafeTimer: rand(0.4, 1.2),
    jumpCooldown: 0,
    throwCooldown: 0,
    bombCooldown: rand(1.2, 2.8),
    punchCooldown: 0,
    grabCooldown: 0,
    desiredBombHeld: false,
    patrolAngle: Math.random() * Math.PI * 2,
    retreatDir: new THREE.Vector3(0, 0, 1),
  };

  const prev = { punch: false, grabThrow: false, bombHeld: false };
  const input = { moveX: 0, moveZ: 0, jump: false, punch: false, grabThrow: false, bombHeld: false };

  function resetInput() {
    input.moveX = 0; input.moveZ = 0; input.jump = false; input.punch = false; input.grabThrow = false; input.bombHeld = false;
  }

  function setMoveToward(targetPos, speed = 1, strafe = 0) {
    const my = getPos(player);
    const dx = targetPos.x - my.x;
    const dz = targetPos.z - my.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.001) { input.moveX = 0; input.moveZ = 0; return 0; }
    let wx = dx / len, wz = dz / len;
    if (strafe) {
      const nx = dx / len + (-dz / len) * strafe * 0.55;
      const nz = dz / len + (dx / len) * strafe * 0.55;
      const nl = Math.hypot(nx, nz) || 1;
      wx = nx / nl; wz = nz / nl;
    }
    const m = toWorldXZ({ x: wx, z: wz }, getCamera());
    input.moveX = clamp(m.moveX * speed, -1, 1);
    input.moveZ = clamp(m.moveZ * speed, -1, 1);
    return len;
  }

  function steerAwayFrom(pos, strength = 1) {
    const my = getPos(player);
    let dx = my.x - pos.x;
    let dz = my.z - pos.z;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len; dz /= len;
    const m = toWorldXZ({ x: dx, z: dz }, getCamera());
    input.moveX = clamp(input.moveX + m.moveX * strength, -1, 1);
    input.moveZ = clamp(input.moveZ + m.moveZ * strength, -1, 1);
  }

  function steerTowardSafeCenter() {
    setMoveToward(new THREE.Vector3(0, 0, 0), 1, 0);
  }

  function activePetasans(petasans) {
    return (petasans || []).filter((p) => p && !p.exploded && !p.cleaned);
  }

  function dangerousBombsNear(myPos, petasans) {
    const out = [];
    for (const p of activePetasans(petasans)) {
      if (p.held || p.carried) continue; // being carried/held - less immediate ground threat
      const pp = getPos(p);
      const d = distXZ(myPos, pp);
      const fuse = Number(p.fuse ?? 99);
      const radius = Number(p.explosionRadius ?? 3.2);
      const dangerR = Math.max(BOMB_DANGER_RADIUS, radius + 0.8);
      if (d < dangerR && fuse < 2.4) out.push({ p, d, fuse, dangerR, pos: pp });
    }
    out.sort((a, b) => a.d - b.d);
    return out;
  }

  function nearestSafeBomb(myPos, petasans) {
    let best = null, bestD = Infinity;
    for (const p of activePetasans(petasans)) {
      if (p.held || p.carried) continue;
      const fuse = Number(p.fuse ?? 99);
      if (fuse < 1.4) continue; // too risky
      const pp = getPos(p);
      const d = distXZ(myPos, pp);
      if (d < bestD) { bestD = d; best = { p, d, fuse, pos: pp }; }
    }
    return best;
  }

  function trySpawnOrPickupBomb(petasans) {
    const mgr = getPetasanManager();
    if (!mgr) return false;
    if (player.heldPetasan || player.carriedEntity) return false;
    if (player.knockoutTimer > 0 || player.carriedBy || player.eliminated) return false;
    if (state.throwCooldown > 0 || state.bombCooldown > 0) return false;

    const my = getPos(player);
    const pickup = nearestSafeBomb(my, petasans);
    if (pickup && pickup.d < PICKUP_BOMB_RADIUS) {
      // pick up unexploded bomb by holding it
      const held = player.holdPetasan(pickup.p);
      if (held) { state.desiredBombHeld = true; state.bombCooldown = rand(1.8, 3.2); return true; }
    }

    const spawnPos = my.clone();
    spawnPos.y += 0.5;
    const type = (player.powerUp?.type === 'banting' || player.powerUp?.type === 'renteng') ? player.powerUp.type : 'normal';
    const petasan = mgr.spawn(spawnPos, { fuse: 2.2, type });
    const held = player.holdPetasan(petasan);
    if (!held) { mgr.discard(petasan); return false; }
    state.desiredBombHeld = true;
    state.bombCooldown = rand(2.2, 4.0);
    return true;
  }

  function throwHeldBomb() {
    if (!player.heldPetasan) { state.desiredBombHeld = false; return false; }
    const threw = player.throwPetasan();
    if (threw) {
      state.throwCooldown = 0.75;
      state.desiredBombHeld = false;
      state.mode = 'retreat';
      state.modeTimer = rand(0.6, 1.1);
    }
    return threw;
  }

  function doPunch() {
    if (state.punchCooldown > 0) return;
    player.punch(getPlayers(), getPetasanManager()?.petasans || []);
    state.punchCooldown = 0.45;
  }

  function doGrabThrow() {
    if (state.grabCooldown > 0) return;
    player.toggleCarryOrThrow(getPlayers(), getPetasanManager()?.petasans || []);
    state.grabCooldown = 0.35;
  }

  function applyEdgeAvoidance(myPos) {
    const hx = (ARENA.halfWidth ?? ARENA.halfSize ?? 8);
    const hz = (ARENA.halfDepth ?? ARENA.halfSize ?? 8);
    let steerX = 0, steerZ = 0;
    const margin = EDGE_MARGIN + 0.4;
    if (myPos.x > hx - margin) steerX -= (myPos.x - (hx - margin)) / margin;
    if (myPos.x < -hx + margin) steerX += ((-hx + margin) - myPos.x) / margin;
    if (myPos.z > hz - margin) steerZ -= (myPos.z - (hz - margin)) / margin;
    if (myPos.z < -hz + margin) steerZ += ((-hz + margin) - myPos.z) / margin;
    if (steerX !== 0 || steerZ !== 0) {
      const len = Math.hypot(steerX, steerZ) || 1;
      const m = toWorldXZ({ x: steerX / len, z: steerZ / len }, getCamera());
      input.moveX = clamp(input.moveX + m.moveX * 1.2, -1, 1);
      input.moveZ = clamp(input.moveZ + m.moveZ * 1.2, -1, 1);
      if (state.jumpCooldown <= 0 && Math.random() < 0.03) { input.jump = true; state.jumpCooldown = 1.0; }
      return true;
    }
    return false;
  }

  function avoidBombs(myPos, petasans, allowPickupIntent) {
    const dangers = dangerousBombsNear(myPos, petasans);
    if (!dangers.length) return false;
    // if we want to pick up a specific safe unexploded bomb, ignore that one
    for (const d of dangers) {
      if (allowPickupIntent && allowPickupIntent === d.p) continue;
      if (d.fuse > BOMB_DANGER_FUSE && d.d > d.dangerR * 0.7) continue;
      steerAwayFrom(d.pos, 1.4);
      if (d.d < 2.0 && state.jumpCooldown <= 0) { input.jump = true; state.jumpCooldown = 0.9; }
      // if holding bomb and danger is close, throw away from self (toward center/away)
      if (player.heldPetasan && d.d < 2.8) {
        // aim throw toward away direction by briefly moving; throwHeldBomb uses facingYaw at throw time
        throwHeldBomb();
      }
      return true;
    }
    return false;
  }

  function pickTarget(players, mode, hillZone, flags) {
    const enemies = getAliveEnemies(player, players);
    if (!enemies.length) return null;
    const my = getPos(player);

    if (mode === 'ctf' && flags) {
      const myTeam = player.team || 'A';
      const enemyTeam = myTeam === 'A' ? 'B' : 'A';
      const enemyCarrier = flags[enemyTeam]?.carrier;
      if (enemyCarrier && enemyCarrier !== player && !enemyCarrier.eliminated && (enemyCarrier.hp ?? 0) > 0) {
        // prioritize carrier, especially if they threaten our base or we are close
        return enemyCarrier;
      }
    }

    if (mode === 'koth' && hillZone?.center) {
      const c = hillZone.center; const r = hillZone.radius ?? 2.5;
      const inZone = enemies.filter((e) => distXZ(getPos(e), c) <= r);
      if (inZone.length) {
        const { item } = getNearest(player, inZone);
        if (item) return item;
      }
    }

    // nearest enemy, prefer low hp / knockout
    let best = null, bestScore = Infinity;
    for (const e of enemies) {
      const ep = getPos(e);
      const d = distXZ(my, ep);
      let score = d;
      if (e.knockoutTimer > 0) score -= 2.5;
      if ((e.hp ?? 100) < 35) score -= 1.2;
      if (score < bestScore) { bestScore = score; best = e; }
    }
    return best;
  }

  function decide(dt, game) {
    const { mode = 'ffa', hillZone = null, flags = null, players = [], petasans = [] } = game || {};
    const my = getPos(player);
    const enemies = getAliveEnemies(player, players);
    const target = pickTarget(players, mode, hillZone, flags);
    state.target = target;

    // Default objective
    let objective = { type: 'chase', pos: target ? getPos(target) : new THREE.Vector3(0, 0, 0), target };

    // CTF logic
    if (mode === 'ctf' && flags) {
      const myTeam = player.team || 'A';
      const enemyTeam = myTeam === 'A' ? 'B' : 'A';
      const myFlag = flags[myTeam];
      const enemyFlag = flags[enemyTeam];
      const myBase = myFlag?.basePos || new THREE.Vector3(myTeam === 'A' ? -7 : 7, 0.8, 0);
      const enemyBase = enemyFlag?.basePos || new THREE.Vector3(enemyTeam === 'A' ? -7 : 7, 0.8, 0);
      const carryingEnemy = player.carriedFlag === enemyTeam;

      if (carryingEnemy) {
        objective = { type: 'ctf_return_home', pos: myBase.clone(), target: null };
      } else if (myFlag && myFlag.dropped && !myFlag.carrier) {
        objective = { type: 'ctf_recover', pos: (myFlag.dropPos || myFlag.mesh?.group?.position || myBase).clone(), target: null };
      } else if (enemyFlag?.carrier && enemyFlag.carrier !== player) {
        objective = { type: 'ctf_chase_carrier', pos: getPos(enemyFlag.carrier), target: enemyFlag.carrier };
      } else if (enemyFlag && !enemyFlag.carrier) {
        const flagPos = enemyFlag.atBase ? enemyBase : (enemyFlag.dropPos || enemyFlag.mesh?.group?.position || enemyBase);
        objective = { type: 'ctf_get_flag', pos: flagPos.clone(), target: null };
      }
    }

    // KOTH logic
    if (mode === 'koth' && hillZone?.center) {
      const c = hillZone.center.clone();
      const r = hillZone.radius ?? 2.5;
      const myDistToHill = distXZ(my, c);
      const insideHill = myDistToHill <= r;
      const enemiesInHill = enemies.filter((e) => distXZ(getPos(e), c) <= r);

      if (!insideHill) {
        if (enemiesInHill.length) {
          objective = { type: 'koth_siege', pos: c, target: enemiesInHill[0], enemiesInHill };
        } else {
          objective = { type: 'koth_enter', pos: c, target: null };
        }
      } else {
        if (enemiesInHill.length) {
          objective = { type: 'koth_defend', pos: c, target: enemiesInHill[0], enemiesInHill };
        } else {
          // small patrol inside zone
          state.patrolAngle += rand(-0.8, 0.8);
          const pr = Math.max(0.4, r * 0.45);
          const patrol = new THREE.Vector3(c.x + Math.cos(state.patrolAngle) * pr, 0, c.z + Math.sin(state.patrolAngle) * pr);
          objective = { type: 'koth_patrol', pos: patrol, target: null };
        }
      }
    }

    state.objective = objective;
    state.moveTarget.copy(objective.pos);
  }

  function act(dt, game) {
    const { mode = 'ffa', hillZone = null, flags = null, players = [], petasans = [] } = game || {};
    const my = getPos(player);
    const objective = state.objective || { type: 'idle', pos: new THREE.Vector3(0, 0, 0) };
    const target = objective.target || state.target;
    const targetPos = target ? getPos(target) : objective.pos.clone();
    const distToTarget = target ? distXZ(my, targetPos) : distXZ(my, objective.pos);
    const distToObj = distXZ(my, objective.pos);

    // Edge safety first
    if (isNearEdge(my, EDGE_MARGIN)) {
      steerTowardSafeCenter();
      if (player.heldPetasan) throwHeldBomb();
      return;
    }

    // Retreating after throw
    if (state.mode === 'retreat' && state.modeTimer > 0) {
      const retreatPos = my.clone().add(state.retreatDir.clone().multiplyScalar(4));
      retreatPos.x = clamp(retreatPos.x, -safeHalfX(), safeHalfX());
      retreatPos.z = clamp(retreatPos.z, -safeHalfZ(), safeHalfZ());
      setMoveToward(retreatPos, 1.0);
      avoidBombs(my, petasans, null);
      applyEdgeAvoidance(my);
      return;
    }

    // If carrying a player or entity, throw toward target/objective
    if (player.carriedEntity) {
      setMoveToward(targetPos, 0.85);
      if (distToTarget < 6.5 && target) {
        // face by moving toward target; throw
        doGrabThrow();
        state.retreatDir.subVectors(my, targetPos).setY(0);
        if (state.retreatDir.lengthSq() > 1e-6) state.retreatDir.normalize();
        state.mode = 'retreat'; state.modeTimer = rand(0.5, 0.9);
      } else if (distToObj < 2.0 && !target) {
        doGrabThrow();
      }
      avoidBombs(my, petasans, null);
      applyEdgeAvoidance(my);
      return;
    }

    // If holding petasan, aim/throw
    if (player.heldPetasan) {
      const held = player.heldPetasan;
      const fuse = Number(held.fuse ?? 2.2);

      // KOTH siege: throw into zone
      if (mode === 'koth' && objective.type === 'koth_siege' && hillZone?.center) {
        setMoveToward(hillZone.center, distXZ(my, hillZone.center) > 3.5 ? 0.45 : 0.15);
        const dHill = distXZ(my, hillZone.center);
        if (fuse < 1.15 || (dHill <= (hillZone.radius ?? 2.5) + 4.5 && fuse < 1.8)) {
          throwHeldBomb();
        }
        avoidBombs(my, petasans, held);
        applyEdgeAvoidance(my);
        return;
      }

      // General throw at target/objective
      const aimPos = (target && distToTarget < 12) ? targetPos : objective.pos;
      const aimDist = distXZ(my, aimPos);
      if (aimDist > 3.5) setMoveToward(aimPos, 0.45);
      else setMoveToward(aimPos, 0.12);

      const goodRange = aimDist >= 2.2 && aimDist <= 7.5;
      if (fuse < 1.05 || (goodRange && fuse < 1.7) || (aimDist < 2.0 && fuse < 1.4)) {
        throwHeldBomb();
        const away = my.clone().sub(aimPos).setY(0);
        if (away.lengthSq() > 1e-6) away.normalize(); else away.set(0, 0, 1);
        state.retreatDir.copy(away);
      }
      avoidBombs(my, petasans, held);
      applyEdgeAvoidance(my);
      return;
    }

    // CTF: carrying enemy flag - go home, avoid bombs, don't overcommit fights
    if (mode === 'ctf' && objective.type === 'ctf_return_home') {
      setMoveToward(objective.pos, 1.0);
      const danger = dangerousBombsNear(my, petasans);
      if (danger.length) avoidBombs(my, petasans, null);
      if (state.jumpCooldown <= 0 && target && distToTarget < 2.0) { input.jump = true; state.jumpCooldown = 1.2; }
      applyEdgeAvoidance(my);
      return;
    }

    // CTF: recover own dropped flag - just touch it
    if (mode === 'ctf' && objective.type === 'ctf_recover') {
      setMoveToward(objective.pos, 1.0);
      avoidBombs(my, petasans, null);
      applyEdgeAvoidance(my);
      return;
    }

    // CTF: get enemy flag
    if (mode === 'ctf' && objective.type === 'ctf_get_flag') {
      if (target && distToTarget < 2.2) {
        setMoveToward(targetPos, 0.7);
        if (target.knockoutTimer > 0 && !target.carriedBy) doGrabThrow();
        else doPunch();
      } else {
        setMoveToward(objective.pos, 1.0);
        if (target && distToTarget < 6.5 && state.bombCooldown <= 0 && state.throwCooldown <= 0) {
          trySpawnOrPickupBomb(petasans);
        }
      }
      avoidBombs(my, petasans, null);
      applyEdgeAvoidance(my);
      return;
    }

    // CTF: chase enemy carrier
    if (mode === 'ctf' && objective.type === 'ctf_chase_carrier' && target) {
      if (distToTarget < 2.0) {
        setMoveToward(targetPos, 0.8);
        if (target.knockoutTimer > 0 && !target.carriedBy) doGrabThrow();
        else doPunch();
      } else if (distToTarget < 8.0) {
        setMoveToward(targetPos, 0.95);
        if (state.bombCooldown <= 0 && state.throwCooldown <= 0 && distToTarget > 2.8) {
          trySpawnOrPickupBomb(petasans);
        }
      } else {
        setMoveToward(targetPos, 1.0);
      }
      avoidBombs(my, petasans, null);
      applyEdgeAvoidance(my);
      return;
    }

    // KOTH: outside hill, enemy inside -> throw bomb into zone
    if (mode === 'koth' && objective.type === 'koth_siege' && hillZone?.center) {
      const dHill = distXZ(my, hillZone.center);
      if (dHill > 9) {
        setMoveToward(hillZone.center, 1.0);
      } else if (dHill > (hillZone.radius ?? 2.5) + 1.5) {
        setMoveToward(hillZone.center, 0.7);
        if (state.bombCooldown <= 0 && state.throwCooldown <= 0) {
          trySpawnOrPickupBomb(petasans);
        }
      } else {
        // near edge of hill, prepare throw
        setMoveToward(hillZone.center, 0.35);
        if (state.bombCooldown <= 0 && state.throwCooldown <= 0) trySpawnOrPickupBomb(petasans);
      }
      avoidBombs(my, petasans, null);
      applyEdgeAvoidance(my);
      return;
    }

    // KOTH: enter hill
    if (mode === 'koth' && objective.type === 'koth_enter' && hillZone?.center) {
      setMoveToward(hillZone.center, 1.0);
      avoidBombs(my, petasans, null);
      applyEdgeAvoidance(my);
      return;
    }

    // KOTH: defend/patrol inside
    if (mode === 'koth' && (objective.type === 'koth_defend' || objective.type === 'koth_patrol')) {
      if (objective.type === 'koth_defend' && target) {
        if (distToTarget < 2.0) {
          setMoveToward(targetPos, 0.75);
          if (target.knockoutTimer > 0 && !target.carriedBy) doGrabThrow();
          else doPunch();
        } else {
          setMoveToward(targetPos, 0.65);
          if (distToTarget < 6 && state.bombCooldown <= 0 && state.throwCooldown <= 0 && Math.random() < 0.02) {
            trySpawnOrPickupBomb(petasans);
          }
        }
      } else {
        setMoveToward(objective.pos, 0.35);
      }
      avoidBombs(my, petasans, null);
      applyEdgeAvoidance(my);
      return;
    }

    // Default FFA/chase
    if (target) {
      if (distToTarget < 1.9) {
        setMoveToward(targetPos, 0.75);
        if (target.knockoutTimer > 0 && !target.carriedBy) doGrabThrow();
        else doPunch();
        if (state.jumpCooldown <= 0 && Math.random() < 0.03) { input.jump = true; state.jumpCooldown = 1.8; }
      } else if (distToTarget < 8.5) {
        const strafe = Math.sin(performance.now() * 0.001 + (player.group?.id || 0)) > 0.6 ? state.strafeDir : 0;
        setMoveToward(targetPos, distToTarget > 4 ? 0.9 : 0.55, strafe);
        if (state.bombCooldown <= 0 && state.throwCooldown <= 0 && distToTarget > 2.8 && distToTarget < 7.5) {
          trySpawnOrPickupBomb(petasans);
        }
      } else {
        setMoveToward(targetPos, 1.0);
      }
    } else {
      setMoveToward(new THREE.Vector3(0, 0, 0), 0.35);
    }

    avoidBombs(my, petasans, player.heldPetasan || null);
    applyEdgeAvoidance(my);
  }

  function applyActions(game) {
    // edge-trigger actions like remote player handling
    const now = { punch: !!input.punch, grabThrow: !!input.grabThrow, bombHeld: !!input.bombHeld };
    const petasans = game?.petasans || [];

    if (now.punch && !prev.punch) doPunch();
    if (now.grabThrow && !prev.grabThrow) doGrabThrow();

    if (now.bombHeld && !prev.bombHeld) {
      // spawn or pickup
      if (!player.heldPetasan && !player.carriedEntity) trySpawnOrPickupBomb(petasans);
    }
    if (!now.bombHeld && prev.bombHeld) {
      if (player.heldPetasan) throwHeldBomb();
    }

    prev.punch = now.punch;
    prev.grabThrow = now.grabThrow;
    prev.bombHeld = now.bombHeld;
  }

  function update(dt, gameData = null) {
    state.thinkTimer -= dt;
    state.modeTimer -= dt;
    state.jumpCooldown = Math.max(0, state.jumpCooldown - dt);
    state.throwCooldown = Math.max(0, state.throwCooldown - dt);
    state.bombCooldown = Math.max(0, state.bombCooldown - dt);
    state.punchCooldown = Math.max(0, state.punchCooldown - dt);
    state.grabCooldown = Math.max(0, state.grabCooldown - dt);
    state.strafeTimer -= dt;
    if (state.strafeTimer <= 0) { state.strafeDir *= -1; state.strafeTimer = rand(0.4, 1.4); }

    resetInput();

    if (!player || player.eliminated || player.respawning || (player.hp ?? 0) <= 0 || player.knockoutTimer > 0 || player.carriedBy) {
      player?.setRemoteInput?.({ moveX: 0, moveZ: 0, jump: false, punch: false, grabThrow: false, bombHeld: false });
      prev.punch = prev.grabThrow = prev.bombHeld = false;
      state.desiredBombHeld = false;
      return input;
    }

    const game = gameData || {
      mode: ctx.getMode?.() || 'ffa',
      hillZone: ctx.getHillZone?.() || null,
      flags: ctx.getFlags?.() || null,
      players: getPlayers(),
      petasans: getPetasanManager()?.petasans || [],
    };

    if (state.thinkTimer <= 0) {
      state.thinkTimer = state.decisionInterval; // ~0.2s
      decide(dt, game);
    }

    // desired bomb hold state: keep holding while we have petasan and haven't decided to throw
    // act() may throw; it sets desiredBombHeld accordingly
    if (player.heldPetasan) state.desiredBombHeld = true;

    act(dt, game);

    // Sync bombHeld input with intent (act can spawn/hold/throw directly; keep input consistent)
    input.bombHeld = !!player.heldPetasan || !!state.desiredBombHeld;
    if (!player.heldPetasan && !state.desiredBombHeld) input.bombHeld = false;

    // Apply movement/jump via remoteInput; actions are executed directly for responsiveness
    player.setRemoteInput({
      moveX: input.moveX,
      moveZ: input.moveZ,
      jump: input.jump,
      punch: input.punch,
      grabThrow: input.grabThrow,
      bombHeld: input.bombHeld,
    });

    // Note: punch/grab/bomb edges are also handled by direct calls in act/doPunch/doGrabThrow/throw.
    // Keep prev in sync to avoid double-trigger if main later uses input.
    prev.punch = !!input.punch;
    prev.grabThrow = !!input.grabThrow;
    prev.bombHeld = !!input.bombHeld;

    return input;
  }

  return { player, update, state, get input() { return input; } };
}