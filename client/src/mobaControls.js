export class MobaControls {
  constructor(container, opts = {}) {
    this.container = container;
    this.onFire = opts.onFire || (() => {}); // (type, angleDeg, power)
    this.onJump = opts.onJump || (() => {});
    this.getAimDefaults = opts.getAimDefaults || (() => ({ angle: 45, power: 65, facing: 1 }));

    this.state = {
      moveX: 0,
      aimActive: false,
      aimAngle: 45,
      aimPower: 60,
      aimFacing: 1,
      aimType: 'basic',
    };

    this.cooldowns = { basic: 0, skill1: 0, skill2: 0, ulti: 0 };
    this.cooldownMax = { basic: 0.45, skill1: 5, skill2: 8, ulti: 0 };
    this.ultiReady = false;

    this.joy = { active: false, pointerId: null, cx: 0, cy: 0, x: 0, y: 0, radius: 52 };
    this.attack = { active: false, pointerId: null, startX: 0, startY: 0, startT: 0, moved: false };

    this.keys = new Set();
    this.mouseAim = { active: false, x: 0, y: 0 };

    this._build();
    this._bindKeys();
  }

  _build() {
    const root = document.createElement('div');
    root.id = 'moba-controls';
    root.innerHTML = `
      <div class="joy-zone" id="joy-zone">
        <div class="joy-base" id="joy-base"><div class="joy-knob" id="joy-knob"></div></div>
      </div>
      <div class="btn-zone" id="btn-zone">
        <div class="skill-row">
          <button class="act-btn skill" data-skill="skill1" id="btn-skill1"><span class="lbl">S1</span><span class="sub">Banting</span><svg class="cd" viewBox="0 0 36 36"><path class="cd-bg" d="M18 2a16 16 0 1 1 0 32a16 16 0 1 1 0-32"/><path class="cd-fg" d="M18 2a16 16 0 1 1 0 32a16 16 0 1 1 0-32"/></svg></button>
          <button class="act-btn skill" data-skill="skill2" id="btn-skill2"><span class="lbl">S2</span><span class="sub">Renteng</span><svg class="cd" viewBox="0 0 36 36"><path class="cd-bg" d="M18 2a16 16 0 1 1 0 32a16 16 0 1 1 0-32"/><path class="cd-fg" d="M18 2a16 16 0 1 1 0 32a16 16 0 1 1 0-32"/></svg></button>
          <button class="act-btn ulti" data-skill="ulti" id="btn-ulti"><span class="lbl">ULTI</span><span class="sub">Mercon</span><div class="ulti-bar"><div class="ulti-fill" id="ulti-fill"></div></div></button>
        </div>
        <div class="main-row">
          <button class="act-btn jump" id="btn-jump"><span class="lbl">LOMPAT</span></button>
          <button class="act-btn attack" id="btn-attack"><span class="lbl">ATTACK</span><span class="sub">tahan/drag</span><svg class="cd" viewBox="0 0 36 36"><path class="cd-bg" d="M18 2a16 16 0 1 1 0 32a16 16 0 1 1 0-32"/><path class="cd-fg" d="M18 2a16 16 0 1 1 0 32a16 16 0 1 1 0-32"/></svg></button>
        </div>
      </div>
      <div class="aim-hint" id="aim-hint">Drag untuk bidik, lepas untuk tembak</div>
    `;
    this.container.appendChild(root);
    this.root = root;
    this.el = {
      joyBase: root.querySelector('#joy-base'),
      joyKnob: root.querySelector('#joy-knob'),
      jump: root.querySelector('#btn-jump'),
      attack: root.querySelector('#btn-attack'),
      skill1: root.querySelector('#btn-skill1'),
      skill2: root.querySelector('#btn-skill2'),
      ulti: root.querySelector('#btn-ulti'),
      ultiFill: root.querySelector('#ulti-fill'),
      aimHint: root.querySelector('#aim-hint'),
    };
    this._bindJoystick();
    this._bindButtons();
  }

  _bindJoystick() {
    const base = this.el.joyBase;
    const onDown = (e) => {
      e.preventDefault();
      base.setPointerCapture?.(e.pointerId);
      const r = base.getBoundingClientRect();
      this.joy.active = true;
      this.joy.pointerId = e.pointerId;
      this.joy.cx = r.left + r.width / 2;
      this.joy.cy = r.top + r.height / 2;
      this._updateJoy(e.clientX, e.clientY);
    };
    const onMove = (e) => {
      if (!this.joy.active || e.pointerId !== this.joy.pointerId) return;
      this._updateJoy(e.clientX, e.clientY);
    };
    const onUp = (e) => {
      if (e.pointerId !== this.joy.pointerId) return;
      this.joy.active = false; this.joy.pointerId = null; this.joy.x = 0; this.joy.y = 0;
      this.el.joyKnob.style.transform = 'translate(0px,0px)';
      this.state.moveX = 0;
    };
    base.addEventListener('pointerdown', onDown);
    base.addEventListener('pointermove', onMove);
    base.addEventListener('pointerup', onUp);
    base.addEventListener('pointercancel', onUp);
  }

  _updateJoy(cx, cy) {
    let dx = cx - this.joy.cx;
    let dy = cy - this.joy.cy;
    const d = Math.hypot(dx, dy);
    const max = this.joy.radius;
    if (d > max) { dx = dx / d * max; dy = dy / d * max; }
    this.joy.x = dx; this.joy.y = dy;
    this.el.joyKnob.style.transform = `translate(${dx}px,${dy}px)`;
    const dead = 10;
    this.state.moveX = Math.abs(dx) < dead ? 0 : Math.max(-1, Math.min(1, dx / max));
  }

  _bindButtons() {
    // Jump
    this.el.jump.addEventListener('pointerdown', (e) => { e.preventDefault(); this.onJump(); this.el.jump.classList.add('pressed'); });
    const jumpUp = () => this.el.jump.classList.remove('pressed');
    this.el.jump.addEventListener('pointerup', jumpUp); this.el.jump.addEventListener('pointercancel', jumpUp); this.el.jump.addEventListener('pointerleave', jumpUp);

    // Basic attack: tap or drag-to-aim
    const atk = this.el.attack;
    atk.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (this.cooldowns.basic > 0) return;
      atk.setPointerCapture?.(e.pointerId);
      const def = this.getAimDefaults();
      this.attack = { active: true, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, startT: performance.now(), moved: false };
      this.state.aimActive = true;
      this.state.aimType = 'basic';
      this.state.aimAngle = def.angle;
      this.state.aimPower = def.power;
      this.state.aimFacing = def.facing;
      this.el.aimHint.classList.add('show');
    });
    atk.addEventListener('pointermove', (e) => {
      if (!this.attack.active || e.pointerId !== this.attack.pointerId) return;
      const dx = e.clientX - this.attack.startX;
      const dy = e.clientY - this.attack.startY;
      if (Math.hypot(dx, dy) > 10) this.attack.moved = true;
      if (this.attack.moved) {
        // drag: up/right increases angle/power based on drag vector from start
        const facing = this.state.aimFacing;
        const aimDx = dx * facing;
        const aimDy = -dy;
        this.state.aimAngle = Math.max(5, Math.min(85, 45 + aimDy * 0.35));
        this.state.aimPower = Math.max(10, Math.min(100, 55 + aimDx * 0.25));
      }
    });
    const atkUp = (e) => {
      if (!this.attack.active || e.pointerId !== this.attack.pointerId) return;
      const elapsed = performance.now() - this.attack.startT;
      const quickTap = !this.attack.moved && elapsed < 250;
      const def = this.getAimDefaults();
      const angle = quickTap ? def.angle : this.state.aimAngle;
      const power = quickTap ? 65 : this.state.aimPower;
      this.attack.active = false; this.attack.pointerId = null;
      this.state.aimActive = false;
      this.el.aimHint.classList.remove('show');
      if (this.cooldowns.basic <= 0) {
        this.cooldowns.basic = this.cooldownMax.basic;
        this.onFire('basic', angle, power);
      }
    };
    atk.addEventListener('pointerup', atkUp); atk.addEventListener('pointercancel', atkUp);

    // Skill 1 & 2
    for (const id of ['skill1', 'skill2']) {
      const el = this.el[id];
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (this.cooldowns[id] > 0) return;
        const def = this.getAimDefaults();
        this.cooldowns[id] = this.cooldownMax[id];
        this.onFire(id, def.angle, 70);
        el.classList.add('pressed');
        setTimeout(() => el.classList.remove('pressed'), 120);
      });
    }

    // Ulti
    this.el.ulti.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (!this.ultiReady || this.cooldowns.ulti > 0) return;
      const def = this.getAimDefaults();
      this.cooldowns.ulti = 1;
      this.ultiReady = false;
      this.onFire('ulti', def.angle, 80);
    });
  }

  _bindKeys() {
    window.addEventListener('keydown', (e) => {
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','KeyW','KeyA','KeyS','KeyD','KeyJ','KeyK','KeyL','KeyI'].includes(e.code)) e.preventDefault();
      this.keys.add(e.code);
      if (e.code === 'Space' && !e.repeat) this.onJump();
      if (e.code === 'KeyJ' && !e.repeat && this.cooldowns.basic <= 0) {
        const def = this.getAimDefaults(); this.cooldowns.basic = this.cooldownMax.basic; this.onFire('basic', def.angle, def.power);
      }
      if (e.code === 'KeyK' && !e.repeat && this.cooldowns.skill1 <= 0) {
        const def = this.getAimDefaults(); this.cooldowns.skill1 = this.cooldownMax.skill1; this.onFire('skill1', def.angle, 72);
      }
      if (e.code === 'KeyL' && !e.repeat && this.cooldowns.skill2 <= 0) {
        const def = this.getAimDefaults(); this.cooldowns.skill2 = this.cooldownMax.skill2; this.onFire('skill2', def.angle, 68);
      }
      if (e.code === 'KeyI' && !e.repeat && this.ultiReady) {
        const def = this.getAimDefaults(); this.ultiReady = false; this.onFire('ulti', def.angle, 80);
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
  }

  setUltiEnergy(v) {
    const r = Math.max(0, Math.min(100, v));
    this.ultiReady = r >= 100;
    this.el.ultiFill.style.width = r + '%';
    this.el.ulti.classList.toggle('ready', this.ultiReady);
  }

  setCooldownMax(type, v) { this.cooldownMax[type] = v; }

  setCharacter(charDef) {
    if (!charDef?.skills) return;
    const s = charDef.skills;
    const shortName = (name, max = 10) => {
      const n = String(name || '').replace(/^Petasan\s+/,'').replace(/^Mercon\s+/,'');
      return n.length > max ? n.slice(0, max - 1) + '…' : n;
    };
    if (s.skill1) { this.cooldownMax.skill1 = s.skill1.cooldown ?? this.cooldownMax.skill1; this.el.skill1.querySelector('.sub').textContent = shortName(s.skill1.name); this.el.skill1.title = s.skill1.name; }
    if (s.skill2) { this.cooldownMax.skill2 = s.skill2.cooldown ?? this.cooldownMax.skill2; this.el.skill2.querySelector('.sub').textContent = shortName(s.skill2.name); this.el.skill2.title = s.skill2.name; }
    if (s.ulti)   { this.el.ulti.querySelector('.sub').textContent = shortName(s.ulti.name); this.el.ulti.title = s.ulti.name; }
    if (s.basic)  { this.cooldownMax.basic = s.basic.cooldown ?? this.cooldownMax.basic; }
    this.cooldowns.skill1 = 0; this.cooldowns.skill2 = 0; this.cooldowns.basic = 0; this.cooldowns.ulti = 0;
  }

  update(dt) {
    // keyboard move
    let kx = 0;
    if (this.keys.has('ArrowLeft') || this.keys.has('KeyA')) kx -= 1;
    if (this.keys.has('ArrowRight') || this.keys.has('KeyD')) kx += 1;
    if (kx !== 0) this.state.moveX = kx;
    else if (!this.joy.active) this.state.moveX = 0;

    // cooldowns
    for (const k of Object.keys(this.cooldowns)) {
      if (this.cooldowns[k] > 0) this.cooldowns[k] = Math.max(0, this.cooldowns[k] - dt);
      this._updateCdVisual(k);
    }
  }

  _updateCdVisual(type) {
    const map = { basic: this.el.attack, skill1: this.el.skill1, skill2: this.el.skill2 };
    const el = map[type];
    if (!el) return;
    const fg = el.querySelector('.cd-fg');
    const max = this.cooldownMax[type] || 1;
    const remain = this.cooldowns[type];
    const ratio = max > 0 ? remain / max : 0;
    const circ = 100.5;
    if (fg) fg.style.strokeDashoffset = String(circ * (1 - ratio));
    el.classList.toggle('cooling', remain > 0);
  }

  getState() { return this.state; }
}