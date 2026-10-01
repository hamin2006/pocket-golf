export interface DailyResult {
  strokes: number;
  rel: number;
}

export interface SaveData {
  /** Best quick-run score relative to par (lower is better). */
  bestQuick: number | null;
  runs: number;
  holesInOne: number;
  daily: Record<string, DailyResult>;
  muted: boolean;
  seenHint: boolean;
}

const KEY = 'pocket-golf.v1';

const DEFAULTS: SaveData = { bestQuick: null, runs: 0, holesInOne: 0, daily: {}, muted: false, seenHint: false };

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    // Storage blocked or corrupt: play without persistence.
  }
  return { ...DEFAULTS, daily: {} };
}

export function writeSave(data: SaveData) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Ignore — persistence is best effort.
  }
}

export function todayKey(d = new Date()): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}
