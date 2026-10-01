import { Quaternion, Vector3 } from 'three';
import { BALL_R, CUP_R, GRAVITY, SINK_SPEED, TILE, shotSpeed } from '../config';
import type { BoostZone, HoleLayout, Part, PhysMat } from '../course/types';

interface MatProps {
  restitution: number;
  /** Constant rolling deceleration (units/s²). */
  roll: number;
  /** Speed-proportional damping (1/s). */
  damp: number;
  /** Extra outward speed added on impact. */
  kick?: number;
}

const MATS: Record<PhysMat, MatProps> = {
  fairway: { restitution: 0.25, roll: 1.6, damp: 0.35 },
  sand: { restitution: 0.05, roll: 5.5, damp: 1.4 },
  ice: { restitution: 0.25, roll: 0.25, damp: 0.08 },
  wall: { restitution: 0.68, roll: 0, damp: 0 },
  bumper: { restitution: 0.95, roll: 0, damp: 0, kick: 2.2 },
  obstacle: { restitution: 0.55, roll: 0, damp: 0 },
};

const BOOST_ACCEL = 26;
const BOOST_MAX = 12;
const MAX_SPEED = 19;
const REST_SPEED = 0.08;
const REST_TIME = 0.2;
const MAX_ROLL_TIME = 25;

interface Collider {
  part: Part;
  mat: MatProps;
  matName: PhysMat;
  inv: Quaternion;
  prevPos: Vector3;
  prevQuat: Quaternion;
  stamp: number;
}

export type PhysEvent =
  | { type: 'impact'; mat: PhysMat; speed: number }
  | { type: 'rest' }
  | { type: 'sunk' }
  | { type: 'lip' }
  | { type: 'boost' }
  | { type: 'oob' };

export interface BallState {
  pos: Vector3;
  vel: Vector3;
  sleeping: boolean;
  sunk: boolean;
  out: boolean;
  grounded: boolean;
  groundMat: PhysMat | null;
}

export interface Snapshot {
  time: number;
  pos: Vector3;
  vel: Vector3;
  sleeping: boolean;
}

const tmpA = new Vector3();
const tmpB = new Vector3();
const tmpC = new Vector3();
const tmpN = new Vector3();
const tmpV = new Vector3();
const tmpQ = new Quaternion();

export class PhysicsWorld {
  time = 0;
  readonly ball: BallState = {
    pos: new Vector3(),
    vel: new Vector3(),
    sleeping: true,
    sunk: false,
    out: false,
    grounded: false,
    groundMat: null,
  };
  readonly events: PhysEvent[] = [];

  private colliders: Collider[] = [];
  private movingColliders: Collider[] = [];
  private grid = new Map<number, Collider[]>();
  private stamp = 0;
  private restTimer = 0;
  private rollTime = 0;
  private lipCooldown = 0;
  private wasBoosting = false;
  private groundNormal = new Vector3();
  private seed = 1;

  constructor(private layout: HoleLayout) {
    for (const part of layout.parts) {
      if (!part.collide) continue;
      const c: Collider = {
        part,
        mat: MATS[part.mat],
        matName: part.mat,
        inv: part.quat.clone().invert(),
        prevPos: part.pos.clone(),
        prevQuat: part.quat.clone(),
        stamp: 0,
      };
      this.colliders.push(c);
      if (part.moving) this.movingColliders.push(c);
      this.insert(c);
    }
    this.placeBall(layout.tee);
  }

  // ---- Broadphase: colliders bucketed by course tile ----

  private cellKey(ix: number, iz: number) {
    return (ix + 2048) * 4096 + (iz + 2048);
  }

