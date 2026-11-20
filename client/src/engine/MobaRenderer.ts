/**
 * Renderer 2D top-down untuk arena PvP Perang Petasan.
 * Mengonsumsi kontrak ClientMobaState yang sama dengan server Colyseus;
 * tidak memakai Three.js / WebGL agar ringan dan sesuai dengan aset kartun 2D.
 */
import {
  ARENA_CENTER,
  ARENA_CENTER_RADIUS,
  ARENA_COVER,
  ARENA_SPAWNS,
  ARENA_SPAWN_RADIUS,
  MOBA_BUSHES,
  MOBA_HALF,
  MOBA_WORLD_SIZE,
} from '@pp/shared';
import type {
  ClientMobaState,
  MobaEffectView,
  MobaHeroView,
  MobaProjectileView,
  MobaUnitView,
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

const TAU = Math.PI * 2;
const VIEW_HEIGHT = 62;

const TEAM_COLOR: Record<TeamId, string> = {
  team_merah: '#ef5350',
  team_putih: '#f5f5f5',
};
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function damp(current: number, target: number, lambda: number, dtSeconds: number): number {
  return current + (target - current) * (1 - Math.exp(-lambda * dtSeconds));
}

function hashText(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) hash = (hash * 31 + value.charCodeAt(i)) | 0;
  return Math.abs(hash);
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

class CanvasMobaRenderer implements MobaRenderer {
  private container: HTMLElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;

  private width = 1;
  private height = 1;
  private dpr = 1;
  private scale = 10;
  private camX = 0;
  private camZ = 0;
  private targetX = 0;
  private targetZ = 0;
  private shake = 0;
  private elapsedMs = 0;

  private localHeroId = '';
  private localX = 0;
  private localZ = 0;
  private localTeam: TeamId | null = null;
  private hasLocal = false;

  private aimX = 0;
  private aimZ = 0;
  private aimVisible = false;

  private readonly portraits = new Map<string, HTMLImageElement>();
  private readonly mapImage = loadImage('/assets/maps/design_map.png');
  private readonly explosionImage = loadImage('/assets/effects/efek_ledakan.png');

  private readonly seenEffects = new Set<string>();
  private readonly effectBorn = new Map<string, number>();
  private readonly particles: Particle[] = [];
  private readonly texts: FloatingText[] = [];

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
    const viewHeight = aspect < 0.85 ? VIEW_HEIGHT * (0.85 / aspect) : VIEW_HEIGHT;
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
      z: (sy - this.height / 2) / this.scale + this.camZ,
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
      if (local) {
        this.localX = local.x;
        this.localZ = local.z;
        this.localTeam = local.team;
        this.hasLocal = true;
        this.targetX = local.x;
        this.targetZ = local.z;
      } else {
        this.hasLocal = false;
        this.localTeam = null;
        this.targetX = this.aimVisible ? this.aimX : 0;
        this.targetZ = this.aimVisible ? this.aimZ : 0;
      }
      this.syncEffects(state);
    } else {
      this.hasLocal = false;
      this.localTeam = null;
      this.targetX = 0;
      this.targetZ = 0;
      this.seenEffects.clear();
      this.effectBorn.clear();
    }

    this.camX = damp(this.camX, this.targetX, 6, dtSeconds);
    this.camZ = damp(this.camZ, this.targetZ, 6, dtSeconds);
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
    this.portraits.clear();
    this.seenEffects.clear();
    this.effectBorn.clear();
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
      this.effectBorn.set(effect.id, this.elapsedMs);
      this.spawnEffect(effect);
    }
    for (const id of Array.from(this.seenEffects)) {
      if (active.has(id)) continue;
      this.seenEffects.delete(id);
      this.effectBorn.delete(id);
    }
  }

  private spawnEffect(effect: MobaEffectView): void {
    const radius = Math.max(1, effect.radius);
    const color = effect.color || '#ffb74d';
    switch (effect.kind) {
      case 'explosion':
      case 'boss_spawn':
        this.spawnBurst(effect.x, effect.z, color, effect.kind === 'boss_spawn' ? 34 : 18, radius, 9);
        this.texts.push({
          x: effect.x,
          z: effect.z - 2,
          text: effect.kind === 'boss_spawn' ? 'ONDEL-ONDEL!' : 'BOOM!',
          color,
          life: 900,
          maxLife: 900,
        });
        this.shake = Math.min(1.4, this.shake + (effect.kind === 'boss_spawn' ? 1.2 : 0.6));
        break;
      case 'ko':
        this.spawnBurst(effect.x, effect.z, '#33373b', 16, radius * 0.7, 5);
        this.texts.push({ x: effect.x, z: effect.z - 2, text: 'K.O.!', color: '#ffd54f', life: 1000, maxLife: 1000 });
        this.shake = Math.min(1.4, this.shake + 0.4);
        break;
      case 'levelup':
        this.texts.push({ x: effect.x, z: effect.z - 2, text: 'LEVEL UP!', color: '#ffe082', life: 1100, maxLife: 1100 });
        this.spawnBurst(effect.x, effect.z, '#ffe082', 12, 2, 4);
        break;
      case 'gold':
        this.texts.push({ x: effect.x, z: effect.z - 2, text: '+ KOIN', color: '#ffd700', life: 900, maxLife: 900 });
        this.spawnBurst(effect.x, effect.z, '#ffd700', 10, 1.5, 3);
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
      const friction = Math.max(0, 1 - dtSeconds * 3.2);
      particle.vx *= friction;
      particle.vz *= friction;
    }
    for (let i = this.texts.length - 1; i >= 0; i -= 1) {
      const text = this.texts[i]!;
      text.life -= dtSeconds * 1000;
      if (text.life <= 0) this.texts.splice(i, 1);
    }
  }

  private clampCamera(): void {
    const limit = MOBA_HALF + 4;
    const halfW = this.width / (2 * this.scale);
    const halfH = this.height / (2 * this.scale);
    this.camX = halfW * 2 >= limit * 2 ? 0 : clamp(this.camX, -limit + halfW, limit - halfW);
    this.camZ = halfH * 2 >= limit * 2 ? 0 : clamp(this.camZ, -limit + halfH, limit - halfH);
  }

  // ------------------------------------------------------------------ drawing

  private draw(state: ClientMobaState | null): void {
    const ctx = this.ctx!;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#163a22';
    ctx.fillRect(0, 0, this.width, this.height);

    const shakeX = this.shake > 0 ? (Math.random() - 0.5) * this.shake * 2 : 0;
    const shakeY = this.shake > 0 ? (Math.random() - 0.5) * this.shake * 2 : 0;

    ctx.save();
    ctx.translate(this.width / 2 + shakeX, this.height / 2 + shakeY);
    ctx.scale(this.scale, this.scale);
    ctx.translate(-this.camX, -this.camZ);

    this.drawTerrain();
    this.drawArenaProps();
    this.drawBushes();
    if (state) {
      this.drawProjectiles(state);
      this.drawHeroes(state);
      this.drawEffects(state);
    }
    this.drawParticles();
    this.drawTexts();
    this.drawAim();
    ctx.restore();
  }

  private drawTerrain(): void {
    const ctx = this.ctx!;
    const half = MOBA_HALF;

    ctx.fillStyle = '#2f6b3c';
    ctx.fillRect(-half, -half, MOBA_WORLD_SIZE, MOBA_WORLD_SIZE);
    if (imageReady(this.mapImage)) {
      ctx.save();
      ctx.globalAlpha = 0.58;
      ctx.drawImage(this.mapImage, -half, -half, MOBA_WORLD_SIZE, MOBA_WORLD_SIZE);
      ctx.restore();
    }

    // Ring festival di tengah: titik temu semua tim.
    ctx.save();
    ctx.translate(ARENA_CENTER.x, ARENA_CENTER.z);
    ctx.fillStyle = 'rgba(120,95,60,0.55)';
    ctx.beginPath();
    ctx.arc(0, 0, ARENA_CENTER_RADIUS, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,213,79,0.75)';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.arc(0, 0, ARENA_CENTER_RADIUS, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([1.2, 1.2]);
    ctx.strokeStyle = 'rgba(255,241,180,0.55)';
    ctx.lineWidth = 0.45;
    ctx.beginPath();
    ctx.arc(0, 0, ARENA_CENTER_RADIUS - 2.2, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,213,79,0.9)';
    ctx.font = 'bold 2.1px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('ARENA PETASAN', 0, -ARENA_CENTER_RADIUS - 2);
    ctx.restore();

    // Zona lahir/respawn masing-masing tim.
    for (const team of ['team_merah', 'team_putih'] as const) {
      const spawn = ARENA_SPAWNS[team];
      ctx.save();
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = TEAM_COLOR[team];
      ctx.beginPath();
      ctx.arc(spawn.x, spawn.z, ARENA_SPAWN_RADIUS, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 0.7;
      ctx.strokeStyle = TEAM_COLOR[team];
      ctx.lineWidth = 0.6;
      ctx.setLineDash([1.4, 1]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = TEAM_COLOR[team];
      ctx.font = 'bold 1.5px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(team === 'team_merah' ? 'ZONA MERAH' : 'ZONA PUTIH', spawn.x, spawn.z - ARENA_SPAWN_RADIUS - 1.6);
      ctx.restore();
    }

    ctx.strokeStyle = 'rgba(90,58,32,0.8)';
    ctx.lineWidth = 1.2;
    roundedRect(ctx, -half + 1, -half + 1, MOBA_WORLD_SIZE - 2, MOBA_WORLD_SIZE - 2, 5);
    ctx.stroke();
  }

  private drawBushes(): void {
    const ctx = this.ctx!;
    const localInside = (x: number, z: number, r: number): boolean =>
      this.hasLocal && Math.hypot(this.localX - x, this.localZ - z) <= r + 1;

    for (let i = 0; i < MOBA_BUSHES.length; i += 1) {
      const bush = MOBA_BUSHES[i]!;
      const alpha = localInside(bush.x, bush.z, bush.r) ? 0.3 : 0.78;
      ctx.save();
      ctx.globalAlpha = alpha;
      for (let j = 0; j < 6; j += 1) {
        const angle = (hashText(`${i}:${j}`) % 360) * (Math.PI / 180);
        const dist = bush.r * (0.12 + ((hashText(`${j}:${i}`) % 60) / 100));
        const px = bush.x + Math.cos(angle) * dist;
        const pz = bush.z + Math.sin(angle) * dist;
        ctx.fillStyle = j % 2 === 0 ? '#256b2d' : '#3d8b3f';
        ctx.beginPath();
        ctx.arc(px, pz, bush.r * 0.38, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  private isHidden(unit: MobaUnitView): boolean {
    if (!this.hasLocal || !this.localTeam || unit.team === this.localTeam) return false;
    return MOBA_BUSHES.some(
      (bush) =>
        Math.hypot(unit.x - bush.x, unit.z - bush.z) <= bush.r &&
        Math.hypot(this.localX - bush.x, this.localZ - bush.z) > bush.r + 1,
    );
  }

  private drawArenaProps(): void {
    const ctx = this.ctx!;
    for (const cover of ARENA_COVER) {
      ctx.save();
      ctx.translate(cover.x, cover.z);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      roundedRect(ctx, -cover.w / 2 + 0.5, -cover.h / 2 + 0.8, cover.w, cover.h, 1);
      ctx.fill();

      ctx.fillStyle = cover.id.startsWith('bak') ? '#4f7fa8' : '#8d6e4f';
      roundedRect(ctx, -cover.w / 2, -cover.h / 2, cover.w, cover.h, 1);
      ctx.fill();
      ctx.strokeStyle = cover.id.startsWith('bak') ? '#a8d4ef' : '#c9a86a';
      ctx.lineWidth = 0.35;
      ctx.stroke();

      if (cover.id.startsWith('pos')) {
        ctx.fillStyle = '#d84315';
        ctx.beginPath();
        ctx.moveTo(-cover.w / 2, -cover.h / 2);
        ctx.lineTo(0, -cover.h / 2 - 1.6);
        ctx.lineTo(cover.w / 2, -cover.h / 2);
        ctx.closePath();
        ctx.fill();
      }

      ctx.fillStyle = '#fff8e1';
      ctx.font = 'bold 0.95px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(cover.label, 0, 0.4);
      ctx.restore();
    }
  }

  private drawHeroes(state: ClientMobaState): void {
    for (const unit of Object.values(state.heroes)) {
      if (this.isHidden(unit)) continue;
      this.drawHero(unit);
    }
  }

  private drawHero(hero: MobaHeroView): void {
    const ctx = this.ctx!;
    const isLocal = hero.id === this.localHeroId;
    const theme = HEROES[hero.heroId]?.colorTheme ?? '#ffd54f';
    const walking = hero.anim === 'walk' || hero.anim === 'attack';
    const bob = walking ? Math.sin(this.elapsedMs / 95 + hashText(hero.id) % 13) * 0.16 : 0;
    const attack = hero.anim === 'attack' ? 1 + Math.sin(this.elapsedMs / 70) * 0.06 : 1;

    ctx.save();
    ctx.translate(hero.x, hero.z + bob);

    ctx.fillStyle = 'rgba(0,0,0,0.26)';
    ctx.beginPath();
    ctx.ellipse(0.35, 0.7, 1.8, 0.9, 0, 0, TAU);
    ctx.fill();

    ctx.globalAlpha = hero.alive ? 1 : 0.38;
    ctx.scale(attack, attack);

    if (hero.anim === 'cast') {
      ctx.strokeStyle = theme;
      ctx.globalAlpha = 0.4 + Math.sin(this.elapsedMs / 80) * 0.2;
      ctx.lineWidth = 0.4;
      ctx.beginPath();
      ctx.arc(0, 0, 2.5, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = hero.alive ? 1 : 0.38;
    }

    const image = this.portraitFor(hero.heroId);
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, 1.7, 0, TAU);
    ctx.clip();
    ctx.fillStyle = theme;
    ctx.fillRect(-1.8, -1.8, 3.6, 3.6);
    if (imageReady(image)) this.drawCover(image, -1.7, -1.7, 3.4, 3.4);
    ctx.restore();

    ctx.strokeStyle = TEAM_COLOR[hero.team];
    ctx.lineWidth = isLocal ? 0.46 : 0.32;
    ctx.beginPath();
    ctx.arc(0, 0, 1.72, 0, TAU);
    ctx.stroke();
    if (isLocal) {
      ctx.setLineDash([0.5, 0.4]);
      ctx.strokeStyle = '#ffd54f';
      ctx.lineWidth = 0.28;
      ctx.beginPath();
      ctx.arc(0, 0, 2.25, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Penunjuk arah hadap.
    ctx.save();
    ctx.rotate(hero.facing);
    ctx.fillStyle = isLocal ? '#ffd54f' : TEAM_COLOR[hero.team];
    ctx.beginPath();
    ctx.moveTo(2.5, 0);
    ctx.lineTo(1.9, -0.45);
    ctx.lineTo(1.9, 0.45);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    const ratio = hero.maxHp > 0 ? clamp(hero.hp / hero.maxHp, 0, 1) : 0;
    this.drawHpBar(-1.9, -2.8, 3.8, ratio, TEAM_COLOR[hero.team]);
    ctx.fillStyle = '#fff8e1';
    ctx.font = 'bold 0.95px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${hero.name} · Lv.${hero.level}`, 0, -3.3);

    if (!hero.alive) {
      ctx.fillStyle = '#ffd54f';
      ctx.fillText(`${Math.ceil(hero.respawnIn / 1000)}s`, 0, 0.4);
    }
    ctx.restore();
  }

  private drawProjectiles(state: ClientMobaState): void {
    for (const projectile of Object.values(state.projectiles)) {
      this.drawProjectile(projectile);
    }
  }

  private drawProjectile(projectile: MobaProjectileView): void {
    const ctx = this.ctx!;
    const speed = Math.hypot(projectile.vx, projectile.vz);
    ctx.save();
    if (projectile.aoeRadius > 0) {
      ctx.strokeStyle = projectile.color || TEAM_COLOR[projectile.team];
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 0.35;
      ctx.beginPath();
      ctx.arc(projectile.x, projectile.z, projectile.aoeRadius, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (speed > 0.01) {
      ctx.strokeStyle = projectile.color || TEAM_COLOR[projectile.team];
      ctx.lineWidth = Math.max(0.35, projectile.radius);
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.moveTo(projectile.x, projectile.z);
      ctx.lineTo(
        projectile.x - (projectile.vx / speed) * 2.2,
        projectile.z - (projectile.vz / speed) * 2.2,
      );
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = projectile.color || TEAM_COLOR[projectile.team];
    ctx.beginPath();
    ctx.arc(projectile.x, projectile.z, Math.max(0.42, projectile.radius), 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#fff8e1';
    ctx.beginPath();
    ctx.arc(projectile.x - 0.12, projectile.z - 0.12, Math.max(0.14, projectile.radius * 0.35), 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  private drawEffects(state: ClientMobaState): void {
    const ctx = this.ctx!;
    for (const effect of Object.values(state.effects)) {
      const born = this.effectBorn.get(effect.id) ?? this.elapsedMs;
      const progress = clamp((this.elapsedMs - born) / Math.max(120, effect.ttlMs), 0, 1);
      if (progress >= 1) continue;
      const color = effect.color || '#ffb74d';
      const alpha = 1 - progress;
      ctx.save();
      ctx.globalAlpha = alpha * 0.65;
      ctx.strokeStyle = color;
      ctx.lineWidth = 0.5 + alpha * 0.5;
      ctx.beginPath();
      ctx.arc(effect.x, effect.z, effect.radius * (0.35 + progress * 0.9), 0, TAU);
      ctx.stroke();

      if ((effect.kind === 'explosion' || effect.kind === 'boss_spawn') && imageReady(this.explosionImage)) {
        ctx.globalAlpha = alpha * 0.8;
        const size = effect.radius * (0.9 + progress * 0.6);
        ctx.drawImage(this.explosionImage, effect.x - size, effect.z - size, size * 2, size * 2);
      }
      ctx.restore();
    }
  }

  private drawParticles(): void {
    const ctx = this.ctx!;
    for (const particle of this.particles) {
      ctx.globalAlpha = clamp(particle.life / particle.maxLife, 0, 1);
      ctx.fillStyle = particle.color;
      ctx.beginPath();
      ctx.arc(particle.x, particle.z, particle.size, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private drawTexts(): void {
    const ctx = this.ctx!;
    ctx.textAlign = 'center';
    ctx.font = 'bold 1.5px system-ui, sans-serif';
    ctx.lineWidth = 0.32;
    for (const text of this.texts) {
      const progress = 1 - text.life / text.maxLife;
      ctx.globalAlpha = clamp(text.life / text.maxLife, 0, 1);
      ctx.fillStyle = text.color;
      ctx.strokeStyle = 'rgba(10,20,14,0.9)';
      const y = text.z - progress * 2.2;
      ctx.strokeText(text.text, text.x, y);
      ctx.fillText(text.text, text.x, y);
    }
    ctx.globalAlpha = 1;
  }

  private drawAim(): void {
    if (!this.aimVisible) return;
    const ctx = this.ctx!;
    ctx.save();
    ctx.translate(this.aimX, this.aimZ);
    ctx.rotate(this.elapsedMs * 0.0012);
    ctx.strokeStyle = 'rgba(255,213,79,0.85)';
    ctx.lineWidth = 0.32;
    ctx.setLineDash([0.8, 0.6]);
    ctx.beginPath();
    ctx.arc(0, 0, 2.1, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    for (let i = 0; i < 4; i += 1) {
      const angle = (i / 4) * TAU;
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * 2.7, Math.sin(angle) * 2.7);
      ctx.lineTo(Math.cos(angle) * 3.4, Math.sin(angle) * 3.4);
      ctx.stroke();
    }
    ctx.fillStyle = '#ffd54f';
    ctx.beginPath();
    ctx.arc(0, 0, 0.35, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  private drawHpBar(x: number, y: number, width: number, ratio: number, color: string): void {
    const ctx = this.ctx!;
    ctx.fillStyle = 'rgba(12,20,16,0.8)';
    roundedRect(ctx, x - 0.12, y - 0.12, width + 0.24, 0.62, 0.2);
    ctx.fill();
    ctx.fillStyle = ratio < 0.3 ? '#ff5252' : color;
    roundedRect(ctx, x, y, Math.max(0.01, width * ratio), 0.38, 0.16);
    ctx.fill();
  }

  private drawCover(
    image: HTMLImageElement,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void {
    const ctx = this.ctx!;
    const iw = image.naturalWidth;
    const ih = image.naturalHeight;
    const scale = Math.max(dw / iw, dh / ih);
    const sw = dw / scale;
    const sh = dh / scale;
    ctx.drawImage(image, (iw - sw) / 2, (ih - sh) / 2, sw, sh, dx, dy, dw, dh);
  }

  private portraitFor(heroId: string): HTMLImageElement {
    let image = this.portraits.get(heroId);
    if (!image) {
      image = loadImage(heroPortrait(heroId));
      this.portraits.set(heroId, image);
    }
    return image;
  }
}

export function createMobaRenderer(): MobaRenderer {
  return new CanvasMobaRenderer();
}
