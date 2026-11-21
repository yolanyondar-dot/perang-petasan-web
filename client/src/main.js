/**
 * main.js — entry point perang-petasan.
 * Merangkai physics, arena, player, petasan, dan couch multiplayer.
 */
import * as THREE from 'three';
import { initPhysics, stepPhysics, getWorld, MAX_PHYSICS_DT } from './physics.js';
import { createArena, ARENA, ARENA_TYPES } from './arena.js';
import { createPlayer } from './player.js';
import { createPetasanManager } from './petasan.js';
import { createNetwork } from './network.js';
import { createPickupManager } from './pickup.js';
import { createBotController } from './bot.js';
import { createModeManager } from './modeManager.js';
import * as Audio from './audio.js';
import { PHYSICS_TUNING, TUNING_DEFAULTS, resetTuning, applyTuning } from './tuning.js';

const app = document.getElementById('app');
const overlay = document.getElementById('overlay');
const hudStats = document.getElementById('hud-stats');
const roomCodeEl = document.getElementById('room-code');
const roomUrlEl = document.getElementById('room-url');
const powerupHudEl = document.getElementById('powerup-hud');
const btnAddBot = document.getElementById('btn-add-bot');
const btnClearBots = document.getElementById('btn-clear-bots');
const btnMute = document.getElementById('btn-mute');
const roundTitleEl = document.getElementById('round-title');
const livesHudEl = document.getElementById('lives-hud');
const roundBanner = document.getElementById('round-banner');
const roundBannerTitle = document.getElementById('round-banner-title');
const roundBannerSub = document.getElementById('round-banner-sub');
const podiumEl = document.getElementById('podium');
const podiumSub = document.getElementById('podium-sub');
const podiumTable = document.getElementById('podium-table');
const btnPlayAgain = document.getElementById('btn-play-again');
const arenaSelect = document.getElementById('arena-select');
const modeSelect = document.getElementById('mode-select');
const modeStatusEl = document.getElementById('mode-status');

const REMOTE_COLORS = [0x42a5f5, 0x66bb6a, 0xff7043, 0xab47bc, 0xffca28, 0x26c6da, 0xec407a, 0x8d6e63];

