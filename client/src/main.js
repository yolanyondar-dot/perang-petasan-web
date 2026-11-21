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
const overlayStatus = document.getElementById('overlay-status');
const lobbyName = document.getElementById('lobby-name');
const lobbyCode = document.getElementById('lobby-code');
const lobbyMsg = document.getElementById('lobby-msg');
const btnHost = document.getElementById('btn-host');
const btnJoin = document.getElementById('btn-join');
const btnSolo = document.getElementById('btn-solo');
const lobbyMain = document.getElementById('lobby-main');
const partyPanel = document.getElementById('party-panel');
const partyCodeEl = document.getElementById('party-code');
const partyUrlEl = document.getElementById('party-url');
const partyPlayersEl = document.getElementById('party-players');
const partyMsgEl = document.getElementById('party-msg');
const btnPartyStart = document.getElementById('btn-party-start');
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

function waitForLobby() {
  return new Promise((resolve) => {
    function setMsg(msg, ok = false) { if (lobbyMsg) { lobbyMsg.textContent = msg || ''; lobbyMsg.style.color = ok ? '#9bf6a3' : '#ffb4b4'; } }
    function cleanCode(v) { return (v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4); }
    lobbyCode?.addEventListener('input', () => { lobbyCode.value = cleanCode(lobbyCode.value); });
    btnSolo?.addEventListener('click', () => { resolve({ mode: 'solo', name: (lobbyName?.value || '').trim().slice(0, 24) || 'Pemain' }); }, { once: true });
    btnHost?.addEventListener('click', () => { resolve({ mode: 'host', name: (lobbyName?.value || '').trim().slice(0, 24) || 'Host' }); }, { once: true });
    btnJoin?.addEventListener('click', () => {
      const code = cleanCode(lobbyCode?.value || '');
      if (lobbyCode) lobbyCode.value = code;
      if (code.length !== 4) { setMsg('Masukkan kode room 4 huruf.'); return; }
      resolve({ mode: 'join', name: (lobbyName?.value || '').trim().slice(0, 24) || 'Pemain', roomCode: code });
    });
  });
}

