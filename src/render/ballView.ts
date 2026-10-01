import * as THREE from 'three';
import { BALL_R } from '../config';
import { ballTexture } from './materials';

const TRAIL = 18;

export class BallView {
  readonly mesh: THREE.Mesh;
  private trail: THREE.Line;
  private trailPts: THREE.Vector3[] = [];
  private spin = new THREE.Quaternion();
  private axis = new THREE.Vector3();
  private last = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(BALL_R, 32, 20),
      new THREE.MeshStandardMaterial({ map: ballTexture(), roughness: 0.35 }),
    );
    this.mesh.castShadow = true;
    scene.add(this.mesh);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL * 3), 3));
    this.trail = new THREE.Line(
      geo,
      new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.35, depthWrite: false }),
    );
    this.trail.frustumCulled = false;
    scene.add(this.trail);
  }

  reset(pos: THREE.Vector3) {
    this.mesh.position.copy(pos);
    this.mesh.scale.setScalar(1);
    this.last.copy(pos);
    this.trailPts = [];
    this.trail.visible = false;
  }

  update(pos: THREE.Vector3, moving: boolean) {
    // Roll the visual sphere by the distance travelled along the ground.
    const dx = pos.x - this.last.x;
    const dz = pos.z - this.last.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 1e-5) {
      this.axis.set(dz, 0, -dx).normalize();
      this.spin.setFromAxisAngle(this.axis, dist / BALL_R);
      this.mesh.quaternion.premultiply(this.spin);
    }
    this.last.copy(pos);
    this.mesh.position.copy(pos);

    if (moving) {
      this.trailPts.unshift(pos.clone());
      if (this.trailPts.length > TRAIL) this.trailPts.pop();
    } else if (this.trailPts.length) {
      this.trailPts.pop();
    }
    const attr = this.trail.geometry.attributes.position as THREE.BufferAttribute;
    for (let k = 0; k < TRAIL; k++) {
      const p = this.trailPts[Math.min(k, this.trailPts.length - 1)] ?? pos;
      attr.setXYZ(k, p.x, p.y, p.z);
    }
    attr.needsUpdate = true;
    this.trail.visible = this.trailPts.length > 1;
  }
}

/** Arrow + dotted guide drawn on the ground while aiming. */
export class AimView {
  readonly group = new THREE.Group();
  private arrow = new THREE.Group();
  private shaft: THREE.Mesh;
  private head: THREE.Mesh;
  private dots: THREE.Mesh[] = [];
  private mat = new THREE.MeshBasicMaterial({
    color: '#7cff6b',
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  private dotMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.7, depthWrite: false });
  private color = new THREE.Color();

  constructor(scene: THREE.Scene) {
    const shaftGeo = new THREE.PlaneGeometry(0.1, 1);
    shaftGeo.rotateX(-Math.PI / 2);
    shaftGeo.translate(0, 0, 0.5);
    this.shaft = new THREE.Mesh(shaftGeo, this.mat);
    const tri = new THREE.Shape();
    tri.moveTo(-0.17, 0);
    tri.lineTo(0.17, 0);
    tri.lineTo(0, 0.3);
    tri.closePath();
    const headGeo = new THREE.ShapeGeometry(tri);
    headGeo.rotateX(Math.PI / 2);
    this.head = new THREE.Mesh(headGeo, this.mat);
    this.arrow.add(this.shaft, this.head);
    this.group.add(this.arrow);

    const dotGeo = new THREE.CircleGeometry(0.035, 10);
    dotGeo.rotateX(-Math.PI / 2);
    for (let k = 0; k < 14; k++) {
      const d = new THREE.Mesh(dotGeo, this.dotMat);
      this.dots.push(d);
      this.group.add(d);
    }
    this.group.visible = false;
    this.group.renderOrder = 10;
    scene.add(this.group);
  }

  show(ball: THREE.Vector3, dirX: number, dirZ: number, power: number) {
    this.group.visible = true;
    this.group.position.set(ball.x, ball.y - BALL_R + 0.02, ball.z);
    this.group.rotation.y = Math.atan2(dirX, dirZ);
    const len = 0.35 + power * 1.6;
    this.shaft.position.z = BALL_R + 0.05;
    this.shaft.scale.z = len;
    this.head.position.z = BALL_R + 0.05 + len;
    // Green → yellow → red as power rises.
    this.color.setHSL(0.33 - power * 0.33, 1, 0.58);
    this.mat.color.copy(this.color);
    const guide = 1.2 + power * 4;
    this.dots.forEach((d, k) => {
      const z = BALL_R + 0.05 + len + 0.35 + (k / this.dots.length) * guide;
      d.position.set(0, 0, z);
      d.visible = power > 0.02;
    });
    this.dotMat.opacity = 0.35 + power * 0.4;
  }

  hide() {
    this.group.visible = false;
  }
}
