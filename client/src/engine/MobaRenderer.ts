/**
 * Renderer Canvas2D side-view untuk fighting game Perang Petasan.
 * API `createMobaRenderer()` dipertahankan; koordinat z adalah ketinggian dari lantai.
 */
import {
  FIGHT_GROUND_Z,
  FIGHT_HALF_WIDTH,
  FIGHT_PLATFORMS,
  FIGHT_SPAWNS,
  FIGHT_WORLD_HEIGHT,
} from '@pp/shared';
import type {
  ClientMobaState,
  MobaEffectView,
  MobaHeroView,
  TeamId,
} from '@pp/shared';
import { HEROES, heroPortrait } from '../core/catalog.js';

export interface MobaRenderer {
  mount(container: HTMLElement): void;
  update(state: ClientMobaState | null, localHeroId: string, dtMs: number): void;
  screenToGround(clientX: number, clientY: number): { x: number; z: number } | null;
  setAimIndicator(x: number, z: number, visible: boolean): void;
  resize(): void;
  dispose(): void;
}

interface Particle {
  x: number;
  z: number;
  vx: number;
  vz: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
}

interface FloatingText {
  x: number;
  z: number;
  text: string;
  color: string;
  life: number;
  maxLife: number;
}

interface ExplosionFlash {
  x: number;
  z: number;
  life: number;
  maxLife: number;
  radius: number;
}

