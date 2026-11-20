import {
  MOBA_MESSAGES,
  type ClientMobaState,
  type MobaBuyMessage,
  type MobaJoinOptions,
  type MobaKoMessage,
  type MobaLoadout,
  type MobaMatchEndMessage,
  type MobaMoveMessage,
  type MobaSkillKey,
  type MobaSkillMessage,
  type RoomMode,
} from '@pp/shared';

interface MatchmakeResponse {
  id: string;
  roomId: string;
  mode: RoomMode;
}

type Envelope =
  | { t: 'state'; s: ClientMobaState }
  | { t: 'message'; type: string; data: unknown };

function normalizeWsUrl(input: string): string {
  const url = new URL(input, location.href);
  if (url.protocol === 'http:') url.protocol = 'ws:';
  if (url.protocol === 'https:') url.protocol = 'wss:';
  if (!url.pathname.endsWith('/ws')) {
    url.pathname = `${url.pathname.replace(/\/$/, '')}/ws`;
  }
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function resolveWsUrl(): string {
  const configured = import.meta.env.VITE_SERVER_URL;
  if (typeof configured === 'string' && configured.trim()) {
    return normalizeWsUrl(configured.trim());
  }
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    return 'ws://localhost:8787/ws';
  }
  // Produksi Cloudflare: satu origin, /ws ditangani Worker yang sama.
  return `${protocol}://${location.host}/ws`;
}

function resolveHttpBase(wsUrl: string): string {
  const url = new URL(wsUrl, location.href);
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
  url.pathname = '';
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

/** Client ringan untuk server Worker/Durable Object. Bentuk state tetap ClientMobaState. */
class NetworkManager {
  private readonly wsUrl = resolveWsUrl();
  private readonly httpBase = resolveHttpBase(this.wsUrl);
  private socket: WebSocket | null = null;
  private stateValue: ClientMobaState | null = null;
  private leaving = false;

  sessionId = '';
  roomId = '';
  onMatchEnd: ((message: MobaMatchEndMessage) => void) | null = null;
  onKo: ((message: MobaKoMessage) => void) | null = null;
  onDisconnect: (() => void) | null = null;

  async join(mode: RoomMode, loadout: MobaLoadout, name: string): Promise<void> {
    await this.leave();
    this.leaving = false;

    const options: MobaJoinOptions = { mode, loadout, name, fillBots: true };
    const response = await fetch(`${this.httpBase}/ws/matchmake/joinOrCreate/moba`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(options),
    });
    if (!response.ok) {
      throw new Error(`Matchmaking gagal (${response.status})`);
    }
    const match = (await response.json()) as MatchmakeResponse;

    const url = new URL(this.wsUrl, location.href);
    url.searchParams.set('session', match.id);
    const socket = new WebSocket(url.toString());
    this.socket = socket;
    this.sessionId = match.id;
    this.roomId = match.roomId;
    this.stateValue = null;

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error('WebSocket timeout'));
      }, 10_000);

      socket.onopen = () => {
        clearTimeout(timer);
        resolve();
      };
      socket.onerror = () => {
        clearTimeout(timer);
        if (!this.leaving) reject(new Error('Gagal membuka WebSocket'));
      };
    });

    socket.onmessage = (event) => this.onEnvelope(event);
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.stateValue = null;
      if (!this.leaving) this.onDisconnect?.();
    };
  }

  async leave(): Promise<void> {
    const socket = this.socket;
    this.socket = null;
    this.stateValue = null;
    if (!socket) return;

    this.leaving = true;
    try {
      socket.close(1000, 'leave');
    } catch {
      // Socket bisa sudah tertutup.
    }
    await new Promise<void>((resolve) => {
      if (socket.readyState === WebSocket.CLOSED) {
        resolve();
        return;
      }
      socket.addEventListener('close', () => resolve(), { once: true });
    });
    this.leaving = false;
  }

  get state(): ClientMobaState | null {
    return this.stateValue;
  }

  private onEnvelope(event: MessageEvent<string>): void {
    let envelope: Envelope;
    try {
      envelope = JSON.parse(event.data) as Envelope;
    } catch {
      return;
    }

    if (envelope.t === 'state') {
      this.stateValue = envelope.s;
      return;
    }
    if (envelope.t !== 'message') return;

    if (envelope.type === MOBA_MESSAGES.WELCOME) {
      const data = envelope.data as { id?: string; roomId?: string } | undefined;
      if (data?.id) this.sessionId = data.id;
      if (data?.roomId) this.roomId = data.roomId;
      return;
    }
    if (envelope.type === MOBA_MESSAGES.MATCH_END) {
      this.onMatchEnd?.(envelope.data as MobaMatchEndMessage);
      return;
    }
    if (envelope.type === MOBA_MESSAGES.KO) {
      this.onKo?.(envelope.data as MobaKoMessage);
    }
  }

  private send(type: string, data: unknown): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({ t: type, data }));
  }

  sendMove(message: MobaMoveMessage): void {
    this.send(MOBA_MESSAGES.MOVE, message);
  }

  sendSkill(key: MobaSkillKey, aimX: number, aimZ: number): void {
    const message: MobaSkillMessage = { key, aimX, aimZ };
    this.send(MOBA_MESSAGES.SKILL, message);
  }

  sendBuy(itemId: string): void {
    const message: MobaBuyMessage = { itemId };
    this.send(MOBA_MESSAGES.BUY, message);
  }
}

export const network = new NetworkManager();
