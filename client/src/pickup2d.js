import { drawPickup2D } from './visualAssets2d.js';
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
    drawPickup2D(ctx, this);
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