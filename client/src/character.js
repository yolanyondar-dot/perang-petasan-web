import { drawChibiHero2D } from './ballisticStyleAssets.js';
import { drawCharacterHud2D } from './visualAssets2d.js';
const GRAVITY = 1500;
const MOVE_SPEED = 170;
const JUMP_VEL = -560;
const MAX_FALL = 900;

export class Character {
  constructor({ x, y, name = 'Player', color = '#ff7043', facing = 1, isBot = false, charId = 'udin', skin = null, charDef = null }) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.w = 28;
    this.h = 44;
    this.name = name;
    this.color = color;
    this.facing = facing; // 1 right, -1 left
    this.isBot = isBot;
    this.charId = charId;
    this.charDef = charDef;
    this.skin = skin || charDef?.skin || { shirt: color, shirt2: '#fff', pants: '#5d4037', hair: '#3e2723', skinTone: '#f2c9a0', accessory: 'none' };

    this.hp = 100;
    this.maxHp = 100;
    this.energy = 0; // ulti 0-100
    this.alive = true;
    this.eliminated = false;

    this.onGround = false;
    this.stun = 0;
    this.knockbackTimer = 0;
    this.throwAnim = 0;
    this.hurtAnim = 0;
    this.runPhase = 0;
    this.buff = null; // {duration, damageMul, knockMul}
    this.pendingLandingExplosion = null; // {radius, damage, knock}

