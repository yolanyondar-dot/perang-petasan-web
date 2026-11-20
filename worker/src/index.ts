import { ROOM_MODES, type RoomMode } from '@pp/shared';
import { error, json } from './http.js';
import { Matchmaker } from './matchmaker.js';
import { FightRoom } from './room.js';
import type { SessionInfo, WorkerEnv } from './types.js';

export { FightRoom, Matchmaker };

function resolveMatchmaker(env: WorkerEnv): DurableObjectStub {
  const namespace = env.MATCHMAKER;
  return namespace.get(namespace.idFromName('global'));
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return json({ ok: true, game: 'perang-petasan', runtime: 'cloudflare-worker' });
    }

    if (url.pathname === '/ws/matchmake/joinOrCreate/moba') {
      if (request.method !== 'POST') return error('Method tidak diizinkan', 405);
      const matchmaker = resolveMatchmaker(env);
      const forwarded = new Request('https://matchmaker.internal/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: request.body,
      });
      return matchmaker.fetch(forwarded);
    }

    if (url.pathname === '/ws') {
      const sessionId = url.searchParams.get('session');
      if (!sessionId) return error('Session matchmaking wajib diisi');

      const matchmaker = resolveMatchmaker(env);
      const sessionResponse = await matchmaker.fetch(
        new Request(`https://matchmaker.internal/session/${encodeURIComponent(sessionId)}`),
      );
      if (!sessionResponse.ok) return error('Sesi tidak valid atau kedaluwarsa', 401);
      const session = (await sessionResponse.json()) as SessionInfo;
      if (!ROOM_MODES[session.mode]) {
        return error(`Mode tidak dikenal: ${String(session.mode)}`);
      }

      const namespace = env.FIGHT_ROOM;
      const room = namespace.get(namespace.idFromName(`room:${session.mode}:${session.roomId}`));

      const headers = new Headers(request.headers);
      headers.delete('host');
      headers.set('x-pp-mode', session.mode as RoomMode);
      headers.set('x-pp-name', session.name ?? '');
      headers.set('x-pp-hero', session.loadout?.heroId ?? 'bocil_sarung');
      headers.set('x-pp-thr', String(session.loadout?.thrLevel ?? 0));
      headers.set('x-pp-room', session.roomId);

      const target = new URL('https://room.internal/ws');
      target.searchParams.set('session', sessionId);
      const forwarded = new Request(target.toString(), {
        method: request.method,
        headers,
        body: request.method === 'GET' || request.method === 'HEAD' ? null : request.body,
      });
      return room.fetch(forwarded);
    }

    if (url.pathname.startsWith('/ws/')) return error('Route WebSocket tidak dikenal', 404);

    //Debug ringan: GET /debug/state?mode=5v5&roomId=...
    if (url.pathname === '/debug/state') {
      const mode = sanitize(url.searchParams.get('mode'));
      const roomId = url.searchParams.get('roomId');
      if (!roomId) return error('roomId wajib diisi');
      const namespace = env.FIGHT_ROOM;
      const room = namespace.get(namespace.idFromName(`room:${mode}:${roomId}`));
      return room.fetch(new Request('https://room.internal/state'));
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<WorkerEnv>;

function sanitize(value: string | null): RoomMode {
  return value && value in ROOM_MODES ? (value as RoomMode) : '5v5';
}
