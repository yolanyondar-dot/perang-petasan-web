import { Terrain, MAP_LIST } from './terrain.js';
import { Character } from './character.js';
import { ExplosionFX, SKILLS, spawnProjectiles, simulateTrajectory } from './petasan.js';
import { MobaControls } from './mobaControls.js';
import { CHARACTER_LIST, getCharacter } from './charactersConfig.js';
import { PickupManager } from './pickup2d.js';
import { createNetwork } from './network.js';
import { createUIScreens } from './uiScreens.js';
import { preloadAssets, getFxImage } from './assetLoader.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const W = canvas.width;
const H = canvas.height;
const windEl = document.getElementById('wind');
const statusEl = document.getElementById('status');

let terrain, player, bots = [], projectiles = [], effects = [], smokes = [], delayed = [];
let wind = 0, windTarget = 0, windTimer = 0;
let msg = '', msgTimer = 0, gameOver = false, restartTimer = 0;
let selectedCharId = 'udin';
let selectedMapId = 'kampung_festival';
const pickups = new PickupManager();

// --- networking ---
let netMode = 'local'; // local | host | player
let hostRoomCode = null;
let myPlayerId = null;
let remoteInputs = new Map(); // playerId -> {state, lastFireSeq}
let remoteCharIds = new Map(); // playerId -> charId
let remoteNames = new Map(); // playerId -> name
let pendingCraters = [];
let stateSendAcc = 0;
let inputSeq = 0;
let lastSentInput = '';
let jumpQueued = false;
let waitingRoom = false;
let controls = null;
let network = null;

const ui = createUIScreens({
  onScreenChange: (name) => {
    const playing = name === 'playing';
    controls?.setEnabled(playing);
  },
  onLogin: (name) => { ui.state.playerName = name; },
  onCharSelect: (id) => {
    selectedCharId = id;
    if (netMode === 'player' && network.connected) network.send({ type: 'player-hello', charId: selectedCharId, name: ui.getPlayerName() });
  },
  onMapSelect: (id) => { selectedMapId = id; },
  onPlayBot: ({ charId, mapId, name, costumeColor }) => {
    selectedCharId = charId; selectedMapId = mapId;
    if (costumeColor) ui.state.costumeColor = costumeColor;
    netMode = 'local'; waitingRoom = false; hostRoomCode = null; myPlayerId = null;
    remoteInputs.clear(); remoteCharIds.clear(); remoteNames.clear();
    network.disconnect();
    spawnWorld();
    ui.show('playing');
  },
  onCreateRoom: ({ charId, mapId, name, costumeColor }) => {
    selectedCharId = charId; selectedMapId = mapId;
    if (costumeColor) ui.state.costumeColor = costumeColor;
    netMode = 'host'; waitingRoom = true; hostRoomCode = null; myPlayerId = null;
    remoteInputs.clear(); remoteCharIds.clear(); remoteNames.clear();
    spawnWorld();
    ui.setRoom(null, true);
    ui.setPlayers(buildWaitingPlayers());
    ui.setWaitingStatus('Membuat room...');
    ui.show('waiting');
    controls.setEnabled(false);
    network.connect({ mode: 'host', reconnect: true });
  },
  onJoinRoom: ({ code, charId, name, costumeColor }) => {
    selectedCharId = charId;
    if (costumeColor) ui.state.costumeColor = costumeColor;
    netMode = 'player'; waitingRoom = true; hostRoomCode = code; myPlayerId = null;
    remoteInputs.clear(); remoteCharIds.clear(); remoteNames.clear();
    ui.setRoom(code, false);
    ui.setPlayers([{ name: ui.getPlayerName(), charId: selectedCharId, isMe: true, isHost: false }]);
    ui.setWaitingStatus(`Menghubungkan ke ${code}...`);
    ui.show('waiting');
    controls.setEnabled(false);
    network.connect({ mode: 'player', roomCode: code, name: ui.getPlayerName(), color: '#4fc3f7', charId: selectedCharId, reconnect: false });
  },
  onStartGame: () => {
    if (netMode !== 'host') return;
    waitingRoom = false;
    spawnWorld();
    ui.show('playing');
    broadcastState(true);
  },
  onAddBot: () => {
    if (netMode !== 'host') return;
    // ensure at least one bot exists; if all slots remote, ignore
    const hasBot = bots.some(b => b.isBot && !b.isRemote);
    if (!hasBot) {
      const slot = bots.findIndex(b => b.isRemote);
      if (slot < 0) { ui.setWaitingStatus('Slot penuh.'); return; }
      // replace first remote? no, better don't. Just inform.
      ui.setWaitingStatus('Slot sudah terisi pemain.');
    } else {
      ui.setWaitingStatus('Bot sudah tersedia.');
    }
    ui.setPlayers(buildWaitingPlayers());
  },
  onLeaveRoom: () => {
    network.disconnect();
    netMode = 'local'; waitingRoom = false; hostRoomCode = null; myPlayerId = null;
    remoteInputs.clear(); remoteCharIds.clear(); remoteNames.clear();
    ui.setLobbyStatus('');
    ui.show('lobby');
  },
  onMenu: () => {
    if (netMode === 'host' && network.connected) {
      waitingRoom = true;
      controls.setEnabled(false);
      ui.setPlayers(buildWaitingPlayers());
      ui.show('waiting');
    } else if (netMode === 'player' && network.connected) {
      waitingRoom = true;
      controls.setEnabled(false);
      ui.show('waiting');
    } else {
      network.disconnect();
      netMode = 'local'; waitingRoom = false;
      ui.show('lobby');
    }
  },
  onAssetChanged: ({ kind, id, name }) => {
    if (kind === 'map' && terrain && id === terrain.mapId) {
      // terrain image affects collision canvas; background/overlay are drawn live
      if (name === 'terrain') terrain.generate();
    }
    // refresh lobby thumbnails/waiting previews by re-rendering
    if (ui.state.screen === 'lobby') ui.renderMaps();
  },
});

