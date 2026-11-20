import { ROOM_MODES, heroStatsAtThr, thrCostFor, type RoomMode } from '@pp/shared';
import { HERO_LIST, HEROES, heroPortrait } from '../core/catalog.js';
import { audio } from '../core/audio.js';
import {
  buyHeroUpgrade,
  heroLevel,
  loadProfile,
  saveProfile,
  selectHero,
  type PlayerProfile,
} from '../core/storage.js';

export interface LobbyCallbacks {
  onJoin: (mode: RoomMode, profile: PlayerProfile) => void;
}

export class Lobby {
  private readonly root: HTMLDivElement;
  private profile: PlayerProfile = loadProfile();
  private mode: RoomMode = '5v5';
  private status = '';
  private joining = false;

  constructor(parent: HTMLElement, private readonly callbacks: LobbyCallbacks) {
    this.root = document.createElement('div');
    this.root.className = 'lobby';
    parent.appendChild(this.root);
    this.render();
  }

  show(): void {
    this.profile = loadProfile();
    this.joining = false;
    this.root.classList.remove('hidden');
    this.render();
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  setStatus(text: string): void {
    this.status = text;
    this.render();
  }

  private render(): void {
    const hero = HEROES[this.profile.heroId] ?? HERO_LIST[0]!;
    const level = heroLevel(this.profile, hero.id);
    const stats = heroStatsAtThr(hero, level);
    const maxed = level >= hero.thrUpgradeScaling.maxLevel;
    const cost = thrCostFor(hero, level);

    this.root.innerHTML = `
      <div class="lobby-bg"></div>
      <div class="lobby-content">
        <header class="lobby-header">
          <img class="lobby-logo" src="/assets/ui/logo.png" alt="Perang Petasan" />
          <div class="lobby-coin">
            <img src="/assets/ui/icon_koin_thr.png" alt="Koin THR" />
            <div><small>KOIN THR</small><b>${this.profile.koin}</b></div>
          </div>
        </header>

        <div class="lobby-title">
          <h1>PILIH HERO &amp; MODE</h1>
          <p>Arena PvP 2D • Skill MOBA • Skor Kill Tertinggi Saat Waktu Habis</p>
        </div>

        <div class="mode-row">
          ${(Object.keys(ROOM_MODES) as RoomMode[]).map((mode) => `
            <button class="mode-btn ${this.mode === mode ? 'selected' : ''}" data-mode="${mode}">
              <b>${mode}</b><span>${ROOM_MODES[mode].label}</span>
            </button>`).join('')}
        </div>

        <div class="lobby-grid">
          <section class="hero-select panel">
            <h2>DAFTAR HERO</h2>
            <div class="hero-cards">
              ${HERO_LIST.map((entry) => {
                const selected = entry.id === this.profile.heroId;
                const lv = heroLevel(this.profile, entry.id);
                return `<button class="hero-card ${selected ? 'selected' : ''}" data-hero="${entry.id}" style="--hero-color:${entry.colorTheme}">
                  <img src="${heroPortrait(entry.id)}" alt="${entry.name}" />
                  <div><b>${entry.name}</b><small>${entry.role}</small><em>THR Lv.${lv}</em></div>
                </button>`;
              }).join('')}
            </div>
          </section>

          <section class="hero-detail panel">
            <h2>${hero.name.toUpperCase()}</h2>
            <p class="role">${hero.role}</p>
            <div class="stat-grid">
              <div><small>HP</small><b>${Math.round(stats.maxHp)}</b></div>
              <div><small>DAMAGE</small><b>${Math.round(stats.attackDamage)}</b></div>
              <div><small>KECEPATAN</small><b>${hero.baseStats.moveSpeed}</b></div>
              <div><small>JARAK</small><b>${hero.baseStats.attackRange}</b></div>
            </div>
            <div class="skill-list">
              <div><b>⚔ ${hero.baseStats.attackDamage.toFixed(0)}</b><span>Serang Dasar</span></div>
              <div><b>1️⃣ ${hero.skills.skill1.name}</b><span>${hero.skills.skill1.type}</span></div>
              <div><b>2️⃣ ${hero.skills.skill2.name}</b><span>${hero.skills.skill2.type}</span></div>
              <div><b>🌟 ${hero.skills.ultimate.name}</b><span>Unlock Lv.4</span></div>
            </div>
            <details class="design-ref">
              <summary>REFERENSI DESAIN ARENA</summary>
              <img src="/assets/maps/design_map.png" alt="Desain arena kampung" />
            </details>
          </section>

          <section class="thr-panel panel">
            <h2>WARUNG KOIN THR</h2>
            <p class="thr-level">Upgrade Permanen <b>Lv.${level}/${hero.thrUpgradeScaling.maxLevel}</b></p>
            <div class="stat-grid">
              <div><small>+HP / LEVEL</small><b>+${hero.thrUpgradeScaling.hpBonusPerLevel}</b></div>
              <div><small>+DMG / LEVEL</small><b>+${hero.thrUpgradeScaling.damageBonusPerLevel}</b></div>
            </div>
            <button class="upgrade-btn" id="btn-upgrade" ${maxed || this.profile.koin < cost ? 'disabled' : ''}>
              ${maxed ? 'LEVEL MAKSIMAL' : `NAIK LEVEL • ${cost} KOIN`}
            </button>
          </section>
        </div>

        <footer class="lobby-footer">
          <input id="player-name" maxlength="18" value="${this.profile.name.replace(/"/g, '&quot;')}" placeholder="Nama pemain" />
          <button class="primary-btn" id="btn-join" ${this.joining ? 'disabled' : ''}>
            ${this.joining ? 'MENGHUBUNGI...' : '🏆 MASUK ARENA'}
          </button>
          <div class="lobby-status">${this.status}</div>
        </footer>
      </div>
    `;

    this.root.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((button) => {
      button.addEventListener('click', () => {
        audio.unlock();
        this.mode = button.dataset.mode as RoomMode;
        this.render();
      });
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-hero]').forEach((button) => {
      button.addEventListener('click', () => {
        audio.unlock();
        audio.play('kentongan');
        selectHero(this.profile, button.dataset.hero!);
        this.render();
      });
    });
    this.root.querySelector<HTMLButtonElement>('#btn-upgrade')?.addEventListener('click', () => {
      audio.unlock();
      if (buyHeroUpgrade(this.profile, hero.id)) {
        audio.play('levelup');
        this.status = `${hero.name} naik ke Lv.${heroLevel(this.profile, hero.id)}!`;
      } else {
        this.status = 'Koin THR belum cukup.';
      }
      this.render();
    });
    const nameInput = this.root.querySelector<HTMLInputElement>('#player-name');
    nameInput?.addEventListener('change', () => {
      this.profile.name = nameInput.value.trim() || 'Warga Kampung';
      saveProfile(this.profile);
    });
    this.root.querySelector<HTMLButtonElement>('#btn-join')?.addEventListener('click', () => {
      audio.unlock();
      audio.play('kentongan');
      this.joining = true;
      this.status = 'Menghubungkan ke server...';
      this.render();
      this.callbacks.onJoin(this.mode, this.profile);
    });
  }

  destroy(): void {
    this.root.remove();
  }
}
