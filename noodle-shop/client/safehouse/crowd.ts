// The audience in the picture: whoever has spoken in chat lately stands on the pavement across
// the street as a small figure (crowd.ts on the server decides who and where). Forty people cost
// four draw calls — legs, torso, head and a raised arm are each one InstancedMesh — and each
// figure slides between snapshots on its own Track like everyone else. The arm shows only while
// someone is waving (a couple of seconds after they speak); a name tag shows only while they are
// recent or watching their own build, because forty tags along a 1.3 m row would be one smear at
// the stream distance.
//
// Chat verbs (verbs.ts on the server) send a figure off the pavement: `!shoot` jogs them to a hoop
// (`errand`), where they hold the ball up until the server calls the shot (`shot`), and the one
// shared ball flies from the hand to the rim — through it on a hit, off the side on a miss — with a
// SWISH! or MISS pop over the head. `!dance` bounces them where they stand (`dancingUntil`).
//
// Verbs as data: a piece may carry its own verb (`!swim` at the pond, `!bounce` on a trampoline), and
// the errand then says which pose to hold there (`errand.pose`, one of VERB_POSES) and how high to
// stand (`errand.y`: the water, the mat). The poses are drawn here on the same five instanced meshes —
// legs, torso, head and two hinged arms — lying the whole figure flat for swim and lie, hopping for
// jump, lowering for sit, arms up for wave and cheer, jabbing for punch. The word pops over the head
// (`pop`) when they get there.
import * as THREE from 'three';
import type { CrowdView, GroundPoint, VerbPose } from './types';
import { Track } from './motion';

const CAPACITY = 40; // MAX_CROWD on the server
const WAVE_MS = 2200; // how long the arm stays up after a message
const TAG_MS = 20_000; // how long the name shows after a message
// The shot: the ball leaves the hand when the server calls it, reaches the rim after FLIGHT, then
// drops through (a hit) or bounces off the side (a miss) for LAND; the pop shows from the landing.
const FLIGHT = 1100,
  LAND = 600,
  POP_MS = 3000,
  VERB_POP_MS = 4000, // a verb's word (SPLASH, BOING) over the head on arrival (the server's popShownMs matches)
  LIFT_RATE = 10, // how fast the figure eases up onto a piece (about 0.3 s)
  HORIZONTAL_CENTRE = 0.75, // a lying figure is centred on its position rather than rooted at the feet
  HORIZONTAL_LIFT = 0.2, // half a body's thickness, so a swimmer sits in the water rather than under it
  RIM_HEIGHT = 2.7,
  ARC = 1.2,
  RELEASE = 180; // the arm snaps forward this long after the release
// The moving verbs get their own tag word ("dave · driving"); every other verb just shows the name.
const GERUND: Record<string, string> = { drive: 'driving', ride: 'riding', fight: 'fighting' };
// Muted shirts so the row reads as people, not as a row of markers; chosen by a hash of the name.
const SHIRTS = [0x7a6a5a, 0x5d6f7a, 0x6f7a5d, 0x7a5d6a, 0x8a7a55, 0x556a7a, 0x6a5d7a, 0x7a7a6a];
const SKIN = 0xbb9b79,
  TROUSERS = 0x4c5058;

interface Part {
  inst: THREE.InstancedMesh;
  y: number; // centre height above the feet
  w: number;
  h: number;
  d: number;
}
interface Member {
  view: CrowdView;
  track: Track;
  tag: HTMLElement;
  pop?: HTMLElement; // SWISH! / MISS, made the first time they shoot
  tint: THREE.Color;
  phase: number;
  /** Where the hoop they are shooting at stands (from the objects the layer is given), when known. */
  target?: GroundPoint;
  /** The shot the page has already launched a ball for, so a snapshot repeating `shot` does not throw twice. */
  launchedAt?: number;
  /** How high the figure currently stands (eased toward the errand's `y`), metres. */
  lift: number;
}
/** The one ball in flight (whoever is shooting): from the hand to the rim, then through or off. */
interface Flight {
  start: THREE.Vector3;
  end: THREE.Vector3;
  dir: THREE.Vector3;
  hit: boolean;
  at: number; // server time of the release
}

const hashOf = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};
const headPoint = new THREE.Vector3();
const side = new THREE.Vector3();