// Keep ui state in sync
ui.state.charId = selectedCharId;
ui.state.mapId = selectedMapId;

function buildWaitingPlayers() {
  const list = [{ name: ui.getPlayerName(), charId: selectedCharId, isHost: true, isMe: true }];
  for (const [pid, charId] of remoteCharIds.entries()) {
    list.push({ name: remoteNames.get(pid) || 'Player', charId, isHost: false, isMe: false });
  }
  for (const b of bots) {
    if (b.isBot && !b.isRemote) list.push({ name: b.name, charId: b.charId, isHost: false, isBot: true });
  }
  return list;
}

controls = new MobaControls(document.body, {
  onFire: (type, angleDeg, power) => handleLocalFire(type, angleDeg, power),
  onJump: () => {
    jumpQueued = true;
    if (player?.alive && netMode !== 'player') player.jump();
  },
  getAimDefaults: () => {
    const p = player;
    if (!p) return { angle: 45, power: 65, facing: 1 };
    const target = nearestEnemy(p);
    const facing = target ? (target.x >= p.x ? 1 : -1) : p.facing;
    if (netMode !== 'player') p.facing = facing;
    return { angle: p.aimAngle || 45, power: p.aimPower || 65, facing };
  },
});
controls.setEnabled(ui.state.screen === 'playing');

network = createNetwork({
  onStatus: (s) => {
    if (netMode === 'host') ui.setWaitingStatus(s.connected ? `Host terhubung. Kode: ${hostRoomCode || '...'}` : (s.error || s.reason || 'Terputus'));
    else if (netMode === 'player') ui.setWaitingStatus(s.connected ? `Terhubung ke room ${hostRoomCode || ''}.` : (s.error || s.reason || 'Terputus'));
  },
  onRoomCreated: ({ roomCode }) => {
    hostRoomCode = roomCode;
    ui.setRoom(roomCode, true);
    ui.setPlayers(buildWaitingPlayers());
    ui.setWaitingStatus('Room dibuat. Bagikan kode ke teman.');
  },
  onJoinedRoom: (m) => {
    myPlayerId = m.playerId || null;
    hostRoomCode = m.roomCode || hostRoomCode;
    ui.setRoom(hostRoomCode, false);
    ui.setWaitingStatus('Masuk room. Menunggu host memulai...');
    network.send({ type: 'player-hello', charId: selectedCharId, name: ui.getPlayerName() });
  },
  onJoinError: (m) => {
    ui.setLobbyStatus(m.message || 'Gagal join room.');
    netMode = 'local'; waitingRoom = false;
    network.disconnect();
    ui.show('lobby');
  },
  onPlayerJoined: (m) => {
    if (netMode !== 'host') return;
    const pid = m.playerId || m.controllerId;
    if (!pid) return;
    const charId = getCharacter(m.characterType || m.charId || 'udin').id;
    remoteCharIds.set(pid, charId);
    remoteNames.set(pid, (m.name || 'Player').slice(0,14));
    remoteInputs.set(pid, { state: defaultInput(), lastFireSeq: 0 });
    addRemotePlayer(pid, remoteNames.get(pid), charId);
    ui.setPlayers(buildWaitingPlayers());
    ui.setWaitingStatus(`${remoteNames.get(pid)} masuk room.`);
    broadcastLobbyState();
  },
  onPlayerHello: (m) => {
    if (netMode !== 'host') return;
    const pid = m.playerId || m.controllerId;
    if (!pid) return;
    const charId = getCharacter(m.charId || m.characterType || 'udin').id;
    remoteCharIds.set(pid, charId);
    remoteNames.set(pid, (m.name || remoteNames.get(pid) || 'Player').slice(0,14));
    const rp = bots.find(b => b.netId === pid);
    if (rp) {
      const def = getCharacter(charId);
      rp.charId = def.id; rp.charDef = def; rp.skin = def.skin; rp.color = def.color; rp.name = remoteNames.get(pid);
    }
    ui.setPlayers(buildWaitingPlayers());
    broadcastLobbyState();
  },
  onPlayerInput: (m) => {
    if (netMode !== 'host') return;
    const pid = m.playerId || m.controllerId;
    if (!pid) return;
    const prev = remoteInputs.get(pid) || { state: defaultInput(), lastFireSeq: 0 };
    prev.state = { ...defaultInput(), ...(m.state || {}) };
    remoteInputs.set(pid, prev);
  },
  onPlayerLeft: (m) => {
    if (netMode !== 'host') return;
    const pid = m.playerId || m.controllerId;
    remoteInputs.delete(pid); remoteCharIds.delete(pid); remoteNames.delete(pid);
    removeRemotePlayer(pid);
    ui.setPlayers(buildWaitingPlayers());
    ui.setWaitingStatus('Pemain keluar.');
    broadcastLobbyState();
  },
  onRoomClosed: () => {
    ui.setLobbyStatus('Room ditutup host.');
    netMode = 'local'; waitingRoom = false; hostRoomCode = null; myPlayerId = null;
    remoteInputs.clear(); remoteCharIds.clear(); remoteNames.clear();
    network.disconnect();
    ui.show('lobby');
  },
  onGameState: (m) => {
    if (netMode !== 'player') return;
    const s = m.state;
    if (s?.lobby) {
      waitingRoom = true;
      ui.setRoom(s.roomCode || hostRoomCode, false);
      if (Array.isArray(s.players)) ui.setPlayers(s.players);
      if (s.mapId) { selectedMapId = s.mapId; ui.state.mapId = s.mapId; }
      ui.setWaitingStatus(s.msg || 'Menunggu host memulai...');
      if (ui.state.screen !== 'waiting') ui.show('waiting');
      return;
    }
    if (waitingRoom) { waitingRoom = false; ui.show('playing'); controls.setEnabled(true); }
    applyGameState(s);
  },
});

