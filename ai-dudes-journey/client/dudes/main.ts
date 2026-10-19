// The AI Dudes page: an empty field, a dude for every chatter, and whatever they build.
//
// The server publishes the world twice a second over /ws. Movers (the dudes, any living builds)
// are sampled the moment a snapshot lands and drawn a little behind the server, slid between
// snapshots (motion.ts); everything else in a snapshot waits in the inbox until the drawn clock
// reaches it, so a bubble or a finished build appears where its dude is drawn, not half a second
// ahead of it. The camera frames every awake dude and every build on its own (no ranking of who
// is interesting — just the bounding box); dragging takes it over until "Follow everyone".
import * as THREE from 'three';
import { buildEnvironment } from './environment';
import { createObjectsLayer, type PreviewSpec } from './objects';
import { createDudesLayer } from './dudes';
import { createEffectsLayer } from './effects';
import { Timeline } from './motion';
import { shortRef, type DudeView, type DudesScene, type Emote, type ServerMsg } from './types';

const el = (id: string) => document.getElementById(id)!;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
// Stream mode (`/?stream=1`, for an OBS browser source): the HUD is scaled up for a 1080p canvas
// watched on phones and the click-only controls are hidden, because nobody can click through a
// stream. `scale` overrides the HUD scale; `zoom` tightens (>1) or loosens (<1) the auto framing.
const params = new URLSearchParams(location.search);
const streamMode = params.get('stream') === '1';
const uiScale = Math.max(0.5, Math.min(3, Number(params.get('scale')) || (streamMode ? 1.7 : 1)));
const zoomBias = Math.max(0.5, Math.min(2.5, Number(params.get('zoom')) || 1));

type StateMsg = Extract<ServerMsg, { t: 'state' }>;
const EMOTE_WORDS: Record<Emote, string> = {
  wave: 'waving',
  cheer: 'cheering',
  dance: 'dancing',
  sit: 'sitting down',
  lie: 'lying in the grass',
  jump: 'jumping about',
  punch: 'punching the air',
  bow: 'bowing',
  think: 'thinking it over',
  point: 'pointing',
  kick: 'kicking',
  hug: 'hugging',
  push: 'pushing',
  lean: 'leaning',
  drive: 'driving',
  highfive: 'high-fiving',
  handshake: 'shaking hands',
  laugh: 'laughing',
  shrug: 'shrugging',
  stagger: 'stumbling',
  chop: 'chopping a tree',
  hammer: 'building the bridge',
  cast: 'freezing the river',
};
const ACTIVITY_WORDS: Record<string, string> = {
  idle: 'hanging out',
  walking: 'walking',
  building: 'building',
  emote: 'hanging out',
  sleeping: 'napping',
  using: 'using a build',
};
// The camera: a fixed elevation, a yaw the viewer can turn, an orthographic half-height (metres).
const CAM_BACK = 43,
  CAM_UP = 36,
  YAW_MIN = 0.2,
  YAW_MAX = 1.25,
  HALF_MIN = 5,
  HALF_MAX = 60,
  AUTO_MIN = 6,
  AUTO_MAX = 50;
const SIN_ELEVATION = CAM_UP / Math.hypot(CAM_UP, CAM_BACK);

