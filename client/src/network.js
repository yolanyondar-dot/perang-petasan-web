function getWsUrl() {
  const qs = new URLSearchParams(location.search);
  const fromQuery = qs.get('server');
  if (fromQuery) {
    const u = fromQuery.replace(/\/$/, '');
    if (u.startsWith('ws://') || u.startsWith('wss://')) return u;
    return u.replace(/^http/, 'ws');
  }
  // Dev: Vite on 5173, node server on 3001 (Socket.IO path not used here, but WS server may differ).
  // For Cloudflare/production same-origin, use current host.
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

  function connect() {
    clearReconnect();
    try { ws?.close(); } catch (_) {}
    const url = `${wsBase}/ws?role=host`;
    ws = new WebSocket(url);

    ws.addEventListener('open', () => {
      connected = true;
      reconnectAttempts = 0;
      handlers.onStatus?.({ connected: true, serverUrl: wsBase });
    });

    ws.addEventListener('message', (evt) => {
      let msg;
      try { msg = JSON.parse(String(evt.data)); } catch (_) { return; }
      if (!msg || typeof msg !== 'object') return;
      switch (msg.type) {
        case 'room-created':
          if (msg.roomCode) emitRoomCreated(msg.roomCode);
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
        default:
          break;
      }
    });

    ws.addEventListener('close', (evt) => {
      const wasConnected = connected;
      connected = false;
      handlers.onStatus?.({ connected: false, reason: evt.reason || `close:${evt.code}`, serverUrl: wsBase });
      if (shouldReconnect) scheduleReconnect();
    });

    ws.addEventListener('error', () => {
      handlers.onStatus?.({ connected: false, error: 'WebSocket error', serverUrl: wsBase });
    });

    return ws;
  }

  return {
    connect,
    get socket() { return ws; },
    get roomCode() { return roomCode; },
    get connected() { return connected; },
    get serverUrl() { return wsBase; },
    getControllerUrl,
  };
}
