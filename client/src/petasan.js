import { drawExplosion2D } from './visualAssets2d.js';
import { getFxImage } from './assetLoader.js';
const G = 980;
const WIND_SCALE = 22;

export const SKILLS = {
  basic:  { name: 'Basic',    radius: 34, damage: 22, knock: 220, count: 1, spread: 0, fuse: 4.5, speedMul: 5.2, cooldown: 0.45, gravityMul: 1, windMul: 1, bounce: 0 },
  skill1: { name: 'Banting',  radius: 46, damage: 34, knock: 320, count: 1, spread: 0, fuse: 4.5, speedMul: 5.6, cooldown: 5.0, gravityMul: 1, windMul: 1, bounce: 0 },
  skill2: { name: 'Renteng',  radius: 28, damage: 16, knock: 170, count: 5, spread: 0.11, fuse: 4.5, speedMul: 5.0, cooldown: 8.0, gravityMul: 1, windMul: 1, bounce: 0 },
  ulti:   { name: 'Mercon Raksasa', radius: 78, damage: 56, knock: 520, count: 1, spread: 0, fuse: 5.0, speedMul: 4.8, cooldown: 0, gravityMul: 1, windMul: 1, bounce: 0 },
};

export class Petasan {
  constructor({ x, y, vx, vy, wind = 0, owner, type = 'basic', cfg = null }) {
    const base = cfg || SKILLS[type] || SKILLS.basic;
    this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.wind = wind;
    this.owner = owner;
    this.type = type;
    this.cfg = base;
    this.r = type === 'ulti' ? 7 : 4.5;
    this.alive = true;
    this.age = 0;
    this.trail = [];
    this.bouncesLeft = base.bounce || 0;
  }

  update(dt, terrain, chars) {
    if (!this.alive) return null;
    const steps = 3;
    const sdt = dt / steps;
    const gMul = this.cfg.gravityMul ?? 1;
    const wMul = this.cfg.windMul ?? 1;
    for (let i = 0; i < steps; i++) {
      this.age += sdt;
      if (this.age > (this.cfg.fuse || 4.5)) {
        this.alive = false;
        return this.explode(terrain, chars, null);
      }
      this.vx += this.wind * WIND_SCALE * wMul * sdt;
      this.vy += G * gMul * sdt;
      this.x += this.vx * sdt;
      this.y += this.vy * sdt;

      this.trail.push({ x: this.x, y: this.y });
      if (this.trail.length > 30) this.trail.shift();

      if (this.x < -60 || this.x > terrain.width + 60 || this.y > terrain.height + 80) {
        this.alive = false;
        return { exploded: false, out: true };
      }
      if (terrain.isSolid(this.x, this.y)) {
        if (this.bouncesLeft > 0) {
          this.bouncesLeft--;
          // simple bounce: move out and reflect vertical velocity, dampen
          this.y -= this.vy * sdt * 2;
          if (terrain.isSolid(this.x, this.y)) this.y -= 6;
          this.vy = -Math.abs(this.vy) * 0.55;
          this.vx *= 0.75;
          continue;
        }
        this.alive = false;
        return this.explode(terrain, chars, null);
      }
      for (const c of chars) {
        if (!c.alive || c.eliminated || c === this.owner) continue;
        const dx = this.x - c.centerX;
        const dy = this.y - c.centerY;
        const rr = c.w * 0.45 + this.r;
        if (dx * dx + dy * dy <= rr * rr) {
          this.alive = false;
          return this.explode(terrain, chars, c);
        }
      }
    }
    return null;
  }

  explode(terrain, chars, directHit) {
    const ex = this.x, ey = this.y;
    const { radius, damage, knock } = this.cfg;
    terrain.carveCrater(ex, ey, radius);
    const hits = [];
    for (const c of chars) {
      if (!c.alive || c.eliminated) continue;
      const dx = c.centerX - ex;
      const dy = c.centerY - ey;
      const dist = Math.hypot(dx, dy);
      const maxD = radius + 24;
      if (dist < maxD) {
        const t = 1 - dist / maxD;
        const dmg = Math.round(damage * (0.35 + 0.65 * t) * (c === directHit ? 1.15 : 1));
        const nx = dist > 0.001 ? dx / dist : 0;
        const ny = dist > 0.001 ? dy / dist : -1;
        const k = knock * t;
        c.takeDamage(dmg, nx * k, ny * k - k * 0.35);
        hits.push({ char: c, dmg });
      }
    }
    return { exploded: true, x: ex, y: ey, radius, type: this.type, hits, cfg: this.cfg, owner: this.owner };
  }