  private insert(c: Collider) {
    const p = c.part;
    let ex: number, ez: number;
    if (p.type === 'cyl') {
      ex = ez = p.radius;
    } else if (p.moving) {
      // Moving parts can rotate within their tile; use their bounding sphere.
      ex = ez = p.half.length();
    } else {
      const m = tmpQ.copy(p.quat);
      const ax = tmpA.set(p.half.x, 0, 0).applyQuaternion(m);
      const ay = tmpB.set(0, p.half.y, 0).applyQuaternion(m);
      const az = tmpC.set(0, 0, p.half.z).applyQuaternion(m);
      ex = Math.abs(ax.x) + Math.abs(ay.x) + Math.abs(az.x);
      ez = Math.abs(ax.z) + Math.abs(ay.z) + Math.abs(az.z);
    }
    const pad = BALL_R + 0.5;
    const x0 = Math.floor((p.pos.x - ex - pad) / TILE + 0.5);
    const x1 = Math.floor((p.pos.x + ex + pad) / TILE + 0.5);
    const z0 = Math.floor((p.pos.z - ez - pad) / TILE + 0.5);
    const z1 = Math.floor((p.pos.z + ez + pad) / TILE + 0.5);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const k = this.cellKey(ix, iz);
        let list = this.grid.get(k);
        if (!list) this.grid.set(k, (list = []));
        list.push(c);
      }
    }
  }

  private nearby(pos: Vector3): Collider[] {
    const ix = Math.floor(pos.x / TILE + 0.5);
    const iz = Math.floor(pos.z / TILE + 0.5);
    return this.grid.get(this.cellKey(ix, iz)) ?? [];
  }

  // ---- Public API ----

  placeBall(pos: Vector3) {
    const b = this.ball;
    b.pos.copy(pos);
    b.vel.set(0, 0, 0);
    b.sleeping = true;
    b.sunk = false;
    b.out = false;
    this.restTimer = 0;
    this.rollTime = 0;
  }

  shoot(dirX: number, dirZ: number, power: number) {
    const len = Math.hypot(dirX, dirZ) || 1;
    const speed = shotSpeed(power);
    const b = this.ball;
    b.vel.set((dirX / len) * speed, 0, (dirZ / len) * speed);
    b.sleeping = false;
    this.restTimer = 0;
    this.rollTime = 0;
  }

  snapshot(): Snapshot {
    const b = this.ball;
    return { time: this.time, pos: b.pos.clone(), vel: b.vel.clone(), sleeping: b.sleeping };
  }

  restore(s: Snapshot) {
    this.time = s.time;
    this.updateMovers();
    for (const c of this.movingColliders) this.syncPrev(c);
    const b = this.ball;
    b.pos.copy(s.pos);
    b.vel.copy(s.vel);
    b.sleeping = s.sleeping;
    b.sunk = false;
    b.out = false;
    this.restTimer = 0;
    this.rollTime = 0;
    this.events.length = 0;
  }

  step(dt: number) {
    for (const c of this.movingColliders) this.syncPrev(c);
    this.time += dt;
    this.updateMovers();

    const b = this.ball;
    if (b.sunk || b.out) return;

    if (b.sleeping) {
      // Wake only if a moving obstacle shoves into the ball.
      for (const c of this.movingColliders) {
        if (this.contact(c, b.pos, BALL_R + 0.002)) {
          b.sleeping = false;
          break;
        }
      }
      if (b.sleeping) return;
    }

    this.rollTime += dt;
    b.vel.y -= GRAVITY * dt;
    this.applyBoost(dt);
    b.vel.multiplyScalar(1 - 0.02 * dt);
    if (b.vel.lengthSq() > MAX_SPEED * MAX_SPEED) b.vel.setLength(MAX_SPEED);
    b.pos.addScaledVector(b.vel, dt);

    this.collide(dt);
    if (b.grounded) this.applyRolling(dt);
    this.cupLogic(dt);
    this.restLogic(dt);

    if (b.pos.y < this.layout.killY) {
      b.out = true;
      b.vel.set(0, 0, 0);
      this.events.push({ type: 'oob' });
    }
  }

  /** Simulates until the ball rests, sinks or goes out (or maxTime passes). Used by bots and tests. */
  simulateShot(maxTime = 20, dt = 1 / 240): 'rest' | 'sunk' | 'out' | 'timeout' {
    const end = this.time + maxTime;
    while (this.time < end) {
      this.step(dt);
      const b = this.ball;
      if (b.sunk) return 'sunk';
      if (b.out) return 'out';
      if (b.sleeping) return 'rest';
    }
    return 'timeout';
  }

  // ---- Internals ----

  private updateMovers() {
    for (const m of this.layout.movers) m.update(this.time);
    for (const c of this.movingColliders) c.inv.copy(c.part.quat).invert();
  }

  private syncPrev(c: Collider) {
    c.prevPos.copy(c.part.pos);
    c.prevQuat.copy(c.part.quat);
  }

  /**
   * Sphere-vs-part test. On contact writes the push-out normal to tmpN and returns the penetration depth.
   */
  private contact(c: Collider, center: Vector3, radius: number): number {
    const p = c.part;
    if (p.type === 'cyl') {
      const dy = center.y - p.pos.y;
      const dx = center.x - p.pos.x;
      const dz = center.z - p.pos.z;
      const r = Math.hypot(dx, dz);
      const inside = Math.abs(dy) <= p.halfHeight;
      if (inside) {
        if (r >= p.radius + radius) return 0;
        // Side contact (or cap if the ball is above/below and closer to it).
        const sideDepth = p.radius + radius - r;
        const capDepth = p.halfHeight + radius - Math.abs(dy);
        if (capDepth < sideDepth) {
          tmpN.set(0, Math.sign(dy) || 1, 0);
          return capDepth;
        }
        if (r < 1e-6) tmpN.set(1, 0, 0);
        else tmpN.set(dx / r, 0, dz / r);
        return sideDepth;
      }
      const cy = Math.sign(dy) * p.halfHeight;
      const ex = r > p.radius ? (dx / r) * p.radius : dx;
      const ez = r > p.radius ? (dz / r) * p.radius : dz;
      tmpN.set(dx - ex, dy - cy, dz - ez);
      const d = tmpN.length();
      if (d >= radius || d < 1e-9) return 0;
      tmpN.divideScalar(d);
      return radius - d;
    }

    const local = tmpA.copy(center).sub(p.pos).applyQuaternion(c.inv);
    const h = p.half;
    const cx = Math.max(-h.x, Math.min(h.x, local.x));
    const cy = Math.max(-h.y, Math.min(h.y, local.y));
    const cz = Math.max(-h.z, Math.min(h.z, local.z));
    const dx = local.x - cx;
    const dy = local.y - cy;
    const dz = local.z - cz;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > 1e-12) {
      if (d2 >= radius * radius) return 0;
      const d = Math.sqrt(d2);
      tmpN.set(dx / d, dy / d, dz / d).applyQuaternion(p.quat);
      return radius - d;
    }
    // Centre inside the box: push out along the shallowest axis.
    const px = h.x - Math.abs(local.x);
    const py = h.y - Math.abs(local.y);
    const pz = h.z - Math.abs(local.z);
    if (py <= px && py <= pz) tmpN.set(0, Math.sign(local.y) || 1, 0);
    else if (px <= pz) tmpN.set(Math.sign(local.x) || 1, 0, 0);
    else tmpN.set(0, 0, Math.sign(local.z) || 1);
    tmpN.applyQuaternion(p.quat);
    return Math.min(px, py, pz) + radius;
  }

  /** Velocity of a (possibly moving) collider's surface at a world point. */
  private surfaceVelocity(c: Collider, point: Vector3, dt: number, out: Vector3): Vector3 {
    if (!c.part.moving) return out.set(0, 0, 0);
    const local = tmpB.copy(point).sub(c.part.pos).applyQuaternion(c.inv);
    const before = tmpC.copy(local).applyQuaternion(c.prevQuat).add(c.prevPos);
    return out.copy(point).sub(before).divideScalar(dt);
  }

  private collide(dt: number) {
    const b = this.ball;
    b.grounded = false;
    b.groundMat = null;
    this.groundNormal.set(0, 0, 0);
    const list = this.nearby(b.pos);

    for (let iter = 0; iter < 3; iter++) {
      this.stamp++;
      let any = false;
      for (const c of list) {
        if (c.stamp === this.stamp) continue;
        c.stamp = this.stamp;
        const depth = this.contact(c, b.pos, BALL_R);
        if (depth <= 0) continue;
        any = true;
        const n = tmpN;
        b.pos.addScaledVector(n, depth);

        const contactPoint = tmpA.copy(b.pos).addScaledVector(n, -BALL_R);
        const sv = this.surfaceVelocity(c, contactPoint, dt, tmpV);
        const rel = tmpB.copy(b.vel).sub(sv);
        const vn = rel.dot(n);
        if (vn < 0) {
          const isFloor = n.y > 0.6;
          let e = c.mat.restitution;
          if (isFloor && -vn < 1.5) e = 0;
          rel.addScaledVector(n, -(1 + e) * vn);
          if (!isFloor) {
            // Scrub a little tangential speed on wall hits.
            const vt = tmpC.copy(rel).addScaledVector(n, -rel.dot(n));
            rel.addScaledVector(vt, -0.05);
          }
          if (c.mat.kick && -vn > 0.4) rel.addScaledVector(n, c.mat.kick);
          b.vel.copy(rel).add(sv);
          if (-vn > 0.6) this.events.push({ type: 'impact', mat: c.matName, speed: -vn });
        }
        if (n.y > 0.6 && n.y >= this.groundNormal.y) {
          b.grounded = true;
          b.groundMat = c.matName;
          this.groundNormal.copy(n);
        }
      }
      if (!any) break;
    }
  }

  private applyRolling(dt: number) {
    const b = this.ball;
    const mat = MATS[b.groundMat ?? 'fairway'];
    const n = this.groundNormal;
    const vn = b.vel.dot(n);
    const vt = tmpA.copy(b.vel).addScaledVector(n, -vn);
    const speed = vt.length();
    if (speed < 1e-6) return;
    const drop = (mat.roll + mat.damp * speed) * dt;
    if (drop >= speed) vt.set(0, 0, 0);
    else vt.multiplyScalar((speed - drop) / speed);
    b.vel.copy(vt).addScaledVector(n, vn);
  }

  private applyBoost(dt: number) {
    const b = this.ball;
    let boosting = false;
    if (b.grounded) {
      for (const z of this.layout.zones) {
        if (this.inZone(z, b.pos)) {
          boosting = true;
          if (b.vel.dot(z.dir) < BOOST_MAX) b.vel.addScaledVector(z.dir, BOOST_ACCEL * dt);
        }
      }
    }
    if (boosting && !this.wasBoosting) this.events.push({ type: 'boost' });
    this.wasBoosting = boosting;
  }

  private inZone(z: BoostZone, pos: Vector3) {
    const local = tmpC.copy(pos).sub(z.pos).applyQuaternion(tmpQ.copy(z.quat).invert());
    return Math.abs(local.x) < z.halfW && Math.abs(local.z) < z.halfU && Math.abs(local.y) < 0.4;
  }

  private cupLogic(dt: number) {
    const b = this.ball;
    const cup = this.layout.cup;
    this.lipCooldown -= dt;
    if (!b.grounded || Math.abs(b.pos.y - BALL_R - cup.y) > 0.08) return;
    const dx = cup.x - b.pos.x;
    const dz = cup.z - b.pos.z;
    const dist = Math.hypot(dx, dz);
    const speed = Math.hypot(b.vel.x, b.vel.z);
    if (dist < CUP_R) {
      if (speed < SINK_SPEED) {
        b.sunk = true;
        b.vel.set(0, 0, 0);
        this.events.push({ type: 'sunk' });
      } else if (this.lipCooldown <= 0) {
        // Too fast: rattle across the lip and deflect.
        this.lipCooldown = 0.35;
        this.seed = (this.seed * 16807) % 2147483647;
        const angle = ((this.seed / 2147483647) * 2 - 1) * 0.5;
        const c = Math.cos(angle);
        const s = Math.sin(angle);
        const vx = b.vel.x * c - b.vel.z * s;
        const vz = b.vel.x * s + b.vel.z * c;
        b.vel.x = vx * 0.72;
        b.vel.z = vz * 0.72;
        this.events.push({ type: 'lip' });
      }
    } else if (dist < CUP_R * 2.2 && speed < 1.8) {
      // Gentle funnel so near-misses at putting speed drop in.
      const pull = 2.4 * dt;
      b.vel.x += (dx / dist) * pull;
      b.vel.z += (dz / dist) * pull;
    }
  }

  private restLogic(dt: number) {
    const b = this.ball;
    if (b.sunk) return;
    const slow = b.vel.length() < REST_SPEED;
    if (b.grounded && slow && this.groundNormal.y > 0.995) this.restTimer += dt;
    else this.restTimer = 0;
    if (this.restTimer > REST_TIME || this.rollTime > MAX_ROLL_TIME) {
      b.sleeping = true;
      b.vel.set(0, 0, 0);
      this.restTimer = 0;
      this.events.push({ type: 'rest' });
    }
  }
}
