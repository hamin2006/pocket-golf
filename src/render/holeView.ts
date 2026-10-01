import * as THREE from 'three';
import { CUP_R, FLOOR_VIS_T } from '../config';
import { mulberry32, range, type RNG } from '../core/rng';
import type { Decor, HoleLayout, Part } from '../course/types';
import { MATS, boostTexture, surfaceMat } from './materials';

const FLAG_LIFT_DIST = 1.6;

/** Builds and animates the meshes for one hole. Owns its geometries; materials are shared. */
export class HoleView {
  readonly group = new THREE.Group();
  private geometries: THREE.BufferGeometry[] = [];
  private moving: { mesh: THREE.Object3D; part: Part }[] = [];
  private flag?: THREE.Group;
  private flagCloth?: THREE.Mesh;
  private flagLift = 0;
  private floaters: { obj: THREE.Object3D; baseY: number; phase: number }[] = [];
  private boostMaterials: THREE.MeshStandardMaterial[] = [];

  constructor(private layout: HoleLayout) {
    for (const part of layout.parts) this.addPart(part);
    for (const d of layout.decor) this.addDecor(d);
    this.addScenery();
  }

  private geo<T extends THREE.BufferGeometry>(g: T): T {
    this.geometries.push(g);
    return g;
  }

  private addPart(part: Part) {
    if (!part.visual) return;
    let mesh: THREE.Mesh;
    if (part.type === 'box') {
      const g = this.geo(new THREE.BoxGeometry(part.half.x * 2, part.half.y * 2, part.half.z * 2));
      let mat: THREE.Material | THREE.Material[];
      switch (part.visual) {
        case 'floor': {
          const top = surfaceMat(part.surface ?? 'fairway', part.shade ?? 0);
          mat = [MATS.dirt, MATS.dirt, top, MATS.dirt, MATS.dirt, MATS.dirt];
          break;
        }
        case 'slider':
          mat = MATS.slider;
          break;
        case 'spinner':
          mat = MATS.spinner;
          break;
        case 'house':
          mat = MATS.house;
          break;
        case 'blade':
          mat = MATS.blade;
          break;
        default:
          mat = MATS.wall;
      }
      mesh = new THREE.Mesh(g, mat);
    } else {
      const h = part.halfHeight * 2;
      const g = this.geo(new THREE.CylinderGeometry(part.radius, part.radius, h, 24));
      mesh = new THREE.Mesh(g, part.visual === 'bumper' ? MATS.bumper : MATS.post);
      if (part.visual === 'bumper') {
        const cap = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(part.radius * 0.75, part.radius * 0.85, 0.06, 24)), MATS.bumperCap);
        cap.position.y = part.halfHeight + 0.03;
        mesh.add(cap);
      }
    }
    mesh.position.copy(part.pos);
    mesh.quaternion.copy(part.quat);
    mesh.castShadow = part.visual !== 'floor';
    mesh.receiveShadow = true;
    this.group.add(mesh);
    if (part.moving) this.moving.push({ mesh, part });
  }

  private addDecor(d: Decor) {
    const obj = this.buildDecor(d);
    if (!obj) return;
    obj.position.copy(d.pos);
    obj.quaternion.copy(d.quat);
    this.group.add(obj);
  }

  private buildDecor(d: Decor): THREE.Object3D | undefined {
    switch (d.kind) {
      case 'cupFloor':
        return this.cupFloor(d.w!, d.l!, d.shade ?? 0);
      case 'flag':
        return this.buildFlag();
      case 'tee': {
        const g = new THREE.Group();
        const mat = new THREE.Mesh(this.geo(new THREE.BoxGeometry(1.1, 0.02, 1.1)), MATS.teeMat);
        mat.position.y = 0.005;
        mat.receiveShadow = true;
        g.add(mat);
        for (const x of [-0.45, 0.45]) {
          const m = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.07, 12, 8)), MATS.teeMarker);
          m.position.set(x, 0.06, 0.45);
          m.castShadow = true;
          g.add(m);
        }
        return g;
      }
      case 'boostPad': {
        const tex = boostTexture();
        const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, emissive: '#ff7a00', emissiveIntensity: 0.25 });
        this.boostMaterials.push(mat);
        const m = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(d.w!, d.l!)), mat);
        m.rotation.x = -Math.PI / 2;
        m.receiveShadow = true;
        // Plane is built in the tile frame; wrap so the decor quaternion still applies.
        const g = new THREE.Group();
        g.add(m);
        return g;
      }
      case 'roof': {
        const g = this.geo(new THREE.ConeGeometry(1, 1.1, 4, 1));
        g.rotateY(Math.PI / 4);
        g.scale((d.w! / Math.SQRT2) * 1.08, 1, (d.l! / Math.SQRT2) * 1.08);
        g.translate(0, 0.55, 0);
        const m = new THREE.Mesh(g, MATS.roof);
        m.castShadow = true;
        return m;
      }
      case 'hub': {
        const g = this.geo(new THREE.CylinderGeometry(0.12, 0.12, 0.16, 12));
        g.rotateX(Math.PI / 2);
        const m = new THREE.Mesh(g, MATS.hub);
        m.castShadow = true;
        return m;
      }
      case 'island':
        return this.island(mulberry32(d.seed ?? 1), d.w!, d.l!);
    }
  }

  private cupFloor(w: number, l: number, shade: number) {
    const shape = new THREE.Shape();
    shape.moveTo(-w / 2, -l / 2);
    shape.lineTo(w / 2, -l / 2);
    shape.lineTo(w / 2, l / 2);
    shape.lineTo(-w / 2, l / 2);
    shape.closePath();
    const hole = new THREE.Path();
    hole.absarc(0, 0, CUP_R, 0, Math.PI * 2, true);
    shape.holes.push(hole);
    const g = this.geo(new THREE.ExtrudeGeometry(shape, { depth: FLOOR_VIS_T, bevelEnabled: false, curveSegments: 28 }));
    g.rotateX(-Math.PI / 2);
    g.translate(0, -FLOOR_VIS_T, 0);
    const group = new THREE.Group();
    const floor = new THREE.Mesh(g, [surfaceMat('fairway', shade), MATS.dirt]);
    floor.receiveShadow = true;
    group.add(floor);

    const depth = 0.3;
    const liner = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(CUP_R - 0.004, CUP_R - 0.004, depth, 28, 1, true)), MATS.cup);
    liner.position.y = -depth / 2;
    group.add(liner);
    const bottom = new THREE.Mesh(this.geo(new THREE.CircleGeometry(CUP_R, 28)), MATS.cupBottom);
    bottom.rotation.x = -Math.PI / 2;
    bottom.position.y = -depth + 0.001;
    group.add(bottom);
    const rim = new THREE.Mesh(this.geo(new THREE.RingGeometry(CUP_R, CUP_R + 0.035, 32)), MATS.rim);
    rim.rotation.x = -Math.PI / 2;
    rim.position.y = 0.003;
    group.add(rim);
    return group;
  }

  private buildFlag() {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.025, 0.025, 1.7, 8)), MATS.pole);
    pole.position.y = 0.85 - 0.25;
    pole.castShadow = true;
    g.add(pole);
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(0.7, -0.2);
    shape.lineTo(0, -0.42);
    shape.closePath();
    const cloth = new THREE.Mesh(this.geo(new THREE.ShapeGeometry(shape)), MATS.flag);
    cloth.position.set(0.02, 1.42, 0);
    cloth.castShadow = true;
    g.add(cloth);
    this.flag = g;
    this.flagCloth = cloth;
    return g;
  }

  private island(rng: RNG, radius: number, depth: number) {
    const g = this.geo(new THREE.CylinderGeometry(radius, radius * 0.3, depth, 8, 4));
    const pos = g.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const grass = new THREE.Color('#5fbf4f');
    const dirt = new THREE.Color('#9a6340');
    const rock = new THREE.Color('#7b7486');
    const c = new THREE.Color();
    // Jitter shared vertices consistently so the low-poly faces stay closed.
    const offsets = new Map<string, [number, number, number]>();
    for (let k = 0; k < pos.count; k++) {
      const x = pos.getX(k);
      const y = pos.getY(k);
      const z = pos.getZ(k);
      const id = `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
      let o = offsets.get(id);
      if (!o) {
        const top = y > depth / 2 - 0.01;
        o = top ? [range(rng, -0.15, 0.15), 0, range(rng, -0.15, 0.15)] : [range(rng, -0.35, 0.35), range(rng, -0.2, 0.2), range(rng, -0.35, 0.35)];
        offsets.set(id, o);
      }
      pos.setXYZ(k, x + o[0], y + o[1], z + o[2]);
      const t = (y + depth / 2) / depth; // 1 at top
      if (t > 0.92) c.copy(grass);
      else if (t > 0.6) c.copy(dirt);
      else c.copy(dirt).lerp(rock, Math.min(1, (0.6 - t) / 0.4 + 0.3));
      colors.set([c.r, c.g, c.b], k * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.computeVertexNormals();
    g.translate(0, -depth / 2, 0);
    const m = new THREE.Mesh(g, MATS.island);
    m.rotation.y = rng() * Math.PI;
    m.receiveShadow = true;
    return m;
  }

  /** Little floating islands with trees around the course. */
  private addScenery() {
    const { min, max, spec } = this.layout;
    const rng = mulberry32(spec.seed ^ 0x5eed);
    const center = min.clone().add(max).multiplyScalar(0.5);
    const span = Math.max(max.x - min.x, max.z - min.z) / 2;
    const count = 5 + Math.floor(rng() * 4);
    for (let k = 0; k < count; k++) {
      const angle = (k / count) * Math.PI * 2 + range(rng, -0.3, 0.3);
      const dist = span + range(rng, 6, 14);
      const g = new THREE.Group();
      const size = range(rng, 1.2, 2.6);
      g.add(this.island(rng, size, size * 1.6));
      const trees = Math.floor(rng() * 3);
      for (let t = 0; t < trees + 1; t++) {
        const tree = this.tree(rng);
        tree.position.set(range(rng, -size * 0.5, size * 0.5), 0, range(rng, -size * 0.5, size * 0.5));
        g.add(tree);
      }
      g.position.set(center.x + Math.cos(angle) * dist, min.y + range(rng, -4, 3), center.z + Math.sin(angle) * dist);
      this.group.add(g);
      this.floaters.push({ obj: g, baseY: g.position.y, phase: rng() * Math.PI * 2 });
    }
  }

  private tree(rng: RNG) {
    const g = new THREE.Group();
    const h = range(rng, 0.9, 1.6);
    const trunk = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.08, 0.12, h * 0.45, 6)), MATS.trunk);
    trunk.position.y = h * 0.22;
    g.add(trunk);
    const leaves = new THREE.Mesh(this.geo(new THREE.ConeGeometry(h * 0.38, h * 0.85, 7)), MATS.leaves[Math.floor(rng() * 3)]);
    leaves.position.y = h * 0.45 + h * 0.4;
    leaves.castShadow = true;
    g.add(leaves);
    return g;
  }

  update(time: number, dt: number, ball: THREE.Vector3, ballSunk: boolean) {
    for (const { mesh, part } of this.moving) {
      mesh.position.copy(part.pos);
      mesh.quaternion.copy(part.quat);
    }
    if (this.flag && this.flagCloth) {
      // Pull the flag out of the cup as the ball gets close so it never clips through.
      const near = ballSunk || ball.distanceTo(this.layout.cup) < FLAG_LIFT_DIST;
      this.flagLift += ((near ? 1 : 0) - this.flagLift) * Math.min(1, dt * 6);
      this.flag.position.y = this.layout.cup.y + this.flagLift * 0.9;
      this.flagCloth.rotation.y = Math.sin(time * 2.3) * 0.25;
    }
    for (const f of this.floaters) f.obj.position.y = f.baseY + Math.sin(time * 0.6 + f.phase) * 0.25;
    for (const m of this.boostMaterials) if (m.map) m.map.offset.y = -time * 1.5;
  }

  dispose() {
    for (const g of this.geometries) g.dispose();
    for (const m of this.boostMaterials) m.dispose();
    this.group.removeFromParent();
  }
}
