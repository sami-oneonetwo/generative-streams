import type { SceneProtagonist } from '../../../src/shared/sceneTypes';
import { P, rect as r, line, poly } from './pixelArt';
import { drawServerDamage } from './serverDamage';

function strayHair(g: CanvasRenderingContext2D, mess: number): void {
  if (mess >= 1) poly(g, [[-5,-64],[-7,-71],[-2,-68],[1,-65]], P.ink);
  if (mess >= 2) {
    poly(g, [[-2,-67],[-2,-74],[2,-71],[4,-65]], P.ink);
    line(g, -2, -70, 0, -68, P.blue);
  }
  if (mess >= 3) {
    poly(g, [[1,-67],[4,-75],[5,-71],[10,-72],[7,-65]], P.ink);
    poly(g, [[-5,-63],[-10,-67],[-8,-62],[-5,-60]], P.ink);
    line(g, 4, -71, 3, -68, P.slate);
  }
  if (mess >= 4) {
    poly(g, [[6,-65],[12,-71],[11,-66],[15,-64],[8,-61]], P.ink);
    poly(g, [[-5,-66],[-9,-75],[-4,-72],[-1,-66]], P.ink);
    line(g, -6, -71, -4, -68, P.blue);
    line(g, 9, -67, 7, -65, P.blue);
  }
}

const headImages = new Map<string, HTMLCanvasElement>();
function seatedHead(rim: string, blink: boolean, mess: number): HTMLCanvasElement {
  const key = `${rim}:${blink}:${mess}`;
  let image = headImages.get(key);
  if (!image) {
    image = document.createElement('canvas');
    image.width = 32; image.height = 38;
    const g = image.getContext('2d')!;
    g.translate(14, 80);
    // Face seen in profile toward the monitor; cheek catches cool screen light.
    poly(g, [[-4,-64],[5,-65],[9,-60],[9,-54],[12,-52],[9,-51],[8,-47],[1,-47],[-4,-53]], P.woodLight);
    r(g, 1, -60, 7, 8, P.amber);
    r(g, 5, -59, 3, 7, rim);
    r(g, 7, -54, 4, 2, P.amber);
    r(g, 8, -51, 2, 1, P.woodDark);
    r(g, 2, -49, 5, 4, P.woodLight);
    // Tousled hair and over-ear headphones, not a faceless hood.
    poly(g, [[-6,-62],[-4,-67],[2,-68],[3,-66],[7,-66],[10,-62],[8,-59],[2,-60],[0,-55],[-4,-54],[-6,-57]], P.ink);
    strayHair(g, mess);
    r(g, -3, -64, 6, 2, P.blue); r(g, 4, -63, 3, 1, P.slate);
    r(g, -3, -60, 3, 7, P.shadow); r(g, -2, -60, 2, 5, P.slate);
    r(g, -1, -58, 1, 3, P.rose);
    line(g, -2, -61, 0, -65, P.slate); r(g, 0, -65, 5, 1, P.slate);
    r(g, 7, -57, 2, 1, blink ? P.woodLight : P.ink);
    line(g, 0, -53, 5, -52, P.shadow);
    headImages.set(key, image);
  }
  return image;
}

