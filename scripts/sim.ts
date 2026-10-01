// Headless checks: generator sanity, physics sanity, and a greedy bot that plays generated holes.
// Run with `npm run sim` (optionally `npm run sim -- 60` for more bot holes).
import { Vector3 } from 'three';
import { BALL_R, TILE } from '../src/config';
import { generateHole } from '../src/course/generator';
import { buildLayout } from '../src/course/layout';
import { DIRS, type HoleLayout, type HoleSpec } from '../src/course/types';
import { mulberry32 } from '../src/core/rng';
import { PhysicsWorld } from '../src/physics/world';

let failures = 0;
function check(ok: boolean, msg: string) {
  if (!ok) {
    failures++;
    console.log('  FAIL:', msg);
  }
}

// ---------- 1. Generator ----------
console.log('Generator');
const featureCounts: Record<string, number> = {};
for (let s = 0; s < 2000; s++) {
  const spec = generateHole(s * 7 + 1, (s % 10) / 9);
  const cells = new Set(spec.tiles.map((t) => `${t.i},${t.j}`));
  check(cells.size === spec.tiles.length, `seed ${s}: overlapping tiles`);
  check(spec.tiles[0].kind === 'tee' && spec.tiles.at(-1)!.kind === 'cup', `seed ${s}: bad ends`);
  for (let k = 1; k < spec.tiles.length; k++) {
    const a = spec.tiles[k - 1];
    const b = spec.tiles[k];
    const [dx, dz] = DIRS[a.outDir];
    check(a.i + dx === b.i && a.j + dz === b.j, `seed ${s}: disconnected at ${k}`);
    check(a.level + a.rampDelta === b.level, `seed ${s}: level mismatch at ${k}`);
  }
  for (const t of spec.tiles) if (t.feature) featureCounts[t.feature.type] = (featureCounts[t.feature.type] ?? 0) + 1;
  buildLayout(spec);
}
console.log('  features over 2000 holes:', featureCounts);

// ---------- 2. Physics sanity ----------
console.log('Physics');
function straightHole(n: number): HoleSpec {
  const tiles = Array.from({ length: n }, (_, k) => ({
    i: 0,
    j: k,
    level: 0,
    kind: (k === 0 ? 'tee' : k === n - 1 ? 'cup' : 'straight') as 'tee' | 'cup' | 'straight',
    dir: 0 as const,
    outDir: 0 as const,
    rampDelta: 0,
    surface: 'fairway' as const,
  }));
  return { seed: 0, difficulty: 0, tiles, par: 2 };
}
{
  const world = new PhysicsWorld(buildLayout(straightHole(8)));
  const start = world.ball.pos.clone();
  world.shoot(0, 1, 1);
  const r = world.simulateShot();
  const dist = world.ball.pos.z - start.z;
  console.log(`  full-power roll on fairway: ${dist.toFixed(1)} units (${(dist / TILE).toFixed(1)} tiles), ${r}`);
  check(r === 'rest', 'ball should come to rest');
  check(Math.abs(world.ball.pos.y - BALL_R) < 0.01, `ball should sit on floor, y=${world.ball.pos.y}`);
  check(dist > TILE * 3 && dist < TILE * 5, 'full power should travel 3-5 tiles');
}
{
  // Into the side wall at full power at a shallow angle: must not tunnel.
  const world = new PhysicsWorld(buildLayout(straightHole(8)));
  world.shoot(1, 0.15, 1);
  world.simulateShot();
  check(Math.abs(world.ball.pos.x) < TILE / 2, `ball escaped through wall: x=${world.ball.pos.x}`);
}
{
  // Gentle putt at the cup from 1 unit away sinks; a full-power shot over it lips out.
  const layout = buildLayout(straightHole(3));
  const world = new PhysicsWorld(layout);
  world.placeBall(layout.cup.clone().add(new Vector3(0, BALL_R, -1)));
  world.shoot(0, 1, 0.42);
  check(world.simulateShot() === 'sunk', 'gentle putt should sink');
  world.placeBall(layout.cup.clone().add(new Vector3(0, BALL_R, -1.5)));
  world.shoot(0, 1, 1);
  check(world.simulateShot() !== 'sunk', 'full-power blast should not sink');
}

// ---------- 3. Bot ----------
function progress(layout: HoleLayout, p: Vector3): number {
  const tiles = layout.spec.tiles;
  const ci = Math.round(p.x / TILE);
  const cj = Math.round(p.z / TILE);
  const k = tiles.findIndex((t) => t.i === ci && t.j === cj);
  if (k < 0) return -1;
  if (k === tiles.length - 1) return k + 0.5 - Math.hypot(p.x - layout.cup.x, p.z - layout.cup.z) / TILE;
  const [dx, dz] = DIRS[tiles[k].outDir];
  const c = layout.path[k];
  const along = ((p.x - c.x) * dx + (p.z - c.z) * dz) / TILE;
  return k + Math.max(-0.5, Math.min(0.5, along));
}

