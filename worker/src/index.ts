import { error, json } from './http.js';
import { FightRoom } from './room.js';
import type { WorkerEnv } from './types.js';

export { FightRoom };

const ROOM_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function makeRoomCode(): string {
  let code = '';
  for (let i = 0; i < 4; i += 1) code += ROOM_CHARS[Math.floor(Math.random() * ROOM_CHARS.length)];
  return code;
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return json({ ok: true, game: 'perang-petasan', runtime: 'cloudflare-worker' });
    }

    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
        return error('Expected websocket upgrade', 426);
      }

      const role = (url.searchParams.get('role') || '').toLowerCase();
      if (role !== 'host' && role !== 'controller') {
        return error('Invalid role', 400);
      }

      let roomCode = (url.searchParams.get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
      if (role === 'host') {
        roomCode = makeRoomCode();
      }
      if (!roomCode || roomCode.length !== 4) {
        return error('Invalid room code', 400);
      }

      const name = (url.searchParams.get('name') || 'Pemain').slice(0, 24);
      const id = env.ROOM.idFromName(roomCode);
      const stub = env.ROOM.get(id);

      const headers = new Headers(request.headers);
      headers.set('x-role', role);
      headers.set('x-room-code', roomCode);
      headers.set('x-name', name);

      const forwardUrl = new URL('https://room.internal/ws');
      forwardUrl.searchParams.set('role', role);
      forwardUrl.searchParams.set('room', roomCode);
      forwardUrl.searchParams.set('name', name);

      return stub.fetch(new Request(forwardUrl.toString(), {
        method: request.method,
        headers,
      }));
    }

    // Static assets (client/dist) with SPA fallback handled by assets config
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<WorkerEnv>;