function defaultInput() {
  return { moveX: 0, jump: false, aimAngle: 45, aimPower: 60, aimFacing: 1, aimActive: false, fire: null, fireAngle: 45, firePower: 60, seq: 0 };
}

function collectLocalInput() {
  const cs = controls.getState();
  const j = jumpQueued;
  jumpQueued = false;
  return {
    moveX: cs.moveX || 0,
    jump: j,
    aimAngle: cs.aimActive ? cs.aimAngle : (player?.aimAngle || 45),
    aimPower: cs.aimActive ? cs.aimPower : (player?.aimPower || 60),
    aimFacing: cs.aimActive ? cs.aimFacing : (player?.facing || 1),
    aimActive: !!cs.aimActive,
  };
}

function spawnExplosion(x, y, cfg, owner, type = 'basic') {
  terrain.carveCrater(x, y, cfg.radius);
  pendingCraters.push({ x, y, r: cfg.radius });
  const chars = [player, ...bots];
  for (const c of chars) {
    if (!c.alive || c.eliminated) continue;
    const dx = c.centerX - x, dy = c.centerY - y;
    const dist = Math.hypot(dx, dy);
    const maxD = cfg.radius + 24;
    if (dist < maxD) {
      const t = 1 - dist / maxD;
      const dmg = Math.round((cfg.damage || 20) * (0.35 + 0.65 * t));
      const nx = dist > 0.001 ? dx / dist : 0;
      const ny = dist > 0.001 ? dy / dist : -1;
      const k = (cfg.knock || 200) * t;
      c.takeDamage(dmg, nx * k, ny * k - k * 0.35);
    }
  }
  effects.push(new ExplosionFX(x, y, cfg.radius, type));
}

function scheduleSpecials(result) {
  const cfg = result.cfg || {};
  const x = result.x, y = result.y;
  const owner = result.owner;
  if (cfg.burst) {
    for (let i = 0; i < cfg.burst.count; i++) {
      const ox = (Math.random() - 0.5) * 50;
      const oy = (Math.random() - 0.5) * 20;
      delayed.push({ t: (i + 1) * cfg.burst.interval, fn: () => spawnExplosion(x + ox, y + oy, cfg.burst, owner, 'skill1') });
    }
  }
  if (cfg.rain) {
    for (let i = 0; i < cfg.rain.count; i++) {
      const ox = (i - (cfg.rain.count - 1) / 2) * (cfg.rain.spread / Math.max(1, cfg.rain.count - 1)) + (Math.random() - 0.5) * 20;
      delayed.push({ t: 0.15 + i * cfg.rain.delay, fn: () => spawnExplosion(x + ox, y - 30 - Math.random() * 30, cfg.rain, owner, 'ulti') });
    }
  }
  if (cfg.chain) {
    const dir = (result.vxAtImpact ?? (owner?.facing || 1)) >= 0 ? 1 : -1;
    for (let i = 0; i < cfg.chain.count; i++) {
      const ox = dir * cfg.chain.spacing * (i + 1);
      delayed.push({ t: (i + 1) * cfg.chain.delay, fn: () => {
        const gy = terrain.findSurfaceY(x + ox, Math.max(0, y - 80));
        spawnExplosion(x + ox, Math.min(y, gy - 5), cfg.chain, owner, 'ulti');
      }});
    }
  }
  if (cfg.smoke) {
    smokes.push({ x, y, r: cfg.smoke.radius, age: 0, duration: cfg.smoke.duration });
  }
}

function fireWeapon(char, type, angleDeg, power) {
  if (!char?.alive || char.eliminated || gameOver) return;
  const skillDef = getSkillDef(char, type) || { type: 'projectile', projectile: SKILLS[type] || SKILLS.basic, name: type, cooldown: 0.5 };
  if (type === 'ulti' && char.energy < 100) return;
  if (type === 'ulti') char.energy = 0;
  char.aimAngle = angleDeg; char.aimPower = power;
  char.triggerThrow();
  if (skillDef.type === 'buff') {
    char.applyBuff(skillDef.buff || { duration: 3, damageMul: 0.5, knockMul: 0.5 });
    showMsg(char.name + ': ' + skillDef.name + '!', 1.1);
    return;
  }
  if (skillDef.type === 'dash_jump') {
    const d = skillDef.dash || {};
    const dir = char.facing;
    char.vx = (d.vx || 300) * dir;
    char.vy = d.vy || -600;
    char.onGround = false;
    char.pendingLandingExplosion = { radius: d.landingRadius || 40, damage: d.landingDamage || 20, knock: d.landingKnock || 240, owner: char };
    showMsg(char.name + ': ' + skillDef.name + '!', 1.1);
    return;
  }
  const pcfg = skillDef.projectile || SKILLS[type] || SKILLS.basic;
  const o = char.getAimOrigin();
  const projs = spawnProjectiles({ x: o.x, y: o.y, angleDeg, power, facing: char.facing, wind, owner: char, type, cfg: pcfg });
  projectiles.push(...projs);
  if (type !== 'basic') showMsg(char.name + ': ' + skillDef.name + '!', 1.1);
}

function handleLocalFire(type, angleDeg, power) {
  if (netMode === 'player') {
    inputSeq++;
    network.send({ type: 'player-input', state: { ...collectLocalInput(), fire: type, fireAngle: angleDeg, firePower: power, seq: inputSeq } });
    if (type !== 'ulti') controls.cooldowns[type] = controls.cooldownMax[type];
    return;
  }
  fireWeapon(player, type, angleDeg, power);
}

