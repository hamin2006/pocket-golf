// World scale: 1 unit ≈ a mini-golf "foot". One course tile is TILE × TILE.
export const TILE = 4;
export const WALL_T = 0.2;
export const WALL_H = 0.4;
export const LEVEL_H = 0.75;
export const NARROW_W = 1.3;
export const FLOOR_VIS_T = 0.35;
export const FLOOR_COL_T = 1.0;

export const BALL_R = 0.12;
export const CUP_R = 0.22;

export const GRAVITY = 14;
export const MAX_SHOT_SPEED = 11;
export const SINK_SPEED = 3.2;
export const PHYS_DT = 1 / 240;

export const HOLES_PER_RUN = 9;
export const MAX_OVER_PAR = 4;

/** Shot power (0..1 from the drag) → launch speed. The curve gives finer control on short putts. */
export function shotSpeed(power: number): number {
  return MAX_SHOT_SPEED * Math.pow(Math.min(Math.max(power, 0), 1), 1.4);
}
