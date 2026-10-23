import type { Scene } from './sceneTypes';

export type ServerMsg =
  /** `epoch` is new on every server start: a page that saw another one drops the build geometry it kept. */
  | { t: 'hello'; protocol: 1; worldId: string; serverTime: number; epoch?: string }
  /** `play`: the /play site's address and its seats, when it is set up and open. */
  | { t: 'state'; rev: number; serverTime: number; scene: Scene; play?: { url: string; used: number; cap: number } }
  /** Between snapshots: the Mayor moved, spoke or posed (sent the moment the operator page says so). */
  | { t: 'mayor'; serverTime: number; mayor: import('./dudesTypes').MayorView }
  /** Between snapshots: a player walking their own character (the /play page). */
  | { t: 'dude'; serverTime: number; dude: { id: string; position: { x: number; z: number }; facing: number; moving: boolean; running?: boolean; ride?: { id: string; y: number; altitude: number } } };

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
    crierEnabled: boolean;
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
