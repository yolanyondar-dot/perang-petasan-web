import type { ClientMobaState, MobaJoinOptions, RoomMode } from '@pp/shared';

export interface WorkerEnv {
  ASSETS: Fetcher;
  FIGHT_ROOM: DurableObjectNamespace;
  MATCHMAKER: DurableObjectNamespace;
}

/** Sesi sementara hasil matchmaking; dipakai untuk membuka WS ke room yang tepat. */
export interface SessionInfo extends MobaJoinOptions {
  id: string;
  roomId: string;
  mode: RoomMode;
  name: string;
  expiresAt: number;
}

export interface RoomRecord {
  id: string;
  mode: RoomMode;
  humans: number;
}

export interface StateEnvelope {
  t: 'state';
  s: ClientMobaState;
}

export interface MessageEnvelope {
  t: 'message';
  type: string;
  data: unknown;
}

export type ClientEnvelope = StateEnvelope | MessageEnvelope;
