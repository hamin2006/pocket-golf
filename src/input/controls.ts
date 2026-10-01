import * as THREE from 'three';
import type { CameraRig } from './cameraRig';

const DEAD_ZONE_PX = 10;

export interface ControlsHost {
  canAim(): boolean;
  onAim(dirX: number, dirZ: number, power: number): void;
  onAimCancel(): void;
  onShoot(dirX: number, dirZ: number, power: number): void;
  onInput(): void;
}

type Mode = 'none' | 'aim' | 'orbit' | 'pinch';

/**
 * Slingshot aiming: press anywhere, pull back, release. The shot goes opposite the drag, relative to
 * the camera's view. Right-drag / middle-drag / two fingers orbit the camera; wheel or pinch zooms.
 */
export class Controls {
  private pointers = new Map<number, { x: number; y: number }>();
  private mode: Mode = 'none';
  private start = { x: 0, y: 0 };
  private last = { x: 0, y: 0 };
  private pinchDist = 0;
  private aim = { x: 0, z: 0, power: 0 };
  private fwd = new THREE.Vector3();
  private right = new THREE.Vector3();

  constructor(
    private el: HTMLElement,
    private rig: CameraRig,
    private host: ControlsHost,
  ) {
    el.addEventListener('pointerdown', this.down);
    el.addEventListener('pointermove', this.move);
    el.addEventListener('pointerup', this.up);
    el.addEventListener('pointercancel', this.cancelPointer);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.rig.zoom(Math.pow(1.0015, e.deltaY));
    }, { passive: false });
  }

  cancelAim() {
    if (this.mode === 'aim') {
      this.mode = 'none';
      this.host.onAimCancel();
    }
  }

  private down = (e: PointerEvent) => {
    this.el.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.host.onInput();

    if (this.pointers.size === 2) {
      this.cancelAim();
      this.mode = 'pinch';
      const [a, b] = [...this.pointers.values()];
      this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      this.last = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      return;
    }
    if (this.pointers.size > 2) return;

    this.start = { x: e.clientX, y: e.clientY };
    this.last = { ...this.start };
    const wantsOrbit = e.pointerType === 'mouse' && e.button !== 0;
    this.mode = !wantsOrbit && this.host.canAim() ? 'aim' : 'orbit';
  };

  private move = (e: PointerEvent) => {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX;
    p.y = e.clientY;

    if (this.mode === 'pinch' && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      this.rig.rotate(mid.x - this.last.x, mid.y - this.last.y);
      this.last = mid;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.pinchDist > 0 && d > 0) this.rig.zoom(this.pinchDist / d);
      this.pinchDist = d;
    } else if (this.mode === 'orbit') {
      this.rig.rotate(e.clientX - this.last.x, e.clientY - this.last.y);
      this.last = { x: e.clientX, y: e.clientY };
    } else if (this.mode === 'aim') {
      if (!this.host.canAim()) return this.cancelAim();
      this.updateAim(e.clientX - this.start.x, e.clientY - this.start.y);
    }
  };

  private up = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    if (this.mode === 'aim') {
      this.mode = 'none';
      if (this.aim.power > 0 && this.host.canAim()) this.host.onShoot(this.aim.x, this.aim.z, this.aim.power);
      else this.host.onAimCancel();
    }
    // After a pinch, wait for every finger to lift before starting anything new.
    if (this.pointers.size === 0) this.mode = 'none';
  };

  private cancelPointer = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    this.cancelAim();
    if (this.pointers.size === 0) this.mode = 'none';
  };

  private updateAim(dx: number, dy: number) {
    const len = Math.hypot(dx, dy);
    const full = Math.min(window.innerWidth, window.innerHeight) * 0.33;
    if (len < DEAD_ZONE_PX) {
      this.aim.power = 0;
      this.host.onAim(0, 0, 0);
      return;
    }
    this.rig.groundBasis(this.fwd, this.right);
    // Pulling down/back shoots forward; pulling right shoots left.
    const x = this.fwd.x * dy - this.right.x * dx;
    const z = this.fwd.z * dy - this.right.z * dx;
    const n = Math.hypot(x, z);
    this.aim.x = x / n;
    this.aim.z = z / n;
    this.aim.power = Math.min(1, (len - DEAD_ZONE_PX) / full);
    this.host.onAim(this.aim.x, this.aim.z, this.aim.power);
  }
}