async function bootstrap() {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  app.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb);
  scene.fog = new THREE.Fog(0x87ceeb, 35, 90);

  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 200);
  const cameraOffset = new THREE.Vector3(0, 12, 14);
  const lookAtOffset = new THREE.Vector3(0, 1.2, 0);
  camera.position.copy(ARENA.spawn).add(cameraOffset);
  camera.lookAt(new THREE.Vector3().copy(ARENA.spawn).add(lookAtOffset));

  // --- Screen shake --------------------------------------------------------
  let shakeTime = 0;
  let shakeDuration = 0;
  let shakeIntensity = 0;
  const shakeOffset = new THREE.Vector3();
  function addScreenShake(intensity, duration = 0.35) {
    shakeIntensity = Math.max(shakeIntensity, intensity);
    shakeDuration = Math.max(shakeDuration, duration);
    shakeTime = Math.max(shakeTime, duration);
  }
  function updateScreenShake(dt) {
    if (shakeTime <= 0) { shakeOffset.set(0, 0, 0); return; }
    shakeTime -= dt;
    const t = Math.max(0, shakeTime / (shakeDuration || 1));
    const amt = shakeIntensity * t * t;
    shakeOffset.set((Math.random() - 0.5) * amt, (Math.random() - 0.5) * amt * 0.6, (Math.random() - 0.5) * amt);
    if (shakeTime <= 0) { shakeIntensity = 0; shakeDuration = 0; shakeOffset.set(0, 0, 0); }
  }

  // --- Audio unlock / mute -------------------------------------------------
  const unlock = () => { Audio.unlockAudio(); window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
  btnMute?.addEventListener('click', () => {
    const m = Audio.toggleMute();
    if (btnMute) btnMute.textContent = m ? 'Unmute' : 'Mute';
  });

  await initPhysics();
  const world = getWorld();
  let arena = createArena(scene, world);
  let pendingArenaType = arena.type;
  let pendingMode = 'ffa';

  // --- Round/match state ---------------------------------------------------
  const MAX_ROUNDS = 3;
  let roundNum = 1;
  let roundOver = false;
  let matchOver = false;
  let roundTransitionTimer = 0;
  /** @type {Map<any, number>} */
  const respawnTimers = new Map();

  const players = [];

  function randomSpawn() {
    const pts = arena?.spawnPoints?.length ? arena.spawnPoints : (ARENA.spawnPoints || []);
    if (pts.length) return pts[Math.floor(Math.random() * pts.length)].clone();
    const a = Math.random() * Math.PI * 2;
    const r = 2 + Math.random() * 3;
    return new THREE.Vector3(Math.cos(a) * r, 4, Math.sin(a) * r);
  }

  function activePlayers() { return players.filter((p) => p && !p.eliminated); }
  function alivePlayers() { return players.filter((p) => p && !p.eliminated && !p.respawning); }

  function updateRoundHud() {
    const mode = modeManager?.getMode?.() || 'ffa';
    if (roundTitleEl) roundTitleEl.textContent = matchOver ? `Selesai (${MAX_ROUNDS} ronde)` : `Ronde ${roundNum} / ${MAX_ROUNDS}`;
    if (livesHudEl) {
      if (mode === 'ffa') {
        livesHudEl.textContent = players.map((p) => {
          const hearts = p.eliminated ? 'OUT' : '❤'.repeat(Math.max(0, p.lives));
          return `${p.name}: ${hearts} (Skor ${p.score})`;
        }).join('  |  ');
      } else if (mode === 'koth') {
        const scores = modeManager.getKothScores?.() || [];
        livesHudEl.textContent = scores.map((s) => `${s.player.name}: ${Math.floor(s.score)}pt`).join('  |  ');
      } else if (mode === 'ctf') {
        const cs = modeManager.ctfScores || { A: 0, B: 0 };
        livesHudEl.textContent = `Tim A: ${cs.A}  |  Tim B: ${cs.B}  —  ` + players.map((p) => `${p.name}[${p.team || '?'}]`).join(' ');
      } else {
        livesHudEl.textContent = players.map((p) => p.name).join(' | ');
      }
    }
  }

  function showRoundBanner(title, sub = '', ms = 1800) {
    if (roundBannerTitle) roundBannerTitle.textContent = title;
    if (roundBannerSub) roundBannerSub.textContent = sub;
    roundBanner?.classList.add('show');
    if (ms > 0) setTimeout(() => { if (!matchOver) roundBanner?.classList.remove('show'); }, ms);
  }

  function hideRoundBanner() { roundBanner?.classList.remove('show'); }

  function showPodium() {
    const sorted = [...players].sort((a, b) => b.score - a.score || b.lives - a.lives);
    if (podiumSub) podiumSub.textContent = `Pemenang: ${sorted[0]?.name || '-'} `;
    if (podiumTable) {
      const rows = sorted.map((p, i) => `<tr><td>#${i + 1}</td><td>${p.name}</td><td>${p.score}</td><td>${p.eliminated ? 'OUT' : p.lives}</td></tr>`).join('');
      podiumTable.innerHTML = `<table><thead><tr><th>Rank</th><th>Pemain</th><th>Skor</th><th>Nyawa</th></tr></thead><tbody>${rows}</tbody></table>`;
    }
    podiumEl?.classList.add('show');
  }

  function hidePodium() { podiumEl?.classList.remove('show'); }

  function scheduleRespawn(p) {
    if (!p || p.eliminated) return;
    respawnTimers.set(p, 1.2);
  }

  function handlePlayerOut(p, reason = 'out') {
    if (!p || p.eliminated || matchOver) return;
    if (reason === 'ringout') Audio.playRingOut();
    const mode = modeManager?.getMode?.() || 'ffa';
    modeManager?.onPlayerOut?.(p);

    if (mode === 'ffa') {
      p.lives = Math.max(0, (p.lives | 0) - 1);
      if (p.lives > 0) {
        p.respawning = true;
        scheduleRespawn(p);
      } else {
        p.eliminate();
      }
      updateRoundHud();
      checkRoundEnd();
      return;
    }

    // KOTH/CTF: respawn tanpa eliminasi
    p.respawning = true;
    scheduleRespawn(p);
    updateRoundHud();
  }

  function handlePlayerRingOut(p) {
    handlePlayerOut(p, 'ringout');
  }

  function resetPetasansAndPickups() {
    for (const p of [...petasanManager.petasans]) petasanManager.discard(p);
    petasanManager.petasans.length = 0;
    petasanManager.effects.length = 0; // effects are visual objects; they'll be cleaned on next update; safer to clear via discard logic not exposed - just clear array reference not possible
    pickupManager.clear();
  }

  function resetArenaForRound() {
    respawnTimers.clear();
    applyPendingArenaMode(false);
    petasanManager.clearAll?.();
    pickupManager.clear();

    const all = [...players];
    all.forEach((p, i) => {
      const pos = getSpawnForIndex(i);
      p.resetForRound(pos, true);
      p.team = p.team || null;
    });
    modeManager.ensureTeams?.();
    modeManager.resetRound?.(arena);
    roundOver = false;
    roundTransitionTimer = 0;
    hideRoundBanner();
    updateRoundHud();
    updateModeHud();
  }

  function startNextRoundOrMatch() {
    if (roundNum >= MAX_ROUNDS) {
      matchOver = true;
      roundOver = true;
      Audio.playWin();
      showPodium();
      updateRoundHud();
      return;
    }
    roundNum += 1;
    resetArenaForRound();
    showRoundBanner(`Ronde ${roundNum}`, 'Siap bertarung!', 1500);
  }

  function checkRoundEnd() {
    if (roundOver || matchOver) return;
    const mode = modeManager?.getMode?.() || 'ffa';
    if (mode !== 'ffa') return;
    const remaining = players.filter((p) => !p.eliminated);
    if (remaining.length > 1) return;
    roundOver = true;
    const winner = remaining[0] || null;
    if (winner) { winner.score += 1; Audio.playWin(); }
    updateRoundHud();
    const title = winner ? `${winner.name} Menang Ronde!` : 'Seri!';
    const sub = roundNum >= MAX_ROUNDS ? 'Pertandingan selesai...' : 'Ronde berikutnya segera dimulai...';
    showRoundBanner(title, sub, 3200);
    roundTransitionTimer = 3.5;
  }

  function checkModeRoundEnd() {
    if (roundOver || matchOver) return;
    const mode = modeManager?.getMode?.() || 'ffa';
    if (mode === 'ffa') return;
    if (!modeManager?.isRoundOver?.()) return;
    roundOver = true;
    const winner = modeManager.getWinner?.();
    let title = 'Ronde Selesai!';
    if (winner?.isPlayer || winner?.name) {
      if (!winner.team) winner.score = (winner.score || 0) + 1;
      title = `${winner.name} Menang Ronde!`;
    } else if (winner?.team) {
      // team win - give point to all team members for scoreboard
      for (const p of players) if (p.team === winner.team) p.score = (p.score || 0) + 1;
      title = `${winner.name} Menang Ronde!`;
    } else {
      title = 'Ronde Selesai!';
    }
    updateRoundHud();
    updateModeHud();
    const sub = roundNum >= MAX_ROUNDS ? 'Pertandingan selesai...' : 'Ronde berikutnya segera dimulai...';
    showRoundBanner(title, sub, 3200);
    roundTransitionTimer = 3.5;
  }

  function resetMatch() {
    matchOver = false;
    roundOver = false;
    roundNum = 1;
    roundTransitionTimer = 0;
    respawnTimers.clear();
    hidePodium();
    hideRoundBanner();
    for (const p of players) { p.score = 0; p.team = null; }
    modeManager.resetTeams?.();
    applyPendingArenaMode(true);
    resetArenaForRound();
    showRoundBanner('Ronde 1', 'Pertandingan baru!', 1500);
  }

  btnPlayAgain?.addEventListener('click', () => { Audio.unlockAudio(); resetMatch(); });

  const player = createPlayer(scene, {
    name: 'Player',
    spawn: ARENA.spawn.clone(),
    color: 0xff5fa2,
    inputEnabled: true,
    onRingOut: handlePlayerRingOut,
    onPunch: () => Audio.playPunch(),
    onThrow: () => Audio.playThrow(),
    onFuse: () => Audio.playFuse(),
  });
  players.push(player);

  const petasanManager = createPetasanManager(scene, { world }, {
    ringOutY: ARENA.fallY,
    getPlayers: () => players,
    onExplode: ({ origin, radius, visualScale }) => {
      const camDist = camera.position.distanceTo(origin);
      const maxDist = 18;
      const closeness = Math.max(0, 1 - camDist / maxDist);
      const intensity = (0.25 + closeness * 0.9) * (visualScale || 1);
      addScreenShake(intensity, 0.28 + 0.12 * (visualScale || 1));
      Audio.playExplosion(visualScale || 1);
    },
  });
  player.setPetasanManager(petasanManager);

  const pickupManager = createPickupManager(scene, {
    getPlayers: () => players,
  });

  // --- Mode manager --------------------------------------------------------
  const modeManager = createModeManager(scene, {
    getPlayers: () => players,
    getArena: () => arena,
    onModeEvent: (evt) => {
      if (evt?.type === 'ctf_capture' || evt?.type === 'ctf_win' || evt?.type === 'koth_win') {
        Audio.playWin();
      }
      updateModeHud();
    },
  });
  modeManager.setMode(pendingMode);
  for (const p of players) modeManager.assignTeam(p);
  modeManager.resetRound(arena);

  function updateModeHud() {
    const st = modeManager.getStatus();
    if (modeStatusEl) modeStatusEl.textContent = st?.detail || st?.label || '';
  }

  function getSpawnForIndex(i) {
    const pts = arena?.spawnPoints?.length ? arena.spawnPoints : (ARENA.spawnPoints || []);
    if (pts.length) return pts[i % pts.length].clone();
    return (ARENA.spawn ? ARENA.spawn.clone() : new THREE.Vector3(0, 4, 0));
  }

  function applyPendingArenaMode(force = false) {
    const nextArena = pendingArenaType || ARENA.type;
    const nextMode = pendingMode || 'ffa';
    const arenaChanged = force || nextArena !== arena?.type;
    const modeChanged = force || nextMode !== modeManager.getMode();

    if (arenaChanged) {
      try { petasanManager.clearAll?.(); } catch (_) {}
      try { pickupManager.clear?.(); } catch (_) {}
      try { arena?.dispose?.(); } catch (_) {}
      arena = createArena(scene, world, { type: nextArena });
      petasanManager.setRingOutY?.(arena.fallY ?? ARENA.fallY);
    }

    if (modeChanged) {
      modeManager.setMode(nextMode);
      for (const p of players) modeManager.assignTeam(p);
    } else if (arenaChanged) {
      modeManager.onArenaChanged?.();
    }

    if (arenaSelect) arenaSelect.value = ARENA.type;
    if (modeSelect) modeSelect.value = modeManager.getMode();
    updateModeHud();
  }

  arenaSelect?.addEventListener('change', () => {
    pendingArenaType = arenaSelect.value;
    if (modeStatusEl) modeStatusEl.textContent = `Arena ${pendingArenaType} diterapkan ronde berikutnya/reset.`;
  });
  modeSelect?.addEventListener('change', () => {
    pendingMode = modeSelect.value;
    if (modeStatusEl) modeStatusEl.textContent = `Mode ${pendingMode.toUpperCase()} diterapkan ronde berikutnya/reset.`;
  });

  // --- Bots ----------------------------------------------------------------
  /** @type {Array<{player:any, controller:any}>} */
  const bots = [];
  let botSeq = 1;
  const BOT_COLORS = [0x4fc3f7, 0x7ee081, 0xffb74d, 0xba68c8, 0x90a4ae, 0xa1887f];

  function removeBotEntry(entry) {
    const bp = entry?.player;
    if (!bp) return;
    try { if (bp.carriedBy && bp.carriedBy.carriedEntity === bp) bp.carriedBy.carriedEntity = null; } catch (_) {}
    try { bp.carriedBy = null; } catch (_) {}
    try { bp.releaseHeldPetasan?.(true); } catch (_) {}
    try { bp.releaseCarriedEntitySafe?.(false); } catch (_) {}
    try { bp.dispose?.(); } catch (_) {}
    if (bp.group?.parent) bp.group.parent.remove(bp.group);
    try { world.removeRigidBody(bp.body); } catch (_) {}
    const idx = players.indexOf(bp);
    if (idx >= 0) players.splice(idx, 1);
  }

  function addBot(name) {
    const color = BOT_COLORS[(botSeq - 1) % BOT_COLORS.length];
    const spawn = randomSpawn();
    const bp = createPlayer(scene, {
      name: name || `Bot ${botSeq}`,
      spawn,
      color,
      isBot: true,
      inputEnabled: false,
      onRingOut: handlePlayerRingOut,
      onPunch: () => Audio.playPunch(),
      onThrow: () => Audio.playThrow(),
      onFuse: () => Audio.playFuse(),
    });
    bp.setPetasanManager(petasanManager);
    players.push(bp);
    modeManager?.assignTeam(bp);
    const controller = createBotController(bp, {
      getPlayers: () => players,
      getPetasanManager: () => petasanManager,
      getCamera: () => camera,
    });
    bots.push({ player: bp, controller });
    botSeq += 1;
    updateModeHud();
    return bp;
  }

  function clearBots() {
    for (const b of [...bots]) removeBotEntry(b);
    bots.length = 0;
  }

  // Tambah 2 bot awal agar arena tidak sepi
  addBot('Dummy');
  addBot('Rival');

  // --- Remote/mobile players -----------------------------------------------
  /** @type {Map<string, {player:any, prev:any, throwCooldown:number, colorIndex:number}>} */
  const remotes = new Map();
  let nextRemoteColor = 0;

  function removeRemote(controllerId) {
    const entry = remotes.get(controllerId);
    if (!entry) return;
    const rp = entry.player;
    try { if (rp.carriedBy && rp.carriedBy.carriedEntity === rp) rp.carriedBy.carriedEntity = null; } catch (_) {}
    try { rp.carriedBy = null; } catch (_) {}
    try { rp.releaseHeldPetasan?.(true); } catch (_) {}
    try { rp.releaseCarriedEntitySafe?.(false); } catch (_) {}
    try { rp.dispose?.(); } catch (_) {}
    if (rp.group?.parent) rp.group.parent.remove(rp.group);
    try { world.removeRigidBody(rp.body); } catch (_) {}
    const idx = players.indexOf(rp);
    if (idx >= 0) players.splice(idx, 1);
    remotes.delete(controllerId);
  }

  function ensureRemotePlayer(controllerId, name) {
    let entry = remotes.get(controllerId);
    if (entry) {
      if (name && entry.player.name !== name) entry.player.name = name;
      return entry;
    }
    const color = REMOTE_COLORS[nextRemoteColor % REMOTE_COLORS.length];
    nextRemoteColor += 1;
    const rp = createPlayer(scene, {
      name: name || `P${nextRemoteColor}`,
      spawn: randomSpawn(),
      color,
      isRemote: true,
      inputEnabled: false,
      onRingOut: handlePlayerRingOut,
      onPunch: () => Audio.playPunch(),
      onThrow: () => Audio.playThrow(),
      onFuse: () => Audio.playFuse(),
    });
    rp.setPetasanManager(petasanManager);
    players.push(rp);
    modeManager?.assignTeam(rp);
    entry = { player: rp, prev: { jump: false, punch: false, grabThrow: false, bombHeld: false }, throwCooldown: 0 };
    remotes.set(controllerId, entry);
    updateModeHud();
    return entry;
  }

  function handleRemoteInput(controllerId, state) {
    const entry = remotes.get(controllerId);
    if (!entry) return;
    const rp = entry.player;
    if (matchOver || roundOver || rp.eliminated) { rp.setRemoteInput({ moveX:0, moveZ:0, jump:false, punch:false, grabThrow:false, bombHeld:false }); return; }
    rp.setRemoteInput(state);
    const prev = entry.prev;
    const now = {
      jump: !!state.jump,
      punch: !!state.punch,
      grabThrow: !!state.grabThrow,
      bombHeld: !!state.bombHeld,
    };

    // Rising edge actions
    if (now.punch && !prev.punch) rp.punch(players);
    if (now.grabThrow && !prev.grabThrow) rp.toggleCarryOrThrow(players, petasanManager.petasans);

    // Bomb hold/release
    if (now.bombHeld && !prev.bombHeld) {
      if (!rp.heldPetasan && !rp.carriedEntity && rp.knockoutTimer <= 0 && !rp.carriedBy && entry.throwCooldown <= 0) {
        const spawnPos = rp.group.position.clone();
        spawnPos.y += 0.5;
        const type = (rp.powerUp?.type === 'banting' || rp.powerUp?.type === 'renteng') ? rp.powerUp.type : 'normal';
        const petasan = petasanManager.spawn(spawnPos, { fuse: 2.2, type });
        const held = rp.holdPetasan(petasan);
        if (!held) petasanManager.discard(petasan);
      }
    }
    if (!now.bombHeld && prev.bombHeld) {
      if (rp.heldPetasan) {
        const threw = rp.throwPetasan();
        if (threw) entry.throwCooldown = 0.45;
      }
    }

    entry.prev = now;
  }

  // --- Network -------------------------------------------------------------
  const network = createNetwork({
    onRoomCreated: ({ roomCode, controllerUrl }) => {
      if (roomCodeEl) roomCodeEl.textContent = roomCode;
      if (roomUrlEl) {
        const hostHint = location.hostname || 'localhost';
        roomUrlEl.innerHTML = `Buka <b>${controllerUrl}</b> di HP (Wi-Fi sama)<br><span class="muted">Server: ${network.serverUrl}</span>`;
      }
    },
    onStatus: (s) => {
      if (!s.connected && roomUrlEl && !network.roomCode) {
        roomUrlEl.textContent = `Server belum terhubung (${s.error || s.reason || network.serverUrl}). Jalankan server: npm run server`;
      }
    },
    onPlayerJoined: ({ controllerId, name }) => {
      ensureRemotePlayer(controllerId, name);
    },
    onPlayerInput: ({ controllerId, state }) => {
      if (!remotes.has(controllerId)) ensureRemotePlayer(controllerId, 'Pemain');
      handleRemoteInput(controllerId, state || {});
    },
    onPlayerLeft: ({ controllerId }) => {
      removeRemote(controllerId);
    },
  });
  network.connect();

  // --- Bot controls --------------------------------------------------------
  btnAddBot?.addEventListener('click', () => addBot());
  btnClearBots?.addEventListener('click', () => clearBots());

  // --- Tuning Fisika HUD ---------------------------------------------------
  const tuningToggle = document.getElementById('tuning-toggle');
  const tuningDrawer = document.getElementById('tuning-drawer');
  const tuningReset = document.getElementById('tuning-reset');
  const tuneGravity = document.getElementById('tune-gravity');
  const tuneExplosion = document.getElementById('tune-explosion');
  const tuneRadius = document.getElementById('tune-radius');
  const tuneThrow = document.getElementById('tune-throw');
  const tuneKnockout = document.getElementById('tune-knockout');
  const tuneFriction = document.getElementById('tune-friction');
  const valGravity = document.getElementById('val-gravity');
  const valExplosion = document.getElementById('val-explosion');
  const valRadius = document.getElementById('val-radius');
  const valThrow = document.getElementById('val-throw');
  const valKnockout = document.getElementById('val-knockout');
  const valFriction = document.getElementById('val-friction');

  function syncTuningUI() {
    if (tuneGravity) tuneGravity.value = String(PHYSICS_TUNING.gravityY);
    if (tuneExplosion) tuneExplosion.value = String(PHYSICS_TUNING.explosionImpulseMax);
    if (tuneRadius) tuneRadius.value = String(PHYSICS_TUNING.explosionRadius);
    if (tuneThrow) tuneThrow.value = String(PHYSICS_TUNING.throwSpeedMax);
    if (tuneKnockout) tuneKnockout.value = String(PHYSICS_TUNING.knockoutDuration);
    if (tuneFriction) tuneFriction.value = String(PHYSICS_TUNING.arenaFriction);
    if (valGravity) valGravity.textContent = Number(PHYSICS_TUNING.gravityY).toFixed(1);
    if (valExplosion) valExplosion.textContent = Number(PHYSICS_TUNING.explosionImpulseMax).toFixed(1);
    if (valRadius) valRadius.textContent = Number(PHYSICS_TUNING.explosionRadius).toFixed(1);
    if (valThrow) valThrow.textContent = Number(PHYSICS_TUNING.throwSpeedMax).toFixed(1);
    if (valKnockout) valKnockout.textContent = Number(PHYSICS_TUNING.knockoutDuration).toFixed(1);
    if (valFriction) valFriction.textContent = Number(PHYSICS_TUNING.arenaFriction).toFixed(2);
  }

  function applyTuningRuntime() {
    applyTuning({ world, arenaCollider: arena?.collider, players });
    try { arena?.applyFriction?.(PHYSICS_TUNING.arenaFriction); } catch (_) {}
  }

  function bindTuningInput(input, key, out, fmt, transform) {
    if (!input) return;
    input.addEventListener('input', () => {
      const raw = Number(input.value);
      if (!Number.isFinite(raw)) return;
      const value = transform ? transform(raw) : raw;
      PHYSICS_TUNING[key] = value;
      if (out) out.textContent = fmt(value);
      applyTuningRuntime();
    });
  }

  bindTuningInput(tuneGravity, 'gravityY', valGravity, (v) => Number(v).toFixed(1));
  bindTuningInput(tuneExplosion, 'explosionImpulseMax', valExplosion, (v) => Number(v).toFixed(1));
  bindTuningInput(tuneRadius, 'explosionRadius', valRadius, (v) => Number(v).toFixed(1));
  bindTuningInput(tuneThrow, 'throwSpeedMax', valThrow, (v) => Number(v).toFixed(1), (v) => {
    PHYSICS_TUNING.throwSpeedMin = Math.max(4, v - 5);
    return v;
  });
  bindTuningInput(tuneKnockout, 'knockoutDuration', valKnockout, (v) => Number(v).toFixed(1));
  bindTuningInput(tuneFriction, 'arenaFriction', valFriction, (v) => Number(v).toFixed(2));

  tuningToggle?.addEventListener('click', () => {
    const open = tuningDrawer?.classList.toggle('open');
    tuningDrawer?.setAttribute('aria-hidden', open ? 'false' : 'true');
  });
  tuningReset?.addEventListener('click', () => {
    resetTuning();
    syncTuningUI();
    applyTuningRuntime();
  });
  syncTuningUI();

  // --- Local input (keyboard + mouse) --------------------------------------
  let throwCooldown = 0;
  const THROW_COOLDOWN = 0.45;

  function trySpawnAndHold() {
    if (throwCooldown > 0 || matchOver || roundOver || player.eliminated) return;
    if (player.heldPetasan || player.carriedEntity) return;
    if (player.knockoutTimer > 0 || player.carriedBy) return;
    const spawnPos = player.group.position.clone();
    spawnPos.y += 0.5;
    const type = (player.powerUp?.type === 'banting' || player.powerUp?.type === 'renteng') ? player.powerUp.type : 'normal';
    const petasan = petasanManager.spawn(spawnPos, { fuse: 2.2, type });
    const held = player.holdPetasan(petasan);
    if (!held) petasanManager.discard(petasan);
  }
  function tryThrowHeld() {
    if (!player.heldPetasan) return;
    const threw = player.throwPetasan();
    if (threw) throwCooldown = THROW_COOLDOWN;
  }

  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyE') { e.preventDefault(); if (!e.repeat) trySpawnAndHold(); }
    if (e.code === 'KeyF') { e.preventDefault(); if (!e.repeat && !matchOver && !roundOver && !player.eliminated) player.punch(players); }
    if (e.code === 'KeyQ' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') { e.preventDefault(); if (!e.repeat && !matchOver && !roundOver && !player.eliminated) player.toggleCarryOrThrow(players, petasanManager.petasans); }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'KeyE') { e.preventDefault(); tryThrowHeld(); }
  });

  const canvas = renderer.domElement;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    if (e.target !== canvas) return;
    canvas.setPointerCapture?.(e.pointerId);
    if (e.button === 0) trySpawnAndHold();
    else if (e.button === 2 && !matchOver && !roundOver && !player.eliminated) player.punch(players);
  });
  canvas.addEventListener('pointerup', (e) => { if (e.button === 0) tryThrowHeld(); });
  window.addEventListener('pointerup', (e) => { if (e.button === 0 && e.target !== canvas) tryThrowHeld(); });

  // --- Resize --------------------------------------------------------------
  window.addEventListener('resize', () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  });

  // --- Loop ---------------------------------------------------------------
  const clock = new THREE.Clock();
  const desiredCameraPos = new THREE.Vector3();
  const desiredLookAt = new THREE.Vector3();
  const currentLookAt = new THREE.Vector3().copy(ARENA.spawn).add(lookAtOffset);
  overlay?.classList.add('hidden');
  updateRoundHud();
  showRoundBanner('Ronde 1', 'Siap bertarung!', 1500);

  function frame() {
    requestAnimationFrame(frame);
    const rawDt = clock.getDelta();
    const dt = Math.min(rawDt, MAX_PHYSICS_DT);
    throwCooldown = Math.max(0, throwCooldown - dt);
    for (const entry of remotes.values()) entry.throwCooldown = Math.max(0, entry.throwCooldown - dt);

    if (!matchOver && !roundOver) {
      for (const b of bots) b.controller.update(dt);
    } else {
      for (const b of bots) b.player.setRemoteInput({ moveX:0, moveZ:0, jump:false, punch:false, grabThrow:false, bombHeld:false });
    }

    stepPhysics(dt);
    for (const p of players) p.update(dt, camera);

    pickupManager.update(dt, camera);

    const impacts = petasanManager.update(dt, players);
    for (const hit of impacts) {
      const target = hit.player;
      if (!target || target.eliminated || target.respawning) continue;
      target.takeDamage(hit.damage);
      target.addStagger?.(Math.round(hit.damage * 0.8));
      const impulseMag = hit.magnitude ?? hit.impulse?.length?.() ?? 0;
      if (impulseMag >= PHYSICS_TUNING.knockoutImpulseThreshold && target.spawnProtection <= 0) {
        target.knockout?.(PHYSICS_TUNING.knockoutDuration);
      }
      modeManager?.onPlayerImpact?.(target, { ...hit, magnitude: impulseMag });
      if (target.hp <= 0 && !target.eliminated && !target.respawning) handlePlayerOut(target, 'hp');
    }

    // Respawn timers
    for (const [p, tmr] of [...respawnTimers.entries()]) {
      if (!p || p.eliminated || matchOver) { respawnTimers.delete(p); continue; }
      const left = tmr - dt;
      if (left <= 0) {
        respawnTimers.delete(p);
        p.respawnAt(randomSpawn(), 1.5);
        updateRoundHud();
      } else {
        respawnTimers.set(p, left);
      }
    }

    // Mode update
    if (!roundOver && !matchOver) {
      modeManager?.update?.(dt);
      checkModeRoundEnd();
    }
    updateModeHud();

    // Round transition
    if (roundOver && !matchOver && roundTransitionTimer > 0) {
      roundTransitionTimer -= dt;
      if (roundTransitionTimer <= 0) {
        roundTransitionTimer = 0;
        startNextRoundOrMatch();
      }
    }

    // Kamera follow pemain utama
    const pos = player.eliminated ? (alivePlayers()[0]?.group?.position || ARENA.spawn) : player.position;
    desiredCameraPos.set(pos.x + cameraOffset.x, pos.y + cameraOffset.y, pos.z + cameraOffset.z);
    desiredLookAt.set(pos.x + lookAtOffset.x, pos.y + lookAtOffset.y, pos.z + lookAtOffset.z);
    const followAlpha = 1 - Math.exp(-dt * 5);
    const lookAlpha = 1 - Math.exp(-dt * 7);
    camera.position.lerp(desiredCameraPos, followAlpha);
    currentLookAt.lerp(desiredLookAt, lookAlpha);
    camera.lookAt(currentLookAt);
    updateScreenShake(dt);
    camera.position.add(shakeOffset);

    if (hudStats) {
      const held = player.heldPetasan ? 'petasan' : player.carriedEntity ? (player.carriedEntity.isPlayer ? 'karakter' : 'petasan') : 'tidak';
      const ko = player.knockoutTimer > 0 ? ` | KO: ${player.knockoutTimer.toFixed(1)}s` : '';
      const remoteCount = remotes.size;
      hudStats.textContent = `HP: ${player.hp}/${player.maxHp} | Stagger: ${Math.round(player.stagger)} | Memegang: ${held}${ko} | Remote: ${remoteCount} | Bot: ${bots.length}`;
    }
    if (powerupHudEl) {
      const pu = player.powerUp;
      if (pu) {
        const label = pu.type === 'banting' ? 'Banting' : pu.type === 'renteng' ? 'Renteng' : 'Sarung Tinju';
        powerupHudEl.textContent = `Power-up: ${label} (${pu.remaining.toFixed(1)}s)`;
      } else {
        powerupHudEl.textContent = '';
      }
    }

    renderer.render(scene, camera);
  }

  requestAnimationFrame(frame);
}

bootstrap().catch((err) => {
  console.error('Gagal memulai perang-petasan:', err);
  if (overlay) {
    overlay.classList.remove('hidden');
    overlay.innerHTML = `<h1>Gagal Memuat</h1><p style="max-width:640px;padding:0 16px;text-align:center;opacity:.8">${String(err?.message || err)}</p>`;
  }
});
