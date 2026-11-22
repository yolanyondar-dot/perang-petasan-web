/**
 * player.js — karakter kartun low-poly + kontrol + HP + tinju + knockout + angkat/lempar.
 */
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { createRigidBody, createCollider, castRayDown, getWorld } from './physics.js';
import { ARENA, isRingOut } from './arena.js';
import { PHYSICS_TUNING } from './tuning.js';
import { buildCharacterMockup } from './assetsMockup.js';

const MOVE_SPEED = 7;
const JUMP_VELOCITY = 8.5;
const GROUND_EPSILON = 0.12;
const PUNCH_COOLDOWN = 0.45;
const PUNCH_RANGE = 1.8;
const PUNCH_DAMAGE = 12;
const PUNCH_STAGGER = 35;
const CARRY_RADIUS = 2.2;
const CARRY_HEIGHT = 1.45;
const THROW_CHARGE_TIME = 0.9;

export function createPlayer(scene, options = {}) {
  const world = getWorld();
  const spawn = (options.spawn ? options.spawn.clone() : ARENA.spawn.clone());
  let playerName = String(options.name || 'Player').slice(0, 14) || 'Player';
  const colorRaw = options.color ?? 0xff5fa2;
  const color = typeof colorRaw === 'string' ? new THREE.Color(colorRaw).getHex() : (Number(colorRaw) || 0xff5fa2);
  const characterType = ['klasik', 'topi', 'visor', 'tanduk'].includes(options.characterType) ? options.characterType : 'klasik';
  const isBot = !!options.isBot;
  const isRemote = !!options.isRemote;
  const inputEnabled = options.inputEnabled ?? (!isBot && !isRemote);
  const petasanManagerRef = { current: options.petasanManager || null };
  const onRingOutCb = typeof options.onRingOut === 'function' ? options.onRingOut : null;
  const onPunchCb = typeof options.onPunch === 'function' ? options.onPunch : null;
  const onThrowCb = typeof options.onThrow === 'function' ? options.onThrow : null;
  const onFuseCb = typeof options.onFuse === 'function' ? options.onFuse : null;

  let maxHp = 100;
  let hp = 100;
  let hitFlash = 0;
  let stagger = 0;
  let knockoutTimer = 0;
  let punchCooldown = 0;
  let punchAnim = 0;
  let isRagdoll = false;
  let powerUp = null; // { type, remaining, duration }
  let lives = 3;
  let score = 0;
  let eliminated = false;
  let respawning = false;
  let spawnProtection = 0;

  // --- Dimensi kapsul fisika -----------------------------------------------
  const capsule = { halfHeight: 0.45, radius: 0.35 };
  const totalHalf = capsule.halfHeight + capsule.radius;

  // --- Visual group --------------------------------------------------------
  const group = new THREE.Group();
  group.name = playerName;

  // Visual mockup (collider fisika tetap kapsul di bawah)
  const colorHex = '#' + new THREE.Color(color).getHexString();
  const mockup = buildCharacterMockup({ color: colorHex, characterType });
  group.add(mockup.group);

  // Referensi untuk animasi/hit-flash/glow yang sudah ada
  const bodyMesh = mockup.group.children.find((c) => c.isMesh && c.geometry?.type === 'CapsuleGeometry') || mockup.group.children[0];
  const bodyMat = bodyMesh?.material;
  const head = mockup.head;
  const handL = mockup.leftHand;
  const handR = mockup.rightHand;
  const handMat = handL?.material;
  const baseHandColor = handMat?.color?.clone?.() || new THREE.Color(0xf3c69f);

  // --- Health bar ----------------------------------------------------------
  const hpGroup = new THREE.Group();
  hpGroup.position.set(0, totalHalf + 0.95, 0);
  const hpBg = new THREE.Mesh(
    new THREE.PlaneGeometry(1.1, 0.14),
    new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.85, depthWrite: false }),
  );
  hpGroup.add(hpBg);
  const hpFillMat = new THREE.MeshBasicMaterial({ color: 0x4caf50, transparent: true, opacity: 0.95, depthWrite: false });
  const hpFill = new THREE.Mesh(new THREE.PlaneGeometry(1.02, 0.09), hpFillMat);
  hpFill.position.z = 0.001;
  hpGroup.add(hpFill);
  group.add(hpGroup);

  // --- Indikator pusing/knockout -------------------------------------------
  const starsGroup = new THREE.Group();
  starsGroup.position.set(0, totalHalf + 1.25, 0);
  starsGroup.visible = false;
  const starMat = new THREE.MeshBasicMaterial({ color: 0xffeb3b, depthWrite: false });
  for (let i = 0; i < 3; i += 1) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), starMat);
    const a = (i / 3) * Math.PI * 2;
    s.position.set(Math.cos(a) * 0.28, 0, Math.sin(a) * 0.28);
    starsGroup.add(s);
  }
  group.add(starsGroup);

  // --- Indikator power-up --------------------------------------------------
  const powerGroup = new THREE.Group();
  powerGroup.position.set(0, totalHalf + 1.55, 0);
  powerGroup.visible = false;
  const powerBg = new THREE.Mesh(
    new THREE.PlaneGeometry(1.4, 0.28),
    new THREE.MeshBasicMaterial({ color: 0x111827, transparent: true, opacity: 0.75, depthWrite: false })
  );
  const powerCanvas = document.createElement('canvas');
  powerCanvas.width = 256;
  powerCanvas.height = 64;
  const powerCtx = powerCanvas.getContext('2d');
  const powerTex = new THREE.CanvasTexture(powerCanvas);
  powerTex.colorSpace = THREE.SRGBColorSpace;
  const powerLabel = new THREE.Mesh(
    new THREE.PlaneGeometry(1.34, 0.22),
    new THREE.MeshBasicMaterial({ map: powerTex, transparent: true, depthWrite: false })
  );
  powerLabel.position.z = 0.001;
  powerGroup.add(powerBg, powerLabel);
  group.add(powerGroup);

  // Name tag
  const nameCanvas = document.createElement('canvas');
  nameCanvas.width = 256;
  nameCanvas.height = 64;
  const nameCtx = nameCanvas.getContext('2d');
  const nameTex = new THREE.CanvasTexture(nameCanvas);
  nameTex.colorSpace = THREE.SRGBColorSpace;
  const nameMat = new THREE.SpriteMaterial({ map: nameTex, transparent: true, depthWrite: false, depthTest: false });
  const nameSprite = new THREE.Sprite(nameMat);
  nameSprite.position.set(0, totalHalf + 1.85, 0);
  nameSprite.scale.set(1.8, 0.45, 1);
  group.add(nameSprite);
  function updateNameTag(text) {
    if (!nameCtx) return;
    const t = String(text || 'Pemain').slice(0, 14);
    nameCtx.clearRect(0, 0, nameCanvas.width, nameCanvas.height);
    nameCtx.fillStyle = 'rgba(0,0,0,0.45)';
    const pad = 14;
    nameCtx.font = 'bold 34px system-ui, sans-serif';
    const w = Math.min(240, nameCtx.measureText(t).width + pad * 2);
    const x = (256 - w) / 2;
    nameCtx.beginPath();
    const r = 12, y = 10, h = 44;
    nameCtx.moveTo(x + r, y); nameCtx.arcTo(x + w, y, x + w, y + h, r); nameCtx.arcTo(x + w, y + h, x, y + h, r); nameCtx.arcTo(x, y + h, x, y, r); nameCtx.arcTo(x, y, x + w, y, r); nameCtx.closePath();
    nameCtx.fill();
    nameCtx.fillStyle = '#ffffff';
    nameCtx.textAlign = 'center';
    nameCtx.textBaseline = 'middle';
    nameCtx.fillText(t, 128, 32);
    nameTex.needsUpdate = true;
  }
  updateNameTag(playerName);

  scene.add(group);

  // --- Rigid body + collider -----------------------------------------------
  const body = createRigidBody({
    x: spawn.x,
    y: spawn.y,
    z: spawn.z,
    type: 'dynamic',
    linearDamping: PHYSICS_TUNING.normalLinearDamping,
    angularDamping: 0.5,
  });
  body.setEnabledRotations(false, true, false, true);
  const collider = createCollider(body, {
    shape: 'capsule',
    halfHeight: capsule.halfHeight,
    radius: capsule.radius,
    friction: 0.8,
    restitution: 0,
  });

  // --- State ---------------------------------------------------------------
  const keys = new Set();
  let jumpRequested = false;
  let heldPetasan = null; // E/click fuse hold
  let carriedEntity = null; // Q/Shift carry (petasan or knocked-out player)
  let carriedBy = null; // player carrying this one
  let facingYaw = 0;
  let throwHoldTime = 0;
  const normalDamping = { linear: PHYSICS_TUNING.normalLinearDamping, angular: 0.5 };
  // Input analog/digital dari network controller (HP)
  const remoteInput = { moveX: 0, moveZ: 0, jump: false, punch: false, grabThrow: false, bombHeld: false };

  const onKeyDown = (e) => {
    if (!inputEnabled) return;
    keys.add(e.code);
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  };
  const onKeyUp = (e) => {
    if (!inputEnabled) return;
    keys.delete(e.code);
  };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  function isGrounded() {
    const t = body.translation();
    const hit = castRayDown(world, t.x, t.y, t.z, totalHalf + GROUND_EPSILON, collider);
    return hit !== null && hit !== undefined;
  }

  function updateHealthBar(camera) {
    const ratio = THREE.MathUtils.clamp(hp / maxHp, 0, 1);
    hpFill.scale.x = Math.max(0.001, ratio);
    hpFill.position.x = -0.51 * (1 - ratio);
    if (ratio > 0.5) hpFillMat.color.setHex(0x4caf50);
    else if (ratio > 0.25) hpFillMat.color.setHex(0xffc107);
    else hpFillMat.color.setHex(0xf44336);
    hpGroup.quaternion.copy(camera.quaternion);
    starsGroup.quaternion.copy(camera.quaternion);
    powerGroup.quaternion.copy(camera.quaternion);
  }

  function takeDamage(amount) {
    const dmg = Math.max(0, Number(amount) || 0);
    if (dmg <= 0 || hp <= 0) return hp;
    if (spawnProtection > 0 || eliminated || respawning) return hp;
    hp = Math.max(0, hp - dmg);
    hitFlash = 0.22;
    return hp;
  }

  function addStagger(amount) {
    stagger = THREE.MathUtils.clamp(stagger + Math.max(0, amount || 0), 0, 100);
    if (stagger >= 100) knockout(PHYSICS_TUNING.knockoutDuration);
  }

  function resetHp() {
    hp = maxHp;
    hitFlash = 0;
  }

  function powerUpLabel(type) {
    if (type === 'banting') return 'BANTING';
    if (type === 'renteng') return 'RENTENG';
    if (type === 'sarung_tinju') return 'SARUNG TINJU';
    return String(type || '').toUpperCase();
  }

  function updatePowerUpVisual() {
    if (!powerUp) {
      powerGroup.visible = false;
      handMat.color.copy(baseHandColor);
      handMat.emissive.setHex(0x000000);
      handMat.emissiveIntensity = 0;
      return;
    }
    powerGroup.visible = true;
    if (powerCtx) {
      powerCtx.clearRect(0, 0, powerCanvas.width, powerCanvas.height);
      powerCtx.fillStyle = powerUp.type === 'sarung_tinju' ? '#ff5252' : powerUp.type === 'renteng' ? '#66bb6a' : '#ffb74d';
      powerCtx.font = 'bold 28px system-ui, sans-serif';
      powerCtx.textAlign = 'center';
      powerCtx.textBaseline = 'middle';
      powerCtx.fillText(`${powerUpLabel(powerUp.type)} ${Math.ceil(powerUp.remaining)}s`, powerCanvas.width / 2, powerCanvas.height / 2);
      powerTex.needsUpdate = true;
    }
    if (powerUp.type === 'sarung_tinju') {
      handMat.color.setHex(0xff3333);
      handMat.emissive.setHex(0xffcc00);
      handMat.emissiveIntensity = 0.9;
    } else {
      handMat.color.copy(baseHandColor);
      handMat.emissive.setHex(0x000000);
      handMat.emissiveIntensity = 0;
    }
  }

  function applyPowerUp(type, duration = 12) {
    powerUp = { type, remaining: duration, duration };
    updatePowerUpVisual();
  }

  function clearPowerUp() {
    powerUp = null;
    updatePowerUpVisual();
  }

  function setCarriedState(isCarried, carrier = null) {
    carriedBy = isCarried ? carrier : null;
    try {
      if (isCarried) {
        body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
        body.setGravityScale?.(0, true);
        body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      } else {
        body.setGravityScale?.(1, true);
        body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
        body.wakeUp?.();
      }
    } catch (_) {}
  }

  function releaseHeldPetasan(discard = false) {
    const p = heldPetasan;
    if (!p) return;
    heldPetasan = null;
    const mgr = petasanManagerRef.current;
    if (mgr) {
      if (discard) mgr.discard(p);
      else mgr.setHeld(p, false, null);
    } else {
      p.held = false;
      p.holder = null;
    }
  }

  function releaseCarriedEntitySafe(throwIt = false) {
    const e = carriedEntity;
    if (!e) return;
    carriedEntity = null;
    const mgr = petasanManagerRef.current;

    // entity bisa petasan atau player
    if (e.isPlayer) {
      e.carriedBy = null;
      try {
        e.body.setGravityScale?.(1, true);
        e.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
        e.body.wakeUp?.();
      } catch (_) {}
      if (throwIt) {
        const dir = new THREE.Vector3(Math.sin(facingYaw), 0, Math.cos(facingYaw));
        const origin = getCarryOrigin();
        try {
          e.body.setTranslation({ x: origin.x, y: origin.y + 0.2, z: origin.z }, true);
          e.body.setLinvel({
            x: dir.x * PHYSICS_TUNING.throwSpeedMax,
            y: PHYSICS_TUNING.throwUpward,
            z: dir.z * PHYSICS_TUNING.throwSpeedMax,
          }, true);
        } catch (_) {}
        // Pastikan tetap ragdoll sebentar agar lemparan tidak langsung "recover" dan nolkan vel.
        if (e.isRagdoll && e.knockoutTimer <= 0) e.knockout?.(0.8);
      }
      return;
    }

    // petasan
    if (mgr) {
      if (throwIt) {
        const dir = new THREE.Vector3(Math.sin(facingYaw), 0, Math.cos(facingYaw));
        const origin = getCarryOrigin();
        mgr.throwPetasan(e, origin, dir, PHYSICS_TUNING.throwSpeedMax, PHYSICS_TUNING.throwUpward);
      } else {
        mgr.setCarried(e, false, null);
      }
    } else {
      e.carried = false;
      e.carrier = null;
    }
  }

  function knockout(duration = PHYSICS_TUNING.knockoutDuration) {
    // Lepaskan apapun yang sedang dipegang/diangkat
    if (heldPetasan) releaseHeldPetasan(true);
    if (carriedEntity) releaseCarriedEntitySafe(false);
    if (carriedBy && carriedBy.carriedEntity === api) carriedBy.carriedEntity = null;
    carriedBy = null;
    knockoutTimer = Math.max(knockoutTimer, duration);
    stagger = 100;
    isRagdoll = true;
    starsGroup.visible = true;
    try {
      body.setGravityScale?.(1, true);
      body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
      body.setEnabledRotations(true, true, true, true);
      body.setLinearDamping(PHYSICS_TUNING.knockoutLinearDamping);
      body.setAngularDamping(PHYSICS_TUNING.knockoutAngularDamping);
      body.wakeUp?.();
    } catch (_) {}
  }

  function applyTuningToBody() {
    normalDamping.linear = PHYSICS_TUNING.normalLinearDamping;
    normalDamping.angular = 0.5;
    try {
      if (isRagdoll || knockoutTimer > 0) {
        body.setLinearDamping(PHYSICS_TUNING.knockoutLinearDamping);
        body.setAngularDamping(PHYSICS_TUNING.knockoutAngularDamping);
      } else {
        body.setLinearDamping(normalDamping.linear);
        body.setAngularDamping(normalDamping.angular);
      }
    } catch (_) {}
  }

  function recoverFromKnockout() {
    knockoutTimer = 0;
    stagger = 0;
    isRagdoll = false;
    starsGroup.visible = false;
    if (carriedBy) return; // pulihkan saat dilepas
    try {
      const t = body.translation();
      const yaw = facingYaw;
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      body.setTranslation({ x: t.x, y: Math.max(t.y, totalHalf + 0.05), z: t.z }, true);
      body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
      body.setLinvel({ x: 0, y: PHYSICS_TUNING.standUpHopVelocity, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      body.setEnabledRotations(false, true, false, true);
      body.setLinearDamping(PHYSICS_TUNING.normalLinearDamping);
      body.setAngularDamping(0.5);
      body.wakeUp?.();
    } catch (_) {}
  }

  function reset() {
    if (heldPetasan) releaseHeldPetasan(true);
    if (carriedEntity) releaseCarriedEntitySafe(false);
    carriedBy = null;
    knockoutTimer = 0;
    stagger = 0;
    isRagdoll = false;
    starsGroup.visible = false;
    punchCooldown = 0;
    punchAnim = 0;
    throwHoldTime = 0;
    respawning = false;
    try {
      body.setGravityScale?.(1, true);
      body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
      body.setEnabledRotations(false, true, false, true);
      body.setLinearDamping(PHYSICS_TUNING.normalLinearDamping);
      body.setAngularDamping(0.5);
      body.setTranslation({ x: spawn.x, y: spawn.y, z: spawn.z }, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    } catch (_) {}
    facingYaw = 0;
    api.carriedFlag = null;
    clearPowerUp();
    resetHp();
  }

  function respawnAt(pos, protection = 1.5) {
    if (heldPetasan) releaseHeldPetasan(true);
    if (carriedEntity) releaseCarriedEntitySafe(false);
    if (carriedBy && carriedBy.carriedEntity === api) carriedBy.carriedEntity = null;
    carriedBy = null;
    knockoutTimer = 0;
    stagger = 0;
    isRagdoll = false;
    starsGroup.visible = false;
    punchCooldown = 0;
    punchAnim = 0;
    throwHoldTime = 0;
    respawning = false;
    eliminated = false;
    group.visible = true;
    const p = pos || spawn;
    try {
      body.setGravityScale?.(1, true);
      body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
      body.setEnabledRotations(false, true, false, true);
      body.setLinearDamping(PHYSICS_TUNING.normalLinearDamping);
      body.setAngularDamping(0.5);
      body.setTranslation({ x: p.x, y: p.y, z: p.z }, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      body.wakeUp?.();
    } catch (_) {}
    facingYaw = 0;
    api.carriedFlag = null;
    clearPowerUp();
    resetHp();
    spawnProtection = Math.max(0, protection);
  }

  function eliminate() {
    if (heldPetasan) releaseHeldPetasan(true);
    if (carriedEntity) releaseCarriedEntitySafe(false);
    if (carriedBy && carriedBy.carriedEntity === api) carriedBy.carriedEntity = null;
    carriedBy = null;
    eliminated = true;
    respawning = false;
    knockoutTimer = 0;
    stagger = 0;
    isRagdoll = false;
    starsGroup.visible = false;
    group.visible = false;
    api.carriedFlag = null;
    clearPowerUp();
    hp = 0;
    try {
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      body.setTranslation({ x: 0, y: -50, z: 0 }, true);
    } catch (_) {}
  }

  function resetForRound(pos, keepScore = true) {
    lives = 3;
    if (!keepScore) score = 0;
    eliminated = false;
    respawning = false;
    spawnProtection = 0;
    respawnAt(pos || spawn, 0);
  }

  function holdPetasan(petasan) {
    if (!petasan || petasan.cleaned || petasan.exploded) return false;
    if (heldPetasan || carriedEntity) return false;
    if (knockoutTimer > 0 || carriedBy) return false;
    heldPetasan = petasan;
    throwHoldTime = 0;
    const mgr = petasanManagerRef.current;
    if (mgr?.setHeld) mgr.setHeld(petasan, true, api);
    else { petasan.held = true; petasan.holder = api; }
    try { onFuseCb?.(api, petasan); } catch (_) {}
    return true;
  }

  function getForward() {
    return new THREE.Vector3(Math.sin(facingYaw), 0, Math.cos(facingYaw));
  }

  function getThrowOrigin() {
    const t = body.translation();
    const f = getForward();
    return new THREE.Vector3(t.x + f.x * 0.9, t.y + 0.35, t.z + f.z * 0.9);
  }

  function getCarryOrigin() {
    const t = body.translation();
    return new THREE.Vector3(t.x, t.y + CARRY_HEIGHT, t.z);
  }

  function getThrowCharge() {
    return THREE.MathUtils.clamp(throwHoldTime / THROW_CHARGE_TIME, 0, 1);
  }

  function throwPetasan(throwSpeed = null, upwardBoost = null) {
    const p = heldPetasan;
    if (!p || p.cleaned || p.exploded) { heldPetasan = null; throwHoldTime = 0; return false; }
    const charge = getThrowCharge();
    const speed = throwSpeed ?? THREE.MathUtils.lerp(PHYSICS_TUNING.throwSpeedMin, PHYSICS_TUNING.throwSpeedMax, charge);
    const up = upwardBoost ?? PHYSICS_TUNING.throwUpward;
    const dir = getForward();
    const origin = getThrowOrigin();
    heldPetasan = null;
    throwHoldTime = 0;
    const mgr = petasanManagerRef.current;
    let ok = false;
    if (mgr?.throwPetasan) ok = mgr.throwPetasan(p, origin, dir, speed, up);
    else {
      try {
        p.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
        p.body.setTranslation({ x: origin.x, y: origin.y, z: origin.z }, true);
        p.body.setLinvel({ x: dir.x * speed, y: up, z: dir.z * speed }, true);
        p.body.setAngvel({ x: (Math.random() - 0.5) * 6, y: (Math.random() - 0.5) * 6, z: (Math.random() - 0.5) * 6 }, true);
        p.held = false; p.holder = null;
        ok = true;
      } catch (_) { ok = false; }
    }
    if (ok) { try { onThrowCb?.(api, p); } catch (_) {} }
    return ok;
  }

  function punch(players = [], petasans = []) {
    if (knockoutTimer > 0 || carriedBy) return false;
    if (punchCooldown > 0) return false;
    if (heldPetasan || carriedEntity) return false; // tangan sedang dipakai
    punchCooldown = PUNCH_COOLDOWN;
    punchAnim = 0.22;
    try { onPunchCb?.(api); } catch (_) {}

    const buff = powerUp?.type === 'sarung_tinju' ? 2 : 1;
    const myPos = body.translation();
    const forward = getForward();
    const my = new THREE.Vector3(myPos.x, myPos.y, myPos.z);

    for (const target of players) {
      if (!target || target === api || target.hp <= 0) continue;
      let tp;
      try { tp = target.body.translation(); } catch (_) { continue; }
      const tpos = new THREE.Vector3(tp.x, tp.y, tp.z);
      const delta = tpos.sub(my);
      const dist = delta.length();
      if (dist > PUNCH_RANGE) continue;
      const dir = dist > 1e-6 ? delta.clone().normalize() : forward.clone();
      if (dir.dot(forward) < 0.2) continue;

      try {
        target.body.applyImpulse({
          x: dir.x * PHYSICS_TUNING.punchKnockback * buff,
          y: PHYSICS_TUNING.punchUpward * buff,
          z: dir.z * PHYSICS_TUNING.punchKnockback * buff,
        }, true);
      } catch (_) {}
      target.takeDamage?.(PUNCH_DAMAGE * buff);
      target.addStagger?.(PUNCH_STAGGER * buff);
      const punchImpulse = Math.hypot(PHYSICS_TUNING.punchKnockback * buff, PHYSICS_TUNING.punchUpward * buff);
      if (punchImpulse >= PHYSICS_TUNING.knockoutImpulseThreshold) target.knockout?.(PHYSICS_TUNING.knockoutDuration);
      if (target.hp <= 0) target.reset?.();
    }

    // BombSquad-like: punch/kick bombs
    for (const p of petasans) {
      if (!p || p.cleaned || p.exploded || p.held) continue;
      let pt;
      try { pt = p.body.translation(); } catch (_) { continue; }
      const tpos = new THREE.Vector3(pt.x, pt.y, pt.z);
      const delta = tpos.sub(my);
      const dist = delta.length();
      if (dist > PUNCH_RANGE + 0.3) continue;
      const dir = dist > 1e-6 ? delta.clone().normalize() : forward.clone();
      if (dir.dot(forward) < 0.1) continue;
      try {
        p.body.setLinvel({ x: dir.x * 10 * buff, y: 4.5 * buff, z: dir.z * 10 * buff }, true);
        p.hasBeenThrown = true;
        p.throwGrace = p.type === 'banting' ? 0.15 : 0;
      } catch (_) {}
    }
    return true;
  }

  function tryCarry(players = [], petasans = []) {
    if (knockoutTimer > 0 || carriedBy) return false;
    if (heldPetasan || carriedEntity) return false;

    const myT = body.translation();
    const myPos = new THREE.Vector3(myT.x, myT.y, myT.z);
    let best = null;
    let bestDist = CARRY_RADIUS + 0.001;
    let bestType = null;

    // Kandidat petasan aktif belum meledak (lantai atau dipegang pemain lain)
    for (const p of petasans) {
      if (!p || p.cleaned || p.exploded) continue;
      let pt;
      try { pt = p.body.translation(); } catch (_) { continue; }
      const d = myPos.distanceTo(new THREE.Vector3(pt.x, pt.y, pt.z));
      if (d < bestDist) {
        bestDist = d;
        best = p;
        bestType = 'petasan';
      }
    }

    // Kandidat karakter knockout
    for (const other of players) {
      if (!other || other === api) continue;
      if (other.carriedBy) continue;
      if (!(other.knockoutTimer > 0)) continue;
      let ot;
      try { ot = other.body.translation(); } catch (_) { continue; }
      const d = myPos.distanceTo(new THREE.Vector3(ot.x, ot.y, ot.z));
      if (d < bestDist) {
        bestDist = d;
        best = other;
        bestType = 'player';
      }
    }

    if (!best) return false;
    const mgr = petasanManagerRef.current;

    if (bestType === 'petasan') {
      // Ambil alih dari pemain lain jika perlu
      if (best.holder && best.holder !== api && best.holder.heldPetasan === best) best.holder.heldPetasan = null;
      if (best.carrier && best.carrier !== api && best.carrier.carriedEntity === best) best.carrier.carriedEntity = null;
      carriedEntity = best;
      if (mgr?.setCarried) mgr.setCarried(best, true, api);
      else { best.carried = true; best.carrier = api; }
      return true;
    }

    // player
    if (best.heldPetasan) best.releaseHeldPetasan?.(true);
    if (best.carriedEntity) best.releaseCarriedEntitySafe?.(false);
    carriedEntity = best;
    best.carriedBy = api;
    try {
      best.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
      best.body.setGravityScale?.(0, true);
      best.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      best.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    } catch (_) {}
    return true;
  }

  function throwCarried() {
    if (!carriedEntity) return false;
    releaseCarriedEntitySafe(true);
    return true;
  }

  function toggleCarryOrThrow(players = [], petasans = []) {
    if (knockoutTimer > 0 || carriedBy) return false;
    if (carriedEntity) return throwCarried();
    if (heldPetasan) return false; // sudah memegang sesuatu
    return tryCarry(players, petasans);
  }

  function readMovement(camera) {
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
    forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

    let x = 0;
    let z = 0;
    if (inputEnabled) {
      if (keys.has('KeyW') || keys.has('ArrowUp')) z += 1;
      if (keys.has('KeyS') || keys.has('ArrowDown')) z -= 1;
      if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;
      if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1;
    }
    // Analog remote input (joystick HP) - gunakan jika ada magnitudo.
    const rx = Number(remoteInput.moveX) || 0;
    const rz = Number(remoteInput.moveZ) || 0;
    if (Math.abs(rx) > 0.001 || Math.abs(rz) > 0.001) {
      x += rx;
      z += rz;
    }

    const move = new THREE.Vector3();
    if (x !== 0 || z !== 0) {
      move.addScaledVector(forward, z).addScaledVector(right, x);
      const len = move.length();
      if (len > 1) move.multiplyScalar(1 / len);
      // Jika analog, skala halus; jika digital/lebih dari 1, clamp ke MOVE_SPEED.
      const analogMag = Math.min(1, Math.hypot(x, z));
      move.multiplyScalar(MOVE_SPEED * (analogMag > 0 ? analogMag : 1));
      if (move.length() > MOVE_SPEED) move.setLength(MOVE_SPEED);
    }
    return move;
  }

  function updateHeldPetasan() {
    const p = heldPetasan;
    if (!p || p.cleaned || p.exploded) { heldPetasan = null; return; }
    const t = body.translation();
    const f = getForward();
    const holdPos = { x: t.x + f.x * 0.75, y: t.y + 0.45, z: t.z + f.z * 0.75 };
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), facingYaw);
    try {
      if (p.body.setNextKinematicTranslation) p.body.setNextKinematicTranslation(holdPos);
      p.body.setTranslation(holdPos, true);
      p.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      if (p.body.setNextKinematicRotation) p.body.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
      p.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    } catch (_) { heldPetasan = null; }
  }

  function updateCarriedEntity() {
    const e = carriedEntity;
    if (!e) return;
    // Petasan yang sudah hilang
    if (!e.isPlayer && (e.cleaned || e.exploded)) { carriedEntity = null; return; }
    const pos = getCarryOrigin();
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), facingYaw);
    try {
      if (e.isPlayer) {
        if (e.body.setNextKinematicTranslation) e.body.setNextKinematicTranslation({ x: pos.x, y: pos.y, z: pos.z });
        e.body.setTranslation({ x: pos.x, y: pos.y, z: pos.z }, true);
        e.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
      } else {
        if (e.body.setNextKinematicTranslation) e.body.setNextKinematicTranslation({ x: pos.x, y: pos.y, z: pos.z });
        e.body.setTranslation({ x: pos.x, y: pos.y, z: pos.z }, true);
        e.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        e.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
    } catch (_) { carriedEntity = null; }
  }

  function update(dt, camera, inputState = null) {
    if (inputState && typeof inputState === 'object') setRemoteInput(inputState);
    punchCooldown = Math.max(0, punchCooldown - dt);
    punchAnim = Math.max(0, punchAnim - dt);
    spawnProtection = Math.max(0, spawnProtection - dt);
    if (heldPetasan && !heldPetasan.cleaned && !heldPetasan.exploded) {
      throwHoldTime = Math.min(THROW_CHARGE_TIME, throwHoldTime + dt);
    } else if (!heldPetasan) {
      throwHoldTime = 0;
    }
    if (powerUp) {
      powerUp.remaining -= dt;
      if (powerUp.remaining <= 0) clearPowerUp();
      else updatePowerUpVisual();
    }

    if (eliminated) {
      group.visible = false;
      try {
        body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        body.setTranslation({ x: 0, y: -50, z: 0 }, true);
      } catch (_) {}
      return;
    }
    group.visible = true;

    // Stagger turun perlahan jika tidak terkena hit
    if (stagger > 0 && knockoutTimer <= 0) stagger = Math.max(0, stagger - dt * 18);

    // Knockout timer
    if (knockoutTimer > 0) {
      knockoutTimer -= dt;
      starsGroup.visible = true;
      starsGroup.rotation.y += dt * 4;
      if (knockoutTimer <= 0) {
        knockoutTimer = 0;
        if (!carriedBy) recoverFromKnockout();
        else { stagger = 0; /* tetap ragdoll sampai dilepas */ }
      }
    } else if (isRagdoll && !carriedBy) {
      recoverFromKnockout();
    } else {
      starsGroup.visible = false;
    }

    const isKnockedOut = knockoutTimer > 0;
    const canControl = (inputEnabled || isRemote) && !isKnockedOut && !carriedBy;

    // Ground/jump/move hanya saat bisa kontrol
    const grounded = isGrounded();
    const wantJump = (inputEnabled && keys.has('Space')) || !!remoteInput.jump;
    if (canControl && wantJump && grounded && !jumpRequested) {
      const lv = body.linvel();
      body.setLinvel({ x: lv.x, y: JUMP_VELOCITY, z: lv.z }, true);
      jumpRequested = true;
    }
    if (!wantJump) jumpRequested = false;

    const move = canControl ? readMovement(camera) : new THREE.Vector3();
    if (!carriedBy) {
      const lv = body.linvel();
      // Saat knockout, biarkan fisika ragdoll bekerja; jangan paksa horizontal
      if (isKnockedOut) {
        // biarkan linvel dari fisika/impulse
      } else {
        body.setLinvel({ x: move.x, y: lv.y, z: move.z }, true);
      }
    }

    if (!isKnockedOut && !carriedBy) {
      if (move.lengthSq() > 0.01) facingYaw = Math.atan2(move.x, move.z);
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), facingYaw);
      body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    }

    // Ring-out
    let t;
    try { t = body.translation(); } catch (_) { t = { x: 0, y: -999, z: 0 }; }
    if (isRingOut(t.y) && !respawning) {
      if (carriedBy && carriedBy.carriedEntity === api) carriedBy.carriedEntity = null;
      carriedBy = null;
      if (onRingOutCb) {
        respawning = true;
        try { body.setLinvel({ x: 0, y: 0, z: 0 }, true); body.setTranslation({ x: 0, y: -30, z: 0 }, true); } catch (_) {}
        onRingOutCb(api);
        return;
      }
      reset();
      t = body.translation();
    }

    // Sync visual <- fisika
    let pos, rot;
    try { pos = body.translation(); rot = body.rotation(); } catch (_) { pos = { x: 0, y: 0, z: 0 }; rot = { x: 0, y: 0, z: 0, w: 1 }; }
    group.position.set(pos.x, pos.y, pos.z);
    group.quaternion.set(rot.x, rot.y, rot.z, rot.w);

    // Animasi tangan
    const time = performance.now() * 0.004;
    const bob = Math.sin(time) * 0.04;
    const sway = grounded && move.lengthSq() > 0.01 && !isKnockedOut ? Math.sin(time * 2.2) * 0.08 : 0;
    handL.position.set(-capsule.radius - 0.28, 0.15 + bob + sway, 0.15);
    handR.position.set(capsule.radius + 0.28, 0.15 + bob - sway, 0.15);
    if (punchAnim > 0) {
      // animasi tinju tangan kanan menjulur ke depan
      const p = punchAnim / 0.22;
      handR.position.z += 0.75 * Math.sin(p * Math.PI);
      handR.position.x -= 0.1 * Math.sin(p * Math.PI);
    }

    updateHeldPetasan();
    updateCarriedEntity();

    // Hit flash
    if (hitFlash > 0) {
      hitFlash -= dt;
      const flashOn = Math.floor(hitFlash * 30) % 2 === 0;
      bodyMat.emissive.setHex(flashOn ? 0xffffff : 0x000000);
      bodyMat.emissiveIntensity = flashOn ? 0.6 : 0;
      if (hitFlash <= 0) { bodyMat.emissive.setHex(0x000000); bodyMat.emissiveIntensity = 0; }
    }

    // Spawn protection blink
    if (spawnProtection > 0) {
      group.visible = Math.floor(spawnProtection * 12) % 2 === 0;
    } else if (!eliminated) {
      group.visible = true;
    }

    updateHealthBar(camera);
  }

  function dispose() {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
  }

  function setRemoteInput(next = {}) {
    if (!next || typeof next !== 'object') return;
    if ('moveX' in next) remoteInput.moveX = Math.max(-1, Math.min(1, Number(next.moveX) || 0));
    if ('moveZ' in next) remoteInput.moveZ = Math.max(-1, Math.min(1, Number(next.moveZ) || 0));
    if ('jump' in next) remoteInput.jump = !!next.jump;
    if ('punch' in next) remoteInput.punch = !!next.punch;
    if ('grabThrow' in next) remoteInput.grabThrow = !!next.grabThrow;
    if ('bombHeld' in next) remoteInput.bombHeld = !!next.bombHeld;
  }

  const api = {
    isPlayer: true,
    get name() { return playerName; },
    set name(v) { this.setName(v); },
    setName(n) { playerName = String(n || 'Pemain').slice(0, 14) || 'Pemain'; group.name = playerName; updateNameTag(playerName); },
    color,
    characterType,
    group,
    body,
    collider,
    isBot,
    isRemote,
    get inputEnabled() { return inputEnabled; },
    get remoteInput() { return remoteInput; },
    setRemoteInput,
    get hp() { return hp; },
    set hp(v) { hp = Math.max(0, Math.min(maxHp, Number(v) || 0)); },
    get maxHp() { return maxHp; },
    set maxHp(v) { maxHp = Math.max(1, Number(v) || 100); hp = Math.min(hp, maxHp); },
    get lives() { return lives; },
    set lives(v) { lives = Math.max(0, v | 0); },
    get score() { return score; },
    set score(v) { score = Math.max(0, v | 0); },
    get eliminated() { return eliminated; },
    set eliminated(v) { eliminated = !!v; },
    get respawning() { return respawning; },
    set respawning(v) { respawning = !!v; },
    get spawnProtection() { return spawnProtection; },
    set spawnProtection(v) { spawnProtection = Math.max(0, Number(v) || 0); },
    carriedFlag: null,
    team: null,
    get stagger() { return stagger; },
    set stagger(v) { stagger = Math.max(0, Number(v) || 0); },
    get knockoutTimer() { return knockoutTimer; },
    set knockoutTimer(v) { knockoutTimer = Math.max(0, Number(v) || 0); },
    get isRagdoll() { return isRagdoll; },
    get powerUp() { return powerUp; },
    set powerUp(v) { powerUp = v || null; },
    applyPowerUp,
    clearPowerUp,
    get heldPetasan() { return heldPetasan; },
    set heldPetasan(v) { heldPetasan = v; },
    get carriedEntity() { return carriedEntity; },
    set carriedEntity(v) { carriedEntity = v; },
    get carriedBy() { return carriedBy; },
    set carriedBy(v) { carriedBy = v; },
    get facingYaw() { return facingYaw; },
    setPetasanManager(mgr) { petasanManagerRef.current = mgr; },
    applyTuning: applyTuningToBody,
    getThrowCharge,
    update,
    reset,
    respawnAt,
    eliminate,
    resetForRound,
    takeDamage,
    addStagger,
    knockout,
    resetHp,
    holdPetasan,
    throwPetasan,
    punch,
    tryCarry,
    throwCarried,
    toggleCarryOrThrow,
    releaseHeldPetasan,
    releaseCarriedEntitySafe,
    dispose,
    get position() { return body.translation(); },
  };

  return api;
}