interface SkillFrame {
  index: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface SkillAnimationRow {
  label: string;
  fps: number;
  loop: boolean;
  durationMs: number;
  frames: SkillFrame[];
}

interface SkillAtlasManifest {
  image: string;
  sheetWidth: number;
  sheetHeight: number;
  frameWidth: number;
  frameHeight: number;
  frame_layout: { rows: Record<string, SkillAnimationRow> };
}

interface SkillAnimInstance {
  key: string;
  row: SkillAnimationRow;
  x: number;
  z: number;
  radius: number;
  dirX: number;
  life: number;
  maxLife: number;
}

interface UltimateCutIn {
  label: string;
  color: string;
  life: number;
  maxLife: number;
}

const TAU = Math.PI * 2;
const VIEW_HEIGHT = 33;

const TEAM_COLOR: Record<TeamId, string> = {
  team_merah: '#ef5350',
  team_putih: '#f5f5f5',
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function damp(current: number, target: number, lambda: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

function loadImage(src: string): HTMLImageElement {
  const image = new Image();
  image.src = src;
  return image;
}

function imageReady(image: HTMLImageElement): boolean {
  return image.complete && image.naturalWidth > 0;
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

class CanvasFightRenderer implements MobaRenderer {
  private container: HTMLElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;

  private width = 1;
  private height = 1;
  private dpr = 1;
  private scale = 10;
  private camX = 0;
  private camZ = 6;
  private shake = 0;
  private elapsedMs = 0;

  private localHeroId = '';
  private hasLocal = false;

  private aimX = 0;
  private aimZ = 0;
  private aimVisible = false;

  private readonly portraits = new Map<string, HTMLImageElement>();
  private readonly mapImage = loadImage('/assets/maps/design_map.png');
  private readonly explosionImage = loadImage('/assets/effects/efek_ledakan.png');
  private readonly skillAtlasImage = new Image();
  private readonly skillAnimations = new Map<string, SkillAnimationRow>();
  private skillAtlasReady = false;

  private readonly seenEffects = new Set<string>();
  private readonly particles: Particle[] = [];
  private readonly texts: FloatingText[] = [];
  private readonly skillAnims: SkillAnimInstance[] = [];
  private explosionFlash: ExplosionFlash | null = null;
  private ultimateCutIn: UltimateCutIn | null = null;

  private mounted = false;
  private disposed = false;
  private readonly handleResize = (): void => this.resize();

  mount(container: HTMLElement): void {
    if (this.mounted || this.disposed) return;
    this.container = container;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'game-canvas';
    this.canvas.style.display = 'block';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d', { alpha: false });
    if (!this.ctx) throw new Error('Canvas2D tidak tersedia');

    window.addEventListener('resize', this.handleResize);
    this.mounted = true;
    this.resize();
    void this.loadSkillAtlas();
  }

  private async loadSkillAtlas(): Promise<void> {
    try {
      const response = await fetch('/assets/effects/skills/manifest.json');
      if (!response.ok) return;
      const manifest = (await response.json()) as SkillAtlasManifest;
      this.skillAtlasImage.src = `/assets/effects/skills/${manifest.image}`;
      for (const [key, row] of Object.entries(manifest.frame_layout.rows)) {
        if (row.frames?.length) this.skillAnimations.set(key, row);
      }
      this.skillAtlasReady = true;
    } catch {
      // Atlas opsional: efek partikel Canvas2D tetap dipakai jika gagal dimuat.
    }
  }

  resize(): void {
    if (!this.container || !this.canvas || !this.ctx || this.disposed) return;
    this.width = Math.max(1, this.container.clientWidth || window.innerWidth);
    this.height = Math.max(1, this.container.clientHeight || window.innerHeight);
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const aspect = this.width / this.height;
    const viewHeight = aspect < 0.9 ? VIEW_HEIGHT * (0.9 / aspect) : VIEW_HEIGHT;
    this.scale = this.height / viewHeight;
    this.clampCamera();
  }

  screenToGround(clientX: number, clientY: number): { x: number; z: number } | null {
    if (!this.canvas) return null;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const sx = ((clientX - rect.left) / rect.width) * this.width;
    const sy = ((clientY - rect.top) / rect.height) * this.height;
    return {
      x: (sx - this.width / 2) / this.scale + this.camX,
      z: (this.height / 2 - sy) / this.scale + this.camZ,
    };
  }

  setAimIndicator(x: number, z: number, visible: boolean): void {
    this.aimX = x;
    this.aimZ = z;
    this.aimVisible = visible;
  }

  update(state: ClientMobaState | null, localHeroId: string, dtMs: number): void {
    if (!this.mounted || !this.ctx || this.disposed) return;
    this.localHeroId = localHeroId;
    const dt = clamp(dtMs, 0, 100);
    const dtSeconds = dt / 1000;
    this.elapsedMs += dt;

    if (state) {
      const local = state.heroes[localHeroId] ?? null;
      this.hasLocal = Boolean(local);
      if (local) {
        this.camX = damp(this.camX, local.x, 7, dtSeconds);
        this.camZ = damp(this.camZ, clamp(local.z + 5, 5, FIGHT_WORLD_HEIGHT - 8), 5, dtSeconds);
      }
      this.syncEffects(state);
    } else {
      this.hasLocal = false;
      this.camX = damp(this.camX, 0, 4, dtSeconds);
      this.camZ = damp(this.camZ, 6, 4, dtSeconds);
      this.seenEffects.clear();
    }

    this.shake = Math.max(0, this.shake - dtSeconds * 2.6);
    this.clampCamera();
    this.updateParticles(dtSeconds);
    this.draw(state);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener('resize', this.handleResize);
    this.particles.length = 0;
    this.texts.length = 0;
    this.skillAnims.length = 0;
    this.skillAnimations.clear();
    this.portraits.clear();
    this.seenEffects.clear();
    this.ultimateCutIn = null;
    this.canvas?.parentElement?.removeChild(this.canvas);
    this.canvas = null;
    this.ctx = null;
    this.container = null;
    this.mounted = false;
  }

  // -------------------------------------------------------------- state sync

  private syncEffects(state: ClientMobaState): void {
    const active = new Set<string>();
    for (const effect of Object.values(state.effects)) {
      active.add(effect.id);
      if (this.seenEffects.has(effect.id)) continue;
      this.seenEffects.add(effect.id);
      this.spawnEffect(effect);
    }
    for (const id of Array.from(this.seenEffects)) {
      if (active.has(id)) continue;
      this.seenEffects.delete(id);
    }
  }

  private spawnEffect(effect: MobaEffectView): void {
    const radius = Math.max(1, effect.radius);
    const color = effect.color || '#ffb74d';
    const skillKey = effect.skillKey;
    if (skillKey) {
      const row = this.skillAnimations.get(skillKey);
      if (row) {
        this.skillAnims.push({
          key: skillKey,
          row,
          x: effect.x,
          z: effect.z,
          radius,
          dirX: effect.dirX ?? 1,
          life: row.durationMs,
          maxLife: row.durationMs,
        });
        if (this.skillAnims.length > 16) this.skillAnims.shift();
        if (skillKey.endsWith(':ultimate')) {
          const heroId = skillKey.split(':')[0] ?? '';
          this.ultimateCutIn = {
            label: HEROES[heroId]?.name ?? heroId,
            color,
            life: 900,
            maxLife: 900,
          };
          this.shake = Math.min(1.6, this.shake + 0.8);
        }
      }
    }
    switch (effect.kind) {
      case 'explosion':
      case 'boss_spawn':
        this.spawnBurst(effect.x, effect.z, color, 18, radius, 9);
        this.explosionFlash = {
          x: effect.x,
          z: effect.z,
          radius,
          life: 360,
          maxLife: 360,
        };
        this.texts.push({
          x: effect.x,
          z: effect.z + 2,
          text: 'BOOM!',
          color,
          life: 850,
          maxLife: 850,
        });
        this.shake = Math.min(1.4, this.shake + 0.6);
        break;
      case 'ko':
        this.spawnBurst(effect.x, effect.z, '#33373b', 16, radius * 0.7, 5);
        this.texts.push({
          x: effect.x,
          z: effect.z + 2.4,
          text: 'K.O.!',
          color: '#ffd54f',
          life: 1000,
          maxLife: 1000,
        });
        this.shake = Math.min(1.4, this.shake + 0.4);
        break;
      case 'levelup':
        this.texts.push({
          x: effect.x,
          z: effect.z + 2,
          text: 'LEVEL UP!',
          color: '#ffe082',
          life: 1100,
          maxLife: 1100,
        });
        this.spawnBurst(effect.x, effect.z, '#ffe082', 12, 2, 4);
        break;
      case 'gold':
        this.texts.push({
          x: effect.x,
          z: effect.z + 2,
          text: '+ KOIN',
          color: '#ffd700',
          life: 900,
          maxLife: 900,
        });
        this.spawnBurst(effect.x, effect.z, '#ffd700', 10, 1.5, 3);
        break;
      case 'dash':
        this.spawnBurst(effect.x, effect.z, color, 10, 1.6, 5);
        break;
      case 'heal':
        this.spawnBurst(effect.x, effect.z, '#69f0ae', 10, 1.5, 3);
        break;
      default:
        this.spawnBurst(effect.x, effect.z, color, 7, Math.max(0.6, radius * 0.5), 4);
        break;
    }
  }

  private spawnBurst(
    x: number,
    z: number,
    color: string,
    count: number,
    radius: number,
    speed: number,
  ): void {
    for (let i = 0; i < count; i += 1) {
      if (this.particles.length > 420) this.particles.shift();
      const angle = Math.random() * TAU;
      const magnitude = speed * (0.35 + Math.random() * 0.7);
      const spread = radius * Math.sqrt(Math.random()) * 0.4;
      const life = 350 + Math.random() * 450;
      this.particles.push({
        x: x + Math.cos(angle) * spread,
        z: z + Math.sin(angle) * spread,
        vx: Math.cos(angle) * magnitude,
        vz: Math.sin(angle) * magnitude,
        life,
        maxLife: life,
        size: 0.16 + Math.random() * 0.28,
        color,
      });
    }
  }

  private updateParticles(dtSeconds: number): void {
    for (let i = this.particles.length - 1; i >= 0; i -= 1) {
      const particle = this.particles[i]!;
      particle.life -= dtSeconds * 1000;
      if (particle.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      particle.x += particle.vx * dtSeconds;
      particle.z += particle.vz * dtSeconds;
      particle.vz -= 12 * dtSeconds;
      const friction = Math.max(0, 1 - dtSeconds * 2.2);
      particle.vx *= friction;
    }
    for (let i = this.texts.length - 1; i >= 0; i -= 1) {
      const text = this.texts[i]!;
      text.life -= dtSeconds * 1000;
      text.z += dtSeconds * 2.4;
      if (text.life <= 0) this.texts.splice(i, 1);
    }
    if (this.explosionFlash) {
      this.explosionFlash.life -= dtSeconds * 1000;
      if (this.explosionFlash.life <= 0) this.explosionFlash = null;
    }
    for (let i = this.skillAnims.length - 1; i >= 0; i -= 1) {
      const anim = this.skillAnims[i]!;
      anim.life -= dtSeconds * 1000;
      if (anim.life <= 0) this.skillAnims.splice(i, 1);
    }
    if (this.ultimateCutIn) {
      this.ultimateCutIn.life -= dtSeconds * 1000;
      if (this.ultimateCutIn.life <= 0) this.ultimateCutIn = null;
    }
  }

  private clampCamera(): void {
    const halfW = this.width / (2 * this.scale);
    const halfH = this.height / (2 * this.scale);
    this.camX =
      halfW * 2 >= FIGHT_HALF_WIDTH * 2
        ? 0
        : clamp(this.camX, -FIGHT_HALF_WIDTH + halfW, FIGHT_HALF_WIDTH - halfW);
    this.camZ = clamp(this.camZ, halfH * 0.55, FIGHT_WORLD_HEIGHT - halfH * 0.35);
  }

  // ------------------------------------------------------------------ drawing

  private sx(x: number): number {
    return this.width / 2 + (x - this.camX) * this.scale;
  }

  private sy(z: number): number {
    return this.height / 2 - (z - this.camZ) * this.scale;
  }

  private draw(state: ClientMobaState | null): void {
    const ctx = this.ctx!;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);

    const shakeX = this.shake > 0 ? (Math.random() - 0.5) * this.shake * 2 : 0;
    const shakeY = this.shake > 0 ? (Math.random() - 0.5) * this.shake * 2 : 0;
    ctx.save();
    ctx.translate(shakeX, shakeY);

    this.drawSky();
    this.drawBackdrop();
    this.drawStage();
    if (state) {
      this.drawShadows(state);
      this.drawProjectiles(state);
      this.drawHeroes(state);
    }
    this.drawSkillAnims();
    this.drawParticles();
    this.drawExplosionFlash();
    this.drawTexts();
    this.drawUltimateCutIn();
    this.drawAim();
    ctx.restore();
  }

  private drawSky(): void {
    const ctx = this.ctx!;
    const gradient = ctx.createLinearGradient(0, 0, 0, this.height);
    gradient.addColorStop(0, '#7fd1f0');
    gradient.addColorStop(0.55, '#ffd9a0');
    gradient.addColorStop(1, '#f6b26b');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.width, this.height);

    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    for (let i = 0; i < 5; i += 1) {
      const x = ((i * 233 - this.camX * 8) % (this.width + 320)) - 160;
      const y = this.height * 0.12 + (i % 2) * 28;
      roundedRect(ctx, x, y, 110, 26, 13);
      ctx.fill();
    }

    ctx.fillStyle = 'rgba(46,110,74,0.28)';
    ctx.beginPath();
    ctx.moveTo(0, this.height);
    for (let x = 0; x <= this.width; x += 70) {
      const hill = this.height * 0.58 + Math.sin((x + this.camX * 10) / 130) * 26;
      ctx.lineTo(x, hill);
    }
    ctx.lineTo(this.width, this.height);
    ctx.closePath();
    ctx.fill();
  }

  private drawBackdrop(): void {
    const ctx = this.ctx!;
    if (imageReady(this.mapImage)) {
      ctx.save();
      ctx.globalAlpha = 0.1;
      const y = this.sy(FIGHT_WORLD_HEIGHT);
      const h = this.sy(0) - y;
      const drift = -this.camX * this.scale * 0.08;
      ctx.drawImage(
        this.mapImage,
        this.sx(-FIGHT_HALF_WIDTH) + drift,
        y,
        FIGHT_HALF_WIDTH * 2 * this.scale,
        h,
      );
      ctx.restore();
    }

    this.drawFarKampung();
    this.drawFestivalLayer();

    for (const team of ['team_merah', 'team_putih'] as const) {
      const spawn = FIGHT_SPAWNS[team];
      const x = this.sx(spawn.x);
      const y = this.sy(0);
      ctx.fillStyle = team === 'team_merah' ? 'rgba(239,83,80,0.28)' : 'rgba(245,245,245,0.45)';
      ctx.fillRect(x - 8 * this.scale, y - 10 * this.scale, 16 * this.scale, 10 * this.scale);
      ctx.strokeStyle = team === 'team_merah' ? '#b71c1c' : '#9e9e9e';
      ctx.lineWidth = 2;
      ctx.strokeRect(x - 8 * this.scale, y - 10 * this.scale, 16 * this.scale, 10 * this.scale);
    }
  }

  /** Siluet rumah kampung di kejauhan (parallax lambat). */
  private drawFarKampung(): void {
    const ctx = this.ctx!;
    const baseY = this.sy(6.2);
    const tile = 13 * this.scale;
    const offset = (((-this.camX * this.scale * 0.12) % tile) + tile) % tile;
    ctx.save();
    ctx.globalAlpha = 0.4;
    for (let i = -2; i <= Math.ceil(this.width / tile) + 2; i += 1) {
      const x = i * tile + offset;
      const w = tile * 0.62;
      const h = (2.1 + (Math.abs(i) % 3) * 0.45) * this.scale;
      ctx.fillStyle = '#2e5d49';
      ctx.fillRect(x, baseY - h, w, h);
      ctx.beginPath();
      ctx.moveTo(x - 0.1 * this.scale, baseY - h);
      ctx.lineTo(x + w / 2, baseY - h - 1.2 * this.scale);
      ctx.lineTo(x + w + 0.1 * this.scale, baseY - h);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(255,224,130,0.42)';
      ctx.fillRect(x + w * 0.24, baseY - h * 0.62, w * 0.18, h * 0.22);
      ctx.fillRect(x + w * 0.58, baseY - h * 0.62, w * 0.18, h * 0.22);
    }
    ctx.restore();
  }

  /** Gapura, kios, dan lampu festival di lapisan tengah (parallax sedang). */
  private drawFestivalLayer(): void {
    const ctx = this.ctx!;
    const drift = -this.camX * this.scale * 0.32;
    const baseY = this.sy(3.2);
    const gateX = this.width / 2 + drift;
    const gateW = 9 * this.scale;
    const gateH = 6.4 * this.scale;

    ctx.save();
    ctx.globalAlpha = 0.78;
    ctx.fillStyle = '#8d5524';
    ctx.fillRect(gateX - gateW / 2, baseY - gateH, 1.1 * this.scale, gateH);
    ctx.fillRect(gateX + gateW / 2 - 1.1 * this.scale, baseY - gateH, 1.1 * this.scale, gateH);
    ctx.fillStyle = '#b71c1c';
    ctx.fillRect(gateX - gateW / 2 - 0.35 * this.scale, baseY - gateH, gateW + 0.7 * this.scale, 1 * this.scale);
    ctx.fillStyle = '#6d4c41';
    ctx.beginPath();
    ctx.moveTo(gateX - gateW / 2 - 0.8 * this.scale, baseY - gateH);
    ctx.lineTo(gateX, baseY - gateH - 1.6 * this.scale);
    ctx.lineTo(gateX + gateW / 2 + 0.8 * this.scale, baseY - gateH);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#fff8e1';
    roundedRect(ctx, gateX - 2.6 * this.scale, baseY - gateH + 1.25 * this.scale, 5.2 * this.scale, 1.15 * this.scale, 4);
    ctx.fill();
    ctx.fillStyle = '#b71c1c';
    ctx.font = `800 ${Math.max(9, 0.46 * this.scale)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('GAPURA KAMPUNG', gateX, baseY - gateH + 2.05 * this.scale);
    ctx.restore();

    const tile = 20 * this.scale;
    const offset = (((drift * 1.15) % tile) + tile) % tile;
    for (let i = -2; i <= Math.ceil(this.width / tile) + 2; i += 1) {
      this.drawKios(i * tile + offset, baseY + 0.6 * this.scale);
    }
    this.drawFestivalLights();
  }

  private drawKios(x: number, baseY: number): void {
    const ctx = this.ctx!;
    const w = 5.2 * this.scale;
    const h = 2.6 * this.scale;
    ctx.save();
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = '#5d4037';
    ctx.fillRect(x - w / 2, baseY - h, 0.32 * this.scale, h);
    ctx.fillRect(x + w / 2 - 0.32 * this.scale, baseY - h, 0.32 * this.scale, h);
    const stripes = 6;
    for (let s = 0; s < stripes; s += 1) {
      ctx.fillStyle = s % 2 === 0 ? '#e53935' : '#fff8e1';
      ctx.fillRect(x - w / 2 + (s * w) / stripes, baseY - h - 0.7 * this.scale, w / stripes, 0.7 * this.scale);
    }
    ctx.fillStyle = '#8d6e63';
    ctx.fillRect(x - w / 2, baseY - 1 * this.scale, w, 0.42 * this.scale);
    ctx.restore();
  }

  private drawFestivalLights(): void {
    const ctx = this.ctx!;
    const y = this.height * 0.1;
    const shift = ((-this.camX * 0.55 * this.scale) % (8 * this.scale) + 8 * this.scale) % (8 * this.scale);
    const colors = ['#ffd54f', '#ef5350', '#4fc3f7', '#81c784'];
    ctx.save();
    ctx.strokeStyle = 'rgba(60,50,40,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-shift, y);
    ctx.quadraticCurveTo(this.width / 2, y + 46, this.width + shift, y);
    ctx.stroke();
    for (let i = 0; i <= 18; i += 1) {
      const t = i / 18;
      const x = -shift + t * (this.width + shift * 2);
      const bulbY = y + Math.sin(t * Math.PI) * 42;
      const color = colors[i % colors.length]!;
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(x, bulbY, 3.2, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawStage(): void {
    const ctx = this.ctx!;
    const groundY = this.sy(FIGHT_GROUND_Z);
    const left = this.sx(-FIGHT_HALF_WIDTH);
    const worldW = FIGHT_HALF_WIDTH * 2 * this.scale;

    ctx.fillStyle = '#5d4037';
    ctx.fillRect(left, groundY, worldW, 10 * this.scale);
    ctx.fillStyle = '#8d6e63';
    ctx.fillRect(left, groundY + 0.55 * this.scale, worldW, 9 * this.scale);
    ctx.strokeStyle = 'rgba(62,39,35,0.28)';
    ctx.lineWidth = 1;
    for (let x = left; x <= left + worldW; x += 1.6 * this.scale) {
      ctx.beginPath();
      ctx.moveTo(x, groundY + 0.55 * this.scale);
      ctx.lineTo(x, groundY + 9.5 * this.scale);
      ctx.stroke();
    }
    ctx.fillStyle = '#66bb6a';
    ctx.fillRect(left, groundY - 0.35 * this.scale, worldW, 0.7 * this.scale);
    const stripe = 0.8 * this.scale;
    for (let x = left, i = 0; x < left + worldW; x += stripe, i += 1) {
      ctx.fillStyle = i % 2 === 0 ? '#e53935' : '#fff8e1';
      ctx.fillRect(x, groundY + 0.15 * this.scale, stripe, 0.4 * this.scale);
    }

    for (const platform of FIGHT_PLATFORMS) {
      const x = this.sx(platform.x - platform.w / 2);
      const y = this.sy(platform.z);
      const w = platform.w * this.scale;
      const h = 0.9 * this.scale;
      ctx.fillStyle = 'rgba(62,39,35,0.5)';
      ctx.fillRect(x + w * 0.12, y + h, 0.3 * this.scale, 1.2 * this.scale);
      ctx.fillRect(x + w * 0.82, y + h, 0.3 * this.scale, 1.2 * this.scale);
      ctx.fillStyle = '#8d5524';
      roundedRect(ctx, x, y, w, h, 5);
      ctx.fill();
      ctx.strokeStyle = '#5d4037';
      ctx.lineWidth = 2;
      ctx.stroke();
      const stripes = 8;
      for (let s = 0; s < stripes; s += 1) {
        ctx.fillStyle = s % 2 === 0 ? '#e53935' : '#fff8e1';
        ctx.fillRect(x + (s * w) / stripes, y - 0.25 * this.scale, w / stripes, 0.45 * this.scale);
      }
      ctx.fillStyle = 'rgba(18,22,30,0.72)';
      const labelW = Math.max(44, platform.label.length * 0.42 * this.scale + 14);
      roundedRect(ctx, x + w / 2 - labelW / 2, y + h + 5, labelW, 17, 4);
      ctx.fill();
      ctx.fillStyle = '#fff8e1';
      ctx.font = `600 ${Math.max(9, 0.45 * this.scale)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(platform.label, x + w / 2, y + h + 17);
    }

    const ringX = this.sx(0);
    const ringY = this.sy(FIGHT_GROUND_Z + 4.6);
    ctx.save();
    ctx.globalAlpha = 0.45;
    ctx.strokeStyle = '#ffd54f';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(ringX, ringY, 5.2 * this.scale, Math.PI, TAU);
    ctx.stroke();
    ctx.globalAlpha = 0.25;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(ringX, ringY, 4 * this.scale, Math.PI, TAU);
    ctx.stroke();
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = '#fff8e1';
    ctx.font = `800 ${Math.max(9, 0.45 * this.scale)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('RING KAMPUNG', ringX, ringY + 0.9 * this.scale);
    ctx.restore();
  }

  private drawShadows(state: ClientMobaState): void {
    const ctx = this.ctx!;
    ctx.save();
    ctx.fillStyle = 'rgba(20,25,20,0.22)';
    for (const hero of Object.values(state.heroes)) {
      if (!hero.alive && hero.stocks <= 0) continue;
      const ground = this.shadowZ(hero);
      ctx.beginPath();
      ctx.ellipse(this.sx(hero.x), this.sy(ground), 1.3 * this.scale, 0.28 * this.scale, 0, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  private shadowZ(hero: MobaHeroView): number {
    let surface = FIGHT_GROUND_Z;
    for (const platform of FIGHT_PLATFORMS) {
      if (Math.abs(hero.x - platform.x) > platform.w / 2 + 1.1) continue;
      if (platform.z <= hero.z + 0.1 && platform.z > surface) surface = platform.z;
    }
    return surface;
  }

  private drawProjectiles(state: ClientMobaState): void {
    const ctx = this.ctx!;
    for (const projectile of Object.values(state.projectiles)) {
      const x = this.sx(projectile.x);
      const y = this.sy(projectile.z);
      const r = Math.max(4, projectile.radius * this.scale);
      ctx.save();
      ctx.shadowColor = projectile.color;
      ctx.shadowBlur = 12;
      ctx.fillStyle = projectile.color;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawHeroes(state: ClientMobaState): void {
    const sorted = Object.values(state.heroes).sort((a, b) => a.z - b.z);
    for (const hero of sorted) this.drawHero(hero);
  }

  private drawHero(hero: MobaHeroView): void {
    const ctx = this.ctx!;
    const x = this.sx(hero.x);
    const feetY = this.sy(hero.z);
    const bodyW = 2.2 * this.scale;
    const bodyH = 2.6 * this.scale;
    const topY = feetY - bodyH;
    const eliminated = !hero.alive && hero.stocks <= 0;
    const respawning = !hero.alive && hero.stocks > 0;
    const local = hero.id === this.localHeroId && this.hasLocal;
    const theme = HEROES[hero.heroId]?.colorTheme ?? TEAM_COLOR[hero.team];

    ctx.save();
    if (eliminated) ctx.globalAlpha = 0.28;
    else if (respawning) ctx.globalAlpha = 0.45;
    else if (this.elapsedMs < hero.hitstunUntil) ctx.globalAlpha = 0.72;

    if (local) {
      ctx.strokeStyle = '#ffd54f';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(x, feetY - 0.1 * this.scale, 1.6 * this.scale, 0.45 * this.scale, 0, 0, TAU);
      ctx.stroke();
    }

    ctx.fillStyle = hero.team === 'team_merah' ? '#c62828' : '#eceff1';
    roundedRect(ctx, x - bodyW / 2, topY, bodyW, bodyH, 0.55 * this.scale);
    ctx.fill();
    ctx.strokeStyle = TEAM_COLOR[hero.team];
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.fillStyle = theme;
    roundedRect(ctx, x - bodyW / 2, topY + bodyH * 0.58, bodyW, bodyH * 0.42, 0.35 * this.scale);
    ctx.fill();

    const portrait = this.portraitFor(hero.heroId);
    const faceR = 0.72 * this.scale;
    if (imageReady(portrait)) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, topY + bodyH * 0.34, faceR, 0, TAU);
      ctx.clip();
      ctx.drawImage(portrait, x - faceR, topY + bodyH * 0.34 - faceR, faceR * 2, faceR * 2);
      ctx.restore();
    }
    ctx.strokeStyle = '#fffde7';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, topY + bodyH * 0.34, faceR, 0, TAU);
    ctx.stroke();

    ctx.fillStyle = '#111827';
    const arrowX = x + hero.facing * (bodyW / 2 + 0.35 * this.scale);
    ctx.beginPath();
    ctx.moveTo(arrowX, feetY - bodyH * 0.55);
    ctx.lineTo(arrowX + hero.facing * 0.55 * this.scale, feetY - bodyH * 0.42);
    ctx.lineTo(arrowX, feetY - bodyH * 0.29);
    ctx.closePath();
    ctx.fill();

    const barW = 2.6 * this.scale;
    const barY = topY - 0.75 * this.scale;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(x - barW / 2, barY, barW, 0.32 * this.scale);
    const ratio = clamp(hero.hp / Math.max(1, hero.maxHp), 0, 1);
    ctx.fillStyle = ratio < 0.3 ? '#ff5252' : '#69f0ae';
    ctx.fillRect(x - barW / 2, barY, barW * ratio, 0.32 * this.scale);

    for (let i = 0; i < hero.maxStocks; i += 1) {
      ctx.fillStyle = i < hero.stocks ? '#ffd54f' : 'rgba(255,255,255,0.25)';
      ctx.beginPath();
      ctx.arc(x - (hero.maxStocks - 1) * 0.32 * this.scale + i * 0.64 * this.scale, barY - 0.45 * this.scale, 0.2 * this.scale, 0, TAU);
      ctx.fill();
    }

    ctx.font = `600 ${Math.max(9, 0.42 * this.scale)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#0f172a';
    ctx.fillText(hero.name, x, barY - 0.85 * this.scale);

    if (hero.combo > 1 && hero.id === this.localHeroId) {
      ctx.fillStyle = '#ffeb3b';
      ctx.font = `800 ${Math.max(11, 0.55 * this.scale)}px sans-serif`;
      ctx.fillText(`${hero.combo}x COMBO`, x, topY - 1.6 * this.scale);
    }

    if (respawning) {
      ctx.fillStyle = '#0f172a';
      ctx.font = `700 ${Math.max(10, 0.5 * this.scale)}px sans-serif`;
      ctx.fillText(`RESPAWN ${Math.ceil(hero.respawnIn / 1000)}s`, x, topY - 1.3 * this.scale);
    }
    ctx.restore();
  }

  private portraitFor(heroId: string): HTMLImageElement {
    let image = this.portraits.get(heroId);
    if (!image) {
      image = loadImage(heroPortrait(heroId));
      this.portraits.set(heroId, image);
    }
    return image;
  }

  private drawSkillAnims(): void {
    if (!this.skillAtlasReady || !imageReady(this.skillAtlasImage)) return;
    const ctx = this.ctx!;
    ctx.save();
    for (const anim of this.skillAnims) {
      const elapsed = anim.maxLife - anim.life;
      const frameCount = anim.row.frames.length;
      const frameDuration = anim.maxLife / frameCount;
      const index = anim.row.loop
        ? Math.floor(elapsed / frameDuration) % frameCount
        : Math.min(frameCount - 1, Math.floor(elapsed / frameDuration));
      const frame = anim.row.frames[index];
      if (!frame) continue;

      const size = clamp(anim.radius * 3.6, 3.5, 20) * this.scale;
      const x = this.sx(anim.x) - size / 2;
      const y = this.sy(anim.z) - size / 2;
      ctx.globalAlpha = clamp(anim.life / (anim.maxLife * 0.35), 0, 1);
      ctx.save();
      if (anim.dirX < 0) {
        ctx.translate(x + size, y);
        ctx.scale(-1, 1);
        ctx.drawImage(this.skillAtlasImage, frame.x, frame.y, frame.w, frame.h, 0, 0, size, size);
      } else {
        ctx.drawImage(this.skillAtlasImage, frame.x, frame.y, frame.w, frame.h, x, y, size, size);
      }
      ctx.restore();
    }
    ctx.restore();
  }

  private drawUltimateCutIn(): void {
    if (!this.ultimateCutIn) return;
    const ctx = this.ctx!;
    const { label, color, life, maxLife } = this.ultimateCutIn;
    const progress = clamp(life / maxLife, 0, 1);
    const appear = clamp((1 - progress) * 8, 0, 1);
    const alpha = Math.min(1, appear, progress * 3);
    const slide = -(1 - appear) * this.width * 0.6;
    const bandWidth = Math.min(this.width * 0.82, 760);
    const bandHeight = Math.max(62, this.height * 0.12);
    const centerY = this.height * 0.3;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(slide, centerY);
    ctx.rotate(-0.07);
    ctx.fillStyle = 'rgba(12,16,24,0.88)';
    ctx.beginPath();
    ctx.moveTo(-bandWidth / 2 + 26, -bandHeight / 2);
    ctx.lineTo(bandWidth / 2, -bandHeight / 2);
    ctx.lineTo(bandWidth / 2 - 26, bandHeight / 2);
    ctx.lineTo(-bandWidth / 2, bandHeight / 2);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffeb3b';
    ctx.font = `900 ${Math.max(18, bandHeight * 0.38)}px sans-serif`;
    ctx.fillText('ULTIMATE!', 0, -4);
    ctx.fillStyle = '#ffffff';
    ctx.font = `800 ${Math.max(13, bandHeight * 0.24)}px sans-serif`;
    ctx.fillText(label, 0, bandHeight * 0.32);
    ctx.restore();
  }

  private drawParticles(): void {
    const ctx = this.ctx!;
    for (const particle of this.particles) {
      const alpha = clamp(particle.life / particle.maxLife, 0, 1);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = particle.color;
      ctx.beginPath();
      ctx.arc(this.sx(particle.x), this.sy(particle.z), particle.size * this.scale, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private drawExplosionFlash(): void {
    if (!this.explosionFlash || !imageReady(this.explosionImage)) return;
    const ctx = this.ctx!;
    const progress = 1 - this.explosionFlash.life / this.explosionFlash.maxLife;
    const size = this.explosionFlash.radius * 2.6 * this.scale * (0.6 + progress * 0.7);
    const x = this.sx(this.explosionFlash.x) - size / 2;
    const y = this.sy(this.explosionFlash.z) - size / 2;
    ctx.save();
    ctx.globalAlpha = Math.max(0, 0.9 - progress * 0.9);
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(this.explosionImage, x, y, size, size);
    ctx.restore();
  }

  private drawTexts(): void {
    const ctx = this.ctx!;
    ctx.textAlign = 'center';
    for (const text of this.texts) {
      const alpha = clamp(text.life / text.maxLife, 0, 1);
      ctx.globalAlpha = alpha;
      ctx.font = `900 ${Math.max(13, 0.7 * this.scale)}px sans-serif`;
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(15,23,42,0.8)';
      ctx.strokeText(text.text, this.sx(text.x), this.sy(text.z));
      ctx.fillStyle = text.color;
      ctx.fillText(text.text, this.sx(text.x), this.sy(text.z));
    }
    ctx.globalAlpha = 1;
  }

  private drawAim(): void {
    if (!this.aimVisible) return;
    const ctx = this.ctx!;
    const x = this.sx(this.aimX);
    const y = this.sy(this.aimZ);
    ctx.save();
    ctx.strokeStyle = '#fff176';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 14, y);
    ctx.lineTo(x - 4, y);
    ctx.moveTo(x + 4, y);
    ctx.lineTo(x + 14, y);
    ctx.moveTo(x, y - 14);
    ctx.lineTo(x, y - 4);
    ctx.moveTo(x, y + 4);
    ctx.lineTo(x, y + 14);
    ctx.stroke();
    ctx.restore();
  }
}

export function createMobaRenderer(): MobaRenderer {
  return new CanvasFightRenderer();
}
