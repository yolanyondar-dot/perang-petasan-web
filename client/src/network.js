function getWsUrl() {
  const qs = new URLSearchParams(location.search);
  const fromQuery = qs.get('server');
  if (fromQuery) {
    const u = fromQuery.replace(/\/$/, '');
    if (u.startsWith('ws://') || u.startsWith('wss://')) return u;
    return u.replace(/^http/, 'ws');
  }
  // Vite dev -> assume local wrangler dev on 8787, or override via ?server=
  if (location.port === '5173' || location.port === '5174' || location.port === '4173' || location.port === '4174' || location.port === '4175' || location.port === '4176') {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.hostname}:8787`;
  }
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}`;
}

export function createNetwork(handlers = {}) {
  const wsBase = getWsUrl();
  let ws = null;
  let roomCode = null;
  let connected = false;
  let shouldReconnect = false;
  let reconnectTimer = null;
  let reconnectAttempts = 0;
  let mode = 'none'; // 'host' | 'player' | 'none'
  let joinCode = '';
  let joinName = '';
  let joinColor = '#ff5fa2';
  let joinCharId = 'udin';
  let myPlayerId = null;

  function clearReconnect() {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  }

  function scheduleReconnect() {
    if (!shouldReconnect || mode === 'none') return;
    clearReconnect();
    const delay = Math.min(1000 * Math.pow(1.5, reconnectAttempts), 8000);
    reconnectAttempts += 1;
    reconnectTimer = setTimeout(() => connect({ mode, roomCode: joinCode, name: joinName, color: joinColor, charId: joinCharId, reconnect: true }), delay);
  }

  function buildUrl() {
    if (mode === 'player') {
      return `${wsBase}/ws?role=player&room=${encodeURIComponent(joinCode)}&name=${encodeURIComponent(joinName)}&color=${encodeURIComponent(joinColor)}&characterType=${encodeURIComponent(joinCharId)}`;
    }
    return `${wsBase}/ws?role=host`;
  }

  function connect(opts = {}) {
    if (opts.mode) mode = opts.mode;
    if (opts.roomCode) joinCode = String(opts.roomCode).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    if (opts.name) joinName = String(opts.name).slice(0, 14);
    if (opts.color) joinColor = String(opts.color).slice(0, 16);
    if (opts.charId) joinCharId = String(opts.charId).slice(0, 24);
    shouldReconnect = opts.reconnect !== false && mode !== 'none';

    clearReconnect();
    try { ws?.close(); } catch (_) {}
    roomCode = mode === 'player' ? joinCode : null;
    myPlayerId = null;

    const url = buildUrl();
    try { ws = new WebSocket(url); } catch (e) {
      handlers.onStatus?.({ connected: false, error: String(e), serverUrl: wsBase, mode });
      return null;
    }

    ws.addEventListener('open', () => {
      connected = true;
      reconnectAttempts = 0;
      handlers.onStatus?.({ connected: true, serverUrl: wsBase, mode, roomCode });
    });

    ws.addEventListener('message', (evt) => {
      let msg;
      try { msg = JSON.parse(String(evt.data)); } catch (_) { return; }
      if (!msg || typeof msg !== 'object') return;
      switch (msg.type) {
        case 'room-created':
          roomCode = msg.roomCode || roomCode;
          handlers.onRoomCreated?.({ roomCode, serverUrl: wsBase });
          break;
        case 'joined-room':
          roomCode = msg.roomCode || roomCode;
          myPlayerId = msg.playerId || msg.controllerId || myPlayerId;
          handlers.onJoinedRoom?.({ ...msg, roomCode, playerId: myPlayerId });
          break;
        case 'join-error':
          handlers.onJoinError?.(msg);
          break;
        case 'player-joined':
          handlers.onPlayerJoined?.(msg);
          break;
        case 'player-hello':
          handlers.onPlayerHello?.(msg);
          break;
        case 'player-input':
          handlers.onPlayerInput?.(msg);
          break;
        case 'player-left':
          handlers.onPlayerLeft?.(msg);
          break;
        case 'room-closed':
          handlers.onRoomClosed?.(msg);
          shouldReconnect = false;
          break;
        case 'game-state':
          handlers.onGameState?.(msg);
          break;
        case 'host-event':
          handlers.onHostEvent?.(msg);
          break;
        case 'pong':
          break;
        default:
          break;
      }
    });

    ws.addEventListener('close', (evt) => {
      connected = false;
      handlers.onStatus?.({ connected: false, reason: evt.reason || `close:${evt.code}`, serverUrl: wsBase, mode, roomCode });
      if (shouldReconnect) scheduleReconnect();
    });

    ws.addEventListener('error', () => {
      handlers.onStatus?.({ connected: false, error: 'WebSocket error', serverUrl: wsBase, mode, roomCode });
    });

    return ws;
  }

  function send(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify(msg)); } catch (_) {}
    }
  }

  function disconnect() {
    shouldReconnect = false;
    mode = 'none';
    clearReconnect();
    try { ws?.close(); } catch (_) {}
    ws = null;
    connected = false;
    roomCode = null;
    myPlayerId = null;
  }

  return {
    connect,
    send,
    disconnect,
    get socket() { return ws; },
    get roomCode() { return roomCode; },
    get connected() { return connected; },
    get serverUrl() { return wsBase; },
    get mode() { return mode; },
    get myPlayerId() { return myPlayerId; },
  };
}