async function bootstrap() {
  if (overlayStatus) overlayStatus.textContent = 'Mabar online - buat atau gabung room';
  const lobby = await waitForLobby();
  const playerName = lobby.name || 'Pemain';
  const netMode = lobby.mode; // 'solo' | 'host' | 'join'
  const isOnlineHost = netMode === 'host';
  const isOnlineClient = netMode === 'join';
  let localPlayerId = isOnlineClient ? null : 'host';
  let hostStateTimer = 0;
  if (overlayStatus) overlayStatus.textContent = 'Memuat fisika & arena…';
  if (lobbyMsg) lobbyMsg.textContent = '';
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
    name: playerName || 'Player',
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
  if (!isOnlineClient) {
    addBot('Dummy');
    addBot('Rival');
  }

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
    if (now.punch && !prev.punch) rp.punch(players, petasanManager.petasans);
    if (now.grabThrow && !prev.grabThrow) rp.toggleCarryOrThrow(players, petasanManager.petasans);

    // Bomb hold/release
    if (now.bombHeld && !prev.bombHeld) {
      if (!rp.heldPetasan && !rp.carriedEntity && rp.knockoutTimer <= 0 && !rp.carriedBy && entry.throwCooldown <= 0) {
        let nearest = null, nearDist = 1.6;
        const my = rp.group.position;
        for (const p of petasanManager.petasans) {
          if (!p || p.cleaned || p.exploded || p.held || p.carried) continue;
          let pt; try { pt = p.body.translation(); } catch (_) { continue; }
          const d = my.distanceTo({ x: pt.x, y: my.y, z: pt.z });
          if (d < nearDist) { nearDist = d; nearest = p; }
        }
        if (nearest) {
          rp.holdPetasan(nearest);
        } else {
          const spawnPos = rp.group.position.clone();
          spawnPos.y += 0.5;
          const type = (rp.powerUp?.type === 'banting' || rp.powerUp?.type === 'renteng') ? rp.powerUp.type : 'normal';
          const petasan = petasanManager.spawn(spawnPos, { fuse: 2.2, type });
          const held = rp.holdPetasan(petasan);
          if (!held) petasanManager.discard(petasan);
        }
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

  function serializePlayer(p, id) {
    const pos = p.group?.position || p.position;
    const q = p.group?.quaternion;
    return {
      id,
      name: p.name,
      color: p.color,
      x: pos?.x ?? 0, y: pos?.y ?? 0, z: pos?.z ?? 0,
      qx: q?.x ?? 0, qy: q?.y ?? 0, qz: q?.z ?? 0, qw: q?.w ?? 1,
      hp: p.hp, maxHp: p.maxHp, lives: p.lives, score: p.score,
      knockout: p.knockoutTimer || 0, stagger: p.stagger || 0,
      eliminated: !!p.eliminated, respawning: !!p.respawning,
      spawnProtection: p.spawnProtection || 0,
      team: p.team || null,
      powerUp: p.powerUp ? { type: p.powerUp.type, remaining: p.powerUp.remaining } : null,
      holding: !!p.heldPetasan, carrying: !!p.carriedEntity,
    };
  }

  function buildHostState() {
    const arr = [serializePlayer(player, 'host')];
    for (const [id, entry] of remotes.entries()) arr.push(serializePlayer(entry.player, id));
    for (let i = 0; i < bots.length; i++) arr.push(serializePlayer(bots[i].player, `bot:${i}`));
    return {
      players: arr,
      round: roundIndex, matchOver, roundOver, mode: modeManager?.mode, arena: arena?.type || ARENA.type,
      started: !!gameStarted,
    };
  }

  function ensureRemoteFromState(s) {
    if (!s?.id || s.id === localPlayerId) return null;
    if (String(s.id).startsWith('bot:')) {
      // bots are host-controlled; on client just create/update remote-like representation
      let entry = remotes.get(s.id);
      if (!entry) {
        const rp = createPlayer(scene, { name: s.name || 'Bot', spawn: new THREE.Vector3(s.x, s.y, s.z), color: s.color || 0x888888, isBot: true, inputEnabled: false, onRingOut: () => {}, onPunch: () => {}, onThrow: () => {}, onFuse: () => {} });
        rp.setPetasanManager(petasanManager);
        players.push(rp);
        entry = { player: rp, prev: { jump: false, punch: false, grabThrow: false, bombHeld: false }, throwCooldown: 0, isNetBot: true };
        remotes.set(s.id, entry);
      }
      return entry;
    }
    return ensureRemotePlayer(s.id, s.name);
  }

  function applyPlayerState(p, s) {
    if (!p || !s) return;
    try { p.body.setTranslation({ x: s.x, y: s.y, z: s.z }, true); } catch (_) {}
    try { p.body.setLinvel({ x: 0, y: 0, z: 0 }, true); } catch (_) {}
    if (p.group) {
      p.group.position.set(s.x, s.y, s.z);
      if (s.qw !== undefined) p.group.quaternion.set(s.qx, s.qy, s.qz, s.qw);
    }
    if (typeof s.hp === 'number') p.hp = s.hp;
    if (typeof s.maxHp === 'number') p.maxHp = s.maxHp;
    if (typeof s.lives === 'number') p.lives = s.lives;
    if (typeof s.score === 'number') p.score = s.score;
    if (typeof s.knockout === 'number') p.knockoutTimer = s.knockout;
    if (typeof s.stagger === 'number') p.stagger = s.stagger;
    if (typeof s.eliminated === 'boolean') p.eliminated = s.eliminated;
    if (typeof s.respawning === 'boolean') p.respawning = s.respawning;
    if (typeof s.spawnProtection === 'number') p.spawnProtection = s.spawnProtection;
    if (s.name) p.name = s.name;
    if (s.team !== undefined) p.team = s.team;
    p.powerUp = s.powerUp || null;
    p.group.visible = !p.eliminated;
  }

  function applyHostState(state) {
    if (!state || !Array.isArray(state.players)) return;
    const seen = new Set();
    for (const s of state.players) {
      if (!s?.id) continue;
      seen.add(s.id);
      if (s.id === localPlayerId) {
        // apply authoritative correction to own player softly? for now direct
        if (isOnlineClient) applyPlayerState(player, s);
        continue;
      }
      const entry = ensureRemoteFromState(s);
      if (entry) applyPlayerState(entry.player, s);
    }
    // remove remotes not in state (except none) - be careful not to remove local
    if (isOnlineClient) {
      for (const [id, entry] of [...remotes.entries()]) {
        if (!seen.has(id)) { removeRemote(id); }
      }
      if (typeof state.round === 'number') roundIndex = state.round;
      if (typeof state.matchOver === 'boolean') matchOver = state.matchOver;
      if (typeof state.roundOver === 'boolean') roundOver = state.roundOver;
      if (state.started) {
        gameStarted = true;
        overlay?.classList.add('hidden');
      }
      updateRoundHud();
      updateModeHud();
    }
  }

  // --- Network -------------------------------------------------------------
  let resolvePartyStart = null;
  let gameStarted = !isOnlineHost;
  const partyStartPromise = isOnlineHost ? new Promise((r) => { resolvePartyStart = r; }) : Promise.resolve();
  function refreshPartyUI() {
    if (!partyPanel) return;
    if (partyCodeEl) partyCodeEl.textContent = network.roomCode || lobby.roomCode || '----';
    if (partyUrlEl) partyUrlEl.textContent = `${location.origin}${location.pathname}`;
    if (partyPlayersEl) {
      const items = [`<div>👑 ${playerName} (Host)</div>`];
      for (const [, entry] of remotes.entries()) {
        const n = entry?.player?.name || 'Pemain';
        items.push(`<div>🎮 ${n}</div>`);
      }
      partyPlayersEl.innerHTML = items.join('');
    }
  }
  btnPartyStart?.addEventListener('click', () => {
    gameStarted = true;
    if (resolvePartyStart) { resolvePartyStart(); resolvePartyStart = null; }
  });

  const network = createNetwork({
    onRoomCreated: ({ roomCode, controllerUrl }) => {
      if (roomCodeEl) roomCodeEl.textContent = roomCode;
      if (roomUrlEl) {
        roomUrlEl.innerHTML = `Kode room: <b>${roomCode}</b><br>Buka <b>${controllerUrl}</b> di HP (Wi-Fi sama)<br><span class="muted">Mode: online host</span>`;
      }
      if (isOnlineHost) {
        if (overlayStatus) overlayStatus.textContent = 'Party dibuat! Bagikan kode ke teman.';
        if (lobbyMain) lobbyMain.style.display = 'none';
        if (partyPanel) partyPanel.style.display = 'block';
        refreshPartyUI();
      }
    },
    onJoinedRoom: (msg) => {
      if (isOnlineClient) {
        localPlayerId = msg.playerId || msg.controllerId || localPlayerId;
        if (roomCodeEl) roomCodeEl.textContent = msg.roomCode || lobby.roomCode || '-';
        if (roomUrlEl) roomUrlEl.innerHTML = `Terhubung ke room <b>${msg.roomCode || lobby.roomCode}</b><br><span class="muted">Mode: online player</span>`;
        if (overlayStatus) overlayStatus.textContent = 'Terhubung! Menunggu game...';
        if (lobbyMain) lobbyMain.style.display = 'none';
        if (partyPanel) {
          partyPanel.style.display = 'block';
          if (partyCodeEl) partyCodeEl.textContent = msg.roomCode || lobby.roomCode || '----';
          if (partyMsgEl) partyMsgEl.textContent = 'Terhubung. Menunggu host memulai...';
          const startBtn = document.getElementById('btn-party-start');
          if (startBtn) { startBtn.style.display = 'none'; }
        }
        // wait for host to start (state.started)
      }
    },
    onJoinError: (msg) => {
      if (isOnlineClient) {
        if (overlayStatus) overlayStatus.textContent = 'Gagal gabung room';
        if (lobbyMsg) { lobbyMsg.textContent = msg?.message || 'Gagal bergabung ke room.'; lobbyMsg.style.color = '#ffb4b4'; }
        if (lobbyMain) lobbyMain.style.display = 'block';
        if (partyPanel) partyPanel.style.display = 'none';
        overlay?.classList.remove('hidden');
      }
    },
    onStatus: (s) => {
      if (!s.connected && roomUrlEl && !network.roomCode && !isOnlineClient) {
        roomUrlEl.textContent = `Server belum terhubung (${s.error || s.reason || network.serverUrl}).`;
      }
      if (isOnlineClient && !s.connected && localPlayerId) {
        if (roomUrlEl) roomUrlEl.textContent = `Koneksi terputus (${s.reason || 'disconnected'}). Coba refresh.`;
      }
    },
    onPlayerJoined: ({ controllerId, playerId, name, kind }) => {
      const id = playerId || controllerId;
      if (!id) return;
      ensureRemotePlayer(id, name || 'Pemain');
      if (roomUrlEl && isOnlineHost) roomUrlEl.innerHTML = `Kode room: <b>${network.roomCode || '-'}</b><br><span class="muted">${remotes.size} pemain remote terhubung</span>`;
      refreshPartyUI();
    },
    onPlayerInput: ({ controllerId, playerId, state, kind }) => {
      const id = playerId || controllerId;
      if (!id) return;
      if (!remotes.has(id)) ensureRemotePlayer(id, 'Pemain');
      handleRemoteInput(id, state || {});
    },
    onPlayerLeft: ({ controllerId, playerId }) => {
      const id = playerId || controllerId;
      if (id) removeRemote(id);
      refreshPartyUI();
    },
    onRoomClosed: () => {
      if (isOnlineClient) {
        if (roomUrlEl) roomUrlEl.textContent = 'Room ditutup host.';
        if (overlayStatus) overlayStatus.textContent = 'Room ditutup host.';
        overlay?.classList.remove('hidden');
      }
    },
    onGameState: (msg) => {
      if (isOnlineClient) applyHostState(msg?.state);
    },
  });

  if (isOnlineHost) {
    network.connect({ mode: 'host' });
  } else if (isOnlineClient) {
    network.connect({ mode: 'player', roomCode: lobby.roomCode, name: playerName, reconnect: false });
  }

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
  const keyState = new Set();
  let mouseBomb = false;
  let mousePunch = false;
  let touchMoveX = 0, touchMoveZ = 0, touchJump = false, touchPunch = false, touchGrab = false, touchBomb = false;
  window.addEventListener('keydown', (e) => keyState.add(e.code));
  window.addEventListener('keyup', (e) => keyState.delete(e.code));
  function getLocalInputState() {
    const kx = (keyState.has('KeyD') || keyState.has('ArrowRight') ? 1 : 0) - (keyState.has('KeyA') || keyState.has('ArrowLeft') ? 1 : 0);
    const kz = (keyState.has('KeyW') || keyState.has('ArrowUp') ? 1 : 0) - (keyState.has('KeyS') || keyState.has('ArrowDown') ? 1 : 0);
    return {
      moveX: Math.max(-1, Math.min(1, kx + touchMoveX)),
      moveZ: Math.max(-1, Math.min(1, kz + touchMoveZ)),
      jump: keyState.has('Space') || touchJump,
      punch: keyState.has('KeyF') || mousePunch || touchPunch,
      grabThrow: keyState.has('KeyQ') || keyState.has('ShiftLeft') || keyState.has('ShiftRight') || touchGrab,
      bombHeld: keyState.has('KeyE') || mouseBomb || touchBomb,
    };
  }

  function trySpawnAndHold() {
    if (throwCooldown > 0 || matchOver || roundOver || player.eliminated) return;
    if (player.heldPetasan || player.carriedEntity) return;
    if (player.knockoutTimer > 0 || player.carriedBy) return;
    // BombSquad-like: pick up nearby loose bomb first
    let nearest = null, nearDist = 1.6;
    const my = player.group.position;
    for (const p of petasanManager.petasans) {
      if (!p || p.cleaned || p.exploded || p.held || p.carried) continue;
      let pt; try { pt = p.body.translation(); } catch (_) { continue; }
      const d = my.distanceTo({ x: pt.x, y: my.y, z: pt.z });
      if (d < nearDist) { nearDist = d; nearest = p; }
    }
    if (nearest) { const held = player.holdPetasan(nearest); if (held) return; }
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
    if (e.code === 'KeyE') { e.preventDefault(); if (!e.repeat && !isOnlineClient) trySpawnAndHold(); }
    if (e.code === 'KeyF') { e.preventDefault(); if (!e.repeat && !isOnlineClient && !matchOver && !roundOver && !player.eliminated) player.punch(players, petasanManager.petasans); }
    if (e.code === 'KeyQ' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') { e.preventDefault(); if (!e.repeat && !isOnlineClient && !matchOver && !roundOver && !player.eliminated) player.toggleCarryOrThrow(players, petasanManager.petasans); }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'KeyE') { e.preventDefault(); if (!isOnlineClient) tryThrowHeld(); }
  });

  const canvas = renderer.domElement;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    if (e.target !== canvas) return;
    canvas.setPointerCapture?.(e.pointerId);
    if (e.button === 0) { mouseBomb = true; if (!isOnlineClient) trySpawnAndHold(); }
    else if (e.button === 2) { mousePunch = true; if (!isOnlineClient && !matchOver && !roundOver && !player.eliminated) player.punch(players, petasanManager.petasans); }
  });
  canvas.addEventListener('pointerup', (e) => {
    if (e.button === 0) { mouseBomb = false; if (!isOnlineClient) tryThrowHeld(); }
    if (e.button === 2) { mousePunch = false; }
  });
  window.addEventListener('pointerup', (e) => {
    if (e.button === 0) { mouseBomb = false; if (e.target !== canvas && !isOnlineClient) tryThrowHeld(); }
    if (e.button === 2) { mousePunch = false; }
  });

  // --- Touch controls (virtual joystick + MOBA buttons) --------------------
  const touchControls = document.getElementById('touch-controls');
  const tcJoyBase = document.getElementById('tc-joy-base');
  const tcJoyKnob = document.getElementById('tc-joy-knob');
  function showTouchControls(show) { touchControls?.classList.toggle('show', !!show); }
  if (tcJoyBase && tcJoyKnob) {
    let joyPointer = null, joyCenter = { x: 0, y: 0 }, joyRadius = 1;
    const resetJoy = () => { touchMoveX = 0; touchMoveZ = 0; tcJoyKnob.style.transform = 'translate(-50%, -50%)'; };
    const updateJoy = (cx, cy) => {
      const dx = cx - joyCenter.x, dy = cy - joyCenter.y;
      const max = joyRadius * 0.38, dist = Math.hypot(dx, dy), clamped = dist > max ? max / dist : 1;
      const kx = dx * clamped, ky = dy * clamped;
      tcJoyKnob.style.transform = `translate(calc(-50% + ${kx}px), calc(-50% + ${ky}px))`;
      touchMoveX = Math.max(-1, Math.min(1, kx / max));
      touchMoveZ = Math.max(-1, Math.min(1, -ky / max));
    };
    tcJoyBase.addEventListener('pointerdown', (e) => { e.preventDefault(); joyPointer = e.pointerId; tcJoyBase.setPointerCapture(e.pointerId); const r = tcJoyBase.getBoundingClientRect(); joyCenter = { x: r.left + r.width / 2, y: r.top + r.height / 2 }; joyRadius = r.width / 2; updateJoy(e.clientX, e.clientY); });
    tcJoyBase.addEventListener('pointermove', (e) => { if (e.pointerId !== joyPointer) return; e.preventDefault(); updateJoy(e.clientX, e.clientY); });
    const joyEnd = (e) => { if (e.pointerId !== joyPointer) return; joyPointer = null; resetJoy(); };
    tcJoyBase.addEventListener('pointerup', joyEnd); tcJoyBase.addEventListener('pointercancel', joyEnd);
  }
  function bindTcBtn(id, onDown, onUp) {
    const el = document.getElementById(id); if (!el) return;
    let ptr = null;
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); ptr = e.pointerId; el.setPointerCapture?.(e.pointerId); el.classList.add('active'); onDown(); });
    const end = (e) => { if (ptr !== null && e.pointerId !== ptr) return; ptr = null; el.classList.remove('active'); onUp(); };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end); el.addEventListener('pointerleave', (e) => { if (ptr !== null) end(e); });
  }
  bindTcBtn('tc-jump', () => { touchJump = true; }, () => { touchJump = false; });
  bindTcBtn('tc-punch', () => { touchPunch = true; if (!isOnlineClient && !matchOver && !roundOver && !player.eliminated) player.punch(players, petasanManager.petasans); }, () => { touchPunch = false; });
  bindTcBtn('tc-grab', () => { touchGrab = true; if (!isOnlineClient && !matchOver && !roundOver && !player.eliminated) player.toggleCarryOrThrow(players, petasanManager.petasans); }, () => { touchGrab = false; });
  bindTcBtn('tc-bomb', () => { touchBomb = true; if (!isOnlineClient) trySpawnAndHold(); }, () => { touchBomb = false; if (!isOnlineClient) tryThrowHeld(); });
  showTouchControls(true);

  // --- Settings menu / control layout --------------------------------------
  const settingsBtn = document.getElementById('settings-btn');
  const settingsMenu = document.getElementById('settings-menu');
  const menuSound = document.getElementById('menu-sound');
  const menuControls = document.getElementById('menu-controls');
  const menuExit = document.getElementById('menu-exit');
  const ctlPanel = document.getElementById('controls-settings');
  const ctlJoy = document.getElementById('ctl-joy-size');
  const ctlBtnSize = document.getElementById('ctl-btn-size');
  const ctlBottom = document.getElementById('ctl-bottom');
  const ctlSide = document.getElementById('ctl-side');
  const ctlReset = document.getElementById('ctl-reset');
  const ctlClose = document.getElementById('ctl-close');
  const CTL_KEY = 'pp_touch_layout_v1';
  function applyControlLayout(cfg) {
    const joy = Math.max(90, Math.min(220, Number(cfg.joy) || 150));
    const btn = Math.max(70, Math.min(140, Number(cfg.btn) || 100));
    const bottom = Math.max(0, Math.min(80, Number(cfg.bottom) || 24));
    const side = Math.max(0, Math.min(80, Number(cfg.side) || 24));
    const joyBase = document.getElementById('tc-joy-base');
    const cluster = document.querySelector('.tc-cluster');
    const joyZone = document.getElementById('tc-joy-zone');
    const actZone = document.getElementById('tc-actions');
    if (joyBase) { joyBase.style.width = joy + 'px'; joyBase.style.maxWidth = joy + 'px'; }
    if (cluster) { cluster.style.width = Math.round(joy * 1.35) + 'px'; cluster.style.maxWidth = Math.round(joy * 1.35) + 'px'; }
    if (joyZone) { joyZone.style.padding = `0 0 ${bottom}px ${side}px`; }
    if (actZone) { actZone.style.padding = `0 ${side}px ${bottom}px 0`; }
    document.querySelectorAll('.tc-skill').forEach((el) => { el.style.width = Math.round(btn * 0.25) + '%'; });
    document.getElementById('tc-punch')?.style.setProperty('width', Math.round(btn * 0.44) + '%');
    if (ctlJoy) ctlJoy.value = String(joy);
    if (ctlBtnSize) ctlBtnSize.value = String(btn);
    if (ctlBottom) ctlBottom.value = String(bottom);
    if (ctlSide) ctlSide.value = String(side);
    try { localStorage.setItem(CTL_KEY, JSON.stringify({ joy, btn, bottom, side })); } catch (_) {}
  }
  function loadControlLayout() {
    try { const raw = localStorage.getItem(CTL_KEY); if (raw) return JSON.parse(raw); } catch (_) {}
    return { joy: 150, btn: 100, bottom: 24, side: 24 };
  }
  function syncSoundLabel() { if (menuSound) menuSound.textContent = Audio.isMuted() ? '🔇 Suara: Mati' : '🔊 Suara: Nyala'; }
  applyControlLayout(loadControlLayout());
  syncSoundLabel();
  settingsBtn?.addEventListener('click', () => {
    const open = settingsMenu?.style.display !== 'none';
    if (settingsMenu) settingsMenu.style.display = open ? 'none' : 'block';
    if (ctlPanel) ctlPanel.style.display = 'none';
  });
  menuSound?.addEventListener('click', () => { Audio.toggleMute(); syncSoundLabel(); });
  menuControls?.addEventListener('click', () => { if (settingsMenu) settingsMenu.style.display = 'none'; if (ctlPanel) ctlPanel.style.display = 'block'; });
  menuExit?.addEventListener('click', () => { window.location.href = window.location.origin + window.location.pathname; });
  ctlClose?.addEventListener('click', () => { if (ctlPanel) ctlPanel.style.display = 'none'; });
  ctlReset?.addEventListener('click', () => applyControlLayout({ joy: 150, btn: 100, bottom: 24, side: 24 }));
  const onCtl = () => applyControlLayout({ joy: ctlJoy?.value, btn: ctlBtnSize?.value, bottom: ctlBottom?.value, side: ctlSide?.value });
  ctlJoy?.addEventListener('input', onCtl); ctlBtnSize?.addEventListener('input', onCtl); ctlBottom?.addEventListener('input', onCtl); ctlSide?.addEventListener('input', onCtl);

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
  if (isOnlineClient) {
    if (overlayStatus) overlayStatus.textContent = `Menghubungkan ke room ${lobby.roomCode}...`;
    overlay?.classList.remove('hidden');
  } else if (isOnlineHost) {
    if (overlayStatus) overlayStatus.textContent = 'Membuat party...';
    if (lobbyMain) lobbyMain.style.display = 'none';
    if (partyPanel) partyPanel.style.display = 'block';
    if (partyMsgEl) partyMsgEl.textContent = 'Menunggu room dibuat...';
    overlay?.classList.remove('hidden');
    await partyStartPromise;
    overlay?.classList.add('hidden');
    showRoundBanner('Ronde 1', 'Party dimulai!', 1500);
  } else {
    overlay?.classList.add('hidden');
    showRoundBanner('Ronde 1', 'Siap bertarung!', 1500);
  }
  if (!isOnlineClient) resetMatch(); else updateRoundHud();

  function frame() {
    requestAnimationFrame(frame);
    const rawDt = clock.getDelta();
    const dt = Math.min(rawDt, MAX_PHYSICS_DT);
    throwCooldown = Math.max(0, throwCooldown - dt);
    for (const entry of remotes.values()) entry.throwCooldown = Math.max(0, entry.throwCooldown - dt);

    const localInput = getLocalInputState();
    player.setRemoteInput(localInput);
    if (isOnlineClient && network.connected) {
      network.send({ type: 'player-input', state: localInput });
    }

    if (!isOnlineClient) {
      if (!matchOver && !roundOver) {
        for (const b of bots) b.controller.update(dt);
      } else {
        for (const b of bots) b.player.setRemoteInput({ moveX:0, moveZ:0, jump:false, punch:false, grabThrow:false, bombHeld:false });
      }
    }

    stepPhysics(dt);
    for (const p of players) p.update(dt, camera);

    pickupManager.update(dt, camera);

    const impacts = petasanManager.update(dt, players);
    if (!isOnlineClient) {
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
    }

    if (!isOnlineClient) {
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
    } else {
      updateModeHud();
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

    if (isOnlineHost && network.connected) {
      hostStateTimer += dt;
      if (hostStateTimer >= 0.1) {
        hostStateTimer = 0;
        network.send({ type: 'game-state', state: buildHostState() });
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
