export type RNG = () => number;

export function mulberry32(seed: number): RNG {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a over the stringified parts. */
export function hashSeed(...parts: (string | number)[]): number {
  const s = parts.join('|');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export const range = (rng: RNG, min: number, max: number) => min + rng() * (max - min);
export const randInt = (rng: RNG, min: number, max: number) => Math.floor(range(rng, min, max + 1));

export function weightedPick<T>(rng: RNG, items: [T, number][]): T | undefined {
  const total = items.reduce((s, [, w]) => s + w, 0);
  if (total <= 0) return undefined;
  let r = rng() * total;
  for (const [item, w] of items) {
    r -= w;
    if (r <= 0) return item;
  }
  return items[items.length - 1][0];
}
