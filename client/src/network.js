function getWsUrl() {
  const qs = new URLSearchParams(location.search);
  const fromQuery = qs.get('server');
  if (fromQuery) {
    const u = fromQuery.replace(/\/$/, '');
    if (u.startsWith('ws://') || u.startsWith('wss://')) return u;
    return u.replace(/^http/, 'ws');
  }
  if (location.port === '5173' || location.port === '5174') {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.hostname}:3001`;
  }
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}`;
}

function getControllerUrl() {
  return `${location.protocol}//${location.host}/controller.html`;
}

export function createNetwork(handlers = {}) {
  const wsBase = getWsUrl();
  let ws = null;
  let roomCode = null;
  let connected = false;
  let shouldReconnect = true;
  let reconnectTimer = null;
  let reconnectAttempts = 0;
  let mode = 'host'; // 'host' | 'player'
  let joinCode = '';
  let joinName = '';
  let joinColor = '#ff5fa2';
  let joinCharacterType = 'klasik';

  function emitRoomCreated(code) {
    roomCode = code;
    handlers.onRoomCreated?.({ roomCode: code, serverUrl: wsBase, controllerUrl: getControllerUrl() });
  }

  function clearReconnect() {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  }

  function scheduleReconnect() {
    if (!shouldReconnect) return;
    clearReconnect();
    const delay = Math.min(1000 * Math.pow(1.5, reconnectAttempts), 8000);
    reconnectAttempts += 1;
    reconnectTimer = setTimeout(() => connect(), delay);
  }

  function buildUrl() {
    if (mode === 'player') {
      return `${wsBase}/ws?role=player&room=${encodeURIComponent(joinCode)}&name=${encodeURIComponent(joinName)}&color=${encodeURIComponent(joinColor)}&characterType=${encodeURIComponent(joinCharacterType)}`;
    }
    return `${wsBase}/ws?role=host`;
  }

  function connect(opts = {}) {
    if (opts.mode) mode = opts.mode;
    if (opts.roomCode) joinCode = String(opts.roomCode).toUpperCase().slice(0, 4);
    if (opts.name) joinName = String(opts.name).slice(0, 14);
    if (opts.color) joinColor = String(opts.color).slice(0, 16);
    if (opts.characterType) joinCharacterType = String(opts.characterType).slice(0, 24);
    if (opts.reconnect === false) shouldReconnect = false;

    clearReconnect();
    try { ws?.close(); } catch (_) {}
    const url = buildUrl();
    ws = new WebSocket(url);

    ws.addEventListener('open', () => {
      connected = true;
      reconnectAttempts = 0;
      handlers.onStatus?.({ connected: true, serverUrl: wsBase, mode });
    });

    ws.addEventListener('message', (evt) => {
      let msg;
      try { msg = JSON.parse(String(evt.data)); } catch (_) { return; }
      if (!msg || typeof msg !== 'object') return;
      switch (msg.type) {
        case 'room-created':
          if (msg.roomCode) emitRoomCreated(msg.roomCode);
          break;
        case 'joined-room':
          roomCode = msg.roomCode || roomCode;
          handlers.onJoinedRoom?.(msg);
          break;
        case 'join-error':
          handlers.onJoinError?.(msg);
          break;
        case 'player-joined':
          handlers.onPlayerJoined?.(msg);
          break;
        case 'player-input':
          handlers.onPlayerInput?.(msg);
          break;
        case 'player-left':
          handlers.onPlayerLeft?.(msg);
          break;
        case 'room-closed':
          handlers.onRoomClosed?.(msg);
          break;
        case 'game-state':
          handlers.onGameState?.(msg);
          break;
        case 'host-event':
          handlers.onHostEvent?.(msg);
          break;
        default:
          break;
      }
    });

    ws.addEventListener('close', (evt) => {
      connected = false;
      handlers.onStatus?.({ connected: false, reason: evt.reason || `close:${evt.code}`, serverUrl: wsBase, mode });
      if (shouldReconnect) scheduleReconnect();
    });

    ws.addEventListener('error', () => {
      handlers.onStatus?.({ connected: false, error: 'WebSocket error', serverUrl: wsBase, mode });
    });

    return ws;
  }

  function send(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  return {
    connect,
    send,
    get socket() { return ws; },
    get roomCode() { return roomCode; },
    get connected() { return connected; },
    get serverUrl() { return wsBase; },
    get mode() { return mode; },
    getControllerUrl,
  };
}
