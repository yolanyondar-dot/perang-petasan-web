/**
 * Renderer Canvas2D fighting untuk Perang Petasan.
 *
 * Konvensi docs/stage-background.md + docs/sprite-runtime.md:
 * - stage = satu gambar 16:9, kamera diam, tanpa parallax/scrolling
 * - hero = sprite frame-based dari atlas + manifest, anchor di kaki, flip di anchor
 * - efek hit = flash, blink, percikan, shake, hit-stop ringan (lihat docs/hit-reactions.md)
 *
 * API `createMobaRenderer()` dipertahankan.
 */
import {
  FIGHT_GROUND_Z,
  FIGHT_HALF_WIDTH,
  FIGHT_PLATFORMS,
  FIGHT_SPAWNS,
  FIGHT_WORLD_HEIGHT,
  FIGHT_WORLD_WIDTH,
} from '@pp/shared';
import type {
  ClientMobaState,
  MobaEffectView,
  MobaHeroView,
  TeamId,
} from '@pp/shared';
import { HEROES } from '../core/catalog.js';

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

interface FrameRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface AtlasAnimRow {
  label?: string;
  fps?: number;
  loop?: boolean;
  durationMs?: number;
  frames: FrameRect[];
}

interface SkillAtlasManifest {
  image: string;
  sheetWidth: number;
  sheetHeight: number;
  frameWidth: number;
  frameHeight: number;
  frame_layout: { rows: Record<string, AtlasAnimRow> };
}

interface SpriteAtlasManifest {
  image: string;
  sheetWidth: number;
  sheetHeight: number;
  cell: { w: number; h: number; anchorX: number; anchorY: number };
  frame_layout: { rows: Record<string, AtlasAnimRow> };
  animation: { rows: Record<string, { fps: number; loop: boolean; durationMs: number }> };
}

interface SkillAnimInstance {
  key: string;
  row: AtlasAnimRow;
  x: number;
  z: number;
  radius: number;
  dirX: number;
  life: number;
  maxLife: number;
}

interface SpriteTrack {
  key: string;
  startedAt: number;
}

interface HitReaction {
  flashUntil: number;
  blinkUntil: number;
}

interface UltimateCutIn {
  label: string;
  color: string;
  life: number;
  maxLife: number;
}

const TAU = Math.PI * 2;
const STAGE_WIDTH = 1280;
const STAGE_HEIGHT = 720;
/** Garis pijakan di stage-kampung.png (pita lantai mulai ~75% tinggi). */
const STAGE_GROUND_Y = 548;
const SPRITE_CELL = 128;
/** Tinggi sel sprite dalam world unit; dipakai supaya skala hero konsisten. */
const SPRITE_WORLD_SIZE = 8.5;

