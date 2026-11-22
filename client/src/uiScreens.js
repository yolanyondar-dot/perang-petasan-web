import { CHARACTER_LIST } from './charactersConfig.js';
import { MAP_LIST } from './terrain.js';

const LS_NAME = 'pp_player_name';

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
    mapId: 'gang_kampung',
    roomCode: null,
    isHost: false,
    players: [], // {name,charId,isHost,isReady,isBot,isMe}
  };

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
    // hide hint on mobile via css; but ensure not forced
    if (playing && window.matchMedia('(max-width: 900px)').matches && hint) hint.style.display = 'none';
    callbacks.onScreenChange?.(name);
  }

  function renderChars() {
    const grid = $('char-grid');
    if (!grid) return;
    grid.innerHTML = CHARACTER_LIST.map(c => {
      const s1 = c.skills.skill1?.name || '-';
      const s2 = c.skills.skill2?.name || '-';
      const u = c.skills.ulti?.name || '-';
      const role = c.id === 'udin' ? 'Fighter' : c.id === 'sari' ? 'Area Control' : c.id === 'hendra' ? 'Tank/Bruiser' : 'Agile';
      return `<div class="card ${state.charId===c.id?'selected':''}" data-char="${c.id}">
        <h3>${c.name}</h3>
        <div class="role">${role}</div>
        <div class="skill"><b>S1:</b> ${s1}<br><b>S2:</b> ${s2}<br><b>Ulti:</b> ${u}</div>
      </div>`;
    }).join('');
    grid.querySelectorAll('[data-char]').forEach(el => el.addEventListener('click', () => {
      state.charId = el.dataset.char;
      renderChars();
      callbacks.onCharSelect?.(state.charId);
    }));
  }

  function renderMaps() {
    const grid = $('map-grid');
    if (!grid) return;
    const desc = {
      gang_kampung: 'Bukit ringan, pagar & pohon kampung.',
      atap_rumah: 'Atap genteng bertingkat dengan celah.',
      jurang_kali: 'Dua daratan, jurang tengah, pijakan bawah.',
    };
    grid.innerHTML = MAP_LIST.map(m => `<div class="card ${state.mapId===m.id?'selected':''}" data-map="${m.id}">
      <h3>${m.name}</h3>
      <div class="skill">${desc[m.id] || ''}</div>
    </div>`).join('');
    grid.querySelectorAll('[data-map]').forEach(el => el.addEventListener('click', () => {
      state.mapId = el.dataset.map;
      renderMaps();
      callbacks.onMapSelect?.(state.mapId);
    }));
  }

  function renderWaiting() {
    $('waiting-code').textContent = state.roomCode || '----';
    const link = state.roomCode ? `${location.origin}${location.pathname}?room=${state.roomCode}` : '-';
    $('waiting-link').textContent = link;
    $('waiting-role').textContent = state.isHost ? 'Host' : 'Player';
    $('btn-start-game').style.display = state.isHost ? '' : 'none';
    $('btn-add-bot').style.display = state.isHost ? '' : 'none';
    const list = $('waiting-players');
    list.innerHTML = (state.players.length ? state.players : [{name:getPlayerName(),charId:state.charId,isHost:state.isHost,isMe:true}]).map(p => {
      const c = CHARACTER_LIST.find(x=>x.id===p.charId);
      const tags = [p.isHost ? 'Host' : null, p.isBot ? 'Bot' : null, p.isMe ? 'Kamu' : null, p.isReady ? 'Siap' : null].filter(Boolean).join(' • ');
      return `<div class="player-row"><div><strong>${escapeHtml(p.name||'Pemain')}</strong><div class="meta">${escapeHtml(c?.name||p.charId||'-')}${tags ? ' — '+tags : ''}</div></div><div class="pill">${p.isBot?'BOT':'ONLINE'}</div></div>`;
    }).join('');
  }

  function setLobbyStatus(msg) { const el=$('lobby-status'); if(el) el.textContent = msg || ''; }
  function setWaitingStatus(msg) { const el=$('waiting-status'); if(el) el.textContent = msg || ''; }

  function escapeHtml(s){ return String(s).replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }

  // Login
  const nameInput = $('login-name');
  if (nameInput) nameInput.value = state.playerName;
  $('login-submit')?.addEventListener('click', () => {
    const v = (nameInput?.value || '').trim().slice(0,14);
    if (!v) { nameInput?.focus(); return; }
    state.playerName = v;
    localStorage.setItem(LS_NAME, v);
    $('lobby-player-name').textContent = v;
    renderChars(); renderMaps();
    show('lobby');
    callbacks.onLogin?.(v);
  });
  nameInput?.addEventListener('keydown', (e)=>{ if(e.key==='Enter') $('login-submit')?.click(); });

  $('lobby-logout')?.addEventListener('click', () => { show('login'); nameInput?.focus(); });
  $('lobby-player-name').textContent = getPlayerName();

  $('btn-play-bot')?.addEventListener('click', () => callbacks.onPlayBot?.({ charId: state.charId, mapId: state.mapId, name: getPlayerName() }));
  $('btn-create-room')?.addEventListener('click', () => callbacks.onCreateRoom?.({ charId: state.charId, mapId: state.mapId, name: getPlayerName() }));
  $('btn-join-room')?.addEventListener('click', () => {
    const code = ($('join-code-input')?.value || '').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,4);
    if (code.length < 4) { setLobbyStatus('Masukkan kode room 4 karakter.'); return; }
    callbacks.onJoinRoom?.({ code, charId: state.charId, name: getPlayerName() });
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

  // Auto login if name saved
  renderChars(); renderMaps();
  if (state.playerName) {
    $('lobby-player-name').textContent = getPlayerName();
    show('lobby');
    // don't auto-callback login to avoid double init; caller can check
  } else {
    show('login');
  }

  return {
    state,
    show,
    getPlayerName,
    setLobbyStatus,
    setWaitingStatus,
    renderWaiting,
    renderChars,
    renderMaps,
    setRoom(code, isHost) { state.roomCode = code; state.isHost = !!isHost; renderWaiting(); },
    setPlayers(players) { state.players = players; renderWaiting(); },
  };
}