  draw(ctx) {
    drawExplosion2D(ctx, this);
  }
}

function roundRectLocal(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export class ExplosionFX {
  constructor(x, y, radius, type = 'basic') {
    this.x = x; this.y = y; this.radius = radius; this.type = type;
    this.age = 0;
    this.duration = type === 'ulti' ? 0.8 : 0.5;
    this.done = false;
    this.parts = [];
    const n = type === 'ulti' ? 34 : type === 'skill1' ? 24 : 16;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (40 + Math.random() * 160) * (type === 'ulti' ? 1.4 : 1);
      this.parts.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60,
        r: 2 + Math.random() * (type === 'ulti' ? 5 : 3),
        life: 0.25 + Math.random() * 0.45, age: 0,
        color: ['#ffeb3b','#ff9800','#ff5722','#fff176'][i % 4],
        smoke: i % 5 === 0,
      });
    }
  }
  update(dt) {
    this.age += dt;
    if (this.age >= this.duration) this.done = true;
    for (const p of this.parts) {
      p.age += dt;
      p.vy += (p.smoke ? -20 : 280) * dt;
      p.vx *= 0.99;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }
  draw(ctx) {
    const t = Math.min(1, this.age / this.duration);
    const a = 1 - t;
    const img = getFxImage('explosion');
    if (img) {
      ctx.save();
      ctx.globalAlpha = a * 0.95;
      const size = this.radius * 2.6 * (0.5 + t * 0.7);
      ctx.drawImage(img, this.x - size / 2, this.y - size / 2, size, size);
      ctx.restore();
      return;
    }
    ctx.save();
    ctx.globalAlpha = a * 0.45;
    ctx.fillStyle = '#ffcc80';
    ctx.beginPath(); ctx.arc(this.x, this.y, this.radius * (0.45 + t * 0.7), 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = a * 0.7;
    ctx.strokeStyle = '#fff59d';
    ctx.lineWidth = 3;
    ctx.stroke();
    for (const p of this.parts) {
      const pt = p.age / p.life;
      if (pt >= 1) continue;
      ctx.globalAlpha = (1 - pt) * (p.smoke ? 0.35 : 0.85);
      ctx.fillStyle = p.smoke ? '#9e9e9e' : p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1 - pt * 0.3), 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
}

export function simulateTrajectory({ x, y, angleDeg, power, facing, wind, type = 'basic', terrain, maxPoints = 28, cfg: cfgOverride = null }) {
  const cfg = cfgOverride || SKILLS[type] || SKILLS.basic;
  const rad = angleDeg * Math.PI / 180;
  const sp = Math.max(5, Math.min(100, power)) * (cfg.speedMul || 5.2);
  let vx = Math.cos(rad) * sp * facing;
  let vy = -Math.sin(rad) * sp;
  let px = x, py = y;
  const pts = [];
  const gMul = cfg.gravityMul ?? 1;
  const wMul = cfg.windMul ?? 1;
  for (let i = 0; i < maxPoints; i++) {
    const dt = 1 / 30;
    vx += wind * WIND_SCALE * wMul * dt;
    vy += G * gMul * dt;
    px += vx * dt;
    py += vy * dt;
    pts.push({ x: px, y: py });
    if (terrain && terrain.isSolid(px, py)) break;
    if (py > (terrain?.height ?? 800) + 40) break;
  }
  return pts;
}

export function spawnProjectiles({ x, y, angleDeg, power, facing, wind, owner, type, cfg: cfgOverride = null }) {
  const cfg = cfgOverride || SKILLS[type] || SKILLS.basic;
  const baseRad = angleDeg * Math.PI / 180;
  const sp = Math.max(5, Math.min(100, power)) * (cfg.speedMul || 5.2);
  const out = [];
  const count = cfg.count || 1;
  for (let i = 0; i < count; i++) {
    const offset = (i - (count - 1) / 2) * (cfg.spread || 0);
    const a = baseRad + offset;
    const vx = Math.cos(a) * sp * facing + (Math.random() - 0.5) * 12;
    const vy = -Math.sin(a) * sp + (Math.random() - 0.5) * 12;
    out.push(new Petasan({ x, y, vx, vy, wind, owner, type, cfg }));
  }
  return out;
}