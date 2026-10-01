import { Quaternion, Vector3 } from 'three';
import {
  BALL_R,
  FLOOR_COL_T,
  FLOOR_VIS_T,
  LEVEL_H,
  NARROW_W,
  TILE,
  WALL_H,
  WALL_T,
} from '../config';
import { mulberry32, range } from '../core/rng';
import type {
  BoostZone,
  BoxPart,
  CylPart,
  Decor,
  HoleLayout,
  HoleSpec,
  Mover,
  Part,
  PhysMat,
  Tile,
  VisualKind,
} from './types';

const HALF = TILE / 2;
const INNER = TILE - 2 * WALL_T;
const WALL_BOTTOM = 0;
const FLOOR_EXT = BALL_R * 1.5;
const Y_AXIS = new Vector3(0, 1, 0);
const Z_AXIS = new Vector3(0, 0, 1);

/** A tile's local frame: +Z is the travel direction, +Y is the floor normal, origin at floor centre. */
class Frame {
  readonly origin: Vector3;
  readonly quat: Quaternion;
  /** Floor length along local Z (longer than TILE on ramps). */
  readonly length: number;

  constructor(t: Tile) {
    const slope = Math.atan2(t.rampDelta * LEVEL_H, TILE);
    this.length = Math.hypot(TILE, t.rampDelta * LEVEL_H);
    this.origin = new Vector3(t.i * TILE, (t.level + t.rampDelta / 2) * LEVEL_H, t.j * TILE);
    const yaw = new Quaternion().setFromAxisAngle(Y_AXIS, (t.dir * Math.PI) / 2);
    const pitch = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -slope);
    this.quat = yaw.multiply(pitch);
  }

  point(x: number, y: number, z: number, out = new Vector3()): Vector3 {
    return out.set(x, y, z).applyQuaternion(this.quat).add(this.origin);
  }

  rot(local?: Quaternion, out = new Quaternion()): Quaternion {
    out.copy(this.quat);
    return local ? out.multiply(local) : out;
  }
}

interface BoxOpts {
  collide?: boolean;
  mat?: PhysMat;
  visual?: VisualKind;
  rot?: Quaternion;
  moving?: boolean;
}

class Builder {
  parts: Part[] = [];
  movers: Mover[] = [];
  zones: BoostZone[] = [];
  decor: Decor[] = [];

  box(f: Frame, x: number, y: number, z: number, hx: number, hy: number, hz: number, o: BoxOpts): BoxPart {
    const part: BoxPart = {
      type: 'box',
      pos: f.point(x, y, z),
      quat: f.rot(o.rot),
      half: new Vector3(hx, hy, hz),
      collide: o.collide ?? true,
      mat: o.mat ?? 'wall',
      visual: o.visual,
      moving: o.moving,
    };
    this.parts.push(part);
    return part;
  }

  cyl(f: Frame, x: number, y: number, z: number, radius: number, halfHeight: number, o: BoxOpts): CylPart {
    const part: CylPart = {
      type: 'cyl',
      pos: f.point(x, y, z),
      quat: new Quaternion(),
      radius,
      halfHeight,
      collide: o.collide ?? true,
      mat: o.mat ?? 'wall',
      visual: o.visual,
      moving: o.moving,
    };
    this.parts.push(part);
    return part;
  }

  addDecor(f: Frame, d: Omit<Decor, 'pos' | 'quat'>, x: number, y: number, z: number, rot?: Quaternion) {
    this.decor.push({ ...d, pos: f.point(x, y, z), quat: f.rot(rot) });
  }
}

/** Which local sides a tile opens onto: 0 front (+Z), 1 (+X), 2 back (-Z), 3 (-X). */
function openSides(t: Tile): Set<number> {
  const open = new Set<number>();
  if (t.kind !== 'cup') open.add((t.outDir - t.dir + 4) % 4);
  if (t.kind !== 'tee') open.add(2);
  return open;
}

/**
 * Floors overlap slightly into their neighbours so the ball never catches on a seam. That is only safe
 * where the joint is flat or concave (the extension hides under the neighbour's floor), so convex joints
 * such as the top of a ramp keep their real edge.
 */
function canExtend(fromSlope: number, toSlope: number) {
  return toSlope >= fromSlope;
}

