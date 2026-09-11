// Shared between server (world buildScene) and client (renderer).
// The renderer is a pure function of the last Scene it received, so everything
// it needs to draw — including in-flight walk segments — lives here.

export interface ChatReceipt {
  sequence: number;
  at: number; // display time, after admission; not upstream arrival time
  label: string;
  targetId?: string; // absent when this room has no route
}

export interface SceneChatMessage {
  username: string;
  text: string;
  receipt?: ChatReceipt; // transient simulated display route, not transport telemetry
}

export interface SceneTraffic {
  demand: number;
  capacity: number;
  backlog: number;
  lagSeconds: number | null; // null = no capacity, never Infinity on the wire
  load: number | null;
  // Written the way it is read out on the wall: no jargon, no abbreviations.
  status:
    | 'FLOWING WELL'
    | 'GETTING BUSY'
    | 'AT THE LIMIT'
    | 'LOSING MESSAGES'
    | 'NOTHING GETTING THROUGH';
  delivered: number;
  dropped: number;
}

export interface SceneScreenPage {
  id: string;
  title: string;
  lines: string[];
  footer?: string;
}

export interface SceneScreen {
  label: string;
  pages: SceneScreenPage[];
  dwellMs: number;
  alerts?: string[];
  interlude?: {
    label: string;
    pages: SceneScreenPage[];
    every: number;
    dwellMs: number;
    flashMs: number;
  };
}

export interface SceneEntity {
  id: string;
  kind: string; // world-defined; renderer maps kind -> draw function, unknown kinds get a fallback
  x: number;
  y: number;
  w: number;
  h: number;
  props?: Record<string, unknown>;
  screen?: SceneScreen;
}

export interface WalkSegment {
  fromX: number;
  toX: number;
  startedAt: number; // server time
  durationMs: number;
}

export interface SceneProtagonist {
  name: string;
  x: number;
  y: number; // feet position (floor)
  state: 'idle' | 'walking' | 'working';
  heightPx?: number; // drawn figure height in world px (human scale); default ~120
  tint?: string; // clothing/silhouette base colour
  rim?: string; // rim-light colour (spill from the scene's key light)
  reflect?: boolean; // draw a faint reflection below the feet (wet floor)
  pose?: 'stand' | 'console'; // 'console' = seated figure at a workstation
  art?: 'server-room'; // optional world-specific sprite; other worlds use the default figure
  service?: {
    action: 'pull' | 'exchange' | 'install' | 'reset' | 'boot';
    carrying?: 'damaged' | 'replacement';
    targetX: number;
    targetY: number;
    progress: number;
  };
  walk?: WalkSegment; // client interpolates position from this between snapshots
}

export interface HudMeter {
  id: string;
  label: string;
  value: number;
  max: number;
  unit: string;
  warnAt?: number;
}

export interface HudCounter {
  id: string;
  label: string;
  value: string;
}

export interface HudBoardRow {
  label: string;
  detail?: string;
  color: string;
}

export interface HudQueueItem {
  label: string;
  requestedBy?: string;
}

export interface HudModel {
  title: string;
  meters: HudMeter[];
  counters: HudCounter[];
  board: HudBoardRow[];
  queue: {
    current?: HudQueueItem & { progress: number };
    pending: HudQueueItem[];
  };
  logLines: string[];
  pinned: string;
}

export interface SpeechBubble {
  text: string;
  until: number; // server time when it expires
}

export interface Scene {
  width: number;
  height: number;
  worldWidth: number; // world area; the HUD panel occupies width - worldWidth on the right
  bg: string;
  power?: { mode: 'backup' | 'booting'; since?: number };
  chaos?: number; // 0..1 capacity-relative visual pressure; absent in other worlds
  entities: SceneEntity[];
  protagonist: SceneProtagonist;
  speech?: SpeechBubble;
  chatRevision?: number; // new chat signal, independent of bounded display history
  hud: HudModel;
}
