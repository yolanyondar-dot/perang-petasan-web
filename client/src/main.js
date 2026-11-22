import { Terrain } from './terrain.js';
import { Character } from './character.js';
import { ExplosionFX, SKILLS, spawnProjectiles, simulateTrajectory } from './petasan.js';
import { MobaControls } from './mobaControls.js';
import { CHARACTER_LIST, getCharacter } from './charactersConfig.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const W = canvas.width;
const H = canvas.height;
const windEl = document.getElementById('wind');
const statusEl = document.getElementById('status');
const pickerEl = document.getElementById('picker');

let terrain, player, bots = [], projectiles = [], effects = [], smokes = [], delayed = [];
let wind = 0, windTarget = 0, windTimer = 0;
let msg = '', msgTimer = 0, gameOver = false, restartTimer = 0;
let selectedCharId = 'udin';

const controls = new MobaControls(document.body, {
  onFire: (type, angleDeg, power) => fireWeapon(player, type, angleDeg, power),
  onJump: () => player?.jump(),
  getAimDefaults: () => {
    const p = player;
    if (!p) return { angle: 45, power: 65, facing: 1 };
    const target = nearestEnemy(p);
    const facing = target ? (target.x >= p.x ? 1 : -1) : p.facing;
    p.facing = facing;
    return { angle: p.aimAngle || 45, power: p.aimPower || 65, facing };
  },
});

// mouse aim fallback
let mouseAim = null;
canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'mouse' || gameOver) return;
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
    player.facing = facing;
    const angle = Math.max(5, Math.min(85, Math.atan2(-dy * (facing === 1 ? 1 : -1), Math.abs(dx)) * 180 / Math.PI));
    const power = Math.max(15, Math.min(100, d * 0.35));
    controls.cooldowns.basic = controls.cooldownMax.basic;
    fireWeapon(player, 'basic', angle, power);
  }
  mouseAim = null;
});

pickerEl?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-char]');
  if (!btn) return;
  selectedCharId = btn.dataset.char;
  pickerEl.querySelectorAll('.pick').forEach(b => b.classList.toggle('active', b.dataset.char === selectedCharId));
  spawnWorld();
});

function getSkillDef(char, type) {
  const def = char?.charDef?.skills?.[type];
  return def || null;
}

function nearestEnemy(c) {
  const arr = c === player ? bots : [player];
  let best = null, bd = Infinity;
  for (const e of arr) { if (!e?.alive || e.eliminated) continue; const d = Math.hypot(e.x - c.x, e.y - c.y); if (d < bd) { bd = d; best = e; } }
  return best;
}

function showMsg(t, d = 1.5) { msg = t; msgTimer = d; }

function spawnExplosion(x, y, cfg, owner, type = 'basic') {
  terrain.carveCrater(x, y, cfg.radius);
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
      const oy = -30 - Math.random() * 30;
      delayed.push({ t: 0.15 + i * cfg.rain.delay, fn: () => spawnExplosion(x + ox, y + oy, cfg.rain, owner, 'ulti') });
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
    showMsg(`${char.name}: ${skillDef.name}!`, 1.1);
    return;
  }
  if (skillDef.type === 'dash_jump') {
    const d = skillDef.dash || {};
    const dir = char.facing;
    char.vx = (d.vx || 300) * dir;
    char.vy = d.vy || -600;
    char.onGround = false;
    char.pendingLandingExplosion = { radius: d.landingRadius || 40, damage: d.landingDamage || 20, knock: d.landingKnock || 240, owner: char };
    showMsg(`${char.name}: ${skillDef.name}!`, 1.1);
    return;
  }

  const pcfg = skillDef.projectile || SKILLS[type] || SKILLS.basic;
  const o = char.getAimOrigin();
  const projs = spawnProjectiles({ x: o.x, y: o.y, angleDeg, power, facing: char.facing, wind, owner: char, type, cfg: pcfg });
  projectiles.push(...projs);
  if (type !== 'basic') showMsg(`${char.name}: ${skillDef.name}!`, 1.1);
}