function buildTile(b: Builder, t: Tile, prev: Tile | undefined, next: Tile | undefined, index: number) {
  const f = new Frame(t);
  const open = openSides(t);
  const narrow = t.feature?.type === 'narrow';
  const width = narrow ? NARROW_W : TILE;
  const len = f.length;
  const shade = (t.i + t.j) & 1;
  const floorMat: PhysMat = t.surface;

  // Floor visual (the cup tile draws its own floor with a hole).
  if (t.kind !== 'cup') {
    const vis = b.box(f, 0, -FLOOR_VIS_T / 2, 0, width / 2, FLOOR_VIS_T / 2, len / 2, {
      collide: false,
      visual: 'floor',
    });
    vis.surface = t.surface;
    vis.shade = shade;
  } else {
    b.addDecor(f, { kind: 'cupFloor', w: TILE, l: TILE, shade }, 0, 0, 0);
    b.addDecor(f, { kind: 'flag' }, 0, 0, 0);
  }

  // Floor collider with seam-hiding extensions.
  const slope = t.rampDelta;
  let back = 0;
  let front = 0;
  let side = 0; // corner exit extension along local X
  if (prev && canExtend(prev.rampDelta, slope)) back = FLOOR_EXT;
  const outRel = (t.outDir - t.dir + 4) % 4;
  if (next && canExtend(slope, next.rampDelta)) {
    if (outRel === 0) front = FLOOR_EXT;
    else side = FLOOR_EXT;
  }
  const sx = outRel === 1 ? 1 : -1;
  b.box(
    f,
    (side * sx) / 2,
    -FLOOR_COL_T / 2,
    (front - back) / 2,
    width / 2 + side / 2,
    FLOOR_COL_T / 2,
    len / 2 + (front + back) / 2,
    { mat: floorMat },
  );

  // Walls on every closed side (narrow bridges have none along their length).
  const wy = (WALL_H + WALL_BOTTOM) / 2;
  const wh = (WALL_H - WALL_BOTTOM) / 2;
  const wallOpts: BoxOpts = { visual: 'wall', mat: 'wall' };
  for (let rel = 0; rel < 4; rel++) {
    if (open.has(rel)) continue;
    if (narrow && (rel === 1 || rel === 3)) continue;
    if (rel === 0) b.box(f, 0, wy, len / 2 - WALL_T / 2, HALF, wh, WALL_T / 2, wallOpts);
    if (rel === 2) b.box(f, 0, wy, -(len / 2 - WALL_T / 2), HALF, wh, WALL_T / 2, wallOpts);
    if (rel === 1) b.box(f, HALF - WALL_T / 2, wy, 0, WALL_T / 2, wh, len / 2, wallOpts);
    if (rel === 3) b.box(f, -(HALF - WALL_T / 2), wy, 0, WALL_T / 2, wh, len / 2, wallOpts);
  }

  if (t.kind === 'corner') {
    // Post filling the inner corner notch.
    b.box(f, sx * (HALF - WALL_T / 2), wy, -(HALF - WALL_T / 2), WALL_T / 2, wh, WALL_T / 2, wallOpts);
    // 45° bank across the outer corner.
    const inner = HALF - WALL_T;
    const cut = 0.8;
    const p1 = new Vector3(-sx * (inner - cut), 0, inner);
    const p2 = new Vector3(-sx * inner, 0, inner - cut);
    const mid = p1.clone().add(p2).multiplyScalar(0.5);
    const along = p2.clone().sub(p1);
    const n = mid.clone().negate().setY(0).normalize();
    const c = mid.clone().addScaledVector(n, -WALL_T / 2);
    const rot = new Quaternion().setFromAxisAngle(Y_AXIS, Math.atan2(-along.z, along.x));
    b.box(f, c.x, wy, c.z, along.length() / 2 + 0.12, wh, WALL_T / 2, { ...wallOpts, rot });
  }

  if (t.kind === 'tee') b.addDecor(f, { kind: 'tee' }, 0, 0, -TILE * 0.2);

  if (t.feature) buildFeature(b, f, t);

  // Floating rock underneath. Ramps sit on the island of their lower end; narrow bridges get a small
  // rock far below so the drop reads as dangerous.
  const lowY = Math.min(t.level, t.level + t.rampDelta) * LEVEL_H - FLOOR_VIS_T;
  b.decor.push({
    kind: 'island',
    pos: new Vector3(t.i * TILE, lowY - (narrow ? 3.5 : 0), t.j * TILE),
    quat: new Quaternion(),
    w: narrow ? TILE * 0.3 : TILE * 0.72,
    l: 2.2 + (index % 3) * 0.6,
    seed: t.i * 7919 + t.j * 104729,
  });
}

