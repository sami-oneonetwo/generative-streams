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
    input?: { label: string; min?: number; max?: number; step?: number; placeholder?: string };
  }[];
  events: string[];
  stateSummary: string;
  safehouse?: {
    current?: import('./safehouseTypes').SafehouseJobView;
    pending: import('./safehouseTypes').SafehouseJobView[];
    recent: import('./safehouseTypes').SafehouseJobView[];
    fixture: boolean;
    generationAvailable: boolean;
    generationPaused: boolean;
    callsRemaining: number;
    allowanceEnforced: boolean;
    callsUsed: number;
    wave?: { number: number; phase: 'prep' | 'wave'; secondsLeft: number; zombies: number; best: number; fell?: number };
    objects: {
      id: string;
      name: string;
      createdBy: string;
      editedBy: string;
      fixed: boolean;
      ruined: boolean;
    }[];
  };
}
