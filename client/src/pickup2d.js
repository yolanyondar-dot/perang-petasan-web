const TYPES = ['energy', 'hp', 'cooldown'];

export class Pickup2D {
  constructor(x, y, type) {
    this.x = x;
    this.y = y;
    this.vy = 0;
    this.type = type || TYPES[Math.floor(Math.random() * TYPES.length)];
    this.w = 26;
    this.h = 22;
    this.landed = false;
    this.dead = false;
    this.age = 0;
    this.bob = Math.random() * Math.PI * 2;
  }

  update(dt, terrain) {
    if (this.dead) return;
    this.age += dt;
    if (!this.landed) {
      this.vy = Math.min(160, this.vy + 260 * dt);
      this.y += this.vy * dt;
      const groundY = terrain.findSurfaceY(this.x, Math.max(0, this.y - 10));
      if (this.y + this.h / 2 >= groundY) {
        this.y = groundY - this.h / 2;
        this.landed = true;
        this.vy = 0;
      }
      if (this.y > terrain.height + 60) this.dead = true;
    }
  }

  tryCollect(chars) {
    if (this.dead || !this.landed) return null;
    for (const c of chars) {
      if (!c.alive || c.eliminated) continue;
      const dx = c.x - this.x;
      const dy = c.centerY - this.y;
      if (Math.abs(dx) < 24 && Math.abs(dy) < 30) {
        this.dead = true;
        return c;
      }
    }
    return null;
  }

  draw(ctx) {
    if (this.dead) return;
    const t = performance.now() / 1000 + this.bob;
    const bobY = this.landed ? Math.sin(t * 3) * 2 : 0;
    const x = this.x;
    const y = this.y + bobY;

    // parachute while falling
    if (!this.landed) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x - 10, y - 10); ctx.lineTo(x - 18, y - 34); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + 10, y - 10); ctx.lineTo(x + 18, y - 34); ctx.stroke();
      ctx.fillStyle = '#ff7043';
      ctx.beginPath();
      ctx.arc(x, y - 34, 20, Math.PI, 0);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(x, y - 34, 20, Math.PI, Math.PI * 1.5); ctx.lineTo(x, y - 34); ctx.closePath(); ctx.fill();
      ctx.restore();
    }

    // box
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath(); ctx.ellipse(0, this.h / 2 + 2, 12, 3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = this.type === 'energy' ? '#7e57c2' : this.type === 'hp' ? '#43a047' : '#039be5';
    roundRect(ctx, -13, -11, 26, 22, 4);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = '#ffd54f';
    ctx.fillRect(-2, -11, 4, 22);
    ctx.fillRect(-13, -2, 26, 4);
    // icon
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px system-ui';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const icon = this.type === 'energy' ? '⚡' : this.type === 'hp' ? '+' : 'CD';
    ctx.fillText(icon, 0, 1);
    ctx.restore();
  }
}

export class PickupManager {
  constructor() { this.reset(); }
  reset() {
    this.items = [];
    this.timer = 4; // first drop soon
    this.interval = 12;
    this.maxActive = 2;
  }
  update(dt, terrain, chars, onCollect) {
    this.timer -= dt;
    if (this.timer <= 0 && this.items.filter(i => !i.dead).length < this.maxActive) {
      const x = 120 + Math.random() * (terrain.width - 240);
      this.items.push(new Pickup2D(x, -30, null));
      this.timer = this.interval;
    }
    for (const it of this.items) it.update(dt, terrain);
    for (const it of this.items) {
      const c = it.tryCollect(chars);
      if (c) onCollect?.(c, it.type);
    }
    this.items = this.items.filter(it => !it.dead);
  }
  draw(ctx) { for (const it of this.items) it.draw(ctx); }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}