// The AI Dudes page: the town, a character for every chatter, their lots and whatever they build.
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
import { Timeline, Track, turn } from './motion';
import { LOCAL_SHOT, createOperator, type LocalShot } from './operator';
import { createPlayer } from './player';
import { createPlansLayer } from './plans';
import { createAudio } from './audio';
import { CITY_BOUNDS, shortRef, type DudeView, type DudesScene, type Emote, type MayorView, type ServerMsg } from './types';
import { AGES, MODERN, NO_AGE, ageStyle } from '../../src/shared/ages';
import { emoteNames } from '../../src/shared/emotes';
import { PITCH_DEFAULT, SCENES, fillLine, sceneLine, scenePose, type CamPose } from '../../src/shared/scenes';

const el = (id: string) => document.getElementById(id)!;
/** For newer bits of markup: a page served older HTML (the copy lags the script) skips them rather than throwing. */
const maybeEl = (id: string) => document.getElementById(id) ?? undefined;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
// Stream mode (`/?stream=1`, for an OBS browser source): the HUD is scaled up for a 1080p canvas
// watched on phones and the click-only controls are hidden, because nobody can click through a
// stream. `scale` overrides the HUD scale; `zoom` tightens (>1) or loosens (<1) the auto framing.
const params = new URLSearchParams(location.search);
const streamMode = params.get('stream') === '1';
const uiScale = Math.max(0.5, Math.min(3, Number(params.get('scale')) || (streamMode ? 2.6 : 1)));
const zoomBias = Math.max(0.5, Math.min(2.5, Number(params.get('zoom')) || 1));
// The operator page (`/mayor`): the streamer walks the Mayor and steers the camera; the stream view
// follows that camera (operator.ts).
const operatorMode = location.pathname.startsWith('/mayor');
// The player page (`/play`): a chatter logged in with Kick walks their own character (player.ts).
const playerMode = location.pathname.startsWith('/play');
// Sound: on for the stream (OBS captures it), off on the operator page (the streamer would hear it
// twice) unless `?sound=1`; `?sound=0` silences any page. `music`, `sfx`, `ambience` set levels 0..1.
const level = (name: string, fallback: number) => Math.max(0, Math.min(1, params.has(name) ? Number(params.get(name)) : fallback));
const soundOn = params.has('sound') ? params.get('sound') !== '0' : !operatorMode;
// The tour, paused for now (2026-10-18): off unless asked for. `?tour=quiet`: when chat has gone
// quiet the camera goes and finds someone (or something) and follows them a while, then the next,
// rather than framing everyone; `?tour=always` the whole time.
const TOUR = params.get('tour') ?? '0';
const QUIET_MS = 40_000;

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
  chop: 'chopping',
  hammer: 'building the community project',
  cast: 'casting a spell',
  shoot: 'shooting hoops',
  swing: 'having a swing',
  strum: 'playing music',
  swim: 'swimming',
  lift: 'lifting weights',
  paint: 'painting',
};
const ACTIVITY_WORDS: Record<string, string> = {
  idle: 'hanging out',
  walking: 'walking',
  building: 'building',
  emote: 'hanging out',
  sleeping: 'napping',
  using: 'using a build',
  designing: 'drawing up plans',
};
const NEED_LABELS: [keyof NonNullable<DudeView['needs']>, string][] = [
  ['hunger', 'food'],
  ['energy', 'rest'],
  ['fun', 'fun'],
  ['social', 'company'],
];
// The camera: a fixed elevation, a yaw the viewer can turn, an orthographic half-height (metres).
const CAM_BACK = 43,
  CAM_UP = 36,
  YAW_MIN = 0.2,
  YAW_MAX = 1.25,
  HALF_MIN = 5,
  HALF_MAX = 60,
  AUTO_MIN = 6,
  AUTO_MAX = 40;