const TEAM_COLOR: Record<TeamId, string> = {
  team_merah: '#ef5350',
  team_putih: '#f5f5f5',
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
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
  /** Piksel per world unit. */
  private scale = 10;
  private stageScale = 1;
  private stageX = 0;
  private stageY = 0;
  private stageW = STAGE_WIDTH;
  private stageH = STAGE_HEIGHT;
  private groundY = 0;
  private shake = 0;
  private elapsedMs = 0;
  /** Waktu animasi lokal yang ikut berhenti saat hit-stop. */
  private animMs = 0;
  private serverMs = 0;

  private localHeroId = '';
  private displayState: ClientMobaState | null = null;
  private frozenState: ClientMobaState | null = null;
  private freezeUntil = 0;

  private aimX = 0;
  private aimZ = 0;
  private aimVisible = false;

  private readonly stageImage = loadImage('/assets/maps/stage-kampung.png');
  private readonly explosionImage = loadImage('/assets/effects/efek_ledakan.png');
  private readonly skillAtlasImage = new Image();
  private readonly skillAnimations = new Map<string, AtlasAnimRow>();
  private skillAtlasReady = false;

  private readonly spriteAtlasImage = new Image();
  private readonly spriteAnimations = new Map<string, AtlasAnimRow>();
  private spriteAtlasReady = false;
  private spriteAnchorX = 64;
  private spriteAnchorY = 116;
  private readonly flashCanvas = document.createElement('canvas');
  private readonly flashCtx: CanvasRenderingContext2D | null;

  private readonly seenEffects = new Set<string>();
  private readonly particles: Particle[] = [];
  private readonly texts: FloatingText[] = [];
  private readonly skillAnims: SkillAnimInstance[] = [];
  private readonly previousHp = new Map<string, number>();
  private readonly hitReactions = new Map<string, HitReaction>();
  private readonly spriteTracks = new Map<string, SpriteTrack>();
  private readonly ultimateUntil = new Map<string, number>();
  private explosionFlash: ExplosionFlash | null = null;
  private ultimateCutIn: UltimateCutIn | null = null;

  private mounted = false;
  private disposed = false;
  private readonly handleResize = (): void => this.resize();

  constructor() {
    this.flashCanvas.width = SPRITE_CELL;
    this.flashCanvas.height = SPRITE_CELL;
    this.flashCtx = this.flashCanvas.getContext('2d');
  }

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
    void this.loadAtlases();
  }

  private async loadAtlases(): Promise<void> {
    await Promise.all([this.loadSkillAtlas(), this.loadSpriteAtlas()]);
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

  private async loadSpriteAtlas(): Promise<void> {
    try {
      const response = await fetch('/assets/characters/sprites/manifest.json');
      if (!response.ok) return;
      const manifest = (await response.json()) as SpriteAtlasManifest;
      this.spriteAtlasImage.src = `/assets/characters/sprites/${manifest.image}`;
      this.spriteAnchorX = manifest.cell.anchorX;
      this.spriteAnchorY = manifest.cell.anchorY;
      for (const [key, row] of Object.entries(manifest.frame_layout.rows)) {
        const timing = manifest.animation.rows[key];
        if (!row.frames?.length) continue;
        this.spriteAnimations.set(key, {
          ...row,
          fps: timing?.fps ?? row.fps ?? 8,
          loop: timing?.loop ?? row.loop ?? false,
          durationMs: timing?.durationMs ?? row.durationMs,
        });
      }
      this.spriteAtlasReady = true;
    } catch {
      // Fallback capsule dipakai jika manifest/atlas karakter tidak tersedia.
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

    // Rasio stage dipertahankan; kelebihan tinggi diisi langit/tanah, bukan diparallax.
    this.stageScale = this.width / STAGE_WIDTH;
    this.stageW = STAGE_WIDTH * this.stageScale;
    this.stageH = STAGE_HEIGHT * this.stageScale;
    this.stageX = (this.width - this.stageW) / 2;
    this.stageY = (this.height - this.stageH) / 2;
    this.groundY = this.stageY + STAGE_GROUND_Y * this.stageScale;
    this.scale = this.stageW / FIGHT_WORLD_WIDTH;
  }

  screenToGround(clientX: number, clientY: number): { x: number; z: number } | null {
    if (!this.canvas) return null;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const sx = ((clientX - rect.left) / rect.width) * this.width;
    const sy = ((clientY - rect.top) / rect.height) * this.height;
    return {
      x: clamp((sx - this.width / 2) / this.scale, -FIGHT_HALF_WIDTH, FIGHT_HALF_WIDTH),
      z: clamp((this.groundY - sy) / this.scale, 0, FIGHT_WORLD_HEIGHT),
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
    this.elapsedMs += dt;
    if (state) this.serverMs = state.elapsedMs;

    if (state) {
      this.syncEffects(state);
      this.detectHitReactions(state);
    } else {
      this.displayState = null;
      this.frozenState = null;
      this.freezeUntil = 0;
      this.seenEffects.clear();
      this.previousHp.clear();
      this.hitReactions.clear();
      this.spriteTracks.clear();
      this.ultimateUntil.clear();
    }

    const frozen = this.elapsedMs < this.freezeUntil;
    if (!frozen) {
      this.displayState = state;
      this.frozenState = null;
    } else if (!this.frozenState && state) {
      this.frozenState = state;
    }
    const drawState = frozen ? this.frozenState ?? state : state;

    // Hit-stop menghentikan animasi/partikel, tetapi tidak mengubah state jaringan.
    const dtSeconds = frozen ? 0 : dt / 1000;
    this.animMs += dtSeconds * 1000;
    this.shake = Math.max(0, this.shake - dtSeconds * 28);
    this.updateParticles(dtSeconds);
    this.draw(drawState);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener('resize', this.handleResize);
    this.particles.length = 0;
    this.texts.length = 0;
    this.skillAnims.length = 0;
    this.skillAnimations.clear();
    this.spriteAnimations.clear();
    this.previousHp.clear();
    this.hitReactions.clear();
    this.spriteTracks.clear();
    this.ultimateUntil.clear();
    this.seenEffects.clear();
    this.ultimateCutIn = null;
    this.canvas?.parentElement?.removeChild(this.canvas);
    this.canvas = null;
    this.ctx = null;
    this.container = null;
    this.mounted = false;
  }

  // -------------------------------------------------------------- state sync

  /** Hit-stop hanya membekukan tampilan; state server/network tetap berjalan. */
  private detectHitReactions(state: ClientMobaState): void {
    const present = new Set<string>();
    for (const hero of Object.values(state.heroes)) {
      present.add(hero.id);
      const previous = this.previousHp.get(hero.id);
      if (previous !== undefined && hero.hp < previous - 0.01) {
        const amount = previous - hero.hp;
        const heavy = amount >= Math.max(16, hero.maxHp * 0.12);
        const local = hero.id === this.localHeroId;
        this.hitReactions.set(hero.id, {
          flashUntil: this.elapsedMs + (heavy ? 190 : 120),
          blinkUntil: this.elapsedMs + 900,
        });
        this.freezeUntil = Math.max(this.freezeUntil, this.elapsedMs + (heavy ? 90 : 45));
        this.frozenState = state;
        this.shake = Math.min(9, this.shake + (heavy ? 5.5 : 2.5));
        this.spawnBurst(
          hero.x,
          hero.z + 1.4,
          local ? '#ff5252' : '#ffffff',
          heavy ? 18 : 10,
          heavy ? 1.8 : 1.3,
          heavy ? 7 : 5,
        );
      }
      this.previousHp.set(hero.id, hero.hp);
    }
    for (const id of Array.from(this.previousHp.keys())) {
      if (!present.has(id)) this.previousHp.delete(id);
    }
  }

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
          life: row.durationMs ?? 600,
          maxLife: row.durationMs ?? 600,
        });
        if (this.skillAnims.length > 16) this.skillAnims.shift();
      }
      if (skillKey.endsWith(':ultimate')) {
        const heroId = skillKey.split(':')[0] ?? '';
        this.ultimateUntil.set(heroId, this.serverMs + 700);
        this.ultimateCutIn = {
          label: HEROES[heroId]?.name ?? heroId,
          color,
          life: 900,
          maxLife: 900,
        };
        this.shake = Math.min(9, this.shake + 4.2);
      }
    }
    switch (effect.kind) {
      case 'explosion':
      case 'boss_spawn':
        this.spawnBurst(effect.x, effect.z, color, 18, radius, 9);
        this.explosionFlash = { x: effect.x, z: effect.z, radius, life: 360, maxLife: 360 };
        this.texts.push({
          x: effect.x,
          z: effect.z + 2,
          text: 'BOOM!',
          color,
          life: 850,
          maxLife: 850,
        });
        this.shake = Math.min(9, this.shake + 3.6);
        break;
      case 'hit':
        this.spawnBurst(effect.x, effect.z, '#fffde7', 10, 1.5, 6);
        this.shake = Math.min(9, this.shake + 1.2);
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
        this.shake = Math.min(9, this.shake + 2.2);
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
      const life = 260 + Math.random() * 380;
      this.particles.push({
        x: x + Math.cos(angle) * spread,
        z: z + Math.sin(angle) * spread,
        vx: Math.cos(angle) * magnitude,
        vz: Math.sin(angle) * magnitude,
        life,
        maxLife: life,
        size: 0.12 + Math.random() * 0.2,
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

  // ------------------------------------------------------------------ drawing

  private sx(x: number): number {
    return this.width / 2 + x * this.scale;
  }

  private sy(z: number): number {
    return this.groundY - z * this.scale;
  }

  private draw(state: ClientMobaState | null): void {
    const ctx = this.ctx!;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);

    // Overscan kecil supaya shake tidak membuka pinggiran kosong.
    const shakeX = this.shake > 0 ? (Math.random() - 0.5) * this.shake * 2 : 0;
    const shakeY = this.shake > 0 ? (Math.random() - 0.5) * this.shake * 2 : 0;
    ctx.save();
    ctx.translate(shakeX, shakeY);

    this.drawStage();
    this.drawPlatforms();
    this.drawSpawnMarkers();
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

  /** Satu gambar stage utuh; tidak ada layer yang bergerak mengikuti kamera. */
  private drawStage(): void {
    const ctx = this.ctx!;
    const sky = ctx.createLinearGradient(0, 0, 0, this.height);
    sky.addColorStop(0, '#74c9ec');
    sky.addColorStop(0.65, '#bfe3ef');
    sky.addColorStop(1, '#f6b26b');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, this.width, this.height);

    const bottomY = this.stageY + this.stageH;
    if (bottomY < this.height) {
      ctx.fillStyle = '#3f6f4a';
      ctx.fillRect(0, bottomY - 1, this.width, this.height - bottomY + 1);
    }

    if (imageReady(this.stageImage)) {
      const pad = 8;
      ctx.drawImage(
        this.stageImage,
        this.stageX - pad,
        this.stageY - pad,
        this.stageW + pad * 2,
        this.stageH + pad * 2,
      );
      return;
    }

    // Fallback saat gambar stage belum termuat.
    ctx.fillStyle = 'rgba(79,132,104,0.55)';
    ctx.fillRect(0, this.groundY - 3 * this.scale, this.width, 3 * this.scale);
    ctx.fillStyle = '#b0855b';
    ctx.fillRect(0, this.groundY, this.width, 9 * this.scale);
    ctx.fillStyle = '#66bb6a';
    ctx.fillRect(0, this.groundY - 0.35 * this.scale, this.width, 0.7 * this.scale);
  }

  /** Ledge tipis sebagai penanda platform gameplay, bukan objek latar baru. */
  private drawPlatforms(): void {
    const ctx = this.ctx!;
    ctx.save();
    for (const platform of FIGHT_PLATFORMS) {
      const x = this.sx(platform.x - platform.w / 2);
      const y = this.sy(platform.z);
      const w = platform.w * this.scale;
      ctx.globalAlpha = 0.4;
      ctx.fillStyle = '#fff8e1';
      roundedRect(ctx, x, y - 0.18 * this.scale, w, 0.36 * this.scale, 4);
      ctx.fill();
      ctx.globalAlpha = 0.7;
      ctx.fillStyle = '#3e2723';
      ctx.font = `700 ${Math.max(9, 0.38 * this.scale)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(platform.label, x + w / 2, y - 0.55 * this.scale);
    }
    ctx.restore();
  }

  private drawSpawnMarkers(): void {
    const ctx = this.ctx!;
    for (const team of ['team_merah', 'team_putih'] as const) {
      const spawn = FIGHT_SPAWNS[team];
      const x = this.sx(spawn.x);
      const y = this.sy(0);
      ctx.fillStyle = team === 'team_merah' ? 'rgba(239,83,80,0.22)' : 'rgba(245,245,245,0.32)';
      ctx.fillRect(x - 7 * this.scale, y - 8 * this.scale, 14 * this.scale, 8 * this.scale);
      ctx.strokeStyle = team === 'team_merah' ? '#b71c1c' : '#9e9e9e';
      ctx.lineWidth = 2;
      ctx.strokeRect(x - 7 * this.scale, y - 8 * this.scale, 14 * this.scale, 8 * this.scale);
    }
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

  private resolveSpriteState(hero: MobaHeroView): string {
    if (!hero.alive || hero.anim === 'dead') return 'down';
    if (hero.anim === 'dash') return 'run';
    if (hero.anim === 'cast') {
      return this.serverMs < (this.ultimateUntil.get(hero.id) ?? 0) ? 'ultimate' : 'cast';
    }
    if (hero.anim === 'hurt') return 'hurt';
    if (hero.anim === 'jump') return 'jump';
    if (hero.anim === 'attack') return 'attack';
    if (hero.anim === 'walk') return 'walk';
    return 'idle';
  }

  private spriteFrameFor(hero: MobaHeroView): FrameRect | null {
    if (!this.spriteAtlasReady || !imageReady(this.spriteAtlasImage)) return null;
    const stateName = this.resolveSpriteState(hero);
    const key = `${hero.heroId}:${stateName}`;
    const row = this.spriteAnimations.get(key) ?? this.spriteAnimations.get(`${hero.heroId}:idle`);
    if (!row?.frames.length) return null;

    const track = this.spriteTracks.get(hero.id);
    if (!track || track.key !== key) {
      this.spriteTracks.set(hero.id, { key, startedAt: this.animMs });
    }
    const startedAt = this.spriteTracks.get(hero.id)!.startedAt;
    const frameMs = 1000 / Math.max(1, row.fps ?? 8);
    const elapsed = Math.max(0, this.animMs - startedAt);
    const rawIndex = Math.floor(elapsed / frameMs);
    const index = row.loop
      ? rawIndex % row.frames.length
      : Math.min(row.frames.length - 1, rawIndex);
    return row.frames[Math.max(0, index)] ?? null;
  }

  private drawHero(hero: MobaHeroView): void {
    const ctx = this.ctx!;
    const x = this.sx(hero.x);
    const feetY = this.sy(hero.z);
    const eliminated = !hero.alive && hero.stocks <= 0;
    const respawning = !hero.alive && hero.stocks > 0;
    const local = hero.id === this.localHeroId && Boolean(this.displayState || this.frozenState);
    const theme = HEROES[hero.heroId]?.colorTheme ?? TEAM_COLOR[hero.team];
    const reaction = this.hitReactions.get(hero.id);
    const flashUntil = reaction?.flashUntil ?? 0;
    const blinkUntil = reaction?.blinkUntil ?? 0;

    let alpha = 1;
    if (eliminated) alpha = 0.28;
    else if (respawning) alpha = 0.5;
    else if (blinkUntil > this.elapsedMs && Math.floor(this.elapsedMs / 80) % 2 === 0) alpha = 0.45;

    ctx.save();
    ctx.globalAlpha = alpha;

    if (local) {
      ctx.strokeStyle = '#ffd54f';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(x, feetY - 0.1 * this.scale, 1.6 * this.scale, 0.45 * this.scale, 0, 0, TAU);
      ctx.stroke();
    }

    const frame = this.spriteFrameFor(hero);
    if (frame) {
      const size = SPRITE_WORLD_SIZE * this.scale;
      this.drawSprite(
        frame,
        x,
        feetY,
        size,
        hero.facing,
        flashUntil > this.elapsedMs ? (local ? '#ff3b30' : '#ffffff') : null,
        clamp((flashUntil - this.elapsedMs) / 120, 0, 1),
        alpha,
      );
    } else {
      this.drawFallbackBody(hero, x, feetY, theme, local, alpha);
    }
    ctx.restore();

    const spriteH = SPRITE_WORLD_SIZE * this.scale * (116 / SPRITE_CELL);
    const topY = feetY - spriteH;
    const barW = 2.6 * this.scale;
    const barY = topY - 0.75 * this.scale;
    ctx.save();
    ctx.globalAlpha = eliminated ? 0.45 : 1;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(x - barW / 2, barY, barW, 0.32 * this.scale);
    const ratio = clamp(hero.hp / Math.max(1, hero.maxHp), 0, 1);
    ctx.fillStyle = ratio < 0.3 ? '#ff5252' : '#69f0ae';
    ctx.fillRect(x - barW / 2, barY, barW * ratio, 0.32 * this.scale);

    for (let i = 0; i < hero.maxStocks; i += 1) {
      ctx.fillStyle = i < hero.stocks ? '#ffd54f' : 'rgba(255,255,255,0.25)';
      ctx.beginPath();
      ctx.arc(
        x - (hero.maxStocks - 1) * 0.32 * this.scale + i * 0.64 * this.scale,
        barY - 0.45 * this.scale,
        0.2 * this.scale,
        0,
        TAU,
      );
      ctx.fill();
    }

    ctx.font = `600 ${Math.max(9, 0.42 * this.scale)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(15,23,42,0.75)';
    ctx.strokeText(hero.name, x, barY - 0.85 * this.scale);
    ctx.fillStyle = '#ffffff';
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

  /** Sprite digambar relatif terhadap anchor kaki; flip dilakukan tepat di anchor. */
  private drawSprite(
    frame: FrameRect,
    feetX: number,
    feetY: number,
    size: number,
    facing: number,
    flashColor: string | null,
    flashAmount: number,
    alpha: number,
  ): void {
    const ctx = this.ctx!;
    const ax = (this.spriteAnchorX / SPRITE_CELL) * size;
    const ay = (this.spriteAnchorY / SPRITE_CELL) * size;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.imageSmoothingEnabled = false;
    ctx.translate(Math.round(feetX), Math.round(feetY));
    ctx.scale(facing < 0 ? -1 : 1, 1);
    ctx.drawImage(
      this.spriteAtlasImage,
      frame.x,
      frame.y,
      frame.w,
      frame.h,
      -ax,
      -ay,
      size,
      size,
    );
    if (flashColor && this.flashCtx && flashAmount > 0) {
      const tinted = this.tintFrame(frame, flashColor);
      if (tinted) {
        ctx.globalAlpha = alpha * flashAmount;
        ctx.drawImage(tinted, -ax, -ay, size, size);
      }
    }
    ctx.restore();
  }

  private tintFrame(frame: FrameRect, color: string): HTMLCanvasElement | null {
    const ctx = this.flashCtx;
    if (!ctx || !imageReady(this.spriteAtlasImage)) return null;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, SPRITE_CELL, SPRITE_CELL);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      this.spriteAtlasImage,
      frame.x,
      frame.y,
      frame.w,
      frame.h,
      0,
      0,
      SPRITE_CELL,
      SPRITE_CELL,
    );
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, SPRITE_CELL, SPRITE_CELL);
    ctx.globalCompositeOperation = 'source-over';
    return this.flashCanvas;
  }

  /** Fallback bila atlas karakter belum siap, bentuk lama tetap dipakai. */
  private drawFallbackBody(
    hero: MobaHeroView,
    x: number,
    feetY: number,
    theme: string,
    local: boolean,
    alpha: number,
  ): void {
    const ctx = this.ctx!;
    const size = SPRITE_WORLD_SIZE * this.scale;
    const bodyW = size * 0.46;
    const bodyH = size * 0.78;
    const topY = feetY - bodyH;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = hero.team === 'team_merah' ? '#c62828' : '#eceff1';
    roundedRect(ctx, x - bodyW / 2, topY, bodyW, bodyH, 0.55 * this.scale);
    ctx.fill();
    ctx.strokeStyle = TEAM_COLOR[hero.team];
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = theme;
    roundedRect(ctx, x - bodyW / 2, topY + bodyH * 0.58, bodyW, bodyH * 0.42, 0.35 * this.scale);
    ctx.fill();
    ctx.fillStyle = '#111827';
    const arrowX = x + hero.facing * (bodyW / 2 + 0.35 * this.scale);
    ctx.beginPath();
    ctx.moveTo(arrowX, feetY - bodyH * 0.55);
    ctx.lineTo(arrowX + hero.facing * 0.55 * this.scale, feetY - bodyH * 0.42);
    ctx.lineTo(arrowX, feetY - bodyH * 0.29);
    ctx.closePath();
    ctx.fill();
    if (local) {
      ctx.strokeStyle = '#ffd54f';
      ctx.lineWidth = 2;
      ctx.strokeRect(x - bodyW / 2 - 3, topY - 3, bodyW + 6, bodyH + 6);
    }
    ctx.restore();
  }

  private drawSkillAnims(): void {
    if (!this.skillAtlasReady || !imageReady(this.skillAtlasImage)) return;
    const ctx = this.ctx!;
    ctx.save();
    for (const anim of this.skillAnims) {
      const elapsed = anim.maxLife - anim.life;
      const frameCount = anim.row.frames.length;
      const frameDuration = anim.maxLife / Math.max(1, frameCount);
      const index = anim.row.loop
        ? Math.floor(elapsed / frameDuration) % frameCount
        : Math.min(frameCount - 1, Math.floor(elapsed / frameDuration));
      const frame = anim.row.frames[index];
      if (!frame) continue;

      const size = clamp(anim.radius * 3.6, 3.5, 20) * this.scale;
      const x = this.sx(anim.x) - size / 2;
      const y = this.sy(anim.z) - size / 2;
      ctx.globalAlpha = clamp(anim.life / (anim.maxLife * 0.35), 0, 1);
      ctx.imageSmoothingEnabled = false;
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
