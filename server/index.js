import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || '0.0.0.0';
const CLIENT_DIST = path.resolve(__dirname, '../client/dist');
const CLIENT_ROOT = path.resolve(__dirname, '../client');

const app = express();
app.use(express.json());

// Sajikan build produksi jika ada, dan juga controller.html dari client root.
app.use(express.static(CLIENT_DIST));
app.use(express.static(CLIENT_ROOT));

app.get('/health', (_req, res) => res.json({ ok: true }));

// SPA fallback untuk route frontend (jangan tangkap Socket.IO).
app.get(/^(?!\/socket\.io).*/, (req, res, next) => {
  if (req.method !== 'GET') return next();
  if (path.extname(req.path)) return next();
  return res.sendFile(path.join(CLIENT_DIST, 'index.html'), (err) => {
    if (err) next();
  });
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

/** @type {Map<string, {hostSocketId: string, controllers: Map<string, {socketId:string,name:string}>}>} */
const rooms = new Map();
/** @type {Map<string, {role:'host'|'controller', roomCode?:string, controllerId?:string}>} */
const socketMeta = new Map();

const ROOM_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // hindari O,I,1,0

function makeRoomCode() {
  for (let i = 0; i < 2000; i += 1) {
    let code = '';
    for (let j = 0; j < 4; j += 1) code += ROOM_CHARS[Math.floor(Math.random() * ROOM_CHARS.length)];
    if (!rooms.has(code)) return code;
  }
  return 'PETA';
}

function getRoomByHost(socketId) {
  for (const [code, room] of rooms.entries()) {
    if (room.hostSocketId === socketId) return { code, room };
  }
  return null;
}

io.on('connection', (socket) => {
  socketMeta.set(socket.id, { role: 'unknown' });

  socket.on('create-room', (_payload, ack) => {
    // Jika host sudah punya room, pakai ulang.
    const existing = getRoomByHost(socket.id);
    if (existing) {
      const payload = { roomCode: existing.code };
      socket.emit('room-created', payload);
      ack?.({ ok: true, ...payload });
      return;
    }

    const roomCode = makeRoomCode();
    rooms.set(roomCode, { hostSocketId: socket.id, controllers: new Map() });
    socketMeta.set(socket.id, { role: 'host', roomCode });
    socket.join(`room:${roomCode}:host`);
    const payload = { roomCode };
    socket.emit('room-created', payload);
    ack?.({ ok: true, ...payload });
    console.log(`[room] created ${roomCode} by host ${socket.id}`);
  });

  socket.on('join-room', (payload = {}, ack) => {
    const rawCode = String(payload.roomCode || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const roomCode = rawCode.slice(0, 4);
    const name = String(payload.name || '').trim().slice(0, 24) || 'Pemain';
    const room = rooms.get(roomCode);
    if (!room) {
      const err = { ok: false, message: `Kode room "${roomCode || '-'}" tidak ditemukan.` };
      socket.emit('join-error', err);
      ack?.(err);
      return;
    }

    const controllerId = socket.id;
    room.controllers.set(controllerId, { socketId: socket.id, name });
    socketMeta.set(socket.id, { role: 'controller', roomCode, controllerId });
    socket.join(`room:${roomCode}:controllers`);

    const joinedPayload = { ok: true, roomCode, controllerId, name };
    socket.emit('joined-room', joinedPayload);
    ack?.(joinedPayload);

    io.to(room.hostSocketId).emit('player-joined', {
      roomCode,
      controllerId,
      name,
    });
    console.log(`[room] ${name} (${controllerId}) joined ${roomCode}`);
  });

  socket.on('player-input', (payload = {}) => {
    const meta = socketMeta.get(socket.id);
    if (!meta || meta.role !== 'controller' || !meta.roomCode) return;
    const room = rooms.get(meta.roomCode);
    if (!room) return;

    const state = payload.state && typeof payload.state === 'object' ? payload.state : payload;
    const safe = {
      moveX: Math.max(-1, Math.min(1, Number(state.moveX) || 0)),
      moveZ: Math.max(-1, Math.min(1, Number(state.moveZ) || 0)),
      jump: !!state.jump,
      punch: !!state.punch,
      grabThrow: !!state.grabThrow,
      bombHeld: !!state.bombHeld,
    };

    io.to(room.hostSocketId).emit('player-input', {
      roomCode: meta.roomCode,
      controllerId: meta.controllerId || socket.id,
      state: safe,
    });
  });

  socket.on('disconnect', (reason) => {
    const meta = socketMeta.get(socket.id);
    socketMeta.delete(socket.id);
    if (!meta) return;

    if (meta.role === 'host' && meta.roomCode) {
      const room = rooms.get(meta.roomCode);
      if (room && room.hostSocketId === socket.id) {
        rooms.delete(meta.roomCode);
        io.to(`room:${meta.roomCode}:controllers`).emit('room-closed', { roomCode: meta.roomCode });
        console.log(`[room] closed ${meta.roomCode} (host disconnect: ${reason})`);
      }
    }

    if (meta.role === 'controller' && meta.roomCode) {
      const room = rooms.get(meta.roomCode);
      if (room) {
        room.controllers.delete(meta.controllerId || socket.id);
        io.to(room.hostSocketId).emit('player-left', {
          roomCode: meta.roomCode,
          controllerId: meta.controllerId || socket.id,
          reason,
        });
        console.log(`[room] controller left ${meta.roomCode}: ${meta.controllerId || socket.id}`);
      }
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[server] listening on http://${HOST}:${PORT}`);
  console.log(`[server] serving client dist: ${CLIENT_DIST}`);
});
