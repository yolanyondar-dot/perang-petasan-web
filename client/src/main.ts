import './style.css';
import { createMobaRenderer } from './engine/MobaRenderer.js';
import type { ClientMobaState, MobaKoMessage, MobaMatchEndMessage, RoomMode } from '@pp/shared';
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

let inMatch = false;
let activeProfile: PlayerProfile = loadProfile();

/* ---------------------------------------------------------------- keyboard */

const pressed = new Set<string>();
window.addEventListener('keydown', (event) => {
  const key = event.key.toLowerCase();
  if (
    ['w', 'a', 's', 'd', ' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'].includes(key)
  ) {
    pressed.add(key);
  }
});
window.addEventListener('keyup', (event) => pressed.delete(event.key.toLowerCase()));
window.addEventListener('blur', () => pressed.clear());

let prevJumpHeld = false;
let prevDashHeld = false;

/** Side-view: A/D jalan, W/Atas/Space lompat (dua kali), Shift dash. */
function movementVector(state: ClientMobaState | null): {
  dx: number;
  dz: number;
  jump: boolean;
  dash: boolean;
  aimX: number;
  aimZ: number;
} {
  let vx = hud.joystick.vector.x;
  let jumpHeld = hud.joystick.vector.y < -0.45;

  if (pressed.size > 0) {
    vx = 0;
    jumpHeld = false;
    if (pressed.has('a') || pressed.has('arrowleft')) vx -= 1;
    if (pressed.has('d') || pressed.has('arrowright')) vx += 1;
    if (pressed.has('w') || pressed.has('arrowup') || pressed.has(' ')) jumpHeld = true;
  }

  const dx = Math.max(-1, Math.min(1, vx));
  const dashHeld = pressed.has('shift');
  const jump = jumpHeld && !prevJumpHeld;
  const dash = dashHeld && !prevDashHeld;
  prevJumpHeld = jumpHeld;
  prevDashHeld = dashHeld;

  // Tanpa bidik manual: serangan selalu mengikuti arah hadap hero.
  const hero = state
    ? Object.values(state.heroes).find((unit) => unit.id === network.sessionId)
    : null;
  const aimX = hero ? hero.x + hero.facing * 9 : dx * 9;
  const aimZ = hero ? hero.z + 1.5 : 1.5;

  return { dx, dz: jumpHeld ? 1 : 0, jump, dash, aimX, aimZ };
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
    prevJumpHeld = false;
    prevDashHeld = false;
    lobby.hide();
    hud.show();
  } catch (error) {
    lobby.setStatus(`Gagal masuk arena: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function backToLobby(): Promise<void> {
  inMatch = false;
  hud.hide();
  pressed.clear();
  prevJumpHeld = false;
  prevDashHeld = false;
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
      const move = movementVector(state);
      network.sendMove(move);
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
