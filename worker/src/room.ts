import { error, json } from './http.js';

type Role = 'host' | 'controller' | 'player';

interface ControllerInfo {
  ws: WebSocket;
  name: string;
}

interface PlayerInfo {
  ws: WebSocket;
  name: string;
}

const ROOM_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function makeId(): string {
  let id = '';
  for (let i = 0; i < 12; i += 1) id += ROOM_CHARS[Math.floor(Math.random() * ROOM_CHARS.length)];
  return id;
}

export class FightRoom implements DurableObject {
  private host: WebSocket | null = null;
  private controllers = new Map<string, ControllerInfo>(); // controllerId -> info
  private players = new Map<string, PlayerInfo>(); // playerId -> info (full game clients)

  constructor(_state: DurableObjectState, _env: unknown) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/state') {
      return json({
        ok: true,
        hasHost: !!this.host,
        controllers: this.controllers.size,
        players: this.players.size,
      });
    }

    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return error('Expected websocket', 426);
    }

    const role = (request.headers.get('x-role') || url.searchParams.get('role') || '') as Role;
    const roomCode = (request.headers.get('x-room-code') || url.searchParams.get('room') || '').toUpperCase();
    const name = (request.headers.get('x-name') || url.searchParams.get('name') || 'Pemain').slice(0, 24);

    if (role !== 'host' && role !== 'controller' && role !== 'player') return error('Invalid role', 400);
    if (!roomCode) return error('Missing room code', 400);

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();

    if (role === 'host') {
      this.attachHost(server, roomCode);
    } else if (role === 'controller') {
      this.attachController(server, roomCode, name);
    } else {
      this.attachPlayer(server, roomCode, name);
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  private safeSend(ws: WebSocket | null, msg: unknown) {
    if (!ws) return;
    try { ws.send(JSON.stringify(msg)); } catch (_) {}
  }

  private broadcastPlayers(msg: unknown) {
    const raw = JSON.stringify(msg);
    for (const [, p] of this.players) {
      try { p.ws.send(raw); } catch (_) {}
    }
  }

  private attachHost(ws: WebSocket, roomCode: string) {
    if (this.host && this.host !== ws) {
      try { this.host.close(1011, 'replaced'); } catch (_) {}
    }
    this.host = ws;
    this.safeSend(ws, { type: 'room-created', roomCode });

    ws.addEventListener('message', (evt) => {
      let data: any;
      try { data = JSON.parse(String(evt.data)); } catch (_) { return; }
      if (!data || typeof data !== 'object') return;
      if (data.type === 'ping') { this.safeSend(ws, { type: 'pong' }); return; }
      // Host broadcasts game state to all full-game players
      if (data.type === 'game-state') {
        this.broadcastPlayers({ type: 'game-state', state: data.state, roomCode });
        return;
      }
      // Host can send targeted message to a player
      if (data.type === 'to-player' && data.playerId) {
        const p = this.players.get(String(data.playerId));
        if (p) this.safeSend(p.ws, { type: 'host-event', event: data.event, payload: data.payload, roomCode });
        return;
      }
    });

    ws.addEventListener('close', () => {
      if (this.host === ws) {
        this.host = null;
        for (const [id, c] of this.controllers) {
          this.safeSend(c.ws, { type: 'room-closed', roomCode });
          try { c.ws.close(1000, 'room closed'); } catch (_) {}
          this.controllers.delete(id);
        }
        for (const [id, p] of this.players) {
          this.safeSend(p.ws, { type: 'room-closed', roomCode });
          try { p.ws.close(1000, 'room closed'); } catch (_) {}
          this.players.delete(id);
        }
      }
    });

    ws.addEventListener('error', () => { if (this.host === ws) this.host = null; });
  }

  private attachController(ws: WebSocket, roomCode: string, name: string) {
    if (!this.host) {
      this.safeSend(ws, { type: 'join-error', ok: false, message: `Kode room "${roomCode}" tidak ditemukan.` });
      try { ws.close(1008, 'room not found'); } catch (_) {}
      return;
    }

    const controllerId = makeId();
    this.controllers.set(controllerId, { ws, name });
    this.safeSend(ws, { type: 'joined-room', ok: true, roomCode, controllerId, name });
    this.safeSend(this.host, { type: 'player-joined', roomCode, controllerId, name, kind: 'controller' });

    ws.addEventListener('message', (evt) => {
      let data: any;
      try { data = JSON.parse(String(evt.data)); } catch (_) { return; }
      if (!data || typeof data !== 'object') return;
      if (data.type === 'player-input') {
        const state = data.state && typeof data.state === 'object' ? data.state : data;
        const safe = {
          moveX: Math.max(-1, Math.min(1, Number(state.moveX) || 0)),
          moveZ: Math.max(-1, Math.min(1, Number(state.moveZ) || 0)),
          jump: !!state.jump,
          punch: !!state.punch,
          grabThrow: !!state.grabThrow,
          bombHeld: !!state.bombHeld,
        };
        this.safeSend(this.host, { type: 'player-input', roomCode, controllerId, state: safe, kind: 'controller' });
      } else if (data.type === 'ping') {
        this.safeSend(ws, { type: 'pong' });
      }
    });

    const cleanup = (reason: string) => {
      const cur = this.controllers.get(controllerId);
      if (!cur || cur.ws !== ws) return;
      this.controllers.delete(controllerId);
      this.safeSend(this.host, { type: 'player-left', roomCode, controllerId, reason, kind: 'controller' });
    };

    ws.addEventListener('close', (evt) => cleanup(`close:${evt.code}`));
    ws.addEventListener('error', () => cleanup('error'));
  }

  private attachPlayer(ws: WebSocket, roomCode: string, name: string) {
    if (!this.host) {
      this.safeSend(ws, { type: 'join-error', ok: false, message: `Kode room "${roomCode}" tidak ditemukan.` });
      try { ws.close(1008, 'room not found'); } catch (_) {}
      return;
    }

    const playerId = makeId();
    this.players.set(playerId, { ws, name });
    this.safeSend(ws, { type: 'joined-room', ok: true, roomCode, playerId, name, kind: 'player' });
    this.safeSend(this.host, { type: 'player-joined', roomCode, playerId, name, kind: 'player' });

    ws.addEventListener('message', (evt) => {
      let data: any;
      try { data = JSON.parse(String(evt.data)); } catch (_) { return; }
      if (!data || typeof data !== 'object') return;
      if (data.type === 'player-input') {
        const state = data.state && typeof data.state === 'object' ? data.state : data;
        const safe = {
          moveX: Math.max(-1, Math.min(1, Number(state.moveX) || 0)),
          moveZ: Math.max(-1, Math.min(1, Number(state.moveZ) || 0)),
          jump: !!state.jump,
          punch: !!state.punch,
          grabThrow: !!state.grabThrow,
          bombHeld: !!state.bombHeld,
        };
        this.safeSend(this.host, { type: 'player-input', roomCode, playerId, controllerId: playerId, state: safe, kind: 'player' });
      } else if (data.type === 'ping') {
        this.safeSend(ws, { type: 'pong' });
      }
    });

    const cleanup = (reason: string) => {
      const cur = this.players.get(playerId);
      if (!cur || cur.ws !== ws) return;
      this.players.delete(playerId);
      this.safeSend(this.host, { type: 'player-left', roomCode, playerId, controllerId: playerId, reason, kind: 'player' });
    };

    ws.addEventListener('close', (evt) => cleanup(`close:${evt.code}`));
    ws.addEventListener('error', () => cleanup('error'));
  }
}
