import './style.css';
import { createMobaRenderer } from './engine/MobaRenderer.js';
import type { ClientMobaState, MobaKoMessage, MobaMatchEndMessage, RoomMode } from '@pp/shared';
import { audio } from './core/audio.js';
import { network } from './core/network.js';
import { addThrKoin, loadProfile, type PlayerProfile } from './core/storage.js';
import { Hud } from './ui/Hud.js';
import { Lobby } from './ui/Lobby.js';

const app = document.getElementById('game');
if (!app) throw new Error('Kontainer #game tidak ditemukan');

const renderSurface = document.createElement('div');
renderSurface.className = 'render-surface';
app.appendChild(renderSurface);

/* -------------------------------------------------------- layar & orientasi */

const fullscreenBtn = document.createElement('button');
fullscreenBtn.type = 'button';
fullscreenBtn.className = 'fullscreen-btn';
fullscreenBtn.textContent = '⛶ FULLSCREEN';
fullscreenBtn.addEventListener('click', () => void toggleFullscreen());
app.appendChild(fullscreenBtn);

const orientationGate = document.createElement('div');
orientationGate.className = 'orientation-gate';
orientationGate.innerHTML = `
  <div class="orientation-card">
    <div class="orientation-icon">↻</div>
    <h2>PUTAR KE LANDSCAPE</h2>
    <p>Perang Petasan dimainkan dalam mode landscape agar peta dan skill terlihat jelas.</p>
    <button type="button" class="primary-btn" id="btn-orientation-fullscreen">MASUK LANDSCAPE</button>
  </div>
`;
app.appendChild(orientationGate);
orientationGate
  .querySelector<HTMLButtonElement>('#btn-orientation-fullscreen')
  ?.addEventListener('click', () => void enterFullscreen());

async function enterFullscreen(): Promise<void> {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    const orientation = screen.orientation as
      | (ScreenOrientation & { lock?: (value: 'landscape') => Promise<void> })
      | undefined;
    if (orientation?.lock) {
      try {
        await orientation.lock('landscape');
      } catch {
        // Tidak semua browser mengizinkan lock orientasi; abaikan.
      }
    }
  } catch {
    // Penolakan fullscreen tidak boleh menggagalkan masuk arena.
  }
}

async function toggleFullscreen(): Promise<void> {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await enterFullscreen();
  } catch {
    // Abaikan jika browser menolak perubahan fullscreen.
  }
}

let resizeRenderer: (() => void) | null = null;
document.addEventListener('fullscreenchange', () => {
  fullscreenBtn.textContent = document.fullscreenElement ? '⛶ KELUAR' : '⛶ FULLSCREEN';
  resizeRenderer?.();
});

const renderer = createMobaRenderer();
renderer.mount(renderSurface);
resizeRenderer = () => renderer.resize();

const lobby = new Lobby(app, { onJoin: (mode, profile) => void joinMatch(mode, profile) });
const hud = new Hud(app, {
  onSkill: (key, aimX, aimZ) => network.sendSkill(key, aimX, aimZ),
  onBuy: (itemId) => network.sendBuy(itemId),
  onLeave: () => void backToLobby(),
});

/** Permukaan peta menangkap klik bidik; elemen HUD berada di atasnya. */
const aim = { x: 0, z: 0 };
let hasAim = false;
let inMatch = false;
let activeProfile: PlayerProfile = loadProfile();

function updateAim(clientX: number, clientY: number): void {
  const ground = renderer.screenToGround(clientX, clientY);
  if (!ground) return;
  aim.x = ground.x;
  aim.z = ground.z;
  hasAim = true;
  renderer.setAimIndicator(aim.x, aim.z, true);
  hud.setAim(aim.x, aim.z);
}

renderSurface.addEventListener('pointermove', (event) => {
  if (!inMatch) return;
  // Mouse hover saja; untuk sentuhan cukup pointerdown agar tidak mengganggu joystick.
  if (event.pointerType === 'mouse' || event.buttons !== 0) updateAim(event.clientX, event.clientY);
});
renderSurface.addEventListener('pointerdown', (event) => {
  if (!inMatch) return;
  audio.unlock();
  updateAim(event.clientX, event.clientY);
});