interface Shot {
  angle: number;
  power: number;
  wait: number;
}

function evaluate(world: PhysicsWorld, layout: HoleLayout, shot: Shot): number {
  const snap = world.snapshot();
  world.restore({ ...snap, time: snap.time + shot.wait });
  world.shoot(Math.sin(shot.angle), Math.cos(shot.angle), shot.power);
  const r = world.simulateShot();
  const score = r === 'sunk' ? 1000 : r === 'out' ? -100 : progress(layout, world.ball.pos);
  world.restore(snap);
  return score;
}

/** `noise` simulates human aim error: angle (radians) and relative power error, 1 sigma-ish. */
function playHole(spec: HoleSpec, noise = { angle: 0, power: 0 }): { strokes: number; outs: number } {
  const jitter = mulberry32(spec.seed);
  const err = () => (jitter() + jitter() + jitter() - 1.5) * 1.4;
  const layout = buildLayout(spec);
  const world = new PhysicsWorld(layout);
  let strokes = 0;
  let outs = 0;
  while (strokes < 12) {
    const shots: Shot[] = [];
    for (let a = 0; a < 48; a++) {
      for (const power of [0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1]) shots.push({ angle: (a / 48) * Math.PI * 2, power, wait: 0 });
    }
    const scored = shots.map((s) => ({ s, v: evaluate(world, layout, s) })).sort((a, b) => b.v - a.v);
    let best = scored[0];
    for (const { s } of scored.slice(0, 4)) {
      for (const da of [-0.05, 0, 0.05]) {
        for (const dp of [-0.06, 0, 0.06]) {
          for (const wait of [0, 0.6, 1.2]) {
            const c = { angle: s.angle + da, power: Math.min(1, Math.max(0.05, s.power + dp)), wait };
            const v = evaluate(world, layout, c);
            if (v > best.v) best = { s: c, v };
          }
        }
      }
    }
    strokes++;
    const shot = {
      ...best.s,
      angle: best.s.angle + err() * noise.angle,
      power: Math.min(1, best.s.power * (1 + err() * noise.power)),
    };
    const snap = world.snapshot();
    world.restore({ ...snap, time: snap.time + shot.wait });
    const before = world.ball.pos.clone();
    world.shoot(Math.sin(shot.angle), Math.cos(shot.angle), shot.power);
    const r = world.simulateShot();
    if (r === 'sunk') return { strokes, outs };
    if (r === 'out') {
      outs++;
      strokes++;
      world.placeBall(before);
    }
  }
  return { strokes: 99, outs };
}

const botHoles = Number((globalThis as { process?: { argv: string[] } }).process?.argv[2] ?? 30);
console.log(`Bot (${botHoles} holes)`);
const buckets = new Map<number, { par: number; strokes: number; human: number; n: number; failed: number }>();
const t0 = performance.now();
for (let h = 0; h < botHoles; h++) {
  const difficulty = (h % 9) / 8;
  const spec = generateHole(1000 + h * 31, difficulty);
  const { strokes, outs } = playHole(spec);
  const human = playHole(spec, { angle: 0.06, power: 0.1 }).strokes;
  const bucket = Math.round(difficulty * 2);
  const b = buckets.get(bucket) ?? { par: 0, strokes: 0, human: 0, n: 0, failed: 0 };
  b.human += Math.min(human, spec.par + 4);
  b.n++;
  b.par += spec.par;
  if (strokes === 99) {
    b.failed++;
    const desc = spec.tiles.map((t) => t.kind + (t.feature ? `:${t.feature.type}` : '') + (t.surface !== 'fairway' ? `:${t.surface}` : '')).join(' ');
    console.log(`  bot could not finish seed ${spec.seed} (d=${difficulty.toFixed(2)}): ${desc}`);
  } else b.strokes += strokes;
  buckets.set(bucket, b);
  if (outs > 2) console.log(`  seed ${spec.seed}: ${outs} out-of-bounds`);
}
for (const [bucket, b] of [...buckets].sort()) {
  const done = b.n - b.failed;
  console.log(
    `  difficulty ${['easy', 'medium', 'hard'][bucket]}: avg par ${(b.par / b.n).toFixed(2)}, perfect bot ${(b.strokes / Math.max(1, done)).toFixed(2)}, human-ish bot ${(b.human / b.n).toFixed(2)}, unfinished ${b.failed}/${b.n}`,
  );
}
console.log(`  bot time ${((performance.now() - t0) / 1000).toFixed(1)}s`);
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
