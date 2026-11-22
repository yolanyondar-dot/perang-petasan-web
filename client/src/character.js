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

  draw(ctx) {
    if (this.eliminated) return;
    const { x, y, facing, name } = this;
    const s = this.skin || {};
    const t = performance.now() / 1000;
    const run = this.onGround && Math.abs(this.vx) > 20;
    const legSwing = run ? Math.sin(this.runPhase) * 7 : Math.sin(t * 2) * 1.5;
    const bob = run ? Math.sin(this.runPhase * 2) * 1.5 : Math.sin(t * 2.5) * 0.8;
    const throwT = this.throwAnim > 0 ? 1 - this.throwAnim / 0.28 : 0;
    const armAim = -this.aimAngle * Math.PI / 180;

    ctx.save();
    ctx.translate(x, y + bob);

    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath();
    ctx.ellipse(0, 0, 14, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    if (this.hurtAnim > 0) ctx.globalAlpha = 0.7 + Math.sin(t * 40) * 0.3;

    // buff shield visual
    if (this.buff) {
      ctx.save();
      ctx.globalAlpha = 0.25 + Math.sin(t * 8) * 0.08;
      ctx.strokeStyle = '#80deea';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, -24, 28, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // legs
    ctx.strokeStyle = s.pants || '#5d4037';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-4, -14); ctx.lineTo(-4 - legSwing * 0.4, -2); ctx.lineTo(-6 - legSwing * 0.6, 0);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(4, -14); ctx.lineTo(4 + legSwing * 0.4, -2); ctx.lineTo(6 + legSwing * 0.6, 0);
    ctx.stroke();

    // torso
    ctx.fillStyle = s.shirt || this.color;
    roundRect(ctx, -10, -34, 20, 22, 6);
    ctx.fill();
    ctx.fillStyle = s.shirt2 || 'rgba(255,255,255,0.18)';
    if (this.charId === 'udin') {
      // red/white stripe
      ctx.fillRect(-10, -28, 20, 5);
      ctx.fillStyle = '#fff';
      ctx.fillRect(-10, -23, 20, 4);
    } else if (this.charId === 'sari') {
      // bright vest
      roundRect(ctx, -8, -32, 16, 18, 4); ctx.fill();
    } else if (this.charId === 'hendra') {
      // dark jacket detail
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      roundRect(ctx, -7, -31, 14, 16, 4); ctx.fill();
      ctx.strokeStyle = '#90a4ae'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(0, -33); ctx.lineTo(0, -14); ctx.stroke();
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      roundRect(ctx, -7, -31, 14, 8, 4); ctx.fill();
    }

    // back arm
    ctx.strokeStyle = s.skinTone || '#f2c9a0';
    ctx.lineWidth = 4.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-6 * facing, -30);
    ctx.lineTo(-12 * facing, -20 + legSwing * 0.2);
    ctx.stroke();

    // front arm holding petasan / aiming
    ctx.save();
    ctx.translate(6 * facing, -30);
    const aimRot = facing === 1 ? armAim : Math.PI - armAim;
    const throwExtra = throwT > 0 ? Math.sin(throwT * Math.PI) * 0.8 : 0;
    ctx.rotate(aimRot - throwExtra * facing);
    ctx.strokeStyle = s.skinTone || '#f2c9a0';
    ctx.lineWidth = 4.5;
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(16, 0);
    ctx.stroke();
    // petasan in hand
    ctx.fillStyle = '#d32f2f';
    roundRect(ctx, 14, -4, 10, 8, 2);
    ctx.fill();
    ctx.fillStyle = '#ffd54f';
    ctx.fillRect(22, -1, 4, 2);
    ctx.restore();

    // head
    ctx.fillStyle = s.skinTone || '#f2c9a0';
    ctx.beginPath();
    ctx.arc(0, -43, 11, 0, Math.PI * 2);
    ctx.fill();

    // hair / accessory
    this._drawAccessory(ctx, s, facing, t);

    // face
    ctx.fillStyle = '#222';
    ctx.beginPath(); ctx.arc(3 * facing, -44, 1.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(-3 * facing, -44, 1.5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(1 * facing, -40, 3, 0.1 * Math.PI, 0.9 * Math.PI);
    ctx.stroke();

    ctx.restore();

    this.drawHud(ctx);
  }

  _drawAccessory(ctx, s, facing, t) {
    const acc = s.accessory;
    // base hair
    ctx.fillStyle = s.hair || '#3e2723';
    ctx.beginPath();
    ctx.arc(0, -45, 11, Math.PI, Math.PI * 2);
    ctx.lineTo(11, -41);
    ctx.quadraticCurveTo(0, -38, -11, -41);
    ctx.closePath();
    ctx.fill();

    if (acc === 'headband') {
      ctx.strokeStyle = '#ff1744';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.arc(0, -45, 10.5, Math.PI * 1.05, Math.PI * 1.95);
      ctx.stroke();
      // tail
      ctx.strokeStyle = '#ff5252';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(-10 * facing, -46);
      ctx.quadraticCurveTo(-16 * facing, -48 - Math.sin(t * 4) * 2, -20 * facing, -44);
      ctx.stroke();
    } else if (acc === 'hat_ponytail') {
      // bright hat
      ctx.fillStyle = '#ffb74d';
      ctx.fillRect(-12, -49, 24, 4);
      ctx.beginPath(); ctx.arc(0, -49, 9, Math.PI, Math.PI * 2); ctx.fill();
      // ponytail
      ctx.strokeStyle = s.hair || '#4e342e';
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-8 * facing, -42);
      ctx.quadraticCurveTo(-16 * facing, -40, -18 * facing, -34 + Math.sin(t * 3) * 2);
      ctx.stroke();
    } else if (acc === 'goggles') {
      // goggles on head
      ctx.fillStyle = '#263238';
      ctx.fillRect(-12, -51, 24, 4);
      ctx.strokeStyle = '#90a4ae';
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(-4, -47, 3.2, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(4, -47, 3.2, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = 'rgba(129,212,250,0.5)';
      ctx.beginPath(); ctx.arc(-4, -47, 2.4, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(4, -47, 2.4, 0, Math.PI * 2); ctx.fill();
    } else if (acc === 'cap_back') {
      // cap backwards
      ctx.fillStyle = '#1e88e5';
      ctx.beginPath(); ctx.arc(0, -46, 10.5, Math.PI, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#1565c0';
      ctx.fillRect(-14 * facing, -47, 10, 3); // brim back
    } else {
      ctx.fillStyle = '#263238';
      ctx.fillRect(-13 * (facing * 0.2 + 0.8), -46, 18, 3);
    }
  }

  drawHud(ctx) {
    const x = this.x;
    const y = this.y - 72;
    const w = 50;
    const h = 6;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 3;
    ctx.strokeText(this.name, x, y - 6);
    ctx.fillText(this.name, x, y - 6);

    // HP bar
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(x - w / 2 - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = '#37474f';
    ctx.fillRect(x - w / 2, y, w, h);
    const hpR = Math.max(0, this.hp / this.maxHp);
    ctx.fillStyle = hpR > 0.5 ? '#66bb6a' : hpR > 0.25 ? '#ffca28' : '#ef5350';
    ctx.fillRect(x - w / 2, y, w * hpR, h);

    // energy bar
    const ey = y + 8;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(x - w / 2 - 1, ey - 1, w + 2, 4);
    ctx.fillStyle = '#263238';
    ctx.fillRect(x - w / 2, ey, w, 2.5);
    ctx.fillStyle = this.energy >= 100 ? '#ffd54f' : '#42a5f5';
    ctx.fillRect(x - w / 2, ey, w * (this.energy / 100), 2.5);
    ctx.restore();
  }
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