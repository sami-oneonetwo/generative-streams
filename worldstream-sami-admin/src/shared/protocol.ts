import type { Scene } from './sceneTypes';

export type ServerMsg =
  | { t: 'hello'; protocol: 1; worldId: string; serverTime: number }
  | { t: 'state'; rev: number; serverTime: number; scene: Scene };

export interface ClassificationRecord {
  ts: number;
  username: string;
  text: string;
  intent: string;
  confidence: number;
  source: 'regex' | 'llm' | 'fallback';
}

export interface AdminStatus {
  worldId: string;
  worldName: string;
  flags: {
    kickRepliesEnabled: boolean;
    devTimeScale: number;
  };
  kick: {
    configured: boolean;
    connected: boolean;
    username?: string;
    userId?: number;
    subscription?: string;
    lastWebhookAt?: number;
    webhookPublicUrl?: string;
  };
  engine: {
    rev: number;
    wsClients: number;
    queueLength: number;
    currentTask?: string;
    classifications: ClassificationRecord[];
  };
  adminActions: { id: string; label: string }[];
  events: string[];
  stateSummary: string;
}
