import type { Quaternion, Vector3 } from 'three';

/** Grid directions: 0 = +z, 1 = +x, 2 = -z, 3 = -x. */
export type Dir = 0 | 1 | 2 | 3;
export const DIRS: readonly [number, number][] = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
];

export type TileKind = 'tee' | 'straight' | 'corner' | 'ramp' | 'cup';
export type Surface = 'fairway' | 'sand' | 'ice';
export type FeatureType = 'bumpers' | 'windmill' | 'slider' | 'spinner' | 'boost' | 'narrow';

export interface Tile {
  i: number;
  j: number;
  /** Floor level where the ball enters (ramps end at level + rampDelta). */
  level: number;
  kind: TileKind;
  /** Travel direction through the tile; the tile's local +Z. For the tee it is the exit direction. */
  dir: Dir;
  /** Direction the ball leaves the tile. Equals dir except on corners. */
  outDir: Dir;
  rampDelta: number;
  surface: Surface;
  feature?: { type: FeatureType; seed: number };
}

export interface HoleSpec {
  seed: number;
  difficulty: number;
  tiles: Tile[];
  par: number;
}

// ---- Built layout (shared by physics and rendering) ----

export type PhysMat = 'fairway' | 'sand' | 'ice' | 'wall' | 'bumper' | 'obstacle';
export type VisualKind =
  | 'floor'
  | 'wall'
  | 'bumper'
  | 'slider'
  | 'spinner'
  | 'post'
  | 'house'
  | 'blade';

export interface BoxPart {
  type: 'box';
  pos: Vector3;
  quat: Quaternion;
  half: Vector3;
  collide: boolean;
  mat: PhysMat;
  visual?: VisualKind;
  surface?: Surface;
  /** Alternating grass shade for mowed-stripe look. */
  shade?: number;
  moving?: boolean;
}

/** Vertical cylinder. */
export interface CylPart {
  type: 'cyl';
  pos: Vector3;
  quat: Quaternion;
  radius: number;
  halfHeight: number;
  collide: boolean;
  mat: PhysMat;
  visual?: VisualKind;
  moving?: boolean;
}

export type Part = BoxPart | CylPart;

export interface Mover {
  parts: Part[];
  update(t: number): void;
}

export interface BoostZone {
  pos: Vector3;
  quat: Quaternion;
  halfU: number;
  halfW: number;
  dir: Vector3;
}

export type DecorKind = 'tee' | 'cupFloor' | 'flag' | 'boostPad' | 'roof' | 'hub' | 'island';

export interface Decor {
  kind: DecorKind;
  pos: Vector3;
  quat: Quaternion;
  /** Size hints: for cupFloor (width, length), island (radius, depth), roof (width, depth). */
  w?: number;
  l?: number;
  seed?: number;
  shade?: number;
}

export interface HoleLayout {
  spec: HoleSpec;
  parts: Part[];
  movers: Mover[];
  zones: BoostZone[];
  decor: Decor[];
  cup: Vector3;
  tee: Vector3;
  teeDir: Dir;
  /** Floor-level centre of each tile, tee → cup. */
  path: Vector3[];
  min: Vector3;
  max: Vector3;
  killY: number;
}
