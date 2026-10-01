import { TILE } from '../config';
import { mulberry32, randInt, weightedPick, type RNG } from '../core/rng';
import { DIRS, type Dir, type FeatureType, type HoleSpec, type Tile } from './types';

type Step = 'straight' | 'left' | 'right' | 'up' | 'down';

const key = (i: number, j: number) => `${i},${j}`;

function walk(rng: RNG, count: number, difficulty: number): Tile[] | null {
  const tiles: Tile[] = [];
  const occupied = new Set<string>();
  let i = 0;
  let j = 0;
  let level = 0;
  let dir: Dir = 0;

  tiles.push({ i, j, level, kind: 'tee', dir, outDir: dir, rampDelta: 0, surface: 'fairway' });
  occupied.add(key(i, j));
  i += DIRS[dir][0];
  j += DIRS[dir][1];

  for (let k = 1; k < count - 1; k++) {
    if (occupied.has(key(i, j))) return null;
    const prev = tiles[tiles.length - 1];
    const options: [Step, number][] = [
      ['straight', 4],
      ['left', 2.5],
      ['right', 2.5],
    ];
    // Ramps need a flat run-up, and never sit right after the tee.
    if (difficulty > 0.1 && k > 1 && prev.kind !== 'corner') {
      if (level < 2) options.push(['up', 1.3]);
      if (level > -2) options.push(['down', 1.3]);
    }
    const viable = options.filter(([step]) => {
      const out = stepOutDir(dir, step);
      return !occupied.has(key(i + DIRS[out][0], j + DIRS[out][1]));
    });
    const step = weightedPick(rng, viable);
    if (!step) return null;

    const outDir = stepOutDir(dir, step);
    const rampDelta = step === 'up' ? 1 : step === 'down' ? -1 : 0;
    const kind = step === 'left' || step === 'right' ? 'corner' : rampDelta ? 'ramp' : 'straight';
    tiles.push({ i, j, level, kind, dir, outDir, rampDelta, surface: 'fairway' });
    occupied.add(key(i, j));
    level += rampDelta;
    dir = outDir;
    i += DIRS[dir][0];
    j += DIRS[dir][1];
  }

  if (occupied.has(key(i, j))) return null;
  tiles.push({ i, j, level, kind: 'cup', dir, outDir: dir, rampDelta: 0, surface: 'fairway' });
  return tiles;
}

function stepOutDir(dir: Dir, step: Step): Dir {
  if (step === 'left') return ((dir + 3) % 4) as Dir;
  if (step === 'right') return ((dir + 1) % 4) as Dir;
  return dir;
}

const MOVING: FeatureType[] = ['windmill', 'slider', 'spinner'];

function decorate(rng: RNG, tiles: Tile[], d: number) {
  let movers = 0;
  const maxMovers = 1 + Math.floor(d * 2);
  let windmill = false;

  for (let k = 1; k < tiles.length - 1; k++) {
    const t = tiles[k];
    const prev = tiles[k - 1];
    const next = tiles[k + 1];
    if (t.kind === 'straight' && rng() < 0.2 + 0.55 * d) {
      const options: [FeatureType, number][] = [
        ['bumpers', 2],
        ['boost', 1.2],
      ];
      // A narrow bridge next to a corner or ramp is a cheap shot, so keep it between straights.
      if (d > 0.3 && prev.kind !== 'ramp' && next.kind !== 'ramp') options.push(['narrow', 1.2]);
      if (movers < maxMovers) {
        if (d > 0.2 && !windmill) options.push(['windmill', 2]);
        if (d > 0.25) options.push(['slider', 1.4]);
        if (d > 0.4) options.push(['spinner', 1.4]);
      }
      const type = weightedPick(rng, options)!;
      t.feature = { type, seed: Math.floor(rng() * 1e9) };
      if (MOVING.includes(type)) movers++;
      if (type === 'windmill') windmill = true;
      continue;
    }
    if (t.kind === 'straight' || t.kind === 'corner') {
      const r = rng();
      if (r < 0.08 + 0.1 * d) t.surface = 'sand';
      else if (d > 0.3 && r < 0.16 + 0.18 * d) t.surface = 'ice';
    }
  }
  // A windmill needs a clean run-up: no sand or ice right before it.
  for (let k = 1; k < tiles.length - 1; k++) {
    if (tiles[k + 1].feature?.type === 'windmill') tiles[k].surface = 'fairway';
  }
}

const HAZARD: Record<FeatureType, number> = {
  windmill: 0.45,
  spinner: 0.4,
  slider: 0.3,
  narrow: 0.4,
  bumpers: 0.2,
  boost: -0.15,
};

export function computePar(tiles: Tile[]): number {
  let score = 1.4 + ((tiles.length - 1) * TILE) / 13;
  for (const t of tiles) {
    if (t.kind === 'corner') score += 0.3;
    if (t.kind === 'ramp') score += t.rampDelta > 0 ? 0.25 : 0.1;
    if (t.surface === 'sand') score += 0.3;
    if (t.surface === 'ice') score += 0.15;
    if (t.feature) score += HAZARD[t.feature.type];
  }
  return Math.min(6, Math.max(2, Math.round(score)));
}

export function generateHole(seed: number, difficulty: number): HoleSpec {
  const rng = mulberry32(seed);
  const d = Math.min(Math.max(difficulty, 0), 1);
  for (let attempt = 0; attempt < 200; attempt++) {
    const count = 3 + Math.round(d * 2) + randInt(rng, 0, 1 + Math.round(d * 2));
    const tiles = walk(rng, count, d);
    if (!tiles) continue;
    decorate(rng, tiles, d);
    return { seed, difficulty: d, tiles, par: computePar(tiles) };
  }
  // Unreachable in practice: a three-tile straight always fits.
  const tiles = walk(() => 0, 3, 0)!;
  return { seed, difficulty: d, tiles, par: computePar(tiles) };
}