function addRemotePlayer(pid, name, charId) {
  const def = getCharacter(charId);
  const spawns = terrain.spawns.length ? terrain.spawns : [{x:180,y:terrain.findSurfaceY(180)},{x:W-220,y:terrain.findSurfaceY(W-220)},{x:W-420,y:terrain.findSurfaceY(W-420)}];
  const spawnIdx = Math.min(bots.length + 1, spawns.length - 1);
  const s = spawns[spawnIdx] || spawns[spawns.length - 1];
  const rp = new Character({ x: s.x, y: s.y, name: (name||def.short).slice(0,14), color: def.color, facing: -1, isBot: false, charId: def.id, skin: def.skin, charDef: def });
  rp.netId = pid; rp.isRemote = true; rp.ai = null;
  const botIdx = bots.findIndex(b => b.isBot && !b.isRemote);
  if (botIdx >= 0) bots[botIdx] = rp; else bots.push(rp);
}

function removeRemotePlayer(pid) {
  const idx = bots.findIndex(b => b.netId === pid);
  if (idx >= 0) {
    const def = getCharacter(CHARACTER_LIST[idx % CHARACTER_LIST.length].id);
    const spawns = terrain.spawns;
    const s = spawns[Math.min(idx + 1, spawns.length - 1)] || { x: W - 220, y: terrain.findSurfaceY(W - 220) };
    const b = new Character({ x: s.x, y: s.y, name: def.short, color: def.color, facing: -1, isBot: true, charId: def.id, skin: def.skin, charDef: def });
    b.ai = { shootCd: 1.5 + Math.random() * 0.8, moveCd: 0, moveDir: 0, jumpCd: 2 + Math.random() * 2 };
    bots[idx] = b;
  }
}

function spawnWorld() {
  terrain = new Terrain(W, H, selectedMapId);
  projectiles = []; effects = []; smokes = []; delayed = [];
  pickups.reset(); pendingCraters = [];
  wind = 0; windTarget = 0; windTimer = 2;
  gameOver = false; restartTimer = 0;
  const pDef = getCharacter(selectedCharId);
  const spawns = terrain.spawns.length ? terrain.spawns : [{x:180,y:terrain.findSurfaceY(180)},{x:W-220,y:terrain.findSurfaceY(W-220)},{x:W-420,y:terrain.findSurfaceY(W-420)}];
  const pSpawn = spawns[0];
  const pColor = ui.state.costumeColor || pDef.color;
  player = new Character({ x: pSpawn.x, y: pSpawn.y, name: ui.getPlayerName() || pDef.short, color: pColor, facing: 1, isBot: false, charId: pDef.id, skin: { ...pDef.skin, shirt: pColor }, charDef: pDef });
  player.isLocal = true;
  controls.setCharacter(pDef);
  const botIds = CHARACTER_LIST.map(c => c.id).filter(id => id !== selectedCharId);
  const pick = [botIds[0 % botIds.length], botIds[1 % botIds.length]];
  const bDefs = [getCharacter(pick[0]), getCharacter(pick[1])];
  const bSpawns = [spawns[2] || spawns[spawns.length - 1], spawns[1] || spawns[spawns.length - 1]];
  bots = bDefs.map((d, i) => {
    const s = bSpawns[i];
    const b = new Character({ x: s.x, y: s.y, name: d.short, color: d.color, facing: -1, isBot: true, charId: d.id, skin: d.skin, charDef: d });
    b.ai = { shootCd: 1.5 + Math.random() * 0.8, moveCd: 0, moveDir: 0, jumpCd: 2 + Math.random() * 2 };
    return b;
  });
  if (netMode === 'host') {
    for (const [pid, charId] of remoteCharIds.entries()) {
      addRemotePlayer(pid, remoteNames.get(pid) || 'Player', charId);
      if (!remoteInputs.has(pid)) remoteInputs.set(pid, { state: defaultInput(), lastFireSeq: 0 });
    }
  }
  const mapName = MAP_LIST.find(m=>m.id===selectedMapId)?.name || selectedMapId;
  showMsg((netMode === 'player' ? 'Masuk: ' : pDef.name + ' @ ') + mapName, 1.4);
  if (netMode === 'host') broadcastState(true);
}

function getSkillDef(char, type) { return char?.charDef?.skills?.[type] || null; }
function nearestEnemy(c) { let best=null,bd=Infinity; for(const e of getEnemiesOf(c)){ if(!e?.alive||e.eliminated) continue; const d=Math.hypot(e.x-c.x,e.y-c.y); if(d<bd){bd=d;best=e;} } return best; }
function getEnemiesOf(c) {
  if (!c) return [];
  if (c.isRemote || c === player) return bots.filter(b => !b.isRemote);
  return [player, ...bots.filter(b => b.isRemote)].filter(Boolean);
}
function showMsg(t, d = 1.5) { msg = t; msgTimer = d; }

function applyPickup(c, type) {
  if (type === 'energy') { c.addEnergy(50); showMsg(c.name + ': +50 Energi!', 1.2); }
  else if (type === 'hp') { c.hp = Math.min(c.maxHp, c.hp + 30); showMsg(c.name + ': +30 HP!', 1.2); }
  else if (type === 'cooldown') {
    if (c === player) { controls.cooldowns.skill1 = 0; controls.cooldowns.skill2 = 0; }
    if (c.ai) { c.ai.shootCd = Math.min(c.ai.shootCd, 0.2); }
    showMsg(c.name + ': Cooldown Reset!', 1.2);
  }
}

function updateWind(dt) {
  windTimer -= dt;
  if (windTimer <= 0) { windTarget = (Math.random() * 2 - 1) * 35; windTimer = 4 + Math.random() * 4; }
  wind += (windTarget - wind) * Math.min(1, dt * 0.8);
}

