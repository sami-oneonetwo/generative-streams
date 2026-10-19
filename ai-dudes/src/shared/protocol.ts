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
    disabled: boolean;
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
  adminActions: {
    id: string;
    label: string;
    input?: {
      kind?: 'number' | 'text';
      label: string;
      min?: number;
      max?: number;
      step?: number;
      placeholder?: string;
      maxLength?: number;
    };
  }[];
  events: string[];
  stateSummary: string;
  /** The ai-dudes world's operator view: every dude, its agent and the shared call budget. */
  dudes?: import('./dudesTypes').DudesAdminStatus;
}