function buildFeature(b: Builder, f: Frame, t: Tile) {
  const rng = mulberry32(t.feature!.seed);
  switch (t.feature!.type) {
    case 'bumpers': {
      const count = 1 + Math.floor(rng() * 3);
      const placed: [number, number][] = [];
      for (let tries = 0; placed.length < count && tries < 40; tries++) {
        const x = range(rng, -1.1, 1.1);
        const z = range(rng, -1.1, 1.1);
        if (placed.some(([px, pz]) => Math.hypot(px - x, pz - z) < 1.15)) continue;
        placed.push([x, z]);
        b.cyl(f, x, 0.2, z, 0.32, 0.22, { mat: 'bumper', visual: 'bumper' });
      }
      break;
    }
    case 'boost': {
      b.zones.push({
        pos: f.point(0, 0, 0),
        quat: f.rot(),
        halfU: 0.9,
        halfW: 0.65,
        dir: new Vector3(0, 0, 1).applyQuaternion(f.quat),
      });
      b.addDecor(f, { kind: 'boostPad', w: 1.3, l: 1.8 }, 0, 0.01, 0);
      break;
    }
    case 'narrow':
      break;
    case 'slider': {
      const block = b.box(f, 0, 0.24, 0, 1.0, 0.24, 0.3, { mat: 'obstacle', visual: 'slider', moving: true });
      const phase = rng() * Math.PI * 2;
      const speed = range(rng, 1.4, 2.0);
      const travel = INNER / 2 - 1.0;
      b.movers.push({
        parts: [block],
        update(time) {
          f.point(Math.sin(time * speed + phase) * travel, 0.24, 0, block.pos);
        },
      });
      break;
    }
    case 'spinner': {
      b.cyl(f, 0, 0.3, 0, 0.18, 0.3, { mat: 'obstacle', visual: 'post' });
      const arm = b.box(f, 0, 0.15, 0, 1.6, 0.12, 0.08, { mat: 'obstacle', visual: 'spinner', moving: true });
      const phase = rng() * Math.PI * 2;
      const speed = range(rng, 0.8, 1.2) * (rng() < 0.5 ? -1 : 1);
      const local = new Quaternion();
      b.movers.push({
        parts: [arm],
        update(time) {
          local.setFromAxisAngle(Y_AXIS, time * speed + phase);
          f.rot(local, arm.quat);
        },
      });
      break;
    }
    case 'windmill': {
      const gap = 1.0;
      const sideW = (INNER - gap) / 2;
      const opts: BoxOpts = { mat: 'wall', visual: 'house' };
      b.box(f, gap / 2 + sideW / 2, 0.75, 0, sideW / 2, 0.75, 0.6, opts);
      b.box(f, -(gap / 2 + sideW / 2), 0.75, 0, sideW / 2, 0.75, 0.6, opts);
      b.box(f, 0, 1.0, 0, gap / 2, 0.5, 0.6, opts);
      b.addDecor(f, { kind: 'roof', w: INNER, l: 1.4 }, 0, 1.5, 0);
      const hubZ = -0.68;
      const hubY = 1.15;
      b.addDecor(f, { kind: 'hub' }, 0, hubY, hubZ);
      const blades: BoxPart[] = [];
      for (let k = 0; k < 4; k++) {
        blades.push(b.box(f, 0, hubY, hubZ, 0.13, 0.52, 0.03, { mat: 'obstacle', visual: 'blade', moving: true }));
      }
      const phase = rng() * Math.PI * 2;
      const speed = range(rng, 1.0, 1.4);
      const local = new Quaternion();
      const offset = new Vector3();
      b.movers.push({
        parts: blades,
        update(time) {
          blades.forEach((blade, k) => {
            local.setFromAxisAngle(Z_AXIS, time * speed + phase + (k * Math.PI) / 2);
            offset.set(0, 0.62, 0).applyQuaternion(local);
            f.point(offset.x, hubY + offset.y, hubZ, blade.pos);
            f.rot(local, blade.quat);
          });
        },
      });
      break;
    }
  }
}

export function buildLayout(spec: HoleSpec): HoleLayout {
  const b = new Builder();
  const { tiles } = spec;
  tiles.forEach((t, k) => buildTile(b, t, tiles[k - 1], tiles[k + 1], k));
  for (const m of b.movers) m.update(0);

  const teeTile = tiles[0];
  const teeFrame = new Frame(teeTile);
  const cupTile = tiles[tiles.length - 1];

  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  const path: Vector3[] = [];
  for (const t of tiles) {
    const c = new Vector3(t.i * TILE, (t.level + t.rampDelta / 2) * LEVEL_H, t.j * TILE);
    path.push(c);
    min.min(new Vector3(c.x - HALF, t.level * LEVEL_H, c.z - HALF));
    max.max(new Vector3(c.x + HALF, (t.level + t.rampDelta) * LEVEL_H + WALL_H, c.z + HALF));
  }

  return {
    spec,
    parts: b.parts,
    movers: b.movers,
    zones: b.zones,
    decor: b.decor,
    cup: new Vector3(cupTile.i * TILE, cupTile.level * LEVEL_H, cupTile.j * TILE),
    tee: teeFrame.point(0, BALL_R, -TILE * 0.2),
    teeDir: teeTile.dir,
    path,
    min,
    max,
    killY: min.y - 6,
  };
}