export function createCrowdLayer(parent: THREE.Object3D, overlay: HTMLElement) {
  const members = new Map<string, Member>();
  let order: Member[] = []; // instance index = position here; rebuilt on sync
  let lookup: (id: string) => GroundPoint | undefined = () => undefined;
  let ball: THREE.Mesh | undefined;
  let flight: Flight | undefined;

  function instanced(w: number, h: number, d: number, translateY = 0): THREE.InstancedMesh {
    const geometry = new THREE.BoxGeometry(w, h, d);
    if (translateY) geometry.translate(0, translateY, 0);
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
    const inst = new THREE.InstancedMesh(geometry, material, CAPACITY);
    inst.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 3), 3);
    inst.castShadow = true;
    inst.receiveShadow = true;
    inst.frustumCulled = false; // instances span the whole pavement; the geometry's own sphere would cull them
    inst.count = 0;
    parent.add(inst);
    return inst;
  }
  const legs: Part = { inst: instanced(0.34, 0.55, 0.22), y: 0.3, w: 1, h: 1, d: 1 };
  const torso: Part = { inst: instanced(0.42, 0.55, 0.26), y: 0.95, w: 1, h: 1, d: 1 };
  const head: Part = { inst: instanced(0.28, 0.28, 0.28), y: 1.42, w: 1, h: 1, d: 1 };
  // The arms hang from their shoulders: the box is shifted so the pivot sits at its top. Two of them
  // (right and left) so cheering, swimming and punching read; five draw calls for the whole crowd.
  const arm = instanced(0.12, 0.5, 0.14, -0.25);
  const armL = instanced(0.12, 0.5, 0.14, -0.25);
  const parts = [legs, torso, head];
  let lastPoseAt = 0;

  const body = new THREE.Object3D(); // one figure's root: feet position + yaw + lean + sway
  body.rotation.order = 'YXZ'; // sway and lean happen in the figure's own frame, then the yaw
  const local = new THREE.Object3D(); // one part's offset from the feet
  const tmp = new THREE.Matrix4();
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  const skin = new THREE.Color(SKIN),
    trousers = new THREE.Color(TROUSERS);

  function build(view: CrowdView): Member {
    const tag = document.createElement('div');
    tag.className = 'tag viewer';
    tag.textContent = view.name;
    tag.hidden = true;
    overlay.append(tag);
    const h = hashOf(view.id || view.name);
    return {
      view,
      track: new Track(),
      tag,
      tint: new THREE.Color(SHIRTS[h % SHIRTS.length]),
      phase: (h % 628) / 100,
      lift: 0,
    };
  }
  function remove(id: string) {
    const m = members.get(id);
    if (!m) return;
    m.tag.remove();
    m.pop?.remove();
    members.delete(id);
  }
  function setColors() {
    for (let i = 0; i < order.length; i++) {
      legs.inst.setColorAt(i, trousers);
      torso.inst.setColorAt(i, order[i].tint);
      head.inst.setColorAt(i, skin);
      arm.setColorAt(i, order[i].tint);
      armL.setColorAt(i, order[i].tint);
    }
    for (const p of parts) if (p.inst.instanceColor) p.inst.instanceColor.needsUpdate = true;
    if (arm.instanceColor) arm.instanceColor.needsUpdate = true;
    if (armL.instanceColor) armL.instanceColor.needsUpdate = true;
  }
  /** The ball, made the first time anyone shoots. The browser smoke looks for `userData.crowdBall`. */
  function theBall(): THREE.Mesh {
    if (!ball) {
      ball = new THREE.Mesh(
        new THREE.SphereGeometry(0.12, 10, 8),
        new THREE.MeshStandardMaterial({ color: 0xc8722a, roughness: 0.9, transparent: true }),
      );
      ball.castShadow = false;
      ball.visible = false;
      ball.userData.crowdBall = true;
      ball.userData.ball = true;
      parent.add(ball);
    }
    return ball;
  }
  /** The server called a shot: launch the ball from this figure's hand toward the hoop. */
  function launch(m: Member, x: number, z: number, facing: number, shot: { hit: boolean; at: number }) {
    m.launchedAt = shot.at;
    const dir = new THREE.Vector3();
    if (m.target) dir.set(m.target.x - x, 0, m.target.z - z);
    if (dir.lengthSq() < 1e-6) dir.set(Math.sin(facing), 0, Math.cos(facing)); // no hoop known: straight ahead
    dir.normalize();
    const start = new THREE.Vector3(x + dir.x * 0.3, 1.6, z + dir.z * 0.3);
    const end = m.target ? new THREE.Vector3(m.target.x, RIM_HEIGHT, m.target.z) : start.clone().addScaledVector(dir, 3).setY(RIM_HEIGHT);
    flight = { start, end, dir, hit: shot.hit, at: shot.at };
    theBall();
  }
  /** Where the ball is at drawn server time `serverNow`: in the air, dropping through, or off the side. */
  function poseBall(serverNow: number, reduced: boolean) {
    if (!ball) return;
    if (!flight || reduced) {
      ball.visible = false;
      return;
    }
    const since = serverNow - flight.at;
    if (since < 0 || since > FLIGHT + LAND) {
      ball.visible = false;
      if (since > FLIGHT + LAND) flight = undefined;
      return;
    }
    const material = ball.material as THREE.MeshStandardMaterial;
    ball.visible = true;
    if (since <= FLIGHT) {
      const u = since / FLIGHT;
      ball.position.lerpVectors(flight.start, flight.end, u);
      ball.position.y += ARC * 4 * u * (1 - u);
      material.opacity = 1;
      return;
    }
    const v = (since - FLIGHT) / 1000; // seconds since the rim
    const k = (since - FLIGHT) / LAND;
    if (flight.hit) {
      // Through the net and straight down.
      ball.position.copy(flight.end);
      ball.position.y = Math.max(0.12, flight.end.y - 4.9 * v * v);
    } else {
      // Off the rim: on past it and to one side, falling.
      side.set(-flight.dir.z, 0, flight.dir.x).multiplyScalar(0.5 * k);
      ball.position.copy(flight.end).addScaledVector(flight.dir, 0.7 * k).add(side);
      ball.position.y = Math.max(0.12, flight.end.y + 0.4 * k - 4.9 * v * v);
    }
    material.opacity = 1 - k;
  }

  return {
    /** A snapshot just landed: note where everyone on the pavement is at that server time. */
    sample(list: CrowdView[], serverTime: number) {
      for (const v of list) {
        let m = members.get(v.id);
        if (!m) members.set(v.id, (m = build(v)));
        m.track.sample({ t: serverTime, x: v.position.x, y: 0, z: v.position.z, facing: v.facing });
      }
    },
    /** The drawn world has reached this snapshot: who is here, what they are doing, what they are called. `find` locates the piece an errand is about. */
    sync(list: CrowdView[], find?: (id: string) => GroundPoint | undefined) {
      if (find) lookup = find;
      const seen = new Set<string>();
      for (const v of list) {
        seen.add(v.id);
        let m = members.get(v.id);
        if (!m) members.set(v.id, (m = build(v)));
        m.view = v;
        // The tag says what they are up to on a run or a scrap ("dave · driving"), else just the name.
        const doing = v.errand?.phase === 'doing' ? GERUND[v.errand.word ?? ''] : undefined;
        const label = doing ? `${v.name} · ${doing}` : v.name;
        if (m.tag.textContent !== label) m.tag.textContent = label;
        if (v.errand) m.target = lookup(v.errand.targetId) ?? m.target;
      }
      for (const id of members.keys()) if (!seen.has(id)) remove(id);
      order = [...members.values()].slice(0, CAPACITY);
      setColors();
    },
    /** Per frame, before the render: place every figure at the drawn server time and give it a gait or a pose. */
    pose(now: number, reduced: boolean, renderTime: number, live: boolean, serverNow: number) {
      const dt = lastPoseAt ? Math.min(0.1, (now - lastPoseAt) / 1000) : 0;
      lastPoseAt = now;
      const ease = 1 - Math.exp(-dt * LIFT_RATE);
      const n = order.length;
      for (let i = 0; i < n; i++) {
        const m = order[i],
          v = m.view;
        const p = m.track.at(renderTime);
        const x = p?.x ?? v.position.x,
          z = p?.z ?? v.position.z,
          facing = p?.facing ?? v.facing;
        const errand = v.errand;
        const jogging = !!errand && errand.phase !== 'doing';
        // At the piece: a `shoot` errand holds the ball up; a `verb` errand holds the piece's pose.
        const shooting = !!errand && errand.kind !== 'verb' && errand.phase === 'doing';
        const verbing = !!errand && errand.kind === 'verb' && errand.phase === 'doing';
        const verbPose: VerbPose = verbing ? (errand!.pose ?? 'stand') : 'stand';
        const dancing = (v.dancingUntil ?? 0) > serverNow;
        // A driver or rider glides with the vehicle while seated: their position moves, but that is
        // not a walk, so no gait. Every other doing-pose is stationary anyway.
        const walking = live && !!p?.moving && !verbing,
          running = walking && (!!v.running || jogging);
        // A shot the server has called and the page has not thrown yet: the ball leaves the hand now.
        if (v.shot && v.shot.at !== m.launchedAt && serverNow >= v.shot.at && serverNow - v.shot.at < FLIGHT)
          launch(m, x, z, facing, v.shot);
        // Up onto the piece (a trampoline's mat, a pool's water) and back down, eased so it does not pop.
        const wantLift = verbing ? (errand!.y ?? 0) : 0;
        m.lift = reduced || dt === 0 ? wantLift : m.lift + (wantLift - m.lift) * ease;
        // Standing: a tiny sway so the row is never frozen. Walking: a bob. Running: faster, leaning in.
        // Dancing: a bounce twice a second and a slow yaw wobble.
        const sway = !reduced && !walking && !dancing && !verbing ? Math.sin(now * 0.0011 + m.phase) * 0.02 : 0;
        let bob = reduced ? 0 : running ? Math.abs(Math.sin(now * 0.018 + m.phase)) * 0.05 : walking ? Math.abs(Math.sin(now * 0.011 + m.phase)) * 0.03 : 0;
        let wobble = 0;
        if (dancing && !reduced) {
          bob = Math.abs(Math.sin(now * 0.00628 + m.phase)) * 0.06;
          wobble = Math.sin(now * 0.0025 + m.phase) * 0.15;
        }
        let lean = running && !reduced ? 0.18 : 0;
        // The verb poses. `pitch` lays the figure flat (swim, lie); `centre` then roots it at its
        // middle rather than its feet; `rise` is the pose's own height (a hop, a crouch); the arms are
        // per pose, `undefined` meaning hidden.
        let pitch = 0,
          centre = 0,
          rise = 0;
        let armR: number | undefined,
          armLeft: number | undefined;
        if (verbing) {
          switch (verbPose) {
            case 'swim': {
              // Flat in the water, arms stroking against each other, a slow bob.
              pitch = -Math.PI / 2;
              centre = HORIZONTAL_CENTRE;
              rise = HORIZONTAL_LIFT + (reduced ? 0 : Math.sin(now * 0.0025 + m.phase) * 0.03);
              const stroke = reduced ? 0 : Math.sin(now * 0.0094 + m.phase) * 0.9;
              armR = -1.6 + stroke;
              armLeft = -1.6 - stroke;
              break;
            }
            case 'lie':
              pitch = Math.PI / 2;
              centre = HORIZONTAL_CENTRE;
              rise = HORIZONTAL_LIFT;
              armR = 0;
              armLeft = 0;
              break;
            case 'jump': {
              // A half-metre hop every 0.9 s, arms up at the top of it.
              const t = reduced ? 0 : (((now / 900 + m.phase) % 1) + 1) % 1;
              const h = 4 * t * (1 - t);
              rise = 0.5 * h;
              armR = armLeft = reduced ? -2.6 : -0.4 - 2.2 * h;
              break;
            }
            case 'sit':
              rise = -0.42;
              armR = armLeft = -1.0;
              break;
            case 'wave':
              armR = reduced ? -2.7 : -2.7 + Math.sin(now * 0.0188 + m.phase) * 0.2;
              break;
            case 'cheer':
              armR = armLeft = -2.8;
              rise = reduced ? 0 : Math.abs(Math.sin(now * 0.00628 + m.phase)) * 0.06;
              break;
            case 'punch': {
              // A jab every 0.6 s: from the guard (-0.4) out to horizontal (-1.6) and back, with a small lunge.
              const t = reduced ? 0.25 : (((now / 600 + m.phase) % 1) + 1) % 1;
              const ext = Math.max(0, Math.sin(2 * Math.PI * t));
              armR = -0.4 - 1.2 * ext;
              armLeft = -1.4;
              lean += 0.1 * ext;
              break;
            }
            default:
              break; // stand: the idle figure, up on the piece
          }
        }
        body.position.set(x, m.lift + rise + bob, z);
        body.rotation.set(lean + pitch, facing + wobble, sway);
        body.updateMatrix();
        for (const part of parts) {
          local.position.set(0, part.y - centre, 0);
          local.rotation.set(0, 0, 0);
          local.scale.set(1, 1, 1);
          local.updateMatrix();
          tmp.multiplyMatrices(body.matrix, local.matrix);
          part.inst.setMatrixAt(i, tmp);
        }
        // The right arm: up for the wave a couple of seconds after they speak; holding the ball up while
        // they line the shot up, snapping forward on the release; swinging when they dance; the pose's
        // own angle at a piece. The left arm joins in for the dance and the two-armed poses.
        if (!verbing) {
          const since = serverNow - v.wavedAt;
          const released = v.shot ? serverNow - v.shot.at : Infinity;
          if (released >= 0 && released < RELEASE) armR = -2.4 + (1.8 * released) / RELEASE;
          else if (shooting) armR = reduced ? -2.4 : -2.4 + Math.sin(now * 0.004 + m.phase) * 0.08;
          else if (dancing) {
            const swing = reduced ? 0 : Math.sin(now * 0.01257 + m.phase) * 0.9;
            armR = reduced ? -2.4 : -1.5 + swing;
            armLeft = reduced ? -2.4 : -1.5 - swing;
          } else if (since >= 0 && since < WAVE_MS) armR = reduced ? -2.55 : -2.55 + Math.sin(now * 0.0188) * 0.35;
        }
        const place = (inst: THREE.InstancedMesh, side: number, angle: number | undefined) => {
          if (angle === undefined) {
            inst.setMatrixAt(i, zero);
            return;
          }
          local.position.set(side * 0.27, 1.2 - centre, 0);
          local.rotation.set(angle, 0, 0);
          local.scale.set(1, 1, 1);
          local.updateMatrix();
          tmp.multiplyMatrices(body.matrix, local.matrix);
          inst.setMatrixAt(i, tmp);
        };
        place(arm, 1, armR);
        place(armL, -1, armLeft);
      }
      for (const part of parts) {
        part.inst.count = n;
        part.inst.instanceMatrix.needsUpdate = true;
      }
      for (const inst of [arm, armL]) {
        inst.count = n;
        inst.instanceMatrix.needsUpdate = true;
      }
      poseBall(serverNow, reduced);
    },
    /** After the render: a name over the head while they are recent, watching their build or on an errand; the shot's pop for a moment after it lands. */
    overlay(camera: THREE.Camera, serverNow: number) {
      for (const m of order) {
        const v = m.view;
        const p = m.track.latest;
        const x = p?.x ?? v.position.x,
          z = p?.z ?? v.position.z;
        headPoint.set(x, 1.75, z).project(camera);
        const onScreen = headPoint.z < 1 && Math.abs(headPoint.x) < 0.98 && Math.abs(headPoint.y) < 0.98;
        const left = ((headPoint.x + 1) / 2) * innerWidth,
          top = ((1 - headPoint.y) / 2) * innerHeight;
        const recent = serverNow - v.wavedAt < TAG_MS || !!v.watching || !!v.errand;
        m.tag.hidden = !recent || !onScreen;
        if (!m.tag.hidden) {
          m.tag.style.left = `${left}px`;
          m.tag.style.top = `${top}px`;
        }
        // SWISH! or MISS, from the moment the ball reaches the rim, for a few seconds; or a verb's own
        // word (SPLASH, BOING) from the moment they get to the piece.
        const landed = v.shot ? serverNow - v.shot.at - FLIGHT : -1;
        const shotPop = landed >= 0 && landed < POP_MS;
        const said = v.pop ? serverNow - v.pop.at : -1;
        const verbPop = !shotPop && said >= 0 && said < VERB_POP_MS;
        if (shotPop || verbPop) {
          if (!m.pop) {
            m.pop = document.createElement('div');
            m.pop.hidden = true;
            overlay.append(m.pop);
          }
          const hit = v.shot?.hit;
          const cls = shotPop ? `tag pop ${hit ? 'hit' : 'miss'}` : 'tag pop verb';
          const text = shotPop ? (hit ? 'SWISH!' : 'MISS') : v.pop!.text;
          if (m.pop.className !== cls || m.pop.textContent !== text) {
            m.pop.className = cls;
            m.pop.textContent = text;
          }
          m.pop.hidden = !onScreen;
          m.pop.style.left = `${left}px`;
          m.pop.style.top = `${top - (m.tag.hidden ? 0 : m.tag.offsetHeight + 4)}px`;
        } else if (m.pop && !m.pop.hidden) m.pop.hidden = true;
      }
    },
    /** Read-only, for the browser smoke: a figure's instance index and its torso matrix (a lying figure's up axis is flat). */
    probe(name: string): { index: number; torso: number[] } | undefined {
      const index = order.findIndex((m) => m.view.name === name);
      if (index < 0) return undefined;
      torso.inst.getMatrixAt(index, tmp);
      return { index, torso: [...tmp.elements] };
    },
    dispose() {
      for (const id of [...members.keys()]) remove(id);
      order = [];
      for (const inst of [legs.inst, torso.inst, head.inst, arm, armL]) {
        inst.geometry.dispose();
        (inst.material as THREE.Material).dispose();
        parent.remove(inst);
      }
      if (ball) {
        ball.geometry.dispose();
        (ball.material as THREE.Material).dispose();
        parent.remove(ball);
        ball = undefined;
      }
    },
  };
}
