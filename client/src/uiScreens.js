import { CHARACTER_LIST } from './charactersConfig.js';
import { MAP_LIST, normalizeMapId } from './terrain.js';
import { drawChibiHero2D, renderBallisticMapBackdrop, paintStylizedTerrainLayer } from './ballisticStyleAssets.js';
import { drawQRToCanvas } from './qrcodeMini.js';
import { getCharacterImage } from './assetLoader.js';

const LS_NAME = 'pp_player_name';
const COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#06b6d4'];

export function createUIScreens(callbacks = {}) {
  const $ = (id) => document.getElementById(id);
  const screens = {
    login: $('screen-login'),
    lobby: $('screen-lobby'),
    waiting: $('screen-waiting'),
  };
  const hud = $('hud');
  const hint = $('hint');
  const btnMenu = $('btn-menu');

  const state = {
    screen: 'login',
    playerName: localStorage.getItem(LS_NAME) || '',
    charId: 'udin',
    mapId: 'kampung_festival',
    costumeColor: COLORS[0],
    roomCode: null,
    isHost: false,
    players: [],
  };

  let previewRAF = null;
  let particles = makeParticles();

  function getPlayerName() {
    return (state.playerName || 'Pemain').trim().slice(0, 14) || 'Pemain';
  }

  function show(name) {
    state.screen = name;
    for (const [k, el] of Object.entries(screens)) el?.classList.toggle('active', k === name);
    const playing = name === 'playing';
    if (hud) hud.style.display = playing ? 'flex' : 'none';
    if (hint) hint.style.display = playing ? '' : 'none';
    if (btnMenu) btnMenu.style.display = playing ? 'block' : 'none';
    if (playing && window.matchMedia('(max-width: 900px)').matches && hint) hint.style.display = 'none';
    if (name === 'lobby' || name === 'waiting' || name === 'login') startPreviewLoop();
    else stopPreviewLoop();
    if (name === 'lobby') { renderLobby(); }
    if (name === 'waiting') { renderWaiting(); }
    callbacks.onScreenChange?.(name);
  }

  function roleFor(id) { return id === 'udin' ? 'Fighter' : id === 'sari' ? 'Area Control' : id === 'hendra' ? 'Tank/Bruiser' : 'Agile'; }

  function renderChars() {
    const grid = $('char-grid');
    if (!grid) return;
    grid.innerHTML = CHARACTER_LIST.map(c => `<button class="pick ${state.charId===c.id?'selected':''}" data-char="${c.id}">${c.name}</button>`).join('');
    grid.querySelectorAll('[data-char]').forEach(el => el.addEventListener('click', () => {
      state.charId = el.dataset.char;
      const def = CHARACTER_LIST.find(x=>x.id===state.charId);
      if (def?.color) state.costumeColor = def.color;
      renderLobby();
      callbacks.onCharSelect?.(state.charId);
    }));
  }

  function renderColors() {
    const row = $('color-row');
    if (!row) return;
    row.innerHTML = COLORS.map(col => `<button class="swatch ${state.costumeColor===col?'selected':''}" data-color="${col}" style="background:${col}" aria-label="warna"></button>`).join('');
    row.querySelectorAll('[data-color]').forEach(el => el.addEventListener('click', () => {
      state.costumeColor = el.dataset.color;
      renderColors();
      callbacks.onColorSelect?.(state.costumeColor);
    }));
  }

  function renderHeroInfo() {
    const c = CHARACTER_LIST.find(x=>x.id===state.charId) || CHARACTER_LIST[0];
    const role = roleFor(c.id);
    $('hero-name').textContent = c.name;
    $('hero-role').textContent = role;
    const s1 = c.skills.skill1?.name || '-';
    const s2 = c.skills.skill2?.name || '-';
    const u = c.skills.ulti?.name || '-';
    $('skill-badges').innerHTML = `<span class="badge"><b>S1</b> ${escapeHtml(s1)}</span><span class="badge"><b>S2</b> ${escapeHtml(s2)}</span><span class="badge"><b>ULTI</b> ${escapeHtml(u)}</span>`;
    $('hero-stats').innerHTML = `<b>Peran:</b> ${role}<br><b>Skill 1:</b> ${escapeHtml(s1)}<br><b>Skill 2:</b> ${escapeHtml(s2)}<br><b>Ulti:</b> ${escapeHtml(u)}`;
  }

  function renderMaps() {
    const grid = $('map-grid');
    if (!grid) return;
    const desc = {
      kampung_festival: 'Dataran kampung cerah, festival petasan.',
      atap_senja: 'Atap bertingkat saat senja, celah lompatan.',
      jembatan_bulan: 'Jembatan malam bulan, jurang & pulau tengah.',
    };
    grid.innerHTML = MAP_LIST.map(m => `<div class="map-card ${state.mapId===m.id?'selected':''}" data-map="${m.id}">
      <canvas class="map-thumb" width="192" height="108" data-thumb="${m.id}"></canvas>
      <div><h4>${m.name}</h4><p>${desc[m.id]||''}</p></div>
    </div>`).join('');
    grid.querySelectorAll('[data-map]').forEach(el => el.addEventListener('click', () => {
      state.mapId = el.dataset.map;
      renderMaps();
      callbacks.onMapSelect?.(state.mapId);
    }));
    // draw thumbnails
    grid.querySelectorAll('canvas[data-thumb]').forEach(cv => {
      const id = cv.dataset.thumb;
      const c = cv.getContext('2d');
      const w = cv.width, h = cv.height;
      renderBallisticMapBackdrop(c, w, h, id, 0);
      // mini terrain
      const tc = document.createElement('canvas'); tc.width=w; tc.height=h;
      paintStylizedTerrainLayer(tc.getContext('2d'), w, h, id);
      c.drawImage(tc, 0, 0);
    });
  }

  function renderLobby() {
    $('lobby-player-name').textContent = getPlayerName();
    renderChars();
    renderColors();
    renderHeroInfo();
    renderMaps();
  }

  function renderWaiting() {
    $('waiting-code').textContent = state.roomCode || '----';
    const link = state.roomCode ? `${location.origin}${location.pathname}?room=${state.roomCode}` : '-';
    $('waiting-link').textContent = link;
    $('waiting-role').textContent = state.isHost ? 'Host' : 'Player';
    $('btn-start-game').style.display = state.isHost ? '' : 'none';
    $('btn-add-bot').style.display = state.isHost ? '' : 'none';
    const qrCv = $('qr-canvas');
    if (qrCv) drawQRToCanvas(qrCv, link === '-' ? 'perang-petasan' : link, { size: 120 });

    const list = $('waiting-players');
    const players = state.players.length ? state.players : [{ name: getPlayerName(), charId: state.charId, isHost: state.isHost, isMe: true }];
    list.innerHTML = players.map((p, i) => {
      const c = CHARACTER_LIST.find(x=>x.id===p.charId) || CHARACTER_LIST[0];
      const tags = [p.isHost ? 'Host' : null, p.isBot ? 'Bot' : null, p.isMe ? 'Kamu' : null].filter(Boolean).join(' • ');
      return `<div class="slot"><canvas width="128" height="128" data-slot="${i}"></canvas><div><div class="name">${escapeHtml(p.name||'Pemain')}</div><div class="meta">${escapeHtml(c.name)}${tags ? ' • '+tags : ''}</div></div></div>`;
    }).join('');
    list.querySelectorAll('canvas[data-slot]').forEach(cv => {
      const i = Number(cv.dataset.slot);
      const p = players[i]; if (!p) return;
      const c = CHARACTER_LIST.find(x=>x.id===p.charId) || CHARACTER_LIST[0];
      const ctx = cv.getContext('2d');
      ctx.clearRect(0,0,128,128);
      const bg = ctx.createLinearGradient(0,0,0,128); bg.addColorStop(0,'#bfdbfe'); bg.addColorStop(1,'#fde68a');
      ctx.fillStyle = bg; ctx.fillRect(0,0,128,128);
      const img = getCharacterImage(c.id, 'avatar') || getCharacterImage(c.id, 'idle');
      if (img) {
        ctx.save();
        ctx.fillStyle = 'rgba(254,240,138,0.25)'; ctx.beginPath(); ctx.ellipse(64,106,44,12,0,0,Math.PI*2); ctx.fill();
        const size = 256*1.55, px=128*1.55, py=220*1.55;
        ctx.drawImage(img, 64-px, 102-py, size, size);
        ctx.restore();
      } else {
        drawChibiHero2D(ctx, { x: 64, y: 102, scale: 1.55, facing: 1, characterId: c.id, primaryColor: c.color, accentColor: c.skin?.shirt2 || '#facc15', walkPhase: 0, isAiming: false, showPedestal: true });
      }
    });
  }

  function makeParticles() {
    return Array.from({ length: 24 }, () => ({ x: Math.random()*1400, y: Math.random()*800, r: 1+Math.random()*2.5, v: 8+Math.random()*18, a: 0.2+Math.random()*0.5 }));
  }
  function drawParticles(ctx, w, h, dt) {
    ctx.save();
    for (const p of particles) {
      p.y -= p.v * dt; p.x += Math.sin(p.y*0.01) * 8 * dt;
      if (p.y < -10) { p.y = h + 10; p.x = Math.random()*w; }
      ctx.globalAlpha = p.a;
      ctx.fillStyle = '#fff7cc';
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI*2); ctx.fill();
    }
    ctx.restore();
  }

  function startPreviewLoop() {
    if (previewRAF) return;
    let last = performance.now();
    const step = (now) => {
      if (!['login','lobby','waiting'].includes(state.screen)) { previewRAF = null; return; }
      const dt = Math.min(0.05, (now-last)/1000); last = now;
      drawBackgrounds(dt, now/1000);
      if (state.screen === 'lobby') drawHeroPreview(now/1000);
      previewRAF = requestAnimationFrame(step);
    };
    previewRAF = requestAnimationFrame(step);
  }
  function stopPreviewLoop() { if (previewRAF) { cancelAnimationFrame(previewRAF); previewRAF = null; } }

  function drawBackgrounds(dt, t) {
    for (const [name, id] of [['login','login-bg'],['lobby','lobby-bg'],['waiting','waiting-bg']]) {
      if (state.screen !== name) continue;
      const cv = $(id); if (!cv) continue;
      const r = cv.getBoundingClientRect();
      const w = Math.max(300, Math.floor(r.width)); const h = Math.max(200, Math.floor(r.height));
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
      const c = cv.getContext('2d');
      renderBallisticMapBackdrop(c, w, h, state.mapId || 'kampung_festival', t);
      drawParticles(c, w, h, dt);
    }
  }

  function drawHeroPreview(t) {
    const cv = $('hero-canvas'); if (!cv) return;
    const c = cv.getContext('2d');
    const w = cv.width, h = cv.height;
    c.clearRect(0,0,w,h);
    // glow behind hero
    const g = c.createRadialGradient(w*0.5, h*0.7, 20, w*0.5, h*0.7, 180);
    g.addColorStop(0,'rgba(255,255,255,0.18)'); g.addColorStop(1,'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(0,0,w,h);
    const charDef = CHARACTER_LIST.find(x=>x.id===state.charId) || CHARACTER_LIST[0];
    const bob = Math.sin(t*2.2) * 4;
    const showcaseImg = getCharacterImage(charDef.id, 'idle') || getCharacterImage(charDef.id, 'avatar');
    if (showcaseImg) {
      const scale = 2.3;
      const size = 256 * scale;
      const px = 128 * scale, py = 220 * scale;
      // pedestal
      c.save();
      const pedGrad = c.createRadialGradient(w/2, h*0.78+bob+6, 6, w/2, h*0.78+bob+6, 56*scale/1);
      pedGrad.addColorStop(0, 'rgba(254,240,138,0.9)'); pedGrad.addColorStop(0.6,'rgba(56,189,248,0.45)'); pedGrad.addColorStop(1,'rgba(56,189,248,0)');
      c.fillStyle = pedGrad; c.beginPath(); c.ellipse(w/2, h*0.78+bob+6, 56*2.3/1.5, 16*2.3/1.5, 0, 0, Math.PI*2); c.fill();
      c.restore();
      c.drawImage(showcaseImg, w/2-px, h*0.78+bob-py, size, size);
    } else {
      drawChibiHero2D(c, {
        x: w/2, y: h*0.78 + bob, scale: 2.3, facing: 1,
        characterId: charDef.id,
        primaryColor: state.costumeColor || charDef.color,
        accentColor: charDef.skin?.shirt2 || '#facc15',
        walkPhase: Math.sin(t*2) * 0.8,
        aimAngle: -0.3,
        isAiming: false,
        showPedestal: true,
      });
    }
  }

  function escapeHtml(s){ return String(s).replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }

  // Login
  const nameInput = $('login-name');
  if (nameInput) nameInput.value = state.playerName;
  $('login-submit')?.addEventListener('click', () => {
    const v = (nameInput?.value || '').trim().slice(0,14);
    if (!v) { nameInput?.focus(); return; }
    state.playerName = v;
    localStorage.setItem(LS_NAME, v);
    renderLobby();
    show('lobby');
    callbacks.onLogin?.(v);
  });
  nameInput?.addEventListener('keydown', (e)=>{ if(e.key==='Enter') $('login-submit')?.click(); });

  $('lobby-logout')?.addEventListener('click', () => { show('login'); nameInput?.focus(); });
  $('btn-play-bot')?.addEventListener('click', () => callbacks.onPlayBot?.({ charId: state.charId, mapId: state.mapId, name: getPlayerName(), costumeColor: state.costumeColor }));
  $('btn-create-room')?.addEventListener('click', () => callbacks.onCreateRoom?.({ charId: state.charId, mapId: state.mapId, name: getPlayerName(), costumeColor: state.costumeColor }));
  $('btn-join-room')?.addEventListener('click', () => {
    const code = ($('join-code-input')?.value || '').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,4);
    if (code.length < 4) { setLobbyStatus('Masukkan kode room 4 karakter.'); return; }
    callbacks.onJoinRoom?.({ code, charId: state.charId, name: getPlayerName(), costumeColor: state.costumeColor });
  });
  $('btn-copy-link')?.addEventListener('click', async () => {
    const link = $('waiting-link')?.textContent || '';
    if (!link || link === '-') return;
    try { await navigator.clipboard.writeText(link); setWaitingStatus('Link disalin.'); }
    catch { setWaitingStatus('Gagal menyalin. Salin manual.'); }
  });
  $('btn-start-game')?.addEventListener('click', () => callbacks.onStartGame?.());
  $('btn-add-bot')?.addEventListener('click', () => callbacks.onAddBot?.());
  $('btn-leave-room')?.addEventListener('click', () => callbacks.onLeaveRoom?.());
  btnMenu?.addEventListener('click', () => callbacks.onMenu?.());

  // init
  renderLobby();
  if (state.playerName) show('lobby');
  else show('login');

  return {
    state,
    show,
    getPlayerName,
    setLobbyStatus: (msg) => { const el=$('lobby-status'); if(el) el.textContent = msg || ''; },
    setWaitingStatus: (msg) => { const el=$('waiting-status'); if(el) el.textContent = msg || ''; },
    renderWaiting,
    renderChars: renderLobby,
    renderMaps,
    setRoom(code, isHost) { state.roomCode = code; state.isHost = !!isHost; renderWaiting(); },
    setPlayers(players) { state.players = players; renderWaiting(); },
  };
}
