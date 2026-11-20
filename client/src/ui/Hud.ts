import {
  ARENA_CENTER,
  ARENA_CENTER_RADIUS,
  ARENA_COVER,
  ARENA_SPAWNS,
  ARENA_SPAWN_RADIUS,
  MOBA_BALANCE,
  MOBA_BUSHES,
  MOBA_HALF,
  formatMatchTime,
  levelProgress,
} from '@pp/shared';
import type { ClientMobaState, MobaHeroView, MobaKoMessage, MobaSkillKey, MobaMatchEndMessage } from '@pp/shared';
import { HEROES, ITEM_LIST, heroPortrait } from '../core/catalog.js';
import { audio } from '../core/audio.js';
import { VirtualJoystick } from './VirtualJoystick.js';

export interface HudCallbacks {
  onSkill: (key: MobaSkillKey, aimX: number, aimZ: number) => void;
  onBuy: (itemId: string) => void;
  onLeave: () => void;
}

const SKILLS: Array<{ key: MobaSkillKey; label: string; hotkey: string }> = [
  { key: 'basic', label: 'SERANG', hotkey: 'A' },
  { key: 'skill1', label: 'S1', hotkey: '1' },
  { key: 'skill2', label: 'S2', hotkey: '2' },
  { key: 'ultimate', label: 'ULT', hotkey: '3' },
];

export class Hud {
  readonly joystick: VirtualJoystick;
  private readonly root: HTMLDivElement;
  private readonly minimap: HTMLCanvasElement;
  private readonly mapBackdrop = new Image();
  private readonly scoreMerah: HTMLElement;
  private readonly scorePutih: HTMLElement;
  private readonly timer: HTMLElement;
  private readonly gold: HTMLElement;
  private readonly level: HTMLElement;
  private readonly xpFill: HTMLElement;
  private readonly hpFill: HTMLElement;
  private readonly hpText: HTMLElement;
  private readonly portrait: HTMLImageElement;
  private readonly shopList: HTMLElement;
  private readonly feed: HTMLElement;
  private readonly endPanel: HTMLElement;
  private readonly endTitle: HTMLElement;
  private readonly endDetail: HTMLElement;
  private readonly cooldownOverlays = new Map<MobaSkillKey, HTMLElement>();
  private readonly skillButtons = new Map<MobaSkillKey, HTMLButtonElement>();
  private readonly aim = { x: 0, z: 0 };
  private hasAim = false;
  private lastHeroId = '';
  private shopSignature = '';
  private lastMinimapDraw = 0;
  private aimHint: HTMLElement;