    this.aimAngle = 45; // degrees 5-85
    this.aimPower = 60; // 0-100
  }

  get centerX() { return this.x; }
  get centerY() { return this.y - this.h * 0.45; }
  get footY() { return this.y; }

  takeDamage(dmg, knockX = 0, knockY = 0) {
    if (!this.alive) return;
    const dmgMul = this.buff?.damageMul ?? 1;
    const knockMul = this.buff?.knockMul ?? 1;
    const finalDmg = dmg * dmgMul;
    const kx = knockX * knockMul;
    const ky = knockY * knockMul;
    this.hp = Math.max(0, this.hp - finalDmg);
    this.hurtAnim = 0.25;
    if (Math.abs(kx) > 10 || Math.abs(ky) > 10) {
      this.vx += kx;
      this.vy += ky;
      this.onGround = false;
      this.knockbackTimer = 0.18;
      if (Math.abs(kx) + Math.abs(ky) > 260) this.stun = Math.max(this.stun, 0.35);
    }
    if (finalDmg > 0) this.energy = Math.min(100, this.energy + finalDmg * 0.7);
    if (this.hp <= 0) this.alive = false;
  }

  applyBuff(buff) {
    this.buff = { ...buff };
  }

  addEnergy(v) { this.energy = Math.max(0, Math.min(100, this.energy + v)); }

  jump() {
    if (!this.alive || this.stun > 0 || !this.onGround) return false;
    this.vy = JUMP_VEL;
    this.onGround = false;
    return true;
  }

  move(dir, dt) {
    if (!this.alive || this.stun > 0) return;
    const d = Math.sign(dir);
    if (d === 0) return;
    this.facing = d;
    this.vx = d * MOVE_SPEED;
    this.runPhase += dt * 10;
  }

  stopMove() {
    if (this.onGround) this.vx = 0;
  }

  triggerThrow() { this.throwAnim = 0.28; }

  update(dt, terrain) {
    if (this.eliminated) return;
    if (!this.alive) {
      this.vy = Math.min(MAX_FALL, this.vy + GRAVITY * dt);
      this.y += this.vy * dt;
      if (this.y > (terrain.deathY ?? terrain.height + 120)) this.eliminated = true;
      return;
    }

    if (this.stun > 0) this.stun = Math.max(0, this.stun - dt);
    if (this.knockbackTimer > 0) this.knockbackTimer = Math.max(0, this.knockbackTimer - dt);
    if (this.throwAnim > 0) this.throwAnim = Math.max(0, this.throwAnim - dt);
    if (this.hurtAnim > 0) this.hurtAnim = Math.max(0, this.hurtAnim - dt);
    if (this.buff) { this.buff.duration -= dt; if (this.buff.duration <= 0) this.buff = null; }

    // horizontal
    if (this.knockbackTimer <= 0 && this.stun <= 0) {
      // vx set by move/stopMove; apply friction in air lightly
      if (!this.onGround) this.vx *= 0.995;
    } else {
      this.vx *= 0.96;
    }

    let nx = this.x + this.vx * dt;
    nx = Math.max(16, Math.min(terrain.width - 16, nx));

    // slope climb / wall check
    const footProbeY = this.y - 2;
    const surfaceAhead = terrain.findSurfaceY(nx, Math.max(0, this.y - 60));
    if (surfaceAhead < this.y - 22) {
      // too steep/high wall, block horizontal
      nx = this.x;
      if (this.knockbackTimer > 0) this.vx *= -0.3;
      else this.vx = 0;
    }
    this.x = nx;

    // vertical
    this.vy = Math.min(MAX_FALL, this.vy + GRAVITY * dt);
    this.y += this.vy * dt;

    // ground snap
    const groundY = terrain.findSurfaceY(this.x, Math.max(0, this.y - 60));
    if (this.y >= groundY) {
      if (this.vy > 250) this.hurtAnim = Math.max(this.hurtAnim, 0.1);
      this.y = groundY;
      this.vy = 0;
      this.onGround = true;
    } else {
      this.onGround = false;
    }

    // if inside solid (terrain carved around), push up
    let safety = 0;
    while (terrain.isSolid(this.x, this.y - 2) && safety < 60) {
      this.y -= 2;
      this.onGround = true;
      this.vy = Math.min(this.vy, 0);
      safety++;
    }

    // fell into abyss
    if (this.y > (terrain.deathY ?? terrain.height + 80)) {
      this.hp = 0;
      this.alive = false;
      this.eliminated = true;
    }
  }

  getAimOrigin() {
    return { x: this.x + this.facing * 14, y: this.y - 30 };
  }

  draw(ctx, opts = {}) {
    if (this.eliminated) return;
    const showPedestal = !!opts.showPedestal;
    const scale = opts.scale ?? 1;
    const t = performance.now() / 1000;
    const walkPhase = this.onGround ? (this.runPhase || 0) : (this.runPhase || 0) * 0.3;
    const aimRad = (-(this.aimAngle || 45) * Math.PI / 180) * (this.facing || 1);

    ctx.save();
    if (this.hurtAnim > 0) ctx.globalAlpha = 0.75 + Math.sin(t * 40) * 0.25;
    if (!this.alive) { ctx.globalAlpha = 0.85; }

    // buff glow
    if (this.buff) {
      ctx.save();
      ctx.globalAlpha = 0.25 + Math.sin(t * 8) * 0.08;
      ctx.strokeStyle = '#80deea'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(this.x, this.y - 24 * scale, 28 * scale, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }

    // knockout tilt
    const kx = this.x, ky = this.y;
    if (!this.alive) {
      ctx.save();
      ctx.translate(kx, ky);
      ctx.rotate((this.facing || 1) * 0.2);
      ctx.translate(-kx, -ky);
    }

    drawChibiHero2D(ctx, {
      x: this.x,
      y: this.y,
      scale,
      facing: this.facing || 1,
      characterId: this.charId || 'udin',
      primaryColor: this.skin?.shirt || this.color || '#ef4444',
      accentColor: this.skin?.shirt2 || this.skin?.accessoryColor || '#facc15',
      walkPhase,
      aimAngle: aimRad,
      isAiming: !opts.lobbyIdle,
      showPedestal,
    });

    if (!this.alive) ctx.restore();
    ctx.restore();

    if (!opts.hideHud) drawCharacterHud2D(ctx, this);
  }
}