function spawnWorld() {
  terrain = new Terrain(W, H);
  projectiles = []; effects = []; smokes = []; delayed = [];
  wind = 0; windTarget = 0; windTimer = 2;
  gameOver = false; restartTimer = 0;

  const pDef = getCharacter(selectedCharId);
  const py = terrain.findSurfaceY(180);
  player = new Character({ x: 180, y: py, name: pDef.short, color: pDef.color, facing: 1, isBot: false, charId: pDef.id, skin: pDef.skin, charDef: pDef });
  controls.setCharacter(pDef);

  const botIds = CHARACTER_LIST.map(c => c.id).filter(id => id !== selectedCharId);
  const pick = [botIds[0 % botIds.length], botIds[1 % botIds.length]];
  const bDefs = [getCharacter(pick[0]), getCharacter(pick[1])];
  const bPos = [W - 220, W - 420];
  bots = bDefs.map((d, i) => {
    const y = terrain.findSurfaceY(bPos[i]);
    const b = new Character({ x: bPos[i], y, name: d.short, color: d.color, facing: -1, isBot: true, charId: d.id, skin: d.skin, charDef: d });
    b.ai = { shootCd: 1.5 + Math.random() * 0.8, moveCd: 0, moveDir: 0, jumpCd: 2 + Math.random() * 2 };
    return b;
  });
  showMsg(`Pilih: ${pDef.name}`, 1.4);
}

function updateWind(dt) {
  windTimer -= dt;
  if (windTimer <= 0) { windTarget = (Math.random() * 2 - 1) * 35; windTimer = 4 + Math.random() * 4; }
  wind += (windTarget - wind) * Math.min(1, dt * 0.8);
}