  constructor(parent: HTMLElement, private readonly callbacks: HudCallbacks) {
    this.root = document.createElement('div');
    this.root.className = 'hud hidden';
    this.root.innerHTML = `
      <div class="hud-top">
        <div class="minimap-panel">
          <canvas class="minimap" width="320" height="320"></canvas>
          <div class="minimap-caption">ARENA KAMPUNG</div>
        </div>
        <div class="score-panel">
          <div class="score-side merah"><span>TIM MERAH</span><b id="hud-score-merah">0</b></div>
          <div class="score-middle"><b id="hud-timer">05:00</b><span>SKOR KILL</span></div>
          <div class="score-side putih"><b id="hud-score-putih">0</b><span>TIM PUTIH</span></div>
        </div>
        <div class="shop-panel">
          <button class="shop-toggle" id="hud-shop-toggle">🛒 TOKO CEPAT</button>
          <div class="shop-list hidden" id="hud-shop-list"></div>
        </div>
      </div>

      <div class="hud-bottom-left">
        <div class="joystick-wrap"></div>
        <div class="move-hint">GESER UNTUK JALAN</div>
      </div>

      <div class="hud-bottom-center">
        <img class="hero-portrait" id="hud-portrait" src="/assets/characters/bocil_sarung.png" alt="hero" />
        <div class="hero-status">
          <div class="hero-line"><b id="hud-level">Lv.1</b><span id="hud-gold">💰 0</span></div>
          <div class="bar hp"><div class="bar-fill" id="hud-hp-fill"></div><span id="hud-hp-text">0/0</span></div>
          <div class="bar xp"><div class="bar-fill" id="hud-xp-fill"></div></div>
        </div>
      </div>

      <div class="hud-bottom-right">
        <div class="aim-hint" id="hud-aim-hint">Ketuk peta untuk bidik</div>
        <div class="skill-wheel" id="hud-skills"></div>
      </div>

      <div class="killfeed" id="hud-feed"></div>
      <div class="match-end hidden" id="hud-end">
        <div class="end-card">
          <h1 id="hud-end-title">PERTANDINGAN SELESAI</h1>
          <p id="hud-end-detail"></p>
          <button class="primary-btn" id="hud-end-back">KEMBALI KE LOBBY</button>
        </div>
      </div>
    `;
    parent.appendChild(this.root);

    const q = <T extends Element>(selector: string): T => {
      const found = this.root.querySelector<T>(selector);
      if (!found) throw new Error(`HUD elemen tidak ditemukan: ${selector}`);
      return found;
    };

    this.minimap = q<HTMLCanvasElement>('.minimap');
    this.mapBackdrop.src = '/assets/maps/design_map.png';
    this.scoreMerah = q<HTMLElement>('#hud-score-merah');
    this.scorePutih = q<HTMLElement>('#hud-score-putih');
    this.timer = q<HTMLElement>('#hud-timer');
    this.gold = q<HTMLElement>('#hud-gold');
    this.level = q<HTMLElement>('#hud-level');
    this.xpFill = q<HTMLElement>('#hud-xp-fill');
    this.hpFill = q<HTMLElement>('#hud-hp-fill');
    this.hpText = q<HTMLElement>('#hud-hp-text');
    this.portrait = q<HTMLImageElement>('#hud-portrait');
    this.shopList = q<HTMLElement>('#hud-shop-list');
    this.feed = q<HTMLElement>('#hud-feed');
    this.endPanel = q<HTMLElement>('#hud-end');
    this.endTitle = q<HTMLElement>('#hud-end-title');
    this.endDetail = q<HTMLElement>('#hud-end-detail');
    this.aimHint = q<HTMLElement>('#hud-aim-hint');

    this.joystick = new VirtualJoystick(q<HTMLElement>('.joystick-wrap'));

    const wheel = q<HTMLElement>('#hud-skills');
    for (const skill of SKILLS) {
      const button = document.createElement('button');
      button.className = `skill-btn ${skill.key}`;
      button.innerHTML = `<span class="skill-key">${skill.hotkey}</span><span class="skill-label">${skill.label}</span><div class="skill-cd"></div>`;
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.fireSkill(skill.key);
      });
      wheel.appendChild(button);
      this.skillButtons.set(skill.key, button);
      this.cooldownOverlays.set(skill.key, button.querySelector<HTMLElement>('.skill-cd')!);
    }

    q<HTMLButtonElement>('#hud-shop-toggle').addEventListener('click', () => {
      audio.unlock();
      this.shopList.classList.toggle('hidden');
    });
    q<HTMLButtonElement>('#hud-end-back').addEventListener('click', () => this.callbacks.onLeave());

    window.addEventListener('keydown', (event) => {
      const map: Record<string, MobaSkillKey> = { a: 'basic', A: 'basic', '1': 'skill1', '2': 'skill2', '3': 'ultimate' };
      const key = map[event.key];
      if (key && !this.root.classList.contains('hidden')) {
        audio.unlock();
        this.fireSkill(key);
      }
      if (event.key.toLowerCase() === 'b' && !this.root.classList.contains('hidden')) {
        this.shopList.classList.toggle('hidden');
      }
    });
  }

  show(): void {
    this.root.classList.remove('hidden');
  }

  hide(): void {
    this.root.classList.add('hidden');
    this.shopList.classList.add('hidden');
    this.endPanel.classList.add('hidden');
    this.shopSignature = '';
    this.joystick.reset();
  }

  setAim(x: number, z: number): void {
    this.aim.x = x;
    this.aim.z = z;
    this.hasAim = true;
    this.aimHint.textContent = '🎯 Bidik terkunci';
    this.aimHint.classList.add('locked');
  }

  private fireSkill(key: MobaSkillKey): void {
    let { x, z } = this.aim;
    if (!this.hasAim) {
      const hero = this.currentHero;
      x = hero ? hero.x + Math.cos(hero.facing) * 8 : 0;
      z = hero ? hero.z + Math.sin(hero.facing) * 8 : 0;
    }
    audio.unlock();
    audio.play(key === 'basic' ? 'fuse' : 'explosion');
    this.callbacks.onSkill(key, x, z);
  }

  private currentHero: MobaHeroView | null = null;

  addFeed(message: MobaKoMessage, state: ClientMobaState | null): void {
    const attacker = message.attackerId ? state?.heroes[message.attackerId] : undefined;
    const victim = message.victimId ? state?.heroes[message.victimId] : undefined;
    const text = attacker && victim
      ? `${attacker.name} meng-GOSONG-kan ${victim.name} 💥`
      : 'Sebuah unit kena petasan! 💥';
    const line = document.createElement('div');
    line.className = 'feed-line';
    line.textContent = text;
    this.feed.prepend(line);
    window.setTimeout(() => line.remove(), 4200);
  }

  showResult(message: MobaMatchEndMessage, localId: string): void {
    const menang = message.winner !== 'draw' && message.winner === this.currentHero?.team;
    const hadiah = message.rewards[localId] ?? 0;
    this.endTitle.textContent = menang ? '🏆 KAMPUNG KITA MENANG!' : '💥 KALAH, TAPI GOSONG NYATA';
    this.endDetail.textContent = `Skor ${message.scoreMerah} - ${message.scorePutih} • Hadiah +${hadiah} Koin THR`;
    this.endPanel.classList.remove('hidden');
    audio.play('kentongan');
  }

  update(state: ClientMobaState | null, localId: string): void {
    if (!state) return;
    const hero = state.heroes[localId] ?? null;
    this.currentHero = hero;

    this.scoreMerah.textContent = String(state.scoreMerah);
    this.scorePutih.textContent = String(state.scorePutih);
    this.timer.textContent = formatMatchTime(state.timeLeft);
    this.timer.classList.toggle('urgent', state.timeLeft <= 60);

    if (hero) {
      if (hero.heroId !== this.lastHeroId) {
        this.lastHeroId = hero.heroId;
        this.portrait.src = heroPortrait(hero.heroId);
      }
      this.gold.textContent = `💰 ${hero.gold}`;
      this.level.textContent = `Lv.${hero.level}`;
      this.xpFill.style.width = `${levelProgress(hero.xp) * 100}%`;
      const ratio = Math.max(0, Math.min(1, hero.hp / Math.max(1, hero.maxHp)));
      this.hpFill.style.width = `${ratio * 100}%`;
      this.hpFill.classList.toggle('low', ratio < 0.3);
      this.hpText.textContent = hero.alive
        ? `${Math.ceil(hero.hp)} / ${Math.ceil(hero.maxHp)}`
        : `RESPAWN ${Math.ceil(hero.respawnIn / 1000)}s`;

      const cds: Record<MobaSkillKey, number> = {
        basic: hero.cdBasic,
        skill1: hero.cdSkill1,
        skill2: hero.cdSkill2,
        ultimate: hero.cdUltimate,
      };
      const totals: Record<MobaSkillKey, number> = {
        basic: HEROES[hero.heroId]?.baseStats.attackCooldownMs ?? 700,
        skill1: HEROES[hero.heroId]?.skills.skill1.cooldownMs ?? 5000,
        skill2: HEROES[hero.heroId]?.skills.skill2.cooldownMs ?? 8000,
        ultimate: HEROES[hero.heroId]?.skills.ultimate.cooldownMs ?? 25000,
      };
      for (const skill of SKILLS) {
        const remaining = cds[skill.key];
        const total = totals[skill.key];
        const overlay = this.cooldownOverlays.get(skill.key)!;
        const button = this.skillButtons.get(skill.key)!;
        const active = remaining > 0;
        overlay.style.height = active ? `${Math.min(100, remaining / Math.max(1, total) * 100)}%` : '0%';
        overlay.textContent = active ? `${(remaining / 1000).toFixed(1)}` : '';
        button.classList.toggle('cooling', active);
        button.classList.toggle('locked', hero.level < (MOBA_BALANCE.skillUnlockLevel[skill.key] ?? 1));
      }
      this.renderShop(hero);
    }

    const now = performance.now();
    if (now - this.lastMinimapDraw >= 100) {
      this.lastMinimapDraw = now;
      this.drawMinimap(state, localId);
    }
  }

  private renderShop(hero: MobaHeroView): void {
    if (this.shopList.classList.contains('hidden')) return;
    const full = hero.items.length >= 6;
    const signature = `${hero.gold}|${hero.items.join(',')}`;
    if (signature === this.shopSignature) return;
    this.shopSignature = signature;
    this.shopList.innerHTML = ITEM_LIST.map((item) => {
      const owned = hero.items.filter((id) => id === item.id).length;
      const affordable = hero.gold >= item.cost && !full;
      return `<button class="shop-item ${affordable ? '' : 'disabled'}" data-item="${item.id}" ${affordable ? '' : 'disabled'}>
        <b>${item.name}</b><span>${item.description}</span><em>💰 ${item.cost}${owned ? ` • punya ${owned}` : ''}</em>
      </button>`;
    }).join('');
    this.shopList.querySelectorAll<HTMLButtonElement>('[data-item]').forEach((button) => {
      button.addEventListener('click', () => {
        audio.unlock();
        audio.play('kentongan');
        this.callbacks.onBuy(button.dataset.item!);
      });
    });
  }

  private drawMinimap(state: ClientMobaState, localId: string): void {
    const context = this.minimap.getContext('2d');
    if (!context) return;
    const size = this.minimap.width;
    const scale = size / (MOBA_HALF * 2);
    const px = (x: number): number => (x + MOBA_HALF) * scale;
    const pz = (z: number): number => (z + MOBA_HALF) * scale;

    context.clearRect(0, 0, size, size);
    context.fillStyle = '#163a22';
    context.fillRect(0, 0, size, size);

    // Referensi peta dari raw asset, jadi latar minimap lebih mirip desain.
    if (this.mapBackdrop.complete && this.mapBackdrop.naturalWidth > 0) {
      context.save();
      context.globalAlpha = 0.38;
      context.drawImage(this.mapBackdrop, 0, 0, size, size);
      context.restore();
    }

    // Ring tengah arena.
    context.strokeStyle = 'rgba(255,213,79,0.65)';
    context.lineWidth = 2;
    context.beginPath();
    context.arc(px(ARENA_CENTER.x), pz(ARENA_CENTER.z), ARENA_CENTER_RADIUS * scale, 0, Math.PI * 2);
    context.stroke();

    // Zona spawn tim.
    for (const team of ['team_merah', 'team_putih'] as const) {
      const spawn = ARENA_SPAWNS[team];
      context.fillStyle = team === 'team_merah' ? 'rgba(239,83,80,0.35)' : 'rgba(245,245,245,0.35)';
      context.beginPath();
      context.arc(px(spawn.x), pz(spawn.z), ARENA_SPAWN_RADIUS * scale, 0, Math.PI * 2);
      context.fill();
    }

    // Prop cover.
    context.fillStyle = 'rgba(160,120,75,0.8)';
    for (const cover of ARENA_COVER) {
      context.fillRect(
        px(cover.x - cover.w / 2),
        pz(cover.z - cover.h / 2),
        cover.w * scale,
        cover.h * scale,
      );
    }

    // Semak.
    context.fillStyle = 'rgba(46,125,50,0.55)';
    for (const bush of MOBA_BUSHES) {
      context.beginPath();
      context.arc(px(bush.x), pz(bush.z), bush.r * scale, 0, Math.PI * 2);
      context.fill();
    }

    // Hero.
    for (const unit of Object.values(state.heroes)) {
      if (!unit.alive) continue;
      const isLocal = unit.id === localId;
      context.beginPath();
      context.arc(px(unit.x), pz(unit.z), isLocal ? 6 : 4.5, 0, Math.PI * 2);
      context.fillStyle = unit.team === 'team_merah' ? '#d32f2f' : '#fafafa';
      context.fill();
      context.lineWidth = isLocal ? 2.5 : 1.5;
      context.strokeStyle = isLocal ? '#ffd54f' : '#1b1b1b';
      context.stroke();
    }
  }

  destroy(): void {
    this.joystick.destroy();
    this.root.remove();
  }
}