const SIN_ELEVATION = CAM_UP / Math.hypot(CAM_UP, CAM_BACK);
/** How close the stream camera comes in on one person (orthographic half-height, metres). */
const FOCUS_HALF = 8;
/** How many times further back than CAM_BACK/CAM_UP the camera actually stands. */
const CAM_FAR = 12;

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
    fx = createEffectsLayer(environment.world),
    plans = createPlansLayer(environment.world);

  // Read-only handles for browser smokes.
  (window as unknown as { __dudes?: unknown }).__dudes = {
    count: () => dudes.count(),
    positionOf: (id: string) => dudes.positionOf(id),
    poseOf: (id: string) => dudes.poseOf(id),
  };

  /** Every build in flight: each dude's ghost, keyed by whose it is. */
  function previewsOf(s: DudesScene): PreviewSpec[] {
    const list: PreviewSpec[] = [];
    for (const b of s.mayorBuilds ?? [])
      if (b.preview) list.push({ key: `mayor:${b.id}`, preview: b.preview, status: b.status === 'building' ? 'building' : 'other', progress: b.progress });
    const project = s.town?.project;
    if (project?.preview)
      list.push({
        key: 'project',
        preview: project.preview,
        status: 'building',
        progress: Math.min(project.coins / project.coinsNeed, project.work / project.workNeed),
      });
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
  const camera = new THREE.OrthographicCamera(-20, 20, 20, -20, 0.1, 2400);
  let yaw = 0.65,
    half = 16,
    autoCamera = true;
  // The tilt down: fixed but for cutscenes, which bring it low for faces (shared/scenes.ts).
  let pitch = PITCH_DEFAULT;
  const focus = new THREE.Vector3(0, 0, 0);
  const right = new THREE.Vector3(),
    up = new THREE.Vector3(),
    forward = new THREE.Vector3();
  function axes() {
    forward.set(-Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
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
    // Far back along the same line (orthographic: distance changes nothing on screen), so a zoomed-out
    // view's near edge never falls behind the camera and gets clipped (the south-east cut-off).
    const far = Math.hypot(CAM_BACK, CAM_UP) * CAM_FAR;
    camera.position.set(focus.x + Math.sin(yaw) * Math.cos(pitch) * far, focus.y + Math.sin(pitch) * far, focus.z + Math.cos(yaw) * Math.cos(pitch) * far);
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
    // Chatters whose chatter is around, wherever they are in town (residents never pull the shot
    // about). Nappers count only when nobody is awake, so a quiet stream still shows someone.
    const people: { x: number; z: number }[] = [];
    dudes.each((x, z, v) => {
      if (v.resident || v.npc) return;
      if (awake && v.away) return;
      people.push({ x, z });
      add(x, 0, z);
      add(x, 2.4 * (v.scale ?? 1), z);
    });
    // Builds only where people are, and whatever anyone is working on.
    for (const o of state?.objects ?? []) {
      const at = o.driven?.at ?? o.position;
      if (!people.some((p) => Math.hypot(p.x - at.x, p.z - at.z) < 14)) continue;
      const w = (o.footprint?.width ?? 2) / 2,
        d = (o.footprint?.depth ?? 2) / 2;
      add(at.x - w, 0, at.z - d);
      add(at.x + w, 3, at.z + d);
    }
    for (const d of state?.dudes ?? [])
      if (d.job?.at && !d.away) {
        add(d.job.at.x, 0, d.job.at.z);
        add(d.job.at.x, 3, d.job.at.z);
      }
    // A grand opening: everyone heads there, and so does the shot.
    const party = state?.town?.party;
    if (party) {
      add(party.at.x - 6, 0, party.at.z - 6);
      add(party.at.x + 6, 4, party.at.z + 6);
    }
    if (!n) return { centre: new THREE.Vector3(0, 0, 0), half: 22 };
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
    if (op) {
      // The operator's free camera moves by its own reckoning (operator.ts), so the stream gets it too.
      op.panBy(right.x * -dx * perPx - Math.sin(yaw) * ((dy * perPx) / SIN_ELEVATION), right.z * -dx * perPx - Math.cos(yaw) * ((dy * perPx) / SIN_ELEVATION));
      return;
    }
    focus.addScaledVector(right, -dx * perPx);
    focus.x += -Math.sin(yaw) * ((dy * perPx) / SIN_ELEVATION);
    focus.z += -Math.cos(yaw) * ((dy * perPx) / SIN_ELEVATION);
    // Never wander off into the countryside.
    focus.x = Math.max(CITY_BOUNDS.minX - 20, Math.min(CITY_BOUNDS.maxX + 20, focus.x));
    focus.z = Math.max(CITY_BOUNDS.minZ - 20, Math.min(CITY_BOUNDS.maxZ + 20, focus.z));
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
      else if (operatorMode || playerMode) yaw = drag.yaw + (e.clientX - drag.x) * 0.004;
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
      // The operator zooms round the Mayor; anyone else zooms round the pointer and takes the camera over.
      if (operatorMode || playerMode) return void (half = Math.max(HALF_MIN, Math.min(playerMode ? 30 : 45, half * Math.exp(e.deltaY * 0.0012))));
      follow(false);
      zoomAbout(e.clientX, e.clientY, Math.exp(e.deltaY * 0.0012));
    },
    { passive: false },
  );

  // --- inspect ---
  let selected: { kind: 'dude' | 'object'; id: string } | undefined;
  function click(x: number, y: number) {
    // The operator choosing where the Mayor's build goes takes the click first.
    const spot = op ? groundAt(x, y) : undefined;
    if (op && spot && op.pick({ x: spot.x, z: spot.z })) return;
    // Carrying a weapon (or aboard something with a gun): a click fires at that spot.
    if (op && spot && op.fireAt({ x: spot.x, z: spot.z })) return;
    const dude = dudes.pick(x, y, camera);
    if (dude && op?.pickPerson(dude)) return;
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
  el('inspect-rework').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = el('inspect-rework-text') as HTMLInputElement;
    const change = input.value.trim();
    if (!op || !change || selected?.kind !== 'object' || !op.canRework(selected.id)) return;
    op.edit(selected.id, change);
    input.value = '';
    input.blur();
  });
  el('inspect-focus').onclick = () => {
    if (op && selected?.kind === 'dude') op.focusOn(selected.id);
  };
  el('inspect-delete').onclick = () => {
    if (!op || selected?.kind !== 'object' || !op.canRework(selected.id)) return;
    const name = state?.objects.find((o) => o.id === selected!.id)?.blueprint.name ?? 'this build';
    if (!confirm(`Take down ${name}?`)) return;
    op.remove(selected.id);
    inspect(undefined);
  };
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
  /** Four little bars in the inspect panel: food, rest, fun, company. */
  function needBars(needs: DudeView['needs'] | undefined) {
    const box = el('inspect-needs');
    box.hidden = !needs;
    if (!needs) return;
    const key = JSON.stringify(needs);
    if (box.dataset.key === key) return;
    box.dataset.key = key;
    box.replaceChildren(
      ...NEED_LABELS.flatMap(([k, label]) => {
        const name = document.createElement('span');
        name.textContent = label;
        const bar = document.createElement('div');
        bar.className = 'bar';
        const fill = document.createElement('i');
        const v = Math.max(0, Math.min(100, needs[k]));
        fill.style.width = `${v}%`;
        fill.style.background = v >= 65 ? '#57d64a' : v >= 40 ? '#e9c23c' : '#e0523f';
        bar.append(fill);
        return [name, bar];
      }),
    );
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
      const built = state.objects.filter((o) => o.owner === v.id).length;
      el('inspect-name').textContent = v.name;
      el('inspect-detail').textContent = v.resident
        ? `lives in ${state.town?.name ?? 'town'}`
        : [v.title, v.address, v.coins !== undefined ? `§${v.coins}` : '', built ? `${built} build${built === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ');
      el('inspect-doing').textContent = doingOf(v, serverNow);
      const say = v.say && v.say.until > serverNow ? `“${emoteNames(v.say.text)}”` : '';
      el('inspect-say').textContent = say;
      el('inspect-say').hidden = !say;
      needBars(v.needs);
      el('inspect-rework').hidden = true;
      el('inspect-focus').hidden = !operatorMode || v.id === 'mayor';
    } else {
      const o = state.objects.find((x) => x.id === selected!.id);
      if (!o) {
        panel.hidden = true;
        selected = undefined;
        return;
      }
      el('inspect-name').textContent = o.blueprint.name;
      // On the operator page the Mayor can rework any build from here.
      el('inspect-rework').hidden = !op?.canRework(o.id);
      el('inspect-focus').hidden = true;
      const stats = state.town?.places?.[o.id];
      el('inspect-detail').textContent = [
        o.venue && o.venue !== 'decor' ? (o.civic ? `the town's ${o.venue}` : o.venue === 'home' ? 'a home' : `a ${o.venue}`) : '',
        o.civic ? `proposed by ${nameOf(o.createdBy)}` : `built by ${nameOf(o.createdBy)}`,
        stats ? `${stats[0]} visit${stats[0] === 1 ? '' : 's'}, §${stats[1]} taken` : '',
        `#${shortRef(o.id)}`,
      ]
        .filter(Boolean)
        .join(' · ');
      el('inspect-doing').textContent = o.blueprint.description ?? '';
      el('inspect-say').hidden = true;
      needBars(undefined);
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
    for (const k of ['project', 'party']) el('happening').classList.toggle(k, h.kind === k);
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
    // On stream only the last three lines: phones can read three.
    const feed = (s.feed ?? []).slice(streamMode ? -3 : -5);
    const key = feed.map((f) => `${f.at}:${f.text}`).join('|');
    if (key !== feedKey) {
      feedKey = key;
      const box = el('feed');
      box.replaceChildren(
        ...feed.map((item, i) => {
          const line = document.createElement('div');
          line.textContent = item.text;
          // Newest last and brightest; the older ones fade out above it.
          line.style.opacity = String(Math.max(0.3, 1 - (feed.length - 1 - i) * 0.18));
          return line;
        }),
      );
      box.hidden = !feed.length;
    }
    // Only a problem shows down here: the AI paused, out of calls or offline.
    const ai = s.ai;
    const out = ai.enforced && ai.callsRemaining <= 0;
    const warn = ai.paused ? 'AI PAUSED' : out ? 'AI OUT OF CALLS' : !ai.available ? 'AI OFFLINE' : '';
    el('ai-warn').textContent = warn;
    el('ai-warn').hidden = !warn;
  }

  // --- the tour: when chat is quiet, a slow wander from one character to the next ---
  let tourSubject: { id: string; kind: 'dude' | 'object'; until: number; since: number; yaw: number } | undefined;
  let lastTourId: string | undefined;
  /** Chat has been quiet a while (or the tour is forced on); and there is someone to go and see. */
  function touring(): boolean {
    if (TOUR === '0' || !state) return false;
    if (TOUR === 'always') return true;
    const lastChat = state.dudes.filter((d) => !d.npc && !d.resident && !d.mayor).reduce((m, d) => Math.max(m, d.heardAt ?? 0), 0);
    return serverClock() - lastChat > QUIET_MS;
  }
  /** Someone worth a look, weighted by what they are doing; not the one just seen. */
  function pickSubject(): { id: string; kind: 'dude' | 'object' } | undefined {
    const pool: { id: string; kind: 'dude' | 'object'; w: number }[] = [];
    for (const d of state?.dudes ?? []) {
      if (d.hidden || d.npc || d.id === lastTourId || !dudes.positionOf(d.id)) continue;
      const w =
        d.activity === 'building' || d.activity === 'designing' ? 6 : d.activity === 'using' ? 4 : d.activity === 'walking' ? 3 : d.say ? 3 : d.emote ? 2 : d.away ? 0.4 : 1.2;
      pool.push({ id: d.id, kind: 'dude', w: d.resident ? w * 0.6 : w });
    }
    for (const o of state?.objects ?? []) if (o.creature && o.id !== lastTourId) pool.push({ id: o.id, kind: 'object', w: 2.5 });
    let r = Math.random() * pool.reduce((a, p) => a + p.w, 0);
    return pool.find((p) => (r -= p.w) <= 0) ?? pool[0];
  }
  const tourFocus = new THREE.Vector3();
  function tour(dt: number, now: number) {
    const at = (s: NonNullable<typeof tourSubject>) => (s.kind === 'dude' ? dudes.positionOf(s.id) : objects.positionOf(s.id));
    const gone = tourSubject && (!at(tourSubject) || (tourSubject.kind === 'dude' && state?.dudes.find((d) => d.id === tourSubject!.id)?.hidden));
    if (!tourSubject || now > tourSubject.until || gone) {
      const next = pickSubject();
      if (!next) return;
      lastTourId = next.id;
      tourSubject = { ...next, since: now, until: now + 14_000 + Math.random() * 6000, yaw: YAW_MIN + Math.random() * (YAW_MAX - YAW_MIN) };
    }
    const p = at(tourSubject);
    if (!p) return;
    // A slow glide over to them, then a close follow with the camera drifting gently round.
    const settled = now - tourSubject.since > 2500;
    const k = reduced ? 1 : 1 - Math.exp(-dt * (settled ? 2.5 : 1.1));
    focus.lerp(tourFocus.set(p.x, 1, p.z), k);
    const drift = reduced ? 0 : Math.sin((now - tourSubject.since) / 9000) * 0.18;
    yaw = turn(yaw, Math.max(YAW_MIN, Math.min(YAW_MAX, tourSubject.yaw + drift)), reduced ? 1 : 1 - Math.exp(-dt * 0.6));
    const want = tourSubject.kind === 'object' ? 12 : 9;
    half += (want - half) * (reduced ? 1 : 1 - Math.exp(-dt * 0.9));
  }

  // --- cutscenes (shared/scenes.ts): the server says which and since when; the script does the rest ---
  let sceneFrom: { key: string; pose: CamPose } | undefined;
  let subtitleKey = '';
  function cinema(serverNow: number): void {
    const sc = state?.town?.scene;
    const scene = sc && SCENES[sc.id];
    const t = sc ? serverNow - sc.at : 0;
    const on = !!scene && t >= 0 && t < scene.ms;
    document.body.classList.toggle('cinema', on);
    if (!on || !scene || !sc) {
      sceneFrom = undefined;
      if (subtitleKey) {
        subtitleKey = '';
        el('subtitle').hidden = true;
      }
      // Back to the usual tilt after a scene, eased.
      if (Math.abs(pitch - PITCH_DEFAULT) > 1e-4) pitch += (PITCH_DEFAULT - pitch) * 0.08;
      else pitch = PITCH_DEFAULT;
      return;
    }
    // The shots start from wherever the camera was when the scene began.
    const key = `${sc.id}:${sc.at}`;
    if (sceneFrom?.key !== key) sceneFrom = { key, pose: { focus: [focus.x, focus.y, focus.z], yaw, pitch, half } };
    // Reduced motion: no glides, each shot cuts straight to where it settles.
    const pose = reduced ? ([...scene.shots].reverse().find((s) => s.at <= t)?.pose ?? sceneFrom.pose) : scenePose(scene, t, sceneFrom.pose);
    focus.set(...pose.focus);
    yaw = pose.yaw;
    pitch = pose.pitch;
    half = pose.half;
    const vars = { leader: sc.leader ?? '', ...sc.vars };
    const line = sceneLine(scene, t, vars);
    const lk = line ? `${sc.at}:${line.at}:${line.text}` : '';
    if (lk !== subtitleKey) {
      subtitleKey = lk;
      const box = el('subtitle');
      box.hidden = !line;
      box.classList.toggle('title', !!line?.title);
      if (line) {
        el('subtitle-who').textContent = fillLine(line.who, vars);
        el('subtitle-text').textContent = fillLine(line.text, vars);
      }
    }
  }

  // --- the Mayor ---
  let liveMayor: MayorView | undefined;
  const mayorFocus = new THREE.Vector3();
  const mayorTrack = new Track(30);
  // --- sound ---
  const audio = createAudio(soundOn, { music: level('music', 0.5), sfx: level('sfx', 0.8), ambience: level('ambience', 0.6) });
  let audioKey = '';
  const lastSaid = new Map<string, string>();
  let knownObjects: Set<string> | undefined;
  let lastFeedAt: number | undefined;
  let lastHappening = '';
  const hammerAt = new Map<string, number>();
  let nextBrayAt = 0;
  const seedOf = (id: string) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  /** What just happened in this snapshot, as sound: speech, new builds, arrivals, openings, troublemakers. */
  function hear(s: DudesScene) {
    // The operator's levels for the stream.
    const a = s.mayor?.audio;
    const key = a ? `${a.music},${a.sfx}` : '';
    if (a && key !== audioKey && !operatorMode) audio.levels({ music: a.music * level('music', 0.5) * 2, sfx: a.sfx * level('sfx', 0.8) * 1.25, ambience: a.sfx * level('ambience', 0.6) * 1.25 });
    audioKey = key;
    for (const d of s.dudes) {
      const text = d.say?.text ?? '';
      if (text && text !== lastSaid.get(d.id)) audio.speech(seedOf(d.id), emoteNames(text), d.position, d.mayor);
      lastSaid.set(d.id, text);
    }
    const ids = new Set(s.objects.map((o) => o.id));
    if (knownObjects) for (const o of s.objects) if (!knownObjects.has(o.id)) audio.built(o.position);
    knownObjects = ids;
    const feed = s.feed ?? [];
    // Only what is new since the last snapshot (the first one just sets the mark).
    const fresh = lastFeedAt === undefined ? [] : feed.filter((f) => f.at > lastFeedAt!);
    if (feed.length) lastFeedAt = Math.max(lastFeedAt ?? 0, feed.at(-1)!.at);
    for (const f of fresh) {
      if (/ moved into | arrived and took a flat/.test(f.text)) audio.doorbell();
      if (/ is open!/.test(f.text)) audio.fanfare();
    }
    const h = s.happening;
    const hk = h ? `${h.kind}:${h.title}` : '';
    if (hk && hk !== lastHappening) {
      if (h!.kind === 'party') audio.fanfare();
      else if (h!.kind !== 'project') audio.sting();
    }
    lastHappening = hk;
  }
  /** Per frame: hammering where things go up, engines on the road, the fountain, the odd bray. */
  function soundscape(now: number) {
    if (!audio.on || !state) return;
    const g = centreOnGround();
    audio.listen(g.x, g.z, half);
    for (const d of state.dudes) {
      if (d.activity !== 'building' || d.hidden) continue;
      const at = dudes.positionOf(d.id) ?? d.position;
      if ((hammerAt.get(d.id) ?? 0) < now) {
        audio.hammer(at);
        hammerAt.set(d.id, now + 380 + Math.random() * 260);
      }
    }
    let engines = 0;
    for (const o of state.objects) {
      const moving = o.creature?.behaviour === 'zoom' ? o.creature.moving : !!o.driven && o.id === (liveMayor ?? state.mayor)?.riding?.id && (liveMayor ?? state.mayor)?.moving;
      if (!moving) continue;
      const at = objects.positionOf(o.id) ?? o.position;
      engines = Math.max(engines, 1 - Math.hypot(at.x - g.x, at.z - g.z) / (half * 1.2 + 10));
    }
    const fountain = Math.max(0, 1 - Math.hypot(g.x, g.z) / 28);
    audio.beds(Math.max(0, engines), fountain);
    if (now > nextBrayAt) {
      nextBrayAt = now + 15_000 + Math.random() * 25_000;
      const donkey = state.objects.find((o) => o.creature && /\b(donkey|mule|horse|pony|ass)\b/i.test(o.blueprint.name));
      if (donkey) audio.bray(objects.positionOf(donkey.id) ?? donkey.position);
    }
  }
  const buildMarker = new THREE.Mesh(
    new THREE.RingGeometry(1.1, 1.45, 36),
    new THREE.MeshBasicMaterial({ color: 0xf2c94c, transparent: true, opacity: 0.9, depthWrite: false }),
  );
  buildMarker.rotation.x = -Math.PI / 2;
  buildMarker.visible = false;
  environment.world.add(buildMarker);
  let ridingLocal: string | undefined;
  let lastRide: { x: number; z: number; facing: number; y: number } | undefined;
  const op = operatorMode ? createOperator(el, () => state) : playerMode ? createPlayer(el, () => state) : undefined;
  // This page's own shots are drawn the moment they are fired (not half a second later off the
  // snapshot); the server's copy of a blaster bolt is then skipped here.
  let localShotAt = -Infinity;
  addEventListener(LOCAL_SHOT, (e) => {
    const shot = (e as CustomEvent<LocalShot>).detail;
    localShotAt = performance.now();
    fx.local(shot, localShotAt);
    audio.pew(shot.from);
  });
  if (op) follow(false);

  // --- the socket and the drawn clock ---
  const timeline = new Timeline(),
    inbox: { at: number; msg: StateMsg }[] = [];
  let state: DudesScene | undefined,
    connected = false,
    lastMessageAt = 0,
    offset = 0;
  /** Server time as drawn: what bubbles, emotes and waves are measured against. */
  const serverClock = () => (timeline.ready ? timeline.renderTime(performance.now()) : Date.now() + offset);

  // The caravan's board (bottom right): who is camped across the river and what their leader asks.
  let caravanKey = '';
  /** What to type for the first ask still open, as an example a viewer can copy. */
  function typedAsk(c: NonNullable<NonNullable<DudesScene['town']>['caravan']>): string {
    const open = c.asks.filter((a) => a.have < a.need).map((a) => a.label);
    for (const label of open) {
      if (/bridge/i.test(label)) return 'help at the bridge';
      const eat = /to eat \(([^,)…]+)/i.exec(label);
      if (eat) return `build a ${eat[1].trim()}`;
      const shift = /^work .*shifts? at an? (.+)$/i.exec(label);
      if (shift) return `work a shift at the ${shift[1].trim()}`;
      const place = /^build an? (.+?) for /i.exec(label);
      if (place) return `build a ${place[1].trim()}`;
      if (/party/i.test(label)) return 'throw a party';
      const wonder = /^build (.+?) on the square/i.exec(label);
      if (wonder) return `propose ${wonder[1].trim()}`;
    }
    return '';
  }
  function renderCaravan(c: NonNullable<DudesScene['town']>['caravan'], age = MODERN): void {
    const box = el('caravan');
    const key = JSON.stringify(c ?? null) + age;
    if (key === caravanKey) return;
    caravanKey = key;
    box.hidden = !c;
    if (!c) return;
    // Where the town is in its history: "Age 3/6 · The Middle Ages", and a six-step strip.
    const name = ageStyle(age).name;
    const ageLine = maybeEl('caravan-age');
    if (ageLine) ageLine.textContent = `Age ${age + 1}/${AGES.length} · ${name.charAt(0).toUpperCase()}${name.slice(1)}`;
    maybeEl('caravan-steps')?.replaceChildren(
      ...AGES.map((_a, i) => {
        const step = document.createElement('i');
        if (i < age) step.className = 'past';
        else if (i === age) step.className = 'now';
        return step;
      }),
    );
    el('caravan-title').textContent = c.stranded ? `${c.name} · stuck at the river` : `${c.name} · visit ${c.visit} of ${c.of}`;
    el('caravan-say').textContent = c.between ? `${c.leader} is pleased. More news soon…` : c.problem;
    const asks = el('caravan-asks');
    asks.replaceChildren();
    if (!c.between)
      for (const a of c.asks) {
        const done = a.have >= a.need;
        const label = document.createElement('span');
        label.textContent = `${done ? '✓ ' : ''}${a.label}`;
        const bar = document.createElement('span');
        bar.className = 'bar';
        const fill = document.createElement('i');
        fill.style.width = `${Math.round((Math.min(a.have, a.need) / Math.max(1, a.need)) * 100)}%`;
        bar.append(fill);
        const count = document.createElement('span');
        count.textContent = `${Math.min(a.have, a.need)}/${a.need}`;
        for (const x of [label, bar, count]) {
          if (done) x.classList.add('done');
          asks.append(x);
        }
      }
    // The call to action, typed out: what to put in chat, word for word.
    const typed = c.between ? '' : typedAsk(c);
    const then = c.stranded ? 'and they can cross into town' : c.visit === c.of ? 'and the town moves into the next age' : 'and the town moves on';
    el('caravan-note').textContent = typed ? `Type “${typed}” in chat ${then}.` : c.stranded ? 'Mend it and they can cross into town.' : c.visit === c.of ? 'Finish this and the town moves into the next age.' : 'Help them and the town moves on.';
  }

  // The corner line: where to walk your own character, and how many seats are taken.
  let playKey = '';
  function playLine(p: StateMsg['play']): void {
    const key = p ? `${p.url}|${p.used}|${p.cap}` : '';
    if (key === playKey) return;
    playKey = key;
    const box = maybeEl('play-line'),
      url = maybeEl('play-url'),
      seats = maybeEl('play-seats');
    if (!box || !url || !seats) return;
    box.hidden = !p || playerMode;
    if (!p) return;
    url.textContent = p.url.replace(/^https?:\/\//, '').replace(/\/$/, '');
    seats.textContent = `${p.used}/${p.cap} seats`;
  }

  // Brief happenings (`scene.effects`): a kick or a punch rattles the build. The newest id seen is
  // remembered so a reconnect never replays old ones; the first snapshot only primes it.
  let lastEffectId: number | undefined;
  function apply(msg: StateMsg) {
    const next = msg.scene as unknown as DudesScene;
    state = next;
    liveMayor = next.mayor; // the snapshot has the last word (the operator page may have closed)
    // The town's age first: the scenery is rebuilt in its style, and builds from other ages take its colours.
    const age = next.town?.age ?? MODERN;
    // The theme-free sandbox: the plain (Modern) town, and every build in its own colours.
    environment.setAge(next.town?.sandbox ? MODERN : age);
    objects.setAge(next.town?.sandbox ? NO_AGE : age);
    environment.town(next.town);
    renderCaravan(next.town?.caravan, next.town?.age);
    playLine(msg.play);
    objects.syncCommitted(next.objects);
    objects.syncPreviews(previewsOf(next));
    const names = new Map(next.objects.map((o) => [o.id, o.blueprint.name]));
    dudes.sync(next.dudes, (id) => names.get(id), serverClock());
    // Sites marked out for everyone's designs, the Mayor's included.
    plans.sync([...next.dudes, ...(next.mayorBuilds ?? []).map((b) => ({ id: `mayor:${b.id}`, job: { id: b.id, kind: 'build' as const, label: b.label, status: b.status, progress: b.progress, at: b.at, site: b.site } }))]);
    const effects = next.effects ?? [];
    const newest = effects.reduce((m, e) => Math.max(m, e.id), -1);
    if (lastEffectId === undefined) lastEffectId = newest;
    else if (newest > lastEffectId) {
      const now = performance.now();
      for (const e of effects) {
        if (e.id <= lastEffectId) continue;
        const mine = (e.kind === 'shot' || e.kind === 'shell') && !!e.dudeId && e.dudeId === op?.self() && now - localShotAt < 3000;
        if (mine && e.kind === 'shot') continue; // already drawn when it was fired
        if (e.kind === 'shake') {
          if (e.objectId) objects.shake(e.objectId, now);
          // A hit says it with its own sound; a plain rattle thuds.
          if (!effects.some((x) => x.kind === 'hit' && x.objectId === e.objectId && Math.abs(x.at - e.at) < 50)) audio.thud(e.objectId ? objects.positionOf(e.objectId) : undefined);
        } else {
          const tint = e.objectId ? next.objects.find((o) => o.id === e.objectId)?.blueprint.color : undefined;
          fx.play(e, now, reduced, tint ? parseInt(tint.slice(1), 16) : undefined);
        }
        if (e.kind === 'shell' && e.from && e.to) {
          // Off it goes, and it lands a moment later where it was aimed.
          if (!mine) audio.pew(e.from);
          const at = e.to;
          setTimeout(() => audio.boom(at), Math.max(120, (Math.hypot(e.to.x - e.from.x, e.to.z - e.from.z) / 38) * 1000));
        } else if (e.kind === 'hit') audio.thud(e.to);
        else if (e.kind === 'collapse') {
          audio.boom(e.from);
          audio.thud(e.from);
        }
        if (e.kind === 'coins') audio.coins(e.to);
        else if (e.kind === 'pop') audio.play(e.pose, e.to);
        else if (e.kind === 'burst') audio.burst(e.label, e.to);
        else if (e.kind === 'boom') audio.boom(e.from);
        else if (e.kind === 'shot') audio.pew(e.from);
        else if (e.kind === 'ko') audio.bonk(e.dudeId ? dudes.positionOf(e.dudeId) : undefined);
        else if (e.kind === 'slam' || e.kind === 'throw') audio.thud(e.from);
      }
      lastEffectId = newest;
    }
    // A lit bomb is drawn for as long as it is in the list, including one lit before the page opened.
    fx.syncBombs(effects);
    hud(next);
    hear(next);
    op?.scene(next, serverClock());
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
      }
    }
  }
  let epoch: string | undefined;
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
    };
    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as ServerMsg;
        if (msg.t === 'hello') {
          offset = msg.serverTime - Date.now();
          // A different server start: build ids and revisions may have been reused (a save older than
          // what this page saw), so every build's parts are fetched again.
          if (msg.epoch && epoch && msg.epoch !== epoch) objects.resetGeometry();
          if (msg.epoch) epoch = msg.epoch;
          return;
        }
        if (msg.t === 'mayor') {
          // The Mayor between snapshots: where he is now, and the camera the operator is steering.
          liveMayor = msg.mayor;
          if (op) op.mayor(msg.mayor);
          // What he is riding comes along at the same pace, on the same clock.
          const ride = msg.mayor.riding;
          if (!operatorMode && ride) objects.sampleOne(ride.id, { t: msg.serverTime, x: msg.mayor.position.x, y: ride.altitude, z: msg.mayor.position.z, facing: msg.mayor.facing });
          // The camera's own track of him: smooth whether or not he is drawn (hidden, he is only a camera).
          // It follows the operator's camera, which is on the Mayor unless it has been set free.
          const cam = msg.mayor.cam;
          if (!operatorMode) mayorTrack.sample({ t: msg.serverTime, x: cam.x ?? msg.mayor.position.x, y: 0, z: cam.z ?? msg.mayor.position.z, facing: 0 });
          if (!operatorMode && msg.mayor.live && !msg.mayor.hidden)
            dudes.sampleOne({ id: 'mayor', name: state?.town?.head ?? 'The Mayor', position: msg.mayor.position, facing: msg.mayor.facing, activity: ride ? 'using' : msg.mayor.moving ? 'walking' : 'idle', ...(ride ? { y: ride.seat + ride.altitude } : {}) } as DudeView, msg.serverTime);
          return;
        }
        if (msg.t === 'dude') {
          // A player between snapshots (this page's own player is drawn where this page says).
          if (msg.dude.id === op?.self()) return;
          const known = dudes.view(msg.dude.id);
          if (!known) return; // the next snapshot brings them in
          const ride = msg.dude.ride;
          if (ride) objects.sampleOne(ride.id, { t: msg.serverTime, x: msg.dude.position.x, y: ride.altitude, z: msg.dude.position.z, facing: msg.dude.facing });
          dudes.sampleOne({ ...known, id: msg.dude.id, position: msg.dude.position, facing: msg.dude.facing, activity: ride ? 'using' : msg.dude.moving ? 'walking' : 'idle', ...(ride ? { y: ride.y } : {}) } as DudeView, msg.serverTime);
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
        // The Mayor's own messages carry him, many times a second and stamped when he moved; the
        // snapshot's copy of him is on another clock and would make him stop and start.
        // Players walking their own characters are carried the same way, by their own messages.
        const skip = new Set(next.dudes.filter((d) => d.piloted).map((d) => d.id));
        if (!operatorMode && next.mayor?.live) skip.add('mayor');
        dudes.sample(next.dudes, msg.serverTime, skip);
        // Rides steered from a page (the Mayor's, players') come in on their own messages, between snapshots.
        const steered = new Set(next.dudes.filter((d) => d.piloted && d.riding && d.id !== op?.self()).map((d) => d.riding!));
        if (!operatorMode && next.mayor?.live && next.mayor.riding) steered.add(next.mayor.riding.id);
        objects.sample(next.objects, msg.serverTime, steered);
        // The first snapshot shows at once; with reduced motion the newest is drawn, so nothing waits.
        if (!state || reduced) apply(msg);
        else {
          inbox.push({ at: timeline.applyAt(msg.serverTime), msg });
          // A hidden tab draws nothing and drains nothing: keep only the newest few, not an hour of worlds.
          if (inbox.length > 4) inbox.splice(0, inbox.length - 4);
        }
      } catch (error) {
        console.error('Invalid dudes snapshot', error);
      }
    };
    socket.onclose = () => {
      connected = false;
      if (closing) return;
      // Back off: 1 s, 2 s, 4 s … up to 15 s, with a little jitter so a room of pages does not stampede.
      const wait = Math.min(15_000, 1000 * 2 ** attempts) * (0.8 + Math.random() * 0.4);
      attempts++;
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
    plans.update(now, reduced);
    const mayor = liveMayor ?? state?.mayor;
    if (op) {
      // The operator page: the Mayor walks here, and the camera stays on him.
      yaw += op.turn(dt);
      const me = op.frame(dt, yaw, half);
      // Aboard something: it goes where he goes, and he sits in it.
      if (me.ride) objects.setLocal(me.ride.id, { x: me.x, z: me.z, facing: me.facing, y: me.ride.altitude, moving: me.moving });
      if (ridingLocal && ridingLocal !== me.ride?.id) {
        // Just got off: it stays where he left it until its own track (a little behind) gets there too.
        const left = ridingLocal;
        objects.setLocal(left, { ...lastRide!, moving: false });
        setTimeout(() => objects.setLocal(left, undefined), 1600);
      }
      ridingLocal = me.ride?.id;
      if (me.ride) lastRide = { x: me.x, z: me.z, facing: me.facing, y: 0 }; // it lands when he gets off
      const self = op.self();
      if (self) dudes.setLocal(self, { ...me, ...(me.ride ? { y: me.ride.seat + me.ride.altitude, moving: false, pose: me.ride.moves === 'drive' || me.ride.moves === 'vehicle' ? 'drive' : 'sit' } : {}) });
      // Where the next build goes, while the build box is open.
      const pick = op.spot();
      buildMarker.visible = !!pick;
      if (pick) {
        buildMarker.position.set(pick.x, 0.06, pick.z);
        buildMarker.scale.setScalar(1 + (reduced ? 0 : Math.sin(now * 0.006) * 0.08));
      }
      const k = reduced ? 1 : 1 - Math.exp(-dt * (me.free ? 14 : 6));
      focus.lerp(mayorFocus.set(me.cam.x, 1, me.cam.z), k);
    } else if (autoCamera && mayor?.live && mayor.focus && dudes.positionOf(mayor.focus)) {
      // The stream: on the one person the Mayor chose, close in, eased.
      const p = dudes.positionOf(mayor.focus)!;
      const k = reduced ? 1 : 1 - Math.exp(-dt * 5),
        kc = reduced ? 1 : 1 - Math.exp(-dt * 2);
      focus.lerp(mayorFocus.set(p.x, 1, p.z), k);
      yaw = turn(yaw, mayor.cam.yaw, kc);
      half += (FOCUS_HALF - half) * kc;
    } else if (autoCamera && mayor?.live && mayor.follow) {
      // The stream: the operator's camera, eased, centred on the Mayor as he is drawn.
      const at = mayorTrack.at(renderTime) ?? { x: mayor.position.x, z: mayor.position.z };
      // Centred on him tightly (he is already smooth); turning and zooming are eased a little more.
      const k = reduced ? 1 : 1 - Math.exp(-dt * 8),
        kc = reduced ? 1 : 1 - Math.exp(-dt * 4);
      focus.lerp(mayorFocus.set(at.x, 1, at.z), k);
      yaw = turn(yaw, mayor.cam.yaw, kc);
      half += (mayor.cam.half - half) * kc;
    } else if (autoCamera && touring()) {
      tour(dt, now);
    } else if (autoCamera) {
      tourSubject = undefined;
      const want = autoFrame();
      const k = reduced ? 1 : 1 - Math.exp(-dt * 1.4);
      focus.lerp(want.centre, k);
      half += (want.half - half) * k;
    }
    // A cutscene has the camera, the letterbox and the subtitles, on every page (the operator's too).
    cinema(serverNow);
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
    soundscape(now);
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
