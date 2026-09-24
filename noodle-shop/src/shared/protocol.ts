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
    /** The neighbours reading the block: its own switch and its own allowance, apart from chat's. */
    surveyPaused: boolean;
    surveyCallsRemaining: number;
    surveyCallsUsed: number;
    /** What each neighbour is currently redoing their yard in, and how many pieces are left to go. */
    themes: { name: string; theme?: string; left: number }[];
    /** Chatters the operator trusts: no design time limit, and `!delete` works for them. */
    privileged: string[];
    /** Grudges and favourites: what each neighbour holds against (or for) which chatter. */
    regard?: { name: string; user: string; score: number; phrase: string }[];
    /** Rook's own small grudges. */
    grudges?: { user: string; score: number; since: number; reason?: string }[];
    /** The hoops scoreboard (`!shoot`), best first. */
    scores?: { user: string; hits: number; shots: number; best: number }[];
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
