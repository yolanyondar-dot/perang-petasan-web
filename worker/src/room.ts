import { error, json } from './http.js';

type Role = 'host' | 'controller' | 'player';

interface Attachment {
  role: Role;
  roomCode: string;
  id: string;
  name: string;
  color: string;
  characterType: string;
}

export class FightRoom implements DurableObject {
  private ctx: DurableObjectState;

  constructor(state: DurableObjectState, _env: unknown) {
    this.ctx = state;
  }

  private getAttachment(ws: WebSocket): Attachment | null {
    try { return (ws.deserializeAttachment() as Attachment) || null; } catch (_) { return null; }
  }

  private allSockets(): WebSocket[] {
    try { return this.ctx.getWebSockets(); } catch (_) { return []; }
  }

  private getHostWs(): WebSocket | null {
    for (const ws of this.allSockets()) {
      const a = this.getAttachment(ws);
      if (a?.role === 'host') return ws;
    }
    return null;
  }

  private getPlayerSockets(): WebSocket[] {
    return this.allSockets().filter((ws) => this.getAttachment(ws)?.role === 'player');
  }

  private getControllerSockets(): WebSocket[] {
    return this.allSockets().filter((ws) => this.getAttachment(ws)?.role === 'controller');
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/state') {
      const sockets = this.allSockets();
      let hasHost = false, controllers = 0, players = 0;
      for (const ws of sockets) {
        const a = this.getAttachment(ws);
        if (a?.role === 'host') hasHost = true;
        else if (a?.role === 'controller') controllers += 1;
        else if (a?.role === 'player') players += 1;
      }
      return json({ ok: true, hasHost, controllers, players });
    }

    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return error('Expected websocket', 426);
    }

    const role = (request.headers.get('x-role') || url.searchParams.get('role') || '') as Role;
    const roomCode = (request.headers.get('x-room-code') || url.searchParams.get('room') || '').toUpperCase();
    const name = (request.headers.get('x-name') || url.searchParams.get('name') || 'Pemain').trim().slice(0, 14) || 'Pemain';
    const color = (request.headers.get('x-color') || url.searchParams.get('color') || '#ff5fa2').slice(0, 16);
    const characterType = (request.headers.get('x-character-type') || url.searchParams.get('characterType') || 'klasik').slice(0, 24);

    if (role !== 'host' && role !== 'controller' && role !== 'player') return error('Invalid role', 400);
    if (!roomCode) return error('Missing room code', 400);

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);

    if (role === 'host') {
      this.attachHost(server, roomCode);
    } else if (role === 'controller') {
      this.attachController(server, roomCode, name, color, characterType);
    } else {
      this.attachPlayer(server, roomCode, name, color, characterType);
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  private safeSend(ws: WebSocket | null, msg: unknown) {
    if (!ws) return;
    try { ws.send(JSON.stringify(msg)); } catch (_) {}
  }

  private broadcastPlayers(msg: unknown) {
    const raw = JSON.stringify(msg);
    for (const ws of this.getPlayerSockets()) {
      try { ws.send(raw); } catch (_) {}
    }
  }

  private makeId(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let id = '';
    for (let i = 0; i < 12; i += 1) id += chars[Math.floor(Math.random() * chars.length)];
    return id;
  }

  private attachHost(ws: WebSocket, roomCode: string) {
    for (const other of this.allSockets()) {
      if (other === ws) continue;
      const a = this.getAttachment(other);
      if (a?.role === 'host') {
        try { other.close(1011, 'replaced'); } catch (_) {}
      }
    }
    ws.serializeAttachment({ role: 'host', roomCode, id: 'host', name: 'Host', color: '#ffffff', characterType: 'klasik' } satisfies Attachment);
    this.safeSend(ws, { type: 'room-created', roomCode });
  }

  private attachController(ws: WebSocket, roomCode: string, name: string, color = '#ff5fa2', characterType = 'klasik') {
    const host = this.getHostWs();
    if (!host) {
      this.safeSend(ws, { type: 'join-error', ok: false, message: `Kode room "${roomCode}" tidak ditemukan.` });
      try { ws.close(1008, 'room not found'); } catch (_) {}
      return;
    }

    const controllerId = this.makeId();
    ws.serializeAttachment({ role: 'controller', roomCode, id: controllerId, name, color, characterType } satisfies Attachment);
    this.safeSend(ws, { type: 'joined-room', ok: true, roomCode, controllerId, name, color, characterType });
    this.safeSend(host, { type: 'player-joined', roomCode, controllerId, name, color, characterType, kind: 'controller' });
  }

  private attachPlayer(ws: WebSocket, roomCode: string, name: string, color = '#ff5fa2', characterType = 'klasik') {
    const host = this.getHostWs();
    if (!host) {
      this.safeSend(ws, { type: 'join-error', ok: false, message: `Kode room "${roomCode}" tidak ditemukan.` });
      try { ws.close(1008, 'room not found'); } catch (_) {}
      return;
    }

    const playerId = this.makeId();
    ws.serializeAttachment({ role: 'player', roomCode, id: playerId, name, color, characterType } satisfies Attachment);
    this.safeSend(ws, { type: 'joined-room', ok: true, roomCode, playerId, name, color, characterType, kind: 'player' });
    this.safeSend(host, { type: 'player-joined', roomCode, playerId, name, color, characterType, kind: 'player' });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    let data: any;
    try { data = JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message)); } catch (_) { return; }
    if (!data || typeof data !== 'object') return;
    const a = this.getAttachment(ws);
    if (!a) return;
    const { role, roomCode, id } = a;
    const host = this.getHostWs();

    if (data.type === 'ping') {
      this.safeSend(ws, { type: 'pong' });
      return;
    }

    if (role === 'host') {
      if (ws !== host) return; // stale host
      if (data.type === 'game-state') {
        this.broadcastPlayers({ type: 'game-state', state: data.state, roomCode });
        return;
      }
      if (data.type === 'to-player' && data.playerId) {
        const targetId = String(data.playerId);
        for (const pws of this.getPlayerSockets()) {
          const pa = this.getAttachment(pws);
          if (pa?.id === targetId) {
            this.safeSend(pws, { type: 'host-event', event: data.event, payload: data.payload, roomCode });
            break;
          }
        }
        return;
      }
      return;
    }

    if (role === 'controller' || role === 'player') {
      if (data.type === 'player-input') {
        const state = data.state && typeof data.state === 'object' ? data.state : data;
        // Accept 2D MOBA fields; keep legacy 3D fields for compatibility
        const safe: any = {
          moveX: Math.max(-1, Math.min(1, Number(state.moveX) || 0)),
          moveZ: Math.max(-1, Math.min(1, Number(state.moveZ) || 0)),
          jump: !!state.jump,
          punch: !!state.punch,
          grabThrow: !!state.grabThrow,
          bombHeld: !!state.bombHeld,
          // 2D fields
          aimAngle: Math.max(0, Math.min(90, Number(state.aimAngle) || 0)),
          aimPower: Math.max(0, Math.min(100, Number(state.aimPower) || 0)),
          aimFacing: state.aimFacing === -1 ? -1 : 1,
          aimActive: !!state.aimActive,
          fire: typeof state.fire === 'string' ? state.fire.slice(0, 20) : null,
          fireAngle: Math.max(0, Math.min(90, Number(state.fireAngle) || 0)),
          firePower: Math.max(0, Math.min(100, Number(state.firePower) || 0)),
          seq: Number.isFinite(Number(state.seq)) ? Math.floor(Number(state.seq)) : 0,
        };
        const payload: any = { type: 'player-input', roomCode, state: safe, kind: role };
        if (role === 'controller') payload.controllerId = id;
        else { payload.playerId = id; payload.controllerId = id; }
        this.safeSend(host, payload);
      }
      if (data.type === 'player-hello') {
        // Allow player to update character/name after join
        const charId = typeof data.charId === 'string' ? data.charId.slice(0, 24) : a.characterType;
        const pname = typeof data.name === 'string' ? data.name.trim().slice(0, 14) || a.name : a.name;
        ws.serializeAttachment({ ...a, name: pname, characterType: charId } satisfies Attachment);
        this.safeSend(host, { type: 'player-hello', roomCode, playerId: id, controllerId: id, name: pname, charId, kind: role });
      }
      return;
    }
  }

  async webSocketClose(ws: WebSocket, code: number, _reason: string, _wasClean: boolean) {
    const a = this.getAttachment(ws);
    if (!a) return;
    const { role, roomCode, id } = a;

    if (role === 'host') {
      // only close room if this is still the active host
      const currentHost = this.getHostWs();
      // getHostWs() may still return this ws before close is fully processed in some runtimes; check by identity
      if (currentHost && currentHost !== ws) return;
      for (const other of this.allSockets()) {
        if (other === ws) continue;
        const oa = this.getAttachment(other);
        if (!oa) continue;
        this.safeSend(other, { type: 'room-closed', roomCode });
        try { other.close(1000, 'room closed'); } catch (_) {}
      }
      return;
    }

    const host = this.getHostWs();
    const reason = `close:${code}`;
    if (role === 'controller') {
      this.safeSend(host, { type: 'player-left', roomCode, controllerId: id, reason, kind: 'controller' });
    } else if (role === 'player') {
      this.safeSend(host, { type: 'player-left', roomCode, playerId: id, controllerId: id, reason, kind: 'player' });
    }
  }

  async webSocketError(ws: WebSocket, _error: unknown) {
    // Let close handler deal with cleanup
    try { ws.close(1011, 'error'); } catch (_) {}
  }
}