/* ---------------------------------------------------------------- keyboard */

const pressed = new Set<string>();
window.addEventListener('keydown', (event) => {
  const key = event.key.toLowerCase();
  if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
    pressed.add(key);
  }
});
window.addEventListener('keyup', (event) => pressed.delete(event.key.toLowerCase()));
window.addEventListener('blur', () => pressed.clear());

/** Top-down: kanan layar = +x, bawah layar = +z. */
function movementVector(state: ClientMobaState | null): { dx: number; dz: number } {
  let vx = hud.joystick.vector.x;
  let vy = hud.joystick.vector.y;

  if (pressed.size > 0) {
    vx = 0;
    vy = 0;
    if (pressed.has('a') || pressed.has('arrowleft')) vx -= 1;
    if (pressed.has('d') || pressed.has('arrowright')) vx += 1;
    if (pressed.has('w') || pressed.has('arrowup')) vy -= 1;
    if (pressed.has('s') || pressed.has('arrowdown')) vy += 1;
  }

  const length = Math.hypot(vx, vy);
  if (length > 1) {
    vx /= length;
    vy /= length;
  }

  const dx = vx;
  const dz = vy;

  if (hasAim) return { dx, dz };

  const hero = state ? Object.values(state.heroes).find((unit) => unit.id === network.sessionId) : null;
  if (!hero) return { dx, dz };
  return {
    dx: hero.x + Math.cos(hero.facing) * 10,
    dz: hero.z + Math.sin(hero.facing) * 10,
  };
}

/* ------------------------------------------------------------- match flow */

async function joinMatch(mode: RoomMode, profile: PlayerProfile): Promise<void> {
  activeProfile = profile;
  // Dipanggil dari klik tombol join, jadi masih dalam user gesture browser.
  void enterFullscreen();
  try {
    await network.join(mode, {
      heroId: profile.heroId,
      thrLevel: profile.heroLevels[profile.heroId] ?? 0,
    }, profile.name);
    inMatch = true;
    hasAim = false;
    renderer.setAimIndicator(0, 0, false);
    lobby.hide();
    hud.show();
  } catch (error) {
    lobby.setStatus(`Gagal masuk arena: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function backToLobby(): Promise<void> {
  inMatch = false;
  hasAim = false;
  renderer.setAimIndicator(0, 0, false);
  hud.hide();
  pressed.clear();
  await network.leave();
  lobby.setStatus('');
  lobby.show();
}

network.onMatchEnd = (message: MobaMatchEndMessage) => {
  const hadiah = message.rewards[network.sessionId] ?? 0;
  if (hadiah > 0) addThrKoin(activeProfile, hadiah);
  hud.showResult(message, network.sessionId);
};

network.onKo = (message: MobaKoMessage) => {
  hud.addFeed(message, lastState);
};

network.onDisconnect = () => {
  if (!inMatch) return;
  inMatch = false;
  hud.hide();
  lobby.setStatus('Koneksi ke server terputus. Silakan masuk lagi.');
  lobby.show();
};

window.addEventListener('resize', () => renderer.resize());

/* ------------------------------------------------------------- render loop */

let lastFrame = performance.now();
let lastMoveSend = 0;
let lastState: ClientMobaState | null = null;

function frame(now: number): void {
  const dtMs = Math.min(100, Math.max(0, now - lastFrame));
  lastFrame = now;

  const state = network.state;
  lastState = state;

  if (inMatch && state && state.phase === 'playing') {
    if (now - lastMoveSend >= 50) {
      lastMoveSend = now;
      const { dx, dz } = movementVector(state);
      network.sendMove({ dx, dz, aimX: aim.x, aimZ: aim.z });
    }
  }

  renderer.update(state, network.sessionId, dtMs);
  if (inMatch) hud.update(state, network.sessionId);

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

/** Dipakai untuk debug di console saat menguji alur lobby -> match. */
Object.defineProperty(window, '__moba', {
  value: {
    get state(): ClientMobaState | null {
      return lastState;
    },
    get sessionId(): string {
      return network.sessionId;
    },
    leave: (): void => void backToLobby(),
  },
});