// Original sprite proportions and stepped silhouettes, drawn in native pixels.
export function drawRoomProtagonist(g: CanvasRenderingContext2D, p: SceneProtagonist, x: number, now: number, lookUp = 0, damageNow = now, mess = 0): void {
  g.save();
  g.scale(4, 4);
  g.translate(Math.round(x / 4), Math.round(p.y / 4));
  const seated = p.pose === 'console' && p.state !== 'walking';
  const rim = p.rim ?? P.cyan;
  const blink = Math.floor(now / 160) % 37 === 0;
  const typing = seated && lookUp > 0.2 ? 0 : Math.floor(now / 110) % 4;
  if (seated) {
    // Bent jeans and worn sneakers extend from the seat toward the desk.
    poly(g, [[-5,-23],[6,-23],[14,-17],[13,-5],[9,-3],[7,-17],[-5,-14]], P.blue);
    line(g, 2, -20, 11, -18, P.slate);
    poly(g, [[-9,-22],[1,-22],[7,-16],[4,-3],[0,-2],[-1,-14],[-10,-15]], P.shadow);
    r(g, 0, -4, 7, 3, P.ink); r(g, 1, -2, 8, 1, P.steel);
    r(g, 9, -5, 7, 3, P.ink); r(g, 10, -3, 8, 1, P.steel);
    // Burgundy overshirt, with a pale t-shirt just visible in profile.
    poly(g, [[-11,-50],[-3,-54],[5,-51],[7,-44],[4,-29],[7,-24],[2,-20],[-13,-22],[-15,-33]], P.ink);
    poly(g, [[-10,-48],[-3,-51],[3,-49],[4,-41],[1,-31],[3,-25],[-10,-24],[-12,-34]], P.plum);
    poly(g, [[-9,-48],[-4,-49],[-6,-38],[-5,-27],[-10,-26],[-12,-34]], P.mauve);
    r(g, -10, -46, 2, 7, P.rose);
    poly(g, [[1,-48],[4,-47],[5,-34],[2,-30]], P.steel);
    line(g, -8, -30, -3, -28, P.woodDark);
    // Lift the chin toward the upper-right chat TV, pivoting at the neck.
    r(g, 2, -51, 5, 7, P.woodLight);
    g.save();
    g.translate(3, -47);
    g.rotate(-lookUp * 0.38);
    g.translate(-3, 47 - Math.round(lookUp * 2));
    g.imageSmoothingEnabled = false;
    g.drawImage(seatedHead(rim, blink, mess), -14, -80);
    g.restore();
    // Sleeve reaches forward; two frames of fingers touch the keyboard.
    poly(g, [[0,-44],[5,-43],[10,-33],[18,-31],[17,-27],[7,-28],[2,-34]], P.mauve);
    line(g, 4, -42, 10, -34, P.rose);
    r(g, 15, -31, 5, 3, P.woodLight);
    r(g, 18, -30 - (typing === 1 ? 1 : 0), 5, 2, P.amber);
    r(g, 21, -30 - (typing === 1 ? 1 : 0), 1, 1, rim);
    line(g, -6, -43, -4, -33, P.woodDark);
  } else {
    // 100ms a frame is matched to the 340px/s walk in the world's layout: four
    // frames = 400ms = ~136px of travel, the same stride length the old
    // 140ms/240px-per-sec gait had. Change one and the other has to move, or he
    // either skates or minces.
    const step = p.state === 'walking' ? [0, 3, 0, -3][Math.floor(now / 100) % 4] : 0;
    const facingLeft = p.walk ? p.walk.toX < p.walk.fromX : !!p.service && p.service.targetX < x;
    if (facingLeft) g.scale(-1, 1);
    r(g, -9, -1, 24, 2, P.woodDark);
    poly(g, [[-7,-28],[0,-28],[-1 + step,-4],[-6 + step,-3]], P.shadow);
    poly(g, [[0,-28],[7,-28],[7 - step,-4],[2 - step,-3]], P.blue);
    line(g, 3, -25, 5 - step, -6, P.slate);
    r(g, -7 + step, -4, 8, 3, P.ink); r(g, -7 + step, -1, 9, 1, P.steel);
    r(g, 2 - step, -4, 9, 3, P.ink); r(g, 2 - step, -1, 10, 1, P.steel);
    poly(g, [[-8,-52],[-3,-55],[5,-54],[10,-48],[8,-27],[-9,-27],[-11,-44]], P.plum);
    poly(g, [[-7,-51],[-3,-53],[-5,-31],[-9,-30],[-10,-44]], P.mauve);
    r(g, 3, -50, 3, 18, P.steel); r(g, -8, -48, 2, 5, P.rose);
    const servicing = p.service && p.state === 'working';
    const carrying = p.service?.carrying;
    const reach = servicing ? 14 : p.state === 'working' ? 9 : step;
    const handY = servicing && !carrying
      ? Math.max(-68, Math.min(-22, (p.service!.targetY - p.y) / 4))
      : -34;
    poly(g, [[6,-48],[10,-45],[10+reach,handY],[6+reach,handY+2],[4,-41]], P.mauve);
    r(g, 7 + reach, handY, 4, 5, P.amber);
    r(g, -9 - step, -34, 3, 5, P.woodLight);
    if (carrying) {
      // Both hands support a full-width chassis; the dead one trails smoke
      // as he carries it away, the replacement has a clean unlit front panel.
      const insert = servicing && p.service?.action === 'install' ? p.service.progress : 0;
      const unitX = 2 + Math.round(insert * 8);
      const unitY = -32 + Math.round(insert * (Math.max(-62, Math.min(-24, (p.service!.targetY - p.y) / 4)) + 32));
      r(g, unitX - 1, unitY - 2, 29, 11, P.ink);
      r(g, unitX, unitY - 1, 27, 8, carrying === 'damaged' ? P.woodDark : P.slate);
      r(g, unitX, unitY - 1, 27, 1, carrying === 'damaged' ? P.wood : P.steel);
      for (let i = 0; i < 6; i++) r(g, unitX + 3 + i * 3, unitY + 2, 2, 3, P.ink);
      r(g, unitX + 23, unitY + 2, 2, 2, carrying === 'damaged' ? P.red : P.shadow);
      line(g, -7, -43, unitX + 3, unitY + 8, P.mauve);
      r(g, unitX + 2, unitY + 6, 5, 3, P.amber);
      r(g, unitX + 22, unitY + 6, 5, 3, P.woodLight);
      if (carrying === 'damaged') drawServerDamage(g, unitX + 14, unitY - 1, damageNow, 17, false);
    }
    poly(g, [[-4,-65],[6,-66],[9,-61],[8,-56],[11,-54],[8,-52],[2,-51],[-4,-56]], P.woodLight);
    r(g, 1, -62, 7, 8, P.amber); r(g, 6, -61, 2, 6, rim);
    poly(g, [[-6,-61],[-4,-68],[2,-70],[4,-68],[8,-67],[10,-63],[6,-61],[0,-62],[-1,-56],[-5,-56]], P.ink);
    strayHair(g, mess);
    r(g, -3, -66, 6, 2, P.blue);
    r(g, -2, -61, 3, 6, P.slate); r(g, -1, -59, 1, 3, P.rose);
    r(g, 7, -59, 2, 1, blink ? P.woodLight : P.ink);
    r(g, 1, -53, 5, 2, P.woodLight);
  }
  g.restore();
}
