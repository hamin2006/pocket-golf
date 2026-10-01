import * as THREE from 'three';
import type { Surface } from '../course/types';

export const COLORS = {
  grass: ['#74d65f', '#66c853'],
  sand: '#f3d58d',
  ice: '#c4ecff',
  dirt: '#9a6340',
  wall: '#fbf1df',
  bumper: '#ff5d73',
  slider: '#8b6cff',
  spinner: '#ffc832',
  post: '#4d5466',
  house: '#ffffff',
  roof: '#ef5a45',
  blade: '#fff0cf',
  hub: '#6b4a35',
  flag: '#ff3d3d',
  cup: '#2f3238',
  skyTop: '#5fb8ff',
  skyBottom: '#d9f1ff',
  fog: '#cdeafc',
};

const std = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...extra });

/** Shared materials live for the whole session; hole views only dispose their geometries. */
export const MATS = {
  grass: COLORS.grass.map((c) => std(c)),
  sand: std(COLORS.sand, { roughness: 1 }),
  ice: std(COLORS.ice, { roughness: 0.15, metalness: 0.1 }),
  dirt: std(COLORS.dirt, { flatShading: true }),
  wall: std(COLORS.wall, { roughness: 0.7 }),
  bumper: std(COLORS.bumper, { roughness: 0.45 }),
  bumperCap: std('#ffffff', { roughness: 0.5 }),
  slider: std(COLORS.slider, { roughness: 0.5 }),
  spinner: std(COLORS.spinner, { roughness: 0.5 }),
  post: std(COLORS.post),
  house: std(COLORS.house),
  roof: std(COLORS.roof, { flatShading: true }),
  blade: std(COLORS.blade),
  hub: std(COLORS.hub),
  flag: new THREE.MeshStandardMaterial({ color: COLORS.flag, side: THREE.DoubleSide, roughness: 0.8 }),
  pole: std('#ffffff'),
  cup: new THREE.MeshStandardMaterial({ color: COLORS.cup, side: THREE.BackSide, roughness: 1 }),
  cupBottom: std('#202227'),
  rim: std('#ffffff'),
  teeMat: std('#4fae45'),
  teeMarker: std('#3d7bff', { roughness: 0.4 }),
  island: new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 }),
  leaves: [std('#3fae5a', { flatShading: true }), std('#2f9a6a', { flatShading: true }), std('#7bc94a', { flatShading: true })],
  trunk: std('#7a5034', { flatShading: true }),
  cloud: new THREE.MeshStandardMaterial({ color: '#ffffff', flatShading: true, roughness: 1, emissive: '#ffffff', emissiveIntensity: 0.25 }),
};

export function surfaceMat(surface: Surface, shade: number): THREE.Material {
  if (surface === 'sand') return MATS.sand;
  if (surface === 'ice') return MATS.ice;
  return MATS.grass[shade & 1];
}

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d')!);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

let boostTex: THREE.CanvasTexture | undefined;
export function boostTexture() {
  boostTex ??= (() => {
    const tex = canvasTexture(64, 128, (ctx) => {
      ctx.fillStyle = '#ff8a1c';
      ctx.fillRect(0, 0, 64, 128);
      ctx.fillStyle = '#ffe9a8';
      for (let y = 0; y < 128; y += 64) {
        ctx.beginPath();
        ctx.moveTo(8, y + 44);
        ctx.lineTo(32, y + 20);
        ctx.lineTo(56, y + 44);
        ctx.lineTo(56, y + 58);
        ctx.lineTo(32, y + 34);
        ctx.lineTo(8, y + 58);
        ctx.closePath();
        ctx.fill();
      }
    });
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  })();
  return boostTex;
}

export function ballTexture() {
  return canvasTexture(128, 64, (ctx) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 128, 64);
    ctx.fillStyle = '#ff5d73';
    ctx.fillRect(0, 27, 128, 10);
  });
}

export function skyTexture() {
  return canvasTexture(2, 256, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, COLORS.skyTop);
    g.addColorStop(0.65, COLORS.skyBottom);
    g.addColorStop(1, '#f4fbff');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 2, 256);
  });
}
