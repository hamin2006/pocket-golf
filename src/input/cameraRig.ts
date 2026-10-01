import * as THREE from 'three';

const MIN_PITCH = 0.12;
const MAX_PITCH = 1.45;
const MIN_DIST = 2.5;
const MAX_DIST = 40;
const PLAY_DIST = 6.5;
const PLAY_PITCH = 0.5;

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

interface Intro {
  t: number;
  from: THREE.Vector3;
  fromDist: number;
  fromYaw: number;
}

/** Orbit camera that follows the ball, with a fly-in overview at the start of each hole. */
export class CameraRig {
  yaw = 0;
  pitch = PLAY_PITCH;
  dist = PLAY_DIST;
  readonly target = new THREE.Vector3();
  private goal = new THREE.Vector3();
  private intro: Intro | null = null;
  private orbitSpeed = 0;

  constructor(private camera: THREE.PerspectiveCamera) {}

  /** Start from a high overview of the hole and swoop down behind the ball. */
  startIntro(center: THREE.Vector3, span: number, ball: THREE.Vector3, yaw: number) {
    this.goal.copy(ball);
    this.yaw = yaw;
    this.pitch = PLAY_PITCH;
    this.dist = PLAY_DIST;
    this.intro = { t: 0, from: center.clone(), fromDist: span * 1.25 + 8, fromYaw: yaw + 0.5 };
  }

  get introActive() {
    return this.intro !== null;
  }

  skipIntro() {
    if (!this.intro) return;
    this.intro = null;
    this.target.copy(this.goal);
  }

  /** Slow showcase orbit (used behind the menu). */
  showcase(center: THREE.Vector3, span: number) {
    this.intro = null;
    this.goal.copy(center);
    this.target.copy(center);
    this.dist = span * 1.1 + 9;
    this.pitch = 0.75;
    this.orbitSpeed = 0.08;
  }

  stopShowcase() {
    this.orbitSpeed = 0;
  }

  follow(pos: THREE.Vector3) {
    this.goal.copy(pos);
  }

  rotate(dxPx: number, dyPx: number) {
    this.skipIntro();
    this.yaw -= dxPx * 0.006;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dyPx * 0.005, MIN_PITCH, MAX_PITCH);
  }

  zoom(factor: number) {
    this.skipIntro();
    this.dist = THREE.MathUtils.clamp(this.dist * factor, MIN_DIST, MAX_DIST);
  }

  /** Unit vectors on the ground plane for screen-relative aiming. */
  groundBasis(forward: THREE.Vector3, right: THREE.Vector3) {
    forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    right.set(-forward.z, 0, forward.x);
  }

  update(dt: number) {
    let target = this.target;
    let dist = this.dist;
    let yaw = this.yaw;
    let pitch = this.pitch;
    this.yaw += this.orbitSpeed * dt;

    if (this.intro) {
      const i = this.intro;
      i.t += dt;
      const u = ease(THREE.MathUtils.clamp((i.t - 0.7) / 1.7, 0, 1));
      target = this.target.lerpVectors(i.from, this.goal, u);
      dist = THREE.MathUtils.lerp(i.fromDist, this.dist, u);
      yaw = THREE.MathUtils.lerp(i.fromYaw, this.yaw, u);
      pitch = THREE.MathUtils.lerp(1.0, this.pitch, u);
      if (u >= 1) this.intro = null;
    } else {
      target.lerp(this.goal, 1 - Math.exp(-dt * 6));
    }

    const cp = Math.cos(pitch);
    this.camera.position.set(
      target.x + Math.sin(yaw) * cp * dist,
      target.y + Math.sin(pitch) * dist,
      target.z + Math.cos(yaw) * cp * dist,
    );
    this.camera.lookAt(target);
  }
}