function updateBots(dt) {
  for (const b of bots) {
    if (!b.alive || b.eliminated) continue;
    if (b.isRemote) { updateRemoteBot(dt, b); continue; }
    if (!b.isBot || !b.ai) continue;
    const ai = b.ai; const target = player?.alive && !player.eliminated ? player : null;
    if (!target) { b.stopMove(); continue; }
    const dx = target.x - b.x; b.facing = dx >= 0 ? 1 : -1;
    ai.moveCd -= dt;
    if (ai.moveCd <= 0) {
      const dist = Math.abs(dx);
      ai.moveDir = dist > 280 ? Math.sign(dx) : dist < 140 ? -Math.sign(dx) : (Math.random() < 0.3 ? (Math.random() < 0.5 ? -1 : 1) : 0);
      ai.moveCd = 0.6 + Math.random() * 1.2;
    }
    if (ai.moveDir !== 0) b.move(ai.moveDir, dt); else b.stopMove();
    ai.jumpCd -= dt;
    if (ai.jumpCd <= 0) { if (Math.random() < 0.35) b.jump(); ai.jumpCd = 2 + Math.random() * 3; }
    ai.shootCd -= dt;
    if (ai.shootCd <= 0 && b.stun <= 0) {
      const dist = Math.abs(dx), dy = target.y - b.y;
      let angle = Math.max(10, Math.min(80, 45 - dy * 0.08 + (Math.random() - 0.5) * 10));
      let power = Math.max(30, Math.min(100, dist * 0.18 + 20 + (Math.random() - 0.5) * 15));
      let type = 'basic';
      const r = Math.random();
      if (b.energy >= 100 && r < 0.35) type = 'ulti';
      else if (r < 0.15) type = 'skill2';
      else if (r < 0.35) type = 'skill1';
      fireWeapon(b, type, angle, power);
      ai.shootCd = type === 'basic' ? 0.9 + Math.random() * 0.8 : 2.5 + Math.random() * 2;
    }
  }
}

function updateRemoteBot(dt, b) {
  const inp = remoteInputs.get(b.netId);
  if (!inp) { b.stopMove(); return; }
  const s = inp.state || defaultInput();
  b.facing = s.aimFacing === -1 ? -1 : 1;
  if (s.aimActive) { b.aimAngle = s.aimAngle; b.aimPower = s.aimPower; }
  if (s.moveX) b.move(s.moveX, dt); else b.stopMove();
  if (s.jump) b.jump();
  if (s.fire && s.seq > (inp.lastFireSeq || 0)) {
    inp.lastFireSeq = s.seq;
    b.facing = s.aimFacing === -1 ? -1 : 1;
    fireWeapon(b, s.fire, s.fireAngle || s.aimAngle || 45, s.firePower || s.aimPower || 60);
  }
}

function handleLandingExplosions(chars) {
  for (const c of chars) {
    if (!c.pendingLandingExplosion) continue;
    if (c.onGround && c.alive) {
      const le = c.pendingLandingExplosion;
      c.pendingLandingExplosion = null;
      spawnExplosion(c.x, c.y - 8, le, c, 'skill2');
    } else if (!c.alive || c.eliminated) c.pendingLandingExplosion = null;
  }
}

function update(dt) {
  if (msgTimer > 0) msgTimer = Math.max(0, msgTimer - dt);
  updateWind(dt);
  if (ui.state.screen !== 'playing') return;
  if (gameOver) {
    restartTimer -= dt;
    if (restartTimer <= 0) {
      if (netMode === 'host') { spawnWorld(); broadcastState(true); }
      else if (netMode === 'local') spawnWorld();
    }
    if (netMode === 'host') { stateSendAcc += dt; if (stateSendAcc >= 1/15) { stateSendAcc = 0; broadcastState(false); } }
    return;
  }

  if (netMode === 'player') {
    controls.update(dt);
    controls.setUltiEnergy(player?.energy ?? 0);
    inputSeq++;
    const inp = { ...collectLocalInput(), fire: null, fireAngle: 0, firePower: 0, seq: inputSeq };
    const key = JSON.stringify(inp);
    stateSendAcc += dt;
    if (stateSendAcc >= 1/20 || key !== lastSentInput) { stateSendAcc = 0; lastSentInput = key; network.send({ type: 'player-input', state: inp }); }
    if (player?.alive) {
      const cs = controls.getState();
      if (cs.moveX !== 0) player.move(cs.moveX, dt); else player.stopMove();
      if (cs.aimActive) { player.aimAngle = cs.aimAngle; player.aimPower = cs.aimPower; player.facing = cs.aimFacing; }
      player.update(dt, terrain);
    }
    for (const fx of effects) fx.update(dt);
    effects = effects.filter(fx => !fx.done);
    for (const s of smokes) s.age += dt;
    smokes = smokes.filter(s => s.age < s.duration);
    for (const p of projectiles) { p.x += (p.vx||0)*dt; p.y += (p.vy||0)*dt; p.vy = (p.vy||0) + 980*dt; p.age = (p.age||0)+dt; if (p.trail) { p.trail.push({x:p.x,y:p.y}); if (p.trail.length>20) p.trail.shift(); } }
    const wDir = Math.abs(wind) < 1 ? '•' : wind > 0 ? '→' : '←';
    windEl.textContent = wDir + ' ' + Math.abs(wind).toFixed(0);
    statusEl.textContent = player?.alive ? 'HP ' + Math.ceil(player.hp) + ' | Energi ' + Math.floor(player.energy) + '%' : 'Tumbang';
    return;
  }

  controls.update(dt);
  controls.setUltiEnergy(player?.energy ?? 0);
  const cs = controls.getState();
  if (player?.alive) {
    if (cs.moveX !== 0) player.move(cs.moveX, dt); else player.stopMove();
    if (cs.aimActive) { player.aimAngle = cs.aimAngle; player.aimPower = cs.aimPower; player.facing = cs.aimFacing; }
  }
  updateBots(dt);
  const chars = [player, ...bots];
  for (const c of chars) c.update(dt, terrain);
  handleLandingExplosions(chars);
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    const res = p.update(dt, terrain, chars);
    if (res) {
      projectiles.splice(i, 1);
      if (res.exploded) { effects.push(new ExplosionFX(res.x, res.y, res.radius, res.type)); scheduleSpecials({ ...res, vxAtImpact: p.vx }); }
    }
  }
  for (let i = delayed.length - 1; i >= 0; i--) { delayed[i].t -= dt; if (delayed[i].t <= 0) { const fn = delayed[i].fn; delayed.splice(i, 1); fn(); } }
  for (const fx of effects) fx.update(dt);
  effects = effects.filter(fx => !fx.done);
  for (const s of smokes) s.age += dt;
  smokes = smokes.filter(s => s.age < s.duration);
  pickups.update(dt, terrain, chars, applyPickup);

  const aliveBots = bots.filter(b => b.alive && !b.eliminated);
  const humans = [player, ...bots.filter(b => b.isRemote)].filter(Boolean);
  const aliveHumans = humans.filter(h => h.alive && !h.eliminated);
  if (aliveHumans.length === 0) { gameOver = true; restartTimer = 3.5; showMsg('Tim kalah! Restart...', 3.5); }
  else if (aliveBots.length === 0) { gameOver = true; restartTimer = 3.5; showMsg('Menang! Semua lawan tumbang!', 3.5); }

  const wDir = Math.abs(wind) < 1 ? '•' : wind > 0 ? '→' : '←';
  windEl.textContent = wDir + ' ' + Math.abs(wind).toFixed(0);
  statusEl.textContent = player.alive ? 'HP ' + Math.ceil(player.hp) + ' | Energi ' + Math.floor(player.energy) + '%' : 'Tumbang';

  if (netMode === 'host') { stateSendAcc += dt; if (stateSendAcc >= 1/15) { stateSendAcc = 0; broadcastState(false); } }
}