function updateBots(dt) {
  for (const b of bots) {
    if (!b.alive || b.eliminated) continue;
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

function handleLandingExplosions(chars) {
  for (const c of chars) {
    if (!c.pendingLandingExplosion) continue;
    if (c.onGround && c.alive) {
      const le = c.pendingLandingExplosion;
      c.pendingLandingExplosion = null;
      spawnExplosion(c.x, c.y - 8, le, c, 'skill2');
    } else if (!c.alive || c.eliminated) {
      c.pendingLandingExplosion = null;
    }
  }
}

function update(dt) {
  if (msgTimer > 0) msgTimer = Math.max(0, msgTimer - dt);
  updateWind(dt);
  if (gameOver) { restartTimer -= dt; if (restartTimer <= 0) spawnWorld(); return; }

  controls.update(dt);
  controls.setUltiEnergy(player?.energy ?? 0);
  const cs = controls.getState();
  if (player?.alive) {
    if (cs.moveX !== 0) player.move(cs.moveX, dt); else player.stopMove();
    if (cs.aimActive) { player.aimAngle = cs.aimAngle; player.aimPower = cs.aimPower; player.facing = cs.aimFacing; }
  }
  updateBots(dt);

  const chars = [player, ...bots];
  const prevY = chars.map(c => c.y);
  const prevOnGround = chars.map(c => c.onGround);
  for (const c of chars) c.update(dt, terrain);
  handleLandingExplosions(chars);

  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    const res = p.update(dt, terrain, chars);
    if (res) {
      projectiles.splice(i, 1);
      if (res.exploded) {
        effects.push(new ExplosionFX(res.x, res.y, res.radius, res.type));
        scheduleSpecials({ ...res, vxAtImpact: p.vx });
      }
    }
  }

  for (let i = delayed.length - 1; i >= 0; i--) {
    delayed[i].t -= dt;
    if (delayed[i].t <= 0) { const fn = delayed[i].fn; delayed.splice(i, 1); fn(); }
  }

  for (const fx of effects) fx.update(dt);
  effects = effects.filter(fx => !fx.done);
  for (const s of smokes) s.age += dt;
  smokes = smokes.filter(s => s.age < s.duration);

  const aliveBots = bots.filter(b => b.alive && !b.eliminated);
  if (player.eliminated || !player.alive) { gameOver = true; restartTimer = 3.5; showMsg('Kamu kalah! Restart...', 3.5); }
  else if (aliveBots.length === 0) { gameOver = true; restartTimer = 3.5; showMsg('Menang! Semua bot tumbang!', 3.5); }

  const wDir = Math.abs(wind) < 1 ? '•' : wind > 0 ? '→' : '←';
  windEl.textContent = `${wDir} ${Math.abs(wind).toFixed(0)}`;
  statusEl.textContent = player.alive ? `HP ${Math.ceil(player.hp)} | Energi ${Math.floor(player.energy)}%` : 'Tumbang';
}

function drawBackground() {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#6ec6ff'); g.addColorStop(0.55, '#bde7ff'); g.addColorStop(1, '#eaf8ff');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  const t = performance.now() * 0.008;
  for (let i = 0; i < 6; i++) {
    const x = ((i * 260 + t * (8 + i * 2)) % (W + 200)) - 100; const y = 55 + (i % 3) * 32;
    ctx.beginPath(); ctx.arc(x, y, 20, 0, Math.PI * 2); ctx.arc(x + 24, y - 10, 26, 0, Math.PI * 2); ctx.arc(x + 52, y, 20, 0, Math.PI * 2); ctx.fill();
  }
}

function drawTrajectory() {
  const cs = controls.getState();
  let angle = null, power = null, facing = null, type = 'basic';
  if (cs.aimActive) { angle = cs.aimAngle; power = cs.aimPower; facing = cs.aimFacing; type = cs.aimType; }
  else if (mouseAim) {
    const dx = mouseAim.cx - mouseAim.sx, dy = mouseAim.cy - mouseAim.sy;
    if (Math.hypot(dx, dy) > 12) { facing = dx >= 0 ? 1 : -1; angle = Math.max(5, Math.min(85, Math.atan2(-dy * (facing === 1 ? 1 : -1), Math.abs(dx)) * 180 / Math.PI)); power = Math.max(15, Math.min(100, Math.hypot(dx, dy) * 0.35)); }
  }
  if (angle == null || !player?.alive) return;
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

function drawSmokes() {
  for (const s of smokes) {
    const t = s.age / s.duration;
    const a = t < 0.1 ? t / 0.1 : t > 0.7 ? (1 - t) / 0.3 : 1;
    ctx.save();
    ctx.globalAlpha = 0.28 * a;
    ctx.fillStyle = '#cfd8dc';
    ctx.beginPath(); ctx.arc(s.x, s.y - 10, s.r * (0.7 + t * 0.4), 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#eceff1';
    ctx.beginPath(); ctx.arc(s.x - 20, s.y - 18, s.r * 0.45, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(s.x + 22, s.y - 15, s.r * 0.4, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}

function draw() {
  ctx.clearRect(0, 0, W, H);
  drawBackground();
  terrain.draw(ctx);
  drawSmokes();
  for (const b of bots) b.draw(ctx);
  player.draw(ctx);
  drawTrajectory();
  for (const p of projectiles) p.draw(ctx);
  for (const fx of effects) fx.draw(ctx);

  ctx.save();
  ctx.fillStyle = 'rgba(15,23,42,0.45)'; ctx.fillRect(W / 2 - 70, 8, 140, 30);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 11px system-ui'; ctx.textAlign = 'center';
  ctx.fillText('ANGIN', W / 2, 20);
  const wx = Math.max(-52, Math.min(52, wind * 1.4));
  ctx.strokeStyle = '#ffd54f'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(W / 2, 30); ctx.lineTo(W / 2 + wx, 30); ctx.stroke();
  if (Math.abs(wx) > 2) { const dir = Math.sign(wx); ctx.fillStyle = '#ffd54f'; ctx.beginPath(); ctx.moveTo(W / 2 + wx, 30); ctx.lineTo(W / 2 + wx - 7 * dir, 26); ctx.lineTo(W / 2 + wx - 7 * dir, 34); ctx.closePath(); ctx.fill(); }
  ctx.restore();

  if (msgTimer > 0 && msg) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, msgTimer / 0.25);
    ctx.fillStyle = 'rgba(15,23,42,0.55)'; ctx.fillRect(W / 2 - 240, H * 0.38 - 28, 480, 52);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 26px system-ui'; ctx.textAlign = 'center'; ctx.fillText(msg, W / 2, H * 0.38 + 6);
    ctx.restore();
  }
}

let last = performance.now();
function loop(now) { const dt = Math.min(0.033, (now - last) / 1000); last = now; update(dt); draw(); requestAnimationFrame(loop); }

spawnWorld();
requestAnimationFrame(loop);