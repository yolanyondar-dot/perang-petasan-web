import { io } from 'socket.io-client';

function getServerUrl() {
  const qs = new URLSearchParams(location.search);
  const fromQuery = qs.get('server');
  if (fromQuery) return fromQuery.replace(/\/$/, '');
  // Dev default: Vite di 5173, socket server di 3001. Produksi/same-origin: pakai origin.
  if (location.port === '5173' || location.port === '5174') {
    return `${location.protocol}//${location.hostname}:3001`;
  }
  return location.origin;
}

function getControllerUrl() {
  const proto = location.protocol === 'https:' ? 'https:' : 'http:';
  const host = location.hostname;
  const port = location.port === '5173' || location.port === '5174' ? '5173' : location.port;
  const base = `${proto}//${host}${port ? `:${port}` : ''}`;
  return `${base}/controller.html`;
}

export function createNetwork(handlers = {}) {
  const serverUrl = getServerUrl();
  let socket = null;
  let roomCode = null;
  let connected = false;

  function emitRoomCreated(code) {
    roomCode = code;
    handlers.onRoomCreated?.({ roomCode: code, serverUrl, controllerUrl: getControllerUrl() });
  }

  function connect() {
    socket = io(serverUrl, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 20,
      reconnectionDelay: 1000,
    });

    socket.on('connect', () => {
      connected = true;
      handlers.onStatus?.({ connected: true, serverUrl });
      socket.emit('create-room', {}, (res) => {
        if (res?.ok && res.roomCode) emitRoomCreated(res.roomCode);
      });
    });

    socket.on('room-created', (payload) => {
      if (payload?.roomCode) emitRoomCreated(payload.roomCode);
    });

    socket.on('player-joined', (payload) => {
      handlers.onPlayerJoined?.(payload);
    });

    socket.on('player-input', (payload) => {
      handlers.onPlayerInput?.(payload);
    });

    socket.on('player-left', (payload) => {
      handlers.onPlayerLeft?.(payload);
    });

    socket.on('disconnect', (reason) => {
      connected = false;
      handlers.onStatus?.({ connected: false, reason, serverUrl });
    });

    socket.on('connect_error', (err) => {
      handlers.onStatus?.({ connected: false, error: err?.message || String(err), serverUrl });
    });

    return socket;
  }

  return {
    connect,
    get socket() { return socket; },
    get roomCode() { return roomCode; },
    get connected() { return connected; },
    get serverUrl() { return serverUrl; },
    getControllerUrl,
  };
}