function serializeChar(c) {
  if (!c) return null;
  return {
    x: c.x, y: c.y, vx: c.vx, vy: c.vy, facing: c.facing,
    hp: c.hp, maxHp: c.maxHp, energy: c.energy, alive: c.alive, eliminated: c.eliminated,
    stun: c.stun, throwAnim: c.throwAnim, hurtAnim: c.hurtAnim, runPhase: c.runPhase,
    aimAngle: c.aimAngle, aimPower: c.aimPower, onGround: c.onGround,
    charId: c.charId, name: c.name, color: c.color, isBot: !!c.isBot, isRemote: !!c.isRemote, netId: c.netId || null,
    buff: c.buff ? { duration: c.buff.duration, damageMul: c.buff.damageMul, knockMul: c.buff.knockMul } : null,
  };
}

function broadcastState(full) {
  if (netMode !== 'host' || !network.connected) { pendingCraters = []; return; }
  const state = {
    lobby: false,
    mapId: selectedMapId,
    wind, msg, msgTimer, gameOver, restartTimer,
    player: serializeChar(player),
    bots: bots.map(serializeChar),
    projectiles: projectiles.map(p => ({ x: p.x, y: p.y, vx: p.vx, vy: p.vy, r: p.r, type: p.type, age: p.age, trail: p.trail?.slice(-8) || [] })),
    effects: effects.map(e => ({ x: e.x, y: e.y, r: e.r, type: e.type, age: e.age, duration: e.duration })),
    smokes: smokes.map(s => ({ x: s.x, y: s.y, r: s.r, age: s.age, duration: s.duration })),
    pickups: pickups.items.filter(i => !i.dead).map(i => ({ x: i.x, y: i.y, type: i.type, landed: i.landed, w: i.w, h: i.h, bob: i.bob })),
    craters: pendingCraters.splice(0, pendingCraters.length),
    full: !!full, ts: Date.now(),
  };
  network.send({ type: 'game-state', state });
}

function broadcastLobbyState() {
  if (netMode !== 'host' || !network.connected) return;
  const players = buildWaitingPlayers();
  network.send({ type: 'game-state', state: { lobby: true, roomCode: hostRoomCode, mapId: selectedMapId, players, msg: 'Menunggu host memulai...' } });
}

function applyGameState(state) {
  if (!state || netMode !== 'player') return;
  if (state.mapId && state.mapId !== selectedMapId) {
    selectedMapId = state.mapId; ui.state.mapId = selectedMapId;
    terrain = new Terrain(W, H, selectedMapId);
  }
  if (!terrain) terrain = new Terrain(W, H, selectedMapId);
  if (Array.isArray(state.craters)) { for (const c of state.craters) { if (c) terrain.carveCrater(c.x, c.y, c.r); } }
  wind = state.wind ?? wind; msg = state.msg ?? msg; msgTimer = state.msgTimer ?? msgTimer;
  gameOver = !!state.gameOver; restartTimer = state.restartTimer ?? restartTimer;

  const allChars = [state.player, ...(state.bots || [])].filter(Boolean);
  const my = allChars.find(c => c.netId && c.netId === myPlayerId) || state.player;
  if (my) {
    const def = getCharacter(my.charId || selectedCharId);
    if (!player || player.charId !== def.id) {
      player = new Character({ x: my.x, y: my.y, name: my.name || def.short, color: def.color, facing: my.facing || 1, isBot: false, charId: def.id, skin: def.skin, charDef: def });
      controls.setCharacter(def);
    }
    applyCharState(player, my);
    const cs = controls.getState();
    if (cs.aimActive) { player.aimAngle = cs.aimAngle; player.aimPower = cs.aimPower; player.facing = cs.aimFacing; }
    controls.setUltiEnergy(player.energy);
  }
  const others = allChars.filter(c => c !== my);
  bots = others.map(o => {
    const def = getCharacter(o.charId || 'udin');
    const b = new Character({ x: o.x, y: o.y, name: o.name || def.short, color: def.color, facing: o.facing || 1, isBot: !!o.isBot, charId: def.id, skin: def.skin, charDef: def });
    b.isRemote = !!o.isRemote; b.netId = o.netId || null;
    applyCharState(b, o);
    return b;
  });
  projectiles = (state.projectiles || []).map(p => ({ ...p, alive: true, trail: p.trail || [], cfg: {}, owner: null, draw: projDraw }));
  effects = (state.effects || []).map(e => { const fx = new ExplosionFX(e.x, e.y, e.r, e.type); fx.age = e.age || 0; fx.done = (e.age||0) >= fx.duration; return fx; });
  smokes = (state.smokes || []).map(s => ({ ...s }));
  pickups.items = (state.pickups || []).map(p => { const it = {}; Object.assign(it, p); it.dead = false; it.age = 0; it.vy = 0; it.draw = pickupDraw; it.update = ()=>{}; it.tryCollect = ()=>null; return it; });
}