function start() {
  document.body.classList.toggle('stream', streamMode);
  document.documentElement.style.setProperty('--ui-scale', String(uiScale));
  const scene = new THREE.Scene(),
    renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.domElement.setAttribute('aria-label', 'Live field of chat characters. Drag to turn the view; scroll or pinch to zoom.');
  el('world').append(renderer.domElement);
  const environment = buildEnvironment(scene),
    objects = createObjectsLayer(environment.world),
    dudes = createDudesLayer(environment.world, el('people')),
    fx = createEffectsLayer(environment.world);

  // Read-only handles for browser smokes.
  (window as unknown as { __dudes?: unknown }).__dudes = {
    count: () => dudes.count(),
    positionOf: (id: string) => dudes.positionOf(id),
    poseOf: (id: string) => dudes.poseOf(id),
  };

  /** Every build in flight: each dude's ghost, keyed by whose it is. */
  function previewsOf(s: DudesScene): PreviewSpec[] {
    const list: PreviewSpec[] = [];
    for (const d of s.dudes)
      if (d.job?.preview)
        list.push({
          key: `dude:${d.id}`,
          preview: d.job.preview,
          status: d.job.status === 'walking' ? 'walking' : d.job.status === 'building' ? 'building' : 'other',
          progress: d.job.progress ?? 0,
        });
    return list;
  }

  // --- camera ---
  const camera = new THREE.OrthographicCamera(-20, 20, 20, -20, 0.1, 400);
  let yaw = 0.65,
    half = 16,
    autoCamera = true;
  const focus = new THREE.Vector3(0, 0, 0);
  const right = new THREE.Vector3(),
    up = new THREE.Vector3(),
    forward = new THREE.Vector3();
  function axes() {
    forward.set(-Math.sin(yaw) * CAM_BACK, -CAM_UP, -Math.cos(yaw) * CAM_BACK).normalize();
    right.set(Math.cos(yaw), 0, -Math.sin(yaw));
    up.crossVectors(right, forward);
  }
  function applyCamera() {
    const a = innerWidth / innerHeight;
    camera.left = -half * a;
    camera.right = half * a;
    camera.top = half;
    camera.bottom = -half;
    camera.updateProjectionMatrix();
    camera.position.set(focus.x + Math.sin(yaw) * CAM_BACK, focus.y + CAM_UP, focus.z + Math.cos(yaw) * CAM_BACK);
    camera.lookAt(focus);
    camera.updateMatrixWorld();
  }
  function resize() {
    renderer.setSize(innerWidth, innerHeight);
    applyCamera();
    dudes.measure();
  }
  addEventListener('resize', resize);
  resize();

  /** What auto mode wants: the view centre and half-height that fit every awake dude and every build. */
  const framePoint = new THREE.Vector3();
  function autoFrame(): { centre: THREE.Vector3; half: number } {
    axes();
    let minR = Infinity,
      maxR = -Infinity,
      minU = Infinity,
      maxU = -Infinity,
      n = 0;
    const add = (x: number, y: number, z: number) => {
      framePoint.set(x, y, z);
      const r = framePoint.dot(right),
        u = framePoint.dot(up);
      minR = Math.min(minR, r);
      maxR = Math.max(maxR, r);
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
      n++;
    };
    let awake = 0;
    dudes.each((_x, _z, v) => {
      if (!v.away) awake++;
    });
    // Nappers count only when nobody is awake, so a quiet stream still shows someone. Stragglers
    // far back down the trail do not drag the shot with them: the frame is about the group.
    const camp = state?.journey?.camp;
    const near = (x: number, z: number, r: number) => !camp || Math.hypot(x - camp.x, z - camp.z) < r;
    const people: { x: number; z: number }[] = [];
    dudes.each((x, z, v) => {
      if (awake && v.away) return;
      if (!near(x, z, 45)) return;
      people.push({ x, z });
      add(x, 0, z);
      add(x, 2.4 * (v.scale ?? 1), z);
    });
    // Builds only where people are: a shed left behind does not hold the camera back. The landmark
    // at the end of the path is the exception: once it shows, the shot keeps it in view.
    for (const o of state?.objects ?? []) {
      const at = o.driven?.at ?? o.position;
      const landmark = o.id === 'landmark' && (!camp || Math.hypot(at.x - camp.x, at.z - camp.z) < 130);
      if (!landmark && !people.some((p) => Math.hypot(p.x - at.x, p.z - at.z) < 14)) continue;
      const w = (o.footprint?.width ?? 2) / 2,
        d = (o.footprint?.depth ?? 2) / 2;
      add(at.x - w, 0, at.z - d);
      add(at.x + w, 3, at.z + d);
    }
    if (camp) {
      // A little of the trail ahead, so the shot looks where they are going.
      add(camp.x, 0, camp.z - 8);
    }
    for (const d of state?.dudes ?? [])
      if (d.job?.at && near(d.job.at.x, d.job.at.z, 45)) {
        add(d.job.at.x, 0, d.job.at.z);
        add(d.job.at.x, 3, d.job.at.z);
      }
    if (!n) return { centre: new THREE.Vector3(camp?.x ?? 0, 0, camp?.z ?? 0), half: 16 };
    const a = innerWidth / innerHeight;
    // Room for tags and bubbles above the heads, and for the HUD at the top and bottom.
    const needH = ((maxU - minU) / 2) * 1.12 + 2.5,
      needW = ((maxR - minR) / 2) * 1.06 + 2;
    const fit = Math.max(needH, needW / a) / zoomBias;
    const centre = new THREE.Vector3()
      .addScaledVector(right, (minR + maxR) / 2)
      .addScaledVector(up, (minU + maxU) / 2 + 0.6);
    return { centre, half: Math.max(AUTO_MIN, Math.min(AUTO_MAX, fit)) };
  }
  /** Where the view centre meets the ground, for the shadow box. */
  const groundCentre = new THREE.Vector3();
  function centreOnGround(): THREE.Vector3 {
    axes();
    const t = forward.y ? -focus.y / forward.y : 0;
    return groundCentre.copy(focus).addScaledVector(forward, t);
  }

  function follow(value: boolean) {
    autoCamera = value;
    el('follow').textContent = value ? 'Following everyone' : 'Follow everyone';
    el('follow').setAttribute('aria-pressed', String(value));
  }
  el('follow').onclick = () => follow(true);

  // --- pointer: drag to turn, shift/right-drag or two fingers to pan, wheel or pinch to zoom ---
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  function groundAt(x: number, y: number): THREE.Vector3 | undefined {
    ndc.set((x / innerWidth) * 2 - 1, (-y / innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    return ray.ray.intersectPlane(ground, new THREE.Vector3()) ?? undefined;
  }
  function zoomAbout(x: number, y: number, factor: number) {
    const before = groundAt(x, y);
    half = Math.max(HALF_MIN, Math.min(HALF_MAX, half * factor));
    applyCamera();
    const after = groundAt(x, y);
    if (before && after) {
      focus.add(before.sub(after));
      applyCamera();
    }
  }
  function pan(dx: number, dy: number) {
    axes();
    const perPx = (2 * half) / innerHeight;
    focus.addScaledVector(right, -dx * perPx);
    focus.x += -Math.sin(yaw) * ((dy * perPx) / SIN_ELEVATION);
    focus.z += -Math.cos(yaw) * ((dy * perPx) / SIN_ELEVATION);
    // Never lose the group entirely.
    const camp = state?.journey?.camp ?? { x: 0, z: 0 };
    focus.x = Math.max(camp.x - 90, Math.min(camp.x + 90, focus.x));
    focus.z = Math.max(camp.z - 120, Math.min(camp.z + 120, focus.z));
  }
  const pointers = new Map<number, { x: number; y: number }>();
  let drag:
    | { x: number; y: number; yaw: number; moved: boolean; pan: boolean; lastX: number; lastY: number }
    | undefined;
  let pinch: { dist: number; midX: number; midY: number } | undefined;
  let hoverAt: { x: number; y: number } | undefined;
  let hovered: string | undefined;
  const canvas = renderer.domElement;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    canvas.setPointerCapture(e.pointerId);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), midX: (a.x + b.x) / 2, midY: (a.y + b.y) / 2 };
      if (drag) drag.moved = true; // a pinch is never a click
      return;
    }
    drag = {
      x: e.clientX,
      y: e.clientY,
      yaw,
      moved: false,
      pan: e.shiftKey || e.button === 1 || e.button === 2,
      lastX: e.clientX,
      lastY: e.clientY,
    };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse' && !pointers.size) hoverAt = { x: e.clientX, y: e.clientY };
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y),
        midX = (a.x + b.x) / 2,
        midY = (a.y + b.y) / 2;
      follow(false);
      if (dist > 0 && pinch.dist > 0) zoomAbout(midX, midY, pinch.dist / dist);
      pan(midX - pinch.midX, midY - pinch.midY);
      pinch = { dist, midX, midY };
      return;
    }
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 5) drag.moved = true;
    if (drag.moved) {
      follow(false);
      if (drag.pan) pan(e.clientX - drag.lastX, e.clientY - drag.lastY);
      else yaw = Math.max(YAW_MIN, Math.min(YAW_MAX, drag.yaw + (e.clientX - drag.x) * 0.003));
    }
    drag.lastX = e.clientX;
    drag.lastY = e.clientY;
  });
  const release = (e: PointerEvent, cancelled: boolean) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = undefined;
    if (!cancelled && drag && !drag.moved && pointers.size === 0) click(e.clientX, e.clientY);
    if (pointers.size === 0) drag = undefined;
  };
  canvas.addEventListener('pointerup', (e) => release(e, false));
  canvas.addEventListener('pointercancel', (e) => release(e, true));
  canvas.addEventListener('pointerleave', () => {
    hoverAt = undefined;
  });
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      follow(false);
      zoomAbout(e.clientX, e.clientY, Math.exp(e.deltaY * 0.0012));
    },
    { passive: false },
  );

  // --- inspect ---
  let selected: { kind: 'dude' | 'object'; id: string } | undefined;
  function click(x: number, y: number) {
    const dude = dudes.pick(x, y, camera);
    if (dude) {
      inspect({ kind: 'dude', id: dude });
      return;
    }
    ndc.set((x / innerWidth) * 2 - 1, (-y / innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObject(objects.root, true).find((h) => h.object.userData.objectId);
    inspect(hit ? { kind: 'object', id: hit.object.userData.objectId as string } : undefined);
  }
  el('inspect-close').onclick = () => inspect(undefined);
  const nameOf = (who: string) => {
    const d = state?.dudes.find((x) => x.id === who || x.name.toLowerCase() === who.toLowerCase());
    return d?.name ?? who.replace(/^dev:/, '');
  };
  function doingOf(v: DudeView, serverNow: number): string {
    if (v.away) return 'Napping — their chatter has gone quiet';
    const bits: string[] = [];
    if (v.ko !== undefined && v.ko > serverNow) return 'Knocked out — seeing stars';
    if (v.thinking) bits.push('thinking…');
    if (v.attacking) {
      const target =
        state?.dudes.find((d) => d.id === v.attacking!.targetId)?.name ??
        state?.objects.find((o) => o.id === v.attacking!.targetId)?.blueprint.name ??
        'someone';
      bits.push(`going after ${target} (${v.attacking.with})`);
    }
    if (v.use) {
      const target = state?.objects.find((o) => o.id === v.use!.targetId)?.blueprint.name ?? 'a build';
      bits.push(`${v.use.phase === 'going' ? 'heading off to ' : ''}${v.use.how} ${target}`);
    }
    if (v.job) {
      const j = v.job;
      const pct = j.status === 'building' ? ` (${Math.round((j.progress ?? 0) * 100)}%)` : '';
      bits.push(`${j.kind === 'edit' ? 'changing' : j.kind === 'remove' ? 'taking down' : 'building'} ${j.label} · ${j.status}${pct}`);
    }
    if (v.emote && v.emote.until > serverNow) bits.push(EMOTE_WORDS[v.emote.pose] ?? v.emote.pose);
    else if (!v.job && !v.use) bits.push(ACTIVITY_WORDS[v.activity] ?? v.activity);
    const s = bits.join(' · ');
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  function inspect(next: typeof selected) {
    selected = next;
    renderInspect();
  }
  function renderInspect() {
    const panel = el('inspect');
    if (!selected || !state) {
      panel.hidden = true;
      return;
    }
    if (selected.kind === 'dude') {
      const v = state.dudes.find((d) => d.id === selected!.id);
      if (!v) {
        panel.hidden = true;
        selected = undefined;
        return;
      }
      const serverNow = serverClock();
      const built = state.objects.filter((o) => o.createdBy === v.id || o.createdBy === v.name).length;
      el('inspect-name').textContent = v.name;
      el('inspect-detail').textContent = [v.title, built ? `${built} build${built === 1 ? '' : 's'} on the field` : '']
        .filter(Boolean)
        .join(' · ');
      el('inspect-doing').textContent = doingOf(v, serverNow);
      const say = v.say && v.say.until > serverNow ? `“${v.say.text}”` : '';
      el('inspect-say').textContent = say;
      el('inspect-say').hidden = !say;
    } else {
      const o = state.objects.find((x) => x.id === selected!.id);
      if (!o) {
        panel.hidden = true;
        selected = undefined;
        return;
      }
      el('inspect-name').textContent = o.blueprint.name;
      el('inspect-detail').textContent = `#${shortRef(o.id)} · built by ${nameOf(o.createdBy)}${
        o.editedBy && o.editedBy !== o.createdBy ? ` · last changed by ${nameOf(o.editedBy)}` : ''
      }`;
      el('inspect-doing').textContent = o.blueprint.description ?? '';
      el('inspect-say').hidden = true;
    }
    panel.hidden = false;
  }

  // --- HUD ---
  // The troublemaker banner: title and line from the snapshot; a deadline (the mayor's decree)
  // counts down locally against the drawn server clock. Content stays put while it fades out.
  let happeningUntil: number | undefined;
  let bannerRect: { l: number; t: number; r: number; b: number } | undefined;
  function happening(s: DudesScene) {
    const h = s.happening;
    el('happening').classList.toggle('show', !!h);
    happeningUntil = h?.until;
    if (!h) {
      bannerRect = undefined;
      document.documentElement.style.setProperty('--banner-h', '0px');
      return;
    }
    if (el('happening-title').textContent !== h.title) el('happening-title').textContent = h.title;
    if (el('happening-text').textContent !== h.text) el('happening-text').textContent = h.text;
    // A challenge's colours and its progress bars (who is across, the bridge, the boss's health).
    for (const k of ['river', 'boss', 'landmark']) el('happening').classList.toggle(k, h.kind === k);
    const bars = el('happening-bars');
    const barsKey = JSON.stringify(h.bars ?? []);
    if (bars.dataset.key !== barsKey) {
      bars.dataset.key = barsKey;
      bars.hidden = !h.bars?.length;
      bars.replaceChildren(
        ...(h.bars ?? []).flatMap((b) => {
          const label = document.createElement('span');
          label.textContent = b.label;
          const bar = document.createElement('div');
          bar.className = 'bar';
          const fill = document.createElement('i');
          fill.style.width = `${Math.round(Math.max(0, Math.min(1, b.value)) * 100)}%`;
          bar.append(fill);
          const note = document.createElement('em');
          note.textContent = b.note ?? '';
          return [label, bar, note];
        }),
      );
    }
    el('happening-clock').hidden = h.until === undefined;
    countdown();
    measureBanner();
  }
  /** Where the banner sits on screen (its resting place; the slide-in transform is ignored). */
  function measureBanner() {
    if (!el('happening').classList.contains('show')) return;
    const r = el('happening').getBoundingClientRect();
    bannerRect = { l: r.left, t: 0, r: r.right, b: r.bottom + 4 };
    // Narrow screens stack the side panels under the banner.
    document.documentElement.style.setProperty('--banner-h', `${Math.ceil(r.height + 8)}px`);
  }
  addEventListener('resize', measureBanner);
  function countdown() {
    if (happeningUntil === undefined) return;
    const left = Math.max(0, Math.ceil((happeningUntil - serverClock()) / 1000));
    const text = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    if (el('happening-clock').textContent !== text) el('happening-clock').textContent = text;
  }
  let feedKey = '';
  /** A small panel of rows (knockouts, chat wants), rebuilt only when its rows change. */
  function rows(id: string, list: { text: string; note?: string; cls?: string }[]) {
    const box = el(`${id}-rows`);
    const key = JSON.stringify(list);
    el(id).hidden = !list.length;
    if (box.dataset.key === key) return;
    box.dataset.key = key;
    box.replaceChildren(
      ...list.map((r) => {
        const line = document.createElement('div');
        const text = document.createElement('span');
        text.textContent = r.text;
        line.append(text);
        if (r.note) {
          const note = document.createElement('b');
          note.textContent = r.note;
          if (r.cls) note.className = r.cls;
          line.append(note);
        }
        return line;
      }),
    );
  }
  function hud(s: DudesScene) {
    happening(s);
    rows(
      'scores',
      (s.scores ?? []).filter((r) => r.kos > 0).slice(0, 5).map((r) => ({ text: r.name, note: String(r.kos) })),
    );
    rows(
      'wishes',
      (s.wishes ?? [])
        .filter((w) => w.status !== 'blocked')
        .slice(0, 3)
        .map((w) => ({
          text: `${w.wish} ×${w.count}`,
          note: w.status === 'works-now' ? 'try it' : 'soon',
          cls: w.status === 'works-now' ? 'now' : 'soon',
        })),
    );
    el('fixture').hidden = !s.fixture;
    const feed = (s.feed ?? []).slice(-5);
    const key = feed.map((f) => `${f.at}:${f.text}`).join('|');
    if (key !== feedKey) {
      feedKey = key;
      const box = el('feed');
      box.replaceChildren(
        ...feed.map((item, i) => {
          const line = document.createElement('div');
          line.textContent = item.text;
          // Newest last and brightest; the older ones fade out above it.
          line.style.opacity = String([0.3, 0.45, 0.6, 0.8, 1][5 - feed.length + i] ?? 1);
          return line;
        }),
      );
      box.hidden = !feed.length;
    }
    const c = s.counts,
      ai = s.ai;
    const m = s.journey?.walked ?? 0;
    const walked = s.journey ? ` · ${m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`} walked${s.journey.paused ? ' (resting)' : ''}` : '';
    el('counts').textContent = `${c.awake}/${c.dudes} awake · ${c.builds} build${c.builds === 1 ? '' : 's'}${walked}`;
    el('ai').textContent = `${ai.thinking} thinking · ${ai.designing} designing`;
    const out = ai.enforced && ai.callsRemaining <= 0;
    const warn = ai.paused ? 'AI PAUSED' : out ? 'AI OUT OF CALLS' : !ai.available ? 'AI OFFLINE' : '';
    el('ai-warn').textContent = warn;
    el('ai-warn').hidden = !warn;
  }

  // --- the socket and the drawn clock ---
  const timeline = new Timeline(),
    inbox: { at: number; msg: StateMsg }[] = [];
  let state: DudesScene | undefined,
    connected = false,
    lastMessageAt = 0,
    offset = 0;
  /** Server time as drawn: what bubbles, emotes and waves are measured against. */
  const serverClock = () => (timeline.ready ? timeline.renderTime(performance.now()) : Date.now() + offset);

  // Brief happenings (`scene.effects`): a kick or a punch rattles the build. The newest id seen is
  // remembered so a reconnect never replays old ones; the first snapshot only primes it.
  let lastEffectId: number | undefined;
  function apply(msg: StateMsg) {
    const next = msg.scene as unknown as DudesScene;
    state = next;
    environment.journey(next.journey);
    objects.syncCommitted(next.objects);
    objects.syncPreviews(previewsOf(next));
    const names = new Map(next.objects.map((o) => [o.id, o.blueprint.name]));
    dudes.sync(next.dudes, (id) => names.get(id), serverClock());
    const effects = next.effects ?? [];
    const newest = effects.reduce((m, e) => Math.max(m, e.id), -1);
    if (lastEffectId === undefined) lastEffectId = newest;
    else if (newest > lastEffectId) {
      const now = performance.now();
      for (const e of effects) {
        if (e.id <= lastEffectId) continue;
        if (e.kind === 'shake') {
          if (e.objectId) objects.shake(e.objectId, now);
        } else fx.play(e, now, reduced);
      }
      lastEffectId = newest;
    }
    // A lit bomb is drawn for as long as it is in the list, including one lit before the page opened.
    fx.syncBombs(effects);
    hud(next);
    renderInspect();
  }
  /** Snapshots whose moment has come, oldest first; a long backlog (a hidden tab) collapses to its newest few. */
  function drain(now: number) {
    let due = 0;
    while (due < inbox.length && inbox[due].at <= now) due++;
    if (!due) return;
    for (const { msg } of inbox.splice(0, due).slice(-3)) {
      try {
        apply(msg);
      } catch (error) {
        console.error('Invalid dudes snapshot', error);
        el('connection').textContent = 'Could not read world update';
      }
    }
  }
  let socket: WebSocket | undefined,
    retry: ReturnType<typeof setTimeout> | undefined,
    attempts = 0,
    closing = false;
  function connect() {
    if (closing) return;
    socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`);
    socket.onopen = () => {
      connected = true;
      attempts = 0;
      el('connection').textContent = 'Connected · waiting for the field';
    };
    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as ServerMsg;
        if (msg.t === 'hello') {
          offset = msg.serverTime - Date.now();
          return;
        }
        if (msg.t !== 'state') return;
        const next = msg.scene as unknown as DudesScene;
        if (!next || !Array.isArray(next.dudes)) return;
        const now = performance.now();
        lastMessageAt = Date.now();
        // Movers are sampled the moment a snapshot lands, so there is always a next spot to slide
        // toward; everything else in it is applied when the drawn clock gets there.
        timeline.observe(msg.serverTime, now);
        dudes.sample(next.dudes, msg.serverTime);
        objects.sample(next.objects, msg.serverTime);
        el('connection').textContent = 'Live';
        // The first snapshot shows at once; with reduced motion the newest is drawn, so nothing waits.
        if (!state || reduced) apply(msg);
        else inbox.push({ at: timeline.applyAt(msg.serverTime), msg });
      } catch (error) {
        console.error('Invalid dudes snapshot', error);
        el('connection').textContent = 'Could not read world update';
      }
    };
    socket.onclose = () => {
      connected = false;
      if (closing) return;
      // Back off: 1 s, 2 s, 4 s … up to 15 s, with a little jitter so a room of pages does not stampede.
      const wait = Math.min(15_000, 1000 * 2 ** attempts) * (0.8 + Math.random() * 0.4);
      attempts++;
      el('connection').textContent = `Disconnected · retrying in ${Math.round(wait / 1000)} s`;
      retry = setTimeout(connect, wait);
    };
    socket.onerror = () => socket?.close();
  }
  connect();

  // --- the frame ---
  let frame = 0,
    frameAt = 0,
    lastInspectAt = 0;
  function draw(now: number) {
    frame = requestAnimationFrame(draw);
    if (document.hidden) return;
    const dt = frameAt ? Math.min((now - frameAt) / 1000, 0.1) : 0;
    frameAt = now;
    timeline.tick(dt * 1000);
    drain(now);
    const renderTime = reduced ? Infinity : timeline.renderTime(now);
    const serverNow = serverClock();
    const live = connected && Date.now() - lastMessageAt < 6000;
    dudes.pose(now, reduced, renderTime, serverNow, live);
    objects.update(now, reduced, renderTime);
    if (autoCamera) {
      const want = autoFrame();
      const k = reduced ? 1 : 1 - Math.exp(-dt * 1.4);
      focus.lerp(want.centre, k);
      half += (want.half - half) * k;
    }
    applyCamera();
    const g = centreOnGround();
    environment.frame(g.x, g.z, half * Math.max(1, innerWidth / innerHeight) * 1.1);
    fx.update(now, serverNow, reduced);
    // A boom nearby nudges the camera for half a second: never under reduced motion, gently on stream.
    if (!reduced) {
      const q = fx.shake(now, g);
      if (q.x || q.z) {
        const k = streamMode ? 0.35 : 1;
        camera.position.x += q.x * k;
        camera.position.z += q.z * k;
        camera.updateMatrixWorld();
      }
    }
    environment.update(now / 1000, reduced);
    renderer.render(scene, camera);
    // After the render, so the camera matrices are fresh.
    hovered = !streamMode && hoverAt && !drag ? dudes.pick(hoverAt.x, hoverAt.y, camera) : undefined;
    canvas.style.cursor = hovered ? 'pointer' : drag?.moved ? 'grabbing' : '';
    dudes.overlay(camera, serverNow, {
      hovered,
      selected: selected?.kind === 'dude' ? selected.id : undefined,
      uiScale,
      reserve: bannerRect,
    });
    countdown();
    if (selected && now - lastInspectAt > 500) {
      lastInspectAt = now;
      renderInspect();
    }
    if (connected && lastMessageAt && Date.now() - lastMessageAt > 10_000)
      el('connection').textContent = 'Connection stalled · waiting for update';
  }
  frame = requestAnimationFrame(draw);
  addEventListener(
    'pagehide',
    () => {
      closing = true;
      clearTimeout(retry);
      socket?.close();
      cancelAnimationFrame(frame);
      objects.dispose();
      fx.dispose();
      dudes.dispose();
      renderer.dispose();
    },
    { once: true },
  );
}

try {
  start();
} catch (error) {
  el('error').hidden = false;
  el('error').textContent = 'The 3D view could not start. Enable browser hardware acceleration and reload. ' + String(error);
  console.error(error);
}
