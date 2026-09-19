import * as THREE from 'three';
import type { ServerMsg } from '../../src/shared/protocol';
import { shortRef, type SafehouseScene, type GroundPoint } from '../../src/shared/safehouseTypes';
import { SURVIVOR_START } from '../../src/shared/safehouseLayout';
import { createCombatView } from './combat';
import { buildEnvironment } from './environment';
import { createObjectsLayer } from './objects';
import { buildPersonGroup, newMaterialCache } from './primitives';
import { Timeline, Track } from './motion';
const el = (id: string) => document.getElementById(id)!;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
// Stream mode (`/?stream=1`, for an OBS browser source): the HUD is scaled up for a
// 1080p canvas watched on phones, the camera sits tighter on the yard, and the
// click-only controls are hidden because nobody can click through a stream.
// `scale` and `zoom` override the defaults, e.g. `/?stream=1&scale=1.9&zoom=1.5`.
const params = new URLSearchParams(location.search);
const streamMode = params.get('stream') === '1';
const uiScale = Math.max(0.5, Math.min(3, Number(params.get('scale')) || (streamMode ? 1.7 : 1)));
const baseZoom = Math.max(0.7, Math.min(2.2, Number(params.get('zoom')) || (streamMode ? 1.35 : 1)));
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
  renderer.domElement.setAttribute(
    'aria-label',
    'Live safehouse neighborhood. Drag to adjust view; scroll to zoom.',
  );
  el('world').append(renderer.domElement);
  const environment = buildEnvironment(scene),
    objects = createObjectsLayer(environment.world),
    person = buildPersonGroup(environment.world, newMaterialCache(), false);
  const combatView = createCombatView(environment.world);
  // Read-only handle for the browser smokes (counting dust motes, checking the camera).
  (window as unknown as { __safehouseScene?: THREE.Scene }).__safehouseScene = scene;
  const workLight = new THREE.PointLight(0xffd9a0, 0, 13, 2);
  scene.add(workLight);
  const camera = new THREE.OrthographicCamera(-25, 25, 20, -20, 0.1, 150);
  let yaw = 0.65,
    zoom = baseZoom,
    state: SafehouseScene | undefined,
    lastLighting: string | undefined,
    connected = false,
    receivedAt = 0,
    speechUntil = 0,
    offset = 0;
  // Movers are drawn a little behind the server and slid between snapshots (motion.ts). A
  // snapshot's other news waits in the inbox until the drawn clock reaches it.
  type StateMsg = Extract<ServerMsg, { t: 'state' }>;
  const timeline = new Timeline(),
    rook = new Track(),
    inbox: { at: number; msg: StateMsg }[] = [];
  let lastMessageAt = 0;
  person.group.position.set(SURVIVOR_START.x, 0.13, SURVIVOR_START.z);
  function resize() {
    const a = innerWidth / innerHeight,
      s = (a < 1 ? 26 : 20) / zoom;
    camera.left = -s * a;
    camera.right = s * a;
    camera.top = s;
    camera.bottom = -s;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  }
  addEventListener('resize', resize);
  resize();
  let autoCamera = true,
    selected = '',
    revealUntil = 0,
    revealTarget: GroundPoint | undefined;
  let focus = new THREE.Vector3(0, 0, -5),
    priorRevision = -1,
    frameAt = 0;
  const select = el('creations') as HTMLSelectElement;
  const ray = new THREE.Raycaster();
  // Rook's speech bubble: an HTML element pinned each frame to his head, so it
  // walks with him. Clamped to the viewport with the tail still pointing at him.
  const bubble = el('speech');
  let speechText = '';
  const headPoint = new THREE.Vector3();
  function placeBubble() {
    headPoint
      .set(person.group.position.x, person.group.position.y + 1.95, person.group.position.z)
      .project(camera);
    const rx = ((headPoint.x + 1) / 2) * innerWidth,
      ry = ((1 - headPoint.y) / 2) * innerHeight,
      w = bubble.offsetWidth,
      h = bubble.offsetHeight,
      margin = 10,
      tail = 9 * uiScale;
    const left = Math.max(margin, Math.min(innerWidth - w - margin, rx - w / 2));
    const top = Math.max(margin, Math.min(innerHeight - h - margin, ry - h - tail));
    bubble.style.left = `${left}px`;
    bubble.style.top = `${top}px`;
    bubble.style.setProperty('--tail', `${Math.max(16, Math.min(w - 16, rx - left))}px`);
  }
  function showSpeech(text: string) {
    if (text === speechText) return;
    speechText = text;
    bubble.textContent = text;
    bubble.classList.toggle('long', text.length > 90);
    bubble.hidden = false;
    placeBubble();
    if (!reduced) {
      bubble.classList.remove('pop');
      void bubble.offsetWidth; // restart the pop animation for a new line
      bubble.classList.add('pop');
    }
  }
  function hideSpeech() {
    speechText = '';
    bubble.hidden = true;
  }
  function inspect(id: string) {
    selected = id;
    select.value = id;
    const object = [...(state?.objects ?? []), ...(state?.combat?.archive ?? [])].find((o) => o.id === id);
    el('inspect').hidden = !object;
    if (!object) return;
    el('inspect-name').textContent = object.blueprint.name;
    const ref = `#${shortRef(object.id)}`,
      ruined = object.destroyedAt !== undefined,
      hurt = (object.health ?? 80) < (object.maxHealth ?? 80);
    el('inspect-detail').textContent =
      `${ref} · ${object.passable ? 'ground' : object.creature ? `living · ${object.creature.behaviour}${object.creature.flying ? ' · flying' : ''}` : (object.role ?? 'decoration')} · ${ruined ? 'Destroyed' : `${Math.round(object.health ?? 80)}/${object.maxHealth ?? 80} health`} · ${object.fixed ? 'Part of the neighborhood' : `Created by ${object.createdBy}`} · Last edited by ${object.editedBy}`;
    // Chat says names, not hashes: any part of the name works ("the truck"); the #reference is the fallback.
    const name = /^rook'?s\b/i.test(object.blueprint.name)
      ? object.blueprint.name
      : `the ${object.blueprint.name.toLowerCase()}`;
    el('inspect-example').textContent = ruined
      ? `Try: “Rebuild ${name}”.`
      : object.passable
        ? `Try: “Paint ${name} brown”.`
        : hurt
          ? `Try: “Repair ${name}”, “Move ${name} next to the house” or “Paint ${name} red”.`
          : `Try: “Move ${name} to the front”, “Turn ${name} around” or “Paint ${name} red”.`;
  }
  select.onchange = () => inspect(select.value);
  el('inspect-close').onclick = () => inspect('');
  function follow(value: boolean) {
    autoCamera = value;
    el('follow').textContent = value ? 'Following activity' : 'Follow activity';
    el('follow').setAttribute('aria-pressed', String(value));
  }
  el('follow').onclick = () => follow(true);
  let drag: { x: number; y: number; yaw: number; moved: boolean; touch: boolean } | undefined;
  renderer.domElement.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, yaw, moved: false, touch: e.pointerType === 'touch' };
    renderer.domElement.setPointerCapture(e.pointerId);
  });
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (drag && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 5) {
      drag.moved = true;
      if (!drag.touch) {
        follow(false);
        yaw = Math.max(0.3, Math.min(1, drag.yaw + (e.clientX - drag.x) * 0.002));
      }
    }
  });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (drag && !drag.moved) {
      ray.setFromCamera(
        new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, (-e.clientY / innerHeight) * 2 + 1),
        camera,
      );
      const hit = ray.intersectObject(objects.root, true).find((h) => h.object.userData.objectId);
      const hitObject = hit && state?.objects.find((o) => o.id === hit.object.userData.objectId);
      // Floors are ground: clicking one marks a spot rather than selecting the slab.
      if (hitObject && !hitObject.passable) inspect(hitObject.id);
      else {
        const point = hit ? hit.point.clone() : new THREE.Vector3();
        if (hit || ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), point)) {
          selected = '';
          select.value = '';
          el('inspect').hidden = false;
          el('inspect-name').textContent = hitObject
            ? `Ground mark on ${hitObject.blueprint.name}`
            : 'Ground mark';
          el('inspect-detail').textContent =
            `x ${point.x.toFixed(1)}, z ${point.z.toFixed(1)}${hitObject ? ` · surface #${shortRef(hitObject.id)}` : ''}`;
          el('inspect-example').textContent =
            `Add “at ${point.x.toFixed(1)},${point.z.toFixed(1)}” to a build request, or “Move <name> to ${point.x.toFixed(1)},${point.z.toFixed(1)}”. Placement is checked before work starts.`;
        }
      }
    }
    drag = undefined;
  });
  renderer.domElement.addEventListener('pointercancel', () => {
    drag = undefined;
  });
  renderer.domElement.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      follow(false);
      zoom = Math.max(0.7, Math.min(2.2, zoom - e.deltaY * 0.0006));
      resize();
    },
    { passive: false },
  );
  function hud(s: SafehouseScene) {
    el('fixture').hidden = !s.fixture;
    if (priorRevision !== s.worldRevision) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'Choose something';
      select.replaceChildren(option);
      const groups: [string, typeof s.objects][] = [
        ['Community creations', s.objects.filter((o) => !o.fixed)],
        ['Ruins (rebuildable)', s.combat?.archive ?? []],
        ['Neighborhood', s.objects.filter((o) => o.fixed)],
      ];
      for (const [label, list] of groups) {
        if (!list.length) continue;
        const group = document.createElement('optgroup');
        group.label = label;
        for (const object of list) {
          const opt = document.createElement('option');
          opt.value = object.id;
          opt.textContent = `${object.blueprint.name} #${shortRef(object.id)}`;
          group.append(opt);
        }
        select.append(group);
      }
      inspect(selected);
      priorRevision = s.worldRevision;
    }
    el('phase').textContent =
      s.generationPaused || (!s.fixture && s.allowanceEnforced && s.callsRemaining === 0)
        ? 'AI PAUSED · SIMPLE EDITS AVAILABLE'
        : s.current
          ? s.current.status.toUpperCase()
          : s.generationAvailable
            ? 'READY FOR YOUR NEXT IDEA'
            : 'AI OFFLINE';
    el('label').textContent = s.current?.label ?? s.notice;
    el('author').textContent = s.current
      ? s.current.requestedBy === 'Rook'
        ? 'Rook, fixing zombie damage on his own'
        : `Suggested by ${s.current.requestedBy}`
      : `${s.objects.filter((o) => !o.fixed).length} community creations · ${s.objects.filter((o) => o.fixed).length} neighborhood pieces, all movable`;
    el('next').textContent = s.pending.length
      ? `NEXT: ${s.pending[0].label} · ${s.pending.length} waiting`
      : s.current
        ? 'Click empty ground to mark a build location.'
        : 'Try: “Build a turret in the front yard” or “Move the barricade next to the house.”';
    el('progress').hidden = s.current?.status !== 'building';
    el('bar').style.width = `${Math.max(0, Math.min(1, s.current?.progress ?? 0)) * 100}%`;
    const w = s.combat?.wave;
    el('wave').hidden = !w || !!s.combat?.paused; // a paused clock is not worth a badge
    if (w) {
      el('wave').classList.toggle('live', w.phase === 'wave');
      el('wave-title').textContent = `WAVE ${w.number}`;
      el('wave-record').textContent = w.best
        ? `record: wave ${w.best}${w.fell ? ` · the house fell on ${w.fell}` : ''}`
        : w.fell
          ? `the house fell on wave ${w.fell}`
          : 'first run';
    }
    waveDetail();
  }
  const clock = (ms: number) => {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  // The prep countdown runs locally between snapshots; combat time stands still while paused.
  let lastWaveDetail = '',
    lastDetailAt = 0;
  function waveDetail() {
    const c = state?.combat,
      w = c?.wave;
    if (!c || !w) return;
    const elapsed = c.paused ? 0 : Math.max(0, Date.now() - receivedAt);
    const left = w.phaseEndsAt - c.time - elapsed;
    const text = c.paused
      ? w.phase === 'prep'
        ? `zombies paused · next: ${state!.upcomingWave ?? ''}`
        : 'paused mid-wave'
      : w.phase === 'prep'
        ? `incoming in ${clock(left)} · ${state!.upcomingWave ?? ''}`
        : `${c.zombies.length} here${w.queue.length ? ` · ${w.queue.length} coming` : ''} · ${w.killed} down`;
    if (text !== lastWaveDetail) {
      lastWaveDetail = text;
      el('wave-detail').textContent = text;
    }
  }
  /** Everything in a snapshot besides where the movers are: the drawn world has just reached it. */
  function apply(msg: StateMsg) {
    const next = msg.scene.safehouse;
    if (!next) return;
    receivedAt = Date.now();
    if (state?.current?.preview && !next.current?.preview && next.worldRevision > state.worldRevision) {
      revealTarget = state.current.preview.position;
      revealUntil = performance.now() + 5000;
    }
    state = next;
    objects.syncCommitted(next.objects);
    combatView.sync(next.combat, next.objects);
    objects.syncPreview(next.current);
    if (lastLighting !== next.lighting) {
      environment.setLighting(next.lighting === 'night');
      lastLighting = next.lighting;
    }
    hud(next);
    el('connection').textContent =
      `Connected · ${next.combat?.paused ? 'zombies paused' : `${next.combat?.zombies.length ?? 0} zombies`} · ${next.combat?.kills ?? 0} defeated${next.repairsPaused ? ' · repairs paused' : ''}`;
    const speech = msg.scene.speech;
    speechUntil = speech?.until ?? 0;
    if (speech) showSpeech(speech.text);
    else hideSpeech();
  }
  /** Snapshots whose moment has come, oldest first. A long backlog (a hidden tab) collapses to its newest few: each apply is a full reconcile. */
  function drain(now: number) {
    let due = 0;
    while (due < inbox.length && inbox[due].at <= now) due++;
    if (!due) return;
    for (const { msg } of inbox.splice(0, due).slice(-3)) {
      try {
        apply(msg);
      } catch (error) {
        console.error('Invalid safehouse snapshot', error);
        el('connection').textContent = 'Could not read world update';
      }
    }
  }
  let socket: WebSocket | undefined,
    retry: ReturnType<typeof setTimeout> | undefined,
    closing = false;
  function connect() {
    if (closing) return;
    socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`);
    socket.onopen = () => {
      connected = true;
      el('connection').textContent = 'Connected · waiting for world';
    };
    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as ServerMsg;
        if (msg.t === 'hello') {
          offset = msg.serverTime - Date.now();
          if (msg.worldId !== 'safehouse') {
            el('error').hidden = false;
            el('error').textContent =
              'This server is running another world. Start with npm run start:safehouse.';
          }
          return;
        }
        if (!msg.scene.safehouse) return;
        const next = msg.scene.safehouse,
          now = performance.now();
        lastMessageAt = Date.now();
        // Movers are sampled the moment a snapshot lands, so there is always a next spot to slide
        // toward; everything else in it is applied when the drawn clock gets there.
        timeline.observe(msg.serverTime, now);
        rook.sample({
          t: msg.serverTime,
          x: next.survivor.position.x,
          y: 0,
          z: next.survivor.position.z,
          facing: next.survivor.facing,
          tag: next.survivor.activity,
        });
        objects.sample(next.objects, msg.serverTime);
        combatView.sample(next.combat, msg.serverTime);
        // The first snapshot shows at once; with reduced motion the newest snapshot is drawn, so nothing waits.
        if (!state || reduced) apply(msg);
        else inbox.push({ at: timeline.applyAt(msg.serverTime), msg });
      } catch (error) {
        console.error('Invalid safehouse snapshot', error);
        el('connection').textContent = 'Could not read world update';
      }
    };
    socket.onclose = () => {
      connected = false;
      el('connection').textContent = 'Disconnected · reconnecting';
      if (!closing) retry = setTimeout(connect, 1500);
    };
    socket.onerror = () => socket?.close();
  }
  connect();
  let frame = 0;
  function draw(now: number) {
    frame = requestAnimationFrame(draw);
    if (document.hidden) return;
    const dt = frameAt ? Math.min((now - frameAt) / 1000, 0.1) : 0;
    frameAt = now;
    timeline.tick(dt * 1000);
    drain(now);
    const renderTime = reduced ? Infinity : timeline.renderTime(now);
    const pose = rook.at(renderTime);
    if (pose) {
      person.group.position.x = pose.x;
      person.group.position.z = pose.z;
      person.group.rotation.y = pose.facing;
    }
    if (state) {
      const live = connected && Date.now() - receivedAt < 6000;
      // What he is doing comes with the stretch being drawn, so the hammer starts when he is seen to arrive.
      const activity = pose?.tag ?? state.survivor.activity;
      const walking = live && !!pose?.moving;
      const repairing = live && !walking && activity === 'repairing';
      const working = repairing || (live && !walking && activity === 'building');
      // Building is a steady tap; repairs are quicker, harder hammer blows.
      person.rightArm.rotation.x = !working || reduced
        ? -0.2
        : repairing
          ? -0.4 + Math.sin(now * 0.011) * 0.7
          : -0.6 + Math.sin(now * 0.007) * 0.55;
      person.leftArm.rotation.x = walking && !reduced ? Math.sin(now * 0.007) * 0.25 : -0.2;
      person.group.position.y = 0.13 + (walking && !reduced ? Math.sin(now * 0.012) * 0.025 : 0);
    }
    workLight.position.set(person.group.position.x, 3.5, person.group.position.z);
    workLight.intensity = state?.lighting === 'night' ? 18 : 0;
    if (autoCamera) {
      const target = state?.current?.preview?.position ?? (now < revealUntil ? revealTarget : undefined);
      // Work near the house keeps the yard half in frame; work out on the far lots is framed outright.
      const frameX = (x: number) => (Math.abs(x) <= 14 ? x * 0.5 : x - Math.sign(x) * 7);
      const desired = target
        ? new THREE.Vector3(frameX(target.x), 0, target.z * 0.6 - 1.6)
        : new THREE.Vector3(0, 0, -5);
      if (reduced) focus.copy(desired);
      else focus.lerp(desired, 1 - Math.exp(-dt * 0.8));
      const desiredZoom = target ? baseZoom * 1.2 : baseZoom;
      zoom = reduced ? desiredZoom : zoom + (desiredZoom - zoom) * (1 - Math.exp(-dt * 0.8));
      const a = innerWidth / innerHeight,
        s = (a < 1 ? 26 : 20) / zoom;
      camera.left = -s * a;
      camera.right = s * a;
      camera.top = s;
      camera.bottom = -s;
      camera.updateProjectionMatrix();
    }
    // A slow ambient pan so a quiet scene still moves: a gentle yaw drift, and a long glide along
    // the street (about a minute end to end) that takes the idle shot out over the shop and the
    // park and back. Nearly still while work is being framed; off once the viewer takes the camera
    // and for reduced motion.
    const ambient = autoCamera && !reduced;
    const framing = !!(state?.current?.preview || now < revealUntil);
    const drift = ambient ? Math.sin(now * 0.00017) * 0.13 : 0;
    const sway = ambient ? Math.sin(now * 0.00011) * (framing ? 1.6 : 14) : 0;
    const look = new THREE.Vector3(focus.x + sway, focus.y, focus.z);
    camera.position.set(look.x + Math.sin(yaw + drift) * 43, 36, look.z + Math.cos(yaw + drift) * 43);
    camera.lookAt(look);
    environment.update(now / 1000, reduced);
    combatView.update(now, dt, reduced, state?.combat?.paused ?? true, renderTime);
    objects.update(now, reduced, renderTime);
    renderer.render(scene, camera);
    if (!bubble.hidden) placeBubble(); // after render: the camera matrices are fresh
    if (now - lastDetailAt > 250) {
      lastDetailAt = now;
      waveDetail();
    }
    if (speechUntil && Date.now() + offset - timeline.lag > speechUntil) hideSpeech(); // the bubble lives as long as it would on the server
    if (connected && lastMessageAt && Date.now() - lastMessageAt > 10000)
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
      renderer.dispose();
    },
    { once: true },
  );
}
try {
  start();
} catch (error) {
  el('error').hidden = false;
  el('error').textContent =
    'The 3D view could not start. Enable browser hardware acceleration and reload. ' + String(error);
  console.error(error);
}
