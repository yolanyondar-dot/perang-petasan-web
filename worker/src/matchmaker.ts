import { ROOM_MODES, type RoomMode } from '@pp/shared';
import { error, json } from './http.js';
import { isFightHeroId } from './catalog.js';
import type { RoomRecord, SessionInfo } from './types.js';

const SESSION_TTL_MS = 120_000;

function sanitizeMode(value: unknown): RoomMode {
  return typeof value === 'string' && value in ROOM_MODES ? (value as RoomMode) : '5v5';
}

function safeName(value: unknown, fallback: string): string {
  const cleaned = typeof value === 'string' ? value.trim().slice(0, 16) : '';
  return cleaned || `Warga ${fallback.slice(0, 4)}`;
}

/** Matchmaker satu instance: memilih room per mode (filterBy(['mode']) versi Worker). */
export class Matchmaker implements DurableObject {
  private readonly ctx: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.ctx = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/session') {
      return this.createSession(request);
    }

    if (request.method === 'GET' && url.pathname.startsWith('/session/')) {
      const id = decodeURIComponent(url.pathname.slice('/session/'.length));
      return this.getSession(id);
    }

    if (request.method === 'POST' && url.pathname === '/room-update') {
      return this.updateRoom(request);
    }

    return error('Route matchmaker tidak dikenal', 404);
  }

  private async createSession(request: Request): Promise<Response> {
    let body: Record<string, unknown> = {};
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return error('Body JSON tidak valid');
    }

    const mode = sanitizeMode(body.mode);
    const loadout = body.loadout as Record<string, unknown> | undefined;
    const heroId = isFightHeroId(loadout?.heroId) ? loadout.heroId : 'bocil_sarung';
    const thrLevel = Math.max(
      0,
      Math.min(10, Math.floor(Number(loadout?.thrLevel) || 0)),
    );
    const name = safeName(body.name, crypto.randomUUID());
    const maxHumans = ROOM_MODES[mode]!.teamSize * 2;

    const rooms = await this.getRooms(mode);
    let room = rooms.find((entry) => entry.humans < maxHumans);
    if (!room) {
      room = { id: `r-${mode}-${crypto.randomUUID().slice(0, 8)}`, mode, humans: 0 };
      rooms.push(room);
    }
    room.humans += 1;
    await this.saveRooms(mode, rooms);

    const session: SessionInfo = {
      id: crypto.randomUUID(),
      roomId: room.id,
      mode,
      name,
      loadout: { heroId, thrLevel },
      fillBots: true,
      expiresAt: Date.now() + SESSION_TTL_MS,
    };
    await this.ctx.storage.put(`session:${session.id}`, session);
    return json(session);
  }

  private async getSession(id: string): Promise<Response> {
    const key = `session:${id}`;
    const session = await this.ctx.storage.get<SessionInfo>(key);
    if (!session || session.expiresAt < Date.now()) {
      if (session) await this.ctx.storage.delete(key);
      return error('Sesi matchmaking kedaluwarsa', 404);
    }
    return json(session);
  }

  private async updateRoom(request: Request): Promise<Response> {
    let body: Record<string, unknown> = {};
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return error('Body JSON tidak valid');
    }
    const mode = sanitizeMode(body.mode);
    if (typeof body.roomId !== 'string' || typeof body.delta !== 'number') {
      return error('Payload room-update tidak valid');
    }

    const rooms = await this.getRooms(mode);
    const index = rooms.findIndex((entry) => entry.id === body.roomId);
    if (index >= 0) {
      rooms[index]!.humans = Math.max(0, rooms[index]!.humans + body.delta);
      if (rooms[index]!.humans <= 0) rooms.splice(index, 1);
      await this.saveRooms(mode, rooms);
    }
    return json({ ok: true });
  }

  private async getRooms(mode: RoomMode): Promise<RoomRecord[]> {
    return (await this.ctx.storage.get<RoomRecord[]>(`rooms:${mode}`)) ?? [];
  }

  private async saveRooms(mode: RoomMode, rooms: RoomRecord[]): Promise<void> {
    await this.ctx.storage.put(`rooms:${mode}`, rooms);
  }
}