function applyCharState(c, s) {
  c.x = s.x; c.y = s.y; c.vx = s.vx; c.vy = s.vy; c.facing = s.facing;
  c.hp = s.hp; c.maxHp = s.maxHp; c.energy = s.energy;
  c.alive = s.alive; c.eliminated = s.eliminated;
  c.stun = s.stun || 0; c.throwAnim = s.throwAnim || 0; c.hurtAnim = s.hurtAnim || 0;
  c.runPhase = s.runPhase || 0; c.aimAngle = s.aimAngle || 45; c.aimPower = s.aimPower || 60;
  c.onGround = !!s.onGround; c.buff = s.buff ? { ...s.buff } : null;
}

function projDraw(ctx) {
  if (this.trail && this.trail.length > 1) {
    ctx.save(); ctx.strokeStyle = 'rgba(255,120,50,0.35)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(this.trail[0].x, this.trail[0].y);
    for (const t of this.trail) ctx.lineTo(t.x, t.y);
    ctx.stroke(); ctx.restore();
  }
  const imgName = this.type === 'ulti' ? 'projectile-ulti' : (this.type === 'basic' ? 'projectile-basic' : 'projectile-skill');
  const img = getFxImage(imgName);
  ctx.save(); ctx.translate(this.x, this.y); ctx.rotate(Math.atan2(this.vy||0, this.vx||0));
  if (img) {
    const size = (this.r || 4.5) * 5;
    ctx.drawImage(img, -size/2, -size/2, size, size);
  } else {
    ctx.fillStyle = this.type === 'ulti' ? '#ff5722' : '#d32f2f';
    const r = this.r || 4.5; ctx.beginPath(); ctx.ellipse(0, 0, r * 1.8, r, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffd54f'; ctx.fillRect(r * 1.2, -1.5, r, 3);
  }
  ctx.restore();
}

function pickupDraw(ctx) {
  if (this.dead) return;
  const t = performance.now() / 1000 + (this.bob || 0);
  const bobY = this.landed ? Math.sin(t * 3) * 2 : 0;
  const x = this.x, y = this.y + bobY;
  if (!this.landed) {
    ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x - 10, y - 10); ctx.lineTo(x - 18, y - 34); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + 10, y - 10); ctx.lineTo(x + 18, y - 34); ctx.stroke();
    ctx.fillStyle = '#ff7043'; ctx.beginPath(); ctx.arc(x, y - 34, 20, Math.PI, 0); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y - 34, 20, Math.PI, Math.PI * 1.5); ctx.lineTo(x, y - 34); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  const img = getFxImage(this.type === 'energy' ? 'pickup-energy' : this.type === 'hp' ? 'pickup-hp' : 'pickup-cooldown');
  if (img) {
    ctx.save();
    ctx.globalAlpha = 0.2; ctx.fillStyle = '#000'; ctx.beginPath(); ctx.ellipse(x, y + 13, 12, 3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    const size = 44;
    ctx.drawImage(img, x - size / 2, y - size / 2, size, size);
    ctx.restore();
    return;
  }
  ctx.save(); ctx.translate(x, y);
  ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.beginPath(); ctx.ellipse(0, 13, 12, 3, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = this.type === 'energy' ? '#7e57c2' : this.type === 'hp' ? '#43a047' : '#039be5';
  ctx.beginPath(); ctx.roundRect(-13, -11, 26, 22, 4); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.fillStyle = '#ffd54f'; ctx.fillRect(-2, -11, 4, 22); ctx.fillRect(-13, -2, 26, 4);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 11px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(this.type === 'energy' ? '⚡' : this.type === 'hp' ? '+' : 'CD', 0, 1);
  ctx.restore();
}

function drawSmokes() {
  const img = getFxImage('smoke');
  for (const s of smokes) {
    const t = s.age / s.duration;
    const a = t < 0.1 ? t / 0.1 : t > 0.7 ? (1 - t) / 0.3 : 1;
    if (img) {
      ctx.save(); ctx.globalAlpha = 0.35 * a;
      const size = s.r * 2.2 * (0.7 + t * 0.4);
      ctx.drawImage(img, s.x - size/2, s.y - 10 - size/2, size, size);
      ctx.restore();
      continue;
    }
    ctx.save(); ctx.globalAlpha = 0.28 * a;
    ctx.fillStyle = '#cfd8dc'; ctx.beginPath(); ctx.arc(s.x, s.y - 10, s.r * (0.7 + t * 0.4), 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#eceff1';
    ctx.beginPath(); ctx.arc(s.x - 20, s.y - 18, s.r * 0.45, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(s.x + 22, s.y - 15, s.r * 0.4, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}

let mouseAim = null;
canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'mouse' || gameOver || ui.state.screen !== 'playing') return;
  const r = canvas.getBoundingClientRect();
  mouseAim = { sx: (e.clientX - r.left) * (W / r.width), sy: (e.clientY - r.top) * (H / r.height), cx: 0, cy: 0 };
  mouseAim.cx = mouseAim.sx; mouseAim.cy = mouseAim.sy;
});
window.addEventListener('pointermove', (e) => {
  if (!mouseAim || e.pointerType !== 'mouse') return;
  const r = canvas.getBoundingClientRect();
  mouseAim.cx = (e.clientX - r.left) * (W / r.width);
  mouseAim.cy = (e.clientY - r.top) * (H / r.height);
});
window.addEventListener('pointerup', (e) => {
  if (!mouseAim || e.pointerType !== 'mouse') return;
  const dx = mouseAim.cx - mouseAim.sx, dy = mouseAim.cy - mouseAim.sy;
  const d = Math.hypot(dx, dy);
  if (d > 12 && controls.cooldowns.basic <= 0) {
    const facing = dx >= 0 ? 1 : -1;
    if (player) player.facing = facing;
    const angle = Math.max(5, Math.min(85, Math.atan2(-dy * (facing === 1 ? 1 : -1), Math.abs(dx)) * 180 / Math.PI));
    const power = Math.max(15, Math.min(100, d * 0.35));
    controls.cooldowns.basic = controls.cooldownMax.basic;
    handleLocalFire('basic', angle, power);
  }
  mouseAim = null;
});

function drawTrajectory() {
  if (!player?.alive || ui.state.screen !== 'playing') return;
  const cs = controls.getState();
  let angle = null, power = null, facing = null, type = 'basic';
  if (cs.aimActive) { angle = cs.aimAngle; power = cs.aimPower; facing = cs.aimFacing; type = cs.aimType; }
  else if (mouseAim) {
    const dx = mouseAim.cx - mouseAim.sx, dy = mouseAim.cy - mouseAim.sy;
    if (Math.hypot(dx, dy) > 12) { facing = dx >= 0 ? 1 : -1; angle = Math.max(5, Math.min(85, Math.atan2(-dy * (facing === 1 ? 1 : -1), Math.abs(dx)) * 180 / Math.PI)); power = Math.max(15, Math.min(100, Math.hypot(dx, dy) * 0.35)); }
  }
  if (angle == null) return;
  const o = player.getAimOrigin();
  const skillDef = getSkillDef(player, type);
  const pcfg = skillDef?.type === 'projectile' ? skillDef.projectile : (SKILLS[type] || SKILLS.basic);
  const pts = simulateTrajectory({ x: o.x, y: o.y, angleDeg: angle, power, facing, wind, type, terrain, maxPoints: 30, cfg: pcfg });
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 2; ctx.setLineDash([5, 5]);
  ctx.beginPath(); ctx.moveTo(o.x, o.y); for (const p of pts) ctx.lineTo(p.x, p.y); ctx.stroke();
  ctx.setLineDash([]); ctx.fillStyle = 'rgba(255,213,79,0.9)';
  for (let i = 0; i < pts.length; i += 2) { ctx.beginPath(); ctx.arc(pts[i].x, pts[i].y, 2.2, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
}

function draw() {
  ctx.clearRect(0, 0, W, H);
  if (terrain) terrain.draw(ctx);
  else {
    const g = ctx.createLinearGradient(0,0,0,H); g.addColorStop(0,'#6ec6ff'); g.addColorStop(0.55,'#bde7ff'); g.addColorStop(1,'#eaf8ff');
    ctx.fillStyle = g; ctx.fillRect(0,0,W,H);
  }
  drawSmokes();
  pickups.draw(ctx);
  for (const b of bots) b.draw(ctx);
  if (player) player.draw(ctx);
  drawTrajectory();
  for (const p of projectiles) { if (p.draw) p.draw(ctx); }
  for (const fx of effects) fx.draw(ctx);

  ctx.save();
  ctx.fillStyle = 'rgba(15,23,42,0.45)'; ctx.fillRect(W / 2 - 70, 8, 140, 30);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 11px system-ui'; ctx.textAlign = 'center'; ctx.fillText('ANGIN', W / 2, 20);
  const wx = Math.max(-52, Math.min(52, wind * 1.4));
  ctx.strokeStyle = '#ffd54f'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(W / 2, 30); ctx.lineTo(W / 2 + wx, 30); ctx.stroke();
  if (Math.abs(wx) > 2) { const dir = Math.sign(wx); ctx.fillStyle = '#ffd54f'; ctx.beginPath(); ctx.moveTo(W / 2 + wx, 30); ctx.lineTo(W / 2 + wx - 7 * dir, 26); ctx.lineTo(W / 2 + wx - 7 * dir, 34); ctx.closePath(); ctx.fill(); }
  ctx.restore();

  if (msgTimer > 0 && msg) {
    ctx.save(); ctx.globalAlpha = Math.min(1, msgTimer / 0.25);
    ctx.fillStyle = 'rgba(15,23,42,0.55)'; ctx.fillRect(W / 2 - 240, H * 0.38 - 28, 480, 52);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 26px system-ui'; ctx.textAlign = 'center'; ctx.fillText(msg, W / 2, H * 0.38 + 6);
    ctx.restore();
  }
}

let last = performance.now();
let lobbySendAcc = 0;
function loop(now) {
  const dt = Math.min(0.033, (now - last) / 1000); last = now;
  if (ui.state.screen === 'playing') update(dt);
  else {
    updateWind(dt);
    if (netMode === 'host' && waitingRoom && network.connected) {
      lobbySendAcc += dt;
      if (lobbySendAcc >= 1) { lobbySendAcc = 0; broadcastLobbyState(); }
    }
  }
  draw();
  requestAnimationFrame(loop);
}

// init
await preloadAssets();
terrain = new Terrain(W, H, selectedMapId);
controls.setEnabled(false);
requestAnimationFrame(loop);
