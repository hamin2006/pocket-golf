import * as THREE from 'three';
import { mulberry32, range } from '../core/rng';
import { COLORS, MATS, skyTexture } from './materials';

/** Renderer, camera, lights, sky and drifting clouds: everything that outlives a single hole. */
export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
  private sun = new THREE.DirectionalLight('#fff4e0', 2.2);
  private clouds = new THREE.Group();
  private cloudSpeeds: number[] = [];

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    this.scene.background = skyTexture();
    this.scene.fog = new THREE.Fog(COLORS.fog, 45, 140);

    this.scene.add(new THREE.HemisphereLight('#dff3ff', '#7c9a6a', 1.6));
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun, this.sun.target);

    this.buildClouds();
    this.scene.add(this.clouds);

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    // Keep the course framed on tall phone screens.
    this.camera.fov = w < h ? 62 : 50;
    this.camera.updateProjectionMatrix();
  }

  /** Aim the sun's shadow camera at the current hole. */
  frame(min: THREE.Vector3, max: THREE.Vector3) {
    const center = min.clone().add(max).multiplyScalar(0.5);
    const radius = max.clone().sub(min).length() / 2 + 4;
    this.sun.position.copy(center).add(new THREE.Vector3(radius * 0.6, radius * 1.6, radius * 0.35));
    this.sun.target.position.copy(center);
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -radius;
    cam.right = cam.top = radius;
    cam.near = 0.5;
    cam.far = radius * 4;
    cam.updateProjectionMatrix();
    this.clouds.position.set(center.x, 0, center.z);
  }

  private buildClouds() {
    const rng = mulberry32(7);
    const puff = new THREE.IcosahedronGeometry(1, 1);
    for (let c = 0; c < 16; c++) {
      const cloud = new THREE.Group();
      const puffs = 3 + Math.floor(rng() * 4);
      for (let p = 0; p < puffs; p++) {
        const m = new THREE.Mesh(puff, MATS.cloud);
        const s = range(rng, 1.2, 2.6);
        m.scale.set(s * 1.3, s * 0.8, s);
        m.position.set((p - puffs / 2) * 1.8 + range(rng, -0.5, 0.5), range(rng, -0.4, 0.6), range(rng, -1, 1));
        cloud.add(m);
      }
      const angle = rng() * Math.PI * 2;
      const dist = range(rng, 28, 70);
      cloud.position.set(Math.cos(angle) * dist, range(rng, -14, 8), Math.sin(angle) * dist);
      cloud.rotation.y = rng() * Math.PI;
      this.clouds.add(cloud);
      this.cloudSpeeds.push(range(rng, 0.004, 0.012) * (rng() < 0.5 ? -1 : 1));
    }
  }

  update(dt: number) {
    // Clouds orbit the hole slowly.
    this.clouds.children.forEach((cloud, k) => {
      const a = this.cloudSpeeds[k] * dt;
      const { x, z } = cloud.position;
      cloud.position.x = x * Math.cos(a) - z * Math.sin(a);
      cloud.position.z = x * Math.sin(a) + z * Math.cos(a);
    });
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
